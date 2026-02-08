import { defineConfig } from 'cspell'

export default defineConfig({
  words: [
    'azat',
    'changelogen',
    'changelogithub',
    'commitish',
    'crosspost',
    'gitea',
    'humanwhocodes',
    'nanospinner',
    'oauthtoken',
    'octocat',
    'premajor',
    'preminor',
    'prepatch',
    'pipefail',
    'rcompare',
    'rolldown',
    'segs',
    'zipball',
  ],
  ignorePaths: [
    '.github',
    'changelog.md',
    'license',
    'pnpm-lock.yaml',
    'tsconfig.json',
  ],
  dictionaries: ['css', 'html', 'node', 'npm', 'typescript'],
  useGitignore: true,
  language: 'en',
})
