# AstroClimate

**Version 1.1** — revised during implementation. Changes from 1.0 are listed in
§32; they resolve contradictions found while building the pipeline and fill in
the conventions the browser and the preprocessing side must agree on.

## Purpose

AstroClimate is a mobile-friendly static web application that answers:

**“Historically, how good is this location for astronomy on this date?”**

It combines long-term historical weather climatology with astronomical darkness and Moon information, and optionally overlays the current short-range weather forecast.

The application must be deployable entirely on GitHub Pages.

Python is used offline and in GitHub Actions to retrieve and preprocess large historical datasets. The browser application is static TypeScript/JavaScript and consumes small generated JSON files.

---

# 1. Primary User Experience

The main screen revolves around three controls:

**Location**

Example:

`Schererville, Indiana`

**Date**

Example:

`September 20`

**Activity**

Selectable modes:

| Mode | Primary concern |
|---|---|
| Visual observing | Clouds, transparency, Moon |
| Wide-field imaging | Clouds, darkness, Moon, humidity |
| Deep-sky imaging | Clouds, long clear periods, darkness, Moon |
| Planetary | Clouds, wind, humidity; Moon mostly irrelevant |
| Milky Way | Clouds, astronomical darkness, Moon |

Where a mode lists the Moon, that concern is served by the **current-year
astronomy** half of the application (§13), never by the climatology — see §14.
The mode changes how the historical score weights weather (§15) and how the UI
presents Moon information; it never changes the weather data itself.

The result should immediately display something like:

> September 20 — Schererville, Indiana  
>
> Historical observing quality: **72 / 100**
>
> Historically usable night: **46%**
>
> Chance of ≥3 clear consecutive hours: **38%**
>
> Median nighttime cloud cover: **31%**
>
> Astronomical darkness: **8h 14m**
>
> Best historical portion of night: **1–4 AM**

Underneath this summary is the detailed climatology.

---

# 2. Key Design Principle

Keep three fundamentally different concepts separate.

## Historical Climate

Answers:

> What normally happens around this date?

Derived from approximately 20–30 years of ERA5 or ERA5-Land data.

## Astronomy Conditions

Answers:

> How much usable astronomical night exists on this particular date?

Calculated from Sun, Moon, location, and date.

## Current Forecast

Answers:

> What is actually forecast to happen this year?

Uses current numerical weather forecasts.

These should never be mixed together without labeling.

A night might therefore show:

> Historical: 72/100  
> Tonight's forecast: 91/100

That distinction is extremely useful.

---

# 3. Architecture

The system has three layers.

```text
                 DATA SOURCES
                     │
          ┌──────────┴──────────┐
          │                     │
       ERA5/ERA5-Land       Forecast API
       Historical Data        Current Data
          │                     │
          ▼                     │
   Python preprocessing          │
          │                     │
          ▼                     │
 location climatology JSON      │
          │                     │
          └──────────┬──────────┘
                     ▼
               GitHub Pages
                     │
             TypeScript Web App
                     │
          ┌──────────┴──────────┐
          │                     │
       Historical           Forecast
       climatology          comparison
```

There is no continuously running application server.

---

# 4. Recommended Technology

Frontend:

```text
Vite
TypeScript
React
CSS
Astronomy Engine JS
IndexedDB/localStorage
```

Python preprocessing:

```text
Python 3.12+
uv
httpx
pandas
numpy
pyarrow
```

Optional later:

```text
DuckDB
Polars
```

React is not strictly necessary, but I recommend it for this application because a coding LLM will have little difficulty building the UI, charts, state management, and GitHub Pages deployment around React + Vite.

Astronomy Engine works in the browser and supports JavaScript/TypeScript astronomy calculations.

---

# 5. Repository Layout

```text
astroclimate/
│
├── app/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── charts/
│   │   ├── astronomy/
│   │   ├── climatology/
│   │   ├── forecast/
│   │   └── storage/
│   │
│   ├── public/
│   │   └── data/
│   │       ├── locations.json
│   │       └── locations/
│   │
│   ├── package.json
│   └── vite.config.ts
│
├── scripts/
│   ├── __init__.py
│   ├── common.py            shared conventions and config
│   ├── fetch_history.py     Open-Meteo -> cache/<id>/<year>.parquet
│   ├── build_climatology.py nights, then day-of-year aggregation
│   ├── build_location.py    fetch + build for one location
│   ├── update_locations.py  build every configured location
│   └── validate_data.py     fail the build on bad JSON
│
├── locations/
│   └── locations.yaml
│
├── cache/
│   └── .gitignore
│
├── tests/
│   ├── conftest.py
│   └── test_conventions.py
│
├── pyproject.toml
│
└── .github/
    └── workflows/
        ├── deploy.yml
        └── update-data.yml
```

---

# 6. Location Configuration

Locations are stored in a simple YAML file.

```yaml
locations:

  - id: schererville-in
    name: Schererville, Indiana
    latitude: 41.4789
    longitude: -87.4548
    timezone: America/Chicago

  - id: holland-mi
    name: Holland, Michigan
    latitude: 42.7875
    longitude: -86.1089
    timezone: America/Detroit
```

Running:

```bash
uv run python scripts/build_location.py schererville-in
```

downloads historical data, computes climatology, and generates the JSON consumed by the website.

---

# 7. Historical Data

Use approximately:

```text
1996–2025
```

for the default climatological baseline.

Thirty years is long enough to provide a useful sample while still being reasonably representative of current climate.

The baseline period should remain configurable.

Primary hourly fields:

| Variable | Purpose |
|---|---|
| cloud_cover | Overall usability |
| cloud_cover_low | Fog/low-cloud risk |
| cloud_cover_mid | Mid-level obstruction |
| cloud_cover_high | Cirrus risk |
| temperature_2m | Comfort/dew calculations |
| relative_humidity_2m | Dew/fog risk |
| dew_point_2m | Dew risk |
| precipitation | Precipitation |
| wind_speed_10m | Equipment stability |

### Which reanalysis

ERA5-Land contains **no cloud fields at all**. It is a land-*surface* reanalysis:
2 m temperature, dewpoint, soil and snow variables. Cloud cover — the single most
important variable in this application — exists only in ERA5.

The pipeline therefore requests `models=era5_seamless`, which takes temperature
and humidity from ERA5-Land at 0.1° and everything else from ERA5 at 0.25°:

| Variable | Source | Grid |
|---|---|---|
| cloud_cover, cloud_cover_low/mid/high | ERA5 | 0.25° (~28 km) |
| precipitation, wind_speed_10m | ERA5 | 0.25° (~28 km) |
| temperature_2m, relative_humidity_2m, dew_point_2m | ERA5-Land | 0.1° (~11 km) |

Because two grids sit behind one location, provenance is recorded **per variable**
rather than as a single `"source": "ERA5"` string.

The 0.25° cloud grid is a real limitation and the UI must not hide it: two
observing sites 15 km apart resolve to the same ERA5 cell and will return
identical cloud climatology. This matters most for §21, where comparing nearby
sites would otherwise look meaningful. Higher-resolution cloud sources belong in
V2 (§29).

### Caching

The preprocessing pipeline saves raw downloads locally so repeated builds do not
repeatedly query the remote API. One request per calendar year, written to
`cache/<location>/<year>.parquet`; years already present are skipped, so an
interrupted run resumes and a monthly rebuild only fetches what is new.

Requests use `timezone=UTC` and SI units (`wind_speed_unit=ms`). Converting to
local time is left to the night-building stage, which needs the location's IANA
zone anyway; asking the API to localise would bake a DST convention into the
cache.

ERA5 reaches the archive about **five days** behind real time, so the current
year is clipped to that availability rather than requested in full.

---

# 8. Definition of a Night

Weather statistics should not be calculated from calendar days.

Instead, calculate an astronomical observing night.

For each historical date and location:

```text
Sun altitude < -18°
```

defines astronomical darkness.

Weather samples falling inside this interval belong to that observing night.

Also calculate:

```text
Civil twilight       Sun < -6°
Nautical twilight    Sun < -12°
Astronomical twilight Sun < -18°
```

This lets users relax the threshold for bright objects or planetary observing.

### Which date a night belongs to

A night spans two calendar dates. Each night is keyed by the calendar date of its
**evening**, in the location's local timezone: the night of Sep 20→21 is
`2024-09-20`. Every date in the application means this.

---

# 9. Night-Level Statistics

Convert hourly historical weather into one record per night.

Example:

```json
{
  "date": "2024-09-20",
  "dark_hours": 8.21,

  "mean_cloud": 32,
  "median_cloud": 21,

  "clear_fraction_10": 0.31,
  "clear_fraction_25": 0.54,
  "clear_fraction_50": 0.76,

  "longest_clear_run_10": 2,
  "longest_clear_run_25": 4,

  "mean_low_cloud": 14,
  "mean_mid_cloud": 17,
  "mean_high_cloud": 19,

  "precipitation_hours": 0,

  "mean_humidity": 72,
  "mean_dew_spread": 4.3,

  "mean_wind": 7.1
}
```

Note `"date"` is the **evening** date (§8), and `mean_dew_spread` is
temperature minus dew point in °C — the dew-risk input the score needs.

### Keep the per-hour series

Reducing each night to these scalars alone would make §20 (hour-of-night
analysis), §1's "best historical portion of night", and §19's hourly climatology
unbuildable. The night record must therefore also carry the **per-hour cloud
series**, tagged with each sample's offset from solar midnight:

```json
"hours": {
  "offsets": [-3, -2, -1, 0, 1, 2, 3],
  "cloud":   [45, 30, 20, 15, 10, 25, 40]
}
```

This stays in the parquet cache. Only the aggregate reaches the browser.

The night-level scalars still dramatically reduce the amount of data that must
ultimately reach the browser.

---

# 10. Day-of-Year Climatology

Do not calculate September 20 using only thirty September 20 observations.

Use a rolling climatological window.

Default:

```text
selected date ±7 days
```

Across a 30-year baseline this produces approximately:

```text
15 × 30 = 450 nights
```

for each calendar date.

That gives much more stable probabilities.

Each of the 365 calendar dates gets its own climatological record.

### Day index, leap years, and the year boundary

The day index is 1–365, derived from (month, day) against a **non-leap reference
year**. Sep 20 is therefore 263 in every year, leap or not — if the index were a
raw `tm_yday`, every autumn date would shift by one slot in leap years and the
window would smear across two different dates.

Feb 29 **folds into the Feb 28 slot**. It occurs in 7 of the 30 baseline years;
dropping it would discard real weather for no benefit.

The ±7-day window **wraps the year boundary**. Jan 3 pulls in Dec 27–31; Dec 29
pulls in Jan 1–5. Without the wrap, both ends of the year would be built from
roughly half the samples of every other date — a systematic bias that looks
entirely plausible on the annual curve.

### A note on reading the annual curve

Adjacent dates share 14 of their 15 window days. The §17 curve and §18 heatmap
are therefore smooth **by construction**, not because weather is smooth. The UI
should say so, or the visualization invites over-reading.

---

# 11. Core Historical Metrics

The most useful statistic should be:

### Probability of usable observing

Define several transparent thresholds.

For example:

```text
Excellent:
cloud <= 10%

Good:
cloud <= 25%

Usable:
cloud <= 50%
```

Calculate:

```text
P(at least 1 clear hour)
P(at least 2 consecutive clear hours)
P(at least 3 consecutive clear hours)
P(at least 4 consecutive clear hours)
P(at least 6 consecutive clear hours)
```

For astrophotography, **consecutive hours** are more useful than average cloud cover.

A night that alternates every hour between clear and cloudy could have the same average cloud cover as a night containing four uninterrupted clear hours, yet the latter is vastly more useful.

### What "three consecutive clear hours" counts

ERA5 cloud cover arrives as an instantaneous value at each hour, so three
consecutive samples below threshold strictly span only *two* hours of elapsed
time. Since this is the app's signature number, the convention is fixed rather
than left to whichever loop is written first:

> **Each hourly sample represents the 1-hour block beginning at its timestamp.
> N consecutive clear samples is N clear hours.**

This convention ships in the provenance panel (§27) so the number is auditable.

A sample belongs to a night if its timestamp falls inside that night's dark
interval. Partial hours at the edges of astronomical twilight are not
interpolated.

---

# 12. Climatology JSON

The Python pipeline generates compact files.

Example:

```text
public/data/locations/schererville-in.json
```

Structure:

```json
{
  "schema_version": 1,
  "metadata": {
    "id": "schererville-in",
    "name": "Schererville, Indiana",
    "latitude": 41.4789,
    "longitude": -87.4548,
    "elevation_m": 200,
    "timezone": "America/Chicago",
    "baseline": { "start_year": 1996, "end_year": 2025 },
    "window_days": 7,
    "dark_threshold_deg": -18,
    "run_convention": "sample_as_block",
    "generated_at": "2026-09-15T00:00:00Z",
    "sources": {
      "cloud_cover": "ERA5 (0.25 deg)",
      "wind_speed_10m": "ERA5 (0.25 deg)",
      "precipitation": "ERA5 (0.25 deg)",
      "temperature_2m": "ERA5-Land (0.1 deg)",
      "relative_humidity_2m": "ERA5-Land (0.1 deg)",
      "dew_point_2m": "ERA5-Land (0.1 deg)"
    },
    "units": {
      "wind": "m/s",
      "temperature": "degC",
      "precipitation": "mm",
      "cloud": "percent"
    }
  },

  "days": {
    "263": {
      "date_label": "Sep 20",
      "sample_count": 448,
      "mean_dark_hours": 8.21,

      "mean_cloud": 34.2,
      "median_cloud": 27.4,
      "median_high_cloud": 19.0,

      "p_cloud_under_10": 0.24,
      "p_cloud_under_25": 0.39,
      "p_cloud_under_50": 0.61,

      "p_clear_runs": {
        "10": { "1h": 0.44, "2h": 0.31, "3h": 0.24, "4h": 0.18, "6h": 0.09 },
        "25": { "1h": 0.66, "2h": 0.51, "3h": 0.43, "4h": 0.34, "6h": 0.19 },
        "50": { "1h": 0.82, "2h": 0.71, "3h": 0.63, "4h": 0.52, "6h": 0.33 }
      },

      "p_usable_night": 0.46,

      "median_humidity": 71,
      "median_dew_spread": 4.3,
      "median_wind": 3.0,
      "p_precip": 0.21,

      "hours": {
        "bins":       [-4,   -3,   -2,   -1,    0,    1,    2,    3,    4],
        "p_clear_25": [0.31, 0.34, 0.37, 0.41, 0.46, 0.51, 0.54, 0.52, 0.48],
        "n":          [210,  340,  430,  448,  448,  448,  441,  390,  260]
      }
    }
  }
}
```

Four things about this schema are load-bearing:

**`p_clear_runs` is keyed by threshold, then run length.** A bare `p_clear_3h`
does not say what "clear" meant. §11 defines three thresholds and five run
lengths; the full grid is small and the UI needs it to support per-mode
thresholds (§15).

**`p_usable_night` is defined**, not merely displayed. It is
P(≥2 consecutive clear hours at ≤50% cloud) — the minimum that makes a drive
worthwhile. §1's "historically usable night: 46%" means this.

**`median_dew_spread` and `p_precip` exist** because §15 weights dew risk at 10%
and precipitation at 5%. Without them, 15% of the score has no input.

**`hours.bins` are hours relative to solar midnight, not clock hours.** Across a
±7-day window, 30 years of DST changes, and a night length that varies by six
hours through the year, "10 PM" is not a stable quantity — and in June at 41.5°N
astronomical darkness does not begin until roughly 10:30 PM local, so early clock
bins would be nearly empty. Solar-midnight offsets are comparable across dates
and years. `n[]` carries per-bin sample counts and the UI suppresses thin bins.
Clock labels are reconstructed in the browser for the selected year, which is
where §20's "8 PM / 9 PM" presentation comes from.

### Units

Files store **SI**: m/s, °C, mm, percent. The `units` block states this
explicitly. The browser converts for display and offers a metric/imperial toggle
persisted to `localStorage`. §19 and §21 show mph because that is a display
choice, not a storage one.

### The location index

`public/data/locations.json` lists what is available:

```json
{
  "schema_version": 1,
  "generated_at": "2026-09-15T00:00:00Z",
  "locations": [
    {
      "id": "schererville-in",
      "name": "Schererville, Indiana",
      "latitude": 41.4789,
      "longitude": -87.4548,
      "timezone": "America/Chicago",
      "elevation_m": 200,
      "file": "locations/schererville-in.json"
    }
  ]
}
```

One location file should be well under a few hundred kilobytes compressed —
roughly 150 KB raw, 30 KB gzipped, with the hourly block included.

That is ideal for GitHub Pages.

---

# 13. Astronomy Calculations

These should happen entirely in the browser because they depend on the year selected.

Calculate:

```text
Sunset
Civil twilight end
Nautical twilight end
Astronomical twilight end

Astronomical twilight start
Sunrise

Moon rise
Moon set
Moon altitude
Moon illumination
Moon phase
```

Also calculate:

```text
dark hours with Moon below horizon
dark hours with Moon illumination < chosen threshold
```

This allows a very useful metric:

> Moon-free astronomical darkness tonight: 5h 42m

### Computing it correctly

This is an **intersection of two interval sets**, not a subtraction of two
scalars. The Moon can rise or set partway through the night, so the calculation
is: collect the Moon's rise/set events falling inside the dark window, build the
below-horizon intervals from them, intersect with the dark interval, and sum.

Astronomy Engine's `SearchRiseSet` handles refraction and limb correctly for
rise/set; twilight boundaries use `SearchAltitude`, which is the right function
for a specific Sun altitude such as −18°.

Results should be memoized per (location, date, year) — the §17 annual chart
needs 365 evaluations and will feel sluggish otherwise.

The preprocessing side uses the **same Astronomy Engine implementation** (the
Python port of the same library), so Python-computed `mean_dark_hours` and
browser-computed darkness agree rather than differing by a few minutes for
reasons nobody can trace.

---

# 14. Keep Moon Separate From Historical Weather

Moon phase should NOT be baked into climatology.

Weather climatology repeats every calendar year.

The lunar cycle does not.

For example, September 20 might historically be excellent for weather but have a nearly full Moon in 2026.

Therefore:

```text
Weather Climatology
        +
Current-year Astronomy
        =
Expected Imaging Opportunity
```

---

# 15. Historical Score

Provide a useful summary score, but show exactly how it was generated.

Suggested base score:

```text
Cloud probability       50%
Clear-run probability   25%
Humidity/dew risk        10%
Wind                    10%
Precipitation             5%
```

### Weights need normalizers

Weights alone are not a formula — nothing above says how "median wind 3.0 m/s"
becomes a 0–100 subscore. Each component maps through a clamped linear ramp
between two anchors:

| Component | Input | 0 at | 100 at |
|---|---|---:|---:|
| Cloud probability | `p_cloud_under_25` | 0.0 | 0.7 |
| Clear-run probability | `p_clear_runs[t]["3h"]` | 0.0 | 0.6 |
| Humidity / dew risk | `median_dew_spread` | 1 °C | 8 °C |
| Wind | `median_wind` | 9 m/s | 2 m/s |
| Precipitation | `p_precip` | 0.5 | 0.0 |

```text
score = Σ (weight_i × norm_i(value_i))
```

### The score is computed in the browser

It is **never baked into the JSON**. The file ships the components; the browser
combines them. This is what lets the activity selector change the score
instantly, and lets the user adjust weights, without regenerating any data.

### Per-mode weights

§1's activity modes are weight vectors over the components above. `t` is the
cloud threshold that mode's clear-run probability reads from.

| Mode | Cloud | Run | Humid | Wind | Precip | `t` |
|---|---:|---:|---:|---:|---:|---:|
| Visual observing | 50 | 25 | 10 | 10 | 5 | 25% |
| Wide-field imaging | 40 | 30 | 15 | 10 | 5 | 25% |
| Deep-sky imaging | 30 | 45 | 10 | 10 | 5 | 10% |
| Planetary | 45 | 15 | 15 | 20 | 5 | 25% |
| Milky Way | 45 | 30 | 10 | 10 | 5 | 10% |

Visual observing is the base row from above. Deep-sky emphasises long
uninterrupted clear periods and demands a stricter definition of clear. Planetary
weights wind highest and, per §14, ignores the Moon entirely — as every mode does,
because the Moon is never in the climatology.

The user should be able to adjust these weights; the modes are presets, not
limits.

### Show the work

Every score in the UI opens a breakdown: component, raw value, normalized
subscore, weight, contribution. §15's "show exactly how it was generated" taken
literally. This is also the debugging surface for the entire pipeline — a wrong
number upstream is visible here and nowhere else.

---

# 16. Current Forecast

The browser retrieves the current forecast for the selected location.

Fields:

```text
cloud cover
low cloud
mid cloud
high cloud
humidity
dew point
precipitation probability
wind speed
wind gusts
visibility
```

Open-Meteo currently exposes these kinds of forecast fields, including layered cloud cover and visibility.

Display climatology beside forecast:

| Metric | Historical | Forecast |
|---|---:|---:|
| Cloud cover | 34% | 12% |
| Clear ≥3 hr | 43% | Yes |
| Humidity | 71% | 64% |
| Wind | 6.8 mph | 4 mph |
| Overall | 72 | 91 |

### Do not let the columns imply arithmetic

That table, as drawn, violates §2. `43%` sits beside `Yes`, and a historical 72
sits beside a forecast 91 under a single "Overall" row, inviting the reader to
subtract them. They are not on the same scale: one is an expectation over 448
historical nights, the other a property of one forecast night.

The forecast score uses the **same weights** (§15) over **forecast values** —
deterministic, not probabilistic. In the UI:

- the two scores render in visually distinct cards, never as one row
- the forecast column is labelled with its model issue time
- the two are never differenced, and no "vs" or delta is shown
- probabilistic and deterministic cells are typographically distinguished

The useful reading is "historically a coin flip, but tonight looks good" — which
requires the reader to hold both numbers as different kinds of thing.

This makes the app useful both months ahead and tonight.

---

# 17. Main Visualization

The most important chart should display the entire year.

Horizontal axis:

```text
Jan ───────────────────────── Dec
```

Vertical axis:

```text
Historical astronomy suitability
0–100
```

The curve immediately reveals the best observing seasons.

Selectable overlays:

```text
Cloud probability
3-hour clear probability
6-hour clear probability
Humidity
Wind
Astronomical darkness
```

This is likely to become the signature visualization of the application.

---

# 18. Calendar Heatmap

Create a 365-day heatmap.

Example concept:

```text
JAN  ░░▒▒▒▒▓▓▒░...
FEB  ░▒▒▒▓▓▓▓▒...
MAR  ▒▒▓▓▓▓▓▓▒...
...
```

Selecting a day opens its detailed statistics.

This answers:

> When should I plan an astronomy trip?

extremely quickly.

---

# 19. Date Detail Screen

The selected date screen should contain:

```text
SEPTEMBER 20
Schererville, Indiana

Historical score              72

Clear ≤10%                    24%
Clear ≤25%                    39%
Usable ≤50%                   61%

≥2 clear hours                51%
≥3 clear hours                43%
≥4 clear hours                34%
≥6 clear hours                19%

Median cloud                  27%
Median humidity               71%
Median wind                   6.8 mph

Astronomical darkness         8h 14m
Moon illumination             18%
Moon-free darkness            6h 47m
```

Then show hourly climatology.

---

# 20. Historical Hour-of-Night Analysis

This is a particularly interesting feature.

Instead of asking only whether September 20 is usually clear, calculate whether particular times tend to be clearer.

For example:

```text
Historical clear probability

8 PM      31%
9 PM      34%
10 PM     37%
11 PM     41%
12 AM     46%
1 AM      51%
2 AM      54%
3 AM      52%
4 AM      48%
5 AM      43%
```

The app could then say:

> Historically, 1–3 AM is the clearest portion of the night.

This is extremely useful for actual observing.

### Bin by solar midnight, label by clock

The table above is the *presentation*. The stored data is binned by offset from
solar midnight (§12), because clock hours are not comparable across the window,
the years, or the seasons. The browser converts offsets to clock labels for the
selected date and year.

Two consequences for the UI:

- bins carry sample counts; those below a floor (30) are not plotted, because
  early-evening bins in June are genuinely thin
- "best portion of night" is the highest-scoring **contiguous run** of bins, not
  the single best bin — §1's "1–4 AM" is a range for a reason

---

# 21. Compare Locations

Allow two or more observing locations to be compared.

Example:

| | Schererville | Holland |
|---|---:|---:|
| Annual clear-night probability | 33% | 36% |
| Sep 20 clear ≥3 hr | 43% | 47% |
| Median humidity | 71% | 74% |
| Median wind | 6.8 | 8.1 |
| Dark hours | 8.2 | 8.3 |

Later this could become:

> Where should I drive this weekend?

---

# 22. Location Search

The UI can use Open-Meteo's geocoding endpoint for city and postal-code searches. Its current API returns coordinates, timezone-related geographic information, administrative areas, and other location metadata.

For V1, however, I would support two location types:

```text
Precomputed locations
Custom temporary location
```

Precomputed locations have full historical climatology.

A custom location can immediately receive:

```text
astronomical calculations
current forecast
```

but historical climatology requires preprocessing.

---

# 23. Adding Locations

For the initial personal version, adding locations is intentionally simple.

Edit:

```text
locations/locations.yaml
```

then run:

```bash
uv run python scripts/update_locations.py
```

or trigger:

```text
GitHub → Actions → Update Location Data
```

The Action generates the new location file and republishes the Pages site.

This avoids needing a server entirely.

---

# 24. GitHub Actions

Two workflows should exist.

### Deployment workflow

Triggered by:

```text
push to main
```

Performs:

```text
npm install
npm build
deploy dist/ to GitHub Pages
```

### Data workflow

Triggered:

```text
manually
monthly
```

Performs:

```text
install Python
install uv
fetch/update datasets
recalculate climatologies
validate JSON
build frontend
deploy Pages
```

### One path to Pages

The data workflow must **commit the regenerated JSON back to main** — it lives in
`app/public/data/`, and without the commit the next push-triggered deploy would
rebuild from a tree that never received it. That commit then triggers the deploy
workflow.

So the data workflow does *not* deploy Pages itself. Only `deploy.yml` does.
Two workflows both deploying would race for the Pages environment.

This requires `contents: write` permission on the data workflow, and a
`concurrency` group on the deployment.

### Cache the raw downloads in CI

`cache/` is gitignored, so without `actions/cache` every monthly run
re-downloads three decades of hourly data — roughly 780 Open-Meteo call-units per
location per run. That fits inside the free tier's 10,000/day, but it is wasteful
and it makes the rebuild fragile for no reason. Key the cache on
`locations.yaml` and fall back through `restore-keys` so a new year appends
rather than starting empty.

The historical climatology does not need daily updates.

Monthly or even annual rebuilding is sufficient. The monthly run is scheduled
early in the month so ERA5's ~5-day lag has cleared the previous month.

---

# 25. Caching

Raw downloads should not be repeatedly downloaded.

Local cache:

```text
cache/
  schererville-in/
    1996.parquet
    1997.parquet
    ...
    2025.parquet
```

The actual website should not receive these raw files.

Only the derived climatology JSON gets deployed.

Parquet is preferable for the preprocessing pipeline because decades of hourly
data become dramatically smaller and faster to analyze. With zstd compression,
one year of nine hourly variables is about 140 KB, so a full 30-year location
cache is roughly 4 MB.

An interrupted write must never leave a truncated file that the next run treats
as cached, so each year is written to a temporary path and renamed into place.

---

# 26. PWA Support

AstroClimate should eventually be installable as a Progressive Web App.

Cache:

```text
UI
location climatology
astronomical calculations
recent forecasts
```

This would allow the climatology portion of the application to function at a dark
site without cell service.

Note the asymmetry: climatology and astronomy work fully offline — one is a
static file, the other is pure computation. The forecast cannot. Offline, the
forecast card shows its cached values with an explicit age ("issued 9 hours
ago"), never a stale number presented as current.

---

# 27. Data Provenance

Every climatology page should contain a small information panel:

```text
Historical weather:
ERA5 (cloud, wind, precipitation) 0.25°
ERA5-Land (temperature, humidity) 0.1°
via Open-Meteo

Baseline:
1996–2025

Temporal resolution:
1 hour

Climatology window:
±7 calendar days

Samples for this date:
448 nights

Clear-hour convention:
each hourly sample = 1 hour block

Usable night:
≥2 consecutive hours under 50% cloud

Grid note:
sites within ~28 km share a cloud cell

Last generated:
2026-09-15
```

Every field here reads from `metadata` in the location JSON (§12), which is why
`generated_at`, `window_days`, `run_convention` and per-variable `sources` are
stored rather than hardcoded in the UI.

Open-Meteo data requires attribution under CC-BY 4.0, and its free API is
available for non-commercial use subject to usage limits — which means this site
carries no ads and no subscription.

---

# 28. V1 Scope

The first release should deliberately remain small.

It needs only:

- configured locations
- 365-day historical climatology
- date selector
- **activity mode selector (all five modes)** — §1 makes this one of the three
  primary controls, and since the score is computed in the browser from JSON
  components (§15) the modes cost a weight table, not a pipeline change
- annual climatology graph
- calendar heatmap
- probability of 1/2/3/4/6 consecutive clear hours at each of three thresholds
- **hour-of-night climatology** — §1's summary card promises "best historical
  portion of night", and building the aggregate now avoids a schema migration
  later
- astronomical darkness
- Moon phase and Moon-free darkness
- current forecast, visually separated from climatology (§16)
- score breakdown panel (§15)
- data provenance panel (§27)
- **`validate_data.py` in the build** — see below
- mobile-responsive interface
- GitHub Pages deployment
- Python preprocessing pipeline

Everything else can wait.

### What validation checks

An aggregation bug produces numbers that look entirely reasonable on a chart.
The validator fails the build on:

- any of the 365 slots missing
- `sample_count` below a floor (catches silent fetch gaps)
- any probability outside [0, 1]
- **monotonicity violations**: `p_clear_1h ≥ p_clear_2h ≥ … ≥ p_clear_6h`, and
  `p_cloud_under_10 ≤ p_cloud_under_25 ≤ p_cloud_under_50`
- missing `schema_version` or `generated_at`
- implausible file size

The monotonicity checks are the valuable ones — they catch real run-length and
threshold bugs that eyeballing the annual curve never will.

---

# 29. V2 Possibilities

Later versions could incorporate:

```text
NOAA station observations
NASA satellite cloud products
forecast model comparison
seeing forecasts
transparency forecasts
smoke
aerosol optical depth
aurora probability
light-pollution maps
Bortle/SQM data
target recommendations
observing equipment profiles
historical forecast accuracy
nearby observing-site comparison
weekend trip planning
```

The application could eventually answer something much more sophisticated:

> I want to photograph emission nebulae sometime during the next six weeks. Which Friday or Saturday night historically gives me the best combination of clear weather, Moon-free darkness, and observing duration within 60 miles?

But that should not be required for V1.

---

# 30. Recommended First Milestone

Build one location and prove the full pipeline.

Use:

```text
Schererville, Indiana
1996–2025
```

Generate a JSON file containing all 365 climatology records.

Then build a single-page application containing:

```text
location
date slider (and date picker)
activity mode
historical score, with its breakdown
cloud probability
3-hour clear probability
darkness duration
Moon information
annual chart
```

Before building further surface, check the numbers against reality:

- December in northwest Indiana must score visibly worse than September. A flat
  annual curve means the aggregation is wrong, not that the weather is even.
- Twilight and Moon times should match timeanddate.com to within a minute.
- Python `mean_dark_hours` and the browser's computed darkness should agree.

Once this works correctly, multiple locations and current forecasts are straightforward additions.

---

# 31. Core Design Goal

The application should not simply answer:

> What is the average cloud cover?

It should answer the much more useful astronomy question:

> **If I plan to observe at this location on this date, what is the historical probability that I will actually get several uninterrupted dark, clear hours?**

That should remain the central design principle throughout development.


---

# 32. Changes in Version 1.1

Revisions made while implementing the pipeline. Each resolves a contradiction or
fills a gap in 1.0 that would have let the preprocessing side and the browser
disagree.

### Corrections

**ERA5-Land has no cloud cover** (§7). 1.0 said "ERA5 or ERA5-Land" throughout.
ERA5-Land is a land-surface reanalysis with no cloud fields at all, so the app's
most important variable is ERA5-only. Resolved with `era5_seamless` and
per-variable provenance.

**The climatology JSON could not produce the score** (§12, §15). 1.0 weighted dew
risk at 10% and precipitation at 5%, but neither field survived into the deployed
schema — §9 had them, §12 dropped them. 15% of the score had no input. Added
`median_dew_spread` and `p_precip`.

**`p_clear_3h` did not say what "clear" meant** (§12). 1.0 stored four unlabelled
run probabilities while §11 defined three cloud thresholds. Restructured as
`p_clear_runs[threshold][run]`.

**The night record destroyed the data the hourly features needed** (§9, §12).
Hour-of-night analysis is described in §1, §19 and §20 and was unbuildable from
the 1.0 schema. Added a per-hour series to the night record and an `hours`
aggregate to the published JSON.

**Activity mode was a primary control missing from V1 scope** (§28). §1 made it
one of three main controls; the scope list omitted it and §15 only gestured at
per-mode weights. Added explicit weight vectors and put modes in scope.

**Run length was off by one** (§11). ERA5 cloud cover is instantaneous at each
hour, so N consecutive samples span N−1 hours. Fixed the convention explicitly
and published it in the provenance panel.

### Gaps filled

| Was undefined | Now |
|---|---|
| "Historically usable night: 46%" (§1) | P(≥2 consecutive clear hours at ≤50% cloud), §12 |
| Which date a night belongs to | The evening date, local time, §8 |
| Leap years and the year boundary | Non-leap day index, Feb 29 folds, window wraps, §10 |
| How weights become a score | Clamped linear normalizers, §15 |
| Units | SI stored, converted for display, §12 |
| `schema_version`, `generated_at` | Added; §27's panel reads from metadata |
| Where generated JSON persists | Committed to main by the data workflow, §24 |
| What `validate_data.py` checks | §28 |
| How Moon-free darkness is computed | Interval intersection, not subtraction, §13 |

### Cautions added

- ERA5's 0.25° grid is ~28 km, so nearby sites share a cloud cell — stated in the
  UI so §21's comparison is not over-read
- the ±7-day window makes the annual curve smooth by construction
- the §16 comparison table must not invite subtracting a historical score from a
  forecast score

### Unchanged

The core design goal (§31), the three-layer architecture (§3), the separation of
climate from astronomy from forecast (§2), the technology choices (§4), and the
V2 list (§29) all stand as written. The central question the application exists
to answer is unchanged.
