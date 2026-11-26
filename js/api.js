/* Data providers. Every function returns parsed data or throws. Units from providers:
   Open-Meteo in °C, km/h, mm (snowfall in cm); ACIS and IEM in °F. */
(function () {
  "use strict";
  const W = window.W;
  const qs = (o) =>
    Object.entries(o)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
      .join("&");

  const STATES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
    DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
    IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
    NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
    NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
    VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
  };
  W.STATES = STATES;

  const api = (W.api = {});

  /* ---------- Locations ---------- */
  api.zip = async function (zip, signal) {
    let data;
    try {
      data = await W.getJSON("https://api.zippopotam.us/us/" + encodeURIComponent(zip), signal);
    } catch (e) {
      if (e.status === 404) {
        const err = new Error(`No U.S. place has the ZIP code ${zip}. Check the digits and try again.`);
        err.userFacing = true;
        throw err;
      }
      throw e;
    }
    const p = data.places && data.places[0];
    if (!p) throw Object.assign(new Error(`No U.S. place has the ZIP code ${zip}.`), { userFacing: true });
    return {
      kind: "zip",
      zip,
      name: p["place name"],
      region: p["state abbreviation"] || p.state,
      country: "United States",
      countryCode: "US",
      lat: parseFloat(p.latitude),
      lon: parseFloat(p.longitude),
    };
  };

  // Returns an array of candidate places. Accepts "City", "City, ST", "City, Region, Country".
  api.searchCity = async function (text, signal) {
    const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
    const name = parts[0];
    const filters = parts.slice(1).map((s) => s.toLowerCase());
    const data = await W.getJSON(
      "https://geocoding-api.open-meteo.com/v1/search?" + qs({ name, count: 20, language: "en", format: "json" }),
      signal
    );
    let results = (data.results || []).map((r) => ({
      kind: "place",
      id: r.id,
      name: r.name,
      region: r.admin1 || "",
      country: r.country || "",
      countryCode: r.country_code || "",
      lat: r.latitude,
      lon: r.longitude,
      tz: r.timezone,
      population: r.population || 0,
    }));
    if (filters.length) {
      results = results.filter((r) =>
        filters.every((f) => {
          const full = STATES[f.toUpperCase()];
          const hay = [r.region, r.country, r.countryCode].map((x) => String(x).toLowerCase());
          return hay.some((h) => h === f || h.startsWith(f)) || (full && r.region.toLowerCase() === full.toLowerCase());
        })
      );
    }
    return results;
  };

  /* ---------- Forecast and modeled history (Open-Meteo) ---------- */
  api.forecast = function (loc, signal) {
    return W.getJSON(
      "https://api.open-meteo.com/v1/forecast?" +
        qs({
          latitude: loc.lat.toFixed(4),
          longitude: loc.lon.toFixed(4),
          timezone: "auto",
          timeformat: "unixtime",
          past_days: 7,
          forecast_days: 9,
          current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
          hourly:
            "temperature_2m,relative_humidity_2m,pressure_msl,weather_code,is_day,precipitation_probability,precipitation,rain,showers,snowfall,cloud_cover,wind_speed_10m,wind_direction_10m",
          daily:
            "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,rain_sum,showers_sum,snowfall_sum,sunrise,sunset",
        }),
      signal
    );
  };

  api.airQuality = function (loc, signal) {
    return W.getJSON(
      "https://air-quality-api.open-meteo.com/v1/air-quality?" +
        qs({ latitude: loc.lat.toFixed(4), longitude: loc.lon.toFixed(4), timezone: "auto", timeformat: "unixtime", current: "us_aqi,pm2_5,ozone" }),
      signal
    );
  };

  // Hourly sampled grid for map layers. lats/lons are arrays of equal length.
  api.grid = async function (lats, lons, signal) {
    const data = await W.getJSON(
      "https://api.open-meteo.com/v1/forecast?" +
        qs({
          latitude: lats.map((x) => x.toFixed(3)).join(","),
          longitude: lons.map((x) => x.toFixed(3)).join(","),
          timezone: "GMT",
          timeformat: "unixtime",
          past_days: 2,
          forecast_days: 2,
          hourly: "temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,rain,showers,snowfall",
        }),
      signal
    );
    return Array.isArray(data) ? data : [data];
  };

  // One archived GFS run initialized at 00 UTC on runDate. Returns {date: {max, min, hours}} in °C by local date.
  api.singleRun = async function (loc, tz, runDate, signal) {
    const data = await W.getJSON(
      "https://single-runs-api.open-meteo.com/v1/forecast?" +
        qs({
          latitude: loc.lat.toFixed(4),
          longitude: loc.lon.toFixed(4),
          models: W.CONFIG.gfsModel,
          run: runDate + "T00:00",
          hourly: "temperature_2m",
          timeformat: "unixtime",
          timezone: "GMT",
          forecast_days: 8,
        }),
      signal
    );
    const h = data.hourly || {};
    const out = {};
    (h.time || []).forEach((t, i) => {
      const v = h.temperature_2m[i];
      if (v == null) return;
      const d = W.time.localDate(t * 1000, tz);
      const o = (out[d] = out[d] || { max: -Infinity, min: Infinity, hours: 0 });
      o.max = Math.max(o.max, v);
      o.min = Math.min(o.min, v);
      o.hours++;
    });
    return out;
  };

  /* ---------- NWS ---------- */
  api.alerts = function (loc, signal) {
    return W.getJSON("https://api.weather.gov/alerts/active?" + qs({ point: loc.lat.toFixed(4) + "," + loc.lon.toFixed(4) }), signal);
  };
  api.nwsPoint = function (loc, signal) {
    return W.getJSON("https://api.weather.gov/points/" + loc.lat.toFixed(4) + "," + loc.lon.toFixed(4), signal);
  };

  /* ---------- Station observations (IEM) ---------- */
  // Returns {YYYY-MM-DD: {max, min}} in °F for one month.
  api.iemDaily = async function (station, network, year, month, signal) {
    const data = await W.getJSON(
      "https://mesonet.agron.iastate.edu/api/1/daily.json?" + qs({ station, network, year, month }),
      signal
    );
    const out = {};
    (data.data || []).forEach((r) => {
      out[r.date] = {
        max: r.max_tmpf == null ? null : Number(r.max_tmpf),
        min: r.min_tmpf == null ? null : Number(r.min_tmpf),
      };
    });
    return out;
  };

  // Find an IEM ASOS station near a location using the NWS station list.
  api.findObsStation = async function (loc, signal) {
    const pt = await api.nwsPoint(loc, signal);
    const state = pt.properties && pt.properties.relativeLocation && pt.properties.relativeLocation.properties.state;
    const list = await W.getJSON(pt.properties.observationStations, signal);
    const feats = (list.features || []).slice(0, 4);
    const nets = [state + "_ASOS"];
    if (state === "DC") nets.unshift("VA_ASOS", "MD_ASOS");
    return feats.map((f) => {
      const id = f.properties.stationIdentifier;
      return {
        station: /^K[A-Z0-9]{3}$/.test(id) ? id.slice(1) : id,
        networks: nets,
        name: f.properties.name + " (" + id + ")",
      };
    });
  };

  /* ---------- Long station history (ACIS) ---------- */
  function acis(endpoint, params, signal) {
    return W.getJSON("https://data.rcc-acis.org/" + endpoint + "?params=" + encodeURIComponent(JSON.stringify(params)), signal, 30000);
  }
  const num = (v) => {
    if (v == null || v === "M" || v === "S" || v === "") return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  // Daily max/min for one calendar date in each year. Returns {meta, rows: {year: {max, min, date}}}
  api.acisSameDate = async function (sid, mmdd, firstYear, lastYear, signal) {
    let start = firstYear;
    let interval = [1, 0, 0];
    if (mmdd === "02-29") {
      while (!W.time.isLeap(start)) start++;
      interval = [4, 0, 0];
    }
    let end = lastYear;
    if (mmdd === "02-29") while (end > start && !W.time.isLeap(end)) end--;
    const data = await acis(
      "StnData",
      {
        sid,
        sdate: `${start}-${mmdd}`,
        edate: `${end}-${mmdd}`,
        elems: [
          { name: "maxt", interval },
          { name: "mint", interval },
        ],
        meta: "name,sids,ll",
      },
      signal
    );
    if (data.error) throw new Error(data.error);
    const rows = {};
    (data.data || []).forEach((r) => {
      const date = r[0];
      if (date.slice(5) !== mmdd) return; // skips non-leap years in 4-year steps
      const max = num(r[1]), min = num(r[2]);
      if (max == null && min == null) return;
      rows[parseInt(date.slice(0, 4), 10)] = { max, min, date };
    });
    return { meta: data.meta || {}, rows };
  };

  // Yearly highest max and lowest min with dates, completed calendar years.
  api.acisYearly = async function (sid, lastYear, signal) {
    const data = await acis(
      "StnData",
      {
        sid,
        sdate: "por",
        edate: `${lastYear}-12-31`,
        elems: [
          { name: "maxt", interval: "yly", duration: "yly", reduce: { reduce: "max", add: "date,mcnt" }, maxmissing: 300 },
          { name: "mint", interval: "yly", duration: "yly", reduce: { reduce: "min", add: "date,mcnt" }, maxmissing: 300 },
        ],
        meta: "name,sids,ll,valid_daterange",
      },
      signal
    );
    if (data.error) throw new Error(data.error);
    const rows = {};
    (data.data || []).forEach((r) => {
      const year = parseInt(String(r[0]).slice(0, 4), 10);
      const hi = Array.isArray(r[1]) ? r[1] : [r[1]];
      const lo = Array.isArray(r[2]) ? r[2] : [r[2]];
      const max = num(hi[0]), min = num(lo[0]);
      if (max == null && min == null) return;
      rows[year] = {
        max, maxDate: max == null ? null : hi[1], maxMissing: hi[2] == null ? null : Number(hi[2]),
        min, minDate: min == null ? null : lo[1], minMissing: lo[2] == null ? null : Number(lo[2]),
      };
    });
    return { meta: data.meta || {}, rows };
  };

  // Long-record, still-reporting ACIS station near a point.
  api.acisNearestStation = async function (lat, lon, signal) {
    const d = 0.35;
    const data = await acis(
      "StnMeta",
      { bbox: [lon - d, lat - d, lon + d, lat + d].map((x) => +x.toFixed(3)).join(","), elems: "maxt", meta: "name,sids,ll,valid_daterange" },
      signal
    );
    const now = new Date();
    const recent = new Date(now.getTime() - 120 * 86400000).toISOString().slice(0, 10);
    const cands = (data.meta || [])
      .filter((m) => m.valid_daterange && m.valid_daterange[0] && m.valid_daterange[0].length === 2 && m.valid_daterange[0][1] >= recent)
      .map((m) => ({
        sid: m.sids[0].split(" ")[0] + " " + m.sids[0].split(" ")[1],
        name: m.name,
        start: m.valid_daterange[0][0],
        distKm: W.haversineKm(lat, lon, m.ll[1], m.ll[0]),
      }))
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.distKm - b.distKm));
    return cands[0] || null;
  };

  /* ---------- Radar ---------- */
  api.rainviewer = () => W.getJSON("https://api.rainviewer.com/public/weather-maps.json");
  api.hrrrMeta = () => W.getJSON("https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_0000.json");
  api.hrrrTileUrl = (minutes) =>
    `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F${String(minutes).padStart(4, "0")}-0/{z}/{x}/{y}.png`;
})();
