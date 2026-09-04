# AGENTS.md

Agent-focused guidance for this repository ([AGENTS.md format](https://agents.md/)). Human-facing docs live in `README.md`.

Treat this file as living documentation: update it when the stack, scripts, or project facts change.

## Project overview

Chrome extension that overlays self-hosted [dreeve](https://github.com/dreeveapp/dreeve) heatmap routes on gpx.studio, studio.wanderstories.space, and the OpenStreetMap iD editor.

Requires **dreeve v5.2.0+**. Routes come from `/api/internal/fragment/data/heatmap/routes`.

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
- Keep overlay logic DRY across MapLibre / Mapbox / iD editor adapters.
- Do not restore dropped support for old dreeve heatmap endpoints.
- Never commit secrets.

## Pull requests

Before merging any pull request:

1. **Read all comments** on the PR — conversation comments, review comments (including those on specific lines), and bot comments. Address or acknowledge them. Do not merge while review feedback is unresolved.
2. **Wait for CI to complete successfully.** GitHub Actions (and other required checks) on the PR must finish and pass. Do not merge while checks are pending, failed, cancelled, or skipped when they are required. If CI fails, fix the cause and wait for a green run before merging.
