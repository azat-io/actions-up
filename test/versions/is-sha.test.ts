import { describe, expect, it } from 'vitest'

import { isSha } from '../../core/versions/is-sha'

describe('isSha', () => {
  it.each([
    ['a short SHA on the minimum length', 'abcdef0'],
    ['a full-length SHA', '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8'],
    ['an uppercase SHA', 'A1B2C3D'],
    ['a SHA behind a v prefix', 'v59b9d7edfcad5b87fbe3f473a9a134a721ad03f8'],
  ])('accepts %s', (_description, value) => {
    expect(isSha(value)).toBeTruthy()
  })

  it.each([
    ['a value one character below the minimum length', 'abcdef'],
    [
      'a value one character beyond a full SHA',
      '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8a',
    ],
    ['a value with characters outside hex', 'xyz1234'],
    ['a branch name with a v after its start', 'dev20240101'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_description, value) => {
    expect(isSha(value)).toBeFalsy()
  })
})
