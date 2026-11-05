# AGENTS.md

Agent-focused guidance for this repository ([AGENTS.md format](https://agents.md/)). Human-facing docs live in `README.md`.

## Living document

Treat this file as **living documentation**. Update it in the same PR when the stack, scripts, branch model, deploy path, or other project facts change. Future agents should keep it accurate rather than leaving stale instructions.

## Branch model

| Branch | Role                                                     |
| ------ | -------------------------------------------------------- |
| `dev`  | Default branch for features and improvements             |
| `main` | Production. Safe dependency bumps and releases land here |

- Open feature/fix PRs against **`dev`**.
- Promote to **`main`** when ready for production.
- Do not use `master` (rename to `main` if any remnant remains).

### Keeping `dev` and `main` in sync (Back-merge rule)

- **Never leave `main` ahead of `dev`.** Whenever `dev` is promoted to `main` (via merge commit or release PR) or when automated nightly dependency workflows commit directly to `main`, immediately back-merge `main` into `dev` so both branches share the same history and future PRs do not conflict on `package.json` or lockfiles.
- Verify sync status:
  ```bash
  git fetch origin && git rev-list --left-right --count origin/dev...origin/main
  # Expected after sync: 0	0
  ```
- Back-merge `main` into `dev`:
  ```bash
  git checkout dev && git merge origin/main --no-edit && git push origin dev
  ```

## Releases

Before creating a GitHub release:

1. Land the release work on **`dev`** (merged PRs, version bump in `manifest.json` and `package.json`).
2. **Merge `dev` into `main`** and push `main`. Do not tag or publish a release from `dev` alone.
3. Create the GitHub release / tag **from `main`** (for example `gh release create vX.Y.Z --target main`).

## Dependency and deploy notes

### Tier C - Branches + agent docs

- No nightly Docker dependency-release workflow in this PR.
- Use `dev` for features and `main` for production when applicable.

## Project overview

Chrome extension that overlays self-hosted [Dreeve](https://github.com/dreeveapp/dreeve) heatmap routes (and explorer tiles) on gpx.studio, studio.wanderstories.space, and the OpenStreetMap iD editor.

- Routes: **Dreeve v5.3.0+**, `/api/internal/heatmap/routes`
- Explorer tiles: **Dreeve v5.6.0+**, `/api/internal/heatmap/tiles` (derived from the routes URL; MapLibre GL JS and Mapbox GL JS hosts only — not OSM iD)
- Tile math lives in `src/explorer-tiles.js` (injected before `page-bridge.js`). Layer toggles: `showRoutes` / `showTiles` in `chrome.storage.sync`. On OSM, the popup disables **Show tiles** and does not overwrite the stored preference.

## Setup and checks

```bash
npm install
npm run format:check
npm run lint
npm run check            # format:check + lint
```

After edits: `npm run format` and `npm run lint:fix` as needed. Code must pass Prettier and ESLint before finishing.

## Conventions

- ESLint 10 flat config; Prettier for format. Do not add a second formatter.
- Prefer **DRY** (Don't Repeat Yourself): share helpers and overlay logic across MapLibre / Mapbox / iD adapters instead of copying near-identical blocks.
- When touching duplicated or brittle code, **refactor for maintainability** in the same change when the risk is low and the scope stays focused. Prefer small extract/consolidate steps over drive-by rewrites.
- Do not restore dropped support for old Dreeve heatmap endpoints.
- Never commit secrets.

## Filing issues (AI agents)

When you notice problems or opportunities that are **out of scope** for the current task, open a GitHub issue (via `gh issue create`) rather than ignoring them or expanding the PR without asking. Typical candidates:

- Bugs or incorrect behavior
- UX gaps or misleading UI
- Performance improvements (redraw cost, payload size, caching, SVG/DOM pressure, etc.)
- Refactor targets (duplication, oversized files, unclear boundaries between adapters)
- Docs or test gaps that would help future work

Before creating an issue: search existing open issues for duplicates. Keep the title specific; include where you saw it (file/path or host), why it matters, and a short suggested direction when useful. Do not file issues for speculative or cosmetic noise.

## Pull requests

Before merging any pull request:

1. **Read all comments** on the PR — conversation comments, review comments (including those on specific lines), and bot comments. Address or acknowledge them. Do not merge while review feedback is unresolved.
2. **Wait for CI to complete successfully.** GitHub Actions (and other required checks) on the PR must finish and pass. Do not merge while checks are pending, failed, cancelled, or skipped when they are required. If CI fails, fix the cause and wait for a green run before merging.

## Major-version dependency updates & migration checks

When reviewing or merging **major-version** Dependabot or package updates:

1. **Read the upstream migration guide / changelog** before merging. Do not rely solely on a passing container build (`docker build` only verifies `install`, not runtime execution paths).
2. **Verify exports and constructors at runtime:**
   - Check whether default exports moved to named exports (e.g., `pbf` v5 exporting `{ PbfReader, PbfWriter }` instead of a default constructor) or factory functions became ES classes requiring `new` (e.g., `geojson-vt` v5).
   - Check framework route syntax and middleware compatibility (e.g., Express 5 path-to-regexp rules, React peer dependency alignment across `@types/react` and `@types/react-dom`).
   - For Python lockfile repos (`uv pip compile`), always recompile `requirements.lock` and `requirements-dev.lock` when `requirements.txt` ranges change so `uv pip sync` and nightly constrained upgrades stay consistent.
3. **Regenerate lockfiles with the repo's pinned package manager** (e.g., `pnpm@10.33.0`, `pnpm@12.15.0`, `npm`, or `uv==0.13.7`) when rebasing or combining multiple dependency PRs.
4. **Run a runtime smoke test** (lint, unit tests, module import check, and endpoint/container health check) before promoting to `main` and publishing a release.
