"""Recompute every published number from the exported dataset (SPEC 9: "verify it yourself").

    uv run ctt-analyze ../data/export --out ../data/results
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
import yaml

from .analyze import Settings, analyze, rank_analysis, survival_table, to_jsonable
from .figures import forest_plot


def settings_from_prereg(path: Path | None) -> Settings:
    if path is None or not path.exists():
        return Settings()
    a = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("analysis", {})
    base = Settings()
    return Settings(
        resamples=int(a.get("bootstrap_resamples", base.resamples)),
        seed=int(a.get("seed", base.seed)),
        fdr=float(a.get("fdr", base.fdr)),
        sesoi_points=float(a.get("sesoi_points", base.sesoi_points)),
        primary_bands=tuple(a.get("primary_bands", base.primary_bands)),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export_dir", type=Path)
    parser.add_argument("--out", type=Path, default=Path("results"))
    parser.add_argument("--prereg", type=Path, default=Path("../prereg.yaml"))
    args = parser.parse_args()

    calls = pd.read_csv(args.export_dir / "calls.csv", keep_default_na=False, na_values=[""])
    survival = pd.read_csv(args.export_dir / "survival.csv", keep_default_na=False, na_values=[""])
    meta = json.loads((args.export_dir / "meta.json").read_text(encoding="utf-8"))

    settings = settings_from_prereg(args.prereg)
    results = analyze(calls, settings)
    results["survival"] = survival_table(survival)
    rank_file = args.export_dir / "rank.csv"
    results["rank_cells"] = (
        rank_analysis(pd.read_csv(rank_file, keep_default_na=False, na_values=[""]), settings)
        if rank_file.exists()
        else []
    )
    results["meta"] = meta
    results = to_jsonable(results)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    figures = forest_plot(results, args.out)
    effects = sum(1 for c in results["cells"] if c["effect"])
    print(f"{len(results['cells'])} cells, {effects} effect(s); wrote results.json and {len(figures)} figure(s) to {args.out}")


if __name__ == "__main__":
    main()
