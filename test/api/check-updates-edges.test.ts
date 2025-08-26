import { describe, expect, it, vi } from 'vitest'

import type { GitHubAction } from '../../types/github-action'

import { checkUpdates } from '../../core/api/check-updates'
import { Client } from '../../core/api/client'

vi.mock('../../core/api/client')

describe('checkUpdates edge cases', () => {
  it('uses "unknown" when action version is missing', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue(null),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getTagInfo: vi.fn(),
    }
    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/setup-node',
        name: 'actions/setup-node',
        ref: 'actions/setup-node',
        version: undefined,
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result).toHaveLength(1)
    expect(result[0]!.currentVersion).toBe('unknown')
    expect(result[0]!.latestVersion).toBeNull()
    expect(result[0]!.hasUpdate).toBeFalsy()
  })
})
