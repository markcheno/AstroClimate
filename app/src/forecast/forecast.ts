/**
 * The current forecast, summarised over the hours that are actually dark.
 *
 * Kept rigorously separate from climatology (spec section 2). A forecast
 * describes one specific night; a climatology describes the distribution over
 * 450 of them. The two are never differenced, and the UI never puts them in one
 * row - see the note in section 16 of the spec.
 */

import type { Interval } from '../astronomy/night'

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

const FIELDS = [
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'relative_humidity_2m',
  'dew_point_2m',
  'temperature_2m',
  'precipitation_probability',
  'wind_speed_10m',
  'wind_gusts_10m',
  'visibility',
] as const

/** Open-Meteo publishes 16 days; beyond that there is nothing to show. */
export const FORECAST_HORIZON_DAYS = 16

export interface ForecastHours {
  time: Date[]
  cloud: (number | null)[]
  cloudLow: (number | null)[]
  cloudMid: (number | null)[]
  cloudHigh: (number | null)[]
  humidity: (number | null)[]
  dewPoint: (number | null)[]
  temperature: (number | null)[]
  precipProbability: (number | null)[]
  wind: (number | null)[]
  gusts: (number | null)[]
  visibility: (number | null)[]
}

export interface NightForecast {
  /** Hours of astronomical darkness the forecast actually covers. */
  hoursCovered: number
  meanCloud: number
  minCloud: number
  /** Fraction of dark hours at or below 25% cloud. */
  clearFraction: number
  /** Longest unbroken clear stretch, same sample-as-block convention. */
  longestClearRun: number
  meanHumidity: number
  meanDewSpread: number
  meanWind: number
  maxGust: number
  maxPrecipProbability: number
  /** Kilometres; low values mean haze or fog. */
  minVisibilityKm: number
}

export interface ForecastResult {
  /** When the model run this came from was issued. */
  retrievedAt: Date
  night: NightForecast | null
  /** Why there is no night summary, when there isn't one. */
  reason?: string
}

function toNumbers(values: unknown): (number | null)[] {
  return Array.isArray(values) ? (values as (number | null)[]) : []
}

export async function fetchForecastHours(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<ForecastHours> {
  const url =
    `${ENDPOINT}?latitude=${latitude}&longitude=${longitude}` +
    `&hourly=${FIELDS.join(',')}&timezone=UTC&wind_speed_unit=ms` +
    `&forecast_days=${FORECAST_HORIZON_DAYS}`

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Forecast failed (${response.status})`)
  const payload = (await response.json()) as { hourly?: Record<string, unknown> }
  const h = payload.hourly ?? {}

  return {
    // The API returns naive UTC stamps; mark them so Date parses them as UTC.
    time: (h.time as string[] | undefined)?.map((t) => new Date(`${t}Z`)) ?? [],
    cloud: toNumbers(h.cloud_cover),
    cloudLow: toNumbers(h.cloud_cover_low),
    cloudMid: toNumbers(h.cloud_cover_mid),
    cloudHigh: toNumbers(h.cloud_cover_high),
    humidity: toNumbers(h.relative_humidity_2m),
    dewPoint: toNumbers(h.dew_point_2m),
    temperature: toNumbers(h.temperature_2m),
    precipProbability: toNumbers(h.precipitation_probability),
    wind: toNumbers(h.wind_speed_10m),
    gusts: toNumbers(h.wind_gusts_10m),
    visibility: toNumbers(h.visibility),
  }
}

function longestRun(flags: boolean[]): number {
  let best = 0
  let current = 0
  for (const flag of flags) {
    current = flag ? current + 1 : 0
    if (current > best) best = current
  }
  return best
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN

/**
 * Reduce the forecast to the dark window of one night.
 *
 * Summarising a calendar day would mix in daylight hours nobody observes
 * through, which is the same mistake the historical pipeline avoids.
 */
export function summariseNight(hours: ForecastHours, dark: Interval | null): ForecastResult {
  const retrievedAt = new Date()
  if (!dark) {
    return { retrievedAt, night: null, reason: 'No astronomical darkness on this night' }
  }

  const indices: number[] = []
  for (let i = 0; i < hours.time.length; i += 1) {
    const t = hours.time[i]!
    if (t >= dark.start && t < dark.end && hours.cloud[i] != null) indices.push(i)
  }

  if (indices.length === 0) {
    return { retrievedAt, night: null, reason: 'Outside the 16-day forecast horizon' }
  }

  const pick = (series: (number | null)[]) =>
    indices.map((i) => series[i]).filter((v): v is number => v != null)

  const cloud = pick(hours.cloud)
  const dewSpread = indices
    .map((i) => {
      const t = hours.temperature[i]
      const d = hours.dewPoint[i]
      return t != null && d != null ? t - d : null
    })
    .filter((v): v is number => v != null)

  const visibility = pick(hours.visibility)
  const precip = pick(hours.precipProbability)
  const gusts = pick(hours.gusts)

  return {
    retrievedAt,
    night: {
      hoursCovered: indices.length,
      meanCloud: mean(cloud),
      minCloud: Math.min(...cloud),
      clearFraction: cloud.filter((c) => c <= 25).length / cloud.length,
      longestClearRun: longestRun(cloud.map((c) => c <= 25)),
      meanHumidity: mean(pick(hours.humidity)),
      meanDewSpread: mean(dewSpread),
      meanWind: mean(pick(hours.wind)),
      maxGust: gusts.length ? Math.max(...gusts) : Number.NaN,
      maxPrecipProbability: precip.length ? Math.max(...precip) : Number.NaN,
      minVisibilityKm: visibility.length ? Math.min(...visibility) / 1000 : Number.NaN,
    },
  }
}
