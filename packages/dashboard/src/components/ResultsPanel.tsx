import type { Results } from "@/lib/types";
import { probPct, ratePct, round } from "@/lib/format";

/**
 * The user-based, windowed beta-binomial summary (D2 / ARCH §4). Read-only:
 * exposed/converted counts, conversion rate, P(best), and the 95% credible
 * interval per variant. The posterior `winner` (decisive leader) is distinct
 * from an *applied* winner — it's highlighted but not acted on here.
 */
export function ResultsPanel({ results }: { results: Results }) {
  const hasRevenue = results.variants.some((v) => v.revPerVisitor !== undefined);
  const leader = results.variants.reduce<typeof results.variants[number] | null>(
    (best, v) => (best === null || v.pBest > best.pBest ? v : best),
    null,
  );

  return (
    <div>
      <p className="subtle">
        {results.windowDays}-day conversion window
        {results.winner ? (
          <>
            {" "}
            · posterior winner{" "}
            <span className="winner-pill">{results.winner}</span>
          </>
        ) : (
          " · no decisive winner yet"
        )}
      </p>
      <table className="results">
        <thead>
          <tr>
            <th>Variant</th>
            <th>Exposed</th>
            <th>Converted</th>
            <th>Rate</th>
            <th>P(best)</th>
            <th>95% CI</th>
            {hasRevenue ? <th>Rev/visitor</th> : null}
          </tr>
        </thead>
        <tbody>
          {results.variants.map((v) => {
            const isLeader = leader?.id === v.id && v.exposed > 0;
            return (
              <tr key={v.id}>
                <td>
                  {v.id}
                  {isLeader ? " ★" : ""}
                </td>
                <td className="num">{v.exposed}</td>
                <td className="num">{v.converted}</td>
                <td className="num">{ratePct(v.rate)}</td>
                <td className="num">{probPct(v.pBest)}</td>
                <td className="num">
                  {ratePct(v.ci95[0])} – {ratePct(v.ci95[1])}
                </td>
                {hasRevenue ? (
                  <td className="num">
                    {v.revPerVisitor !== undefined ? round(v.revPerVisitor, 2) : "—"}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {results.variants.every((v) => v.exposed === 0) ? (
        <p className="subtle" style={{ marginTop: 10 }}>
          No exposures recorded yet — numbers populate once the snippet serves this
          test and the beacon collects events.
        </p>
      ) : null}
    </div>
  );
}
