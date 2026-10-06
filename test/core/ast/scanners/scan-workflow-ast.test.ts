import type { Document } from 'yaml'

import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import type { GitHubAction } from '../../../../types/github-action'

import { KNOWN_RUNNER_IMAGES } from '../../../../core/runners/known-runner-labels'
import { scanWorkflowAst } from '../../../../core/ast/scanners/scan-workflow-ast'

/**
 * The part of a parsed YAML document the scanner reads, for hand-built input.
 */
interface ScannedDocument {
  /**
   * Root node of the document.
   */
  contents: unknown

  /**
   * Plain value of the whole document.
   */
  toJSON(): unknown
}

describe('scanWorkflowAst', () => {
  let filePath = '.github/workflows/ci.yml'
  let knownUbuntuLabel = `ubuntu-${KNOWN_RUNNER_IMAGES.ubuntu[0]!.version}`

  /**
   * Parse a workflow file and scan it.
   *
   * @param lines - Lines of the workflow file.
   * @returns Actions found in the file.
   */
  function scan(lines: string[]): GitHubAction[] {
    let content = lines.join('\n')
    let document = parseDocument(content, { logLevel: 'silent' })
    return scanWorkflowAst(document, content, filePath)
  }

  it('reports the step actions of every job with their job and line', () => {
    let actions = scan([
      'name: CI',
      'on: push',
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: ./.github/actions/build',
      '  test:',
      '    steps:',
      '      - name: Set up Node',
      '        uses: actions/setup-node@v4',
      '',
    ])

    expect(actions).toEqual([
      {
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        type: 'external',
        file: filePath,
        version: 'v4',
        job: 'build',
        line: 6,
      },
      {
        uses: './.github/actions/build',
        name: './.github/actions/build',
        file: filePath,
        type: 'local',
        job: 'build',
        line: 7,
      },
      {
        uses: 'actions/setup-node@v4',
        ref: 'actions/setup-node@v4',
        name: 'actions/setup-node',
        type: 'external',
        file: filePath,
        version: 'v4',
        job: 'test',
        line: 11,
      },
    ])
  })

  it.each([
    [
      'a reusable workflow of another repository',
      [
        'on: push',
        'jobs:',
        '  call:',
        '    uses: org/repo/.github/workflows/reusable.yml@v1.0.0',
        '    with:',
        '      config: test',
        '',
      ],
      {
        uses: 'org/repo/.github/workflows/reusable.yml@v1.0.0',
        name: 'org/repo/.github/workflows/reusable.yml',
        type: 'reusable-workflow',
        ref: 'org/repo@v1.0.0',
        version: 'v1.0.0',
        file: filePath,
        job: 'call',
        line: 4,
      },
    ],
    [
      'a reusable workflow pinned to a branch',
      [
        'on: push',
        'jobs:',
        '  call:',
        '    uses: org/repo/.github/workflows/test.yaml@main',
        '',
      ],
      {
        uses: 'org/repo/.github/workflows/test.yaml@main',
        name: 'org/repo/.github/workflows/test.yaml',
        type: 'reusable-workflow',
        ref: 'org/repo@main',
        version: 'main',
        file: filePath,
        job: 'call',
        line: 4,
      },
    ],
    [
      'a reusable workflow of the same repository',
      [
        'on: push',
        'jobs:',
        '  call:',
        '    uses: ./.github/workflows/local.yml',
        '',
      ],
      {
        uses: './.github/workflows/local.yml',
        name: './.github/workflows/local.yml',
        file: filePath,
        type: 'local',
        job: 'call',
        line: 4,
      },
    ],
  ])('reports a job-level uses of %s', (_description, lines, expected) => {
    expect(scan(lines)).toEqual([expected])
  })

  it('lists actions in the order their jobs appear in the file', () => {
    let actions = scan([
      'name: Mixed',
      'on: push',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: docker://node:22',
      '  call:',
      '    uses: org/repo/.github/workflows/ci.yml@v2.0.0',
      '  deploy:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: ./.github/actions/deploy',
      '',
    ])

    expect(actions).toEqual([
      {
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        type: 'external',
        file: filePath,
        version: 'v4',
        job: 'build',
        line: 7,
      },
      {
        uses: 'docker://node:22',
        name: 'docker://node:22',
        type: 'docker',
        file: filePath,
        job: 'build',
        line: 8,
      },
      {
        uses: 'org/repo/.github/workflows/ci.yml@v2.0.0',
        name: 'org/repo/.github/workflows/ci.yml',
        type: 'reusable-workflow',
        ref: 'org/repo@v2.0.0',
        version: 'v2.0.0',
        file: filePath,
        job: 'call',
        line: 10,
      },
      {
        uses: './.github/actions/deploy',
        name: './.github/actions/deploy',
        file: filePath,
        type: 'local',
        job: 'deploy',
        line: 14,
      },
    ])
  })

  it('records the trailing comment of a job-level uses', () => {
    let actions = scan([
      'on: push',
      'jobs:',
      '  call:',
      '    uses: org/repo/.github/workflows/x.yml@8e8c483db84b4bee98b60c0593521ed34d9990e8 # v2.0.0',
      '  plain:',
      '    uses: org/repo/.github/workflows/y.yml@v1.0.0',
      '',
    ])

    expect(actions).toStrictEqual([
      {
        uses: 'org/repo/.github/workflows/x.yml@8e8c483db84b4bee98b60c0593521ed34d9990e8',
        ref: 'org/repo@8e8c483db84b4bee98b60c0593521ed34d9990e8',
        version: '8e8c483db84b4bee98b60c0593521ed34d9990e8',
        name: 'org/repo/.github/workflows/x.yml',
        type: 'reusable-workflow',
        comment: ' v2.0.0',
        file: filePath,
        job: 'call',
        line: 4,
      },
      {
        uses: 'org/repo/.github/workflows/y.yml@v1.0.0',
        name: 'org/repo/.github/workflows/y.yml',
        type: 'reusable-workflow',
        ref: 'org/repo@v1.0.0',
        version: 'v1.0.0',
        file: filePath,
        job: 'plain',
        line: 6,
      },
    ])
  })

  it('skips a job-level uses that is not a workflow reference', () => {
    let actions = scan([
      'on: push',
      'jobs:',
      '  call:',
      '    uses: invalid-reference',
      '',
    ])

    expect(actions).toStrictEqual([])
  })

  it.each([
    [
      'a step action',
      [
        'jobs:',
        '  ? [build, test]',
        '  : steps:',
        '      - uses: actions/checkout@v4',
        '',
      ],
      {
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        type: 'external',
        file: filePath,
        version: 'v4',
        line: 4,
      },
    ],
    [
      'a reusable workflow',
      [
        'jobs:',
        '  ? [build, test]',
        '  : uses: org/repo/.github/workflows/test.yml@v1',
        '',
      ],
      {
        uses: 'org/repo/.github/workflows/test.yml@v1',
        name: 'org/repo/.github/workflows/test.yml',
        type: 'reusable-workflow',
        ref: 'org/repo@v1',
        file: filePath,
        version: 'v1',
        line: 3,
      },
    ],
    [
      'a runner',
      [
        'jobs:',
        '  ? [build, test]',
        '  :',
        `    runs-on: ${knownUbuntuLabel}`,
        '',
      ],
      {
        version: knownUbuntuLabel,
        name: 'runner/ubuntu',
        type: 'runner',
        file: filePath,
        line: 4,
      },
    ],
  ])(
    'omits the job name of %s under a job key that is not a plain name',
    (_description, lines, expected) => {
      expect(scan(lines)).toStrictEqual([expected])
    },
  )

  it('reports a job-level runs-on that names a known runner image', () => {
    let actions = scan([
      'name: CI',
      'on: push',
      'jobs:',
      '  build:',
      `    runs-on: ${knownUbuntuLabel}`,
      '    steps:',
      '      - uses: actions/checkout@v4',
      '',
    ])

    expect(actions).toStrictEqual([
      {
        version: knownUbuntuLabel,
        name: 'runner/ubuntu',
        type: 'runner',
        file: filePath,
        job: 'build',
        line: 5,
      },
      {
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        type: 'external',
        file: filePath,
        version: 'v4',
        job: 'build',
        line: 7,
      },
    ])
  })

  it('reports the runner of every job, one job per runner family', () => {
    let windowsLabel = `windows-${KNOWN_RUNNER_IMAGES.windows[0]!.version}`
    let macosLabel = `macos-${KNOWN_RUNNER_IMAGES.macos[0]!.version}`

    let actions = scan([
      'jobs:',
      '  build:',
      `    runs-on: ${knownUbuntuLabel}`,
      '  test:',
      `    runs-on: ${windowsLabel}`,
      '  release:',
      `    runs-on: ${macosLabel}`,
      '',
    ])

    expect(actions).toStrictEqual([
      {
        version: knownUbuntuLabel,
        name: 'runner/ubuntu',
        type: 'runner',
        file: filePath,
        job: 'build',
        line: 3,
      },
      {
        name: 'runner/windows',
        version: windowsLabel,
        type: 'runner',
        file: filePath,
        job: 'test',
        line: 5,
      },
      {
        name: 'runner/macos',
        version: macosLabel,
        type: 'runner',
        file: filePath,
        job: 'release',
        line: 7,
      },
    ])
  })

  it('reports a runner in a file with CRLF line endings', () => {
    let content = [
      'jobs:',
      '  build:',
      `    runs-on: ${knownUbuntuLabel} # pinned`,
      '',
    ].join('\r\n')

    let actions = scanWorkflowAst(parseDocument(content), content, filePath)

    expect(actions).toStrictEqual([
      {
        version: knownUbuntuLabel,
        name: 'runner/ubuntu',
        type: 'runner',
        file: filePath,
        job: 'build',
        line: 3,
      },
    ])
  })

  it.each([
    ['a floating alias', 'ubuntu-latest'],
    ['an expression', `\${{ matrix.os }}`],
  ])('ignores a runs-on label that is %s', (_description, label) => {
    expect(
      scan(['jobs:', '  build:', `    runs-on: ${label}`, '']),
    ).toStrictEqual([])
  })

  it.each([
    [
      'a flow sequence',
      ['jobs:', '  build:', `    runs-on: [self-hosted, ${knownUbuntuLabel}]`],
    ],
    [
      'a block sequence',
      [
        'jobs:',
        '  build:',
        '    runs-on:',
        '      - self-hosted',
        `      - ${knownUbuntuLabel}`,
      ],
    ],
    [
      'a group and labels map',
      [
        'jobs:',
        '  build:',
        '    runs-on:',
        '      group: ubuntu-runners',
        `      labels: ${knownUbuntuLabel}`,
      ],
    ],
    [
      'an anchored value',
      ['jobs:', '  build:', `    runs-on: &runner ${knownUbuntuLabel}`],
    ],
    [
      'a value carried to the next line',
      ['jobs:', '  build:', '    runs-on:', `      ${knownUbuntuLabel}`],
    ],
    [
      'a key inside a flow mapping',
      ['jobs:', `  build: { runs-on: ${knownUbuntuLabel} }`],
    ],
    ['an empty value', ['jobs:', '  build:', '    runs-on:']],
  ])('ignores runs-on written as %s', (_description, lines) => {
    expect(scan([...lines, ''])).toStrictEqual([])
  })

  it.each([
    ['an empty file', ['']],
    [
      'a document that is a sequence',
      [
        '- jobs:',
        '    build:',
        '      steps:',
        '        - uses: actions/checkout@v4',
        '',
      ],
    ],
    ['a document without jobs', ['name: CI', 'on: push', '']],
    ['jobs written as a plain scalar', ['on: push', 'jobs: build', '']],
    ['jobs whose value is left empty', ['on: push', 'jobs:', '']],
    [
      'jobs written as a sequence',
      [
        'on: push',
        'jobs:',
        `  - runs-on: ${knownUbuntuLabel}`,
        '    steps:',
        '      - uses: actions/checkout@v4',
        '',
      ],
    ],
    ['a job whose value is left empty', ['on: push', 'jobs:', '  build:', '']],
    [
      'a job written as an explicit key with no value at all',
      ['on: push', 'jobs:', '  ? build', ''],
    ],
    [
      'a job written as a plain scalar',
      ['on: push', 'jobs:', '  build: actions/checkout@v4', ''],
    ],
    [
      'a job with an empty steps list',
      ['on: push', 'jobs:', '  build:', '    steps: []', ''],
    ],
  ])('returns no actions for %s', (_description, lines) => {
    expect(scan(lines)).toStrictEqual([])
  })

  it('keeps scanning the jobs that follow one it cannot read', () => {
    let actions = scan([
      'on: push',
      'jobs:',
      '  lint: actions/checkout@v4',
      '  build:',
      '    steps:',
      '      - uses: actions/setup-node@v4',
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
        job: 'build',
        line: 6,
      },
    ])
  })

  it.each([
    [
      'step',
      [
        'on: push',
        'jobs:',
        '  build:',
        '    steps:',
        '      - &checkout',
        '        uses: actions/checkout@v4',
        '  test:',
        '    steps:',
        '      - *checkout',
        '',
      ],
      {
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        type: 'external',
        file: filePath,
        version: 'v4',
        job: 'build',
        line: 6,
      },
    ],
    [
      'steps list',
      [
        'on: push',
        'jobs:',
        '  build:',
        '    steps: &shared',
        '      - uses: actions/checkout@v4',
        '  test:',
        '    steps: *shared',
        '',
      ],
      {
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        type: 'external',
        file: filePath,
        version: 'v4',
        job: 'build',
        line: 5,
      },
    ],
    [
      'job',
      [
        'on: push',
        'jobs:',
        '  lint: &job',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '  build: *job',
        '',
      ],
      {
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        type: 'external',
        file: filePath,
        version: 'v4',
        job: 'lint',
        line: 5,
      },
    ],
    [
      'uses value',
      [
        'on: push',
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: &checkout actions/checkout@v4',
        '      - uses: *checkout',
        '',
      ],
      {
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        type: 'external',
        file: filePath,
        version: 'v4',
        job: 'build',
        line: 5,
      },
    ],
  ])(
    'reports an anchored %s once, where it is written',
    (_description, lines, expected) => {
      expect(scan(lines)).toStrictEqual([expected])
    },
  )

  it.each([
    [
      'steps',
      [
        'x-checkout: &checkout',
        '  uses: actions/checkout@v4',
        'on: push',
        'jobs:',
        '  build:',
        '    steps:',
        '      - *checkout',
        '  test:',
        '    steps:',
        '      - *checkout',
        '',
      ],
      2,
    ],
    [
      'steps lists',
      [
        'x-steps: &steps',
        '  - uses: actions/checkout@v4',
        'on: push',
        'jobs:',
        '  build:',
        '    steps: *steps',
        '  test:',
        '    steps: *steps',
        '',
      ],
      2,
    ],
    [
      'jobs',
      [
        'x-job: &job',
        '  steps:',
        '    - uses: actions/checkout@v4',
        'on: push',
        'jobs:',
        '  build: *job',
        '  test: *job',
        '',
      ],
      3,
    ],
    [
      'jobs map',
      [
        'x-jobs: &jobs',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v4',
        'on: push',
        'jobs: *jobs',
        '',
      ],
      4,
    ],
  ])(
    'follows aliased %s to an anchor written outside the jobs',
    (_description, lines, expectedLine) => {
      expect(scan(lines)).toStrictEqual([
        {
          uses: 'actions/checkout@v4',
          ref: 'actions/checkout@v4',
          name: 'actions/checkout',
          line: expectedLine,
          type: 'external',
          file: filePath,
          version: 'v4',
          job: 'build',
        },
      ])
    },
  )

  describe('defensive branches unreachable through the public API', () => {
    it('returns no actions for a workflow whose root node is not a map', () => {
      let document: ScannedDocument = {
        toJSON: () => ({
          jobs: { build: { steps: [{ uses: 'actions/checkout@v4' }] } },
          on: 'push',
        }),
        contents: null,
      }

      expect(scanWorkflowAst(document as Document, '', filePath)).toStrictEqual(
        [],
      )
    })

    it('skips a job whose value has entries but is not a YAML node', () => {
      let jobWithoutToJson = {
        items: [
          {
            value: { value: 'org/repo/.github/workflows/ci.yml@v1' },
            key: { value: 'uses' },
          },
        ],
      }
      let document: ScannedDocument = {
        contents: {
          items: [
            {
              value: {
                items: [{ value: jobWithoutToJson, key: { value: 'call' } }],
              },
              key: { value: 'jobs' },
            },
          ],
        },
        toJSON: () => ({
          jobs: { call: { uses: 'org/repo/.github/workflows/ci.yml@v1' } },
          on: 'push',
        }),
      }

      expect(scanWorkflowAst(document as Document, '', filePath)).toStrictEqual(
        [],
      )
    })
  })
})
