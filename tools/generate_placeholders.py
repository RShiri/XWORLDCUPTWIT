"""
Generate proper shield-crest badges for all 48 WC2026 nations.
Each crest uses national primary/secondary colours with a shield outline,
country abbreviation, and a subtle stripe pattern.

Run:  python wc2026/generate_placeholders.py
      (or call make_all_badges() from code)

Place real PNG badges (any size) in team_logos/wc2026/<Team Name>.png
to override the generated ones.
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.path as mpath
import numpy as np

_REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO))

from wc2026.team_colors import get_team_colors

OUT_DIR = _REPO / "team_logos" / "wc2026"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# 3-letter abbreviations used on the crest
ABBREVS: dict[str, str] = {
    "Mexico":              "MEX", "South Africa":      "RSA", "Czechia":           "CZE",
    "Ghana":               "GHA", "South Korea":       "KOR", "Canada":            "CAN",
    "Bosnia-Herzegovina":  "BIH", "Scotland":          "SCO", "Bolivia":           "BOL",
    "Australia":           "AUS", "Nigeria":           "NGA", "Iran":              "IRN",
    "USA":                 "USA", "Morocco":           "MAR", "Ukraine":           "UKR",
    "Paraguay":            "PAR", "Brazil":            "BRA", "Netherlands":       "NED",
    "Croatia":             "CRO", "Panama":            "PAN", "Germany":           "GER",
    "Spain":               "ESP", "Switzerland":       "SUI", "Qatar":             "QAT",
    "France":              "FRA", "Senegal":           "SEN", "Iraq":              "IRQ",
    "Norway":              "NOR", "Belgium":           "BEL", "Egypt":             "EGY",
    "Uruguay":             "URU", "Cape Verde":        "CPV", "Saudi Arabia":      "KSA",
    "Haiti":               "HAI", "New Zealand":       "NZL", "Japan":             "JPN",
    "Argentina":           "ARG", "Algeria":           "ALG", "Austria":           "AUT",
    "Jordan":              "JOR", "Portugal":          "POR", "Colombia":          "COL",
    "Uzbekistan":          "UZB", "DR Congo":          "COD", "England":           "ENG",
}

# Teams that have won the World Cup (gold star on crest)
WC_WINNERS = {"Brazil", "Germany", "France", "Argentina", "Uruguay",
              "Spain", "England", "Italy"}


def _hex_to_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))  # type: ignore


def _lum(h: str) -> float:
    r, g, b = _hex_to_rgb(h)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _shield_path() -> mpath.Path:
    """
    Shield / heraldic crest outline.
    Normalised: x in [0,1], y in [0,1]. Tip at (0.5, 0).
    """
    verts = np.array([
        [0.08, 1.00],  # top-left
        [0.92, 1.00],  # top-right
        [0.92, 0.42],  # right shoulder
        [0.50, 0.00],  # bottom tip
        [0.08, 0.42],  # left shoulder
        [0.08, 1.00],  # close
    ])
    codes = [
        mpath.Path.MOVETO,
        mpath.Path.LINETO,
        mpath.Path.CURVE3,   # smooth right shoulder
        mpath.Path.LINETO,
        mpath.Path.CURVE3,   # smooth left shoulder
        mpath.Path.CLOSEPOLY,
    ]
    # Fix: CURVE3 needs pairs; use LINETO for all for simplicity
    codes = [mpath.Path.MOVETO] + [mpath.Path.LINETO] * 4 + [mpath.Path.CLOSEPOLY]
    return mpath.Path(verts, codes)


def make_badge(name: str, force: bool = False) -> None:
    dest = OUT_DIR / f"{name}.png"
    if dest.exists() and not force:
        return

    colors  = get_team_colors(name, fallback_home=True)
    primary = colors["primary"]
    sec     = colors.get("secondary", "#ffffff")
    abbr    = ABBREVS.get(name, name[:3].upper())
    won_wc  = name in WC_WINNERS

    # Canvas: square 200×200
    DPI = 100
    fig = plt.figure(figsize=(2.0, 2.0), dpi=DPI)
    fig.patch.set_alpha(0.0)   # transparent figure background
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.set_facecolor("none")

    # ── Shield fill ────────────────────────────────────────────────
    shield_verts = np.array([
        [0.10, 0.97],
        [0.90, 0.97],
        [0.90, 0.38],
        [0.50, 0.03],
        [0.10, 0.38],
        [0.10, 0.97],
    ])
    shield_codes = ([mpath.Path.MOVETO]
                    + [mpath.Path.LINETO] * 4
                    + [mpath.Path.CLOSEPOLY])
    shield = mpath.Path(shield_verts, shield_codes)

    # Primary fill
    ax.add_patch(mpatches.PathPatch(
        shield, facecolor=primary, edgecolor="none", zorder=1))

    # Secondary colour stripe (bottom third of shield)
    # Clip the stripe to the shield using a clipping patch
    stripe_verts = np.array([
        [0.10, 0.50],
        [0.90, 0.50],
        [0.90, 0.38],
        [0.50, 0.03],
        [0.10, 0.38],
        [0.10, 0.50],
    ])
    stripe_codes = ([mpath.Path.MOVETO]
                    + [mpath.Path.LINETO] * 4
                    + [mpath.Path.CLOSEPOLY])
    ax.add_patch(mpatches.PathPatch(
        mpath.Path(stripe_verts, stripe_codes),
        facecolor=sec, edgecolor="none", zorder=2))

    # Shield outline
    outline_color = "#ffffff" if _lum(primary) < 0.25 else "#222222"
    ax.add_patch(mpatches.PathPatch(
        shield, facecolor="none",
        edgecolor=outline_color, linewidth=2.5, zorder=5))

    # ── Gold star (world cup winner) ───────────────────────────────
    if won_wc:
        ax.text(0.50, 0.90, "★", ha="center", va="center",
                fontsize=13, color="#FFD700", zorder=6,
                fontweight="bold")

    # ── Country abbreviation ───────────────────────────────────────
    txt_color = "#ffffff" if _lum(primary) < 0.45 else "#111111"
    ax.text(0.50, 0.60, abbr,
            ha="center", va="center",
            fontsize=20, fontweight="bold",
            color=txt_color, zorder=6)

    # ── Save transparent PNG ───────────────────────────────────────
    plt.savefig(dest, dpi=DPI, transparent=True,
                bbox_inches="tight", pad_inches=0)
    plt.close(fig)


def make_all_badges(force: bool = False) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name in ABBREVS:
        make_badge(name, force=force)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true",
                        help="Overwrite existing badge files")
    args = parser.parse_args()

    teams = list(ABBREVS.keys())
    print(f"Generating {len(teams)} shield crests → {OUT_DIR}\n")
    for t in teams:
        make_badge(t, force=args.force)
        print(f"  ✓ {t}")
    print(f"\nDone. Drop real PNG files in {OUT_DIR}/ to override.")
