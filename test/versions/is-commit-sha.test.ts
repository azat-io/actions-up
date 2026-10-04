import { describe, expect, it } from 'vitest'

import { isCommitSha } from '../../core/versions/is-commit-sha'

describe('isCommitSha', () => {
  it.each([
    ['a short SHA on the minimum length', 'abcdef0'],
    ['a full-length SHA', '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8'],
    ['an uppercase SHA', 'ABCDEF0'],
  ])('accepts %s', (_description, value) => {
    expect(isCommitSha(value)).toBeTruthy()
  })

  it.each([
    ['a value one character below the minimum length', 'abcdef'],
    [
      'a value one character beyond a full SHA',
      '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8a',
    ],
    ['a value with characters outside hex', 'xyz1234'],
    ['a v-prefixed date that names a branch', 'v20240101'],
    [
      'a full-length SHA behind a v prefix',
      'v59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
    ],
    ['a branch name', 'main'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_description, value) => {
    expect(isCommitSha(value)).toBeFalsy()
  })
})
