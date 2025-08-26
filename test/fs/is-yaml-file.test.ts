import { describe, expect, it } from 'vitest'

import { isYamlFile } from '../../core/fs/is-yaml-file'

describe('isYamlFile', () => {
  it('should return true for .yml files', () => {
    expect(isYamlFile('test.yml')).toBeTruthy()
  })

  it('should return true for .yaml files', () => {
    expect(isYamlFile('test.yaml')).toBeTruthy()
  })

  it('should return false for non-YAML files', () => {
    expect(isYamlFile('test.txt')).toBeFalsy()
    expect(isYamlFile('test.json')).toBeFalsy()
  })
})
