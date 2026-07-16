#!/usr/bin/env python3
"""Single source of truth for World Cup editions the platform knows about.

Used today by the history backfill tools (fixture discovery + scrape runner); the
dashboard builders adopt it in Phase B of ROADMAP.md (``--edition`` flag), with 2026
remaining the default so every current output path stays byte-identical.

Formats differ and the differences live HERE, not scattered in builders:
  * 2026: 48 teams, 12 groups A..L, knockout enters at the Round of 32, best
    third-placed teams advance (FIFA Annex C allocation).
  * 2018/2022: 32 teams, 8 groups A..H, knockout enters at the Round of 16,
    no best-thirds rule. 2018 group ties additionally break on fair-play points.

Raw historical match JSONs are NEVER committed (repo-size policy in ROADMAP.md):
``history/`` is git-ignored; raws travel as zipped GitHub Release / Actions
artifacts and only generated dashboard outputs are committed.
"""
from __future__ import annotations

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EDITIONS = {
    2026: {
        "name": "FIFA World Cup 2026",
        "match_dir": os.path.join(ROOT, "wc2026", "matches"),
        "out_dir": os.path.join(ROOT, "wc2026_dashboard"),           # today's paths, unchanged
        "groups": "ABCDEFGHIJKL",
        "ko_entry": "R32",
        "thirds": True,
        "fair_play_tiebreak": False,
        "date_range": ("2026-06-11", "2026-07-19"),
        "expected_matches": 104,
    },
    2022: {
        "name": "FIFA World Cup 2022 (Qatar)",
        "match_dir": os.path.join(ROOT, "history", "wc2022", "matches"),
        "out_dir": os.path.join(ROOT, "wc2026_dashboard", "editions", "2022"),
        "groups": "ABCDEFGH",
        "ko_entry": "R16",
        "thirds": False,
        "fair_play_tiebreak": False,
        "date_range": ("2022-11-20", "2022-12-18"),
        "expected_matches": 64,
        # Official group draw (FotMob team-name spellings). Historical raws carry only
        # the generic "Group Stage" stage string, and 2026's group source (the schedule
        # JSON) doesn't exist for history — so the draw itself is the group source.
        # Plain data, hand-checkable, same class of curated fact as app.js FIFA tables.
        "group_teams": {
            "A": ["Qatar", "Ecuador", "Senegal", "Netherlands"],
            "B": ["England", "Iran", "USA", "Wales"],
            "C": ["Argentina", "Saudi Arabia", "Mexico", "Poland"],
            "D": ["France", "Australia", "Denmark", "Tunisia"],
            "E": ["Spain", "Costa Rica", "Germany", "Japan"],
            "F": ["Belgium", "Canada", "Morocco", "Croatia"],
            "G": ["Brazil", "Serbia", "Switzerland", "Cameroon"],
            "H": ["Portugal", "Ghana", "Uruguay", "South Korea"],
        },
    },
    2018: {
        "name": "FIFA World Cup 2018 (Russia)",
        "match_dir": os.path.join(ROOT, "history", "wc2018", "matches"),
        "out_dir": os.path.join(ROOT, "wc2026_dashboard", "editions", "2018"),
        "groups": "ABCDEFGH",
        "ko_entry": "R16",
        "thirds": False,
        "fair_play_tiebreak": True,     # Japan over Senegal, Group H
        "date_range": ("2018-06-14", "2018-07-15"),
        "expected_matches": 64,
        "group_teams": {
            "A": ["Russia", "Saudi Arabia", "Egypt", "Uruguay"],
            "B": ["Portugal", "Spain", "Morocco", "Iran"],
            "C": ["France", "Australia", "Peru", "Denmark"],
            "D": ["Argentina", "Iceland", "Croatia", "Nigeria"],
            "E": ["Brazil", "Switzerland", "Costa Rica", "Serbia"],
            "F": ["Germany", "Mexico", "Sweden", "South Korea"],
            "G": ["Belgium", "Panama", "Tunisia", "England"],
            "H": ["Poland", "Senegal", "Colombia", "Japan"],
        },
    },
}


DEFAULT = 2026


def edition(year) -> dict:
    y = int(year)
    if y not in EDITIONS:
        raise SystemExit(f"Unknown edition {year!r} — known: {sorted(EDITIONS)}")
    return EDITIONS[y]


def add_edition_arg(parser):
    """Attach the shared ``--edition`` CLI flag (default 2026 = today's behavior)."""
    parser.add_argument("--edition", type=int, default=DEFAULT, choices=sorted(EDITIONS),
                        help="World Cup edition to build (default %(default)s)")
    return parser


def format_payload(year) -> dict:
    """The format flags a historical data.js embeds so the frontend renders the right
    tournament shape without hardcoding per-year rules client-side."""
    ed = edition(year)
    return {
        "groups": ed["groups"],
        "koEntry": ed["ko_entry"],
        "thirds": ed["thirds"],
        "fairPlay": ed["fair_play_tiebreak"],
        "name": ed["name"],
    }


def date_strings(year) -> list:
    """Every YYYYMMDD in the edition's window (FotMob's per-day matches feed)."""
    from datetime import date, timedelta
    a, b = (date.fromisoformat(d) for d in edition(year)["date_range"])
    out, d = [], a
    while d <= b:
        out.append(d.strftime("%Y%m%d"))
        d += timedelta(days=1)
    return out
