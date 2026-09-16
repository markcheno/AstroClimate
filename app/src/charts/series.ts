/**
 * Overlay definitions for the annual chart.
 *
 * Every series here is on the same 0-100 scale, which is the constraint that
 * keeps the chart to one y-axis. Metrics that are genuinely on another scale -
 * wind in m/s, darkness in hours - are NOT overlaid here; they get their own
 * small multiples, because two y-scales on one plot is the single most
 * misleading thing a chart can do.
 *
 * Colors are the validated categorical slots in fixed order. Slots are never
 * cycled or reassigned by rank: a series keeps its hue whether or not its
 * neighbours are switched on.
 */

import type { DayRecord } from '../climatology/types'

export interface AnnualSeries {
  key: string
  label: string
  color: string
  /** Always 0-100. */
  value: (day: DayRecord) => number
  format: (value: number) => string
  /** The score line is the subject of the chart; overlays are comparisons. */
  hero?: boolean
}

const pct = (v: number) => `${Math.round(v)}%`

/** Categorical slots 1-5, dark mode, validated against the app surface. */
export const SERIES_COLORS = {
  score: '#3987e5',
  cloud: '#d95926',
  clear3: '#199e70',
  clear6: '#c98500',
  humidity: '#d55181',
} as const

export const OVERLAY_SERIES: AnnualSeries[] = [
  {
    key: 'cloud',
    label: 'Clear night (≤25% cloud)',
    color: SERIES_COLORS.cloud,
    value: (d) => d.p_cloud_under_25 * 100,
    format: pct,
  },
  {
    key: 'clear3',
    label: '3+ clear hours',
    color: SERIES_COLORS.clear3,
    value: (d) => (d.p_clear_runs['25']?.['3h'] ?? 0) * 100,
    format: pct,
  },
  {
    key: 'clear6',
    label: '6+ clear hours',
    color: SERIES_COLORS.clear6,
    value: (d) => (d.p_clear_runs['25']?.['6h'] ?? 0) * 100,
    format: pct,
  },
  {
    key: 'humidity',
    label: 'Median humidity',
    color: SERIES_COLORS.humidity,
    value: (d) => d.median_humidity,
    format: pct,
  },
]
