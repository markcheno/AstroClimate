import { describe, expect, it } from 'vitest'
import {
  computeNight,
  formatHours,
  subtractIntervals,
  type Interval,
} from './night'

const SCHERERVILLE = { lat: 41.4789, lon: -87.4548, elev: 200 }

const iv = (startHour: number, endHour: number): Interval => ({
  start: new Date(Date.UTC(2024, 8, 21, startHour)),
  end: new Date(Date.UTC(2024, 8, 21, endHour)),
})

const spanHours = (intervals: Interval[]) =>
  intervals.reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()) / 3_600_000, 0)

describe('subtractIntervals', () => {
  it('returns the whole span when nothing overlaps', () => {
    expect(subtractIntervals(iv(0, 8), [iv(10, 12)])).toEqual([iv(0, 8)])
  })

  it('returns nothing when the hole covers the span', () => {
    expect(subtractIntervals(iv(2, 6), [iv(0, 8)])).toEqual([])
  })

  it('trims a hole overlapping the start', () => {
    expect(subtractIntervals(iv(2, 8), [iv(0, 4)])).toEqual([iv(4, 8)])
  })

  it('trims a hole overlapping the end', () => {
    expect(subtractIntervals(iv(2, 8), [iv(6, 10)])).toEqual([iv(2, 6)])
  })

  it('splits the span when the hole sits inside it', () => {
    // A Moon that rises and sets mid-night leaves two dark windows, which is
    // the case a scalar subtraction gets wrong.
    expect(subtractIntervals(iv(0, 9), [iv(3, 5)])).toEqual([iv(0, 3), iv(5, 9)])
  })

  it('handles several holes at once', () => {
    const result = subtractIntervals(iv(0, 12), [iv(2, 3), iv(6, 8)])
    expect(result).toEqual([iv(0, 2), iv(3, 6), iv(8, 12)])
    expect(spanHours(result)).toBe(9)
  })
})

describe('computeNight', () => {
  it('matches the pipeline for a reference night', () => {
    // scripts/astro.py gives 8.685032 h for this night; the Python and JS
    // builds of Astronomy Engine must not drift apart.
    const info = computeNight(
      SCHERERVILLE.lat,
      SCHERERVILLE.lon,
      SCHERERVILLE.elev,
      new Date(2024, 8, 20),
    )
    expect(info.darkHours).toBeCloseTo(8.685032, 4)
    expect(info.dark?.start.toISOString()).toBe('2024-09-21T01:22:30.904Z')
  })

  it('produces a short night in June and a long one in December', () => {
    const june = computeNight(SCHERERVILLE.lat, SCHERERVILLE.lon, SCHERERVILLE.elev, new Date(2024, 5, 21))
    const december = computeNight(SCHERERVILLE.lat, SCHERERVILLE.lon, SCHERERVILLE.elev, new Date(2024, 11, 21))
    expect(june.darkHours).toBeLessThan(5)
    expect(december.darkHours).toBeGreaterThan(11)
  })

  it('orders the twilight phases by duration', () => {
    const info = computeNight(SCHERERVILLE.lat, SCHERERVILLE.lon, SCHERERVILLE.elev, new Date(2024, 8, 20))
    const span = (i: Interval | null) => (i ? i.end.getTime() - i.start.getTime() : 0)
    expect(span(info.twilight.astronomical)).toBeLessThan(span(info.twilight.nautical))
    expect(span(info.twilight.nautical)).toBeLessThan(span(info.twilight.civil))
  })

  it('never reports more moon-free darkness than darkness', () => {
    for (let month = 0; month < 12; month += 1) {
      const info = computeNight(SCHERERVILLE.lat, SCHERERVILLE.lon, SCHERERVILLE.elev, new Date(2024, month, 15))
      expect(info.moonFreeHours).toBeLessThanOrEqual(info.darkHours + 1e-9)
      expect(info.moonFreeHours).toBeGreaterThanOrEqual(0)
    }
  })

  it('gives a full dark night when the Moon is new and almost none when full', () => {
    // New Moon 2024-09-02, Full Moon 2024-09-17.
    const newMoon = computeNight(SCHERERVILLE.lat, SCHERERVILLE.lon, SCHERERVILLE.elev, new Date(2024, 8, 2))
    const fullMoon = computeNight(SCHERERVILLE.lat, SCHERERVILLE.lon, SCHERERVILLE.elev, new Date(2024, 8, 17))

    expect(newMoon.moon.illumination).toBeLessThan(0.05)
    expect(fullMoon.moon.illumination).toBeGreaterThan(0.9)

    // The real payoff of the intersection: a full Moon is up essentially all
    // night, so moon-free darkness collapses even though darkness does not.
    expect(newMoon.moonFreeHours / newMoon.darkHours).toBeGreaterThan(0.85)
    expect(fullMoon.moonFreeHours / fullMoon.darkHours).toBeLessThan(0.2)
  })
})

describe('formatHours', () => {
  it('formats as hours and padded minutes', () => {
    expect(formatHours(8.2333)).toBe('8h 14m')
    expect(formatHours(5.7)).toBe('5h 42m')
  })

  it('floors at zero rather than producing negatives', () => {
    expect(formatHours(0)).toBe('0h 00m')
    expect(formatHours(-3)).toBe('0h 00m')
  })
})
