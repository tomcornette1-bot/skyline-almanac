# Skyline Almanac

A static, client-side weather dashboard. It starts in Winchester, VA (22601), with Winchester and Washington, DC as favorite ZIPs. No build step, no backend, and no API keys.

## Run it

The app has to be served over http(s). Opening `index.html` straight from disk can get map tiles refused.

```bash
cd weather-app
python3 -m http.server 8000
# open http://localhost:8000/
```

Any static host works: GitHub Pages, Netlify, Cloudflare Pages or S3. Upload the folder as it is.

## Configure

Edit `W.CONFIG` at the top of `js/util.js`:

- `defaultZip` and `initialFavorites` set the starting place and favorites. Favorites a viewer saves are kept in that browser's localStorage.
- `historyCities` sets the station series for the records cards and the long-term chart. A place within `radiusKm` of a city uses that city's series. Any other U.S. place uses the longest-running nearby ACIS station that is still reporting.
- `gfsModel` is the Open-Meteo model id for the forecast-vs-observed comparison. The default is `gfs_global`.

The selected place is kept in the URL: `?zip=20001`, or `?lat=…&lon=…&name=…` for a city. Units, display mode, compact layout and favorites are kept in localStorage.

## Data providers

All of these are free and keyless, and the browser calls them directly:

| Section | Provider |
| --- | --- |
| Forecast, past hourly model data, map sample points, geocoding | Open-Meteo Forecast and Geocoding APIs |
| Air quality (U.S. AQI) | Open-Meteo Air Quality API |
| Forecast vs. observed (GFS runs initialized 00 UTC on the issue date) | Open-Meteo Single Runs API |
| ZIP lookup | Zippopotam.us |
| Alerts, nearest observing station | api.weather.gov |
| Observed radar | RainViewer Weather Maps API |
| Forecast radar (contiguous U.S.) | NOAA HRRR reflectivity tiles from Iowa Environmental Mesonet |
| Daily station observations | Iowa Environmental Mesonet daily API |
| Long historical series and records | ACIS Web Services |
| Map, astronomy | Leaflet 1.9.4 + OpenStreetMap tiles, Astronomy Engine 2.1.19 (both bundled in `vendor/`) |

Before a public deployment, read each provider's terms. Open-Meteo's free tier is for non-commercial use. OpenStreetMap's tile servers are meant for light use only, so switch to a commercial tile provider if traffic grows. RainViewer's free tiles go up to zoom 7, and the map scales them past that.

## Live checks

Two GitHub Actions workflows check the app against the real services:

- **Probe data providers** (`tools/probe.sh`) calls each provider endpoint. It records the status code, the CORS header and the first part of each response.
- **Live smoke test** (`tools/smoke.js`) loads the app in headless Chromium against live data, for Winchester, DC, Boise and London. It records what each section shows.

Both write their results to the `probe-results` branch. You can run either one again from the Actions tab.

The checks on 2026-11-26 confirmed these points:
- Every provider allows browser (CORS) requests.
- `gfs_global` returns the archived GFS runs.
- The IEM HRRR run info and tiles work.
- The ACIS station ids work as written.
- The Nov 26 series reach back to 1912 for Winchester and 1872 for DC.

Each section loads, fails and retries on its own. If one provider is down, the rest of the page keeps working.

## Files

- `index.html`: page structure, sections in spec order
- `css/styles.css`: Light, Dark, Black, High-contrast and Compact modes
- `js/util.js`: config, units, time zones, storage, fetch helper
- `js/api.js`: every provider call
- `js/history.js`: station series, gap filling, records
- `js/dashboard.js`: alerts, current conditions, records cards, 7-day forecast and telescope outlook, next 24 hours, past-week comparison
- `js/charts.js`: hourly chart and historical temperature chart
- `js/map.js`: radar timeline and modeled map layers
- `js/app.js`: search, favorites, URL state, preferences, load orchestration
