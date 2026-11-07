import { loadResults } from '../../src/lib/load.ts';

export const metadata = { title: 'Methodology · CV Trojan Tracker' };

export default function Methodology() {
  const r = loadResults();
  const s = r.settings;
  return (
    <article className="space-y-6 leading-relaxed">
      <h1 className="text-2xl font-semibold">Methodology</h1>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">What is measured</h2>
        <p>
          Synthetic candidates (no real people) are written into PDF CVs for four jobs. Each CV
          exists in versions: clean, with hidden copies of the job&apos;s keywords, with a hidden
          instruction to rate the candidate highly, with hidden neutral text of the same length (a
          control), and with the same keywords or instruction visible. Text is hidden in five ways
          (white text, tiny text, text off the page, invisible glyphs, a hidden layer). Like most
          screening pipelines, the model receives the text extracted from the PDF, by two common
          extractors.
        </p>
        <p>
          Each model scores every CV from 0 to 100 and decides whether to advance the candidate to a
          first interview. In a second task it ranks pools of ten candidates.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">How an effect is decided</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            Score lift: for each synthetic candidate, the average score with hidden text minus the
            average score of the same CV without it.
          </li>
          <li>
            95% confidence intervals by a paired bootstrap ({s.resamples.toLocaleString('en')}{' '}
            resamples of candidates, stratified by job).
          </li>
          <li>
            An <strong>effect</strong> requires all three: the interval excludes zero, the lift is
            at least {s.sesoi_points} points, and it survives a Benjamini–Hochberg correction at FDR{' '}
            {s.fdr} across all models and conditions.
          </li>
          <li>
            A noise floor (A/A): the same clean CVs scored twice, independently. It should be near
            zero; it is shown next to every result.
          </li>
          <li>
            Primary analysis: medium- and weak-fit candidates ({s.primary_bands.join(', ')}),
            because strong candidates are already near the top of the scale.
          </li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Pre-registration</h2>
        <p>
          Metrics, thresholds, repeat counts and the model list were fixed in{' '}
          <code>prereg.yaml</code> before the first full run.
          {r.meta.prereg_commit ? (
            <>
              {' '}
              Commit: <code>{r.meta.prereg_commit}</code>.
            </>
          ) : (
            <> This dataset is not a pre-registered run.</>
          )}
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">What this is not</h2>
        <p>
          It does not test commercial screening products, and it publishes effect sizes and
          detection guidance, not ready-made injection text. Prior work found that about 1% of real
          CVs contain hidden injections and how to detect them; what is new here is the repeated,
          model-by-model measurement of their effect.
        </p>
      </section>
    </article>
  );
}
