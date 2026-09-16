import type { ForecastResult } from '../forecast/forecast'

const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v)}%` : '—')
const one = (v: number, unit: string) => (Number.isFinite(v) ? `${v.toFixed(1)} ${unit}` : '—')

/**
 * Tonight's forecast for the selected night.
 *
 * Deliberately its own card rather than a column beside the historical figures.
 * The two describe different things - one night against a distribution over 450
 * of them - and putting them in one row invites subtracting them, which is
 * exactly what spec section 2 forbids.
 */
export function ForecastCard({
  result,
  dateLabel,
  loading,
}: {
  result: ForecastResult | null
  dateLabel: string
  loading: boolean
}) {
  if (loading) {
    return (
      <section className="forecast">
        <h3>Forecast for this night</h3>
        <p className="loading">Loading forecast…</p>
      </section>
    )
  }

  if (!result) return null

  if (!result.night) {
    return (
      <section className="forecast">
        <h3>Forecast for this night</h3>
        <p className="forecast-empty">{result.reason}</p>
      </section>
    )
  }

  const n = result.night
  return (
    <section className="forecast">
      <h3>
        Forecast for {dateLabel}
        <small>one specific night, not a historical average</small>
      </h3>

      <dl className="stats">
        <div>
          <dt>Mean cloud while dark</dt>
          <dd>{pct(n.meanCloud)}</dd>
        </div>
        <div>
          <dt>Clearest hour</dt>
          <dd>{pct(n.minCloud)}</dd>
        </div>
        <div>
          <dt>Longest clear stretch</dt>
          <dd>
            {n.longestClearRun} h<small>of {n.hoursCovered} dark hours</small>
          </dd>
        </div>
        <div>
          <dt>Dew spread</dt>
          <dd>{one(n.meanDewSpread, '°C')}</dd>
        </div>
        <div>
          <dt>Wind / gusts</dt>
          <dd>
            {one(n.meanWind, '')} / {one(n.maxGust, 'm/s')}
          </dd>
        </div>
        <div>
          <dt>Precipitation chance</dt>
          <dd>{pct(n.maxPrecipProbability)}</dd>
        </div>
        <div>
          <dt>Visibility</dt>
          <dd>{one(n.minVisibilityKm, 'km')}</dd>
        </div>
        <div>
          <dt>Humidity</dt>
          <dd>{pct(n.meanHumidity)}</dd>
        </div>
      </dl>

      <p className="forecast-note">
        Retrieved {result.retrievedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
        Summarised over astronomical darkness only, using the same clear-hour
        convention as the history.
      </p>
    </section>
  )
}
