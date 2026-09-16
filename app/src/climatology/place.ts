import type { LocationSummary } from './types'

/**
 * Somewhere the app can talk about.
 *
 * Two kinds, and the difference is only whether historical climatology exists:
 * astronomy is pure computation and works anywhere, and the forecast API covers
 * the whole globe, so a custom place is fully functional for tonight. Only the
 * thirty-year history needs preprocessing.
 */
export interface Place {
  id: string
  name: string
  /** Region/country, for disambiguating search hits. */
  detail?: string
  latitude: number
  longitude: number
  elevation_m: number
  timezone: string
  /** Set when a built climatology file exists for this place. */
  file?: string
}

export const isPrecomputed = (place: Place): boolean => place.file !== undefined

export function placeFromLocation(summary: LocationSummary): Place {
  return {
    id: summary.id,
    name: summary.name,
    latitude: summary.latitude,
    longitude: summary.longitude,
    elevation_m: summary.elevation_m,
    timezone: summary.timezone,
    file: summary.file,
  }
}

/**
 * ERA5's cloud grid is 0.25 degrees, so any two points inside one cell return
 * byte-identical cloud climatology - Schererville and Highland, 9 km apart, do.
 * Keying future on-demand climatology by cell rather than by place means every
 * town within ~14 km shares one cached result and one slice of the API budget.
 */
export function era5Cell(latitude: number, longitude: number): string {
  const snap = (v: number) => (Math.round(v * 4) / 4).toFixed(2)
  return `${snap(latitude)},${snap(longitude)}`
}
