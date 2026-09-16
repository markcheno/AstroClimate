"""Astronomical night boundaries, computed with Astronomy Engine.

The browser uses the JavaScript build of the same library, so a dark-hours
figure produced here and one produced in the app agree to the second rather
than differing by a few minutes for reasons nobody can trace.

Twilight boundaries use `SearchAltitude`, which finds a specific Sun altitude.
`SearchRiseSet` is deliberately not used for them: it solves for the topmost
limb with refraction applied, which is the right answer for sunrise and the
wrong one for "when is the Sun 18 degrees down".
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from zoneinfo import ZoneInfo

import astronomy

from scripts.common import Location

#: Sun altitudes bounding each twilight phase, darkest first.
TWILIGHT_ALTITUDES = {"astronomical": -18.0, "nautical": -12.0, "civil": -6.0}

#: Days of slack given to each search. A night always begins within a day of
#: local noon; more than that means the Sun does not reach the altitude at all.
SEARCH_LIMIT_DAYS = 1.0


def observer_for(loc: Location) -> astronomy.Observer:
    return astronomy.Observer(loc.latitude, loc.longitude, loc.elevation_m)


def _to_utc(time: astronomy.Time | None) -> dt.datetime | None:
    """Astronomy Engine returns naive UTC; make it explicit."""
    if time is None:
        return None
    return time.Utc().replace(tzinfo=dt.UTC)


def _from_utc(moment: dt.datetime) -> astronomy.Time:
    m = moment.astimezone(dt.UTC)
    return astronomy.Time.Make(
        m.year, m.month, m.day, m.hour, m.minute, m.second + m.microsecond / 1e6
    )


@dataclass(frozen=True)
class NightWindow:
    """One observing night, keyed by the local calendar date of its evening."""

    evening_date: dt.date
    solar_midnight: dt.datetime

    dark_start: dt.datetime | None
    dark_end: dt.datetime | None
    nautical_start: dt.datetime | None
    nautical_end: dt.datetime | None
    civil_start: dt.datetime | None
    civil_end: dt.datetime | None

    @property
    def has_darkness(self) -> bool:
        return self.dark_start is not None and self.dark_end is not None

    @property
    def dark_hours(self) -> float:
        if not self.has_darkness:
            return 0.0
        return (self.dark_end - self.dark_start).total_seconds() / 3600.0

    def span_hours(self, phase: str) -> float:
        start = getattr(self, f"{phase}_start", None)
        end = getattr(self, f"{phase}_end", None)
        if start is None or end is None:
            return 0.0
        return (end - start).total_seconds() / 3600.0

    def contains(self, moment: dt.datetime) -> bool:
        """Is this sample inside astronomical darkness?

        Half-open so a sample landing exactly on dark_end belongs to no night
        rather than to two.
        """
        if not self.has_darkness:
            return False
        return self.dark_start <= moment < self.dark_end

    def hours_from_solar_midnight(self, moment: dt.datetime) -> float:
        return (moment - self.solar_midnight).total_seconds() / 3600.0


def night_window(
    observer: astronomy.Observer,
    tz: ZoneInfo,
    evening_date: dt.date,
) -> NightWindow:
    """Twilight boundaries for the night beginning on `evening_date`.

    Searches forward from local noon, which is always before that evening's
    sunset and always after the previous night's dawn, so the night found is
    unambiguously the one this date names.
    """
    noon_local = dt.datetime.combine(evening_date, dt.time(12, 0), tzinfo=tz)
    start = _from_utc(noon_local)

    solar_midnight = _to_utc(
        astronomy.SearchHourAngle(astronomy.Body.Sun, observer, 12, start).time
    )

    bounds: dict[str, tuple[dt.datetime | None, dt.datetime | None]] = {}
    for phase, altitude in TWILIGHT_ALTITUDES.items():
        evening = astronomy.SearchAltitude(
            astronomy.Body.Sun,
            observer,
            astronomy.Direction.Set,
            start,
            SEARCH_LIMIT_DAYS,
            altitude,
        )
        # Summer above ~48 degrees never reaches -18; the night simply has no
        # astronomical darkness and the record says so rather than guessing.
        morning = (
            astronomy.SearchAltitude(
                astronomy.Body.Sun,
                observer,
                astronomy.Direction.Rise,
                evening,
                SEARCH_LIMIT_DAYS,
                altitude,
            )
            if evening is not None
            else None
        )
        bounds[phase] = (_to_utc(evening), _to_utc(morning) if morning is not None else None)

    return NightWindow(
        evening_date=evening_date,
        solar_midnight=solar_midnight,
        dark_start=bounds["astronomical"][0],
        dark_end=bounds["astronomical"][1],
        nautical_start=bounds["nautical"][0],
        nautical_end=bounds["nautical"][1],
        civil_start=bounds["civil"][0],
        civil_end=bounds["civil"][1],
    )


def night_windows(
    loc: Location,
    start_year: int,
    end_year: int,
) -> list[NightWindow]:
    """Every night window in the baseline, ordered by evening date."""
    observer = observer_for(loc)
    tz = ZoneInfo(loc.timezone)

    day = dt.date(start_year, 1, 1)
    last = dt.date(end_year, 12, 31)
    out: list[NightWindow] = []
    while day <= last:
        out.append(night_window(observer, tz, day))
        day += dt.timedelta(days=1)
    return out
