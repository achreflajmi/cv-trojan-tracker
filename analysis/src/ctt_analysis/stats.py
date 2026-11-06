"""Statistics: paired cluster bootstrap and Benjamini-Hochberg (SPEC 3.7).

The unit of resampling is the PROFILE (a synthetic candidate), never the individual
call: calls on the same profile are correlated, so resampling calls would make the
interval too narrow. Repeats are averaged within a profile first (proposal #2).
Resampling is stratified by job, so every bootstrap sample keeps each job's share.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class BootstrapResult:
    n: int
    estimate: float
    ci_low: float
    ci_high: float
    p_value: float


def paired_bootstrap(
    diffs_by_stratum: list[np.ndarray],
    *,
    resamples: int = 10_000,
    seed: int = 20261106,
    alpha: float = 0.05,
) -> BootstrapResult:
    """Percentile CI and two-sided p-value for the mean of per-profile differences.

    diffs_by_stratum: one array per job; each value is one profile's
    (mean injected score - mean CLEAN score).
    """
    strata = [np.asarray(d, dtype=float) for d in diffs_by_stratum if len(d) > 0]
    n = sum(len(d) for d in strata)
    if n < 2:
        nan = float("nan")
        return BootstrapResult(n, nan if n == 0 else float(strata[0][0]), nan, nan, nan)

    rng = np.random.default_rng(seed)
    total = np.zeros(resamples)
    for d in strata:
        idx = rng.integers(0, len(d), size=(resamples, len(d)))
        total += d[idx].sum(axis=1)
    boot = total / n
    estimate = float(np.concatenate(strata).mean())

    low, high = np.quantile(boot, [alpha / 2, 1 - alpha / 2])
    # Two-sided bootstrap p-value for H0: mean = 0, with the +1 correction so it is never 0.
    below = (np.count_nonzero(boot <= 0) + 1) / (resamples + 1)
    above = (np.count_nonzero(boot >= 0) + 1) / (resamples + 1)
    p = min(1.0, 2 * min(below, above))
    return BootstrapResult(n, estimate, float(low), float(high), float(p))


def benjamini_hochberg(p_values: list[float], q: float = 0.05) -> tuple[list[float], list[bool]]:
    """Adjusted p-values (step-up) and reject flags at FDR q. NaN p-values are never rejected."""
    p = np.asarray(p_values, dtype=float)
    valid = ~np.isnan(p)
    adjusted = np.full(p.shape, np.nan)
    m = int(valid.sum())
    if m > 0:
        pv = p[valid]
        order = np.argsort(pv)
        ranked = pv[order] * m / np.arange(1, m + 1)
        # Enforce monotonicity from the largest rank down, cap at 1.
        ranked = np.minimum.accumulate(ranked[::-1])[::-1]
        out = np.empty(m)
        out[order] = np.minimum(ranked, 1.0)
        adjusted[valid] = out
    reject = [bool(a <= q) if not np.isnan(a) else False for a in adjusted]
    return [float(a) for a in adjusted], reject
