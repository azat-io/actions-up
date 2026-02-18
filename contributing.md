# Contributing

Thank you for your interest in contributing to Actions Up! This document
provides guidelines and instructions for contributing to the project.

## How to Contribute

### Reporting Issues

Before creating an issue, please check existing issues to avoid duplicates. When
creating a new issue:

1. Use a clear and descriptive title
2. Provide detailed description of the issue
3. Include steps to reproduce (if it's a bug)
4. Include expected vs actual behavior
5. Add relevant labels

### Suggesting Features

Feature requests are welcome! Please:

1. Check if the feature has already been suggested
2. Provide clear use case and motivation
3. Explain how it benefits users
4. Consider implementation complexity

### Pull Requests

1. **Fork & Clone**

   ```bash
   git clone https://github.com/your-username/actions-up.git
   cd actions-up
   ```

2. **Install Dependencies**

   ```bash
   pnpm install
   ```

3. **Create Feature Branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

4. **Make Changes**
   - Follow existing code style
   - Add/update tests as needed
   - Update documentation if required

5. **Run Tests & Checks**

   ```bash
   pnpm test          # Full suite: lint, types, unit (with coverage), etc.
   # Or target specific checks during iteration:
   pnpm test:unit     # Unit tests with coverage (Vitest)
   pnpm test:js       # ESLint
   pnpm test:types    # TypeScript type check
   pnpm test:format   # Prettier formatting check
   pnpm test:spelling # Spell check (cspell)
   ```

6. **Type, Lint, Format (optional granular run)**

   ```bash
   pnpm test:js
   pnpm test:types
   pnpm test:format
   ```

7. **Commit Changes**

   ```bash
   git commit -m "feat: add amazing feature"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `style:` Code style changes (formatting, etc)
   - `refactor:` Code refactoring
   - `test:` Test changes
   - `chore:` Build process or auxiliary tool changes
   - `perf:` Performance improvements

8. **Push & Create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

## Development Setup

### Prerequisites

- Node.js ^18 or >=20 (LTS recommended)
- pnpm 10
- Git

### Project Structure

```
actions-up/
├── bin/               # CLI launcher pointing to dist
├── cli/               # CLI entry point (TypeScript)
├── core/              # Core logic
│   ├── api/           # GitHub API client
│   ├── ast/           # AST updates and helpers
│   ├── fs/            # File system helpers
│   ├── interactive/   # Interactive prompts
│   ├── parsing/       # YAML/action parsing
│   └── schema/        # YAML schema helpers
├── test/              # Tests (Vitest)
├── types/             # Shared TypeScript types
└── assets/            # Images and media
```

### Available Scripts

```bash
# Build
pnpm build          # Build the project (Vite)

# Full test suite
pnpm test           # Runs all test:* scripts

# Focused checks
pnpm test:unit      # Unit tests with coverage (Vitest)
pnpm test:js        # ESLint
pnpm test:types     # TypeScript type check (no emit)
pnpm test:format    # Prettier formatting check
pnpm test:spelling  # Spell check (cspell)
pnpm test:usage     # Unused files/exports/deps (knip)
pnpm test:packages  # Dependency dedupe check

# Local CLI run (after build)
node bin/actions-up.js --help
```

Note: A `dev` command is not used in this repo. Build, then run the CLI via
`node bin/actions-up.js` for local testing.

## Testing Guidelines

- Write tests for new features
- Maintain or improve test coverage
- Test edge cases and error scenarios
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)

Example test:

```typescript
import { describe, expect, it } from 'vitest'
import { parseActionReference } from '../core/parsing/parse-action-reference'

describe('parseActionReference', () => {
  it('parses external action reference correctly', () => {
    // Arrange
    let reference = 'actions/checkout@v3'

    // Act
    let result = parseActionReference(reference, 'test.yml', 1)

    // Assert
    expect(result).toEqual({
      type: 'external',
      name: 'actions/checkout',
      version: 'v3',
      file: 'test.yml',
      line: 1,
    })
  })
})
```

## Code Style

### TypeScript

- Use `let` instead of `const` for variables
- Use explicit types where helpful
- Prefer early returns
- Use meaningful variable names
- Add JSDoc comments for public APIs

### Formatting

- 2 spaces for indentation
- No semicolons
- Single quotes for strings
- Trailing commas in multiline structures
- Max line length: 80 characters

### File Naming

- Kebab case for files: `check-updates.ts`

## Security

If you discover a security vulnerability:

1. **DO NOT** create a public issue
2. Email security details to the maintainer
3. Allow time for patch before disclosure

## Release Process

Maintainers handle releases using automated scripts and CI:

1. Ensure main is green: `pnpm test` and `pnpm build`
2. Run the release flow: `pnpm release`
   - Runs checks, bumps version and updates `changelog.md`
   - Commits, tags, and pushes (`vX.Y.Z`)
3. CI on tag creates a GitHub Release and publishes to npm
   - See `.github/workflows/release.yml` and `ci:*` scripts in `package.json`

No manual `npm publish` is needed locally.

## Tips

- Commit messages follow Conventional Commits. A commit-msg hook is configured
  via `simple-git-hooks`. To enable hooks locally after install, run:
  `pnpm exec simple-git-hooks`.
- Use `pnpm` v10 to ensure script features like regex runs (e.g.
  `pnpm run /^test:/`).
