import { describe, expect, it } from 'vitest'

import type { RunnerFamily } from '../../core/runners/known-runner-labels'

import { KNOWN_RUNNER_IMAGES } from '../../core/runners/known-runner-labels'

/**
 * Runner families the readme documents as supported.
 */
const DOCUMENTED_FAMILIES: RunnerFamily[] = ['ubuntu', 'macos', 'windows']

/**
 * Versions of a family that are not newer than the version listed right before
 * them.
 *
 * @param family - Runner family.
 * @returns Versions breaking the oldest-first order.
 */
function versionsOutOfOrder(family: RunnerFamily): string[] {
  let versions = KNOWN_RUNNER_IMAGES[family].map(image => image.version)
  return versions.filter(
    (version, index) =>
      index > 0 &&
      Math.sign(Number(version) - Number(versions[index - 1])) !== 1,
  )
}

/**
 * Kind of every image of a family, in catalog order.
 *
 * @param family - Runner family.
 * @returns Kinds such as `stable, stable, preview`.
 */
function imageKindsOf(family: RunnerFamily): string {
  return KNOWN_RUNNER_IMAGES[family]
    .map(image => (image.preview ? 'preview' : 'stable'))
    .join(', ')
}

describe('kNOWN_RUNNER_IMAGES', () => {
  it.each(DOCUMENTED_FAMILIES)(
    'offers at least one stable image for %s',
    family => {
      expect(KNOWN_RUNNER_IMAGES[family]).toContainEqual(
        expect.not.objectContaining({ preview: true }),
      )
    },
  )

  it.each(DOCUMENTED_FAMILIES)('lists each %s version once', family => {
    let versions = KNOWN_RUNNER_IMAGES[family].map(image => image.version)
    let distinctVersions = new Set(versions)

    expect(distinctVersions.size).toBe(versions.length)
  })

  it.each(DOCUMENTED_FAMILIES)(
    'lists the %s versions in strictly ascending order',
    family => {
      expect(versionsOutOfOrder(family)).toStrictEqual([])
    },
  )

  it.each(DOCUMENTED_FAMILIES)(
    'lists the %s preview images only after the stable ones',
    family => {
      expect(imageKindsOf(family)).not.toContain('preview, stable')
    },
  )
})
