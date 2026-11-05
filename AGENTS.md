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

### Dreeve heatmap API shape (as of Dreeve master)

Both internal heatmap endpoints are **full-dataset** `GET`s with **no bbox/zoom query parameters**:

| Endpoint                       | Dreeve handler                | Server behavior                                          |
| ------------------------------ | ----------------------------- | -------------------------------------------------------- |
| `/api/internal/heatmap/routes` | `HeatmapRoutesRequestHandler` | `RouteRepository::findAll()`; cache key `heatmap.routes` |
| `/api/internal/heatmap/tiles`  | `HeatmapTilesRequestHandler`  | all activity→tile IDs; cache key `heatmap.tiles`         |

Dreeve’s own heatmap page (`public/js/features/heatmap/heatmap.js`) also fetches the full routes JSON once and filters client-side. Do **not** teach this extension to request by viewport until Dreeve adds parameterized APIs (and cache keys that include those params). Track: plugin [#31](https://github.com/Luen/dreeve-heatmap-plugin/issues/31).

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
