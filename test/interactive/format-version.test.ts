import { describe, expect, it, vi } from 'vitest'
import pc from 'picocolors'

import { formatVersion } from '../../core/interactive/format-version'

/**
 * Picocolors decides at import time whether to color, from the environment and
 * the terminal. The real library configured with colors on lets every test
 * check the same coloring everywhere.
 */
vi.mock(import('picocolors'), async importOriginal => {
  let { default: picocolors } = await importOriginal()
  return {
    default: {
      ...picocolors.createColors(true),
      createColors: picocolors.createColors,
    },
  }
})

describe('formatVersion', () => {
  it('renders colors in this file whatever the environment says, so color assertions are meaningful', () => {
    expect(pc.gray('x')).not.toBe('x')
  })

  it.each([
    {
      expected: `${pc.redBright('2')}${pc.redBright('.')}${pc.redBright('0')}${pc.redBright('.')}${pc.redBright('0')}`,
      description: 'paints every part red for a major update',
      current: '1.2.3',
      latest: '2.0.0',
    },
    {
      expected: `${pc.redBright('1')}${pc.redBright('.')}${pc.redBright('0')}${pc.redBright('.')}${pc.redBright('0')}`,
      description: 'paints every part red for a major update out of 0.x',
      current: '0.9.0',
      latest: '1.0.0',
    },
    {
      description:
        'paints the minor and patch parts gray for a minor update of a stable version',
      expected: `1.${pc.gray('3')}${pc.gray('.')}${pc.gray('0')}`,
      current: '1.2.3',
      latest: '1.3.0',
    },
    {
      description:
        'paints only the patch part gray for a patch update of a stable version',
      expected: `1.2.${pc.gray('4')}`,
      current: '1.2.3',
      latest: '1.2.4',
    },
    {
      description:
        'paints the minor and patch parts yellow for a minor update of a 0.x version',
      expected: `0.${pc.yellowBright('2')}${pc.yellowBright('.')}${pc.yellowBright('0')}`,
      current: '0.1.0',
      latest: '0.2.0',
    },
    {
      description:
        'paints only the patch part yellow for a patch update of a 0.x version',
      expected: `0.1.${pc.yellowBright('1')}`,
      current: '0.1.0',
      latest: '0.1.1',
    },
    {
      description: 'leaves an unchanged version uncolored',
      expected: '1.2.3',
      current: '1.2.3',
      latest: '1.2.3',
    },
  ])('$description', ({ expected, current, latest }) => {
    expect(formatVersion(latest, current)).toBe(expected)
  })

  it.each([null, undefined])(
    'prints a gray unknown when latest is %s',
    latest => {
      expect(formatVersion(latest, '1.2.3')).toBe(pc.gray('unknown'))
    },
  )

  it('returns latest unchanged when there is no current version', () => {
    expect(formatVersion('v1.2.3', null)).toBe('v1.2.3')
  })

  it('returns latest unchanged when it is not a version', () => {
    expect(formatVersion('not-a-version', '2.0.1')).toBe('not-a-version')
  })

  it.each([
    {
      expected: `1.0.${pc.gray('1')}`,
      latest: '1.0.1',
      current: 'v1',
    },
    {
      expected: `1.${pc.gray('3')}${pc.gray('.')}${pc.gray('0')}`,
      current: 'v1.2',
      latest: '1.3.0',
    },
  ])(
    'normalizes the short current version $current before comparing',
    ({ expected, current, latest }) => {
      expect(formatVersion(latest, current)).toBe(expected)
    },
  )

  describe('current behavior pending owner decision', () => {
    it('drops the v prefix of latest once the change is colored', () => {
      expect(formatVersion('v1.3.0', '1.2.3')).toBe(
        `1.${pc.gray('3')}${pc.gray('.')}${pc.gray('0')}`,
      )
    })

    it('prints a prerelease latest without its suffix and without color', () => {
      expect(formatVersion('1.2.4-rc.1', '1.2.3')).toBe('1.2.4')
    })

    it('leaves a short latest such as 2.1 uncolored, while a short current version is normalized', () => {
      expect(formatVersion('2.1', '2.0.1')).toBe('2.1')
    })
  })
})
