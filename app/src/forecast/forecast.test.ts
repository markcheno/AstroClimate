import { describe, expect, it } from 'vitest'
import { summariseNight, type ForecastHours } from './forecast'
import { era5Cell } from '../climatology/place'

/** Hourly forecast starting at 00:00 UTC on 2026-09-16. */
function hours(cloud: (number | null)[]): ForecastHours {
  const n = cloud.length
  const at = (i: number) => new Date(Date.UTC(2026, 8, 16, i))
  const fill = (v: number) => Array.from({ length: n }, () => v)
  return {
    time: Array.from({ length: n }, (_, i) => at(i)),
    cloud,
    cloudLow: fill(0),
    cloudMid: fill(0),
    cloudHigh: fill(0),
    humidity: fill(70),
    dewPoint: fill(10),
    temperature: fill(15),
    precipProbability: fill(20),
    wind: fill(3),
    gusts: fill(7),
    visibility: fill(20000),
  }
}

const dark = {
  start: new Date(Date.UTC(2026, 8, 16, 2)),
  end: new Date(Date.UTC(2026, 8, 16, 10)),
}

describe('summariseNight', () => {
  it('summarises only the dark hours, not the whole day', () => {
    // Overcast by day, clear at night. A calendar-day mean would report 50%.
    const cloud = [...Array(2).fill(100), ...Array(8).fill(0), ...Array(14).fill(100)]
    const { night } = summariseNight(hours(cloud), dark)
    expect(night!.hoursCovered).toBe(8)
    expect(night!.meanCloud).toBe(0)
  })

  it('counts a clear run with the same convention as the history', () => {
    // Four clear samples inside the window means four clear hours.
    const cloud = Array(24).fill(100)
    for (let i = 2; i < 6; i += 1) cloud[i] = 0
    const { night } = summariseNight(hours(cloud), dark)
    expect(night!.longestClearRun).toBe(4)
  })

  it('does not sum clear hours across a cloudy gap', () => {
    const cloud = Array(24).fill(100)
    for (const i of [2, 3, 5, 6]) cloud[i] = 0
    const { night } = summariseNight(hours(cloud), dark)
    expect(night!.longestClearRun).toBe(2)
    expect(night!.clearFraction).toBe(0.5)
  })

  it('treats the threshold as inclusive, matching the history', () => {
    const { night } = summariseNight(hours(Array(24).fill(25)), dark)
    expect(night!.longestClearRun).toBe(8)
  })

  it('reports being past the forecast horizon rather than inventing a night', () => {
    const farFuture = {
      start: new Date(Date.UTC(2027, 0, 1, 2)),
      end: new Date(Date.UTC(2027, 0, 1, 10)),
    }
    const result = summariseNight(hours(Array(24).fill(0)), farFuture)
    expect(result.night).toBeNull()
    expect(result.reason).toMatch(/horizon/i)
  })

  it('reports when there is no darkness at all', () => {
    const result = summariseNight(hours(Array(24).fill(0)), null)
    expect(result.night).toBeNull()
    expect(result.reason).toMatch(/darkness/i)
  })

  it('skips null hours at the end of the forecast without skewing the mean', () => {
    const cloud: (number | null)[] = Array(24).fill(0)
    cloud[8] = null
    cloud[9] = null
    const { night } = summariseNight(hours(cloud), dark)
    expect(night!.hoursCovered).toBe(6)
    expect(night!.meanCloud).toBe(0)
  })
})

describe('era5Cell', () => {
  it('puts sites inside one cloud cell on the same key', () => {
    // Measured: these two return byte-identical ERA5 cloud series.
    expect(era5Cell(41.4789, -87.4548)).toBe(era5Cell(41.5534, -87.452))
  })

  it('separates sites in different cells', () => {
    // Gary, ~19 km away, resolves to a different cell and different data.
    expect(era5Cell(41.4789, -87.4548)).not.toBe(era5Cell(41.6, -87.34))
  })

  it('snaps to quarter degrees', () => {
    expect(era5Cell(41.4789, -87.4548)).toBe('41.50,-87.50')
  })
})
