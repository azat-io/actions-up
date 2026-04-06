# Changelog

## v1.12.1

[compare changes](https://github.com/azat-io/actions-up/compare/v1.12.0...v1.12.1)

### 🐞 Bug Fixes

- Resolve release shas from tags
  ([29ad621](https://github.com/azat-io/actions-up/commit/29ad621))

### ❤️ Contributors

- Tifan Dwi Avianto ([@tifandotme](https://github.com/tifandotme))

## v1.12.0

[compare changes](https://github.com/azat-io/actions-up/compare/v1.11.0...v1.12.0)

### 🚀 Features

- Resolve compatible updates for mode-blocked actions
  ([ee799ba](https://github.com/azat-io/actions-up/commit/ee799ba))
- Use current directory as default in recursive mode
  ([7f6ee1d](https://github.com/azat-io/actions-up/commit/7f6ee1d))

### 🐞 Bug Fixes

- Support scanning from parent and external directories
  ([abb8c26](https://github.com/azat-io/actions-up/commit/abb8c26))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.11.0

[compare changes](https://github.com/azat-io/actions-up/compare/v1.10.1...v1.11.0)

### 🚀 Features

- Support multiple dir flags and recursive scanning
  ([9a50261](https://github.com/azat-io/actions-up/commit/9a50261))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.10.1

[compare changes](https://github.com/azat-io/actions-up/compare/v1.10.0...v1.10.1)

### 🐞 Bug Fixes

- Fall back to tags when release tag is not semver-like
  ([595fa30](https://github.com/azat-io/actions-up/commit/595fa30))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.10.0

[compare changes](https://github.com/azat-io/actions-up/compare/v1.9.0...v1.10.0)

### 🚀 Features

- Add update mode filtering
  ([f18546f](https://github.com/azat-io/actions-up/commit/f18546f))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.9.0

[compare changes](https://github.com/azat-io/actions-up/compare/v1.8.0...v1.9.0)

### 🚀 Features

- Scan root action.yml composite actions
  ([ece7a1f](https://github.com/azat-io/actions-up/commit/ece7a1f))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.8.0

[compare changes](https://github.com/azat-io/actions-up/compare/v1.7.0...v1.8.0)

### 🚀 Features

- Support json-style yaml workflow files
  ([fd2cabd](https://github.com/azat-io/actions-up/commit/fd2cabd))

### 🐞 Bug Fixes

- Apply min-age filter in interactive mode
  ([d39eaaa](https://github.com/azat-io/actions-up/commit/d39eaaa))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.7.0

[compare changes](https://github.com/azat-io/actions-up/compare/v1.6.0...v1.7.0)

### 🚀 Features

- Warn about skipped branch refs and add opt-in to check
  ([52ea4b4](https://github.com/azat-io/actions-up/commit/52ea4b4))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.6.0

[compare changes](https://github.com/azat-io/actions-up/compare/v1.5.0...v1.6.0)

### 🚀 Features

- Show job name in action update list
  ([4854644](https://github.com/azat-io/actions-up/commit/4854644))
- Add reusable workflow support
  ([8ef9215](https://github.com/azat-io/actions-up/commit/8ef9215))
- Align version columns in update selection table
  ([02b34b2](https://github.com/azat-io/actions-up/commit/02b34b2))
- Filter updates by release age
  ([8a77b91](https://github.com/azat-io/actions-up/commit/8a77b91))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))
- James Smith <james@smithjw.me>

## v1.5.0

[compare changes](https://github.com/azat-io/actions-up/compare/v1.4.2...v1.5.0)

### 🚀 Features

- Add support for custom ci directory
  ([26d7d35](https://github.com/azat-io/actions-up/commit/26d7d35))

### ❤️ Contributors

- Eduard Aksamitov ([@euaaaio](https://github.com/euaaaio))

## v1.4.2

[compare changes](https://github.com/azat-io/actions-up/compare/v1.4.1...v1.4.2)

### 🐞 Bug Fixes

- Clear terminal artifacts when cancelling selection
  ([9f895b1](https://github.com/azat-io/actions-up/commit/9f895b1))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.4.1

[compare changes](https://github.com/azat-io/actions-up/compare/v1.4.0...v1.4.1)

### 🐞 Bug Fixes

- Preserve inline comments after updates
  ([eec8f82](https://github.com/azat-io/actions-up/commit/eec8f82))
- Prevent duplicate version suffix when pinning overlapping tags
  ([46ce518](https://github.com/azat-io/actions-up/commit/46ce518))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.4.0

[compare changes](https://github.com/azat-io/actions-up/compare/v1.3.1...v1.4.0)

### 🚀 Features

- Support ignore comments to skip updates
  ([ef7b14c](https://github.com/azat-io/actions-up/commit/ef7b14c))
- Add regex-based excludes
  ([d653288](https://github.com/azat-io/actions-up/commit/d653288))

### 🐞 Bug Fixes

- Clarify rate-limit error
  ([87843fe](https://github.com/azat-io/actions-up/commit/87843fe))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.3.1

[compare changes](https://github.com/azat-io/actions-up/compare/v1.3.0...v1.3.1)

### 🐞 Bug Fixes

- Prefer highest version from releases and tags
  ([7da9ba9](https://github.com/azat-io/actions-up/commit/7da9ba9))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.3.0

[compare changes](https://github.com/azat-io/actions-up/compare/v1.2.1...v1.3.0)

### 🚀 Features

- Add colored version diff display
  ([19a502a](https://github.com/azat-io/actions-up/commit/19a502a))
- Show version for pinned shas
  ([f6f994e](https://github.com/azat-io/actions-up/commit/f6f994e))

### 🏎 Performance Improvements

- Reduce github api requests
  ([7cf1b42](https://github.com/azat-io/actions-up/commit/7cf1b42))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.2.1

[compare changes](https://github.com/azat-io/actions-up/compare/v1.2.0...v1.2.1)

### 🐞 Bug Fixes

- Resolve release sha via tag refs
  ([261db03](https://github.com/azat-io/actions-up/commit/261db03))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.2.0

[compare changes](https://github.com/azat-io/actions-up/compare/v1.1.1...v1.2.0)

### 🚀 Features

- Add fallback to tags when no releases found
  ([9e87ac1](https://github.com/azat-io/actions-up/commit/9e87ac1))
- Support same-repo composite actions
  ([38e3b5a](https://github.com/azat-io/actions-up/commit/38e3b5a))
- Suggest pinning equal tags to latest sha
  ([cd172b3](https://github.com/azat-io/actions-up/commit/cd172b3))
- Auto-resolve github token
  ([8358f6e](https://github.com/azat-io/actions-up/commit/8358f6e))

### 🐞 Bug Fixes

- Remove unnecessary warning
  ([1770068](https://github.com/azat-io/actions-up/commit/1770068))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.1.1

[compare changes](https://github.com/azat-io/actions-up/compare/v1.1.0...v1.1.1)

### 🏎 Performance Improvements

- Migrate from octokit sdk to native fetch
  ([9be76fe](https://github.com/azat-io/actions-up/commit/9be76fe))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.1.0

[compare changes](https://github.com/azat-io/actions-up/compare/v1.0.0...v1.1.0)

### 🚀 Features

- Migrate github api client to rest api
  ([c3105b1](https://github.com/azat-io/actions-up/commit/c3105b1))
- Add dry run mode
  ([097c16b](https://github.com/azat-io/actions-up/commit/097c16b))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v1.0.0

[compare changes](https://github.com/azat-io/actions-up/compare/v0.1.0...v1.0.0)

### 🐞 Bug Fixes

- Prevent regexp injection in action updates
  ([8ec02eb](https://github.com/azat-io/actions-up/commit/8ec02eb))
- Prevent path traversal in github actions scanning
  ([9135cca](https://github.com/azat-io/actions-up/commit/9135cca))

### ❤️ Contributors

- Azat S. ([@azat-io](https://github.com/azat-io))

## v0.1.0

### 🔥️️ Initial Release
