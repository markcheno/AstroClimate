import type { Place } from './place'

const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'

interface GeocodeHit {
  id: number
  name: string
  latitude: number
  longitude: number
  elevation?: number
  timezone: string
  country?: string
  country_code?: string
  admin1?: string
  population?: number
}

/**
 * Search for a place by name or postal code.
 *
 * The response carries latitude, longitude, elevation and an IANA timezone -
 * exactly the fields a location needs, so a search hit can be used directly
 * without a second lookup.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const url = `${ENDPOINT}?name=${encodeURIComponent(trimmed)}&count=8&language=en&format=json`
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Location search failed (${response.status})`)

  const payload = (await response.json()) as { results?: GeocodeHit[] }
  return (payload.results ?? []).map(toPlace)
}

function toPlace(hit: GeocodeHit): Place {
  // Country code rather than full name: "Vermont, US" fits on one line in the
  // results list where "Vermont, United States" wraps to three.
  const detail = [hit.admin1, hit.country_code].filter(Boolean).join(', ')
  return {
    id: `geo:${hit.latitude.toFixed(4)},${hit.longitude.toFixed(4)}`,
    name: hit.name,
    detail: detail || undefined,
    latitude: hit.latitude,
    longitude: hit.longitude,
    elevation_m: hit.elevation ?? 0,
    timezone: hit.timezone,
  }
}
