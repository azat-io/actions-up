export class GitHubRateLimitError extends Error {
  public constructor(resetAt: Date, options?: ErrorOptions) {
    let resetTime = resetAt.toLocaleTimeString()
    super(`GitHub API rate limit exceeded. Resets at ${resetTime}`, options)
    this.name = 'GitHubRateLimitError'
  }
}
