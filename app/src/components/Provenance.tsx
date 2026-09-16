import type { LocationMetadata } from '../climatology/types'

/**
 * Spec section 27. Every field reads from the file's own metadata rather than
 * being hardcoded, which is why the pipeline stores generated_at, window_days,
 * the run convention and per-variable sources.
 */
export function Provenance({ metadata }: { metadata: LocationMetadata }) {
  const sources = [...new Set(Object.values(metadata.sources))]
  return (
    <details className="provenance">
      <summary>Where these numbers come from</summary>
      <dl>
        <dt>Historical weather</dt>
        <dd>
          {sources.join(' · ')} via Open-Meteo
        </dd>

        <dt>Baseline</dt>
        <dd>
          {metadata.baseline.start_year}–{metadata.baseline.end_year}, hourly
        </dd>

        <dt>Climatology window</dt>
        <dd>±{metadata.window_days} calendar days</dd>

        <dt>Darkness</dt>
        <dd>Sun below {metadata.dark_threshold_deg}°</dd>

        <dt>Clear-hour convention</dt>
        <dd>Each hourly sample counts as the hour beginning at its timestamp</dd>

        <dt>Usable night</dt>
        <dd>
          ≥{metadata.usable_night.run_hours} consecutive hours under{' '}
          {metadata.usable_night.cloud_threshold}% cloud
        </dd>

        <dt>Grid note</dt>
        <dd>
          Cloud comes from a ~28 km grid cell, so nearby sites can share identical
          cloud climatology
        </dd>

        <dt>Last generated</dt>
        <dd>{metadata.generated_at.slice(0, 10)}</dd>
      </dl>
      <p className="attribution">
        Weather data by{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>{' '}
        (CC BY 4.0). Astronomy by{' '}
        <a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noreferrer">
          Astronomy Engine
        </a>
        .
      </p>
    </details>
  )
}
