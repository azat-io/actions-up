import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { extractUsesFromSteps } from '../../../core/ast/utils/extract-uses-from-steps'
import { createNodeVisitor } from '../../../core/ast/utils/create-node-visitor'

/**
 * Line on which `workflowWithSteps` puts the first step line it is given.
 */
let firstStepLine = 4

/**
 * Line on which `workflowWithSteps` puts the second step line it is given.
 */
let secondStepLine = 5

/**
 * Parse a workflow and return what `extractUsesFromSteps` needs to read the
 * steps of its `build` job.
 *
 * @param content - Workflow YAML text.
 * @returns Node under `jobs.build.steps` and the visitor of its document.
 */
function buildStepsOf(content: string): {
  visit(node: unknown): unknown
  stepsNode: unknown
} {
  let document = parseDocument(content)
  return {
    stepsNode: document.getIn(['jobs', 'build', 'steps'], true),
    visit: createNodeVisitor(document),
  }
}

/**
 * Build a workflow whose `build` job runs the given step lines.
 *
 * @param steps - Lines that follow `steps:`, indented for the job.
 * @returns Workflow YAML text.
 */
function workflowWithSteps(steps: string[]): string {
  return ['jobs:', '  build:', '    steps:', ...steps, ''].join('\n')
}

describe('extractUsesFromSteps', () => {
  let filePath = '.github/workflows/ci.yml'

  it('reports the action of a step with the line of its uses key', () => {
    let content = workflowWithSteps([
      '      - uses: actions/checkout@v4',
      '      - run: npm test',
    ])

    let actions = extractUsesFromSteps({
      ...buildStepsOf(content),
      filePath,
      content,
    })

    expect(actions).toStrictEqual([
      {
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        line: firstStepLine,
        type: 'external',
        file: filePath,
        version: 'v4',
      },
    ])
  })

  it('reports the line of the uses key when the step starts with another key', () => {
    let content = workflowWithSteps([
      '      - name: Set up Node',
      '        uses: actions/setup-node@v4',
      '        with:',
      '          node-version: 22',
    ])

    let actions = extractUsesFromSteps({
      ...buildStepsOf(content),
      filePath,
      content,
    })

    expect(actions).toStrictEqual([
      {
        uses: 'actions/setup-node@v4',
        ref: 'actions/setup-node@v4',
        name: 'actions/setup-node',
        line: secondStepLine,
        type: 'external',
        file: filePath,
        version: 'v4',
      },
    ])
  })

  it('names the job the steps belong to when one is given', () => {
    let content = workflowWithSteps(['      - uses: actions/checkout@v4'])

    let actions = extractUsesFromSteps({
      ...buildStepsOf(content),
      jobName: 'build',
      filePath,
      content,
    })

    expect(actions).toStrictEqual([
      {
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        line: firstStepLine,
        type: 'external',
        file: filePath,
        version: 'v4',
        job: 'build',
      },
    ])
  })

  it('records the trailing comment of a uses line', () => {
    let content = workflowWithSteps([
      '      - uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684 # v4.2.3',
      '      - uses: actions/checkout@v4',
    ])

    let actions = extractUsesFromSteps({
      ...buildStepsOf(content),
      filePath,
      content,
    })

    expect(actions).toStrictEqual([
      {
        uses: 'actions/cache@5a3ec84eff668545956fd18022155c47e93e2684',
        ref: 'actions/cache@5a3ec84eff668545956fd18022155c47e93e2684',
        version: '5a3ec84eff668545956fd18022155c47e93e2684',
        name: 'actions/cache',
        line: firstStepLine,
        comment: ' v4.2.3',
        type: 'external',
        file: filePath,
      },
      {
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        line: secondStepLine,
        type: 'external',
        file: filePath,
        version: 'v4',
      },
    ])
  })

  it('skips a step whose uses is not an action reference', () => {
    let content = workflowWithSteps([
      '      - uses: actions/checkout',
      '      - uses: actions/setup-node@v4',
    ])

    let actions = extractUsesFromSteps({
      ...buildStepsOf(content),
      filePath,
      content,
    })

    expect(actions).toStrictEqual([
      {
        uses: 'actions/setup-node@v4',
        ref: 'actions/setup-node@v4',
        name: 'actions/setup-node',
        line: secondStepLine,
        type: 'external',
        file: filePath,
        version: 'v4',
      },
    ])
  })

  it.each([
    ['a number', '      - uses: 4'],
    ['a list', '      - uses: [actions/checkout@v4]'],
  ])('skips a step whose uses is %s', (_description, step) => {
    let content = workflowWithSteps([
      step,
      '      - uses: actions/setup-node@v4',
    ])

    let actions = extractUsesFromSteps({
      ...buildStepsOf(content),
      filePath,
      content,
    })

    expect(actions).toStrictEqual([
      {
        uses: 'actions/setup-node@v4',
        ref: 'actions/setup-node@v4',
        name: 'actions/setup-node',
        line: secondStepLine,
        type: 'external',
        file: filePath,
        version: 'v4',
      },
    ])
  })

  it.each([
    ['a plain scalar', '      - actions/checkout@v4'],
    ['a nested sequence', '      - - uses: actions/checkout@v4'],
  ])('skips a step written as %s', (_description, step) => {
    let content = workflowWithSteps([
      step,
      '      - uses: actions/setup-node@v4',
    ])

    let actions = extractUsesFromSteps({
      ...buildStepsOf(content),
      filePath,
      content,
    })

    expect(actions).toStrictEqual([
      {
        uses: 'actions/setup-node@v4',
        ref: 'actions/setup-node@v4',
        name: 'actions/setup-node',
        line: secondStepLine,
        type: 'external',
        file: filePath,
        version: 'v4',
      },
    ])
  })

  it.each([
    [
      'a map',
      [
        'jobs:',
        '  build:',
        '    steps:',
        '      uses: actions/checkout@v4',
        '',
      ],
    ],
    [
      'a plain scalar',
      ['jobs:', '  build:', '    steps: actions/checkout@v4', ''],
    ],
  ])('returns no actions when steps is %s', (_description, lines) => {
    let content = lines.join('\n')

    let actions = extractUsesFromSteps({
      ...buildStepsOf(content),
      filePath,
      content,
    })

    expect(actions).toStrictEqual([])
  })

  describe('current behavior pending owner decision', () => {
    it('reports line 0 for a step whose uses comes from a YAML 1.1 merge key', () => {
      let content = [
        '%YAML 1.1',
        '---',
        'jobs:',
        '  build:',
        '    steps:',
        '      - <<: { uses: actions/checkout@v4 }',
        '',
      ].join('\n')

      let actions = extractUsesFromSteps({
        ...buildStepsOf(content),
        filePath,
        content,
      })

      expect(actions).toStrictEqual([
        {
          uses: 'actions/checkout@v4',
          ref: 'actions/checkout@v4',
          name: 'actions/checkout',
          type: 'external',
          file: filePath,
          version: 'v4',
          line: 0,
        },
      ])
    })
  })

  describe('defensive branches unreachable through the public API', () => {
    it('skips a step that has entries but is not a YAML node', () => {
      let content = workflowWithSteps(['      - uses: actions/checkout@v4'])
      let stepWithoutToJson = {
        items: [
          { value: { value: 'actions/checkout@v4' }, key: { value: 'uses' } },
        ],
      }

      let actions = extractUsesFromSteps({
        visit: createNodeVisitor(parseDocument(content)),
        stepsNode: { items: [stepWithoutToJson] },
        filePath,
        content,
      })

      expect(actions).toStrictEqual([])
    })
  })
})
