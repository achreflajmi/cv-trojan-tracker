"""Figures. Palette: the validated dataviz reference palette (categorical slots in
fixed order, never cycled; a model keeps its color whatever is filtered)."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # no display needed
import matplotlib.pyplot as plt  # noqa: E402

SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"]
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_2 = "#52514e"
MUTED = "#898781"


def forest_plot(results: dict, out: Path, band: str = "primary") -> list[Path]:
    """One forest plot per extractor: score lift with 95% CI, one row per variant, one
    color per model (direct labels on every row, so identity is never color alone)."""
    paths = []
    models = sorted({c["model"] for c in results["cells"]})
    color = {m: SERIES[i % len(SERIES)] for i, m in enumerate(models)}
    sesoi = results["settings"]["sesoi_points"]
    for extractor in sorted({c["extractor"] for c in results["cells"]}):
        cells = [c for c in results["cells"] if c["extractor"] == extractor]
        cells.sort(key=lambda c: (c["variant"], c["model"]))
        fig, ax = plt.subplots(figsize=(8, 0.32 * len(cells) + 1.4), facecolor=SURFACE)
        ax.set_facecolor(SURFACE)
        ax.axvspan(-sesoi, sesoi, color="#f0efec", zorder=0, label=f"|lift| < {sesoi:g} (not meaningful)")
        ax.axvline(0, color=MUTED, linewidth=1, zorder=1)
        for y, c in enumerate(cells):
            r = c["score_lift"][band]
            if r["estimate"] is None or r["ci_low"] is None:
                continue
            ax.plot([r["ci_low"], r["ci_high"]], [y, y], color=color[c["model"]], linewidth=2, solid_capstyle="round")
            ax.plot(r["estimate"], y, "o", color=color[c["model"]], markersize=7, markeredgecolor=SURFACE, markeredgewidth=1.5)
        ax.set_yticks(range(len(cells)))
        ax.set_yticklabels([f"{c['variant']}  ·  {c['model']}" + ("  ✱" if c.get("effect") else "") for c in cells], color=INK, fontsize=8)
        ax.invert_yaxis()
        ax.set_xlabel(f"Score lift vs CLEAN, points (95% CI, {band} fit bands)", color=INK_2)
        ax.set_title(f"Hidden-text effect on scores — extractor: {extractor}   (✱ = effect)", color=INK, loc="left", fontsize=10)
        ax.tick_params(axis="x", colors=MUTED)
        ax.tick_params(axis="y", length=0, labelcolor=INK_2)  # labels wear text ink, not muted
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.spines["bottom"].set_color(MUTED)
        ax.grid(axis="x", color="#e6e5e0", linewidth=0.8, zorder=0)
        ax.legend(loc="lower right", fontsize=8, frameon=False)
        fig.tight_layout()
        path = out / f"forest_{extractor}.png"
        fig.savefig(path, dpi=150)
        plt.close(fig)
        paths.append(path)
    return paths
