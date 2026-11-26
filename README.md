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

## Things to check against the live services

My build sandbox had no network access to these providers. I tested every flow against stand-in responses that copy each API's documented shape. The first time you run the app live, check these four points:

1. **Single Runs model id**: the past-week forecast rows show "Run unavailable". If they all do, change `CONFIG.gfsModel`, for example to `gfs_seamless` or `ncep_gfs025`.
2. **HRRR forecast radar**: the radar status line says "Forecast radar (HRRR) is unavailable". If so, look at the run-info URL and tile template in `api.hrrrMeta` and `api.hrrrTileUrl` in `js/api.js`.
3. **ACIS station ids** (`USC00449186`, `USC00449181`, `DCAthr 9`): if the records cards say ACIS is unavailable, try adding the id type, for example `"USC00449186 6"`.
4. **CORS**: everything runs in the browser, so every provider has to allow cross-origin requests. All of them do today. If one stops, put a small proxy in front of it.

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
