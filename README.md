# Starred Releases Feed

This repository provides a GitHub Action that scans repositories you have
starred on GitHub, aggregates their releases by UTC day, and publishes a thin
Atom feed. The TypeScript source is bundled with Deno; callers run only the
committed Node 24 ESM bundle.

Each feed item covers one sealed UTC day and lists `owner/repo@tag` links. Draft
and prerelease versions are excluded by default. The Action can stop early when
a runtime or GraphQL rate-limit threshold is reached and resume on the next
scheduled run.

## Private repository setup

1. Create a repository (often named `<username>.github.io`) to host the feed on
   GitHub Pages.
2. Add a PAT with permission to read your starred repositories and their
   releases as a repository secret named `GH_PAT`.
3. Create `.github/workflows/starred-releases-feed.yml` with the workflow below.
   Pin `ras0q/starred-releases-feed` to a release tag or commit SHA before
   enabling scheduled runs.
4. Enable GitHub Pages from the `gh-pages` branch root.

```yaml
name: Starred Releases Feed

on:
  schedule:
    - cron: "0 */4 * * *"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: starred-releases-feed
  cancel-in-progress: false

jobs:
  feed:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: gh-pages
          path: pages

      - name: Update feed
        uses: ras0q/starred-releases-feed@<tag-or-sha>
        with:
          token: ${{ secrets.GH_PAT }}
          state-path: pages/state.json
          feed-path: pages/feed.atom
          feed-url: https://<username>.github.io/feed.atom
          max-runtime-minutes: 10
          min-remaining-points: 100

      - name: Publish gh-pages
        working-directory: pages
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add feed.atom state.json
          git diff --staged --quiet || git commit -m "Update starred releases feed"
          git push origin gh-pages
```

If the `gh-pages` branch does not exist yet, initialize it once before the first
scheduled run:

```sh
git checkout --orphan gh-pages
git rm -rf .
echo "# gh-pages" > README.md
git add README.md
git commit -m "Initialize gh-pages"
git push origin gh-pages
```

## Action inputs

| Input                  | Default      | Description                                 |
| ---------------------- | ------------ | ------------------------------------------- |
| `token`                | required     | PAT for starred repositories and releases   |
| `state-path`           | `state.json` | Scan and feed state file                    |
| `feed-path`            | `feed.atom`  | Generated Atom feed path                    |
| `feed-url`             | example URL  | Public feed URL for Atom links              |
| `max-runtime-minutes`  | `10`         | Stop scanning after this many minutes       |
| `min-remaining-points` | `100`        | Stop when GraphQL points fall to this level |
| `include-prereleases`  | `false`      | Include prerelease versions                 |
| `include-drafts`       | `false`      | Include draft releases                      |

## Local development

See [CONTRIBUTING.md](CONTRIBUTING.md).

```sh
git config core.hooksPath .githooks
deno task fix
deno task test
deno task build:action
```

Set `GITHUB_TOKEN` to a PAT and run:

```sh
deno task sync
```

## Seal policy

- The Action may run every few hours, but readers see at most one new item per
  UTC day.
- Today (UTC) is never published; a day is sealed once it is strictly before
  today.
- Sealed days are not rewritten, even if a late release is discovered later.
- Only the latest seven sealed days appear in the feed.
