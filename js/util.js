/* Shared helpers: units, time zones, formatting, storage, fetch. */
(function () {
  "use strict";
  const W = (window.W = window.W || {});

  /* ---------- Configuration (edit these to change defaults) ---------- */
  W.CONFIG = {
    appName: "Skyline Almanac",
    defaultZip: "22601",
    initialFavorites: [
      { zip: "22601", label: "Winchester, VA" },
      { zip: "20001", label: "Washington, DC" },
    ],
    // Station series used for records and the long-term chart.
    // A location within `radiusKm` of a configured city uses that city's series.
    historyCities: [
      {
        id: "winchester",
        name: "Winchester, VA",
        lat: 39.1857,
        lon: -78.1633,
        radiusKm: 25,
        color: "var(--city-a)",
        primary: { sid: "USC00449186", name: "Winchester 7 SE" },
        fills: [
          { kind: "acis", sid: "USC00449181", name: "Winchester" },
          { kind: "iem", station: "OKV", network: "VA_ASOS", name: "Winchester Regional Airport", firstYear: 1998 },
        ],
        obsStation: { station: "OKV", network: "VA_ASOS", name: "Winchester Regional Airport (OKV)" },
      },
      {
        id: "dc",
        name: "Washington, DC",
        lat: 38.9072,
        lon: -77.0369,
        radiusKm: 25,
        color: "var(--city-b)",
        primary: { sid: "DCAthr 9", name: "Washington Area (threaded record)" },
        fills: [],
        obsStation: { station: "DCA", network: "VA_ASOS", name: "Washington Reagan National (DCA)" },
      },
    ],
    gfsModel: "gfs_global",
    forecastLeads: [1, 2, 3, 4, 5],
  };

  /* ---------- Storage (never throws) ---------- */
  W.store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("skyline:" + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("skyline:" + key, JSON.stringify(value));
      } catch (e) {
        /* storage full or blocked */
      }
    },
  };

  /* ---------- Units ---------- */
  W.units = () => W.state.units; // "us" | "metric"
  const cToF = (c) => (c * 9) / 5 + 32;
  const fToC = (f) => ((f - 32) * 5) / 9;
  W.conv = {
    cToF,
    fToC,
    // temperature given in °C → display number in active unit
    tempC(c) {
      if (c == null || isNaN(c)) return null;
      return W.units() === "us" ? cToF(c) : c;
    },
    // temperature given in °F
    tempF(f) {
      if (f == null || isNaN(f)) return null;
      return W.units() === "us" ? f : fToC(f);
    },
    windKmh(k) {
      if (k == null || isNaN(k)) return null;
      return W.units() === "us" ? k / 1.609344 : k;
    },
    precipMm(mm) {
      if (mm == null || isNaN(mm)) return null;
      return W.units() === "us" ? mm / 25.4 : mm;
    },
    snowCm(cm) {
      if (cm == null || isNaN(cm)) return null;
      return W.units() === "us" ? cm / 2.54 : cm;
    },
  };
  W.u = {
    t: () => (W.units() === "us" ? "°F" : "°C"),
    wind: () => (W.units() === "us" ? "mph" : "km/h"),
    precip: () => (W.units() === "us" ? "in" : "mm"),
    snow: () => (W.units() === "us" ? "in" : "cm"),
  };
  const dash = "—";
  W.fmt = {
    tC(c, withUnit = true) {
      const v = W.conv.tempC(c);
      return v == null ? dash : Math.round(v) + (withUnit ? W.u.t() : "°");
    },
    tF(f, withUnit = true) {
      const v = W.conv.tempF(f);
      return v == null ? dash : Math.round(v) + (withUnit ? W.u.t() : "°");
    },
    wind(k) {
      const v = W.conv.windKmh(k);
      return v == null ? dash : Math.round(v) + " " + W.u.wind();
    },
    precip(mm) {
      const v = W.conv.precipMm(mm);
      if (v == null) return dash;
      const d = W.units() === "us" ? 2 : 1;
      return v.toFixed(d) + " " + W.u.precip();
    },
    snow(cm) {
      const v = W.conv.snowCm(cm);
      if (v == null) return dash;
      return v.toFixed(1) + " " + W.u.snow();
    },
    pct(p) {
      return p == null || isNaN(p) ? dash : Math.round(p) + "%";
    },
  };

  W.compass = function (deg) {
    if (deg == null || isNaN(deg)) return dash;
    const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return names[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  };

  /* ---------- Time zones and local dates ---------- */
  const fmtCache = new Map();
  function dtf(tz, opts) {
    const key = tz + JSON.stringify(opts);
    if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: tz }, opts)));
    return fmtCache.get(key);
  }
  W.time = {
    // YYYY-MM-DD for an instant in a zone
    localDate(ms, tz) {
      const p = {};
      dtf(tz, { year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(new Date(ms))
        .forEach((x) => (p[x.type] = x.value));
      return `${p.year}-${p.month}-${p.day}`;
    },
    localHour(ms, tz) {
      const h = dtf(tz, { hour: "numeric", hourCycle: "h23" }).format(new Date(ms));
      return parseInt(h, 10) % 24;
    },
    hourLabel(ms, tz) {
      return dtf(tz, { hour: "numeric" }).format(new Date(ms));
    },
    timeLabel(ms, tz) {
      return dtf(tz, { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
    },
    dateTimeLabel(ms, tz) {
      return dtf(tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(ms));
    },
    longDate(ms, tz) {
      return dtf(tz, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(ms));
    },
    tzName(ms, tz) {
      const p = dtf(tz, { timeZoneName: "short" }).formatToParts(new Date(ms)).find((x) => x.type === "timeZoneName");
      return p ? p.value : tz;
    },
    // Calendar helpers on YYYY-MM-DD strings (no time zone involved)
    addDays(dateStr, n) {
      const [y, m, d] = dateStr.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, d + n));
      return t.toISOString().slice(0, 10);
    },
    diffDays(a, b) {
      const pa = a.split("-").map(Number), pb = b.split("-").map(Number);
      return Math.round((Date.UTC(pa[0], pa[1] - 1, pa[2]) - Date.UTC(pb[0], pb[1] - 1, pb[2])) / 86400000);
    },
    weekdayShort(dateStr) {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    },
    monthDay(dateStr) {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    },
    fullDate(dateStr) {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    },
    isLeap(y) {
      return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    },
  };

  /* ---------- Fetch with timeout and abort ---------- */
  W.getJSON = async function (url, signal, timeoutMs = 20000) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        const err = new Error("HTTP " + res.status);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  };
  W.isAbort = (e) => !!e && e.name === "AbortError";

  /* ---------- DOM helpers ---------- */
  W.$ = (sel, root = document) => root.querySelector(sel);
  W.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  W.esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  W.setStatus = function (el, kind, msg, retry) {
    // kind: loading | error | empty
    el.innerHTML = "";
    const div = document.createElement("div");
    div.className = "status status-" + kind;
    div.setAttribute("role", kind === "error" ? "alert" : "status");
    const span = document.createElement("span");
    span.textContent = msg;
    div.appendChild(span);
    if (retry) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-small";
      b.textContent = "Retry";
      b.addEventListener("click", retry);
      div.appendChild(b);
    }
    el.appendChild(div);
  };

  W.haversineKm = function (lat1, lon1, lat2, lon2) {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  /* Least-squares linear fit over points [{x,y}] */
  W.linfit = function (pts) {
    const n = pts.length;
    if (n < 2) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach((p) => {
      sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y;
    });
    const den = n * sxx - sx * sx;
    if (den === 0) return null;
    const m = (n * sxy - sx * sy) / den;
    const b = (sy - m * sx) / n;
    return { m, b };
  };

  /* Nice axis ticks */
  W.ticks = function (min, max, count = 5) {
    if (!isFinite(min) || !isFinite(max)) return [];
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  };
})();
