import { describe, expect, it } from 'vitest'

import { matchesAnyPattern } from '../../core/filters/matches-any-pattern'

describe('matchesAnyPattern', () => {
  it('returns false when there are no patterns', () => {
    expect(matchesAnyPattern('actions/checkout', [])).toBeFalsy()
  })

  it('returns true when any pattern matches', () => {
    let patterns = [/^my-org\//iu, /checkout/iu]

    expect(matchesAnyPattern('actions/checkout', patterns)).toBeTruthy()
    expect(matchesAnyPattern('my-org/deploy', patterns)).toBeTruthy()
  })

  it('returns false when no pattern matches', () => {
    let patterns = [/^my-org\//iu, /checkout/iu]

    expect(matchesAnyPattern('actions/setup-node', patterns)).toBeFalsy()
  })

  it('matches a repeated name with a global pattern every time', () => {
    let patterns = [/my-org/giu]

    expect(matchesAnyPattern('my-org/deploy', patterns)).toBeTruthy()
    expect(matchesAnyPattern('my-org/deploy', patterns)).toBeTruthy()
  })
})
