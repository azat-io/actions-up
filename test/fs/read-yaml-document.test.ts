import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readYamlDocument } from '../../core/fs/read-yaml-document'

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
}))

vi.mock(import('yaml'), () => ({
  parseDocument: vi.fn(),
}))

describe('readYamlDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads file content and parses YAML document', async () => {
    let { readFile } = await import('node:fs/promises')
    let { parseDocument } = await import('yaml')

    vi.mocked(readFile).mockResolvedValue('key: value\n')
    vi.mocked(parseDocument).mockReturnValue({
      toJSON: () => ({ key: 'value' }),
    } as never)

    let { document, content } = await readYamlDocument('file.yml')
    expect(content).toBe('key: value\n')
    expect(document.toJSON()).toEqual({ key: 'value' })
  })

  it('propagates read errors', async () => {
    let { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockRejectedValue(new Error('File not found'))
    await expect(readYamlDocument('missing.yml')).rejects.toThrowError(
      'File not found',
    )
  })
})
