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

Chrome extension that overlays self-hosted [Dreeve](https://github.com/dreeveapp/dreeve) heatmap routes (and explorer tiles) on gpx.studio, studio.wanderstories.space, and the OpenStreetMap iD editor. Built-in hosts are listed in `manifest.json` `content_scripts`; other http(s) MapLibre/Mapbox pages can be opted in via popup **Enable on this site** (`siteEnabledByOrigin` in `chrome.storage.sync`).

- Routes: **Dreeve v5.3.0+**, `/api/internal/heatmap/routes`
- Explorer tiles: **Dreeve v5.6.0+**, `/api/internal/heatmap/tiles` (derived from the routes URL; MapLibre GL JS and Mapbox GL JS hosts only — not OSM iD)
- Tile math lives in `src/explorer-tiles.js` (injected before `page-bridge.js`). Layer toggles: `showRoutes` / `showTiles` in `chrome.storage.sync`. On OSM, the popup disables **Show tiles** and does not overwrite the stored preference.
- MapLibre/Mapbox LOD (`src/page-bridge.js`): below zoom 10 omit `visited` tile fills (keep clusters/max-square); routes only draw at zoom ≥ 11 when **Show routes** is on. Zoom-band route simplify (200 / 800 / 2000 points) and padded-viewport `setData` filtering on debounced `zoomend`/`moveend`. Full dataset stays in memory (no refetch).
- Social preview / README hero image: `.github/assets/social-preview.png`, generated from `social-preview.html` in the same folder (headless Chrome command in the file header). Re-render it if the supported hosts or tagline change; upload it under the repo **Settings → Social preview** on GitHub.

### Dreeve heatmap API shape (as of Dreeve master)

Both internal heatmap endpoints are **full-dataset** `GET`s with **no bbox/zoom query parameters**:

| Endpoint                       | Dreeve handler                | Server behavior                                          |
| ------------------------------ | ----------------------------- | -------------------------------------------------------- |
| `/api/internal/heatmap/routes` | `HeatmapRoutesRequestHandler` | `RouteRepository::findAll()`; cache key `heatmap.routes` |
| `/api/internal/heatmap/tiles`  | `HeatmapTilesRequestHandler`  | all activity→tile IDs; cache key `heatmap.tiles`         |

Dreeve’s own heatmap page (`public/js/features/heatmap/heatmap.js`) also fetches the full routes JSON once and filters client-side. Do **not** teach this extension to request by viewport until Dreeve adds parameterized APIs (and cache keys that include those params). Track: plugin [#31](https://github.com/Luen/dreeve-heatmap-plugin/issues/31).

### Upstream endpoint lifecycle and internal API contract

The endpoints used by this extension (`/api/internal/heatmap/routes` and `/api/internal/heatmap/tiles`) are internal to Dreeve's own UI and are unversioned.

Upstream maintainers explicitly clarified this boundary when declining server-side conditional request (`ETag` / `If-None-Match`) support ([dreeveapp/dreeve#3064](https://github.com/dreeveapp/dreeve/issues/3064)):

> _"The `/api/internal/*` endpoints are internal to Dreeve's own UI. They're unversioned and may change or move without notice, so we don't add features to support external tools on top of them._
>
> _If there's a real need for heatmap data outside the app, that would belong in the public `/api/v1` API. And even there, clients that consume the API are responsible for handling when they call the API and expect a response and when they don't."_

Key architectural implications for this extension:

1. **No public heatmap API exists in Dreeve:** An audit of Dreeve's `/api/v1/*` routes confirmed there are no public endpoints providing heatmap routes or explorer tiles. `/api/v1/activities` is paginated, requires `DREEVE_API_KEY` token auth, and does not aggregate tiles or full heatmap route polylines. `/api/internal/*` remains the only practical data source.
2. **Handle caching and revalidation entirely client-side:** Do not assume standard Dreeve servers will emit `ETag` or respond with `304 Not Modified`. The extension's background fetcher maintains an in-memory and `chrome.storage.session` TTL cache (20 minutes) and sends `If-None-Match` opportunistically, but clients must handle full downloads gracefully without expecting server-side revalidation guarantees.
3. **Adapt to unversioned endpoint changes:** Because `/api/internal/*` is unversioned and may change or move across Dreeve releases without notice (as occurred in previous migrations from `/api/fragment/data/heatmap/routes` to `/api/heatmap/routes.json` to `/api/internal/heatmap/routes`), this extension owns updating endpoint paths and response normalization client-side whenever Dreeve reorganizes internal routes. Track: plugin [#53](https://github.com/Luen/dreeve-heatmap-plugin/issues/53).

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
- Per-site helpers shared by the popup and background live in `src/site-access.js` (ES module: built-in hosts, `CONTENT_SCRIPT_FILES`, `siteEnabledByOrigin` parsing). When a custom site is enabled, the background registers a persistent content script for it (`chrome.scripting.registerContentScripts`, IDs prefixed `dreeve-site:`) and unregisters it when disabled; it reconciles on install, startup and `siteEnabledByOrigin` changes. `src/content-script.js` keeps its own copy of the built-in host list (classic script). Update `CONTENT_SCRIPT_FILES` and the manifest `content_scripts` together.
- Route filtering and normalization live in `src/route-normalize.js` (`globalThis.DreeveRouteNormalize`, no extension APIs). The content script loads it first (manifest and popup `executeScript`), and the Web Worker is built from it plus `src/normalize-routes-worker.js` as one `blob:` script, so the worker and the chunked main-thread fallback cannot drift apart. Keep new filter rules in that module.
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
