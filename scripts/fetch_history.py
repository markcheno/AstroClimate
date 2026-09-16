"""Download hourly ERA5 history from Open-Meteo into the local parquet cache.

One request per calendar year, written to cache/<location>/<year>.parquet.
Years already cached are skipped, so an interrupted run resumes where it left
off and a monthly rebuild only fetches what is new.

    uv run python scripts/fetch_history.py schererville-in
    uv run python scripts/fetch_history.py --all --start 1996 --end 2025
    uv run python scripts/fetch_history.py schererville-in --force

Timestamps are requested and stored in UTC. Converting to local time is left to
the night-building stage, which needs the location's IANA zone anyway to decide
which evening a sample belongs to; asking the API to do it would bake a DST
convention into the cache.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
import time
from pathlib import Path

import httpx
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.common import (  # noqa: E402
    ARCHIVE_LATENCY_DAYS,
    ARCHIVE_MODEL,
    ARCHIVE_URL,
    DEFAULT_END_YEAR,
    DEFAULT_START_YEAR,
    HOURLY_VARIABLES,
    Location,
    load_locations,
)

MAX_ATTEMPTS = 5
BACKOFF_BASE_SECONDS = 2.0
REQUEST_TIMEOUT = httpx.Timeout(120.0, connect=30.0)

#: Open-Meteo asks for a courteous gap between requests on the free tier. Thirty
#: years is only thirty requests per location, so this costs under a minute.
POLITE_DELAY_SECONDS = 1.0


def latest_available_date(today: dt.date | None = None) -> dt.date:
    """Most recent date ERA5 is likely to cover, given the archive's lag."""
    today = today or dt.date.today()
    return today - dt.timedelta(days=ARCHIVE_LATENCY_DAYS)


def year_bounds(year: int, today: dt.date | None = None) -> tuple[dt.date, dt.date] | None:
    """Inclusive (start, end) to request for `year`, or None if it is not yet available.

    The current year is clipped to the archive's availability so a rebuild in
    March does not ask for a full year and get an error or a wall of nulls.
    """
    start = dt.date(year, 1, 1)
    end = dt.date(year, 12, 31)
    available = latest_available_date(today)
    if start > available:
        return None
    return start, min(end, available)


def fetch_year(client: httpx.Client, loc: Location, year: int) -> pd.DataFrame | None:
    """Request one calendar year of hourly data. Returns None if unavailable."""
    bounds = year_bounds(year)
    if bounds is None:
        print(f"  {year}: not yet in the archive, skipping")
        return None
    start, end = bounds

    params = {
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "hourly": ",".join(HOURLY_VARIABLES),
        "models": ARCHIVE_MODEL,
        "timezone": "UTC",
        "wind_speed_unit": "ms",
        "temperature_unit": "celsius",
        "precipitation_unit": "mm",
    }

    payload = request_with_retry(client, params, label=f"{loc.id} {year}")
    hourly = payload.get("hourly")
    if not hourly or not hourly.get("time"):
        raise RuntimeError(f"{loc.id} {year}: response contained no hourly data")

    frame = pd.DataFrame(hourly)
    frame["time"] = pd.to_datetime(frame["time"], utc=True)

    missing = [v for v in HOURLY_VARIABLES if v not in frame.columns]
    if missing:
        raise RuntimeError(f"{loc.id} {year}: API omitted {missing}")

    return frame[["time", *HOURLY_VARIABLES]]


def request_with_retry(client: httpx.Client, params: dict, label: str) -> dict:
    """GET with exponential backoff on rate limits and transient server errors.

    A 429 here means the daily or minutely quota is gone; retrying immediately
    would only burn more of it, so the wait doubles each attempt.
    """
    last_error: Exception | None = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.get(ARCHIVE_URL, params=params, timeout=REQUEST_TIMEOUT)
        except httpx.RequestError as exc:
            last_error = exc
        else:
            if response.status_code == 200:
                return response.json()

            # Open-Meteo reports quota and bad-parameter problems as JSON with a
            # "reason" field; surfacing it turns a bare 400 into a real message.
            reason = ""
            try:
                reason = response.json().get("reason", "")
            except Exception:
                reason = response.text[:200]

            if response.status_code == 400:
                raise RuntimeError(f"{label}: bad request - {reason}")

            last_error = RuntimeError(f"HTTP {response.status_code} - {reason}")

        if attempt < MAX_ATTEMPTS:
            wait = BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
            print(f"  {label}: attempt {attempt} failed ({last_error}); retrying in {wait:.0f}s")
            time.sleep(wait)

    raise RuntimeError(f"{label}: giving up after {MAX_ATTEMPTS} attempts - {last_error}")


def fetch_location(
    loc: Location,
    start_year: int,
    end_year: int,
    force: bool = False,
) -> int:
    """Populate the parquet cache for one location. Returns the number of years fetched."""
    loc.cache_dir.mkdir(parents=True, exist_ok=True)
    print(f"{loc.id} ({loc.latitude}, {loc.longitude}) {start_year}-{end_year}")

    fetched = 0
    user_agent = "AstroClimate/0.1 (github.com/markcheno/AstroClimate)"
    with httpx.Client(headers={"User-Agent": user_agent}) as client:
        for year in range(start_year, end_year + 1):
            target = loc.cache_dir / f"{year}.parquet"
            if target.exists() and not force:
                print(f"  {year}: cached")
                continue

            frame = fetch_year(client, loc, year)
            if frame is None:
                continue

            # Write via a temporary file so an interrupted run never leaves a
            # truncated parquet that the next run would happily treat as cached.
            tmp = target.with_suffix(".parquet.tmp")
            frame.to_parquet(tmp, index=False, compression="zstd")
            tmp.replace(target)

            nulls = int(frame["cloud_cover"].isna().sum())
            note = f", {nulls} null cloud hours" if nulls else ""
            print(f"  {year}: {len(frame)} hours{note}")
            fetched += 1
            time.sleep(POLITE_DELAY_SECONDS)

    return fetched


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("location", nargs="?", help="location id from locations/locations.yaml")
    parser.add_argument("--all", action="store_true", help="fetch every configured location")
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR, help="first baseline year")
    parser.add_argument("--end", type=int, default=DEFAULT_END_YEAR, help="last baseline year")
    parser.add_argument("--force", action="store_true", help="re-download years already cached")
    args = parser.parse_args(argv)

    if args.start > args.end:
        parser.error(f"--start {args.start} is after --end {args.end}")
    if not args.location and not args.all:
        parser.error("give a location id or --all")

    locations = load_locations()
    if args.all:
        targets = list(locations.values())
    else:
        if args.location not in locations:
            parser.error(f"unknown location {args.location!r}; have {sorted(locations)}")
        targets = [locations[args.location]]

    total = 0
    for loc in targets:
        total += fetch_location(loc, args.start, args.end, force=args.force)

    print(f"\nfetched {total} year-files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
