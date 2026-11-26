/* App shell: preferences, location search, favorites, URL state, load orchestration. */
(function () {
  "use strict";
  const W = window.W;
  const { $, $$, esc, store, time } = W;
  const D = W.dash, C = W.charts, M = W.map;

  W.state = {
    units: store.get("units", "us"),
    theme: store.get("theme", "system"),
    compact: store.get("compact", false),
    favorites: store.get("favorites", null) || W.CONFIG.initialFavorites.slice(),
    loc: null, tz: null, gen: 0, ctrl: null, fc: null, aq: null, cachedAt: null,
  };
  const S = W.state;
  C.hist.cities = store.get("histCities", ["winchester", "dc"]);

  /* ---------- Preferences ---------- */
  function applyTheme() {
    const root = document.documentElement;
    if (S.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", S.theme);
    root.toggleAttribute("data-compact", !!S.compact);
    $("#theme").value = S.theme;
    $("#compact").checked = !!S.compact;
  }
  function applyUnits() {
    $$('input[name="units"]').forEach((r) => (r.checked = r.value === S.units));
  }
  function rerenderAll() {
    if (S.fc) {
      const ctx = makeCtx(false);
      D.renderCurrent(ctx, S.fc, S.aq);
      D.renderSevenDay(ctx, S.fc);
      D.renderNext24(ctx, S.fc);
      C.renderHourly(S.fc);
      D.loadToday(ctx);
    }
    D.renderPastWeek();
    C.renderHistory();
    M.renderGrid();
    $("#legend-units").textContent = W.u.t();
    renderTempLegend();
  }
  function renderTempLegend() {
    const stops = [-20, -10, 0, 10, 20, 30, 40];
    $("#map-legend-scale").innerHTML = stops
      .map((c) => `<span style="background:${M.tempColor(c)}">${Math.round(W.conv.tempC(c))}</span>`)
      .join("");
  }

  /* ---------- Favorites ---------- */
  function renderFavorites() {
    const sel = $("#fav-select");
    const active = S.loc && S.loc.zip;
    sel.innerHTML =
      `<option value="">Favorite ZIPs…</option>` +
      S.favorites.map((f) => `<option value="${esc(f.zip)}"${f.zip === active ? " selected" : ""}>${esc(f.zip)} · ${esc(f.label)}</option>`).join("");
    const btn = $("#fav-toggle");
    const isFav = active && S.favorites.some((f) => f.zip === active);
    btn.disabled = !active;
    btn.textContent = isFav ? "Remove ZIP" : "Save ZIP";
    btn.setAttribute("aria-pressed", isFav ? "true" : "false");
    btn.title = active ? (isFav ? `Remove ${active} from favorites` : `Save ${active} to favorites`) : "Favorites hold ZIP codes. Search by ZIP to save this place.";
    $("#fav-chips").innerHTML = S.favorites
      .map((f) => `<button type="button" class="chip${f.zip === active ? " chip-on" : ""}" data-zip="${esc(f.zip)}" aria-pressed="${f.zip === active}">${esc(f.label.split(",")[0])}</button>`)
      .join("");
  }
  function toggleFavorite() {
    const z = S.loc && S.loc.zip;
    if (!z) return;
    const i = S.favorites.findIndex((f) => f.zip === z);
    if (i >= 0) S.favorites.splice(i, 1);
    else S.favorites.push({ zip: z, label: `${S.loc.name}, ${S.loc.region}` });
    store.set("favorites", S.favorites);
    renderFavorites();
    announce(i >= 0 ? `Removed ${z} from favorites.` : `Saved ${z} to favorites.`);
  }
  function announce(msg) {
    $("#live").textContent = msg;
  }

  /* ---------- URL ---------- */
  function locToQuery(loc) {
    if (loc.zip) return "?zip=" + encodeURIComponent(loc.zip);
    const p = new URLSearchParams({ lat: loc.lat.toFixed(4), lon: loc.lon.toFixed(4), name: loc.name, region: loc.region || "", country: loc.country || "", cc: loc.countryCode || "" });
    return "?" + p.toString();
  }
  function locFromUrl() {
    const p = new URLSearchParams(location.search || location.hash.replace(/^#/, ""));
    if (p.get("zip") && /^\d{5}$/.test(p.get("zip"))) return { zip: p.get("zip") };
    const lat = parseFloat(p.get("lat")), lon = parseFloat(p.get("lon"));
    if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
      return { kind: "place", lat, lon, name: p.get("name") || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, region: p.get("region") || "", country: p.get("country") || "", countryCode: p.get("cc") || "" };
    return null;
  }

  /* ---------- Search ---------- */
  async function onSearch(ev) {
    ev.preventDefault();
    const text = $("#search").value.trim();
    const out = $("#search-results");
    out.innerHTML = "";
    if (!text) return;
    if (/^\d+$/.test(text) && text.length !== 5) {
      showSearchError("A U.S. ZIP code has five digits.");
      return;
    }
    if (/^\d{5}$/.test(text)) {
      go({ zip: text });
      return;
    }
    out.innerHTML = '<p class="muted small" role="status">Searching…</p>';
    try {
      const res = await W.api.searchCity(text);
      if (!res.length) return showSearchError(`No place named “${text}” was found. Try adding a state or country, or use a ZIP code.`);
      if (res.length === 1) {
        out.innerHTML = "";
        return go(res[0]);
      }
      out.innerHTML =
        `<p class="small" id="choose-label">${res.length} places match. Choose one:</p><ul class="choices" aria-labelledby="choose-label">` +
        res
          .slice(0, 10)
          .map((r, i) => `<li><button type="button" class="choice" data-i="${i}"><strong>${esc(r.name)}</strong> <span class="muted">${esc([r.region, r.country].filter(Boolean).join(", "))}</span></button></li>`)
          .join("") +
        "</ul>";
      $$(".choice", out).forEach((b) =>
        b.addEventListener("click", () => {
          out.innerHTML = "";
          go(res[Number(b.dataset.i)]);
        })
      );
      $(".choice", out).focus();
    } catch (e) {
      showSearchError("Place search (Open-Meteo Geocoding) is unavailable right now. A ZIP code may still work.");
    }
  }
  function showSearchError(msg) {
    const out = $("#search-results");
    out.innerHTML = "";
    const p = document.createElement("p");
    p.className = "search-error";
    p.setAttribute("role", "alert");
    p.textContent = msg;
    out.appendChild(p);
  }

  /* ---------- Loading a location ---------- */
  function makeCtx(fresh) {
    if (fresh) {
      if (S.ctrl) S.ctrl.abort();
      S.ctrl = new AbortController();
      S.gen++;
    }
    const gen = S.gen;
    return { loc: S.loc, tz: S.tz, signal: S.ctrl && S.ctrl.signal, gen, current: () => gen === S.gen, cachedAt: S.cachedAt };
  }

  async function go(target, { push = true } = {}) {
    let loc = target;
    if (target.zip && target.lat == null) {
      const ctx0 = makeCtx(true);
      $("#place-name").textContent = "ZIP " + target.zip;
      $("#place-sub").textContent = "Looking up ZIP code…";
      try {
        loc = await W.api.zip(target.zip, ctx0.signal);
      } catch (e) {
        if (!ctx0.current()) return;
        if (e.userFacing) {
          showSearchError(e.message);
          if (!S.loc) go({ zip: W.CONFIG.defaultZip }, { push: false });
          else { D.renderHeader(S.loc, S.tz); }
          return;
        }
        $("#place-sub").textContent = "The ZIP lookup service (Zippopotam.us) is unavailable.";
        W.setStatus($("#current"), "error", "Couldn't look up that ZIP code because the ZIP service did not respond.", () => go(target, { push }));
        return;
      }
      if (!ctx0.current()) return;
    }
    S.loc = loc;
    if (push) history.pushState(null, "", locToQuery(loc));
    else history.replaceState(null, "", locToQuery(loc));
    store.set("lastLoc", loc.zip ? { zip: loc.zip } : loc);
    load();
  }

  async function load() {
    const ctx = makeCtx(true);
    S.tz = null; S.fc = null; S.aq = null; S.cachedAt = null;
    D._pastWeek = null;
    D.renderHeader(S.loc, null);
    document.title = `${S.loc.name} · ${W.CONFIG.appName}`;
    renderFavorites();
    M.setLocation(S.loc);
    D.loadAlerts(ctx);
    ["#current", "#seven-day", "#hourly-chart"].forEach((s) => W.setStatus($(s), "loading", "Loading forecast…"));
    $("#next24-strip").innerHTML = "";
    W.setStatus($("#today-history"), "loading", "Waiting for local date…");
    W.setStatus($("#past-week"), "loading", "Waiting for local date…");
    const key = "fc:" + S.loc.lat.toFixed(3) + "," + S.loc.lon.toFixed(3);
    const [fcR, aqR] = await Promise.allSettled([W.api.forecast(S.loc, ctx.signal), W.api.airQuality(S.loc, ctx.signal)]);
    if (!ctx.current()) return;
    let fc = fcR.status === "fulfilled" ? fcR.value : null;
    if (fc) {
      saveCache(key, fc);
    } else {
      const cached = store.get(key, null);
      if (cached && time.localDate(Date.now(), cached.fc.timezone) === cached.localDate) {
        fc = cached.fc;
        S.cachedAt = cached.at;
      }
    }
    if (!fc) {
      const retry = () => load();
      W.setStatus($("#current"), "error", "The forecast service (Open-Meteo) is unavailable, and no saved forecast from today exists for this place.", retry);
      W.setStatus($("#seven-day"), "error", "Seven-day forecast unavailable.", retry);
      W.setStatus($("#hourly-chart"), "error", "Hourly data unavailable.", retry);
      $("#next24-strip").innerHTML = '<li class="status status-error">Hourly forecast unavailable.</li>';
      // Time zone fallback so history sections can still work
      S.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } else {
      S.fc = fc;
      S.tz = fc.timezone;
      S.aq = aqR.status === "fulfilled" ? aqR.value : null;
    }
    const ctx2 = makeCtx(false);
    D.renderHeader(S.loc, S.tz);
    if (S.fc) {
      D.renderCurrent(ctx2, S.fc, S.aq);
      D.renderSevenDay(ctx2, S.fc);
      D.renderNext24(ctx2, S.fc);
      C.hourly.idx = null;
      C.renderHourly(S.fc);
      if (S.cachedAt) announce("Showing a saved forecast because the forecast service did not respond.");
    }
    M.setFrame(M.idx);
    D.loadToday(ctx2);
    D.loadPastWeek(ctx2);
    if (C.hist.mmdd !== time.localDate(Date.now(), S.tz).slice(5) || !C.hist.thisYear) C.loadHistory(ctx2);
    else C.renderHistory();
  }

  function saveCache(key, fc) {
    try {
      const keys = store.get("fcKeys", []).filter((k) => k !== key);
      keys.unshift(key);
      keys.slice(3).forEach((k) => localStorage.removeItem("skyline:" + k));
      store.set("fcKeys", keys.slice(0, 3));
      store.set(key, { fc, at: Date.now(), localDate: time.localDate(Date.now(), fc.timezone) });
    } catch (e) { /* ignore */ }
  }

  /* ---------- Wiring ---------- */
  function wire() {
    $("#search-form").addEventListener("submit", onSearch);
    $("#fav-select").addEventListener("change", (e) => e.target.value && go({ zip: e.target.value }));
    $("#fav-toggle").addEventListener("click", toggleFavorite);
    $("#fav-chips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-zip]");
      if (b) go({ zip: b.dataset.zip });
    });
    $$('input[name="units"]').forEach((r) =>
      r.addEventListener("change", () => {
        S.units = r.value;
        store.set("units", S.units);
        rerenderAll();
      })
    );
    $("#theme").addEventListener("change", (e) => {
      S.theme = e.target.value;
      store.set("theme", S.theme);
      applyTheme();
    });
    $("#compact").addEventListener("change", (e) => {
      S.compact = e.target.checked;
      store.set("compact", S.compact);
      applyTheme();
      rerenderAll();
    });
    // Next 24 h strip scroll controls
    const strip = $("#next24-strip");
    const step = () => Math.max(120, strip.clientWidth * 0.6);
    $("#next24-prev").addEventListener("click", () => strip.scrollBy({ left: -step(), behavior: "smooth" }));
    $("#next24-next").addEventListener("click", () => strip.scrollBy({ left: step(), behavior: "smooth" }));
    strip.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { strip.scrollBy({ left: 90 }); e.preventDefault(); }
      if (e.key === "ArrowLeft") { strip.scrollBy({ left: -90 }); e.preventDefault(); }
      if (e.key === "Home") { strip.scrollTo({ left: 0 }); e.preventDefault(); }
      if (e.key === "End") { strip.scrollTo({ left: strip.scrollWidth }); e.preventDefault(); }
    });
    // Hourly chart
    $$('input[name="hrange"]').forEach((r) =>
      r.addEventListener("change", () => {
        C.hourly.range = r.value;
        C.hourly.idx = null;
        C.renderHourly();
      })
    );
    ["temp", "rh", "pres"].forEach((k) => {
      const cb = $("#hv-" + k);
      cb.checked = C.hourly.vars[k];
      cb.addEventListener("change", () => {
        C.hourly.vars[k] = cb.checked;
        C.renderHourly();
      });
    });
    $("#hourly-slider").addEventListener("input", (e) => {
      C.hourly.idx = Number(e.target.value);
      C.renderHourly();
    });
    // Historical chart
    const citySel = $("#hist-city");
    citySel.value = C.hist.cities.length === 2 ? "both" : C.hist.cities[0];
    citySel.addEventListener("change", () => {
      C.hist.cities = citySel.value === "both" ? ["winchester", "dc"] : [citySel.value];
      store.set("histCities", C.hist.cities);
      C.loadHistory({ tz: S.tz || "America/New_York" });
    });
    $$('input[name="hmode"]').forEach((r) =>
      r.addEventListener("change", () => {
        C.hist.mode = r.value;
        C.loadHistory({ tz: S.tz || "America/New_York" });
      })
    );
    $("#hist-year").addEventListener("input", (e) => {
      C.hist.year = Number(e.target.value);
      C.renderHistory();
    });
    let rz;
    window.addEventListener("resize", () => {
      clearTimeout(rz);
      rz = setTimeout(() => {
        C.renderHourly();
        C.renderHistory();
      }, 200);
    });
    window.addEventListener("popstate", () => {
      const l = locFromUrl();
      if (l) go(l, { push: false });
    });
  }

  function start() {
    applyTheme();
    applyUnits();
    wire();
    M.init();
    renderTempLegend();
    $("#legend-units").textContent = W.u.t();
    const fromUrl = locFromUrl();
    const last = store.get("lastLoc", null);
    go(fromUrl || last || { zip: W.CONFIG.defaultZip }, { push: false });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
