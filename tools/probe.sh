#!/usr/bin/env bash
# Calls each data provider the app uses and saves status, CORS header and the start of each body.
set -u
OUT=probe-results
mkdir -p "$OUT"
SUMMARY="$OUT/summary.txt"
: > "$SUMMARY"
i=0
probe() {
  local name="$1" url="$2"
  i=$((i+1))
  local f="$OUT/$(printf '%02d' $i)-$name"
  local code
  code=$(curl -sS -m 40 -A "skyline-almanac-probe (github actions)" -H "Origin: https://example.github.io" \
    -D "$f.headers" -o "$f.body" -w '%{http_code}' "$url" 2>"$f.err")
  local acao
  acao=$(grep -i '^access-control-allow-origin' "$f.headers" | tr -d '\r' | head -1)
  printf '%-28s %s  %s\n  %s\n  %s\n\n' "$name" "$code" "${acao:-NO-CORS-HEADER}" "$url" "$(head -c 600 "$f.body" | tr '\n' ' ')" >> "$SUMMARY"
}
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
LAT=39.1736; LON=-78.1729
RUN=$(date -u -d '3 days ago' +%Y-%m-%d)T00:00
YEAR=$(date -u +%Y); MONTH=$(date -u +%-m); LY=$((YEAR-1)); MMDD=$(date -u +%m-%d)

probe forecast "https://api.open-meteo.com/v1/forecast?latitude=$LAT&longitude=$LON&timezone=auto&timeformat=unixtime&past_days=7&forecast_days=9&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,relative_humidity_2m,pressure_msl,weather_code,is_day,precipitation_probability,precipitation,rain,showers,snowfall,cloud_cover,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,rain_sum,showers_sum,snowfall_sum,sunrise,sunset"
probe grid-multi "https://api.open-meteo.com/v1/forecast?latitude=39.1,39.5&longitude=-78.1,-77.5&timezone=GMT&timeformat=unixtime&past_days=2&forecast_days=2&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,rain,showers,snowfall"
probe airquality "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=$LAT&longitude=$LON&timezone=auto&timeformat=unixtime&current=us_aqi,pm2_5,ozone"
probe geocode "https://geocoding-api.open-meteo.com/v1/search?name=Winchester&count=20&language=en&format=json"
for m in gfs_global gfs_seamless ncep_gfs025 gfs025 ncep_gfs_global; do
  probe "singlerun-$m" "https://single-runs-api.open-meteo.com/v1/forecast?latitude=$LAT&longitude=$LON&models=$m&run=$RUN&hourly=temperature_2m&timeformat=unixtime&timezone=GMT&forecast_days=8"
done
probe zip22601 "https://api.zippopotam.us/us/22601"
probe zip99999 "https://api.zippopotam.us/us/99999"
probe nws-alerts "https://api.weather.gov/alerts/active?point=$LAT,$LON"
probe nws-points "https://api.weather.gov/points/$LAT,$LON"
probe nws-stations "https://api.weather.gov/gridpoints/LWX/39,79/stations"
probe rainviewer "https://api.rainviewer.com/public/weather-maps.json"
probe hrrr-meta "https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_0000.json"
probe hrrr-meta-alt "https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_0060.json"
probe hrrr-tile "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F0060-0/6/18/24.png"
probe iem-OKV "https://mesonet.agron.iastate.edu/api/1/daily.json?station=OKV&network=VA_ASOS&year=$YEAR&month=$MONTH"
probe iem-DCA-VA "https://mesonet.agron.iastate.edu/api/1/daily.json?station=DCA&network=VA_ASOS&year=$YEAR&month=$MONTH"
probe iem-DCA-DC "https://mesonet.agron.iastate.edu/api/1/daily.json?station=DCA&network=DC_ASOS&year=$YEAR&month=$MONTH"
for sid in "USC00449186" "USC00449186 6" "449186" "USC00449181" "DCAthr 9"; do
  P=$(printf '{"sid":"%s","sdate":"1850-%s","edate":"%s-%s","elems":[{"name":"maxt","interval":[1,0,0]},{"name":"mint","interval":[1,0,0]}],"meta":"name,sids,ll"}' "$sid" "$MMDD" "$LY" "$MMDD")
  probe "acis-same-${sid// /_}" "https://data.rcc-acis.org/StnData?params=$(enc "$P")"
done
P='{"sid":"USC00449186","sdate":"por","edate":"'$LY'-12-31","elems":[{"name":"maxt","interval":"yly","duration":"yly","reduce":{"reduce":"max","add":"date,mcnt"},"maxmissing":300},{"name":"mint","interval":"yly","duration":"yly","reduce":{"reduce":"min","add":"date,mcnt"},"maxmissing":300}],"meta":"name,sids,ll,valid_daterange"}'
probe acis-yearly "https://data.rcc-acis.org/StnData?params=$(enc "$P")"
P='{"sid":"DCAthr 9","sdate":"por","edate":"'$LY'-12-31","elems":[{"name":"maxt","interval":"yly","duration":"yly","reduce":{"reduce":"max","add":"date,mcnt"},"maxmissing":300},{"name":"mint","interval":"yly","duration":"yly","reduce":{"reduce":"min","add":"date,mcnt"},"maxmissing":300}],"meta":"name,sids,ll,valid_daterange"}'
probe acis-yearly-dc "https://data.rcc-acis.org/StnData?params=$(enc "$P")"
P='{"bbox":"-84.53,37.64,-83.83,38.34","elems":"maxt","meta":"name,sids,ll,valid_daterange"}'
probe acis-stnmeta "https://data.rcc-acis.org/StnMeta?params=$(enc "$P")"
P='{"sid":"DCAthr 9","sdate":"1852-02-29","edate":"2024-02-29","elems":[{"name":"maxt","interval":[4,0,0]}]}'
probe acis-feb29 "https://data.rcc-acis.org/StnData?params=$(enc "$P")"
cat "$SUMMARY"
