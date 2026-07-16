#!/usr/bin/env python3
"""Ground rule #1 of ROADMAP.md, executable: running every dashboard builder with NO
arguments must leave every tracked 2026 output byte-identical. This is the CI guard
that proves edition-aware builder changes cannot touch the live 2026 site.

    python tools/check_2026_identity.py

Snapshots the 2026 output tree, re-runs the builders exactly as the regen CI does
(``python build_*.py`` with no args), then compares:
  * data.js / database/manifest.js — identical except lines carrying the volatile
    '"generated"' build timestamp (same masking the regen workflow uses);
  * *.sqlite — compared as SQL dumps (byte layout varies across sqlite versions);
  * everything else — byte-identical.
Exits non-zero listing any real difference. Run before any PR that touches
wc2026_dashboard/build_*.py, editions.py or xg_model.py.
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASH = os.path.join(ROOT, "wc2026_dashboard")

BUILDERS = ["build_match_details.py", "build_data.py", "build_players.py",
            "build_shots.py", "build_database.py", "build_player_lab.py"]

# Everything the no-arg builders write for 2026 (single files + whole dirs).
OUTPUTS = ["data.js", "players.js", "shots.js",
           "matches_detail", "database", "player_lab", "share"]

TIMESTAMPED = {"data.js", os.path.join("database", "manifest.js")}


def _walk(base):
    """Relative paths of every file under the 2026 outputs."""
    out = []
    for o in OUTPUTS:
        p = os.path.join(base, o)
        if os.path.isfile(p):
            out.append(o)
        elif os.path.isdir(p):
            for d, _dirs, files in os.walk(p):
                for f in files:
                    out.append(os.path.relpath(os.path.join(d, f), base))
    return sorted(out)


def _mask_generated(data: bytes) -> bytes:
    return b"\n".join(ln for ln in data.split(b"\n") if b'"generated"' not in ln)


def _sqlite_dump(path: str) -> str:
    con = sqlite3.connect(path)
    try:
        return "\n".join(con.iterdump())
    finally:
        con.close()


def main() -> int:
    snap = tempfile.mkdtemp(prefix="wc2026_identity_")
    before = _walk(DASH)
    for rel in before:
        dst = os.path.join(snap, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(DASH, rel), dst)
    print(f"Snapshotted {len(before)} tracked 2026 output files.")

    for b in BUILDERS:
        print(f"$ python {b}")
        r = subprocess.run([sys.executable, os.path.join(DASH, b)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout)
            print(r.stderr)
            print(f"FAIL: {b} exited {r.returncode}")
            return 1

    after = _walk(DASH)
    bad = []
    for rel in sorted(set(before) | set(after)):
        old_p, new_p = os.path.join(snap, rel), os.path.join(DASH, rel)
        if not os.path.exists(old_p):
            bad.append(f"NEW file appeared: {rel}")
            continue
        if not os.path.exists(new_p):
            bad.append(f"file disappeared: {rel}")
            continue
        if rel.endswith(".sqlite"):
            if _sqlite_dump(old_p) != _sqlite_dump(new_p):
                bad.append(f"sqlite content changed: {rel}")
            continue
        old_b = open(old_p, "rb").read()
        new_b = open(new_p, "rb").read()
        if rel.replace("\\", "/") in {t.replace("\\", "/") for t in TIMESTAMPED}:
            old_b, new_b = _mask_generated(old_b), _mask_generated(new_b)
        if old_b != new_b:
            bad.append(f"content changed: {rel}")

    shutil.rmtree(snap, ignore_errors=True)
    if bad:
        print("\n2026 OUTPUTS ARE NOT BYTE-IDENTICAL AFTER A NO-ARG REBUILD:")
        for b in bad:
            print("  " + b)
        return 1
    print(f"\nOK — all {len(after)} tracked 2026 outputs byte-identical after rebuild.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
