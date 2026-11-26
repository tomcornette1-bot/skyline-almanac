/* Radar and modeled map layers (Leaflet). */
(function () {
  "use strict";
  const W = window.W;
  const { $, esc, fmt, time } = W;
  const M = (W.map = {
    map: null, marker: null, frames: [], idx: 0, playing: false, timer: null,
    radarLayers: new Map(), grid: null, gridGen: 0,
    layersOn: { radar: true, wind: false, temp: false, total: false },
  });

  M.init = function () {
    if (!window.L) {
      W.setStatus($("#map"), "error", "The map library (Leaflet) failed to load, so the map is unavailable.");
      $("#map-controls").hidden = true;
      return;
    }
    const map = (M.map = L.map("map", { zoomControl: true, scrollWheelZoom: false, keyboard: true, attributionControl: true }));
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.attributionControl.addAttribution('Radar <a href="https://www.rainviewer.com/api.html">RainViewer</a> · HRRR <a href="https://mesonet.agron.iastate.edu/">IEM</a> · Model <a href="https://open-meteo.com/">Open-Meteo</a>');
    M.radarPane = map.createPane("radar");
    M.radarPane.style.zIndex = 350;
    M.windGroup = L.layerGroup();
    M.tempGroup = L.layerGroup();
    M.totalGroup = L.layerGroup();
    map.setView([39.18, -78.16], 8);
    let deb;
    map.on("moveend", () => {
      clearTimeout(deb);
      deb = setTimeout(M.loadGrid, 500);
    });
    // controls
    ["radar", "wind", "temp", "total"].forEach((k) => {
      const cb = $("#layer-" + k);
      cb.checked = M.layersOn[k];
      cb.addEventListener("change", () => {
        M.layersOn[k] = cb.checked;
        M.applyLayers();
      });
    });
    $("#radar-play").addEventListener("click", M.togglePlay);
    $("#radar-slider").addEventListener("input", (e) => M.setFrame(Number(e.target.value)));
    $("#radar-forecast").addEventListener("click", () => {
      const i = M.frames.findIndex((f) => f.kind === "fc");
      if (i >= 0) { M.stop(); M.setFrame(i); }
    });
    $("#radar-now").addEventListener("click", () => {
      M.stop();
      M.setFrame(M.lastObsIndex());
    });
  };

  M.setLocation = function (loc) {
    if (!M.map) return;
    M.loc = loc;
    if (M.marker) M.marker.remove();
    M.marker = L.marker([loc.lat, loc.lon], { title: loc.name, keyboard: true, alt: "Selected place: " + loc.name })
      .addTo(M.map)
      .bindPopup(esc(loc.name));
    M.map.setView([loc.lat, loc.lon], 8);
    if (!M.frames.length) M.loadFrames();
    M.loadGrid();
  };

  M.lastObsIndex = () => {
    let i = -1;
    M.frames.forEach((f, j) => { if (f.kind === "obs") i = j; });
    return i >= 0 ? i : 0;
  };

  /* ---------- Frames ---------- */
  M.loadFrames = async function () {
    const status = $("#radar-status");
    status.textContent = "Loading radar frames…";
    const frames = [];
    let obsErr = false, fcErr = false;
    try {
      const rv = await W.api.rainviewer();
      (rv.radar.past || []).forEach((f) =>
        frames.push({ t: f.time * 1000, kind: "obs", url: `${rv.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, maxNativeZoom: 7, src: "RainViewer" })
      );
      (rv.radar.nowcast || []).forEach((f) =>
        frames.push({ t: f.time * 1000, kind: "fc", url: `${rv.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, maxNativeZoom: 7, src: "RainViewer nowcast" })
      );
    } catch (e) {
      obsErr = true;
    }
    // HRRR forecast reflectivity (contiguous U.S.)
    try {
      const meta = await W.api.hrrrMeta();
      const init = Date.parse(meta.model_init_utc || meta.valid || meta.generation_time);
      if (!isFinite(init)) throw new Error("no init time");
      const lastObs = frames.filter((f) => f.kind === "obs").reduce((a, f) => Math.max(a, f.t), Date.now() - 10 * 60e3);
      for (let min = 15; min <= 18 * 60; min += min < 120 ? 15 : 60) {
        const t = init + min * 60e3;
        if (t <= lastObs) continue;
        if (t > Date.now() + 8 * 3600e3) break;
        frames.push({ t, kind: "fc", url: W.api.hrrrTileUrl(min), src: `HRRR run ${new Date(init).toISOString().slice(11, 16)} UTC`, maxNativeZoom: 10 });
      }
    } catch (e) {
      fcErr = true;
    }
    frames.sort((a, b) => a.t - b.t);
    if (!frames.length) {
      // Keep modeled layers usable on a model-hour timeline
      const h0 = Math.floor(Date.now() / 3600e3) * 3600e3;
      for (let k = -3; k <= 12; k++) frames.push({ t: h0 + k * 3600e3, kind: k <= 0 ? "model-past" : "model", url: null });
    }
    M.frames = frames;
    const msgs = [];
    if (obsErr) msgs.push("Observed radar (RainViewer) is unavailable.");
    if (fcErr) msgs.push("Forecast radar (HRRR) is unavailable" + (M.loc && M.loc.countryCode && M.loc.countryCode !== "US" ? " outside the U.S." : "."));
    status.textContent = msgs.join(" ");
    status.classList.toggle("unavail", msgs.length > 0);
    const s = $("#radar-slider");
    s.min = 0;
    s.max = frames.length - 1;
    $("#radar-forecast").disabled = !frames.some((f) => f.kind === "fc");
    M.setFrame(M.lastObsIndex());
  };

  M.setFrame = function (i) {
    if (!M.frames.length) return;
    M.idx = Math.max(0, Math.min(M.frames.length - 1, i));
    const f = M.frames[M.idx];
    $("#radar-slider").value = M.idx;
    const tz = W.state.tz || "UTC";
    const kindLabel = { obs: "Observed radar", fc: "Forecast radar", "model-past": "Model hour (past)", model: "Model hour" }[f.kind];
    const lbl = $("#radar-label");
    lbl.innerHTML = `<span class="tag ${f.kind === "obs" ? "tag-obs" : "tag-fc"}">${kindLabel}</span> <strong>${esc(time.dateTimeLabel(f.t, tz))}</strong>${f.src ? ` <span class="muted small">${esc(f.src)}</span>` : ""}`;
    $("#radar-slider").setAttribute("aria-valuetext", `${kindLabel}, ${time.dateTimeLabel(f.t, tz)}`);
    M.showRadar();
    M.renderGrid();
  };

  M.showRadar = function () {
    if (!M.map) return;
    const f = M.frames[M.idx];
    M.radarLayers.forEach((layer, key) => {
      layer.setOpacity(M.layersOn.radar && f && key === f.url ? 0.72 : 0);
    });
    if (!M.layersOn.radar || !f || !f.url) return;
    if (!M.radarLayers.has(f.url)) {
      const layer = L.tileLayer(f.url, { pane: "radar", opacity: 0.72, maxNativeZoom: f.maxNativeZoom || 10, maxZoom: 18, tileSize: 256, crossOrigin: false });
      layer.on("tileerror", () => {
        $("#radar-status").textContent = "Some radar tiles failed to load for this frame.";
      });
      layer.addTo(M.map);
      M.radarLayers.set(f.url, layer);
      // keep at most 8 frames loaded
      if (M.radarLayers.size > 8) {
        const [oldKey, oldLayer] = M.radarLayers.entries().next().value;
        oldLayer.remove();
        M.radarLayers.delete(oldKey);
      }
    }
  };

  M.togglePlay = function () {
    if (M.playing) return M.stop();
    M.playing = true;
    $("#radar-play").textContent = "Pause";
    $("#radar-play").setAttribute("aria-pressed", "true");
    M.timer = setInterval(() => M.setFrame(M.idx >= M.frames.length - 1 ? 0 : M.idx + 1), 700);
  };
  M.stop = function () {
    M.playing = false;
    clearInterval(M.timer);
    $("#radar-play").textContent = "Play";
    $("#radar-play").setAttribute("aria-pressed", "false");
  };

  M.applyLayers = function () {
    if (!M.map) return;
    [["wind", M.windGroup], ["temp", M.tempGroup], ["total", M.totalGroup]].forEach(([k, g]) => {
      if (M.layersOn[k]) g.addTo(M.map);
      else g.remove();
    });
    M.showRadar();
    M.renderGrid();
    $("#map-legend").hidden = !M.layersOn.temp;
  };

  /* ---------- Modeled sample grid ---------- */
  M.loadGrid = async function () {
    if (!M.map) return;
    const gen = ++M.gridGen;
    const b = M.map.getBounds();
    const size = M.map.getSize();
    const cols = size.x < 500 ? 4 : 6, rows = size.y < 350 ? 3 : 4;
    const lats = [], lons = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        lats.push(b.getSouth() + ((r + 0.5) / rows) * (b.getNorth() - b.getSouth()));
        lons.push(b.getWest() + ((c + 0.5) / cols) * (b.getEast() - b.getWest()));
      }
    $("#grid-status").textContent = "Sampling model values across the map…";
    try {
      const data = await W.api.grid(lats, lons);
      if (gen !== M.gridGen) return;
      M.grid = data.map((d, i) => ({ lat: lats[i], lon: lons[i], h: d.hourly }));
      $("#grid-status").textContent = "";
      $("#grid-status").classList.remove("unavail");
    } catch (e) {
      if (gen !== M.gridGen) return;
      M.grid = null;
      $("#grid-status").textContent = "Modeled wind, temperature and 24-hour totals are unavailable right now (Open-Meteo did not respond).";
      $("#grid-status").classList.add("unavail");
    }
    M.renderGrid();
  };

  function tempColor(c) {
    // −20 °C .. 40 °C onto a blue → red ramp
    const stops = [[-20, [94, 60, 153]], [-10, [59, 106, 191]], [0, [73, 160, 207]], [10, [117, 186, 120]], [20, [240, 196, 79]], [30, [232, 120, 55]], [40, [190, 40, 45]]];
    if (c <= stops[0][0]) return `rgb(${stops[0][1]})`;
    for (let i = 1; i < stops.length; i++) {
      if (c <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [bb, cb] = stops[i];
        const k = (c - a) / (bb - a);
        return `rgb(${ca.map((v, j) => Math.round(v + (cb[j] - v) * k)).join(",")})`;
      }
    }
    return `rgb(${stops[stops.length - 1][1]})`;
  }
  M.tempColor = tempColor;

  M.renderGrid = function () {
    if (!M.map) return;
    M.windGroup.clearLayers();
    M.tempGroup.clearLayers();
    M.totalGroup.clearLayers();
    const anyModel = M.layersOn.wind || M.layersOn.temp || M.layersOn.total;
    const f = M.frames[M.idx];
    const note = $("#grid-hour");
    if (!anyModel || !M.grid || !f) {
      note.textContent = "";
      return;
    }
    const tz = W.state.tz || "UTC";
    const times = M.grid[0].h.time.map((t) => t * 1000);
    let idx = 0;
    times.forEach((t, i) => { if (Math.abs(t - f.t) < Math.abs(times[idx] - f.t)) idx = i; });
    if (Math.abs(times[idx] - f.t) > 2 * 3600e3) {
      note.textContent = "No modeled hour near this frame.";
      return;
    }
    const hourMs = times[idx];
    note.textContent = `Modeled layers: hour nearest the frame, ${time.dateTimeLabel(hourMs, tz)}. 24-hour total ends at that hour.`;
    M.grid.forEach((p) => {
      const h = p.h;
      const temp = h.temperature_2m[idx], ws = h.wind_speed_10m[idx], wd = h.wind_direction_10m[idx];
      let total = null, rain = null, snow = null;
      if (idx >= 23) {
        const win = (arr) => {
          let s = 0;
          for (let k = idx - 23; k <= idx; k++) {
            if (arr[k] == null) return null;
            s += arr[k];
          }
          return s;
        };
        total = win(h.precipitation);
        const r1 = win(h.rain), r2 = win(h.showers);
        rain = r1 == null ? null : r1 + (r2 || 0);
        snow = win(h.snowfall);
      }
      const popup = `<div class="pt-pop"><strong>${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°</strong><br>
        Modeled at ${esc(time.dateTimeLabel(hourMs, tz))}<br>
        Temperature (2 m): ${fmt.tC(temp)}<br>
        Wind: ${W.compass(wd)} ${fmt.wind(ws)}<br>
        24 h total liquid: ${total == null ? "unavailable" : fmt.precip(total)}<br>
        &nbsp;&nbsp;rain ${rain == null ? "unavailable" : fmt.precip(rain)} · snowfall ${snow == null ? "unavailable" : fmt.snow(snow)}<br>
        <span class="muted">24 h ending ${esc(time.timeLabel(hourMs, tz))}</span></div>`;
      if (M.layersOn.wind && ws != null && wd != null) {
        const rot = (wd + 180) % 360;
        M.windGroup.addLayer(
          L.marker([p.lat, p.lon], {
            interactive: true, keyboard: false,
            icon: L.divIcon({
              className: "wind-mk",
              iconSize: [44, 30], iconAnchor: [22, 15],
              html: `<svg width="18" height="18" viewBox="0 0 18 18" style="transform:rotate(${rot}deg)" aria-hidden="true"><path d="M9 2l4 6h-3v8H8V8H5z" fill="currentColor"/></svg><span>${Math.round(W.conv.windKmh(ws))}</span>`,
            }),
          }).bindPopup(popup)
        );
      }
      if (M.layersOn.temp && temp != null) {
        M.tempGroup.addLayer(
          L.marker([p.lat, p.lon], {
            keyboard: false,
            icon: L.divIcon({
              className: "temp-mk",
              iconSize: [46, 22], iconAnchor: [23, M.layersOn.wind ? 30 : 11],
              html: `<span style="background:${tempColor(temp)}">${Math.round(W.conv.tempC(temp))}${W.u.t()}</span>`,
            }),
          }).bindPopup(popup)
        );
      }
      if (M.layersOn.total) {
        M.totalGroup.addLayer(
          L.marker([p.lat, p.lon], {
            keyboard: false,
            icon: L.divIcon({
              className: "total-mk",
              iconSize: [70, 20], iconAnchor: [35, M.layersOn.wind ? -10 : 10],
              html: `<span>${total == null ? "n/a" : fmt.precip(total)}</span>`,
            }),
          }).bindPopup(popup)
        );
      }
    });
  };
})();
