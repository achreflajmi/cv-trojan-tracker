"""Rank lift, checked as properties over many simulated datasets (one seed can be unlucky:
a 95% CI misses the truth 5% of the time by design)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from ctt_analysis.analyze import Settings, rank_analysis

FAST = Settings(resamples=2000)


def synthetic_rank(moves_up: float, *, jobs=4, pools=6, repeats=3, seed=2) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for j in range(jobs):
        for p in range(pools):
            base = rng.integers(4, 9)  # the target's typical place in a clean pool
            for k, shift in [(0, 0.0), (1, moves_up)]:
                for r in range(repeats):
                    rank = int(np.clip(round(base - shift + rng.normal(0, 1)), 1, 10))
                    rows.append(
                        {
                            "model": "m1",
                            "extractor": "pdfjs",
                            "job": f"job{j}",
                            "pool": f"job{j}|p{p}",
                            "k": k,
                            "variant": "CLEAN" if k == 0 else "DATA-WHITE",
                            "repeat": r,
                            "parsed": 1,
                            "target_rank": rank,
                            "target_top3": int(rank <= 3),
                        }
                    )
    return pd.DataFrame(rows)


def test_planted_rank_lift_is_recovered_without_bias():
    lifts = [rank_analysis(synthetic_rank(2.0, seed=100 + s), FAST)[0] for s in range(20)]
    estimates = [c["rank_lift"]["estimate"] for c in lifts]
    covered = sum(c["rank_lift"]["ci_low"] <= 2 <= c["rank_lift"]["ci_high"] for c in lifts)
    assert abs(np.mean(estimates) - 2) < 0.15
    assert covered >= 17  # ~95% nominal
    assert all(c["effect"] for c in lifts)
    assert all(c["top3_lift"]["estimate"] >= 0 for c in lifts)
    assert lifts[0]["n_pools"] == 24


def test_no_move_is_rarely_an_effect():
    # With 24 pools the percentile bootstrap is somewhat anti-conservative (observed ~10%
    # false positives vs 5% nominal): recorded as a finding; the full run uses more pools.
    lifts = [rank_analysis(synthetic_rank(0.0, seed=200 + s), FAST)[0] for s in range(30)]
    false_positives = sum(c["effect"] for c in lifts)
    assert false_positives <= 5
    assert abs(np.mean([c["rank_lift"]["estimate"] for c in lifts])) < 0.15
