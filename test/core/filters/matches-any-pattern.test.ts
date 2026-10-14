import { describe, expect, it } from 'vitest'

import { matchesAnyPattern } from '../../../core/filters/matches-any-pattern'

describe('matchesAnyPattern', () => {
  it('returns false when there are no patterns', () => {
    expect(matchesAnyPattern('actions/checkout', [])).toBe(false)
  })

  it('returns true when any pattern matches', () => {
    let patterns = [/^my-org\//iu, /checkout/iu]

    expect(matchesAnyPattern('actions/checkout', patterns)).toBe(true)
    expect(matchesAnyPattern('my-org/deploy', patterns)).toBe(true)
  })

  it('returns false when no pattern matches', () => {
    let patterns = [/^my-org\//iu, /checkout/iu]

    expect(matchesAnyPattern('actions/setup-node', patterns)).toBe(false)
  })

  it('matches a repeated name with a global pattern every time', () => {
    let patterns = [/my-org/giu]

    expect(matchesAnyPattern('my-org/deploy', patterns)).toBe(true)
    expect(matchesAnyPattern('my-org/deploy', patterns)).toBe(true)
  })
})
