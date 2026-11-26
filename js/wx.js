/* WMO weather codes → descriptions and small inline SVG icons. */
(function () {
  "use strict";
  const W = window.W;
  const CODES = {
    0: ["Clear", "clear"], 1: ["Mostly clear", "mostlyclear"], 2: ["Partly cloudy", "partly"], 3: ["Overcast", "cloud"],
    45: ["Fog", "fog"], 48: ["Freezing fog", "fog"],
    51: ["Light drizzle", "drizzle"], 53: ["Drizzle", "drizzle"], 55: ["Heavy drizzle", "drizzle"],
    56: ["Light freezing drizzle", "sleet"], 57: ["Freezing drizzle", "sleet"],
    61: ["Light rain", "rain"], 63: ["Rain", "rain"], 65: ["Heavy rain", "rain"],
    66: ["Light freezing rain", "sleet"], 67: ["Freezing rain", "sleet"],
    71: ["Light snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"], 77: ["Snow grains", "snow"],
    80: ["Light showers", "rain"], 81: ["Showers", "rain"], 82: ["Heavy showers", "rain"],
    85: ["Snow showers", "snow"], 86: ["Heavy snow showers", "snow"],
    95: ["Thunderstorm", "thunder"], 96: ["Thunderstorm with hail", "thunder"], 99: ["Severe thunderstorm with hail", "thunder"],
  };
  W.wx = {
    desc(code) {
      return (CODES[code] || ["Unknown"])[0];
    },
    kind(code) {
      return (CODES[code] || [null, "cloud"])[1];
    },
    icon(code, isDay = true, size = 40) {
      const k = W.wx.kind(code);
      const label = W.esc(W.wx.desc(code));
      const sun = '<circle cx="20" cy="20" r="7" fill="var(--ic-sun)"/><g stroke="var(--ic-sun)" stroke-width="2.2" stroke-linecap="round">' +
        [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
          const r = (a * Math.PI) / 180;
          return `<line x1="${20 + Math.cos(r) * 10.5}" y1="${20 + Math.sin(r) * 10.5}" x2="${20 + Math.cos(r) * 14}" y2="${20 + Math.sin(r) * 14}"/>`;
        }).join("") + "</g>";
      const moon = '<path d="M25 9a11 11 0 1 0 6 19A9 9 0 0 1 25 9z" fill="var(--ic-moon)"/>';
      const smallSun = isDay
        ? '<circle cx="14" cy="14" r="6" fill="var(--ic-sun)"/>'
        : '<path d="M17 6a8 8 0 1 0 4.5 13.5A6.5 6.5 0 0 1 17 6z" fill="var(--ic-moon)"/>';
      const cloud = (y = 0, fill = "var(--ic-cloud)") =>
        `<path d="M11 ${30 + y}h19a6.5 6.5 0 0 0 0-13 9 9 0 0 0-17-1.5A6.5 6.5 0 0 0 11 ${30 + y}z" fill="${fill}" stroke="var(--ic-cloud-edge)" stroke-width="1"/>`;
      const drops = (n, color) =>
        Array.from({ length: n }, (_, i) => `<line x1="${14 + i * 6}" y1="33" x2="${12 + i * 6}" y2="38" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`).join("");
      const flakes = '<g fill="var(--ic-snow)"><circle cx="14" cy="35" r="1.8"/><circle cx="20" cy="37" r="1.8"/><circle cx="26" cy="35" r="1.8"/></g>';
      let body;
      switch (k) {
        case "clear": body = isDay ? sun : moon; break;
        case "mostlyclear": body = (isDay ? sun : moon) + `<g transform="translate(8 8) scale(.6)">${cloud(0)}</g>`; break;
        case "partly": body = smallSun + cloud(0); break;
        case "cloud": body = cloud(-2); break;
        case "fog": body = cloud(-6) + '<g stroke="var(--ic-cloud-edge)" stroke-width="2" stroke-linecap="round"><line x1="9" y1="30" x2="31" y2="30"/><line x1="12" y1="35" x2="28" y2="35"/></g>'; break;
        case "drizzle": body = cloud(-4) + drops(3, "var(--ic-rain)"); break;
        case "rain": body = cloud(-4) + drops(4, "var(--ic-rain)"); break;
        case "sleet": body = cloud(-4) + drops(2, "var(--ic-rain)") + '<circle cx="28" cy="36" r="1.8" fill="var(--ic-snow)"/>'; break;
        case "snow": body = cloud(-4) + flakes; break;
        case "thunder": body = cloud(-4) + '<path d="M21 27l-5 7h4l-2 6 7-9h-4l2-4z" fill="var(--ic-sun)"/>'; break;
        default: body = cloud(0);
      }
      return `<svg class="wx-icon" width="${size}" height="${size}" viewBox="0 0 40 40" role="img" aria-label="${label}">${body}</svg>`;
    },
  };

  W.aqiCategory = function (aqi) {
    if (aqi == null || isNaN(aqi)) return null;
    const cats = [
      [50, "Good", "aqi-1"], [100, "Moderate", "aqi-2"], [150, "Unhealthy for sensitive groups", "aqi-3"],
      [200, "Unhealthy", "aqi-4"], [300, "Very unhealthy", "aqi-5"], [Infinity, "Hazardous", "aqi-6"],
    ];
    const c = cats.find((x) => aqi <= x[0]);
    return { label: c[1], cls: c[2] };
  };
})();
