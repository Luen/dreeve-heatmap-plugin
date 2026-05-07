# stats-for-strava-heatmap-plugin

Chrome extension that overlays your self-hosted Statistics for Strava routes on:

- `https://gpx.studio/*`
- `https://studio.wanderstories.space/*`

## What it does

- Lets the user configure a custom `routes.json` endpoint URL
- Fetches route data from your Statistics for Strava heatmap API
- Draws route polylines on the page map
- Clicking a route opens a popup with activity details and links
- Toggles overlay on/off from the extension popup
- Lets the user configure route color, opacity, and width
- Supports filtering by `filterables.sportType` (checkbox selection)
- Automatically excludes virtual activities (`VirtualRide`, `VirtualRun`)
- Supports both map engines used by target sites:
  - `gpx.studio` (MapLibre GL)
  - `studio.wanderstories.space` (Mapbox GL JS)

Expected endpoint format (array of activities with `coordinates` as `[lat, lng]`):

```json
[
  {
    "id": "activity-123",
    "coordinates": [[-19.37, 146.64], [-19.38, 146.65]]
  }
]
```

## Install (developer mode)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this repository folder

## Use

1. Open either supported site
2. Open the extension popup
3. Enter your endpoint, for example:
   - `http://localhost:8000/api/heatmap/routes.json`
4. Click **Save**
5. Click **Enable** to draw routes
6. Click **Disable** to remove routes

Style/filter examples:

- Color: `#00bcd4`
- Opacity: `0.2`
- Width: `3`
- Sport filter: check one or more sport types (for example `Run`, `Ride`, `EBikeRide`)

## Notes

- The extension uses a background service worker to fetch endpoints and avoid page-level CORS limitations.
- Endpoint and toggle state are stored with `chrome.storage.sync`.
- Extension permissions include broad `http://*/*` and `https://*/*` host access so users can point to any self-hosted endpoint URL.
- On HTTPS map pages, HTTP Statistics-for-Strava activity pages cannot be embedded in iframes due to browser mixed-content rules; the extension falls back to opening them in a new tab.

## Troubleshooting

- If overlay does not appear, click extension **Reload** in `chrome://extensions`, then refresh the target site tab.
- If the endpoint is unreachable from your browser network, the popup will show a fetch error.
- For self-signed HTTPS certificates, make sure Chrome already trusts the endpoint in a normal tab.
