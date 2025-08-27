# Actions Up!

<img
  src="https://raw.githubusercontent.com/azat-io/actions-up/main/assets/logo.svg"
  alt="Actions Up! logo"
  width="160"
  height="160"
  align="right"
/>

[![Version](https://img.shields.io/npm/v/actions-up.svg?color=fff&labelColor=4493f8)](https://npmjs.com/package/actions-up)
[![Code Coverage](https://img.shields.io/codecov/c/github/azat-io/actions-up.svg?color=fff&labelColor=4493f8)](https://codecov.io/gh/azat-io/actions-up)
[![GitHub License](https://img.shields.io/badge/license-MIT-232428.svg?color=fff&labelColor=4493f8)](https://github.com/azat-io/actions-up/blob/main/license.md)

Actions Up scans your workflows and composite actions to discover every referenced GitHub Action, then checks for newer releases.

Interactively upgrade and pin actions to exact commit SHAs for secure, reproducible CI and low‑friction maintenance.

## Features

- **Auto-discovery**: Scans all workflows (`.github/workflows/*.yml`) and composite actions (`.github/actions/*/action.yml`)
- **SHA Pinning**: Updates actions to use commit SHA instead of tags for better security
- **Batch Updates**: Update multiple actions at once
- **Interactive Selection**: Choose which actions to update
- **Breaking Changes Detection**: Warns about major version updates
- **Fast & Efficient**: Parallel processing with optimized API calls

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
    alt="Actions Up interactive example"
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

## Example

```yaml
# Before
- uses: actions/checkout@v3
- uses: actions/setup-node@v3

# After running actions-up
- uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5.0.0
- uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
```

## Advanced Usage

### Using GitHub Token for Higher Rate Limits

While Actions Up works without authentication, providing a GitHub token increases API rate limits from 60 to 5000 requests per hour, useful for large projects:

[Create a GitHub Personal Access Token](https://github.com/settings/tokens/new?scopes=public_repo&description=actions-up).

- For public repositories: Select `public_repo` scope
- For private repositories: Select `repo` scope

## Security

Actions Up promotes security best practices:

- **SHA Pinning**: Uses commit SHA instead of mutable tags
- **Version Comments**: Adds version as comment for readability
- **No Auto-Updates**: Full control over what gets updated

## Contributing

See [Contributing Guide](https://github.com/azat-io/actions-up/blob/main/contributing.md).

## License

MIT &copy; [Azat S.](https://azat.io)
