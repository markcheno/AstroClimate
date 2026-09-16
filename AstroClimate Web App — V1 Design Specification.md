# AstroClimate

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
│   ├── fetch_history.py
│   ├── build_climatology.py
│   ├── build_location.py
│   ├── update_locations.py
│   └── validate_data.py
│
├── locations/
│   └── locations.yaml
│
├── cache/
│   └── .gitignore
│
├── tests/
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

The preprocessing pipeline should save raw downloads locally so repeated builds do not repeatedly query the remote API.

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

This dramatically reduces the amount of data that must ultimately reach the browser.

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
  "metadata": {
    "name": "Schererville, Indiana",
    "latitude": 41.4789,
    "longitude": -87.4548,
    "baseline": "1996-2025",
    "source": "ERA5"
  },

  "days": {
    "263": {
      "date_label": "Sep 20",

      "sample_count": 448,

      "mean_cloud": 34.2,
      "median_cloud": 27.4,

      "p_cloud_under_10": 0.24,
      "p_cloud_under_25": 0.39,
      "p_cloud_under_50": 0.61,

      "p_clear_2h": 0.51,
      "p_clear_3h": 0.43,
      "p_clear_4h": 0.34,
      "p_clear_6h": 0.19,

      "median_humidity": 71,
      "median_wind": 6.8
    }
  }
}
```

One location file should probably be well under a few hundred kilobytes compressed.

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

The user should eventually be able to change these weights.

Deep-sky mode might heavily emphasize long uninterrupted clear periods.

Planetary mode would care considerably less about Moon illumination but more about wind.

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

The historical climatology does not need daily updates.

Monthly or even annual rebuilding is sufficient.

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

Parquet is preferable for the preprocessing pipeline because decades of hourly data become dramatically smaller and faster to analyze.

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

This would allow the climatology portion of the application to function at a dark site without cell service.

---

# 27. Data Provenance

Every climatology page should contain a small information panel:

```text
Historical weather:
ERA5 / ERA5-Land

Baseline:
1996–2025

Temporal resolution:
1 hour

Climatology window:
±7 calendar days

Last generated:
2026-09-15
```

Open-Meteo data requires attribution, and its free API is currently available for non-commercial use subject to usage limits.

---

# 28. V1 Scope

The first release should deliberately remain small.

It needs only:

- configured locations
- 365-day historical climatology
- date selector
- annual climatology graph
- calendar heatmap
- probability of 2/3/4/6 consecutive clear hours
- astronomical darkness
- Moon phase and Moon-free darkness
- current forecast
- mobile-responsive interface
- GitHub Pages deployment
- Python preprocessing pipeline

Everything else can wait.

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
date slider
historical score
cloud probability
3-hour clear probability
darkness duration
Moon information
annual chart
```

Once this works correctly, multiple locations and current forecasts are straightforward additions.

---

# 31. Core Design Goal

The application should not simply answer:

> What is the average cloud cover?

It should answer the much more useful astronomy question:

> **If I plan to observe at this location on this date, what is the historical probability that I will actually get several uninterrupted dark, clear hours?**

That should remain the central design principle throughout development.