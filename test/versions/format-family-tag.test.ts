import { describe, expect, it } from 'vitest'

import { formatFamilyTag } from '../../core/versions/format-family-tag'
import { parseTagFamily } from '../../core/versions/parse-tag-family'

describe('formatFamilyTag', () => {
  it('rebuilds a tag inside its own family', () => {
    let family = parseTagFamily('actions-v0.1.2')!

    expect(formatFamilyTag(family, ['0'])).toBe('actions-v0')
    expect(formatFamilyTag(family, ['0', '1'])).toBe('actions-v0.1')
    expect(formatFamilyTag(family, ['0', '1', '2'])).toBe('actions-v0.1.2')
  })

  it('rebuilds plain semver tags', () => {
    expect(formatFamilyTag(parseTagFamily('v7.0.2')!, ['7'])).toBe('v7')
    expect(formatFamilyTag(parseTagFamily('7.0.2')!, ['7', '0'])).toBe('7.0')
  })

  it('keeps a scoped package prefix', () => {
    let family = parseTagFamily('@scope/pkg@1.2.3')!

    expect(formatFamilyTag(family, ['1', '2'])).toBe('@scope/pkg@1.2')
  })
})
