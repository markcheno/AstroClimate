import { useEffect, useMemo, useState } from 'react'
import { AnnualChart } from './charts/AnnualChart'
import { OVERLAY_SERIES } from './charts/series'
import { ScoreBreakdown } from './components/ScoreBreakdown'
import { Provenance } from './components/Provenance'
import { formatHours, night } from './astronomy/night'
import { bestPortion, formatPortion } from './climatology/hours'
import { loadIndex, loadLocation } from './climatology/load'
import { MODES, MODES_BY_ID, scoreDay, type ActivityMode } from './climatology/score'
import { dayIndexOf, monthDayOf } from './climatology/types'
import type { ClimatologyFile, LocationSummary } from './climatology/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function App() {
  const [locations, setLocations] = useState<LocationSummary[]>([])
  const [locationId, setLocationId] = useState<string>('')
  const [data, setData] = useState<ClimatologyFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [dayIndex, setDayIndex] = useState(() => dayIndexOf(new Date()))
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [mode, setMode] = useState<ActivityMode>('visual')
  const [overlays, setOverlays] = useState<Set<string>>(new Set(['clear3']))

  useEffect(() => {
    loadIndex()
      .then((index) => {
        setLocations(index.locations)
        setLocationId((current) => current || index.locations[0]?.id || '')
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const summary = locations.find((l) => l.id === locationId)

  useEffect(() => {
    if (!summary) return
    setData(null)
    loadLocation(summary.file)
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [summary])

  const modeSpec = MODES_BY_ID.get(mode)!

  // One pass over the year, reused by the chart and the summary card.
  const scores = useMemo(() => {
    if (!data) return []
    return Array.from({ length: 365 }, (_, i) => {
      const day = data.days[String(i + 1)]
      return day ? scoreDay(day, modeSpec).score : 0
    })
  }, [data, modeSpec])

  const day = data?.days[String(dayIndex)]
  const breakdown = day ? scoreDay(day, modeSpec) : null
  const { month, day: dayOfMonth } = monthDayOf(dayIndex)

  // Astronomy depends on the selected year; climatology never does.
  const sky = useMemo(() => {
    if (!summary) return null
    return night(summary.latitude, summary.longitude, summary.elevation_m,
      new Date(year, month - 1, dayOfMonth))
  }, [summary, year, month, dayOfMonth])

  const portion = day ? bestPortion(day.hours) : null

  if (error) {
    return (
      <main className="shell">
        <h1>AstroClimate</h1>
        <p className="error">Could not load climatology: {error}</p>
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
        <label>
          <span>Location</span>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>

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
          <span>
            Date <b>{MONTHS[month - 1]} {dayOfMonth}</b>
          </span>
          <input
            type="range"
            min={1}
            max={365}
            value={dayIndex}
            onChange={(e) => setDayIndex(Number(e.target.value))}
          />
        </label>
      </section>

      {!data && <p className="loading">Loading climatology…</p>}

      {data && day && breakdown && summary && (
        <>
          <section className="summary">
            <h2>
              {MONTH_NAMES[month - 1]} {dayOfMonth} — {summary.name}
            </h2>

            <div className="hero">
              <span className="hero-number">{Math.round(breakdown.score)}</span>
              <span className="hero-label">
                Historical observing quality
                <small>out of 100 · {modeSpec.label.toLowerCase()}</small>
              </span>
            </div>

            <dl className="stats">
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
              {/* The fallback sentence needs the full row; a clock range does not. */}
              <div className={portion ? undefined : 'wide'}>
                <dt>Best historical portion of night</dt>
                <dd>
                  {portion && sky ? (
                    formatPortion(portion, sky.solarMidnight, summary.timezone)
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
                    {data.metadata.baseline.start_year}–{data.metadata.baseline.end_year}
                  </small>
                </dd>
              </div>
            </dl>

            <ScoreBreakdown breakdown={breakdown} />
          </section>

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

          <Provenance metadata={data.metadata} />
        </>
      )}
    </main>
  )
}
