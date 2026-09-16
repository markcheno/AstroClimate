"""Tests for the night and day-of-year aggregation stages.

The run-counting tests encode the sample-as-block convention. It is the
app's signature number, and the alternative reading ("N samples span N-1
hours") is just as defensible in the abstract, so the choice is pinned here
rather than left to whichever loop happens to be written.
"""

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from scripts.astro import NightWindow
from scripts.build_climatology import (
    _substantive,
    day_record,
    hour_of_night_block,
    hourly_long_frame,
    longest_run,
    night_record,
)
from scripts.common import CLOUD_THRESHOLDS, MIN_HOUR_BIN_SAMPLES, RUN_LENGTHS

UTC = dt.UTC


def make_window(dark_hours: float = 9.0) -> NightWindow:
    midnight = dt.datetime(2024, 9, 21, 5, 0, tzinfo=UTC)
    half = dt.timedelta(hours=dark_hours / 2)
    return NightWindow(
        evening_date=dt.date(2024, 9, 20),
        solar_midnight=midnight,
        dark_start=midnight - half,
        dark_end=midnight + half,
        nautical_start=midnight - half - dt.timedelta(hours=1),
        nautical_end=midnight + half + dt.timedelta(hours=1),
        civil_start=midnight - half - dt.timedelta(hours=2),
        civil_end=midnight + half + dt.timedelta(hours=2),
    )


def make_samples(cloud: list[float], start_hour: int = 1) -> pd.DataFrame:
    n = len(cloud)
    times = [dt.datetime(2024, 9, 21, start_hour, 0) + dt.timedelta(hours=i) for i in range(n)]
    return pd.DataFrame(
        {
            "time": pd.to_datetime(times),
            "cloud_cover": np.array(cloud, dtype=float),
            "cloud_cover_low": np.zeros(n),
            "cloud_cover_mid": np.zeros(n),
            "cloud_cover_high": np.zeros(n),
            "precipitation": np.zeros(n),
            "relative_humidity_2m": np.full(n, 70.0),
            "dew_spread": np.full(n, 5.0),
            "wind_speed_10m": np.full(n, 3.0),
        }
    )


class TestLongestRun:
    def test_empty(self):
        assert longest_run(np.array([], dtype=bool)) == 0

    def test_all_false(self):
        assert longest_run(np.array([False] * 5)) == 0

    def test_all_true(self):
        assert longest_run(np.array([True] * 5)) == 5

    def test_takes_the_longest_not_the_last(self):
        assert longest_run(np.array([True, True, True, False, True])) == 3

    def test_runs_are_not_summed_across_a_gap(self):
        # The whole point of the metric: four scattered clear hours are not
        # four consecutive clear hours.
        assert longest_run(np.array([True, False, True, False, True, False, True])) == 1


class TestRunConvention:
    def test_n_consecutive_samples_counts_as_n_hours(self):
        # Sample-as-block: three clear samples is three clear hours, not two.
        record = night_record(make_window(), make_samples([0, 0, 0, 100, 100, 100, 100]))
        assert record["longest_clear_run_10"] == 3

    def test_alternating_night_beats_nothing_but_loses_to_a_clear_block(self):
        alternating = night_record(make_window(), make_samples([0, 100, 0, 100, 0, 100, 0, 100]))
        blocked = night_record(make_window(), make_samples([0, 0, 0, 0, 100, 100, 100, 100]))
        # Identical mean cloud, very different usefulness - spec section 11.
        assert alternating["mean_cloud"] == blocked["mean_cloud"] == 50.0
        assert alternating["longest_clear_run_10"] == 1
        assert blocked["longest_clear_run_10"] == 4

    @pytest.mark.parametrize("threshold", CLOUD_THRESHOLDS)
    def test_thresholds_are_inclusive(self, threshold):
        record = night_record(make_window(), make_samples([threshold] * 4))
        assert record[f"longest_clear_run_{threshold}"] == 4


class TestNightRecord:
    def test_too_few_samples_is_dropped_not_averaged(self):
        # A two-sample night is a data gap; averaging it would understate cloud.
        assert night_record(make_window(), make_samples([0, 0])) is None

    def test_a_night_without_darkness_is_dropped(self):
        window = NightWindow(
            evening_date=dt.date(2024, 6, 21),
            solar_midnight=dt.datetime(2024, 6, 22, 5, 0, tzinfo=UTC),
            dark_start=None,
            dark_end=None,
            nautical_start=None,
            nautical_end=None,
            civil_start=None,
            civil_end=None,
        )
        assert night_record(window, make_samples([0] * 8)) is None

    def test_offsets_are_measured_from_solar_midnight(self):
        # Samples start at 01:00 UTC, solar midnight is 05:00 UTC.
        record = night_record(make_window(), make_samples([0] * 8, start_hour=1))
        assert record["hour_offsets"] == [-4, -3, -2, -1, 0, 1, 2, 3]

    def test_evening_date_keys_the_night(self):
        # Samples fall on Sep 21 UTC; the night is Sep 20's.
        record = night_record(make_window(), make_samples([0] * 8))
        assert record["date"] == "2024-09-20"
        assert record["day_index"] == 263


class TestHourBlock:
    def test_thin_bins_are_suppressed(self):
        pooled = pd.DataFrame({"offset": [0] * 5, "cloud": [0.0] * 5})
        assert hour_of_night_block(pooled) == {"bins": [], "p_clear_25": [], "n": []}

    def test_populated_bins_are_published_in_order(self):
        n = MIN_HOUR_BIN_SAMPLES
        pooled = pd.DataFrame(
            {
                "offset": [1] * n + [-1] * n,
                "cloud": [0.0] * n + [100.0] * n,
            }
        )
        block = hour_of_night_block(pooled)
        assert block["bins"] == [-1, 1]
        assert block["p_clear_25"] == [0.0, 1.0]
        assert block["n"] == [n, n]


class TestDayRecordMonotonicity:
    """The checks that catch aggregation bugs invisible on a finished chart."""

    @staticmethod
    def build(seed: int = 0):
        rng = np.random.default_rng(seed)
        records = []
        for day_index in range(1, 366):
            for _ in range(30):
                cloud = rng.integers(0, 101, size=9).astype(float)
                window = make_window()
                samples = make_samples(list(cloud))
                record = night_record(window, samples)
                record["day_index"] = day_index
                records.append(record)
        nights = pd.DataFrame(records)
        return nights, hourly_long_frame(nights)

    def test_probabilities_are_monotone_in_run_length_and_threshold(self):
        nights, long = self.build()
        for index in (1, 59, 263, 365):
            day = day_record(index, nights, long, window_days=7)

            for threshold in CLOUD_THRESHOLDS:
                series = day["p_clear_runs"][str(threshold)]
                values = [series[f"{length}h"] for length in RUN_LENGTHS]
                assert values == sorted(values, reverse=True), (
                    f"P(>=Nh) rose with N at threshold {threshold}: {values}"
                )

            for length in RUN_LENGTHS:
                across = [day["p_clear_runs"][str(t)][f"{length}h"] for t in CLOUD_THRESHOLDS]
                assert across == sorted(across), (
                    f"P(>={length}h) fell as the threshold relaxed: {across}"
                )

            cloud_ps = [day[f"p_cloud_under_{t}"] for t in CLOUD_THRESHOLDS]
            assert cloud_ps == sorted(cloud_ps)

    def test_usable_night_matches_its_published_definition(self):
        nights, long = self.build()
        day = day_record(263, nights, long, window_days=7)
        assert day["p_usable_night"] == day["p_clear_runs"]["50"]["2h"]

    def test_window_pulls_fifteen_days_of_nights(self):
        nights, long = self.build()
        day = day_record(263, nights, long, window_days=7)
        assert day["sample_count"] == 15 * 30

    def test_year_boundary_slots_are_not_half_sampled(self):
        # Without the wrapping window, Jan 1 would draw on 8 days, not 15.
        nights, long = self.build()
        assert day_record(1, nights, long, 7)["sample_count"] == 15 * 30
        assert day_record(365, nights, long, 7)["sample_count"] == 15 * 30


class TestIdempotentWrite:
    """A rebuild that finds no new data must leave the tree clean.

    `generated_at` changes on every run, so without this the monthly workflow
    would commit an empty change every month for the life of the project.
    """

    @staticmethod
    def payload(generated_at: str, mean_cloud: float = 34.2) -> dict:
        return {
            "schema_version": 1,
            "metadata": {
                "id": "somewhere",
                "baseline": {"start_year": 1996, "end_year": 2025},
                "generated_at": generated_at,
            },
            "days": {"263": {"mean_cloud": mean_cloud}},
        }

    def test_timestamp_alone_is_not_a_change(self):
        a = self.payload("2026-09-15T00:00:00Z")
        b = self.payload("2026-10-01T12:34:56Z")
        assert _substantive(a) == _substantive(b)

    def test_real_data_changes_are_still_detected(self):
        a = self.payload("2026-09-15T00:00:00Z", mean_cloud=34.2)
        b = self.payload("2026-09-15T00:00:00Z", mean_cloud=34.3)
        assert _substantive(a) != _substantive(b)

    def test_the_timestamp_survives_for_the_provenance_panel(self):
        # Stripping it for comparison must not strip it from what gets written.
        original = self.payload("2026-09-15T00:00:00Z")
        _substantive(original)
        assert original["metadata"]["generated_at"] == "2026-09-15T00:00:00Z"
