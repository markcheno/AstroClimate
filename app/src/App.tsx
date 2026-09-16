import { useEffect, useMemo, useState } from 'react'
import { AnnualChart } from './charts/AnnualChart'
import { OVERLAY_SERIES } from './charts/series'
import { ForecastCard } from './components/ForecastCard'
import { LocationSearch } from './components/LocationSearch'
import { Provenance } from './components/Provenance'
import { ScoreBreakdown } from './components/ScoreBreakdown'
import { formatHours, night } from './astronomy/night'
import { bestPortion, formatPortion } from './climatology/hours'
import { loadIndex, loadLocation } from './climatology/load'
import { era5Cell, isPrecomputed, placeFromLocation, type Place } from './climatology/place'
import { MODES, MODES_BY_ID, scoreDay, type ActivityMode } from './climatology/score'
import { dayIndexOf, monthDayOf } from './climatology/types'
import type { ClimatologyFile } from './climatology/types'
import { fetchForecastHours, summariseNight, type ForecastResult } from './forecast/forecast'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function App() {
  const [saved, setSaved] = useState<Place[]>([])
  const [place, setPlace] = useState<Place | null>(null)
  const [data, setData] = useState<ClimatologyFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [dayIndex, setDayIndex] = useState(() => dayIndexOf(new Date()))
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [mode, setMode] = useState<ActivityMode>('visual')
  const [overlays, setOverlays] = useState<Set<string>>(new Set(['clear3']))

  const [forecast, setForecast] = useState<ForecastResult | null>(null)
  const [forecastLoading, setForecastLoading] = useState(false)

  useEffect(() => {
    loadIndex()
      .then((index) => {
        const places = index.locations.map(placeFromLocation)
        setSaved(places)
        setPlace((current) => current ?? places[0] ?? null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  // Climatology exists only for built locations; everything else in the app
  // works anywhere.
  useEffect(() => {
    if (!place || !isPrecomputed(place)) {
      setData(null)
      return
    }
    let cancelled = false
    setData(null)
    loadLocation(place.file!)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      cancelled = true
    }
  }, [place])

  const modeSpec = MODES_BY_ID.get(mode)!
  const { month, day: dayOfMonth } = monthDayOf(dayIndex)

  const sky = useMemo(() => {
    if (!place) return null
    return night(place.latitude, place.longitude, place.elevation_m,
      new Date(year, month - 1, dayOfMonth))
  }, [place, year, month, dayOfMonth])

  // Forecast follows the place and the selected night, and simply reports that
  // it has nothing when the date is past the 16-day horizon.
  useEffect(() => {
    if (!place || !sky) return
    const controller = new AbortController()
    setForecastLoading(true)
    fetchForecastHours(place.latitude, place.longitude, controller.signal)
      .then((hours) => setForecast(summariseNight(hours, sky.dark)))
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setForecast(null)
      })
      .finally(() => setForecastLoading(false))
    return () => controller.abort()
  }, [place, sky])

  const scores = useMemo(() => {
    if (!data) return []
    return Array.from({ length: 365 }, (_, i) => {
      const d = data.days[String(i + 1)]
      return d ? scoreDay(d, modeSpec).score : 0
    })
  }, [data, modeSpec])

  const day = data?.days[String(dayIndex)]
  const breakdown = day ? scoreDay(day, modeSpec) : null
  const portion = day ? bestPortion(day.hours) : null
  const dateLabel = `${MONTH_NAMES[month - 1]} ${dayOfMonth}`

  if (error) {
    return (
      <main className="shell">
        <h1>AstroClimate</h1>
        <p className="error">Could not load: {error}</p>
      </main>
    )
  }

  return (
    <main className="shell">
      <header>
        <h1>AstroClimate</h1>
        <p className="tagline">Historically, how good is this location on this date?</p>
      </header>

      <section className="controls" aria-label="Location, date and activity">
        <LocationSearch saved={saved} selected={place} onSelect={setPlace} />

        <label>
          <span>Activity</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as ActivityMode)}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Year <small>(for Moon and darkness)</small></span>
          <input
            type="number"
            value={year}
            min={1900}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>

        <label className="date-control">
          <span>Date <b>{MONTHS[month - 1]} {dayOfMonth}</b></span>
          <input
            type="range"
            min={1}
            max={365}
            value={dayIndex}
            onChange={(e) => setDayIndex(Number(e.target.value))}
          />
        </label>
      </section>

      {place && (
        <section className="summary">
          <h2>
            {dateLabel} — {place.name}
            {place.detail && <small> {place.detail}</small>}
          </h2>

          {breakdown ? (
            <div className="hero">
              <span className="hero-number">{Math.round(breakdown.score)}</span>
              <span className="hero-label">
                Historical observing quality
                <small>out of 100 · {modeSpec.label.toLowerCase()}</small>
              </span>
            </div>
          ) : (
            <p className="no-history">
              <b>No historical climatology for this location yet.</b> Darkness, Moon
              and tonight's forecast work anywhere — the thirty-year history needs
              preprocessing. Add it to <code>locations/locations.yaml</code> and run{' '}
              <code>just build</code>, or pick a saved location above.
              <small>
                ERA5 cell {era5Cell(place.latitude, place.longitude)} · anywhere within
                about 14 km of here shares the same cloud history
              </small>
            </p>
          )}

          <dl className="stats">
            {day && (
              <>
                <div>
                  <dt>Historically usable night</dt>
                  <dd>{Math.round(day.p_usable_night * 100)}%</dd>
                </div>
                <div>
                  <dt>Chance of ≥3 clear consecutive hours</dt>
                  <dd>{Math.round((day.p_clear_runs['25']?.['3h'] ?? 0) * 100)}%</dd>
                </div>
                <div>
                  <dt>Median nighttime cloud cover</dt>
                  <dd>{Math.round(day.median_cloud)}%</dd>
                </div>
              </>
            )}

            <div>
              <dt>Astronomical darkness <small>{year}</small></dt>
              <dd>{sky ? formatHours(sky.darkHours) : '—'}</dd>
            </div>
            <div>
              <dt>Moon-free darkness <small>{year}</small></dt>
              <dd>{sky ? formatHours(sky.moonFreeHours) : '—'}</dd>
            </div>
            <div>
              <dt>Moon <small>{year}</small></dt>
              <dd>
                {sky ? `${Math.round(sky.moon.illumination * 100)}%` : '—'}
                <small>{sky?.moon.phaseName}</small>
              </dd>
            </div>

            {day && (
              <>
                <div className={portion ? undefined : 'wide'}>
                  <dt>Best historical portion of night</dt>
                  <dd>
                    {portion && sky ? (
                      formatPortion(portion, sky.solarMidnight, place.timezone)
                    ) : (
                      <span className="muted-value">
                        No clear preference
                        <small>clear-sky odds are flat across the night here</small>
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Based on</dt>
                  <dd>
                    {day.sample_count} nights
                    <small>
                      {data!.metadata.baseline.start_year}–{data!.metadata.baseline.end_year}
                    </small>
                  </dd>
                </div>
              </>
            )}
          </dl>

          {breakdown && <ScoreBreakdown breakdown={breakdown} />}
        </section>
      )}

      <ForecastCard result={forecast} dateLabel={dateLabel} loading={forecastLoading} />

      {data && (
        <section className="chart-section">
          <div className="overlay-toggles" role="group" aria-label="Chart overlays">
            {OVERLAY_SERIES.map((s) => {
              const on = overlays.has(s.key)
              return (
                <button
                  key={s.key}
                  type="button"
                  className={on ? 'toggle on' : 'toggle'}
                  aria-pressed={on}
                  onClick={() =>
                    setOverlays((prev) => {
                      const next = new Set(prev)
                      if (next.has(s.key)) next.delete(s.key)
                      else next.add(s.key)
                      return next
                    })
                  }
                >
                  <span className="swatch" style={{ background: s.color }} />
                  {s.label}
                </button>
              )
            })}
          </div>

          <AnnualChart
            days={data.days}
            scores={scores}
            selectedIndex={dayIndex}
            onSelect={setDayIndex}
            activeOverlays={overlays}
          />
        </section>
      )}

      {data && <Provenance metadata={data.metadata} />}
    </main>
  )
}
