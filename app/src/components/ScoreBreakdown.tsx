import type { ScoreBreakdown as Breakdown } from '../climatology/score'

/**
 * How the score was produced - spec section 15 asks to "show exactly how it was
 * generated". This is also the only place a wrong number upstream becomes
 * visible, so it is a debugging surface as much as a UI one.
 */
export function ScoreBreakdown({ breakdown }: { breakdown: Breakdown }) {
  return (
    <details className="breakdown">
      <summary>How this score is built</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Historical</th>
              <th scope="col">Sub-score</th>
              <th scope="col">Weight</th>
              <th scope="col">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.components.map((c) => (
              <tr key={c.key}>
                <th scope="row">{c.label}</th>
                <td>{c.rawLabel}</td>
                <td>{Math.round(c.normalized)}</td>
                <td>{c.weight}%</td>
                <td>{c.contribution.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{breakdown.mode.label}</th>
              <td colSpan={3} />
              <td>
                <b>{Math.round(breakdown.score)}</b>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>
  )
}
