import { fmt, fmtCi, PRIMARY, variantLabel, type Cell } from '../lib/results.ts';

interface Props {
  cells: Cell[];
  models: string[];
  sesoi: number;
  band?: string;
}

const ROW = 26;
const GROUP_GAP = 10;
const LABEL_W = 230;
const PLOT_W = 460;
const PAD = 16;

/**
 * Score lift with 95% CI per (variant, model): one row per model inside each variant
 * group. Static SVG; each mark carries a native tooltip (<title>) and the full numbers
 * are in the table view below, so nothing depends on color or hover alone.
 */
export function ForestChart({ cells, models, sesoi, band = PRIMARY }: Props) {
  const variants = [...new Set(cells.map((c) => c.variant))].sort();
  const rows: { cell: Cell | undefined; variant: string; model: string; y: number }[] = [];
  let y = PAD + 8;
  for (const variant of variants) {
    for (const model of models) {
      rows.push({
        cell: cells.find((c) => c.variant === variant && c.model === model),
        variant,
        model,
        y,
      });
      y += ROW;
    }
    y += GROUP_GAP;
  }
  const height = y + 30;

  const values = cells.flatMap((c) => [
    c.score_lift[band]?.ci_low ?? 0,
    c.score_lift[band]?.ci_high ?? 0,
  ]);
  const lo = Math.floor(Math.min(-sesoi - 1, ...values));
  const hi = Math.ceil(Math.max(sesoi + 1, ...values));
  const x = (v: number) => LABEL_W + ((v - lo) / (hi - lo)) * PLOT_W;
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((t) =>
    hi - lo > 12 ? t % 2 === 0 : true,
  );
  const color = (model: string) => `var(--series-${(models.indexOf(model) % 7) + 1})`;

  return (
    <figure className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${LABEL_W + PLOT_W + PAD} ${height}`}
        role="img"
        aria-label="Score lift per hidden-text variant and model, with 95% confidence intervals"
        className="w-full min-w-[640px]"
      >
        <rect
          x={x(-sesoi)}
          y={PAD}
          width={x(sesoi) - x(-sesoi)}
          height={height - PAD - 30}
          fill="var(--band)"
        />
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={PAD}
              y2={height - 30}
              stroke={t === 0 ? 'var(--muted)' : 'var(--rule)'}
              strokeWidth={t === 0 ? 1.5 : 1}
            />
            <text x={x(t)} y={height - 12} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {t > 0 ? `+${t}` : t < 0 ? `−${-t}` : '0'}
            </text>
          </g>
        ))}
        {rows.map(({ cell, variant, model, y: ry }) => {
          const r = cell?.score_lift[band];
          const first = models.indexOf(model) === 0;
          return (
            <g key={`${variant}-${model}`}>
              <text x={LABEL_W - 10} y={ry + 4} textAnchor="end" fontSize={12} fill="var(--ink-2)">
                {first ? variantLabel(variant) : ''}
                <tspan fill="var(--muted)" dx={first ? 8 : 0}>
                  {model}
                  {cell?.effect ? ' ✱' : ''}
                </tspan>
              </text>
              {r && r.ci_low !== null && r.ci_high !== null && r.estimate !== null ? (
                <g>
                  <title>{`${model} · ${variantLabel(variant)}: ${fmt(r.estimate)} points (95% CI ${fmtCi(r)}), ${r.n_profiles ?? '–'} profiles${cell?.effect ? ' — effect' : ''}`}</title>
                  {/* Invisible hit target, larger than the mark. */}
                  <rect
                    x={LABEL_W}
                    y={ry - ROW / 2}
                    width={PLOT_W}
                    height={ROW}
                    fill="transparent"
                  />
                  <line
                    x1={x(r.ci_low)}
                    x2={x(r.ci_high)}
                    y1={ry}
                    y2={ry}
                    stroke={color(model)}
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={x(r.estimate)}
                    cy={ry}
                    r={5}
                    fill={color(model)}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 text-xs text-[var(--muted)]">
        Score lift in points vs the same CV without hidden text (95% CI). Shaded: |lift| below{' '}
        {sesoi}, too small to matter. ✱ = effect by the pre-registered rule.
      </figcaption>
    </figure>
  );
}
