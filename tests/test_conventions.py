"""Tests for the day-of-year and archive-availability conventions.

These encode decisions that are easy to get subtly wrong and impossible to
spot in a finished chart: a window that does not wrap makes January and
December quietly half-sampled, and a leap-day policy that drops Feb 29 loses
real weather while shifting every autumn date by one slot in leap years.
"""

import datetime as dt

import pytest

from scripts.common import (
    DEFAULT_WINDOW_DAYS,
    date_label,
    day_index,
    day_index_of,
    window_indices,
)
from scripts.fetch_history import year_bounds


class TestDayIndex:
    def test_spec_example_sep_20_is_263(self):
        # The spec's climatology JSON keys Sep 20 as "263"; the whole schema
        # depends on this holding in every year.
        assert day_index(9, 20) == 263

    def test_index_is_stable_across_leap_years(self):
        assert day_index_of(dt.date(2023, 9, 20)) == day_index_of(dt.date(2024, 9, 20)) == 263

    def test_year_spans_exactly_365_slots(self):
        assert day_index(1, 1) == 1
        assert day_index(12, 31) == 365

    def test_leap_day_folds_into_feb_28(self):
        assert day_index(2, 29) == day_index(2, 28) == 59

    def test_labels_round_trip(self):
        assert date_label(263) == "Sep 20"
        assert date_label(1) == "Jan 1"
        assert date_label(365) == "Dec 31"


class TestWindow:
    def test_window_is_fifteen_days_wide(self):
        assert len(window_indices(263)) == 2 * DEFAULT_WINDOW_DAYS + 1

    def test_window_centres_on_the_requested_day(self):
        assert window_indices(263) == list(range(256, 271))

    def test_window_wraps_at_the_start_of_the_year(self):
        # Jan 3 must pull in the last week of December, or the first week of
        # the year is built from half the samples of every other date.
        assert window_indices(3) == [361, 362, 363, 364, 365, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

    def test_window_wraps_at_the_end_of_the_year(self):
        assert window_indices(365)[-1] == 7
        assert window_indices(365)[0] == 358

    @pytest.mark.parametrize("index", range(1, 366))
    def test_every_slot_yields_valid_in_range_indices(self, index):
        w = window_indices(index)
        assert len(w) == len(set(w)) == 15
        assert all(1 <= i <= 365 for i in w)


class TestArchiveAvailability:
    today = dt.date(2026, 3, 10)

    def test_past_year_requests_the_full_year(self):
        assert year_bounds(2024, self.today) == (dt.date(2024, 1, 1), dt.date(2024, 12, 31))

    def test_current_year_is_clipped_to_the_archive_lag(self):
        # ERA5 runs ~5 days behind, so a March rebuild must not ask for December.
        start, end = year_bounds(2026, self.today)
        assert start == dt.date(2026, 1, 1)
        assert end == dt.date(2026, 3, 5)

    def test_future_year_is_skipped(self):
        assert year_bounds(2027, self.today) is None
