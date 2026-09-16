/**
 * TypeScript mirror of the climatology JSON that scripts/build_climatology.py
 * emits. The two must move together; `SCHEMA_VERSION` is the tripwire.
 */

export const SCHEMA_VERSION = 1

/** Cloud-cover percentages defining "clear", as published by the pipeline. */
export const CLOUD_THRESHOLDS = [10, 25, 50] as const
export type CloudThreshold = (typeof CLOUD_THRESHOLDS)[number]

/** Consecutive-clear-hour run lengths whose probabilities are published. */
export const RUN_LENGTHS = [1, 2, 3, 4, 6] as const
export type RunLength = (typeof RUN_LENGTHS)[number]

export type RunKey = `${RunLength}h`

/** Clear probability per hour bin, measured in hours from solar midnight. */
export interface HourBlock {
  bins: number[]
  p_clear_25: number[]
  /** Samples behind each bin. Thin bins are withheld by the pipeline. */
  n: number[]
}

export interface DayRecord {
  date_label: string
  sample_count: number
  mean_dark_hours: number

  mean_cloud: number
  median_cloud: number
  median_high_cloud: number

  p_cloud_under_10: number
  p_cloud_under_25: number
  p_cloud_under_50: number

  /** Keyed by cloud threshold, then run length: a bare `p_clear_3h` would not
   * say what "clear" meant. */
  p_clear_runs: Record<string, Partial<Record<RunKey, number>>>

  /** P(>=2 consecutive clear hours at <=50% cloud). */
  p_usable_night: number

  median_humidity: number
  median_dew_spread: number
  median_wind: number
  p_precip: number

  hours: HourBlock
}

export interface Baseline {
  start_year: number
  end_year: number
}

export interface LocationMetadata {
  id: string
  name: string
  latitude: number
  longitude: number
  elevation_m: number
  timezone: string
  baseline: Baseline
  window_days: number
  dark_threshold_deg: number
  run_convention: string
  usable_night: { cloud_threshold: number; run_hours: number }
  model: string
  /** Per variable, because cloud and temperature come from different grids. */
  sources: Record<string, string>
  units: Record<string, string>
  generated_at: string
}

export interface ClimatologyFile {
  schema_version: number
  metadata: LocationMetadata
  /** Keyed by day index 1..365 as a string. */
  days: Record<string, DayRecord>
}

export interface LocationSummary {
  id: string
  name: string
  label_short: string
  latitude: number
  longitude: number
  elevation_m: number
  timezone: string
  file: string
  bytes: number
}

export interface LocationIndex {
  schema_version: number
  generated_at: string
  locations: LocationSummary[]
}

/** Day index 1..365 for a (month, day), against a non-leap reference year.
 *
 * Mirrors `day_index` in scripts/common.py: Sep 20 is 263 in every year, and
 * Feb 29 folds into Feb 28. */
export function dayIndex(month: number, day: number): number {
  const d = month === 2 && day === 29 ? 28 : day
  const start = Date.UTC(2001, 0, 1)
  const target = Date.UTC(2001, month - 1, d)
  return Math.round((target - start) / 86_400_000) + 1
}

export function dayIndexOf(date: Date): number {
  return dayIndex(date.getMonth() + 1, date.getDate())
}

/** Calendar (month, day) for a day index, in the non-leap reference year. */
export function monthDayOf(index: number): { month: number; day: number } {
  const d = new Date(Date.UTC(2001, 0, 1) + (index - 1) * 86_400_000)
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}
