import { describe, expect, it } from 'vitest'

import type { RunnerFamily } from '../../core/runners/known-runner-labels'

import { KNOWN_RUNNER_IMAGES } from '../../core/runners/known-runner-labels'

describe('kNOWN_RUNNER_IMAGES', () => {
  let families = Object.keys(KNOWN_RUNNER_IMAGES) as RunnerFamily[]

  it.each(families)('lists at least one stable image for %s', family => {
    let images = KNOWN_RUNNER_IMAGES[family]
    expect(images.length).toBeGreaterThan(0)
    expect(images.some(image => !image.preview)).toBeTruthy()
  })

  it.each(families)('orders %s images from oldest to newest', family => {
    let versions = KNOWN_RUNNER_IMAGES[family].map(image =>
      Number.parseFloat(image.version),
    )
    let sorted = versions.toSorted((a, b) => a - b)
    expect(versions).toStrictEqual(sorted)
  })

  it.each(families)('keeps %s versions unique', family => {
    let versions = KNOWN_RUNNER_IMAGES[family].map(image => image.version)
    let unique = new Set(versions)
    expect(unique.size).toBe(versions.length)
  })

  it.each(families)(
    'places %s preview images after every stable one',
    family => {
      let images = KNOWN_RUNNER_IMAGES[family]
      let lastStable = images.findLastIndex(image => !image.preview)
      let firstPreview = images.findIndex(image => image.preview)
      expect(firstPreview === -1 || firstPreview > lastStable).toBeTruthy()
    },
  )
})
