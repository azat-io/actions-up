import { describe, expect, it } from 'vitest'

import { parseLockfile } from '../../../core/lockfile/parse-lockfile'
import { makeLockfileText } from '../../helpers/make-lockfile-text'

const CHECKOUT_SHA = '11d5960a326750d5838078e36cf38b85af677262'

const CACHE_SHA = '0057852bfaa89a56745cba8c7296529d2fc39830'

describe('parseLockfile', () => {
  it.each(['v0.0.2', 'v0.0.3'])(
    'reads the tracked workflows of a %s lockfile',
    version => {
      let result = parseLockfile(
        makeLockfileText({
          workflows: {
            '.github/workflows/ci.yml': [
              'actions/cache@v4.3.0',
              'actions/checkout@v4.4.0',
            ],
            '.github/workflows/reuse.yml': [],
          },
          dependencies: {
            'actions/checkout@v4.4.0': CHECKOUT_SHA,
            'actions/cache@v4.3.0': CACHE_SHA,
          },
          version,
        }),
      )

      expect(result).toStrictEqual({
        workflows: ['.github/workflows/ci.yml', '.github/workflows/reuse.yml'],
        kind: 'parsed',
        version,
      })
    },
  )

  it.each([
    { case: 'a lockfile that tracks nothing yet', text: "version: 'v0.0.3'\n" },
    {
      text: ["version: 'v0.0.3'", 'workflows:', 'dependencies:', ''].join('\n'),
      case: 'empty sections',
    },
  ])('reads $case as tracking nothing', ({ text }) => {
    expect(parseLockfile(text)).toStrictEqual({
      version: 'v0.0.3',
      kind: 'parsed',
      workflows: [],
    })
  })

  it('reads the tracked workflows whatever the pins and their entries hold', () => {
    let result = parseLockfile(
      [
        "version: 'v0.0.3'",
        'workflows:',
        "    '.github/workflows/ci.yml':",
        "        - 'Actions/Checkout@V4.4.0'",
        "        - 'a pin this release cannot read'",
        'dependencies:',
        "    'Actions/Checkout@V4.4.0':",
        "        hostname: 'github.com'",
        "        ref: 'V4.4.0'",
        `        commit: 'sha1-${CHECKOUT_SHA}'`,
        '        uses:',
        "            - 'actions/cache@v4.3.0'",
        '        field_of_a_newer_release: true',
        '',
      ].join('\n'),
    )

    expect(result).toStrictEqual({
      workflows: ['.github/workflows/ci.yml'],
      version: 'v0.0.3',
      kind: 'parsed',
    })
  })

  it.each([
    { text: "version: 'v0.0.3'\nversion: 'v0.0.2'\n", reason: 'invalid YAML' },
    {
      text: "version: 'v0.0.3'\n---\nversion: 'v0.0.3'\n",
      reason: 'invalid YAML',
    },
    { text: 'workflows: [\n', reason: 'invalid YAML' },
    {
      text: [
        'a: &a [x, x, x, x, x, x, x, x, x, x]',
        `b: &b [${Array.from({ length: 10 }, () => '*a').join(', ')}]`,
        `c: &c [${Array.from({ length: 10 }, () => '*b').join(', ')}]`,
        `d: [${Array.from({ length: 10 }, () => '*c').join(', ')}]`,
        '',
      ].join('\n'),
      reason: 'invalid YAML',
    },
    { reason: 'not a mapping', text: '- v0.0.3\n' },
    { reason: 'not a mapping', text: '' },
    { reason: 'no schema version', text: 'workflows: {}\n' },
    { reason: 'no schema version', text: 'version: 3\n' },
  ])('reports a file with $reason as unreadable', ({ reason, text }) => {
    let result = parseLockfile(text)

    expect(result).toStrictEqual({ kind: 'unsupported', version: null, reason })
  })

  it.each(['v0.0.1', 'v0.0.4', 'v1.0.0'])(
    'reports the schema version %s as unsupported',
    version => {
      let result = parseLockfile(makeLockfileText({ version }))

      expect(result).toStrictEqual({
        reason: `unsupported schema version ${version}`,
        kind: 'unsupported',
        version,
      })
    },
  )

  it.each([
    {
      text: "version: 'v0.0.3'\nactions: {}\n",
      reason: 'unknown key actions',
    },
    {
      text: "version: 'v0.0.3'\nworkflows: []\n",
      reason: 'malformed workflows',
    },
    {
      text: "version: 'v0.0.3'\nworkflows:\n    '.github/workflows/ci.yml': 'actions/checkout@v4'\n",
      reason: 'malformed workflows',
    },
    {
      text: "version: 'v0.0.3'\ndependencies: []\n",
      reason: 'malformed dependencies',
    },
  ])('reports a v0.0.3 file with $reason as unreadable', ({ reason, text }) => {
    let result = parseLockfile(text)

    expect(result).toStrictEqual({
      kind: 'unsupported',
      version: 'v0.0.3',
      reason,
    })
  })
})
