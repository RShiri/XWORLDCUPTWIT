#!/usr/bin/env python3
"""Bracket parity & sanity checks — the guardrail against mis-slotted knockout scrapes.

Born from two real incidents during the 2026 knockouts:
  * two quarter-final results were stored under swapped EF slot codes because the
    pipeline numbered the R16 by kickoff date while the dashboard used the official
    FIFA bracket order — Spain ended up in BOTH semi-finals;
  * the third-place fixture resolved the semi WINNERS instead of the losers, which
    would have scraped the final's teams into the bronze-match stub.

Stdlib-only, no pytest needed:  python3 tests/test_bracket_parity.py
Checks:
  1. R16_ORDER parity        — knockout_resolve.py and app.js pin the SAME bracket order.
  2. FIFA_THIRD_ALLOC parity — same allocation table on both sides.
  3. No team twice per round — a nation cannot appear in two ties of one KO round.
  4. Resolver vs stored      — resolve_fixture() agrees with every played KO file.
  5. Winner/Loser semantics  — final = semi winners, third place = semi losers.
  6. Schedule stubs exist    — every KO schedule id has a stub/result file to write into.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from wc2026 import knockout_resolve as KR  # noqa: E402

APP_JS = (ROOT / "wc2026_dashboard" / "app.js").read_text(encoding="utf-8")
FAILURES: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(("PASS  " if ok else "FAIL  ") + label + (("\n      " + detail) if (detail and not ok) else ""))
    if not ok:
        FAILURES.append(label)


# ── 1. R16_ORDER parity ────────────────────────────────────────────────────
def js_r16_order() -> list:
    m = re.search(r"var R16_ORDER = \[(.*?)\];", APP_JS, re.S)
    if not m:
        return []
    return re.findall(r'"([^"]+)"', m[1])


def test_r16_order() -> None:
    js = js_r16_order()
    py = list(KR.R16_ORDER)
    check(bool(js), "app.js R16_ORDER found")
    check(js == py, "R16_ORDER identical in knockout_resolve.py and app.js",
          f"py={py}\n      js={js}")


# ── 2. FIFA_THIRD_ALLOC parity ─────────────────────────────────────────────
def js_third_alloc() -> dict:
    m = re.search(r"var FIFA_THIRD_ALLOC = \{(.*?)\n  \};", APP_JS, re.S)
    if not m:
        return {}
    out: dict = {}
    for combo, body in re.findall(r'"([A-L]+)":\s*\{([^}]*)\}', m[1]):
        out[combo] = dict(re.findall(r'([A-L])\s*:\s*"([A-L])"', body))
    return out


def test_third_alloc() -> None:
    js = js_third_alloc()
    py = KR.FIFA_THIRD_ALLOC
    check(bool(js), "app.js FIFA_THIRD_ALLOC found")
    check(js == py, "FIFA_THIRD_ALLOC identical in knockout_resolve.py and app.js",
          f"py={py}\n      js={js}")


# ── 3–5. behavioural checks on the real data ───────────────────────────────
def test_rounds_and_resolution() -> None:
    ctx = KR.build_resolution_context()
    tree = ctx["tree"]

    # 3. no team appears in two different ties of the same knockout round
    for rd, matches in tree.rounds.items():
        seen: dict = {}
        dup = []
        for m in matches:
            if not m["played"]:
                continue
            for t in (m["home"], m["away"]):
                if t in seen and seen[t] != m["slot_id"]:
                    dup.append(f"{t} in both {seen[t]} and {m['slot_id']}")
                seen[t] = m["slot_id"]
        check(not dup, f"round {rd}: no team appears in two ties", "; ".join(dup))

    # 4. resolve_fixture agrees with every PLAYED knockout file
    sched = json.load(open(KR.SCHEDULE, encoding="utf-8"))
    bad = []
    missing = []
    for row in sched:
        if row.get("group") != "KO":
            continue
        fid = row["fotmob_id"]
        stub = ctx["by_id"].get(str(fid))
        if stub is None:
            missing.append(str(fid))          # → check 6
            continue
        if not stub["played"]:
            continue
        h, a, _ = KR.resolve_fixture(fid, ctx)
        if {h, a} != {stub["home"], stub["away"]}:
            bad.append(f"id {fid}: resolved ({h} v {a}) != stored ({stub['home']} v {stub['away']})")
    check(not bad, "resolve_fixture matches every played knockout result", "; ".join(bad))
    check(not missing, "every KO schedule id has a stub/result file", "missing: " + ", ".join(missing))

    # 5. final takes the semi WINNERS, third place the semi LOSERS
    fin = tree.rounds["F"][0] if tree.rounds["F"] else None
    tp = tree.rounds["TP"][0] if tree.rounds["TP"] else None
    if fin and fin.get("_kids"):
        for idx, sf in enumerate(fin["_kids"]):
            if sf is None or not sf["played"]:
                continue
            w, l = KR._winner_of(sf), KR._loser_of(sf)
            if w is None:
                continue
            hf, af, _ = KR.resolve_fixture(fin.get("match_id"), ctx)
            got = (hf, af)[idx]
            check(got == w, f"final side {idx} = winner of its semi",
                  f"expected {w}, resolver gave {got}")
            if tp is not None:
                ht, at, _ = KR.resolve_fixture(tp.get("match_id"), ctx)
                got_tp = (ht, at)[idx]
                check(got_tp == l, f"third-place side {idx} = LOSER of its semi",
                      f"expected {l}, resolver gave {got_tp} (winner is {w})")
        # decided sides of final and third place must never overlap
        hf, af, _ = KR.resolve_fixture(fin.get("match_id"), ctx)
        if tp is not None:
            ht, at, _ = KR.resolve_fixture(tp.get("match_id"), ctx)
            overlap = {t for t in (hf, af) if t} & {t for t in (ht, at) if t}
            check(not overlap, "no team in both the final and the third-place match",
                  f"overlap: {overlap}")


def main() -> int:
    test_r16_order()
    test_third_alloc()
    test_rounds_and_resolution()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) FAILED")
        return 1
    print("All bracket parity checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
