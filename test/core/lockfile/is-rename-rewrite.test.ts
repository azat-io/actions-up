import { describe, expect, it } from 'vitest'

import {
  isRenameRewrite,
  findRenames,
} from '../../../core/lockfile/is-rename-rewrite'

const SHA = '11d5960a326750d5838078e36cf38b85af677262'

/**
 * Keys the lockfile on disk pins for the workflows that run the file.
 */
const PINNED = new Set([`new-org/checkout@${SHA}`, 'new-org/cache@v5'])

/**
 * Text of a workflow whose steps use the given lines.
 *
 * @param steps - Lines after `steps:`.
 * @param lineBreak - Line break between lines.
 * @returns Content of the workflow.
 */
function makeWorkflow(steps: string[], lineBreak = '\n'): string {
  return ['jobs:', '  build:', '    steps:', ...steps, ''].join(lineBreak)
}

describe('isRenameRewrite', () => {
  it.each([
    {
      written: makeWorkflow([
        `      - uses: actions/checkout@${SHA} # v4.2.0`,
        '      - uses: actions/cache@v5',
      ]),
      current: makeWorkflow([
        `      - uses: New-Org/checkout@${SHA}`,
        '      - uses: actions/cache@v5',
      ]),
      name: 'a SHA whose version comment is dropped',
    },
    {
      current: makeWorkflow(
        [
          '      - uses: actions/checkout@v4',
          "        uses: 'new-org/cache@v5'",
        ],
        '\r\n',
      ).replace("cache@v5'\r\n", "cache@v5'\n"),
      written: makeWorkflow(
        [
          '      - uses: actions/checkout@v4',
          "        uses: 'actions/cache@v5'",
        ],
        '\r\n',
      ),
      name: 'a quoted line whose CRLF turns into LF',
    },
    {
      current: makeWorkflow(['      - uses: new-org/cache/save@v5']),
      written: makeWorkflow(['      - uses: actions/cache/save@v5']),
      name: 'an action in a subdirectory',
    },
    {
      written: makeWorkflow([
        `      - { uses: actions/checkout@${SHA} } # v4.2.0`,
      ]),
      current: makeWorkflow([`      - { uses: new-org/checkout@${SHA} }`]),
      name: 'a step in flow style whose version comment is dropped',
    },
    {
      written: 'jobs:\n  build:\n    steps: [{ uses: actions/cache@v5 }]\n',
      current: 'jobs:\n  build:\n    steps: [{ uses: new-org/cache@v5 }]\n',
      name: 'steps in a flow sequence',
    },
    {
      current: makeWorkflow([
        '      - { name: Cache, uses: new-org/cache@v5 }',
      ]),
      written: makeWorkflow([
        '      - { name: Cache, uses: actions/cache@v5 }',
      ]),
      name: 'a key that follows another one in a flow mapping',
    },
    {
      current: makeWorkflow([
        '      - { uses: new-org/cache@v5, with: { path: dist } }',
      ]),
      written: makeWorkflow([
        '      - { uses: actions/cache@v5, with: { path: dist } }',
      ]),
      name: 'a flow mapping that goes on after the value',
    },
    {
      current: makeWorkflow([
        '      - "uses": new-org/cache@v5',
        '      - \'uses\': "new-org/cache@v5"',
      ]),
      written: makeWorkflow([
        '      - "uses": actions/cache@v5',
        '      - \'uses\': "actions/cache@v5"',
      ]),
      name: 'quoted keys',
    },
    {
      written: makeWorkflow(['      - uses: !!str actions/cache@v5 # v5']),
      current: makeWorkflow(['      - uses: !!str new-org/cache@v5']),
      name: 'a value tagged as a string',
    },
  ])(
    'accepts the rename of a repository the lockfile pins under its new name, in $name',
    ({ written, current }) => {
      expect(isRenameRewrite(written, current, key => PINNED.has(key))).toBe(
        true,
      )
    },
  )

  it.each([
    {
      current: makeWorkflow(['      - uses: actions/checkout@v3.0.0']),
      written: makeWorkflow(['      - uses: actions/checkout@v4.0.0']),
      name: 'another reference of the same repository',
    },
    {
      current: makeWorkflow(['      - uses: new-org/checkout@v4']),
      written: makeWorkflow(['      - uses: actions/checkout@v3']),
      name: 'another reference under a new name',
    },
    {
      current: makeWorkflow(['      - uses: other-org/cache@v5']),
      written: makeWorkflow(['      - uses: actions/cache@v5']),
      name: 'a new name the lockfile does not pin',
    },
    {
      written: makeWorkflow([`      - uses: new-org/checkout@${SHA} # v4.2.0`]),
      current: makeWorkflow([`      - uses: new-org/checkout@${SHA}`]),
      name: 'a comment dropped from a line of the same repository',
    },
    {
      written: makeWorkflow([
        '      - uses: actions/cache@v5',
        '      - run: ok',
      ]),
      current: makeWorkflow([
        '      - uses: new-org/cache@v5',
        '      - run: no',
      ]),
      name: 'a rename next to another changed line',
    },
    {
      current: makeWorkflow([
        '      - uses: new-org/cache@v5',
        '      - run: ok',
      ]),
      written: makeWorkflow(['      - uses: actions/cache@v5']),
      name: 'a rename next to an added line',
    },
    {
      current: makeWorkflow(['      - uses: new-org@v5']),
      written: makeWorkflow(['      - uses: actions@v5']),
      name: 'a reference that names no repository',
    },
    {
      current: makeWorkflow(['      - uses: new-org/cache']),
      written: makeWorkflow(['      - uses: actions/cache']),
      name: 'a reference without @',
    },
    {
      current: makeWorkflow(['      - uses: new-org/cache/restore@v5']),
      written: makeWorkflow(['      - uses: actions/cache/save@v5']),
      name: 'another action in a subdirectory under a new name',
    },
    {
      current: makeWorkflow(['        uses: new-org/cache@v5']),
      written: makeWorkflow(['      - uses: actions/cache@v5']),
      name: 'a rename on a line that no longer starts a step',
    },
    {
      current: makeWorkflow(['      - "uses": new-org/cache@v5']),
      written: makeWorkflow(['      - uses: actions/cache@v5']),
      name: 'a rename on a line whose key is quoted anew',
    },
    {
      current: makeWorkflow(['      - uses: !!str new-org/cache@v5']),
      written: makeWorkflow(['      - uses: actions/cache@v5']),
      name: 'a rename on a line whose value is tagged anew',
    },
    {
      current: makeWorkflow([
        '      - { name: Other, uses: new-org/cache@v5 }',
      ]),
      written: makeWorkflow([
        '      - { name: Cache, uses: actions/cache@v5 }',
      ]),
      name: 'a rename in a flow mapping whose key before it changed',
    },
    {
      current: makeWorkflow([
        '      - { uses: new-org/cache@v5, name: Other }',
      ]),
      written: makeWorkflow([
        '      - { uses: actions/cache@v5, name: Cache }',
      ]),
      name: 'a rename in a flow mapping whose key after it changed',
    },
    {
      current:
        'jobs:\n  build:\n    steps: [{ uses: new-org/cache@v5 }, { run: ok }]\n',
      written: 'jobs:\n  build:\n    steps: [{ uses: actions/cache@v5 }]\n',
      name: 'a rename on a line that gained a step',
    },
    {
      written: makeWorkflow([
        '      - { uses: actions/cache@v5, name: "Build #1" }',
      ]),
      name: 'a line cut off at a # after the value, as gh-actions-lock cuts a comment',
      current: makeWorkflow(['      - { uses: new-org/cache@v5, name: "Build']),
    },
  ])('rejects $name', ({ written, current }) => {
    expect(isRenameRewrite(written, current, key => PINNED.has(key))).toBe(
      false,
    )
  })

  it('rejects a name that changes only in case, which gh-actions-lock takes for the same repository', () => {
    expect(
      isRenameRewrite(
        makeWorkflow(['      - uses: actions/cache@v5']),
        makeWorkflow(['      - uses: Actions/Cache@v5']),
        () => true,
      ),
    ).toBe(false)
  })
})

describe('findRenames', () => {
  it('maps the key of each reference a written file names under a new name to its new key, whatever else changed', () => {
    expect(
      findRenames(
        makeWorkflow([
          `      - uses: Actions/Checkout@${SHA} # v4.2.0`,
          '      - uses: actions/cache/save@v5',
          '      - { name: Setup, uses: actions/setup-node@v4 }',
          '      - run: ok',
          '      - uses: actions/upload-artifact@v4',
          '      - uses: actions/download-artifact@v4',
        ]),
        makeWorkflow([
          `      - uses: New-Org/Checkout@${SHA}`,
          '      - uses: new-org/cache/save@v5',
          '      - { name: Setup, uses: other-org/setup-node@v4 }',
          '      - run: no',
          '      - uses: actions/upload-artifact@v5',
          '      - uses: Actions/Download-Artifact@v4',
        ]),
      ),
    ).toStrictEqual(
      new Map([
        [`actions/checkout@${SHA}`, `new-org/checkout@${SHA}`],
        ['actions/setup-node@v4', 'other-org/setup-node@v4'],
        ['actions/cache@v5', 'new-org/cache@v5'],
      ]),
    )
  })

  it('finds none in a file that gained or lost lines', () => {
    expect(
      findRenames(
        makeWorkflow(['      - uses: actions/cache@v5']),
        makeWorkflow(['      - uses: new-org/cache@v5', '      - run: ok']),
      ),
    ).toStrictEqual(new Map())
  })
})
