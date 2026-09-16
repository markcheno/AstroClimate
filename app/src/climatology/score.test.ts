import { describe, expect, it } from 'vitest'
import { COMPONENTS, MODES, MODES_BY_ID, normalize, scoreDay } from './score'
import { dayIndex, dayIndexOf, monthDayOf } from './types'
import type { DayRecord } from './types'

function day(overrides: Partial<DayRecord> = {}): DayRecord {
  return {
    date_label: 'Sep 20',
    sample_count: 450,
    mean_dark_hours: 8.66,
    mean_cloud: 45.9,
    median_cloud: 38,
    median_high_cloud: 30,
    p_cloud_under_10: 0.35,
    p_cloud_under_25: 0.43,
    p_cloud_under_50: 0.54,
    p_clear_runs: {
      '10': { '1h': 0.5, '2h': 0.45, '3h': 0.4, '4h': 0.35, '6h': 0.25 },
      '25': { '1h': 0.66, '2h': 0.58, '3h': 0.51, '4h': 0.46, '6h': 0.36 },
      '50': { '1h': 0.8, '2h': 0.72, '3h': 0.65, '4h': 0.6, '6h': 0.48 },
    },
    p_usable_night: 0.72,
    median_humidity: 76.6,
    median_dew_spread: 4.17,
    median_wind: 3.34,
    p_precip: 0.22,
    hours: { bins: [-1, 0, 1], p_clear_25: [0.45, 0.45, 0.44], n: [450, 450, 450] },
    ...overrides,
  }
}

describe('normalize', () => {
  it('maps the anchors to 0 and 100', () => {
    expect(normalize(COMPONENTS.cloud, 0)).toBe(0)
    expect(normalize(COMPONENTS.cloud, 0.7)).toBe(100)
  })

  it('clamps beyond both anchors', () => {
    expect(normalize(COMPONENTS.cloud, -1)).toBe(0)
    expect(normalize(COMPONENTS.cloud, 5)).toBe(100)
  })

  it('inverts where lower is better', () => {
    // Wind scores 100 at 2 m/s and 0 at 9 m/s.
    expect(normalize(COMPONENTS.wind, 2)).toBe(100)
    expect(normalize(COMPONENTS.wind, 9)).toBe(0)
    expect(normalize(COMPONENTS.wind, 20)).toBe(0)
  })

  it('is monotone between the anchors', () => {
    expect(normalize(COMPONENTS.run, 0.3)).toBeGreaterThan(normalize(COMPONENTS.run, 0.2))
    expect(normalize(COMPONENTS.precipitation, 0.1)).toBeGreaterThan(
      normalize(COMPONENTS.precipitation, 0.4),
    )
  })
})

describe('scoreDay', () => {
  it('stays on 0-100', () => {
    for (const mode of MODES) {
      const { score } = scoreDay(day(), mode)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })

  it('reaches the ends of the range for ideal and hopeless days', () => {
    const perfect = day({
      p_cloud_under_25: 1,
      p_clear_runs: { '10': { '3h': 1 }, '25': { '3h': 1 }, '50': { '3h': 1 } },
      median_dew_spread: 20,
      median_wind: 0,
      p_precip: 0,
    })
    const hopeless = day({
      p_cloud_under_25: 0,
      p_clear_runs: { '10': { '3h': 0 }, '25': { '3h': 0 }, '50': { '3h': 0 } },
      median_dew_spread: 0,
      median_wind: 30,
      p_precip: 1,
    })
    expect(scoreDay(perfect, MODES[0]!).score).toBe(100)
    expect(scoreDay(hopeless, MODES[0]!).score).toBe(0)
  })

  it('shows its work, and the parts sum to the whole', () => {
    const breakdown = scoreDay(day(), MODES_BY_ID.get('visual')!)
    expect(breakdown.components).toHaveLength(5)
    const total = breakdown.components.reduce((s, c) => s + c.contribution, 0)
    // Weights sum to 100 for the built-in modes, so contributions sum to score.
    expect(total).toBeCloseTo(breakdown.score, 6)
  })

  it('reads its clear-run probability from the mode threshold', () => {
    // Deep-sky uses the strict 10% definition, visual the 25% one, so on a day
    // where those differ the modes must not agree.
    const deepSky = scoreDay(day(), MODES_BY_ID.get('deep-sky')!)
    const visual = scoreDay(day(), MODES_BY_ID.get('visual')!)
    expect(deepSky.components.find((c) => c.key === 'run')!.raw).toBe(0.4)
    expect(visual.components.find((c) => c.key === 'run')!.raw).toBe(0.51)
  })

  it('weights wind highest under planetary and clear runs highest under deep-sky', () => {
    const planetary = MODES_BY_ID.get('planetary')!
    const deepSky = MODES_BY_ID.get('deep-sky')!
    expect(planetary.weights.wind).toBeGreaterThan(MODES_BY_ID.get('visual')!.weights.wind)
    expect(deepSky.weights.run).toBeGreaterThan(deepSky.weights.cloud)
  })

  it('stays on 0-100 when user weights do not sum to 100', () => {
    const { score } = scoreDay(day(), MODES[0]!, { cloud: 500, wind: 0 })
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('every mode declares a weight for every component', () => {
    for (const mode of MODES) {
      for (const key of Object.keys(COMPONENTS)) {
        expect(mode.weights[key as keyof typeof mode.weights]).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('day index, mirroring scripts/common.py', () => {
  it('puts Sep 20 at 263', () => {
    expect(dayIndex(9, 20)).toBe(263)
  })

  it('spans exactly 365 slots', () => {
    expect(dayIndex(1, 1)).toBe(1)
    expect(dayIndex(12, 31)).toBe(365)
  })

  it('folds Feb 29 into Feb 28', () => {
    expect(dayIndex(2, 29)).toBe(dayIndex(2, 28))
  })

  it('is stable across leap years', () => {
    expect(dayIndexOf(new Date(2023, 8, 20))).toBe(263)
    expect(dayIndexOf(new Date(2024, 8, 20))).toBe(263)
  })

  it('round-trips through monthDayOf', () => {
    for (const index of [1, 59, 100, 263, 365]) {
      const { month, day: d } = monthDayOf(index)
      expect(dayIndex(month, d)).toBe(index)
    }
  })
})
