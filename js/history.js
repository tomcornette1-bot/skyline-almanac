/* Station history: which series describes a place, same-date series with gap fills, yearly extremes. */
(function () {
  "use strict";
  const W = window.W;
  const cache = new Map();
  const memo = (key, fn) => {
    if (!cache.has(key)) {
      const p = fn().catch((e) => {
        cache.delete(key);
        throw e;
      });
      cache.set(key, p);
    }
    return cache.get(key);
  };

  const H = (W.history = {});

  // A series for a location: configured city when nearby, else the longest-running nearby ACIS station.
  H.seriesFor = async function (loc, signal) {
    const city = W.CONFIG.historyCities.find((c) => W.haversineKm(loc.lat, loc.lon, c.lat, c.lon) <= c.radiusKm);
    if (city) return { key: city.id, label: city.name, primary: city.primary, fills: city.fills, obsStation: city.obsStation, cityId: city.id };
    if (loc.countryCode && loc.countryCode !== "US") return null;
    const key = "near:" + loc.lat.toFixed(2) + "," + loc.lon.toFixed(2);
    const st = await memo(key, () => W.api.acisNearestStation(loc.lat, loc.lon));
    if (!st) return null;
    return { key: "acis:" + st.sid, label: st.name, primary: { sid: st.sid, name: st.name }, fills: [] };
  };

  H.seriesForCity = function (cityId) {
    const c = W.CONFIG.historyCities.find((x) => x.id === cityId);
    return { key: c.id, label: c.name, primary: c.primary, fills: c.fills, cityId: c.id, color: c.color };
  };

  /* Same calendar date across years, merged from primary + fills.
     Result: { years: {y: {max, min, maxSrc, minSrc}}, sources: [{name, sid, count}], first, last } */
  H.sameDate = function (series, mmdd, lastYear) {
    return memo(`same:${series.key}:${mmdd}:${lastYear}`, async () => {
      const acisSources = [{ sid: series.primary.sid, name: series.primary.name }].concat(series.fills.filter((f) => f.kind === "acis"));
      const results = await Promise.allSettled(acisSources.map((s) => W.api.acisSameDate(s.sid, mmdd, 1850, lastYear)));
      if (results[0].status === "rejected" && results.every((r) => r.status === "rejected")) throw results[0].reason;
      const years = {};
      const counts = new Map();
      const bump = (name) => counts.set(name, (counts.get(name) || 0) + 1);
      results.forEach((r, i) => {
        if (r.status !== "fulfilled") return;
        const src = acisSources[i];
        Object.entries(r.value.rows).forEach(([y, v]) => {
          const row = (years[y] = years[y] || { max: null, min: null, maxSrc: null, minSrc: null });
          if (row.max == null && v.max != null) { row.max = v.max; row.maxSrc = src.name; bump(src.name); }
          if (row.min == null && v.min != null) { row.min = v.min; row.minSrc = src.name; bump(src.name); }
        });
      });
      // IEM daily fills for recent years still missing a value.
      const iemFills = series.fills.filter((f) => f.kind === "iem");
      for (const f of iemFills) {
        const month = parseInt(mmdd.slice(0, 2), 10);
        const missing = [];
        for (let y = lastYear; y >= f.firstYear && missing.length < 12; y--) {
          if (mmdd === "02-29" && !W.time.isLeap(y)) continue;
          const row = years[y];
          if (!row || row.max == null || row.min == null) missing.push(y);
        }
        const got = await Promise.allSettled(missing.map((y) => H.iemMonth(f.station, f.network, y, month)));
        got.forEach((g, i) => {
          if (g.status !== "fulfilled") return;
          const y = missing[i];
          const v = g.value[`${y}-${mmdd}`];
          if (!v) return;
          const row = (years[y] = years[y] || { max: null, min: null, maxSrc: null, minSrc: null });
          if (row.max == null && v.max != null) { row.max = v.max; row.maxSrc = f.name; bump(f.name); }
          if (row.min == null && v.min != null) { row.min = v.min; row.minSrc = f.name; bump(f.name); }
        });
      }
      const ys = Object.keys(years).map(Number).sort((a, b) => a - b);
      const sources = [{ sid: series.primary.sid, name: series.primary.name }]
        .concat(series.fills.map((f) => ({ sid: f.sid || f.station, name: f.name })))
        .map((s) => Object.assign(s, { count: counts.get(s.name) || 0 }))
        .filter((s, i) => i === 0 || s.count > 0);
      return { years, sources, first: ys[0] || null, last: ys[ys.length - 1] || null };
    });
  };

  H.iemMonth = function (station, network, year, month) {
    return memo(`iem:${station}:${network}:${year}:${month}`, () => W.api.iemDaily(station, network, year, month));
  };

  H.yearly = function (series, lastYear) {
    return memo(`yearly:${series.key}:${lastYear}`, async () => {
      const r = await W.api.acisYearly(series.primary.sid, lastYear);
      const ys = Object.keys(r.rows).map(Number).sort((a, b) => a - b);
      return { years: r.rows, sources: [{ sid: series.primary.sid, name: series.primary.name, count: ys.length }], first: ys[0] || null, last: ys[ys.length - 1] || null };
    });
  };

  // Records from a merged same-date series, using only years before `beforeYear`.
  H.records = function (sd, beforeYear) {
    let hi = null, lo = null;
    Object.entries(sd.years).forEach(([y, v]) => {
      y = Number(y);
      if (y >= beforeYear) return;
      if (v.max != null && (!hi || v.max >= hi.value)) hi = { value: v.max, year: y, src: v.maxSrc };
      if (v.min != null && (!lo || v.min <= lo.value)) lo = { value: v.min, year: y, src: v.minSrc };
    });
    return { hi, lo };
  };
})();
