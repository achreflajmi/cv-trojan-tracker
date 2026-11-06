import { ForestChart } from '../src/components/ForestChart.tsx';
import { SurvivalTable } from '../src/components/SurvivalTable.tsx';
import { loadResults } from '../src/lib/load.ts';
import { fmt, fmtCi, headline, modelOrder, PRIMARY, variantLabel } from '../src/lib/results.ts';

export default function Home() {
  const r = loadResults();
  const h = headline(r);
  const models = modelOrder(r);
  const extractors = [...new Set(r.cells.map((c) => c.extractor))].sort();
  const date = r.meta.exported_at.slice(0, 10);

  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <p className="text-xl text-[var(--ink-2)]">
          Some job applicants hide text in their CV that people cannot see but software reads. We
          measure, model by model and repeatedly, whether AI screeners score those candidates
          higher.
        </p>
        {h ? (
          <div className="rounded-lg border border-[var(--rule)] bg-[var(--surface)] p-6">
            <p className="text-sm text-[var(--ink-2)]">
              {h.kind === 'effect'
                ? 'Largest effect'
                : 'No effect passed the pre-registered rule. Largest observed lift'}{' '}
              · {h.cell.model} · {variantLabel(h.cell.variant)} · {h.cell.extractor}
            </p>
            <p className="mt-2 text-5xl font-semibold tabular-nums">
              {fmt(h.interval.estimate)}{' '}
              <span className="text-2xl font-normal text-[var(--ink-2)]">score points</span>
            </p>
            <p className="mt-2 text-[var(--ink-2)] tabular-nums">
              95% CI {fmtCi(h.interval)} · noise floor (A/A) {fmt(h.noiseFloor?.estimate)} (
              {fmtCi(h.noiseFloor)}) · measured {date}
            </p>
          </div>
        ) : (
          <p>No results yet.</p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Score lift per model and hiding method</h2>
        <ul className="flex flex-wrap gap-4 text-sm text-[var(--ink-2)]" aria-label="Legend">
          {models.map((m, i) => (
            <li key={m} className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: `var(--series-${(i % 7) + 1})` }}
              />
              {m}
            </li>
          ))}
        </ul>
        {extractors.map((e) => (
          <div key={e} className="rounded-lg border border-[var(--rule)] bg-[var(--surface)] p-4">
            <h3 className="mb-2 text-sm font-medium text-[var(--ink-2)]">Text extractor: {e}</h3>
            <ForestChart
              cells={r.cells.filter((c) => c.extractor === e)}
              models={models}
              sesoi={r.settings.sesoi_points}
            />
          </div>
        ))}
        <details className="rounded-lg border border-[var(--rule)] bg-[var(--surface)] p-4 text-sm">
          <summary className="cursor-pointer font-medium">Table view</summary>
          <table className="mt-3 w-full text-left tabular-nums">
            <thead className="text-[var(--ink-2)]">
              <tr>
                <th className="py-1">Model</th>
                <th>Extractor</th>
                <th>Variant</th>
                <th>Lift</th>
                <th>95% CI</th>
                <th>BH p</th>
                <th>Effect</th>
              </tr>
            </thead>
            <tbody>
              {r.cells.map((c) => {
                const i = c.score_lift[PRIMARY];
                return (
                  <tr
                    key={`${c.model}-${c.extractor}-${c.variant}`}
                    className="border-t border-[var(--rule)]"
                  >
                    <td className="py-1">{c.model}</td>
                    <td>{c.extractor}</td>
                    <td>{variantLabel(c.variant)}</td>
                    <td>{fmt(i?.estimate)}</td>
                    <td>{fmtCi(i)}</td>
                    <td>{c.p_bh === null ? '–' : c.p_bh.toFixed(4)}</td>
                    <td>{c.effect ? 'yes' : 'no'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      </section>

      {r.rank_cells.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Ranking among 10 candidates</h2>
          <p className="text-sm text-[var(--ink-2)]">
            Places the injected candidate moves up compared with the same pool without hidden text.
          </p>
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-[var(--ink-2)]">
              <tr>
                <th className="py-1">Model</th>
                <th>Variant</th>
                <th>Injected in pool</th>
                <th>Places up</th>
                <th>95% CI</th>
                <th>Top-3 change</th>
                <th>Pools</th>
              </tr>
            </thead>
            <tbody>
              {r.rank_cells.map((c) => (
                <tr
                  key={`${c.model}-${c.extractor}-${c.variant}-${c.k}`}
                  className="border-t border-[var(--rule)]"
                >
                  <td className="py-1">{c.model}</td>
                  <td>{variantLabel(c.variant)}</td>
                  <td>{c.k} of 10</td>
                  <td>{fmt(c.rank_lift.estimate)}</td>
                  <td>{fmtCi(c.rank_lift)}</td>
                  <td>{fmt((c.top3_lift.estimate ?? 0) * 100, 0)} pp</td>
                  <td>{c.n_pools}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Does the hidden text even reach the model?</h2>
        <SurvivalTable rows={r.survival} />
      </section>
    </div>
  );
}
