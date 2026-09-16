import { useMemo, useRef, useState } from 'react'
import type { DayRecord } from '../climatology/types'
import { monthDayOf } from '../climatology/types'
import { useMeasuredWidth } from './useMeasuredWidth'
import { OVERLAY_SERIES, SERIES_COLORS, type AnnualSeries } from './series'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const HEIGHT = 300
const PAD = { top: 16, right: 14, bottom: 30, left: 36 }

interface Props {
  days: Record<string, DayRecord>
  scores: number[]
  selectedIndex: number
  onSelect: (index: number) => void
  activeOverlays: Set<string>
}

/**
 * Historical observing suitability across the whole year - spec section 17.
 *
 * One y-axis, 0-100. Every series drawn here is a percentage or a score; wind
 * and darkness live in their own small multiples below rather than being
 * squeezed onto this scale.
 */
export function AnnualChart({ days, scores, selectedIndex, onSelect, activeOverlays }: Props) {
  // Measured on a sentinel, never on the element containing the SVG: a
  // fixed-width child can widen its own container, and then the observer only
  // ever sees the inflated width. On a phone that ratchets the whole page wider
  // and never recovers.
  const measureRef = useRef<HTMLDivElement>(null)
  const width = useMeasuredWidth(measureRef)
  const [hover, setHover] = useState<number | null>(null)

  const plotW = Math.max(120, width - PAD.left - PAD.right)
  const plotH = HEIGHT - PAD.top - PAD.bottom

  const x = (index: number) => PAD.left + ((index - 1) / 364) * plotW
  const y = (value: number) => PAD.top + plotH - (value / 100) * plotH

  const series: AnnualSeries[] = useMemo(
    () => OVERLAY_SERIES.filter((s) => activeOverlays.has(s.key)),
    [activeOverlays],
  )

  const paths = useMemo(() => {
    const build = (values: (index: number) => number) => {
      let d = ''
      for (let i = 1; i <= 365; i += 1) {
        d += `${i === 1 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(values(i)).toFixed(2)}`
      }
      return d
    }
    return {
      score: build((i) => scores[i - 1] ?? 0),
      overlays: series.map((s) => ({
        key: s.key,
        color: s.color,
        d: build((i) => {
          const day = days[String(i)]
          return day ? s.value(day) : 0
        }),
      })),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, scores, series, plotW, plotH])

  const indexFromEvent = (clientX: number): number => {
    const rect = measureRef.current?.getBoundingClientRect()
    if (!rect) return selectedIndex
    const ratio = (clientX - rect.left - PAD.left) / plotW
    return Math.min(365, Math.max(1, Math.round(ratio * 364) + 1))
  }

  const active = hover ?? selectedIndex
  const activeDay = days[String(active)]
  const { month, day } = monthDayOf(active)
  const tooltipLeft = Math.min(Math.max(x(active), 70), width - 70)

  return (
    <figure className="chart">
      <figcaption className="chart-caption">
        <span>Historical observing suitability through the year</span>
        <span className="chart-subcaption">0–100 · higher is better</span>
      </figcaption>

      <div className="chart-measure" ref={measureRef} aria-hidden="true" />

      <div
        className="chart-plot"
        onPointerMove={(e) => setHover(indexFromEvent(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => onSelect(indexFromEvent(e.clientX))}
      >
        <svg width={width} height={HEIGHT} role="img" aria-label="Annual observing suitability">
          {[0, 25, 50, 75, 100].map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={y(tick)}
                y2={y(tick)}
                className="grid"
              />
              <text x={PAD.left - 8} y={y(tick) + 4} className="axis-label" textAnchor="end">
                {tick}
              </text>
            </g>
          ))}

          {MONTHS.map((label, i) => {
            const start = Math.round((i / 12) * 364) + 1
            return (
              <text
                key={label}
                x={x(start) + plotW / 24}
                y={HEIGHT - 10}
                className="axis-label"
                textAnchor="middle"
              >
                {width < 520 ? label[0] : label}
              </text>
            )
          })}

          <line
            x1={x(selectedIndex)}
            x2={x(selectedIndex)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            className="selected-rule"
          />

          {paths.overlays.map((o) => (
            <path key={o.key} d={o.d} fill="none" stroke={o.color} strokeWidth={2} />
          ))}
          <path
            d={paths.score}
            fill="none"
            stroke={SERIES_COLORS.score}
            strokeWidth={2.5}
          />

          {hover !== null && (
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} className="crosshair" />
          )}

          {hover !== null && activeDay && (
            <>
              {paths.overlays.map((o) => {
                const s = series.find((x2) => x2.key === o.key)
                if (!s) return null
                return (
                  <circle
                    key={o.key}
                    cx={x(active)}
                    cy={y(s.value(activeDay))}
                    r={4}
                    fill={o.color}
                    className="marker"
                  />
                )
              })}
              <circle
                cx={x(active)}
                cy={y(scores[active - 1] ?? 0)}
                r={5}
                fill={SERIES_COLORS.score}
                className="marker"
              />
            </>
          )}
        </svg>

        {hover !== null && activeDay && (
          <div className="tooltip" style={{ left: tooltipLeft }}>
            <strong>
              {MONTHS[month - 1]} {day}
            </strong>
            <span className="tooltip-row">
              <span className="swatch" style={{ background: SERIES_COLORS.score }} />
              Score <b>{Math.round(scores[active - 1] ?? 0)}</b>
            </span>
            {series.map((s) => (
              <span className="tooltip-row" key={s.key}>
                <span className="swatch" style={{ background: s.color }} />
                {s.label} <b>{s.format(s.value(activeDay))}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="legend">
        <span className="legend-item">
          <span className="swatch" style={{ background: SERIES_COLORS.score }} />
          Observing score
        </span>
        {series.map((s) => (
          <span className="legend-item" key={s.key}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </figure>
  )
}
