"""SPEC 7: a planted lift of +8 must produce a CI containing 8. Plus known-answer tests."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from ctt_analysis.analyze import Settings, analyze
from ctt_analysis.stats import benjamini_hochberg, paired_bootstrap

FAST = Settings(resamples=4_000)


def synthetic_calls(lift: dict[str, float], *, jobs=3, profiles=36, repeats=3, seed=1) -> pd.DataFrame:
    """Profiles with their own base score, per-call noise, and a planted lift per variant."""
    rng = np.random.default_rng(seed)
    bands = ["strong", "medium", "weak"]
    rows = []
    for j in range(jobs):
        for p in range(profiles):
            base = rng.normal(55, 12)
            band = bands[p % 3]
            for variant, delta in [("CLEAN", 0.0), *lift.items()]:
                arms = ["A", "B"] if variant == "CLEAN" else ["A"]
                for arm in arms:
                    for r in range(repeats):
                        score = float(np.clip(round(base + delta + rng.normal(0, 6)), 0, 100))
                        rows.append(
                            {
                                "model": "m1",
                                "extractor": "pdfjs",
                                "variant": variant,
                                "arm": arm,
                                "job": f"job{j}",
                                "profile": f"job{j}-p{p}",
                                "fit_band": band,
                                "repeat": r,
                                "parsed": 1,
                                "score": score,
                                "advance": 1 if score >= 60 else 0,
                            }
                        )
    return pd.DataFrame(rows)


@pytest.fixture(scope="module")
def results():
    return analyze(synthetic_calls({"DATA-WHITE": 8.0, "HIDDEN_NEUTRAL-WHITE": 0.0}), FAST)


def cell(results, variant):
    return next(c for c in results["cells"] if c["variant"] == variant)


def test_planted_plus_8_is_inside_the_ci(results):
    r = cell(results, "DATA-WHITE")["score_lift"]["primary"]
    assert r["ci_low"] <= 8 <= r["ci_high"]
    assert r["ci_low"] > 0
    assert cell(results, "DATA-WHITE")["effect"] is True


def test_planted_zero_is_not_an_effect(results):
    r = cell(results, "HIDDEN_NEUTRAL-WHITE")["score_lift"]["primary"]
    assert r["ci_low"] <= 0 <= r["ci_high"]
    assert cell(results, "HIDDEN_NEUTRAL-WHITE")["effect"] is False


def test_aa_noise_floor_is_centred_on_zero(results):
    aa = results["aa"][0]["score"]["primary"]
    assert aa["ci_low"] <= 0 <= aa["ci_high"]


def test_small_but_significant_lift_is_not_an_effect():
    # A real but tiny lift (1 point) with very low noise: CI excludes 0, but it is
    # below the minimum effect size of interest, so it is not reported as an effect.
    res = analyze(synthetic_calls({"DATA-WHITE": 1.0}, repeats=10, seed=3), FAST)
    r = cell(res, "DATA-WHITE")["score_lift"]["primary"]
    assert r["ci_low"] > 0  # statistically clear...
    assert cell(res, "DATA-WHITE")["effect"] is False  # ...but practically too small


def test_bootstrap_is_deterministic_and_resamples_profiles():
    d = [np.array([1.0, 2.0, 3.0, 4.0])]
    a = paired_bootstrap(d, resamples=2000, seed=7)
    b = paired_bootstrap(d, resamples=2000, seed=7)
    assert a == b
    assert a.n == 4 and a.estimate == pytest.approx(2.5)


def test_bootstrap_ci_coverage_is_close_to_95_percent():
    # Known answer by simulation: true mean 5; the 95% CI should contain it ~95% of the time.
    rng = np.random.default_rng(11)
    hits = 0
    trials = 200
    for i in range(trials):
        d = rng.normal(5, 10, size=60)
        r = paired_bootstrap([d], resamples=2000, seed=i)
        hits += r.ci_low <= 5 <= r.ci_high
    assert 0.88 <= hits / trials <= 0.99


def test_benjamini_hochberg_known_example():
    # Benjamini & Hochberg (1995)-style example: sorted p-values, q = 0.05.
    p = [0.01, 0.04, 0.03, 0.005, 0.5]
    adjusted, reject = benjamini_hochberg(p, 0.05)
    # Ranks: 0.005(1) 0.01(2) 0.03(3) 0.04(4) 0.5(5); thresholds k*0.05/5 = .01,.02,.03,.04,.05
    assert reject == [True, True, True, True, False]
    assert adjusted[3] == pytest.approx(0.025)  # 0.005 * 5 / 1 -> min with later ranks: 0.025
    assert adjusted[4] == pytest.approx(0.5)


def test_benjamini_hochberg_ignores_nan():
    adjusted, reject = benjamini_hochberg([float("nan"), 0.001], 0.05)
    assert reject == [False, True]
    assert np.isnan(adjusted[0])
