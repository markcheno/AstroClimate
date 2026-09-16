"""Shared configuration, conventions and helpers for the AstroClimate pipeline.

The conventions defined here are the contract between the Python preprocessing
side and the browser application. They are deliberately explicit, because
several of them are the kind of choice that silently produces plausible-looking
but wrong numbers if each script decides for itself:

  * night keying      a night is keyed by the calendar date of its EVENING in
                      the location's local timezone (the night of Sep 20->21 is
                      "2024-09-20")
  * day index         1..365 derived from (month, day) against a non-leap year,
                      so Sep 20 is always 263; Feb 29 folds into Feb 28
  * run convention    each hourly sample represents the 1-hour block BEGINNING
                      at its timestamp, so N consecutive clear samples is N
                      clear hours
  * units             stored in SI (m/s, degC, mm, percent); the browser converts
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from pathlib import Path

import yaml

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
LOCATIONS_YAML = REPO_ROOT / "locations" / "locations.yaml"
CACHE_DIR = REPO_ROOT / "cache"
DATA_DIR = REPO_ROOT / "app" / "public" / "data"
LOCATIONS_JSON = DATA_DIR / "locations.json"
LOCATION_JSON_DIR = DATA_DIR / "locations"

# --------------------------------------------------------------------------
# Schema and baseline
# --------------------------------------------------------------------------

SCHEMA_VERSION = 1

DEFAULT_START_YEAR = 1996
DEFAULT_END_YEAR = 2025

#: Half-width of the day-of-year climatology window, in days (spec section 10).
DEFAULT_WINDOW_DAYS = 7

#: Sun altitude defining astronomical darkness (spec section 8).
DARK_THRESHOLD_DEG = -18.0

#: Twilight thresholds retained on each night record so the UI can relax the
#: darkness requirement for bright targets and planetary work.
TWILIGHT_THRESHOLDS_DEG = {"civil": -6.0, "nautical": -12.0, "astronomical": -18.0}

#: Cloud-cover percentages defining "clear" (spec section 11).
CLOUD_THRESHOLDS = (10, 25, 50)

#: Consecutive-clear-hour run lengths whose probabilities we publish.
RUN_LENGTHS = (1, 2, 3, 4, 6)

#: "Historically usable night" == P(>=2 consecutive clear hours at <=50% cloud).
USABLE_NIGHT_THRESHOLD = 50
USABLE_NIGHT_RUN_HOURS = 2

#: Hour bins for the hour-of-night analysis, relative to solar midnight.
#: Clock hours are not comparable across a +/-7 day window, 30 years of DST
#: changes, and a night length that varies by 6+ hours through the year.
HOUR_BINS = tuple(range(-6, 7))

#: Minimum samples in an hour bin before the UI is allowed to plot it.
MIN_HOUR_BIN_SAMPLES = 30

RUN_CONVENTION = "sample_as_block"

UNITS = {
    "wind": "m/s",
    "temperature": "degC",
    "precipitation": "mm",
    "cloud": "percent",
}

# --------------------------------------------------------------------------
# Open-Meteo
# --------------------------------------------------------------------------

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

#: Hourly fields requested from the archive API (spec section 7).
HOURLY_VARIABLES = (
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "temperature_2m",
    "relative_humidity_2m",
    "dew_point_2m",
    "precipitation",
    "wind_speed_10m",
)

#: ERA5-Land carries no cloud fields at all, so cloud cover can only come from
#: ERA5 (0.25 deg). era5_seamless takes temperature and humidity from ERA5-Land
#: at 0.1 deg and everything else from ERA5, which is why provenance is recorded
#: per variable rather than as one string.
ARCHIVE_MODEL = "era5_seamless"

VARIABLE_SOURCES = {
    "cloud_cover": "ERA5 (0.25 deg)",
    "cloud_cover_low": "ERA5 (0.25 deg)",
    "cloud_cover_mid": "ERA5 (0.25 deg)",
    "cloud_cover_high": "ERA5 (0.25 deg)",
    "precipitation": "ERA5 (0.25 deg)",
    "wind_speed_10m": "ERA5 (0.25 deg)",
    "temperature_2m": "ERA5-Land (0.1 deg)",
    "relative_humidity_2m": "ERA5-Land (0.1 deg)",
    "dew_point_2m": "ERA5-Land (0.1 deg)",
}

#: ERA5 reaches the archive about five days behind real time.
ARCHIVE_LATENCY_DAYS = 5

# --------------------------------------------------------------------------
# Locations
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Location:
    id: str
    name: str
    latitude: float
    longitude: float
    elevation_m: float
    timezone: str
    label_short: str

    @property
    def cache_dir(self) -> Path:
        return CACHE_DIR / self.id

    @property
    def json_path(self) -> Path:
        return LOCATION_JSON_DIR / f"{self.id}.json"


def load_locations(path: Path = LOCATIONS_YAML) -> dict[str, Location]:
    """Parse locations.yaml into an id -> Location mapping, preserving file order."""
    raw = yaml.safe_load(path.read_text())
    if not raw or "locations" not in raw:
        raise ValueError(f"{path} has no 'locations' key")

    out: dict[str, Location] = {}
    for entry in raw["locations"]:
        missing = {"id", "name", "latitude", "longitude", "timezone"} - entry.keys()
        if missing:
            raise ValueError(f"location {entry.get('id', '?')} missing {sorted(missing)}")
        loc = Location(
            id=entry["id"],
            name=entry["name"],
            latitude=float(entry["latitude"]),
            longitude=float(entry["longitude"]),
            elevation_m=float(entry.get("elevation_m", 0.0)),
            timezone=entry["timezone"],
            label_short=entry.get("label_short", entry["name"]),
        )
        if loc.id in out:
            raise ValueError(f"duplicate location id {loc.id!r}")
        out[loc.id] = loc
    return out


# --------------------------------------------------------------------------
# Day-of-year conventions
# --------------------------------------------------------------------------

#: Any non-leap year works as the reference; 2001 is used throughout.
_REF_YEAR = 2001


def day_index(month: int, day: int) -> int:
    """Return the 1..365 climatology slot for a calendar (month, day).

    Feb 29 folds into Feb 28 so that leap days contribute their weather rather
    than being discarded, and so the slot for a given date never shifts between
    leap and non-leap years (Sep 20 is 263 in every year).
    """
    if month == 2 and day == 29:
        day = 28
    return dt.date(_REF_YEAR, month, day).timetuple().tm_yday


def day_index_of(date: dt.date) -> int:
    return day_index(date.month, date.day)


def date_label(index: int) -> str:
    """Human label for a climatology slot, e.g. 263 -> 'Sep 20'."""
    d = dt.date(_REF_YEAR, 1, 1) + dt.timedelta(days=index - 1)
    return f"{d.strftime('%b')} {d.day}"


def window_indices(index: int, window_days: int = DEFAULT_WINDOW_DAYS) -> list[int]:
    """Climatology slots within +/- window_days of `index`, wrapping the year.

    Jan 3 pulls in the last week of December; Dec 29 pulls in the first week of
    January. Without the wrap, both ends of the year would be built from half
    the samples of every other date.
    """
    return [((index - 1 + offset) % 365) + 1 for offset in range(-window_days, window_days + 1)]


def baseline_label(start_year: int, end_year: int) -> str:
    return f"{start_year}-{end_year}"


def utc_now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
