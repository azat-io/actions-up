import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolve GitHub token from environment, gh CLI, or git config.
 *
 * @returns Token string or undefined when not found.
 */
export function resolveGitHubTokenSync(): undefined | string {
  let fromGithubToken = process.env['GITHUB_TOKEN']
  if (fromGithubToken && fromGithubToken.trim() !== '') {
    return fromGithubToken.trim()
  }

  let fromGhToken = process.env['GH_TOKEN']
  if (fromGhToken && fromGhToken.trim() !== '') {
    return fromGhToken.trim()
  }

  try {
    let output = execFileSync('gh', ['auth', 'token'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 500,
    })
    let token = output.trim()
    if (token) {
      return token
    }
  } catch {
    /** Ignore. */
  }

  try {
    let gitConfigPath = join(process.cwd(), '.git', 'config')
    let content = readFileSync(gitConfigPath, 'utf8')
    let directMatch = content.match(
      /^\s*(?:github\.(?:oauth-token|token)|hub\.oauthtoken)\s*=\s*(?<token>\S[^\n\r]*)$/mu,
    )
    let directToken = directMatch?.groups?.['token']?.trim()
    if (directToken) {
      return directToken
    }

    let currentSection: string | null = null
    for (let rawLine of content.split(/\r?\n/u)) {
      let line = rawLine.trim()
      let sectionMatch = line.match(/^\[(?<name>[^\]]+)\]$/u)
      if (sectionMatch?.groups) {
        currentSection = sectionMatch.groups['name']!.toLowerCase()
        continue
      }

      if (currentSection === 'github') {
        let tokenMatch = line.match(
          /^(?:oauth-token|token)\s*=\s*(?<val>\S[^\n\r]*)$/u,
        )
        if (tokenMatch?.groups?.['val']) {
          return tokenMatch.groups['val'].trim()
        }
      }
      if (currentSection === 'hub') {
        let oauthMatch = line.match(/^oauthtoken\s*=\s*(?<val>\S[^\n\r]*)$/u)
        if (oauthMatch?.groups?.['val']) {
          return oauthMatch.groups['val'].trim()
        }
      }
    }
  } catch {
    /** Ignore. */
  }

  return undefined
}
