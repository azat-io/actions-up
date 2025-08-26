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

- **Auto-discovery** - Scans all workflows (`.github/workflows/*.yml`) and composite actions (`.github/actions/*/action.yml`)
- **SHA Pinning** - Updates actions to use commit SHA instead of tags for better security
- **Batch Updates** - Update multiple actions at once
- **Interactive Selection** - Choose which actions to update
- **Breaking Changes Detection** - Warns about major version updates
- **Fast & Efficient** - Parallel processing with optimized API calls

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
    alt="Token Limit CLI Example"
    width="600"
  />
</picture>

## Installation

```bash
npm install -g actions-up
```

Or use directly with npx:

```bash
npx actions-up
```

## Usage

### Interactive Mode (Default)

Run in your repository root:

```bash
actions-up
```

This will:

1. Scan all `.github/workflows/*.yml` and `.github/actions/*/action.yml` files
2. Check for available updates
3. Show an interactive list to select updates
4. Apply selected updates with SHA pinning

### Auto-Update Mode

Skip all prompts and update everything:

```bash
actions-up --yes
# or
actions-up -y
```

### With GitHub Token

To avoid rate limits [create a GitHub personal access token](https://github.com/settings/tokens/new?scopes=public_repo&description=actions-up) and set it as an environment variable:

```bash
GITHUB_TOKEN=ghp_xxxx actions-up
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

## Configuration

### Environment Variables

- `GITHUB_TOKEN` - GitHub personal access token for API requests (optional but recommended)

## Security

Actions Up promotes security best practices:

- **SHA Pinning**: Uses commit SHA instead of mutable tags
- **Version Comments**: Adds version as comment for readability
- **No Auto-Updates**: Full control over what gets updated

## Contributing

See [Contributing Guide](https://github.com/azat-io/actions-up/blob/main/contributing.md).

## License

MIT &copy; [Azat S.](https://azat.io)
