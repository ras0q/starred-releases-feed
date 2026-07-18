# Contributing

[![Cute compatible](https://raw.githubusercontent.com/ras0q/cute/refs/heads/main/badge.svg)](https://github.com/ras0q/cute)

Follow the shared
[contribution guidelines](https://github.com/ras0q/.github/blob/main/CONTRIBUTING.md)
first.

## Setup

```sh
git config core.hooksPath .githooks
```

## Development

Use Deno to format, lint, type-check, test, and bundle the Action.

```sh
deno task fix
deno task test
deno task build:action
```

`deno task build:action` regenerates the committed ESM Action bundle in `dist/`.
Run it whenever changing the Action or sync source.

### Sync locally

Set `GITHUB_TOKEN` to a PAT that can read your starred repositories and their
releases. Optional environment variables:

- `STATE_PATH` (default: `state.json`)
- `FEED_PATH` (default: `starred-releases.atom`)
- `FEED_URL` (public feed URL used in Atom links)
- `MAX_RUNTIME_MINUTES` (default: `10`)
- `MIN_REMAINING_POINTS` (default: `100`)
- `INCLUDE_PRERELEASES` / `INCLUDE_DRAFTS` (`true` or `false`)

Then run:

```sh
deno task sync
```
