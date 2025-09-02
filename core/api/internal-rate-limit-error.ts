export class GitHubRateLimitError extends Error {
  public constructor(resetAt: Date) {
    let resetTime = resetAt.toLocaleTimeString()
    super(`GitHub API rate limit exceeded. Resets at ${resetTime}`)
    this.name = 'GitHubRateLimitError'
  }
}
