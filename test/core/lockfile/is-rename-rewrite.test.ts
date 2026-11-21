import { describe, expect, it } from 'vitest'

import { isRenameRewrite } from '../../../core/lockfile/is-rename-rewrite'

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
  ])('rejects $name', ({ written, current }) => {
    expect(isRenameRewrite(written, current, key => PINNED.has(key))).toBe(
      false,
    )
  })
})
