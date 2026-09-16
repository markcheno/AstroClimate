import type { ClimatologyFile, LocationIndex } from './types'
import { SCHEMA_VERSION } from './types'

/** Vite's base, so fetches work under the /AstroClimate/ project-page prefix. */
const base = import.meta.env.BASE_URL

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${base}${path}`)
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

function checkVersion(version: number, what: string): void {
  if (version !== SCHEMA_VERSION) {
    // A silent mismatch would render plausible nonsense from stale fields.
    throw new Error(`${what} is schema v${version}; this build expects v${SCHEMA_VERSION}`)
  }
}

export async function loadIndex(): Promise<LocationIndex> {
  const index = await getJson<LocationIndex>('data/locations.json')
  checkVersion(index.schema_version, 'locations.json')
  return index
}

export async function loadLocation(file: string): Promise<ClimatologyFile> {
  const data = await getJson<ClimatologyFile>(`data/${file}`)
  checkVersion(data.schema_version, file)
  return data
}
