import { describe, expect, it } from 'vitest'
import { bestPortion } from './hours'
import type { HourBlock } from './types'

const block = (bins: number[], p: number[]): HourBlock => ({
  bins,
  p_clear_25: p,
  n: bins.map(() => 450),
})

describe('bestPortion', () => {
  it('finds a genuine late-night peak', () => {
    const result = bestPortion(
      block([-4, -3, -2, -1, 0, 1, 2, 3], [0.2, 0.25, 0.3, 0.4, 0.55, 0.6, 0.62, 0.6]),
    )
    expect(result).not.toBeNull()
    expect(result!.startBin).toBe(1)
    expect(result!.endBin).toBe(3)
  })

  it('refuses to name a portion when the night is flat', () => {
    // Northwest Indiana's real shape: 46% at best, 40% at worst. Naming a
    // "best portion" here would report sampling noise as a pattern.
    const flat = block(
      [-4, -3, -2, -1, 0, 1, 2, 3, 4],
      [0.4467, 0.4533, 0.46, 0.4511, 0.4467, 0.4422, 0.4467, 0.4289, 0.4007],
    )
    expect(bestPortion(flat)).toBeNull()
  })

  it('reports the spread it measured', () => {
    const result = bestPortion(block([-2, -1, 0, 1, 2], [0.1, 0.2, 0.5, 0.6, 0.7]))
    expect(result!.spread).toBeCloseTo(0.6, 6)
    expect(result!.spread).toBeGreaterThan(3 * result!.standardError)
  })

  it('extends a broad peak rather than reporting a three-hour sliver', () => {
    const result = bestPortion(
      block([-3, -2, -1, 0, 1, 2, 3], [0.1, 0.62, 0.63, 0.64, 0.63, 0.62, 0.1]),
    )
    expect(result!.startBin).toBe(-2)
    expect(result!.endBin).toBe(2)
  })

  it('returns null when too few bins survived the sample floor', () => {
    expect(bestPortion(block([0, 1], [0.1, 0.9]))).toBeNull()
  })
})
