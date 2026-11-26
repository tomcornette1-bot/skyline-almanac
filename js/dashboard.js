/* Dashboard sections: header & alerts, current, today in history, 7-day, next 24 h, past seven days. */
(function () {
  "use strict";
  const W = window.W;
  const { $, esc, fmt, time } = W;
  const D = (W.dash = {});

  /* ---------- Helpers over the Open-Meteo response ---------- */
  D.hours = function (fc) {
    const h = fc.hourly;
    return h.time.map((t, i) => ({
      t: t * 1000,
      temp: h.temperature_2m[i],
      rh: h.relative_humidity_2m[i],
      pres: h.pressure_msl[i],
      code: h.weather_code[i],
      isDay: h.is_day[i] === 1,
      pop: h.precipitation_probability[i],
      precip: h.precipitation[i],
      rain: (h.rain[i] || 0) + (h.showers[i] || 0),
      snow: h.snowfall[i],
      cloud: h.cloud_cover[i],
      wind: h.wind_speed_10m[i],
      dir: h.wind_direction_10m[i],
    }));
  };
  D.days = function (fc) {
    const d = fc.daily;
    return d.time.map((t, i) => ({
      date: time.localDate(t * 1000 + 12 * 3600e3, fc.timezone),
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      pop: d.precipitation_probability_max[i],
      precip: d.precipitation_sum[i],
      rain: (d.rain_sum[i] || 0) + (d.showers_sum[i] || 0),
      snow: d.snowfall_sum[i],
      sunrise: d.sunrise[i] * 1000,
      sunset: d.sunset[i] * 1000,
    }));
  };

  /* ---------- 1. Header and alerts ---------- */
  D.renderHeader = function (loc, tz) {
    const now = Date.now();
    const region = [loc.region, loc.countryCode === "US" ? "" : loc.country].filter(Boolean).join(", ");
    $("#place-name").textContent = loc.name + (region ? ", " + region : "");
    $("#place-sub").textContent =
      (loc.zip ? "ZIP " + loc.zip + " · " : "") +
      (tz ? time.longDate(now, tz) + " · " + time.tzName(now, tz) : "Loading local time…") +
      ` · ${Math.abs(loc.lat).toFixed(2)}°${loc.lat >= 0 ? "N" : "S"}, ${Math.abs(loc.lon).toFixed(2)}°${loc.lon >= 0 ? "E" : "W"}`;
  };

  D.loadAlerts = async function (ctx) {
    const el = $("#alerts");
    if (ctx.loc.countryCode && ctx.loc.countryCode !== "US") {
      W.setStatus(el, "empty", "National Weather Service alerts cover U.S. locations only. No alert feed for this place.");
      return;
    }
    W.setStatus(el, "loading", "Checking National Weather Service alerts…");
    try {
      const data = await W.api.alerts(ctx.loc, ctx.signal);
      if (!ctx.current()) return;
      const feats = (data.features || []).filter((f) => f.properties && f.properties.status !== "Test");
      if (!feats.length) {
        el.innerHTML = '<p class="alert-none">No active NWS alerts for this point.</p>';
        return;
      }
      el.innerHTML = feats
        .map((f) => {
          const p = f.properties;
          const sev = (p.severity || "Unknown").toLowerCase();
          const ends = p.ends || p.expires;
          return `<details class="alert sev-${esc(sev)}">
            <summary><span class="alert-sev">${esc(p.severity || "Alert")}</span><strong>${esc(p.event)}</strong>
              <span class="alert-head">${esc(p.headline || "")}</span></summary>
            <div class="alert-body">
              ${ends ? `<p class="muted">Until ${esc(time.dateTimeLabel(Date.parse(ends), ctx.tz || "UTC"))} · ${esc(p.senderName || "NWS")}</p>` : ""}
              <p>${esc(p.description || "").replace(/\n\n/g, "</p><p>").replace(/\n/g, " ")}</p>
              ${p.instruction ? `<p><strong>What to do:</strong> ${esc(p.instruction).replace(/\n/g, " ")}</p>` : ""}
              <p class="muted small">Areas: ${esc(p.areaDesc || "")}</p>
            </div></details>`;
        })
        .join("");
    } catch (e) {
      if (!ctx.current()) return;
      W.setStatus(el, "error", e.status === 404 || e.status === 400
        ? "The NWS alert feed has no coverage for this point."
        : "The NWS alert feed is unavailable right now, so active alerts can't be shown.", () => D.loadAlerts(ctx));
    }
  };

  /* ---------- 2. Current conditions ---------- */
  const MOON_NAMES = ["New Moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full Moon", "Waning gibbous", "Third quarter", "Waning crescent"];
  D.moon = function (ms) {
    if (!window.Astronomy) return null;
    const d = new Date(ms);
    const angle = Astronomy.MoonPhase(d);
    const illum = Astronomy.Illumination(Astronomy.Body.Moon, d).phase_fraction;
    const idx = Math.round(angle / 45) % 8;
    return { angle, illum, name: MOON_NAMES[idx] };
  };
  function moonSvg(angle, size = 36) {
    // Lit region from phase angle (0 new → 180 full). Draw terminator as an ellipse.
    const r = 14, cx = 18, cy = 18;
    const k = Math.cos((angle * Math.PI) / 180); // 1 new, -1 full
    const waxing = angle < 180;
    const rx = Math.abs(k) * r;
    const sweepOuter = waxing ? 1 : 0;
    const sweepInner = k > 0 ? (waxing ? 0 : 1) : waxing ? 1 : 0;
    const d = `M${cx} ${cy - r} A${r} ${r} 0 0 ${sweepOuter} ${cx} ${cy + r} A${rx} ${r} 0 0 ${sweepInner} ${cx} ${cy - r}Z`;
    return `<svg width="${size}" height="${size}" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="14" fill="var(--moon-dark)"/><path d="${d}" fill="var(--moon-lit)"/></svg>`;
  }

  D.renderCurrent = function (ctx, fc, aq) {
    const el = $("#current");
    const c = fc.current;
    const tz = fc.timezone;
    const hours = D.hours(fc);
    const days = D.days(fc);
    const today = time.localDate(Date.now(), tz);
    const td = days.find((d) => d.date === today) || days[0];
    const nowMs = c.time * 1000;
    const past24 = hours.filter((h) => h.t > nowMs - 24 * 3600e3 && h.t <= nowMs);
    const p24 = past24.reduce((s, h) => s + (h.precip || 0), 0);
    const s24 = past24.reduce((s, h) => s + (h.snow || 0), 0);
    const moon = D.moon(Date.now());
    let aqHtml = '<span class="muted">Unavailable</span>';
    if (aq && aq.current && aq.current.us_aqi != null) {
      const cat = W.aqiCategory(aq.current.us_aqi);
      aqHtml = `<span class="aqi-chip ${cat.cls}">${Math.round(aq.current.us_aqi)}</span> ${esc(cat.label)}`;
    }
    el.innerHTML = `
      <div class="now-main">
        ${W.wx.icon(c.weather_code, c.is_day === 1, 72)}
        <div>
          <div class="now-temp">${fmt.tC(c.temperature_2m)}</div>
          <div class="now-desc">${esc(W.wx.desc(c.weather_code))}</div>
          <div class="muted">Feels like ${fmt.tC(c.apparent_temperature)} · Today ${fmt.tC(td.max)} / ${fmt.tC(td.min)}</div>
        </div>
      </div>
      <dl class="facts">
        <div><dt>Humidity</dt><dd>${fmt.pct(c.relative_humidity_2m)}</dd></div>
        <div><dt>Wind</dt><dd>${W.compass(c.wind_direction_10m)} ${fmt.wind(c.wind_speed_10m)}${c.wind_gusts_10m ? `<span class="muted"> · gusts ${fmt.wind(c.wind_gusts_10m)}</span>` : ""}</dd></div>
        <div><dt>U.S. AQI</dt><dd>${aqHtml}</dd></div>
        <div><dt>Precipitation</dt><dd>${fmt.precip(p24)}${s24 > 0 ? ` <span class="muted">incl. ${fmt.snow(s24)} snow</span>` : ""}<span class="fact-note">past 24 h, modeled</span></dd></div>
        <div><dt>Sunrise</dt><dd>${time.timeLabel(td.sunrise, tz)}</dd></div>
        <div><dt>Sunset</dt><dd>${time.timeLabel(td.sunset, tz)}</dd></div>
        <div><dt>Moon</dt><dd class="moon-dd">${moon ? moonSvg(moon.angle) + `<span>${esc(moon.name)}<span class="fact-note">${Math.round(moon.illum * 100)}% illuminated</span></span>` : '<span class="muted">Unavailable</span>'}</dd></div>
      </dl>
      <p class="source">Model analysis from Open-Meteo, updated ${esc(time.timeLabel(nowMs, tz))}${ctx.cachedAt ? ` · <strong>showing a saved copy retrieved ${esc(time.dateTimeLabel(ctx.cachedAt, tz))}</strong>` : ""}. Air quality: Open-Meteo Air Quality (CAMS).</p>`;
  };

  /* ---------- 3. Today in the historical record ---------- */
  D.loadToday = async function (ctx) {
    const el = $("#today-history");
    W.setStatus(el, "loading", "Loading station history…");
    try {
      const series = await W.history.seriesFor(ctx.loc, ctx.signal);
      if (!ctx.current()) return;
      if (!series) {
        W.setStatus(el, "empty", "No long-record U.S. station series covers this place, so historical records are unavailable.");
        return;
      }
      const today = time.localDate(Date.now(), ctx.tz);
      const year = Number(today.slice(0, 4));
      const mmdd = today.slice(5);
      const sd = await W.history.sameDate(series, mmdd, year - 1);
      if (!ctx.current()) return;
      const ly = sd.years[year - 1];
      const rec = W.history.records(sd, year);
      const lyUnavailable =
        mmdd === "02-29" && !W.time.isLeap(year - 1) ? `${year - 1} had no Feb 29` : "No reading";
      const cell = (label, v, extra) =>
        `<div class="hcell"><span class="hlabel">${label}</span><span class="hval">${v == null ? `<span class="unavail">Unavailable</span>` : fmt.tF(v)}</span><span class="hmeta">${extra || ""}</span></div>`;
      el.innerHTML = `
        <div class="hgrid">
          ${cell(`Last year's high`, ly && ly.max, ly && ly.max != null ? `${year - 1}${ly.maxSrc !== series.primary.name ? " · " + esc(ly.maxSrc) : ""}` : lyUnavailable)}
          ${cell(`Last year's low`, ly && ly.min, ly && ly.min != null ? `${year - 1}${ly.minSrc !== series.primary.name ? " · " + esc(ly.minSrc) : ""}` : lyUnavailable)}
          ${cell("Record high", rec.hi && rec.hi.value, rec.hi ? `${rec.hi.year}${rec.hi.src !== series.primary.name ? " · " + esc(rec.hi.src) : ""}` : "No readings")}
          ${cell("Record low", rec.lo && rec.lo.value, rec.lo ? `${rec.lo.year}${rec.lo.src !== series.primary.name ? " · " + esc(rec.lo.src) : ""}` : "No readings")}
        </div>
        <p class="source">${esc(time.monthDay(today))} at <strong>${esc(series.label)}</strong>: ${esc(sd.sources.map((s) => s.name + " (" + s.sid + ")").join(", then "))}. Records use years ${sd.first || "?"}–${year - 1}; a tie shows the most recent year. Data: ACIS${series.fills.some((f) => f.kind === "iem") ? ", Iowa Environmental Mesonet" : ""}.</p>`;
    } catch (e) {
      if (!ctx.current()) return;
      W.setStatus(el, "error", "Station history (ACIS) is unavailable right now.", () => D.loadToday(ctx));
    }
  };

  /* ---------- 4. Seven-day forecast with telescope outlook ---------- */
  function sunMoonAt(ms, obs) {
    const d = new Date(ms);
    const se = Astronomy.Equator(Astronomy.Body.Sun, d, obs, true, true);
    const sh = Astronomy.Horizon(d, obs, se.ra, se.dec, "normal");
    const me = Astronomy.Equator(Astronomy.Body.Moon, d, obs, true, true);
    const mh = Astronomy.Horizon(d, obs, me.ra, me.dec, "normal");
    const illum = Astronomy.Illumination(Astronomy.Body.Moon, d).phase_fraction;
    return { sun: sh.altitude, moon: mh.altitude, illum };
  }
  // Night of `date` = local hours from 12:00 on date to 12:00 next day.
  D.telescope = function (date, hours, loc, tz) {
    if (!window.Astronomy) return { rating: "Unavailable", note: "Astronomy library failed to load." };
    const obs = new Astronomy.Observer(loc.lat, loc.lon, 0);
    const next = time.addDays(date, 1);
    const night = hours.filter((h) => {
      const d = time.localDate(h.t, tz), hr = time.localHour(h.t, tz);
      return (d === date && hr >= 12) || (d === next && hr < 12);
    });
    if (night.length < 20) return { rating: "Unavailable", note: "Forecast does not cover this night." };
    const evald = night.map((h) => {
      const a = sunMoonAt(h.t + 30 * 60e3, obs); // middle of the hour
      const dark = a.sun < -18;
      const moonGlow = a.moon > 0 ? a.illum * Math.min(1, Math.sin((a.moon * Math.PI) / 180) * 2 + 0.3) : 0;
      const ok = dark && h.cloud != null && h.cloud <= 30 && (h.pop == null || h.pop <= 20) && !(h.precip > 0) && h.wind <= 25;
      return Object.assign({}, h, a, { dark, moonGlow, ok });
    });
    const darkHours = evald.filter((h) => h.dark);
    if (!darkHours.length) return { rating: "Poor", note: "No astronomical darkness tonight." };
    // Best contiguous run of qualifying hours
    let best = null, cur = [];
    const score = (run) => run.length * 10 - run.reduce((s, h) => s + h.cloud / 10 + h.moonGlow * 4, 0) / run.length;
    evald.forEach((h, i) => {
      if (h.ok) cur.push(h);
      if (!h.ok || i === evald.length - 1) {
        if (cur.length && (!best || score(cur) > score(best))) best = cur;
        cur = [];
      }
    });
    if (!best) {
      const cloudy = darkHours.filter((h) => h.cloud > 30).length;
      const wet = darkHours.filter((h) => h.pop > 20 || h.precip > 0).length;
      const windy = darkHours.filter((h) => h.wind > 25).length;
      const why = [[cloudy, "too cloudy"], [wet, "precipitation likely"], [windy, "too windy"]].sort((a, b) => b[0] - a[0])[0][1];
      return { rating: "Poor", note: `No good window: ${why}.` };
    }
    const avgCloud = best.reduce((s, h) => s + h.cloud, 0) / best.length;
    const avgMoon = best.reduce((s, h) => s + h.moonGlow, 0) / best.length;
    let rating = best.length >= 2 ? "Fair" : "Poor";
    if (best.length >= 4 && avgCloud <= 10 && avgMoon <= 0.25) rating = "Excellent";
    else if (best.length >= 3 && avgCloud <= 20 && avgMoon <= 0.6) rating = "Good";
    const endMs = best[best.length - 1].t + 3600e3;
    const moonUp = best.filter((h) => h.moon > 0).length;
    const moonNote = moonUp === 0 ? "Moon down" : `Moon ${Math.round(best[0].illum * 100)}% lit, up ${moonUp === best.length ? "all" : moonUp + " h"} of window`;
    return {
      rating,
      window: `${time.hourLabel(best[0].t, tz)}–${time.hourLabel(endMs, tz)}`,
      note: `${best.length} h, clouds ~${Math.round(avgCloud)}%. ${moonNote}.`,
    };
  };

  D.renderSevenDay = function (ctx, fc) {
    const el = $("#seven-day");
    const tz = fc.timezone;
    const today = time.localDate(Date.now(), tz);
    const hours = D.hours(fc);
    const days = D.days(fc).filter((d) => d.date >= today).slice(0, 7);
    const all = days.flatMap((d) => [d.max, d.min]).filter((v) => v != null);
    const lo = Math.min(...all), hi = Math.max(...all);
    const pos = (v) => ((v - lo) / (hi - lo || 1)) * 100;
    el.innerHTML = `<ol class="days">${days
      .map((d, i) => {
        const tel = D.telescope(d.date, hours, ctx.loc, tz);
        const amounts = [];
        if (W.conv.precipMm(d.rain) >= (W.units() === "us" ? 0.005 : 0.05)) amounts.push(`Rain ${fmt.precip(d.rain)}`);
        if (W.conv.snowCm(d.snow) >= 0.05) amounts.push(`Snow ${fmt.snow(d.snow)}`);
        return `<li class="day">
          <div class="day-name"><strong>${i === 0 ? "Today" : time.weekdayShort(d.date)}</strong><span class="muted">${time.monthDay(d.date)}</span></div>
          <div class="day-icon">${W.wx.icon(d.code, true, 36)}</div>
          <div class="day-desc">${esc(W.wx.desc(d.code))}<span class="muted small">${fmt.pct(d.pop)} chance${amounts.length ? " · " + amounts.join(" · ") : ""}</span></div>
          <div class="day-range"><span class="lo">${fmt.tC(d.min, false)}</span>
            <span class="range-track"><span class="range-bar" style="left:${pos(d.min)}%;width:${pos(d.max) - pos(d.min)}%"></span></span>
            <span class="hi">${fmt.tC(d.max, false)}</span></div>
          <div class="day-scope"><span class="scope-chip scope-${tel.rating.toLowerCase()}">${esc(tel.rating)}</span>
            <span class="small">${tel.window ? `<strong>${esc(tel.window)}</strong> ` : ""}${esc(tel.note)}</span></div>
        </li>`;
      })
      .join("")}</ol>
      <p class="source">Forecast: Open-Meteo best-match models. Telescope outlook is an estimate: hours with astronomical darkness (Sun below −18°), cloud cover ≤ 30%, precipitation chance ≤ 20%, wind ≤ ${W.units() === "us" ? "16 mph" : "25 km/h"}, rated by window length, cloud and Moon glow (Astronomy Engine).</p>`;
  };

  /* ---------- 5. Next 24 hours ---------- */
  D.renderNext24 = function (ctx, fc) {
    const el = $("#next24-strip");
    const tz = fc.timezone;
    const now = Date.now();
    const hours = D.hours(fc).filter((h) => h.t >= now - 3600e3 + 1).slice(0, 24);
    let lastDate = null;
    el.innerHTML = hours
      .map((h, i) => {
        const d = time.localDate(h.t, tz);
        const brk = d !== lastDate && i > 0 ? `<li class="hr-break" aria-hidden="true"><span>${time.weekdayShort(d)} ${time.monthDay(d)}</span></li>` : "";
        lastDate = d;
        const amt = [];
        if (W.conv.precipMm(h.rain) >= (W.units() === "us" ? 0.005 : 0.05)) amt.push(`<span title="Rain in the hour ending at this time">${fmt.precip(h.rain)}</span>`);
        if (W.conv.snowCm(h.snow) >= 0.05) amt.push(`<span title="Snowfall in the hour ending at this time">${fmt.snow(h.snow)} snow</span>`);
        return `${brk}<li class="hr" aria-label="${esc(time.dateTimeLabel(h.t, tz))}: ${fmt.tC(h.temp)}, ${esc(W.wx.desc(h.code))}">
          <span class="hr-time">${i === 0 ? "Now" : time.hourLabel(h.t, tz)}</span>
          ${W.wx.icon(h.code, h.isDay, 32)}
          <span class="hr-temp">${fmt.tC(h.temp, false)}</span>
          <span class="hr-pop">${fmt.pct(h.pop)}</span>
          <span class="hr-amt">${amt.join("") || '<span class="muted">0</span>'}</span>
          <span class="hr-wind"><span class="arrow" style="transform:rotate(${(h.dir + 180) % 360}deg)">↑</span>${Math.round(W.conv.windKmh(h.wind))}</span>
        </li>`;
      })
      .join("");
    $("#next24-units").textContent = `Temperature ${W.u.t()} · precipitation chance · rain or snow in the hour ending at the time shown (${W.u.precip()}) · wind ${W.u.wind()}, arrow shows where it blows`;
  };

  /* ---------- 8. Past seven completed days ---------- */
  D.loadPastWeek = async function (ctx) {
    D._lastCtx = ctx;
    const el = $("#past-week");
    W.setStatus(el, "loading", "Loading observations and archived forecasts…");
    const tz = ctx.tz;
    const today = time.localDate(Date.now(), tz);
    const dates = Array.from({ length: 7 }, (_, i) => time.addDays(today, -7 + i));
    const leads = W.CONFIG.forecastLeads;
    try {
      const series = await W.history.seriesFor(ctx.loc, ctx.signal).catch(() => null);
      // Observation station
      let obs = { station: null, data: {} };
      const stationCands = series && series.obsStation
        ? [{ station: series.obsStation.station, networks: [series.obsStation.network], name: series.obsStation.name }]
        : ctx.loc.countryCode === "US" || !ctx.loc.countryCode
        ? await W.api.findObsStation(ctx.loc, ctx.signal).catch(() => [])
        : [];
      const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
      outer: for (const c of stationCands) {
        for (const net of c.networks) {
          try {
            const parts = await Promise.all(months.map((m) => W.history.iemMonth(c.station, net, Number(m.slice(0, 4)), Number(m.slice(5)))));
            const merged = Object.assign({}, ...parts);
            if (dates.some((d) => merged[d] && merged[d].max != null)) {
              obs = { station: c.name, data: merged };
              break outer;
            }
          } catch (e) { /* try next */ }
        }
      }
      if (!ctx.current()) return;
      // Forecast runs: issue date = valid date − lead
      const runDates = [...new Set(dates.flatMap((d) => leads.map((l) => time.addDays(d, -l))))].sort();
      const runs = {};
      // Open-Meteo rate-limits bursts, so fetch two runs at a time and retry a 429 with backoff.
      const queue = runDates.slice();
      const worker = async () => {
        while (queue.length) {
          const r = queue.shift();
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              runs[r] = await W.api.singleRun(ctx.loc, tz, r, ctx.signal);
              break;
            } catch (e) {
              runs[r] = null;
              if (e.status !== 429 || !ctx.current()) break;
              await new Promise((res) => setTimeout(res, 1500 * 2 ** attempt));
            }
          }
        }
      };
      await Promise.all([worker(), worker()]);
      if (!ctx.current()) return;
      // Calendar-date records for each day
      const recs = {};
      if (series) {
        await Promise.all(
          dates.map((d) =>
            W.history.sameDate(series, d.slice(5), Number(d.slice(0, 4)) - 1)
              .then((sd) => (recs[d] = W.history.records(sd, Number(d.slice(0, 4)))))
              .catch(() => (recs[d] = null))
          )
        );
      }
      if (!ctx.current()) return;
      D._pastWeek = { dates, leads, obs, runs, recs, series, tz };
      D.renderPastWeek();
    } catch (e) {
      if (!ctx.current()) return;
      W.setStatus(el, "error", "Past-week comparison is unavailable right now.", () => D.loadPastWeek(ctx));
    }
  };

  D.renderPastWeek = function () {
    const pw = D._pastWeek;
    if (!pw) return;
    const el = $("#past-week");
    const { dates, leads, obs, runs, recs, series } = pw;
    // Shared scale (°F base) across observations, forecasts and records
    const vals = [];
    dates.forEach((d) => {
      const o = obs.data[d];
      if (o) vals.push(o.max, o.min);
      leads.forEach((l) => {
        const r = runs[time.addDays(d, -l)];
        const v = r && r[d];
        if (v && v.hours >= 23) vals.push(W.conv.cToF(v.max), W.conv.cToF(v.min));
      });
      const rc = recs[d];
      if (rc) vals.push(rc.hi && rc.hi.value, rc.lo && rc.lo.value);
    });
    const clean = vals.filter((v) => v != null && isFinite(v));
    if (!clean.length) {
      W.setStatus(el, "error", "No observations, archived forecasts or records could be loaded for the past seven days.", () => W.dash.loadPastWeek(W.dash._lastCtx));
      return;
    }
    const lo = Math.floor(Math.min(...clean) / 5) * 5, hi = Math.ceil(Math.max(...clean) / 5) * 5;
    const pos = (f) => ((f - lo) / (hi - lo || 1)) * 100;
    const bar = (min, max, cls) =>
      min == null || max == null ? "" : `<span class="cmp-bar ${cls}" style="left:${pos(min)}%;width:${Math.max(0.8, pos(max) - pos(min))}%"></span>`;
    const scaleTicks = W.ticks(W.conv.tempF(lo), W.conv.tempF(hi), 5);
    const tickPos = (v) => pos(W.units() === "us" ? v : W.conv.cToF(v));
    const rows = dates
      .map((d) => {
        const o = obs.data[d];
        const rc = recs[d];
        const fcRows = leads
          .map((l) => {
            const issue = time.addDays(d, -l);
            const r = runs[issue];
            const v = r && r[d] && r[d].hours >= 23 ? r[d] : null;
            return `<div class="cmp-row fc">
              <span class="cmp-label">${l}-day <span class="muted">issued ${time.monthDay(issue)} 00Z</span></span>
              <span class="cmp-track">${v ? bar(W.conv.cToF(v.min), W.conv.cToF(v.max), "bar-fc") : ""}</span>
              <span class="cmp-val">${v ? `${fmt.tC(v.min, false)} / ${fmt.tC(v.max, false)}` : '<span class="unavail">Run unavailable</span>'}</span></div>`;
          })
          .join("");
        return `<li class="cmp-day">
          <div class="cmp-head"><strong>${time.weekdayShort(d)} ${time.monthDay(d)}</strong>
            <span class="muted small">Record ${rc && rc.lo ? `low ${fmt.tF(rc.lo.value)} (${rc.lo.year})` : "low unavailable"} · ${rc && rc.hi ? `high ${fmt.tF(rc.hi.value)} (${rc.hi.year})` : "high unavailable"}</span></div>
          <div class="cmp-row obs">
            <span class="cmp-label">Observed</span>
            <span class="cmp-track">${rc && rc.lo && rc.hi ? `<span class="cmp-rec" style="left:${pos(rc.lo.value)}%;width:${pos(rc.hi.value) - pos(rc.lo.value)}%" title="Record range"></span>` : ""}${o ? bar(o.min, o.max, "bar-obs") : ""}</span>
            <span class="cmp-val">${o && o.max != null ? `${fmt.tF(o.min, false)} / ${fmt.tF(o.max, false)}` : '<span class="unavail">No reading</span>'}</span></div>
          ${fcRows}
        </li>`;
      })
      .join("");
    el.innerHTML = `
      <div class="cmp-scale" aria-hidden="true"><span class="cmp-label"></span><span class="cmp-track">${scaleTicks
        .map((t) => `<span class="cmp-tick" style="left:${tickPos(t)}%">${t}°</span>`)
        .join("")}</span><span class="cmp-val small muted">low / high ${W.u.t()}</span></div>
      <ol class="cmp">${rows}</ol>
      <div class="legend small"><span><i class="sw sw-obs"></i>Observed low–high</span><span><i class="sw sw-fc"></i>GFS forecast low–high</span><span><i class="sw sw-rec"></i>Calendar-date record range</span></div>
      <p class="source">Observed: ${obs.station ? `<strong>${esc(obs.station)}</strong>, daily station measurements from Iowa Environmental Mesonet` : '<span class="unavail">no observation station found</span>'}. Forecasts: NOAA GFS single runs initialized 00 UTC on the issue date (Open-Meteo Single Runs API); each valid day's high and low come from that run's hourly 2 m temperature over the local calendar day. Records: ${series ? esc(series.label) + " via ACIS" : "unavailable"}.</p>`;
  };
})();
