import { describe, expect, it } from 'vitest'

import { validateCliOptions } from '../../cli/validate-cli-options'

describe('validateCliOptions', () => {
  it('allows json mode on its own', () => {
    expect(() => validateCliOptions({ json: true, yes: false })).not.toThrow()
  })

  it('allows yes mode on its own', () => {
    expect(() => validateCliOptions({ json: false, yes: true })).not.toThrow()
  })

  it('rejects using json mode together with yes mode', () => {
    expect(() => validateCliOptions({ json: true, yes: true })).toThrow(
      '--json cannot be used with --yes',
    )
  })
})
