"""Fail the build on climatology JSON that is structurally or statistically wrong.

An aggregation bug rarely produces obviously broken output. It produces numbers
that look entirely reasonable on a chart, which is why the monotonicity checks
here matter more than the shape checks: a run-counting or threshold bug shows up
as P(>=4h) exceeding P(>=3h), and as nothing at all to the eye.

    uv run python scripts/validate_data.py
    uv run python scripts/validate_data.py schererville-in
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.common import (  # noqa: E402
    CLOUD_THRESHOLDS,
    LOCATIONS_JSON,
    RUN_LENGTHS,
    SCHEMA_VERSION,
    load_locations,
)

#: A slot built from fewer nights than this is a fetch gap, not a thin season.
MIN_SAMPLE_COUNT = 30

#: Sanity bounds on the published file, in KB.
MIN_FILE_KB = 20
MAX_FILE_KB = 2048

REQUIRED_METADATA = (
    "id",
    "name",
    "latitude",
    "longitude",
    "timezone",
    "baseline",
    "window_days",
    "dark_threshold_deg",
    "run_convention",
    "sources",
    "units",
    "generated_at",
)


class Problems:
    """Collects every failure so one run reports all of them, not just the first."""

    def __init__(self) -> None:
        self.items: list[str] = []

    def check(self, condition: bool, message: str) -> None:
        if not condition:
            self.items.append(message)

    def __bool__(self) -> bool:
        return bool(self.items)


def validate_day(slot: str, day: dict, problems: Problems) -> None:
    where = f"day {slot} ({day.get('date_label', '?')})"

    problems.check(
        day.get("sample_count", 0) >= MIN_SAMPLE_COUNT,
        f"{where}: only {day.get('sample_count')} nights (min {MIN_SAMPLE_COUNT})",
    )

    for key in ("mean_cloud", "median_cloud", "median_humidity"):
        value = day.get(key)
        problems.check(
            isinstance(value, int | float) and 0 <= value <= 100,
            f"{where}: {key} = {value!r} outside 0-100",
        )

    problems.check(
        isinstance(day.get("mean_dark_hours"), int | float) and 0 < day["mean_dark_hours"] <= 24,
        f"{where}: implausible mean_dark_hours {day.get('mean_dark_hours')!r}",
    )

    # Threshold probabilities must not decrease as the threshold relaxes:
    # every night clear at <=10% is also clear at <=25%.
    previous = -1.0
    for threshold in CLOUD_THRESHOLDS:
        p = day.get(f"p_cloud_under_{threshold}")
        problems.check(
            isinstance(p, int | float) and 0.0 <= p <= 1.0,
            f"{where}: p_cloud_under_{threshold} = {p!r} outside [0,1]",
        )
        if isinstance(p, int | float):
            problems.check(
                p >= previous - 1e-9,
                f"{where}: p_cloud_under_{threshold} ({p}) < previous threshold ({previous})",
            )
            previous = p

    runs = day.get("p_clear_runs", {})
    for threshold in CLOUD_THRESHOLDS:
        series = runs.get(str(threshold))
        if not isinstance(series, dict):
            problems.check(False, f"{where}: p_clear_runs missing threshold {threshold}")
            continue

        # A longer run is a strictly stronger requirement, so probability must
        # be non-increasing in run length. This is the check that catches
        # off-by-one and threshold-mixup bugs in the run counter.
        previous = 1.1
        for length in RUN_LENGTHS:
            p = series.get(f"{length}h")
            problems.check(
                isinstance(p, int | float) and 0.0 <= p <= 1.0,
                f"{where}: p_clear_runs[{threshold}][{length}h] = {p!r} outside [0,1]",
            )
            if isinstance(p, int | float):
                problems.check(
                    p <= previous + 1e-9,
                    f"{where}: P(>={length}h @{threshold}%) = {p} exceeds "
                    f"P(>={RUN_LENGTHS[RUN_LENGTHS.index(length) - 1]}h) = {previous}",
                )
                previous = p

    # Relaxing the cloud threshold cannot shorten the achievable run either.
    for length in RUN_LENGTHS:
        previous = -1.0
        for threshold in CLOUD_THRESHOLDS:
            p = runs.get(str(threshold), {}).get(f"{length}h")
            if isinstance(p, int | float):
                problems.check(
                    p >= previous - 1e-9,
                    f"{where}: P(>={length}h @{threshold}%) = {p} below stricter threshold "
                    f"value {previous}",
                )
                previous = p

    hours = day.get("hours", {})
    bins, probabilities, counts = (
        hours.get("bins", []),
        hours.get("p_clear_25", []),
        hours.get("n", []),
    )
    problems.check(
        len(bins) == len(probabilities) == len(counts),
        f"{where}: hours arrays disagree in length "
        f"({len(bins)}, {len(probabilities)}, {len(counts)})",
    )
    problems.check(bins == sorted(bins), f"{where}: hour bins out of order")
    problems.check(
        all(0.0 <= p <= 1.0 for p in probabilities),
        f"{where}: hourly clear probability outside [0,1]",
    )


def validate_location_file(path: Path, problems: Problems) -> None:
    if not path.exists():
        problems.check(False, f"{path.name}: missing")
        return

    size_kb = path.stat().st_size / 1024
    problems.check(
        MIN_FILE_KB <= size_kb <= MAX_FILE_KB,
        f"{path.name}: {size_kb:.0f} KB outside {MIN_FILE_KB}-{MAX_FILE_KB} KB",
    )

    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        problems.check(False, f"{path.name}: invalid JSON - {exc}")
        return

    problems.check(
        payload.get("schema_version") == SCHEMA_VERSION,
        f"{path.name}: schema_version {payload.get('schema_version')!r} != {SCHEMA_VERSION}",
    )

    metadata = payload.get("metadata", {})
    for key in REQUIRED_METADATA:
        problems.check(key in metadata, f"{path.name}: metadata missing {key!r}")

    days = payload.get("days", {})
    problems.check(len(days) == 365, f"{path.name}: {len(days)} day slots, expected 365")
    missing = [str(i) for i in range(1, 366) if str(i) not in days]
    problems.check(not missing, f"{path.name}: missing slots {missing[:10]}")

    for slot, day in sorted(days.items(), key=lambda kv: int(kv[0])):
        validate_day(slot, day, problems)


def validate_index(problems: Problems) -> None:
    if not LOCATIONS_JSON.exists():
        problems.check(False, "locations.json: missing")
        return
    payload = json.loads(LOCATIONS_JSON.read_text())
    problems.check(
        payload.get("schema_version") == SCHEMA_VERSION,
        f"locations.json: schema_version {payload.get('schema_version')!r}",
    )
    problems.check("generated_at" in payload, "locations.json: missing generated_at")
    for entry in payload.get("locations", []):
        target = LOCATIONS_JSON.parent / entry.get("file", "")
        problems.check(target.exists(), f"locations.json: {entry.get('id')} -> missing {target}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("location", nargs="?", help="validate one location instead of all built")
    args = parser.parse_args(argv)

    problems = Problems()
    locations = load_locations()

    if args.location:
        if args.location not in locations:
            parser.error(f"unknown location {args.location!r}; have {sorted(locations)}")
        targets = [locations[args.location]]
    else:
        targets = [loc for loc in locations.values() if loc.json_path.exists()]
        if not targets:
            print("no built location files to validate", file=sys.stderr)
            return 1
        validate_index(problems)

    for loc in targets:
        validate_location_file(loc.json_path, problems)
        print(f"checked {loc.id}")

    if problems:
        print(f"\n{len(problems.items)} problem(s):", file=sys.stderr)
        for item in problems.items[:40]:
            print(f"  {item}", file=sys.stderr)
        if len(problems.items) > 40:
            print(f"  ... and {len(problems.items) - 40} more", file=sys.stderr)
        return 1

    print("\nvalidation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
