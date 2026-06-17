"""
Download flag PNG images for all 48 FIFA World Cup 2026 nations.
Source: flagcdn.com (free, no auth required)
Output: team_logos/wc2026/<Team Name>.png

Usage:
    python wc2026/download_badges.py
"""

from __future__ import annotations

import os
import time
import urllib.request
from pathlib import Path

# ── Output directory ───────────────────────────────────────────────────────
OUT_DIR = Path(__file__).resolve().parents[1] / "team_logos" / "wc2026"

# ── 48 WC2026 nations: (display_name, iso_alpha2) ─────────────────────────
# ISO 3166-1 alpha-2 codes used by flagcdn.com
# Sub-national codes (Scotland/England) use the CLDR subdivision format.
WC2026_NATIONS: list[tuple[str, str]] = [
    # Group A
    ("Mexico",              "mx"),
    ("South Africa",        "za"),
    ("Czechia",             "cz"),
    ("Ghana",               "gh"),
    # Group B
    ("South Korea",         "kr"),
    ("Canada",              "ca"),
    ("Bosnia-Herzegovina",  "ba"),
    ("Scotland",            "gb-sct"),
    # Group C
    ("Bolivia",             "bo"),
    ("Australia",           "au"),
    ("Nigeria",             "ng"),
    ("Iran",                "ir"),
    # Group D
    ("USA",                 "us"),
    ("Morocco",             "ma"),
    ("Ukraine",             "ua"),
    ("Paraguay",            "py"),
    # Group E
    ("Brazil",              "br"),
    ("Netherlands",         "nl"),
    ("Croatia",             "hr"),
    ("Panama",              "pa"),
    # Group F
    ("Germany",             "de"),
    ("Spain",               "es"),
    ("Switzerland",         "ch"),
    ("Qatar",               "qa"),
    # Group G
    ("France",              "fr"),
    ("Senegal",             "sn"),
    ("Iraq",                "iq"),
    ("Norway",              "no"),
    # Group H
    ("Belgium",             "be"),
    ("Egypt",               "eg"),
    ("Scotland",            "gb-sct"),   # duplicate handled
    ("Uruguay",             "uy"),
    ("Cape Verde",          "cv"),
    ("Saudi Arabia",        "sa"),
    ("Haiti",               "ht"),
    # Group I
    ("New Zealand",         "nz"),
    ("Japan",               "jp"),
    # Group J
    ("Argentina",           "ar"),
    ("Algeria",             "dz"),
    ("Austria",             "at"),
    ("Jordan",              "jo"),
    # Group K
    ("Portugal",            "pt"),
    ("Colombia",            "co"),
    ("Uzbekistan",          "uz"),
    ("DR Congo",            "cd"),
    # Group L
    ("England",             "gb-eng"),
    ("Panama",              "pa"),
    ("Ghana",               "gh"),
]

# De-duplicate while preserving order
seen: set[str] = set()
UNIQUE_NATIONS: list[tuple[str, str]] = []
for name, iso in WC2026_NATIONS:
    if name not in seen:
        seen.add(name)
        UNIQUE_NATIONS.append((name, iso))

# ── Downloader ─────────────────────────────────────────────────────────────

# HatScripts circle-flags on GitHub Pages (SVG, accessible from most environments)
HATSCRIPTS_URL = "https://raw.githubusercontent.com/HatScripts/circle-flags/gh-pages/flags/{code}.svg"

# Manual overrides for non-standard codes in the HatScripts repo
HATSCRIPTS_OVERRIDES: dict[str, str] = {
    "gb-sct": "gb-sct",   # Scotland
    "gb-eng": "gb-eng",   # England
    "ba":     "ba",
    "cd":     "cd",       # DR Congo
    "cv":     "cv",       # Cape Verde
}


def _svg_to_png(svg_bytes: bytes, size: int = 160) -> bytes:
    """Convert SVG bytes → PNG bytes via cairosvg."""
    try:
        import cairosvg
        return cairosvg.svg2png(bytestring=svg_bytes,
                                output_width=size, output_height=size)
    except ImportError:
        raise RuntimeError("cairosvg not installed – run: pip install cairosvg")


def download_flag(name: str, iso: str, out_dir: Path) -> bool:
    dest = out_dir / f"{name}.png"
    if dest.exists():
        print(f"  [skip] {name} (already downloaded)")
        return True

    code = HATSCRIPTS_OVERRIDES.get(iso.lower(), iso.lower())
    url  = HATSCRIPTS_URL.format(code=code)
    try:
        req  = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0 WC2026-Badge-Downloader/1.0"})
        svg  = urllib.request.urlopen(req, timeout=15).read()
        png  = _svg_to_png(svg)
        dest.write_bytes(png)
        print(f"  [ok]   {name} ({iso}) → {dest.name}")
        return True
    except Exception as exc:
        print(f"  [FAIL] {name} ({iso}): {exc}")
        return False


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {len(UNIQUE_NATIONS)} WC2026 nation flags → {OUT_DIR}\n")
    ok = fail = 0
    for name, iso in UNIQUE_NATIONS:
        success = download_flag(name, iso, OUT_DIR)
        if success:
            ok += 1
        else:
            fail += 1
        time.sleep(0.15)   # be polite to flagcdn.com

    print(f"\nDone: {ok} downloaded, {fail} failed.")
    if fail:
        print("Re-run to retry failed downloads (existing files are skipped).")


if __name__ == "__main__":
    main()
