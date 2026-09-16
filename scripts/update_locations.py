"""Build every location configured in locations/locations.yaml.

    uv run python scripts/update_locations.py

This is what the Update Location Data workflow runs. One location failing does
not abandon the rest: a transient API problem on the third of five locations
should not discard the two that succeeded, and the exit code still reports the
failure so CI does not quietly publish a partial rebuild.
"""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.build_location import build_location, write_index  # noqa: E402
from scripts.common import (  # noqa: E402
    DEFAULT_END_YEAR,
    DEFAULT_START_YEAR,
    DEFAULT_WINDOW_DAYS,
    load_locations,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end", type=int, default=DEFAULT_END_YEAR)
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW_DAYS)
    parser.add_argument("--force", action="store_true", help="re-download cached years")
    args = parser.parse_args(argv)

    locations = load_locations()
    failures: list[str] = []

    for loc in locations.values():
        try:
            build_location(loc, locations, args.start, args.end, args.window, force=args.force)
        except Exception:
            traceback.print_exc()
            failures.append(loc.id)
            print(f"!! {loc.id} failed; continuing\n", file=sys.stderr)

    write_index(locations)

    built = len(locations) - len(failures)
    print(f"\nbuilt {built}/{len(locations)} location(s)")
    if failures:
        print(f"failed: {', '.join(failures)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
