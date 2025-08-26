# Contributing

Thank you for your interest in contributing to Actions Up! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct:

- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

## How to Contribute

### Reporting Issues

Before creating an issue, please check existing issues to avoid duplicates. When creating a new issue:

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

5. **Run Tests**

   ```bash
   pnpm test
   pnpm test:coverage
   ```

6. **Run Linting**

   ```bash
   pnpm lint
   pnpm typecheck
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

- Node.js 20+
- pnpm 8+
- Git

### Project Structure

```
actions-up/
├── cli/               # CLI entry point
├── core/              # Core logic
│   ├── api/          # GitHub API client
│   ├── ast/          # AST manipulation
│   ├── interactive/  # Interactive prompts
│   └── parsing/      # YAML parsing
├── test/             # Test files
├── types/            # TypeScript types
└── utils/            # Utility functions
```

### Available Scripts

```bash
# Development
pnpm dev           # Run in development mode

# Testing
pnpm test          # Run tests
pnpm test:watch    # Run tests in watch mode
pnpm test:coverage # Run tests with coverage

# Linting & Type Checking
pnpm lint          # Run ESLint
pnpm typecheck     # Run TypeScript compiler

# Build
pnpm build         # Build the project
```

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
- PascalCase for types/interfaces: `GitHubAction`
- camelCase for functions/variables: `checkUpdates`

## Security

If you discover a security vulnerability:

1. **DO NOT** create a public issue
2. Email security details to the maintainer
3. Allow time for patch before disclosure

## Release Process

Maintainers handle releases:

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create git tag
4. Publish to npm
5. Create GitHub release

## Questions?

Feel free to:

- Open a discussion on GitHub
- Ask in issues (for project-related questions)
- Contact maintainers

## Recognition

Contributors are recognized in:

- README.md contributors section
- GitHub contributors page
- Release notes for significant contributions

Thank you for contributing! 🙌
