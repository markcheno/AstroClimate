# AstroClimate

**Historically, how good is this location for astronomy on this date?**

A static web app that answers the question an astronomer actually has when
planning a night, which is not "what is the average cloud cover" but:

> If I drive out here on September 20, what is the chance I get several
> uninterrupted dark, clear hours?

Average cloud cover cannot answer that. A night alternating hourly between clear
and cloudy has the same mean as a night with four unbroken clear hours, and only
one of them is worth the drive. So the core statistics here are **probabilities
of consecutive clear hours**, computed from thirty years of hourly reanalysis
over the hours the Sun is actually below −18°.

Python preprocesses the history offline; the browser gets small JSON files and
does the astronomy itself. There is no server.

---

## Quick start

```bash
just setup                      # uv sync + npm install
just build schererville-in      # fetch 30 years, build climatology (several minutes)
just dev                        # http://localhost:5173/AstroClimate/
```

`just` on its own lists every recipe. The ones you'll use:

| Command | What it does |
|---|---|
| `just build <id>` | Fetch history and rebuild one location |
| `just build-all` | Rebuild every location in `locations/locations.yaml` |
| `just climatology <id>` | Rebuild from the existing cache, no network |
| `just validate` | Check built JSON — run before committing data |
| `just status` | What is cached and what is built |
| `just dev` | Vite dev server |
| `just preview` | Build and serve exactly what Pages will serve |
| `just check` | Lint, typecheck, both test suites, validate |

Requires [uv](https://docs.astral.sh/uv/), Node 22+, and
[just](https://github.com/casey/just). Every recipe is a one-line wrapper — read
the `justfile` if you'd rather run the underlying commands directly. CI calls the
scripts itself and does not depend on `just`.

---

## Any location

Search for any town or postal code and you immediately get **astronomical
darkness, Moon phase, moon-free darkness and tonight's forecast** — astronomy is
pure computation and the forecast API is global, so neither needs preprocessing.

What a searched location does *not* get is the thirty-year history. That still
requires a build. Two ways to close the gap:

- **Add it permanently** — put it in `locations.yaml`, run `just build <id>`, and
  it becomes instant for everyone (below).
- **Compute it in the browser** — not built yet, but measured and practical:
  year-chunked parallel requests fetch 30 years in 16–51 s, and the night
  windows compute in 1.6 s of JavaScript. See §22 of the spec for the design.

ERA5's cloud grid is 0.25°, which is worth knowing before you add anything:
Schererville and Highland are 9 km apart and return **byte-identical** cloud
series. If you already have a location built, anywhere within ~14 km of it has
the same cloud history, and building the neighbour gains you nothing.

---

## Adding a location

Append to `locations/locations.yaml`:

```yaml
  - id: holland-mi
    name: Holland, Michigan
    latitude: 42.7875
    longitude: -86.1089
    elevation_m: 187
    timezone: America/Detroit
    label_short: Holland
```

Then `just build holland-mi` and commit the generated
`app/public/data/locations/holland-mi.json`. Or edit the file on `main` and run
the **Update Location Data** action, which does the same thing and commits the
result for you.

---

## How it works

```
Open-Meteo archive          ERA5 + ERA5-Land, hourly, 1996–2025
        │
        ▼  scripts/fetch_history.py        one request per year
cache/<id>/<year>.parquet                  ~4 MB per location, gitignored
        │
        ▼  scripts/build_climatology.py    stage 1: nights
one record per observing night             only hours with the Sun below −18°
        │
        ▼  scripts/build_climatology.py    stage 2: day-of-year
app/public/data/locations/<id>.json        365 records, 247 KB (33 KB gzipped)
        │
        ▼  GitHub Pages
browser                                    score, Moon and darkness computed here
```

Only the derived JSON is deployed. The raw downloads never leave your machine.

### Why the browser does the astronomy

Weather climatology repeats every calendar year. **The lunar cycle does not.**
September 20 may be historically excellent for weather and still have a nearly
full Moon in 2026. So the Moon is never baked into the climatology — the app
combines a year-independent weather climatology with current-year astronomy:

```
weather climatology + current-year astronomy = expected imaging opportunity
```

The same reasoning applies to the score: it is computed in the browser from the
published components, never stored. That is what lets the activity selector
change it instantly without regenerating any data.

---

## Conventions worth knowing before you read the code

These are the decisions that produce plausible-looking wrong numbers if each
script picks its own. They live in `scripts/common.py` and are mirrored in
`app/src/climatology/types.ts`.

**A night is keyed by its evening.** The night of Sep 20→21 is `2024-09-20`, in
the location's local timezone.

**One hourly sample means one clear hour.** ERA5 reports cloud cover
instantaneously, so three consecutive clear samples strictly span two hours of
elapsed time. Each sample is treated as the one-hour block beginning at its
timestamp, which makes "3 consecutive clear hours" mean what a reader expects.
The convention is shown in the app's provenance panel so the number is
auditable.

**Day index is 1–365 against a non-leap year.** Sep 20 is 263 in every year. Feb
29 folds into Feb 28 rather than being discarded, and the ±7-day window wraps the
year boundary — without the wrap, January and December would quietly be built
from half the samples of every other date.

**Files store SI.** m/s, °C, mm. The browser converts for display.

**Cloud cover is ERA5-only.** ERA5-Land has no cloud fields at all, so the
pipeline uses `era5_seamless` and records provenance per variable. ERA5's cloud
grid is 0.25° — about 28 km — so two sites 15 km apart return identical cloud
climatology. The app says so; don't read more into a location comparison than
the grid supports.

---

## Reading the numbers honestly

The ±7-day window means adjacent dates share 14 of their 15 days of source data.
The annual curve is therefore smooth **by construction**, not because weather is
smooth.

The hour-of-night feature withholds its answer unless the clearest and cloudiest
hours differ by more than three standard errors. At Schererville they differ by
about six points over 450 nights, where three standard errors is roughly eight —
so the app reports "no clear preference" rather than naming a range. A confident
"1–3 AM is clearest" is worth nothing if it is reporting sampling noise.

Historical and forecast numbers are never mixed or differenced. They answer
different questions, and one of them is a probability.

---

## Layout

```
app/                    Vite + React + TypeScript
  src/astronomy/        twilight, Moon, moon-free darkness
  src/climatology/      schema types, loading, score
  src/charts/           annual chart
  public/data/          generated JSON — committed, this is what deploys
scripts/                Python preprocessing
  common.py             the conventions above
  astro.py              twilight boundaries via Astronomy Engine
locations/              locations.yaml
cache/                  raw ERA5 parquet, gitignored
tests/                  Python tests (frontend tests sit beside their source)
```

Python and the browser use the same Astronomy Engine implementation, so a
dark-hours figure from the pipeline matches one computed in the app — they agree
to within 50 ms.

The full design rationale is in
[the V1 design specification](AstroClimate%20Web%20App%20%E2%80%94%20V1%20Design%20Specification.md).

---

## Status

Working: the preprocessing pipeline, one built location, location search for
anywhere on Earth, the annual chart, the score with all five activity modes and
its breakdown, darkness and Moon, the current forecast, and the provenance panel.

Not built yet: calendar heatmap, date detail screen, hour-of-night chart,
location comparison, on-demand climatology in the browser, PWA.

---

## Data and attribution

Weather data by [Open-Meteo](https://open-meteo.com/), CC BY 4.0, whose free tier
is for non-commercial use — so this site carries no ads and no subscription.
Astronomy by [Astronomy Engine](https://github.com/cosinekitty/astronomy).
ERA5 and ERA5-Land are produced by ECMWF / Copernicus Climate Change Service.
