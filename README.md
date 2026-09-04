# Dreeve Heatmap Extension

Chrome extension that overlays your self-hosted [dreeve](https://github.com/dreeveapp/dreeve) routes on:

- `https://gpx.studio/*`
- `https://studio.wanderstories.space/*`
- `https://www.openstreetmap.org/edit` (OpenStreetMap iD editor)

<img width="338" height="400" alt="Screenshot of heatmap extension" src="https://github.com/user-attachments/assets/52317c33-42aa-462a-a810-3fe12c49bac8" />

## Requirements

- **dreeve v5.2.0 or newer** ([release notes](https://github.com/dreeveapp/dreeve/releases/tag/v5.2.0))
- Support for earlier dreeve versions (including the old `/api/heatmap/routes.json` endpoint) has been dropped

Routes are loaded from dreeve’s cache-based fragment API:

`/api/fragment/data/heatmap/routes`

## What it does

- Lets the user configure a custom heatmap routes endpoint URL
- Fetches route data from your dreeve heatmap API
- Draws route polylines on the page map
- Clicking a route opens a popup with activity details and links
- Toggles overlay on/off from the extension popup
- Lets the user configure route color, opacity, and width
- Supports filtering by high-level categories (`Ride`, `Walk`, `Water`, `Winter`)
- Automatically excludes virtual activities (`VirtualRide`, `VirtualRun`)
- Supports the map engines / editors used by target sites:
    - `gpx.studio` (MapLibre GL JS)
    - `studio.wanderstories.space` (Mapbox GL JS)
    - OpenStreetMap iD editor (Background → Overlays toggle + SVG route layer)

Expected endpoint format (array of activities with `coordinates` as `[lat, lng]`):

```json
[
    {
        "id": "activity-123",
        "coordinates": [
            [-19.37, 146.64],
            [-19.38, 146.65]
        ]
    }
]
```

## Install (developer mode)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this repository folder

## Development

Optional tooling for formatting and linting (does not affect the unpacked extension):

```bash
npm install
npm run format    # Prettier write
npm run lint      # ESLint
npm run check     # format check + lint
```

Requires **Node.js 20+**.

## Use

### gpx.studio / Wanderstories

1. Open either supported site
2. Open the extension popup
3. Enter your endpoint, for example:
    - `http://localhost:8000/api/fragment/data/heatmap/routes`
4. Click **Save**
5. Click **Enable** to draw routes
6. Click **Disable** to remove routes

### OpenStreetMap iD editor

1. Open the iD editor: [https://www.openstreetmap.org/edit](https://www.openstreetmap.org/edit) (example with map: `https://www.openstreetmap.org/edit#map=16/48.82523/-125.13630`)
2. Open the extension popup, set your endpoint, click **Save**, then **Enable**
3. Press **B** (Background settings) and scroll to **Overlays**
4. Toggle **Dreeve Routes** on/off in the overlays list
5. Click **Disable** in the extension popup to unload route data and remove the overlay entry

Style/filter examples:

- Color: `#00bcd4`
- Opacity: `0.2`
- Width: `3`
- Sport filter: check one or more categories (for example `Ride` includes road, gravel, MTB, e-bike)

## Notes

- The extension uses a background service worker to fetch endpoints and avoid page-level CORS limitations.
- Endpoint and toggle state are stored with `chrome.storage.sync`.
- Extension permissions include broad `http://*/*` and `https://*/*` host access so users can point to any self-hosted endpoint URL.
- On OSM, `/edit` embeds iD in an `/id` iframe; the extension hooks that iframe and messages it from the popup.
- gpx.studio and Wanderstories behavior is unchanged from previous versions; iD support is additive.

## Troubleshooting

- If overlay does not appear, click extension **Reload** in `chrome://extensions`, then refresh the target site tab.
- On iD, reload the `/edit` page after installing or updating the extension so the editor boot hook can run.
- If the endpoint is unreachable from your browser network, the popup will show a fetch error.
- If the endpoint returns HTML instead of JSON, confirm you are on dreeve **v5.2.0+** and using `/api/fragment/data/heatmap/routes`.
- For self-signed HTTPS certificates, make sure Chrome already trusts the endpoint in a normal tab.
