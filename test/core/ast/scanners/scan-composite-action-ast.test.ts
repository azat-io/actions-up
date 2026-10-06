import type { Document } from 'yaml'

import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import type { GitHubAction } from '../../../../types/github-action'

import { scanCompositeActionAst } from '../../../../core/ast/scanners/scan-composite-action-ast'

describe('scanCompositeActionAst', () => {
  let filePath = '.github/actions/setup/action.yml'

  /**
   * Parse an action file and scan it.
   *
   * @param lines - Lines of the action file.
   * @returns Actions found in the file.
   */
  function scan(lines: string[]): GitHubAction[] {
    let content = lines.join('\n')
    return scanCompositeActionAst(parseDocument(content), content, filePath)
  }

  it('reports the action of every step under runs with the line of its uses key', () => {
    let actions = scan([
      'name: Setup',
      'description: Installs the toolchain',
      'runs:',
      '  using: composite',
      '  steps:',
      '    - uses: actions/setup-node@v4',
      '    - run: npm ci',
      '      shell: bash',
      '    - name: Cache dependencies',
      '      uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684 # v4.2.3',
      '',
    ])

    expect(actions).toStrictEqual([
      {
        uses: 'actions/setup-node@v4',
        ref: 'actions/setup-node@v4',
        name: 'actions/setup-node',
        type: 'external',
        file: filePath,
        version: 'v4',
        line: 6,
      },
      {
        uses: 'actions/cache@5a3ec84eff668545956fd18022155c47e93e2684',
        ref: 'actions/cache@5a3ec84eff668545956fd18022155c47e93e2684',
        version: '5a3ec84eff668545956fd18022155c47e93e2684',
        name: 'actions/cache',
        comment: ' v4.2.3',
        type: 'external',
        file: filePath,
        line: 10,
      },
    ])
  })

  it('returns no actions when runs declares no using', () => {
    let actions = scan([
      'name: Setup',
      'runs:',
      '  steps:',
      '    - uses: actions/setup-node@v4',
      '',
    ])

    expect(actions).toStrictEqual([])
  })

  it.each([
    ['an empty file', ['']],
    [
      'a document that is a sequence',
      [
        '- runs:',
        '    using: composite',
        '    steps:',
        '      - uses: actions/setup-node@v4',
        '',
      ],
    ],
    [
      'an action without runs',
      ['name: Setup', 'description: Installs the toolchain', ''],
    ],
    ['runs written as a plain scalar', ['name: Setup', 'runs: composite', '']],
    [
      'runs without steps',
      ['name: Lint', 'runs:', '  using: docker', '  image: Dockerfile', ''],
    ],
    [
      'steps written as a plain scalar',
      [
        'name: Setup',
        'runs:',
        '  using: composite',
        '  steps: actions/setup-node@v4',
        '',
      ],
    ],
  ])('returns no actions for %s', (_description, lines) => {
    expect(scan(lines)).toStrictEqual([])
  })

  it.each([
    [
      'runs',
      [
        'name: Setup',
        'x-runs: &composite',
        '  using: composite',
        '  steps:',
        '    - uses: actions/setup-node@v4',
        'runs: *composite',
        '',
      ],
      5,
    ],
    [
      'steps list',
      [
        'name: Setup',
        'x-steps: &steps',
        '  - uses: actions/setup-node@v4',
        'runs:',
        '  using: composite',
        '  steps: *steps',
        '',
      ],
      3,
    ],
    [
      'step',
      [
        'name: Setup',
        'x-step: &step',
        '  uses: actions/setup-node@v4',
        'runs:',
        '  using: composite',
        '  steps:',
        '    - *step',
        '    - *step',
        '',
      ],
      3,
    ],
  ])(
    'reports an aliased %s once, where its anchor is written',
    (_description, lines, expectedLine) => {
      expect(scan(lines)).toStrictEqual([
        {
          uses: 'actions/setup-node@v4',
          ref: 'actions/setup-node@v4',
          name: 'actions/setup-node',
          line: expectedLine,
          type: 'external',
          file: filePath,
          version: 'v4',
        },
      ])
    },
  )

  describe('current behavior pending owner decision', () => {
    it('returns no actions for invalid YAML that repeats runs, reading the first entry from the tree and the last from its JSON', () => {
      let actions = scan([
        'name: Setup',
        'runs:',
        '  using: composite',
        'runs:',
        '  using: composite',
        '  steps:',
        '    - uses: actions/setup-node@v4',
        '',
      ])

      expect(actions).toStrictEqual([])
    })

    it('reports the steps of an action whose runs uses docker', () => {
      let actions = scan([
        'name: Lint',
        'runs:',
        '  using: docker',
        '  image: Dockerfile',
        '  steps:',
        '    - uses: actions/checkout@v4',
        '',
      ])

      expect(actions).toStrictEqual([
        {
          uses: 'actions/checkout@v4',
          ref: 'actions/checkout@v4',
          name: 'actions/checkout',
          type: 'external',
          file: filePath,
          version: 'v4',
          line: 6,
        },
      ])
    })
  })

  describe('defensive branches unreachable through the public API', () => {
    it('returns no actions for an action whose root node is not a map', () => {
      let document: Pick<Document, 'contents' | 'toJSON'> = {
        toJSON: () => ({
          runs: {
            steps: [{ uses: 'actions/setup-node@v4' }],
            using: 'composite',
          },
          name: 'Setup',
        }),
        contents: null,
      }

      expect(
        scanCompositeActionAst(document as Document, '', filePath),
      ).toStrictEqual([])
    })
  })
})
