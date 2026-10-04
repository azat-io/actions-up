import { describe, expect, it } from 'vitest'

import { isYamlFile } from '../../core/fs/is-yaml-file'

describe('isYamlFile', () => {
  it.each([
    ['ci.yml'],
    ['action.yaml'],
    ['/repo/.github/workflows/release.yml'],
  ])('treats %s as a YAML file', filePath => {
    expect(isYamlFile(filePath)).toBeTruthy()
  })

  it.each([
    ['config.yml.bak'],
    ['yml'],
    ['yaml'],
    ['dependabot.json'],
    ['/repo/.github/workflows/README.md'],
  ])('does not treat %s as a YAML file', filePath => {
    expect(isYamlFile(filePath)).toBeFalsy()
  })
})
