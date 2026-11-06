"""Build the SAMPLE results file the web page uses until real results exist.

Model results are synthetic (planted effects, fake model names) and the file is
marked `"sample": true`, so the page shows a banner. The survival table is the real
Stage 2 measurement if data/export/survival.csv exists.

    uv run python scripts/make_sample.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
from test_analysis import synthetic_calls  # noqa: E402
from test_rank import synthetic_rank  # noqa: E402

from ctt_analysis.analyze import Settings, analyze, rank_analysis, survival_table, to_jsonable  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "web" / "fixtures" / "results.sample.json"

a = synthetic_calls({"DATA-WHITE": 8.0, "INSTR-WHITE": 4.0, "HIDDEN_NEUTRAL-WHITE": 0.0, "VIS_DATA": 7.0}, seed=1)
a["model"] = "model-a"
b = synthetic_calls({"DATA-WHITE": 2.0, "INSTR-WHITE": -1.0, "HIDDEN_NEUTRAL-WHITE": 0.0, "VIS_DATA": 1.5}, seed=5)
b["model"] = "model-b"
settings = Settings(resamples=4000)
results = analyze(pd.concat([a, b]), settings)

rank = synthetic_rank(2.0, seed=4)
rank["model"] = "model-a"
results["rank_cells"] = rank_analysis(rank, settings)

survival_csv = ROOT / "data" / "export" / "survival.csv"
results["survival"] = (
    survival_table(pd.read_csv(survival_csv, keep_default_na=False, na_values=[""])) if survival_csv.exists() else []
)
results["meta"] = {
    "sample": True,
    "experiment": "sample",
    "exported_at": "2026-11-06T00:00:00Z",
    "prereg_commit": None,
    "note": "Model results are synthetic, with planted effects and made-up model names, to show the layout.",
    "survival_is_measured": survival_csv.exists(),
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(to_jsonable(results), indent=1), encoding="utf-8")
print(f"wrote {OUT}")
