"""Turn the cached hourly archive into the climatology JSON the browser loads.

Two stages:

  1. nights       hourly samples -> one record per observing night, keyed by
                  the evening's local date, covering only the hours the Sun is
                  below -18 degrees
  2. climatology  nights -> one record per day-of-year slot, aggregated over a
                  rolling +/-7 day window across the whole baseline

    uv run python scripts/build_climatology.py schererville-in

Run counts follow the sample-as-block convention: each hourly sample stands for
the one-hour block beginning at its timestamp, so N consecutive clear samples
is N clear hours. ERA5 reports cloud cover instantaneously, so the alternative
reading would make "3 consecutive clear hours" mean two hours of sky.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.astro import NightWindow, night_windows  # noqa: E402
from scripts.common import (  # noqa: E402
    ARCHIVE_MODEL,
    CLOUD_THRESHOLDS,
    DARK_THRESHOLD_DEG,
    DEFAULT_END_YEAR,
    DEFAULT_START_YEAR,
    DEFAULT_WINDOW_DAYS,
    HOUR_BINS,
    MIN_HOUR_BIN_SAMPLES,
    RUN_CONVENTION,
    RUN_LENGTHS,
    SCHEMA_VERSION,
    UNITS,
    USABLE_NIGHT_RUN_HOURS,
    USABLE_NIGHT_THRESHOLD,
    VARIABLE_SOURCES,
    Location,
    date_label,
    day_index_of,
    load_locations,
    utc_now_iso,
    window_indices,
)

#: A night with fewer usable samples than this is dropped: it is a data gap,
#: not a short night, and averaging over it would understate cloud cover.
MIN_SAMPLES_PER_NIGHT = 3


# ---------------------------------------------------------------------------
# Stage 1: nights
# ---------------------------------------------------------------------------


def load_hourly(loc: Location) -> pd.DataFrame:
    """Concatenate every cached year into one time-sorted frame."""
    files = sorted(loc.cache_dir.glob("[0-9][0-9][0-9][0-9].parquet"))
    if not files:
        raise FileNotFoundError(
            f"no cached data in {loc.cache_dir}; run scripts/fetch_history.py {loc.id} first"
        )
    frame = pd.concat((pd.read_parquet(f) for f in files), ignore_index=True)
    frame = frame.sort_values("time").reset_index(drop=True)
    # Drop to naive UTC so the column is a real datetime64 array rather than
    # object-dtype Timestamps, which searchsorted cannot compare. Everything
    # downstream is UTC, so nothing is lost; astro.py's boundaries are stripped
    # the same way at the point of use.
    frame["time"] = frame["time"].dt.tz_convert("UTC").dt.tz_localize(None)
    frame["dew_spread"] = frame["temperature_2m"] - frame["dew_point_2m"]
    return frame


def _naive_utc(moment):
    """Strip the tzinfo from an already-UTC moment produced by astro.py."""
    return moment.replace(tzinfo=None)


def longest_run(mask: np.ndarray) -> int:
    """Longest stretch of consecutive True values."""
    best = current = 0
    for value in mask:
        current = current + 1 if value else 0
        best = max(best, current)
    return best


def night_record(window: NightWindow, samples: pd.DataFrame) -> dict | None:
    """Collapse one night's hourly samples into a single record."""
    if not window.has_darkness or len(samples) < MIN_SAMPLES_PER_NIGHT:
        return None

    cloud = samples["cloud_cover"].to_numpy()
    offsets = np.round(
        (samples["time"] - _naive_utc(window.solar_midnight)).dt.total_seconds().to_numpy()
        / 3600.0
    ).astype(int)

    record: dict = {
        "date": window.evening_date.isoformat(),
        "day_index": day_index_of(window.evening_date),
        "dark_hours": round(window.dark_hours, 3),
        "nautical_hours": round(window.span_hours("nautical"), 3),
        "civil_hours": round(window.span_hours("civil"), 3),
        "sample_count": len(samples),
        "mean_cloud": float(cloud.mean()),
        "median_cloud": float(np.median(cloud)),
        "mean_low_cloud": float(samples["cloud_cover_low"].mean()),
        "mean_mid_cloud": float(samples["cloud_cover_mid"].mean()),
        "mean_high_cloud": float(samples["cloud_cover_high"].mean()),
        "precipitation_hours": int((samples["precipitation"] > 0).sum()),
        "mean_humidity": float(samples["relative_humidity_2m"].mean()),
        "mean_dew_spread": float(samples["dew_spread"].mean()),
        "mean_wind": float(samples["wind_speed_10m"].mean()),
        # Retained so the day-of-year stage can build hour-of-night aggregates;
        # this never reaches the browser.
        "hour_offsets": offsets.tolist(),
        "hour_cloud": cloud.astype(float).tolist(),
    }

    for threshold in CLOUD_THRESHOLDS:
        clear = cloud <= threshold
        record[f"clear_fraction_{threshold}"] = float(clear.mean())
        record[f"longest_clear_run_{threshold}"] = longest_run(clear)

    return record


def build_nights(
    loc: Location,
    start_year: int = DEFAULT_START_YEAR,
    end_year: int = DEFAULT_END_YEAR,
) -> pd.DataFrame:
    """One record per observing night across the baseline."""
    hourly = load_hourly(loc)
    times = hourly["time"].to_numpy()

    records: list[dict] = []
    skipped = 0
    for window in night_windows(loc, start_year, end_year):
        if not window.has_darkness:
            skipped += 1
            continue
        # Half-open slice by timestamp; the frame is sorted, so this is a pair
        # of binary searches rather than a scan of 260k rows per night.
        lo = np.searchsorted(times, np.datetime64(_naive_utc(window.dark_start)), "left")
        hi = np.searchsorted(times, np.datetime64(_naive_utc(window.dark_end)), "left")
        record = night_record(window, hourly.iloc[lo:hi])
        if record is None:
            skipped += 1
        else:
            records.append(record)

    if not records:
        raise RuntimeError(f"{loc.id}: no usable nights between {start_year} and {end_year}")

    print(f"  nights: {len(records)} usable, {skipped} skipped")
    return pd.DataFrame(records)


# ---------------------------------------------------------------------------
# Stage 2: day-of-year climatology
# ---------------------------------------------------------------------------


def hourly_long_frame(nights: pd.DataFrame) -> pd.DataFrame:
    """Explode the retained per-night hour series into (day_index, offset, cloud) rows.

    About 100k rows for a 30-year baseline, which is small enough to pool
    directly per day-of-year slot rather than pre-aggregating.
    """
    return pd.DataFrame(
        {
            "day_index": np.repeat(
                nights["day_index"].to_numpy(), nights["hour_offsets"].str.len().to_numpy()
            ),
            "offset": np.concatenate(nights["hour_offsets"].to_numpy()),
            "cloud": np.concatenate(nights["hour_cloud"].to_numpy()),
        }
    )


def hour_of_night_block(pooled: pd.DataFrame) -> dict:
    """Clear probability per hour bin, measured from solar midnight.

    Clock hours are not comparable across a +/-7 day window, thirty years of
    DST changes, and a night that varies in length by six hours through the
    year. Offsets from solar midnight are. The browser converts them back to
    clock labels for whichever year the user has selected.
    """
    bins, probabilities, counts = [], [], []
    for offset in HOUR_BINS:
        at_offset = pooled[pooled["offset"] == offset]
        n = len(at_offset)
        if n < MIN_HOUR_BIN_SAMPLES:
            # Early-evening bins in June are genuinely thin; publishing a
            # probability from a handful of samples would invite a reading the
            # data cannot support.
            continue
        bins.append(int(offset))
        probabilities.append(round(float((at_offset["cloud"] <= 25).mean()), 4))
        counts.append(int(n))

    return {"bins": bins, "p_clear_25": probabilities, "n": counts}


def day_record(
    index: int,
    nights: pd.DataFrame,
    long: pd.DataFrame,
    window_days: int,
) -> dict:
    """Aggregate every night within the rolling window into one published record."""
    window = window_indices(index, window_days)
    subset = nights[nights["day_index"].isin(window)]
    pooled = long[long["day_index"].isin(window)]

    if subset.empty:
        raise RuntimeError(f"day slot {index} ({date_label(index)}) has no nights")

    # Threshold probabilities are per-night, like the run probabilities, so
    # every published figure answers the same question: out of N historical
    # nights, what fraction satisfied this?
    record: dict = {
        "date_label": date_label(index),
        "sample_count": int(len(subset)),
        "mean_dark_hours": round(float(subset["dark_hours"].mean()), 3),
        "mean_cloud": round(float(pooled["cloud"].mean()), 2),
        "median_cloud": round(float(pooled["cloud"].median()), 2),
        "median_high_cloud": round(float(subset["mean_high_cloud"].median()), 2),
    }

    for threshold in CLOUD_THRESHOLDS:
        p = float((subset["median_cloud"] <= threshold).mean())
        record[f"p_cloud_under_{threshold}"] = round(p, 4)

    runs: dict[str, dict[str, float]] = {}
    for threshold in CLOUD_THRESHOLDS:
        column = subset[f"longest_clear_run_{threshold}"]
        runs[str(threshold)] = {
            f"{length}h": round(float((column >= length).mean()), 4) for length in RUN_LENGTHS
        }
    record["p_clear_runs"] = runs

    record["p_usable_night"] = runs[str(USABLE_NIGHT_THRESHOLD)][f"{USABLE_NIGHT_RUN_HOURS}h"]

    record["median_humidity"] = round(float(subset["mean_humidity"].median()), 1)
    record["median_dew_spread"] = round(float(subset["mean_dew_spread"].median()), 2)
    record["median_wind"] = round(float(subset["mean_wind"].median()), 2)
    record["p_precip"] = round(float((subset["precipitation_hours"] > 0).mean()), 4)

    record["hours"] = hour_of_night_block(pooled)
    return record


def build_climatology(
    loc: Location,
    nights: pd.DataFrame,
    start_year: int,
    end_year: int,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> dict:
    """Assemble the complete location file the browser downloads."""
    long = hourly_long_frame(nights)

    days = {
        str(index): day_record(index, nights, long, window_days) for index in range(1, 366)
    }

    return {
        "schema_version": SCHEMA_VERSION,
        "metadata": {
            "id": loc.id,
            "name": loc.name,
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "elevation_m": loc.elevation_m,
            "timezone": loc.timezone,
            "baseline": {"start_year": start_year, "end_year": end_year},
            "window_days": window_days,
            "dark_threshold_deg": DARK_THRESHOLD_DEG,
            "run_convention": RUN_CONVENTION,
            "usable_night": {
                "cloud_threshold": USABLE_NIGHT_THRESHOLD,
                "run_hours": USABLE_NIGHT_RUN_HOURS,
            },
            "model": ARCHIVE_MODEL,
            "sources": VARIABLE_SOURCES,
            "units": UNITS,
            "generated_at": utc_now_iso(),
        },
        "days": days,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build(loc: Location, start_year: int, end_year: int, window_days: int) -> Path:
    print(f"{loc.id}: {start_year}-{end_year}, window +/-{window_days}d")
    nights = build_nights(loc, start_year, end_year)
    payload = build_climatology(loc, nights, start_year, end_year, window_days)

    loc.json_path.parent.mkdir(parents=True, exist_ok=True)
    loc.json_path.write_text(json.dumps(payload, separators=(",", ":")))
    size_kb = loc.json_path.stat().st_size / 1024
    print(f"  wrote {loc.json_path.relative_to(Path.cwd())} ({size_kb:.0f} KB)")
    return loc.json_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("location", help="location id from locations/locations.yaml")
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end", type=int, default=DEFAULT_END_YEAR)
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW_DAYS)
    args = parser.parse_args(argv)

    locations = load_locations()
    if args.location not in locations:
        parser.error(f"unknown location {args.location!r}; have {sorted(locations)}")

    build(locations[args.location], args.start, args.end, args.window)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
