# Actions Up!

<img
  src="https://raw.githubusercontent.com/azat-io/actions-up/main/assets/logo.svg"
  alt="Actions Up logo"
  width="160"
  height="160"
  align="right"
/>

[![Version](https://img.shields.io/npm/v/actions-up.svg?color=fff&labelColor=4493f8)](https://npmjs.com/package/actions-up)
[![Code Coverage](https://img.shields.io/codecov/c/github/azat-io/actions-up.svg?color=fff&labelColor=4493f8)](https://codecov.io/gh/azat-io/actions-up)
[![GitHub License](https://img.shields.io/badge/license-MIT-232428.svg?color=fff&labelColor=4493f8)](https://github.com/azat-io/actions-up/blob/main/license.md)

Actions Up scans your workflows and composite actions to discover every referenced GitHub Action, then checks for newer releases.

Interactively upgrade and pin actions to exact commit SHAs for secure, reproducible CI and low-friction maintenance.

## Features

- **Auto-discovery**: Scans all workflows (`.github/workflows/*.yml`) and composite actions (`.github/actions/*/action.yml`)
- **Reusable Workflows**: Detects and updates reusable workflow calls at the job level
- **SHA pinning**: Updates actions to use commit SHA instead of tags for better security
- **Batch Updates**: Update multiple actions at once
- **Interactive Selection**: Choose which actions to update
- **Breaking Changes Detection**: Warns about major version updates
- **Fast & Efficient**: Optimized API usage with deduped lookups
- **CI/CD Integration**: Use in GitHub Actions workflows for automated PR checks

###

<br>

<picture>
  <source
    srcset="https://raw.githubusercontent.com/azat-io/actions-up/main/assets/example-light.webp"
    media="(prefers-color-scheme: light)"
  />
  <source
    srcset="https://raw.githubusercontent.com/azat-io/actions-up/main/assets/example-dark.webp"
    media="(prefers-color-scheme: dark)"
  />
  <img
    src="https://raw.githubusercontent.com/azat-io/actions-up/main/assets/example-light.webp"
    alt="Actions Up! interactive example"
    width="820"
  />
</picture>

## Why

### The Problem

Keeping GitHub Actions updated is a critical but tedious task:

- **Security Risk**: Using outdated actions with known vulnerabilities
- **Manual Hell**: Checking dozens of actions across multiple workflows by hand
- **Version Tags Are Mutable**: v1 or v2 tags can change without notice, breaking reproducibility
- **Time Sink**: Hours spent on maintenance that could be used for actual development

### The Solution

Actions Up transforms a painful manual process into a delightful experience:

| Without Actions Up             | With Actions Up                  |
| :----------------------------- | :------------------------------- |
| Check each action manually     | Scan all workflows in seconds    |
| Risk using vulnerable versions | SHA pinning for maximum security |
| 30+ minutes per repository     | Under 1 minute total             |

## Installation

Quick use (no installation)

```bash
npx actions-up
```

Global installation

```bash
npm install -g actions-up
```

Per-project

```bash
npm install --save-dev actions-up
```

## Usage

### Interactive Mode (Default)

Run in your repository root:

```bash
npx actions-up
```

This will:

1. Scan all `.github/workflows/*.yml` and `.github/actions/*/action.yml` files
2. Check for available updates
3. Show an interactive list to select updates
4. Apply selected updates with SHA pinning

### Auto-Update Mode

Skip all prompts and update everything:

```bash
npx actions-up --yes
# or
npx actions-up -y
```

### Dry Run Mode

Check for updates without making any changes:

```bash
npx actions-up --dry-run
```

### Custom Directory

By default, Actions Up scans the `.github` directory. You can specify a different directory (e.g., for Gitea):

```bash
npx actions-up --dir .gitea
```

## GitHub Actions Integration

### Automated PR Checks

You can integrate Actions Up into your CI/CD pipeline to automatically check for outdated actions on every pull request. This helps maintain security and ensures your team stays aware of available updates.

<details>
<summary>Create <code>.github/workflows/check-actions-updates.yml</code>.</summary>

````yaml
name: Check for outdated GitHub Actions
on:
  pull_request:
    types: [edited, opened, synchronize, reopened]

jobs:
  check-actions:
    name: Check for GHA updates
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install actions-up
        run: npm install -g actions-up

      - name: Run actions-up check
        id: actions-check
        run: |
          echo "## GitHub Actions Update Check" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY

          # Initialize variables
          HAS_UPDATES=false
          UPDATE_COUNT=0

          # Run actions-up and capture output
          echo "Running actions-up to check for updates..."
          actions-up --dry-run > actions-up-raw.txt 2>&1 || true

          # Parse the output to detect updates
          if grep -q "→" actions-up-raw.txt; then
            HAS_UPDATES=true
            # Count the number of updates (lines with arrows)
            UPDATE_COUNT=$(grep -c "→" actions-up-raw.txt || echo "0")
          fi

          # Create formatted output
          if [ "$HAS_UPDATES" = true ]; then
            echo "Found $UPDATE_COUNT GitHub Actions with available updates" >> $GITHUB_STEP_SUMMARY
            echo "" >> $GITHUB_STEP_SUMMARY
            echo "<details>" >> $GITHUB_STEP_SUMMARY
            echo "<summary>Click to see details</summary>" >> $GITHUB_STEP_SUMMARY
            echo "" >> $GITHUB_STEP_SUMMARY
            echo '```' >> $GITHUB_STEP_SUMMARY
            cat actions-up-raw.txt >> $GITHUB_STEP_SUMMARY
            echo '```' >> $GITHUB_STEP_SUMMARY
            echo "</details>" >> $GITHUB_STEP_SUMMARY

            # Create detailed markdown report with better formatting
            {
              echo "## GitHub Actions Update Report"
              echo ""

              echo "### Summary"
              echo "- **Updates available:** $UPDATE_COUNT"
              echo ""

              # See the raw output above for details.
              echo "### How to Update"
              echo ""
              echo "You have several options to update these actions:"
              echo ""
              echo "#### Option 1: Automatic Update (Recommended)"
              echo '```bash'
              echo "# Run this command locally in your repository"
              echo "npx actions-up"
              echo '```'
              echo ""
              echo "#### Option 2: Manual Update"
              echo "1. Review each update in the table above"
              echo "2. For breaking changes, click the Release Notes link to review changes"
              echo "3. Edit the workflows and update the version numbers"
              echo "4. Test the changes in your CI/CD pipeline"
              echo ""
              echo "---"
              echo ""
              echo "<details>"
              echo "<summary>Raw actions-up output</summary>"
              echo ""
              echo '```'
              cat actions-up-raw.txt
              echo '```'
              echo "</details>"
            } > actions-up-report.md

            echo "has-updates=true" >> $GITHUB_OUTPUT
            echo "update-count=$UPDATE_COUNT" >> $GITHUB_OUTPUT
          else
            echo "All GitHub Actions are up to date!" >> $GITHUB_STEP_SUMMARY

            {
              echo "## GitHub Actions Update Report"
              echo ""
              echo "### All GitHub Actions in this repository are up to date!"
              echo ""
              echo "No action required. Your workflows are using the latest versions of all GitHub Actions."
            } > actions-up-report.md

            echo "has-updates=false" >> $GITHUB_OUTPUT
            echo "update-count=0" >> $GITHUB_OUTPUT
          fi

      - name: Comment PR with updates
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('actions-up-report.md', 'utf8');
            const hasUpdates = '${{ steps.actions-check.outputs.has-updates }}' === 'true';
            const updateCount = '${{ steps.actions-check.outputs.update-count }}';

            // Check if we already commented
            const comments = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number
            });

            const botComment = comments.data.find(comment =>
              comment.user.type === 'Bot' &&
              comment.body.includes('GitHub Actions Update Report')
            );

            const commentBody = `${report}

            ---
            *Generated by [actions-up](https://github.com/azat-io/actions-up) | Last check: ${new Date().toISOString()}*`;

            // Only comment if there are updates or if we previously commented
            if (hasUpdates || botComment) {
              if (botComment) {
                // Update existing comment
                await github.rest.issues.updateComment({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  comment_id: botComment.id,
                  body: commentBody
                });
                console.log('Updated existing comment');
              } else {
                // Create new comment only if there are updates
                await github.rest.issues.createComment({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: context.issue.number,
                  body: commentBody
                });
                console.log('Created new comment');
              }
            } else {
              console.log('No updates found and no previous comment exists - skipping comment');
            }

            // Add or update PR labels based on status
            const labels = await github.rest.issues.listLabelsOnIssue({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number
            });

            const hasOutdatedLabel = labels.data.some(label => label.name === 'outdated-actions');

            if (hasUpdates && !hasOutdatedLabel) {
              // Add label if updates are found
              try {
                await github.rest.issues.addLabels({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: context.issue.number,
                  labels: ['outdated-actions']
                });
                console.log('Added outdated-actions label');
              } catch (error) {
                console.log('Could not add label (might not exist in repo):', error.message);
              }
            } else if (!hasUpdates && hasOutdatedLabel) {
              // Remove label if no updates
              try {
                await github.rest.issues.removeLabel({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: context.issue.number,
                  name: 'outdated-actions'
                });
                console.log('Removed outdated-actions label');
              } catch (error) {
                console.log('Could not remove label:', error.message);
              }
            }

      - name: Fail if outdated actions found
        if: steps.actions-check.outputs.has-updates == 'true'
        run: |
          echo "::error:: Found ${{ steps.actions-check.outputs.update-count }} outdated GitHub Actions. Please update them before merging."
          echo ""
          echo "You can update them by running: npx actions-up"
          echo "Or manually update the versions in your workflows."
          exit 1
````

</details>

### Scheduled Checks

You can also set up scheduled checks to stay informed about updates:

```yaml
name: Weekly Actions Update Check

on:
  schedule:
    - cron: '0 9 * * 1' # Every Monday at 9 AM
  workflow_dispatch: # Allow manual triggers

jobs:
  check-updates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g actions-up
      - run: |
          if actions-up --dry-run | grep -q "→"; then
            echo "Updates available! Run 'npx actions-up' to update."
            exit 1
          fi
```

## Example

### Regular Actions

```yaml
# Before
- uses: actions/checkout@v3
- uses: actions/setup-node@v3

# After running actions-up
- uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5.0.0
- uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
```

### Reusable Workflows

Actions Up also detects and updates reusable workflow calls:

```yaml
# Before
jobs:
  call-workflow:
    uses: org/repo/.github/workflows/ci.yml@v1.0.0
    with:
      config: production

# After running actions-up
jobs:
  call-workflow:
    uses: org/repo/.github/workflows/ci.yml@a1b2c3d4e5f6 # v2.0.0
    with:
      config: production
```

## Advanced Usage

### Using GitHub Token for Higher Rate Limits

While Actions Up works without authentication, providing a GitHub token increases API rate limits from 60 to 5000 requests per hour, useful for large projects:

[Create a GitHub Personal Access Token](https://github.com/settings/tokens/new?scopes=public_repo&description=actions-up).

- For public repositories: Select `public_repo` scope
- For private repositories: Select `repo` scope

Set the token as an environment variable:

```bash
export GITHUB_TOKEN=your_token_here
npx actions-up
```

Or in GitHub Actions:

```yaml
- name: Check for updates
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: npx actions-up --dry-run
```

### Skipping Updates

Skip updates using CLI excludes and YAML ignore comments. Excludes run first, then ignore comments.

#### CLI Excludes

Skip actions by name using regular expressions. Patterns are matched against the full action name (`owner/repo[/path]`).

- Repeatable flag: `--exclude <regex>` (can be used multiple times)
- Comma-separated list is supported inside a single flag
- Forms:
  - Plain string compiled as case-insensitive regex: `my-org/.*`
  - Literal with flags: `/^actions\/internal-.+$/i`

Examples:

```bash
npx actions-up --exclude "my-org/.*"
npx actions-up --exclude ".*/internal-.*" --exclude "/^acme\/.+$/i"
# or
npx actions-up --exclude "my-org/.*, .*/internal-.*"
```

#### Ignore Comments

You can skip specific actions or files using YAML comments. Ignored items are hidden in dry-run and interactive modes and are not updated with `--yes`.

- Ignore whole file: `# actions-up-ignore-file`
- Block ignore: `# actions-up-ignore-start` … `# actions-up-ignore-end`
- Next line: `# actions-up-ignore-next-line`
- Inline on the same line: append `# actions-up-ignore`

Example:

```yaml
# actions-up-ignore-file

# actions-up-ignore-next-line
- uses: actions/checkout@v3

- uses: actions/setup-node@v3 # actions-up-ignore

# actions-up-ignore-start
- uses: actions/cache@v3
# actions-up-ignore-end
```

## Security

Actions Up promotes security best practices:

- **SHA pinning**: Uses commit SHA instead of mutable tags
- **Version comment**: Adds the released version next to the pinned SHA for readability
- **No Auto-Updates**: Full control over what gets updated
- **Breaking Change Warnings**: Alerts you to major version updates that may require configuration changes

## CI/CD Best Practices

When using Actions Up in your CI/CD pipeline:

1. **Start with warnings**: Begin by running checks without failing builds to gauge the update frequency
2. **Regular updates**: Schedule weekly or monthly update PRs rather than blocking every PR
3. **Team education**: Ensure your team understands the security benefits of keeping actions updated
4. **Gradual adoption**: Roll out to a few repositories first before organization-wide deployment

## Contributing

See [Contributing Guide](https://github.com/azat-io/actions-up/blob/main/contributing.md).

## License

MIT &copy; [Azat S.](https://azat.io)
