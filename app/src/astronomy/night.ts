/**
 * Current-year astronomy for a location and date: twilight, Moon, and the
 * darkness that is actually usable.
 *
 * This is the half of the application that depends on the year (spec section
 * 14). Weather climatology repeats every calendar year; the lunar cycle does
 * not, so the Moon is never in the climatology and always computed here.
 *
 * Uses the same Astronomy Engine implementation as scripts/astro.py, so a
 * dark-hours figure here matches the one the pipeline stored.
 */

import * as Astronomy from 'astronomy-engine'

/** Sun altitudes bounding each twilight phase. */
export const TWILIGHT_ALTITUDES = {
  civil: -6,
  nautical: -12,
  astronomical: -18,
} as const

export type TwilightPhase = keyof typeof TWILIGHT_ALTITUDES

const SEARCH_LIMIT_DAYS = 1
const MS_PER_HOUR = 3_600_000

export interface Interval {
  start: Date
  end: Date
}

export interface MoonInfo {
  /** Illuminated fraction at solar midnight, 0..1. */
  illumination: number
  /** 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
  phase: number
  phaseName: string
  rise: Date | null
  set: Date | null
}

export interface NightInfo {
  eveningDate: Date
  solarMidnight: Date
  sunset: Date | null
  sunrise: Date | null
  twilight: Record<TwilightPhase, Interval | null>
  /** Astronomical darkness. Null above roughly 48 degrees in midsummer. */
  dark: Interval | null
  darkHours: number
  /** Darkness with the Moon below the horizon. */
  moonFreeHours: number
  moonFreeIntervals: Interval[]
  moon: MoonInfo
}

function toDate(time: Astronomy.AstroTime | null): Date | null {
  return time ? time.date : null
}

function hours(interval: Interval | null): number {
  if (!interval) return 0
  return (interval.end.getTime() - interval.start.getTime()) / MS_PER_HOUR
}

/** Local noon on `eveningDate`, which always precedes that evening's sunset. */
function searchStart(eveningDate: Date): Astronomy.AstroTime {
  const noon = new Date(eveningDate)
  noon.setHours(12, 0, 0, 0)
  return Astronomy.MakeTime(noon)
}

function phaseName(phase: number): string {
  if (phase < 0.02 || phase > 0.98) return 'New Moon'
  if (phase < 0.23) return 'Waxing Crescent'
  if (phase < 0.27) return 'First Quarter'
  if (phase < 0.48) return 'Waxing Gibbous'
  if (phase < 0.52) return 'Full Moon'
  if (phase < 0.73) return 'Waning Gibbous'
  if (phase < 0.77) return 'Last Quarter'
  return 'Waning Crescent'
}

/**
 * Subtract the intervals in `holes` from `span`.
 *
 * Moon-free darkness is an intersection of two interval sets, not a
 * subtraction of two scalars: the Moon can rise or set partway through the
 * night, so "dark hours minus moon-up hours" is wrong whenever the two only
 * partly overlap.
 */
export function subtractIntervals(span: Interval, holes: Interval[]): Interval[] {
  let remaining: Interval[] = [span]

  for (const hole of holes) {
    const next: Interval[] = []
    for (const piece of remaining) {
      const overlapStart = Math.max(piece.start.getTime(), hole.start.getTime())
      const overlapEnd = Math.min(piece.end.getTime(), hole.end.getTime())
      if (overlapStart >= overlapEnd) {
        next.push(piece)
        continue
      }
      if (piece.start.getTime() < overlapStart) {
        next.push({ start: piece.start, end: new Date(overlapStart) })
      }
      if (overlapEnd < piece.end.getTime()) {
        next.push({ start: new Date(overlapEnd), end: piece.end })
      }
    }
    remaining = next
  }

  return remaining.filter((i) => i.end.getTime() > i.start.getTime())
}

/** Intervals within `span` during which the Moon is above the horizon. */
export function moonUpIntervals(
  observer: Astronomy.Observer,
  span: Interval,
): Interval[] {
  const spanDays = (span.end.getTime() - span.start.getTime()) / 86_400_000
  // Start the search a day early so a Moon that rose before dusk and is still
  // up at nightfall is not missed.
  const searchFrom = Astronomy.MakeTime(new Date(span.start.getTime() - 86_400_000))

  const events: { time: Date; rising: boolean }[] = []
  for (const direction of [1, -1] as const) {
    let cursor: Astronomy.AstroTime | null = searchFrom
    for (let i = 0; i < 4 && cursor; i += 1) {
      const found: Astronomy.AstroTime | null = Astronomy.SearchRiseSet(
        Astronomy.Body.Moon,
        observer,
        direction,
        cursor,
        spanDays + 2,
      )
      if (!found) break
      events.push({ time: found.date, rising: direction === 1 })
      cursor = Astronomy.MakeTime(new Date(found.date.getTime() + 60_000))
      if (found.date.getTime() > span.end.getTime()) break
    }
  }
  events.sort((a, b) => a.time.getTime() - b.time.getTime())

  // Whether the Moon is already up when the span opens decides how the event
  // list pairs into intervals.
  const startAltitude = Astronomy.Equator(
    Astronomy.Body.Moon,
    Astronomy.MakeTime(span.start),
    observer,
    true,
    true,
  )
  const horizon = Astronomy.Horizon(
    Astronomy.MakeTime(span.start),
    observer,
    startAltitude.ra,
    startAltitude.dec,
    'normal',
  )

  const intervals: Interval[] = []
  let openedAt: Date | null = horizon.altitude > 0 ? span.start : null

  for (const event of events) {
    if (event.time <= span.start || event.time >= span.end) continue
    if (event.rising) {
      if (openedAt === null) openedAt = event.time
    } else if (openedAt !== null) {
      intervals.push({ start: openedAt, end: event.time })
      openedAt = null
    }
  }
  if (openedAt !== null) intervals.push({ start: openedAt, end: span.end })

  return intervals
}

/** Everything the app needs about one observing night. */
export function computeNight(
  latitude: number,
  longitude: number,
  elevationM: number,
  eveningDate: Date,
): NightInfo {
  const observer = new Astronomy.Observer(latitude, longitude, elevationM)
  const start = searchStart(eveningDate)

  const solarMidnight = Astronomy.SearchHourAngle(
    Astronomy.Body.Sun,
    observer,
    12,
    start,
  ).time.date

  const twilight = {} as Record<TwilightPhase, Interval | null>
  for (const phase of Object.keys(TWILIGHT_ALTITUDES) as TwilightPhase[]) {
    const altitude = TWILIGHT_ALTITUDES[phase]
    const evening = Astronomy.SearchAltitude(
      Astronomy.Body.Sun,
      observer,
      -1,
      start,
      SEARCH_LIMIT_DAYS,
      altitude,
    )
    const morning = evening
      ? Astronomy.SearchAltitude(
          Astronomy.Body.Sun,
          observer,
          1,
          evening,
          SEARCH_LIMIT_DAYS,
          altitude,
        )
      : null
    twilight[phase] =
      evening && morning ? { start: evening.date, end: morning.date } : null
  }

  const dark = twilight.astronomical
  const moonFreeIntervals = dark ? subtractIntervals(dark, moonUpIntervals(observer, dark)) : []

  const midnightTime = Astronomy.MakeTime(solarMidnight)
  const illumination = Astronomy.Illumination(Astronomy.Body.Moon, midnightTime)
  const phase = Astronomy.MoonPhase(midnightTime) / 360

  return {
    eveningDate,
    solarMidnight,
    sunset: toDate(
      Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, -1, start, SEARCH_LIMIT_DAYS),
    ),
    sunrise: toDate(
      Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, 1, start, SEARCH_LIMIT_DAYS + 1),
    ),
    twilight,
    dark,
    darkHours: hours(dark),
    moonFreeHours: moonFreeIntervals.reduce((sum, i) => sum + hours(i), 0),
    moonFreeIntervals,
    moon: {
      illumination: illumination.phase_fraction,
      phase,
      phaseName: phaseName(phase),
      rise: toDate(
        Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, 1, start, SEARCH_LIMIT_DAYS + 1),
      ),
      set: toDate(
        Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, -1, start, SEARCH_LIMIT_DAYS + 1),
      ),
    },
  }
}

const cache = new Map<string, NightInfo>()

/**
 * Memoized `computeNight`. The annual chart needs 365 evaluations and will
 * feel sluggish without this.
 */
export function night(
  latitude: number,
  longitude: number,
  elevationM: number,
  eveningDate: Date,
): NightInfo {
  const key = `${latitude},${longitude},${elevationM},${eveningDate.toDateString()}`
  const hit = cache.get(key)
  if (hit) return hit
  const computed = computeNight(latitude, longitude, elevationM, eveningDate)
  cache.set(key, computed)
  return computed
}

/** Format a duration in hours as "8h 14m". */
export function formatHours(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0h 00m'
  const total = Math.round(value * 60)
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`
}
