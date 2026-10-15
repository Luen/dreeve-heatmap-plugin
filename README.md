# Dreeve Heatmap Extension

Chrome extension that overlays your self-hosted [Dreeve](https://github.com/dreeveapp/dreeve) routes on:

- `https://gpx.studio/*`
- `https://studio.wanderstories.space/*`
- `https://www.openstreetmap.org/edit` (OpenStreetMap iD editor)

<img width="338" height="400" alt="Screenshot of heatmap extension" src="https://github.com/user-attachments/assets/52317c33-42aa-462a-a810-3fe12c49bac8" />

## Requirements

- **Dreeve v5.3.0 or newer** for route overlays ([release notes](https://github.com/dreeveapp/dreeve/releases/tag/v5.3.0))
- **Dreeve v5.6.0 or newer** for explorer tiles ([release notes](https://github.com/dreeveapp/dreeve/releases/tag/v5.6.0))
- Support for earlier Dreeve versions (including `/api/heatmap/routes.json` and `/api/fragment/data/heatmap/routes`) has been dropped

Routes are loaded from `/api/internal/heatmap/routes`. Explorer tiles are loaded from `/api/internal/heatmap/tiles` (URL derived automatically from the routes endpoint).

## What it does

- Lets the user configure a custom heatmap routes endpoint URL
- Fetches route data from your Dreeve heatmap API
- Draws route polylines on the page map
- On MapLibre (gpx.studio) and Mapbox GL JS (Wanderstories), overlays Dreeve explorer tiles (visited / cluster / max-cluster / max-square), matching the Dreeve heatmap
- Independent **Show routes** / **Show tiles** checkboxes (both on by default; on OpenStreetMap iD the popup disables **Show tiles** — routes only)
- Shared colour and opacity for routes and tiles; route width applies to lines only
- Clicking a route opens a popup with activity details and links
- Toggles overlay on/off from the extension popup
- Supports filtering by high-level categories (`Ride`, `Walk`, `Water`, `Winter`) — applies to both routes and tiles
- Automatically excludes virtual activities (`VirtualRide`, `VirtualRun`)
- Supports the map engines / editors used by target sites:
    - `gpx.studio` (MapLibre GL JS) — routes + explorer tiles
    - `studio.wanderstories.space` (Mapbox GL JS) — routes + explorer tiles
    - OpenStreetMap iD editor (Background → Overlays toggle + SVG route layer) — routes only

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
    - `http://localhost:8000/api/internal/heatmap/routes`
4. Optionally toggle **Show routes** / **Show tiles** (and other style/filters)
5. Click **Enable** to draw the selected layers
6. While enabled, further popup changes apply automatically
7. Click **Disable** to remove the overlay

Settings on the options page save automatically to storage and apply the next time you Enable (or when you change them from the popup while enabled).

### OpenStreetMap iD editor

1. Open the iD editor: [https://www.openstreetmap.org/edit](https://www.openstreetmap.org/edit) (example with map: `https://www.openstreetmap.org/edit#map=16/48.82523/-125.13630`)
2. Open the extension popup, set your endpoint, then click **Enable** (**Show tiles** is disabled here; explorer tiles are MapLibre / Mapbox only)
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
- Explorer tiles are not drawn on OpenStreetMap iD (routes only). The popup disables **Show tiles** on OSM so the preference is unchanged for MapLibre / Mapbox hosts.

## Troubleshooting

- If overlay does not appear, click extension **Reload** in `chrome://extensions`, then refresh the target site tab.
- On iD, reload the `/edit` page after installing or updating the extension so the editor boot hook can run.
- If the endpoint is unreachable from your browser network, the popup will show a fetch error.
- If the endpoint returns HTML instead of JSON, confirm you are on Dreeve **v5.3.0+** and using `/api/internal/heatmap/routes`.
- If routes work but tiles fail, confirm Dreeve **v5.6.0+** and that `/api/internal/heatmap/tiles` is reachable.
- For self-signed HTTPS certificates, make sure Chrome already trusts the endpoint in a normal tab.

## Performance

- Route and tile payloads are cached in the service worker (memory + `chrome.storage.session`) for about 20 minutes, with HTTP `ETag` / `If-None-Match` when the server supports it.
- Re-enabling or updating settings while the overlay is on may reuse the cache; a fresh Enable after Disable still force-refreshes from the network.
- Style-only changes (color, opacity, width) update the map without re-fetching geometry.
