/* Hourly weather chart and the long-term historical temperature chart (inline SVG). */
(function () {
  "use strict";
  const W = window.W;
  const { $, esc, fmt, time } = W;
  const C = (W.charts = {});
  const svgNS = 'xmlns="http://www.w3.org/2000/svg"';

  function pathFrom(points, xs, ys) {
    // points: [{x, y|null}] → path with gaps
    let d = "", pen = false;
    points.forEach((p) => {
      if (p.y == null || !isFinite(p.y)) { pen = false; return; }
      d += (pen ? "L" : "M") + xs(p.x).toFixed(1) + " " + ys(p.y).toFixed(1);
      pen = true;
    });
    return d;
  }

  /* ---------- 6. Hourly chart ---------- */
  const VARS = {
    temp: { label: "Temperature", unit: () => W.u.t(), get: (h) => W.conv.tempC(h.temp), color: "var(--series-1)", dec: 0 },
    rh: { label: "Relative humidity", unit: () => "%", get: (h) => h.rh, color: "var(--series-2)", dec: 0, fixed: [0, 100] },
    pres: { label: "Pressure (mean sea level)", unit: () => "hPa", get: (h) => h.pres, color: "var(--series-3)", dec: 1 },
  };
  C.hourly = { range: "next7", vars: { temp: true, rh: false, pres: false }, idx: null };

  C.renderHourly = function (fc) {
    if (fc) C._fc = fc;
    fc = C._fc;
    const wrap = $("#hourly-chart");
    if (!fc) return;
    const tz = fc.timezone;
    const now = Date.now();
    const all = W.dash.hours(fc);
    const r = C.hourly.range;
    const span = { last24: 24, last3: 72, prev7: 168, next7: 168 }[r];
    const startT = r === "next7" ? now - 3600e3 : now - span * 3600e3;
    const endT = r === "next7" ? now + span * 3600e3 : now;
    const hrs = all.filter((h) => h.t >= startT && h.t <= endT);
    if (!hrs.length) {
      W.setStatus(wrap, "empty", "No hourly data covers this range.");
      return;
    }
    const enabled = Object.keys(VARS).filter((k) => C.hourly.vars[k]);
    if (!enabled.length) {
      W.setStatus(wrap, "empty", "Turn on at least one variable to draw the chart.");
      return;
    }
    if (C.hourly.idx == null || C.hourly.idx >= hrs.length) {
      // default to the hour nearest now
      let best = 0;
      hrs.forEach((h, i) => { if (Math.abs(h.t - now) < Math.abs(hrs[best].t - now)) best = i; });
      C.hourly.idx = best;
    }
    const width = Math.max(300, wrap.clientWidth || 600);
    const panelH = W.state.compact ? 110 : 140;
    const m = { l: 46, r: 14, t: 18, b: 24 };
    const height = enabled.length * panelH + m.b;
    const x0 = hrs[0].t, x1 = hrs[hrs.length - 1].t;
    const xs = (t) => m.l + ((t - x0) / (x1 - x0 || 1)) * (width - m.l - m.r);
    // x ticks at local midnights (or every 6 h for 24 h)
    const xt = [];
    hrs.forEach((h) => {
      const hr = time.localHour(h.t, tz);
      if (span <= 24 ? hr % 6 === 0 : span <= 72 ? hr % 12 === 0 : hr === 0) xt.push(h);
    });
    const nowX = now >= x0 && now <= x1 ? xs(now) : null;
    let svg = `<svg ${svgNS} viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Hourly chart">`;
    // past-modeled shading
    const pastEnd = Math.min(now, x1);
    if (pastEnd > x0) {
      svg += `<rect x="${m.l}" y="0" width="${xs(pastEnd) - m.l}" height="${height - m.b}" fill="var(--past-shade)"/>`;
      if (r !== "next7") svg += `<text x="${xs(pastEnd) - 4}" y="${height - m.b - 6}" text-anchor="end" class="ch-note">Past: modeled estimate</text>`;
    }
    enabled.forEach((k, pi) => {
      const v = VARS[k];
      const top = pi * panelH + m.t, bot = (pi + 1) * panelH - 6;
      const vals = hrs.map((h) => v.get(h)).filter((x) => x != null);
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (v.fixed) [lo, hi] = v.fixed;
      else { const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad; }
      const ys = (y) => bot - ((y - lo) / (hi - lo || 1)) * (bot - top);
      W.ticks(lo, hi, 3).forEach((t) => {
        svg += `<line x1="${m.l}" x2="${width - m.r}" y1="${ys(t)}" y2="${ys(t)}" class="ch-grid"/>`;
        svg += `<text x="${m.l - 6}" y="${ys(t) + 4}" text-anchor="end" class="ch-tick">${t}</text>`;
      });
      svg += `<text x="${m.l}" y="${top - 4}" class="ch-title">${esc(v.label)} (${esc(v.unit())})</text>`;
      const pts = hrs.map((h) => ({ x: h.t, y: v.get(h) }));
      svg += `<path d="${pathFrom(pts, xs, ys)}" fill="none" stroke="${v.color}" stroke-width="2"/>`;
      const sel = hrs[C.hourly.idx];
      const sv = v.get(sel);
      if (sv != null) svg += `<circle cx="${xs(sel.t)}" cy="${ys(sv)}" r="4" fill="${v.color}" stroke="var(--surface)" stroke-width="2"/>`;
    });
    xt.forEach((h) => {
      const x = xs(h.t);
      svg += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${height - m.b}" class="ch-grid ch-vgrid"/>`;
      const lbl = span <= 72 && time.localHour(h.t, tz) !== 0 ? time.hourLabel(h.t, tz) : time.weekdayShort(time.localDate(h.t, tz)) + " " + time.monthDay(time.localDate(h.t, tz)).split(" ")[1];
      svg += `<text x="${x}" y="${height - 6}" text-anchor="middle" class="ch-tick">${esc(lbl)}</text>`;
    });
    if (nowX != null) svg += `<line x1="${nowX}" x2="${nowX}" y1="0" y2="${height - m.b}" class="ch-now"/>`;
    const sx = xs(hrs[C.hourly.idx].t);
    svg += `<line x1="${sx}" x2="${sx}" y1="${m.t}" y2="${height - m.b}" class="ch-sel"/>`;
    svg += "</svg>";
    wrap.innerHTML = svg;
    // slider
    const slider = $("#hourly-slider");
    slider.min = 0;
    slider.max = hrs.length - 1;
    slider.value = C.hourly.idx;
    const sel = hrs[C.hourly.idx];
    const past = sel.t < now;
    const parts = enabled.map((k) => {
      const v = VARS[k];
      const val = v.get(sel);
      return `<span><span class="sw" style="background:${v.color}"></span>${esc(v.label)} <strong>${val == null ? "—" : val.toFixed(k === "temp" ? 1 : v.dec)} ${esc(v.unit())}</strong></span>`;
    });
    const text = `${time.dateTimeLabel(sel.t, tz)} · ${past ? "modeled" : "forecast"}`;
    slider.setAttribute("aria-valuetext", text + ", " + enabled.map((k) => VARS[k].label + " " + (VARS[k].get(sel) ?? "unavailable")).join(", "));
    $("#hourly-readout").innerHTML = `<strong>${esc(time.dateTimeLabel(sel.t, tz))}</strong> <span class="tag ${past ? "tag-modeled" : "tag-fc"}">${past ? "Modeled" : "Forecast"}</span> ${parts.join("")}`;
  };

  /* ---------- 9. Historical temperature chart ---------- */
  C.hist = { cities: ["winchester", "dc"], mode: "high", year: null, data: {}, status: {} };

  C.loadHistory = async function (ctx) {
    const tz = ctx.tz;
    const today = time.localDate(Date.now(), tz);
    const year = Number(today.slice(0, 4));
    const mmdd = today.slice(5);
    C.hist.mmdd = mmdd;
    C.hist.thisYear = year;
    const gen = (C.hist.gen = (C.hist.gen || 0) + 1);
    const wanted = C.hist.cities;
    const el = $("#hist-chart");
    W.setStatus(el, "loading", "Loading station records from ACIS…");
    await Promise.all(
      wanted.map(async (id) => {
        const key = `${id}:${C.hist.mode}:${mmdd}`;
        if (C.hist.data[key]) return;
        const series = W.history.seriesForCity(id);
        try {
          const d = C.hist.mode === "yearly" ? await W.history.yearly(series, year - 1) : await W.history.sameDate(series, mmdd, year - 1);
          C.hist.data[key] = { series, d };
        } catch (e) {
          C.hist.data[key] = { series, error: true };
        }
      })
    );
    if (gen !== C.hist.gen) return;
    C.renderHistory();
  };

  C.renderHistory = function () {
    const el = $("#hist-chart");
    const h = C.hist;
    const entries = h.cities.map((id) => h.data[`${id}:${h.mode}:${h.mmdd}`]).filter(Boolean);
    if (!entries.length) return;
    const ok = entries.filter((e) => !e.error);
    const failed = entries.filter((e) => e.error);
    if (!ok.length) {
      W.setStatus(el, "error", "Station history from ACIS is unavailable right now.", () => {
        failed.forEach((f) => delete h.data[`${f.series.cityId}:${h.mode}:${h.mmdd}`]);
        C.loadHistory({ tz: W.state.tz });
      });
      $("#hist-readout").innerHTML = "";
      $("#hist-notes").innerHTML = "";
      return;
    }
    const isYearly = h.mode === "yearly";
    // Build series in display units; keep original precision
    const lines = [];
    ok.forEach((e) => {
      const yrs = e.d.years;
      const color = e.series.color;
      const mk = (field) =>
        Object.keys(yrs).map(Number).sort((a, b) => a - b).map((y) => ({ x: y, raw: yrs[y][field], y: yrs[y][field] == null ? null : W.conv.tempF(yrs[y][field]) }));
      if (isYearly) {
        lines.push({ city: e, kind: "max", pts: mk("max"), color, dash: false, label: e.series.label + " yearly high" });
        lines.push({ city: e, kind: "min", pts: mk("min"), color, dash: true, label: e.series.label + " yearly low" });
      } else {
        const f = h.mode === "high" ? "max" : "min";
        lines.push({ city: e, kind: f, pts: mk(f), color, dash: false, label: e.series.label });
      }
    });
    const allPts = lines.flatMap((l) => l.pts.filter((p) => p.y != null));
    const xMin = Math.min(...allPts.map((p) => p.x)), xMax = Math.max(...allPts.map((p) => p.x));
    let yMin = Math.min(...allPts.map((p) => p.y)), yMax = Math.max(...allPts.map((p) => p.y));
    const pad = (yMax - yMin) * 0.08 || 2;
    yMin -= pad; yMax += pad;
    const width = Math.max(300, el.clientWidth || 700);
    const height = W.state.compact ? 260 : 320;
    const m = { l: 44, r: 14, t: 14, b: 28 };
    const xs = (x) => m.l + ((x - xMin) / (xMax - xMin || 1)) * (width - m.l - m.r);
    const ys = (y) => height - m.b - ((y - yMin) / (yMax - yMin || 1)) * (height - m.t - m.b);
    if (h.year == null || h.year < xMin || h.year > xMax) h.year = xMax;
    let svg = `<svg ${svgNS} viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Historical temperatures chart">`;
    W.ticks(yMin, yMax, 5).forEach((t) => {
      svg += `<line x1="${m.l}" x2="${width - m.r}" y1="${ys(t)}" y2="${ys(t)}" class="ch-grid"/><text x="${m.l - 6}" y="${ys(t) + 4}" text-anchor="end" class="ch-tick">${t}°</text>`;
    });
    W.ticks(xMin, xMax, width < 500 ? 4 : 8).filter((t) => Number.isInteger(t)).forEach((t) => {
      svg += `<line x1="${xs(t)}" x2="${xs(t)}" y1="${m.t}" y2="${height - m.b}" class="ch-grid ch-vgrid"/><text x="${xs(t)}" y="${height - 8}" text-anchor="middle" class="ch-tick">${t}</text>`;
    });
    // gaps: break line where consecutive years are missing
    lines.forEach((l) => {
      const filled = [];
      for (let y = xMin; y <= xMax; y++) {
        if (h.mmdd === "02-29" && !isYearly && !W.time.isLeap(y)) continue;
        const p = l.pts.find((q) => q.x === y);
        filled.push({ x: y, y: p ? p.y : null });
      }
      svg += `<path d="${pathFrom(filled, xs, ys)}" fill="none" stroke="${l.color}" stroke-width="1.5" ${l.dash ? 'stroke-dasharray="5 3"' : ""} opacity="0.9"/>`;
      if (!isYearly) l.pts.forEach((p) => { if (p.y != null) svg += `<circle cx="${xs(p.x)}" cy="${ys(p.y)}" r="2" fill="${l.color}"/>`; });
      if (!isYearly) {
        const fit = W.linfit(l.pts.filter((p) => p.y != null).map((p) => ({ x: p.x, y: p.y })));
        l.fit = fit;
        if (fit) {
          const a = l.pts.find((p) => p.y != null).x, b = [...l.pts].reverse().find((p) => p.y != null).x;
          svg += `<line x1="${xs(a)}" y1="${ys(fit.m * a + fit.b)}" x2="${xs(b)}" y2="${ys(fit.m * b + fit.b)}" stroke="${l.color}" stroke-width="2" stroke-dasharray="7 5" class="trend"/>`;
        }
      }
    });
    svg += `<line x1="${xs(h.year)}" x2="${xs(h.year)}" y1="${m.t}" y2="${height - m.b}" class="ch-sel"/>`;
    lines.forEach((l) => {
      const p = l.pts.find((q) => q.x === h.year);
      if (p && p.y != null) svg += `<circle cx="${xs(p.x)}" cy="${ys(p.y)}" r="4.5" fill="${l.color}" stroke="var(--surface)" stroke-width="2"/>`;
    });
    svg += "</svg>";
    el.innerHTML = svg;
    // Legend
    $("#hist-legend").innerHTML = ok
      .map((e) => `<span><i class="sw" style="background:${e.series.color}"></i>${esc(e.series.label)}</span>`)
      .join("") + (isYearly
        ? '<span><i class="sw-line"></i>High</span><span><i class="sw-line dashed"></i>Low</span>'
        : '<span><i class="sw-line dashed thick"></i>Linear trend (least squares)</span>');
    // Year slider + readout
    const slider = $("#hist-year");
    slider.min = xMin; slider.max = xMax; slider.value = h.year;
    const readParts = ok.map((e) => {
      const r = e.d.years[h.year];
      const name = esc(e.series.label);
      if (isYearly) {
        if (!r) return `<div><strong>${name}</strong>: <span class="unavail">no readings in ${h.year}</span></div>`;
        return `<div><strong>${name}</strong>: high ${r.max == null ? '<span class="unavail">unavailable</span>' : `${fmt.tF(r.max)} on ${esc(time.fullDate(r.maxDate))}`}, low ${r.min == null ? '<span class="unavail">unavailable</span>' : `${fmt.tF(r.min)} on ${esc(time.fullDate(r.minDate))}`}${r.maxMissing ? ` <span class="muted small">(${r.maxMissing} day${r.maxMissing === 1 ? "" : "s"} missing)</span>` : ""}</div>`;
      }
      const f = h.mode === "high" ? "max" : "min";
      const v = r && r[f];
      return `<div><strong>${name}</strong>: ${v == null ? `<span class="unavail">no reading</span>` : fmt.tF(v)}${v != null && r[f + "Src"] !== e.series.primary.name ? ` <span class="muted small">(${esc(r[f + "Src"])})</span>` : ""}</div>`;
    });
    const what = isYearly ? `Calendar year ${h.year}` : `${time.monthDay(`${h.year}-${h.mmdd}`)}, ${h.year}`;
    $("#hist-readout").innerHTML = `<div class="readout-year">${esc(what)}</div>${readParts.join("")}`;
    slider.setAttribute("aria-valuetext", `${h.year}: ` + $("#hist-readout").textContent.replace(/\s+/g, " "));
    // Provenance
    const notes = ok.map((e) => {
      const trend = lines.find((l) => l.city === e && l.fit);
      const n = Object.values(e.d.years).filter((r) => r[isYearly ? "max" : h.mode === "high" ? "max" : "min"] != null).length;
      return `<li><strong>${esc(e.series.label)}</strong>: ${e.d.first}–${e.d.last}, ${n} years with readings. Stations: ${e.d.sources.map((s) => `${esc(s.name)} (${esc(s.sid)}${e.d.sources.length > 1 ? `, ${s.count} values` : ""})`).join("; ")}.${trend ? ` Trend ${trend.fit.m * 100 >= 0 ? "+" : ""}${(trend.fit.m * 100).toFixed(1)}° per century.` : ""}</li>`;
    });
    failed.forEach((f) => notes.push(`<li><strong>${esc(f.series.label)}</strong>: <span class="unavail">ACIS data unavailable</span></li>`));
    $("#hist-notes").innerHTML = `<ul>${notes.join("")}</ul><p>${isYearly
      ? "Highest daily maximum and lowest daily minimum among available readings in each completed calendar year (primary station only). Years with many missing days may understate extremes."
      : `One observed daily ${h.mode === "high" ? "maximum" : "minimum"} for ${esc(time.monthDay(`2000-${h.mmdd}`))} in each past year. Missing years are left as gaps and excluded from the trend.`} Data: ACIS Web Services${ok.some((e) => e.series.fills.some((f) => f.kind === "iem")) && !isYearly ? " and Iowa Environmental Mesonet" : ""}.</p>`;
  };
})();
