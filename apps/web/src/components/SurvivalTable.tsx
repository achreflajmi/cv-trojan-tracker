import type { SurvivalRow } from '../lib/results.ts';

/** Does the hidden text reach the model at all? One sequential hue: more = darker. */
export function SurvivalTable({ rows }: { rows: SurvivalRow[] }) {
  const methods = [...new Set(rows.map((r) => r.hiding_method))].sort();
  const extractors = [...new Set(rows.map((r) => r.extractor))].sort();
  const conditions = [...new Set(rows.map((r) => r.condition))].sort();
  const shade = (v: number | null) =>
    v === null
      ? 'var(--seq-0)'
      : v >= 0.99
        ? 'var(--seq-4)'
        : v >= 0.5
          ? 'var(--seq-3)'
          : v > 0
            ? 'var(--seq-2)'
            : 'var(--seq-0)';
  const ink = (v: number | null) => (v !== null && v >= 0.5 ? 'var(--surface)' : 'var(--ink)');

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[2px] text-sm">
        <thead>
          <tr className="text-left text-[var(--ink-2)]">
            <th className="py-1 pr-3 font-medium">Hiding method</th>
            {conditions.flatMap((c) =>
              extractors.map((e) => (
                <th key={`${c}-${e}`} className="px-2 py-1 font-medium">
                  {c.replace('HIDDEN_NEUTRAL', 'NEUTRAL')} · {e}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {methods.map((m) => (
            <tr key={m}>
              <th className="py-1 pr-3 text-left font-medium text-[var(--ink-2)]">
                {m.toLowerCase().replace('_', ' ')}
              </th>
              {conditions.flatMap((c) =>
                extractors.map((e) => {
                  const row = rows.find(
                    (r) => r.condition === c && r.hiding_method === m && r.extractor === e,
                  );
                  const v = row?.survival_rate ?? null;
                  return (
                    <td
                      key={`${c}-${e}`}
                      className="rounded px-2 py-1 text-center tabular-nums"
                      style={{ background: shade(v), color: ink(v) }}
                      title={row ? `${row.n} CVs` : ''}
                    >
                      {v === null ? '–' : `${Math.round(v * 100)}%`}
                    </td>
                  );
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Share of CVs whose hidden text appears in the extracted text the model receives. 0% means
        the model never sees it.
      </p>
    </div>
  );
}
