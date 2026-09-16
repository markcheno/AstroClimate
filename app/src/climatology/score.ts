/**
 * The historical score, computed in the browser from the published components.
 *
 * It is never baked into the JSON. That is what lets the activity selector
 * change the score instantly, and lets the user move the weights, without
 * regenerating any data.
 *
 * Weights alone are not a formula, so each component maps through a clamped
 * linear ramp between two anchors before being weighted.
 */

import type { CloudThreshold, DayRecord } from './types'

export type ComponentKey = 'cloud' | 'run' | 'humidity' | 'wind' | 'precipitation'

export interface ComponentSpec {
  key: ComponentKey
  label: string
  /** Value scoring 0. */
  zeroAt: number
  /** Value scoring 100. May be below `zeroAt` where lower is better. */
  hundredAt: number
  unit: string
  /** How to render the raw value in the breakdown. */
  format: (value: number) => string
}

const percent = (v: number) => `${Math.round(v * 100)}%`

export const COMPONENTS: Record<ComponentKey, ComponentSpec> = {
  cloud: {
    key: 'cloud',
    label: 'Cloud probability',
    zeroAt: 0.0,
    hundredAt: 0.7,
    unit: '',
    format: percent,
  },
  run: {
    key: 'run',
    label: 'Clear-run probability',
    zeroAt: 0.0,
    hundredAt: 0.6,
    unit: '',
    format: percent,
  },
  humidity: {
    key: 'humidity',
    label: 'Humidity / dew risk',
    zeroAt: 1,
    hundredAt: 8,
    unit: '°C spread',
    format: (v) => `${v.toFixed(1)} °C`,
  },
  wind: {
    key: 'wind',
    label: 'Wind',
    zeroAt: 9,
    hundredAt: 2,
    unit: 'm/s',
    format: (v) => `${v.toFixed(1)} m/s`,
  },
  precipitation: {
    key: 'precipitation',
    label: 'Precipitation',
    zeroAt: 0.5,
    hundredAt: 0.0,
    unit: '',
    format: percent,
  },
}

export type ActivityMode =
  | 'visual'
  | 'wide-field'
  | 'deep-sky'
  | 'planetary'
  | 'milky-way'

export interface ModeSpec {
  id: ActivityMode
  label: string
  /** Primary concern, per spec section 1. */
  concern: string
  weights: Record<ComponentKey, number>
  /** Which cloud threshold this mode's clear-run probability reads from. */
  runThreshold: CloudThreshold
}

export const MODES: ModeSpec[] = [
  {
    id: 'visual',
    label: 'Visual observing',
    concern: 'Clouds, transparency, Moon',
    weights: { cloud: 50, run: 25, humidity: 10, wind: 10, precipitation: 5 },
    runThreshold: 25,
  },
  {
    id: 'wide-field',
    label: 'Wide-field imaging',
    concern: 'Clouds, darkness, Moon, humidity',
    weights: { cloud: 40, run: 30, humidity: 15, wind: 10, precipitation: 5 },
    runThreshold: 25,
  },
  {
    id: 'deep-sky',
    label: 'Deep-sky imaging',
    concern: 'Clouds, long clear periods, darkness, Moon',
    weights: { cloud: 30, run: 45, humidity: 10, wind: 10, precipitation: 5 },
    runThreshold: 10,
  },
  {
    id: 'planetary',
    label: 'Planetary',
    concern: 'Clouds, wind, humidity; Moon mostly irrelevant',
    weights: { cloud: 45, run: 15, humidity: 15, wind: 20, precipitation: 5 },
    runThreshold: 25,
  },
  {
    id: 'milky-way',
    label: 'Milky Way',
    concern: 'Clouds, astronomical darkness, Moon',
    weights: { cloud: 45, run: 30, humidity: 10, wind: 10, precipitation: 5 },
    runThreshold: 10,
  },
]

export const MODES_BY_ID = new Map(MODES.map((m) => [m.id, m]))

/** Clamped linear ramp between the component's two anchors. */
export function normalize(spec: ComponentSpec, value: number): number {
  const span = spec.hundredAt - spec.zeroAt
  if (span === 0) return 0
  const t = (value - spec.zeroAt) / span
  return Math.max(0, Math.min(1, t)) * 100
}

export interface ComponentBreakdown {
  key: ComponentKey
  label: string
  raw: number
  rawLabel: string
  normalized: number
  weight: number
  contribution: number
}

export interface ScoreBreakdown {
  score: number
  mode: ModeSpec
  components: ComponentBreakdown[]
}

/** Raw component values for a day, under a given mode's run threshold. */
export function componentValues(
  day: DayRecord,
  runThreshold: CloudThreshold,
): Record<ComponentKey, number> {
  const runs = day.p_clear_runs[String(runThreshold)]
  return {
    cloud: day.p_cloud_under_25,
    run: runs?.['3h'] ?? 0,
    humidity: day.median_dew_spread,
    wind: day.median_wind,
    precipitation: day.p_precip,
  }
}

/**
 * Score a day for a mode, returning the full derivation rather than a bare
 * number. Spec section 15 asks to "show exactly how it was generated"; this is
 * also the only place a wrong number upstream becomes visible.
 */
export function scoreDay(
  day: DayRecord,
  mode: ModeSpec,
  weightOverrides?: Partial<Record<ComponentKey, number>>,
): ScoreBreakdown {
  const weights = { ...mode.weights, ...weightOverrides }
  const values = componentValues(day, mode.runThreshold)

  const components: ComponentBreakdown[] = (
    Object.keys(COMPONENTS) as ComponentKey[]
  ).map((key) => {
    const spec = COMPONENTS[key]
    const raw = values[key]
    const normalized = normalize(spec, raw)
    const weight = weights[key] ?? 0
    return {
      key,
      label: spec.label,
      raw,
      rawLabel: spec.format(raw),
      normalized,
      weight,
      contribution: (normalized * weight) / 100,
    }
  })

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0)
  const weighted = components.reduce((sum, c) => sum + c.normalized * c.weight, 0)
  // Renormalizing by total weight keeps the score on 0-100 even when a user
  // has moved the sliders so they no longer sum to 100.
  const score = totalWeight > 0 ? weighted / totalWeight : 0

  return { score, mode, components }
}
