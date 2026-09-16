"""Fetch history and build climatology for one location, end to end.

    uv run python scripts/build_location.py schererville-in

Downloads whatever years are missing from the cache, rebuilds the climatology
JSON, and refreshes the location index the browser reads first.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.build_climatology import build  # noqa: E402
from scripts.common import (  # noqa: E402
    DEFAULT_END_YEAR,
    DEFAULT_START_YEAR,
    DEFAULT_WINDOW_DAYS,
    LOCATION_JSON_DIR,
    LOCATIONS_JSON,
    SCHEMA_VERSION,
    Location,
    load_locations,
    utc_now_iso,
)
from scripts.fetch_history import fetch_location  # noqa: E402


def write_index(locations: dict[str, Location]) -> None:
    """Rewrite locations.json from whichever location files actually exist.

    Built from the filesystem rather than from locations.yaml, so a location
    that is configured but not yet built never appears in the UI as a broken
    link.
    """
    entries = []
    for loc in locations.values():
        if not loc.json_path.exists():
            continue
        entries.append(
            {
                "id": loc.id,
                "name": loc.name,
                "label_short": loc.label_short,
                "latitude": loc.latitude,
                "longitude": loc.longitude,
                "elevation_m": loc.elevation_m,
                "timezone": loc.timezone,
                "file": str(loc.json_path.relative_to(LOCATIONS_JSON.parent)),
                "bytes": loc.json_path.stat().st_size,
            }
        )

    LOCATIONS_JSON.parent.mkdir(parents=True, exist_ok=True)

    # Same reasoning as the location files: keep the old timestamp when nothing
    # substantive changed, so a rebuild that finds no new data leaves the tree
    # clean and the monthly workflow has nothing to commit.
    if LOCATIONS_JSON.exists():
        try:
            existing = json.loads(LOCATIONS_JSON.read_text())
        except json.JSONDecodeError:
            existing = None
        if existing is not None and existing.get("locations") == entries:
            print(f"index: unchanged, {len(entries)} location(s)")
            return

    LOCATIONS_JSON.write_text(
        json.dumps(
            {
                "schema_version": SCHEMA_VERSION,
                "generated_at": utc_now_iso(),
                "locations": entries,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"index: {len(entries)} location(s) in {LOCATIONS_JSON.name}")


def build_location(
    loc: Location,
    locations: dict[str, Location],
    start_year: int = DEFAULT_START_YEAR,
    end_year: int = DEFAULT_END_YEAR,
    window_days: int = DEFAULT_WINDOW_DAYS,
    force: bool = False,
) -> Path:
    LOCATION_JSON_DIR.mkdir(parents=True, exist_ok=True)
    fetch_location(loc, start_year, end_year, force=force)
    path = build(loc, start_year, end_year, window_days)
    write_index(locations)
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("location", help="location id from locations/locations.yaml")
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end", type=int, default=DEFAULT_END_YEAR)
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW_DAYS)
    parser.add_argument("--force", action="store_true", help="re-download cached years")
    args = parser.parse_args(argv)

    locations = load_locations()
    if args.location not in locations:
        parser.error(f"unknown location {args.location!r}; have {sorted(locations)}")

    build_location(
        locations[args.location],
        locations,
        args.start,
        args.end,
        args.window,
        force=args.force,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
