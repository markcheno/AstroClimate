import type { HourBlock } from './types'

export interface BestPortion {
  /** Inclusive bin offsets from solar midnight. */
  startBin: number
  endBin: number
  meanClear: number
  /** Spread between the best and worst hour bin, in probability points. */
  spread: number
  /** Standard error on a single bin's proportion, used to judge that spread. */
  standardError: number
}

/**
 * Standard error on one hour bin's clear-sky proportion.
 *
 * The bins are proportions over a few hundred nights, so how much spread counts
 * as a real pattern depends on how many nights are behind them. Hardcoding a
 * threshold would be arbitrary and would not adapt to a location with thinner
 * data.
 */
function binStandardError(p: number[], n: number[]): number {
  const mean = p.reduce((a, b) => a + b, 0) / p.length
  const smallest = Math.min(...n)
  if (smallest <= 0) return Infinity
  return Math.sqrt((mean * (1 - mean)) / smallest)
}

/**
 * The clearest contiguous stretch of the night, or null when the night has no
 * real shape.
 *
 * Deliberately a run of bins rather than the single best bin: spec section 1
 * promises "best historical portion of night: 1-4 AM", a range, and a single
 * argmax would report a one-hour sliver no more informative than noise.
 *
 * Returns null unless the best and worst bins differ by more than three
 * standard errors. Northwest Indiana is the motivating case: about 46% clear at
 * its best hour against 40% at its worst, a six-point range over ~450 nights
 * where three standard errors is roughly eight points. Naming a "best portion"
 * there would dress up sampling noise as advice.
 */
export function bestPortion(hours: HourBlock, minBins = 3): BestPortion | null {
  const { bins, p_clear_25: p, n } = hours
  if (bins.length < minBins) return null

  const standardError = binStandardError(p, n)
  const spread = Math.max(...p) - Math.min(...p)
  if (spread < 3 * standardError) return null

  let bestStart = 0
  let bestMean = -Infinity
  for (let start = 0; start + minBins <= bins.length; start += 1) {
    const mean = p.slice(start, start + minBins).reduce((a, b) => a + b, 0) / minBins
    if (mean > bestMean) {
      bestMean = mean
      bestStart = start
    }
  }

  // Widen while neighbours are within one standard error of the peak window,
  // so a genuinely broad clear spell is not clipped to exactly three hours.
  let lo = bestStart
  let hi = bestStart + minBins - 1
  while (lo > 0 && p[lo - 1]! >= bestMean - standardError) lo -= 1
  while (hi < bins.length - 1 && p[hi + 1]! >= bestMean - standardError) hi += 1

  const span = p.slice(lo, hi + 1)
  return {
    startBin: bins[lo]!,
    endBin: bins[hi]!,
    meanClear: span.reduce((a, b) => a + b, 0) / span.length,
    spread,
    standardError,
  }
}

/** Clock time for an offset in hours from solar midnight. */
export function binToClock(solarMidnight: Date, offset: number, timeZone: string): string {
  const t = new Date(solarMidnight.getTime() + offset * 3_600_000)
  return t.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  })
}

/** "1 AM – 4 AM" for a best-portion range. */
export function formatPortion(
  portion: BestPortion,
  solarMidnight: Date,
  timeZone: string,
): string {
  const start = binToClock(solarMidnight, portion.startBin, timeZone)
  const end = binToClock(solarMidnight, portion.endBin + 1, timeZone)
  return `${start} – ${end}`
}
