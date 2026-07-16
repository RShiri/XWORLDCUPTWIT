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
        # WhoScored competition-page URLs for THIS edition (Season 8213) — the live
        # 2026 pipeline's default WC2026_WHOSCORED_URLS hardcodes 2026's own stage
        # ids, so a historical scrape needs its own override or every WhoScored
        # search 404s ("match ID not found") even though the match is on the site.
        # Found via whoscored.com's own season/stage picker; 2022's whole knockout
        # (R16→Final) lives on ONE combined "Final Stage" page, unlike 2018.
        #
        # ⚠️ /Fixtures/ vs /Show/ — NOT interchangeable, verified live in a real
        # browser: /Fixtures/ is a MONTH-PAGINATED calendar defaulting to the
        # latest month only. For the knockout page every tie is in December, so
        # the December default happens to show all 16 — fine. But group matchday 1
        # (Nov 20-25) and matchday 3 (Dec 1-2) straddle the month boundary for
        # groups E-H, so /Fixtures/ silently hid half a group's games (confirmed:
        # Group E's page showed only the 2 December games, dropping the 4 from
        # November — exactly the "match ID not found" failures from the first
        # backfill run, initially misread as Chrome-collision noise). /Show/ is
        # the stage-summary view and lists every match regardless of date —
        # use it for every GROUP page. The knockout page keeps /Fixtures/ (already
        # verified to list all 16 rounds there; /Show/ there only shows the last 4).
        "whoscored_urls": "|".join([
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/8213/Stages/18657/Fixtures/International-FIFA-World-Cup-2022",  # knockout: R16-QF-SF-3rd-F
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/8213/Stages/18649/Show/International-FIFA-World-Cup-2022",  # Group A
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/8213/Stages/18650/Show/International-FIFA-World-Cup-2022",  # Group B
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/8213/Stages/18651/Show/International-FIFA-World-Cup-2022",  # Group C
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/8213/Stages/18652/Show/International-FIFA-World-Cup-2022",  # Group D
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/8213/Stages/18653/Show/International-FIFA-World-Cup-2022",  # Group E
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/8213/Stages/18656/Show/International-FIFA-World-Cup-2022",  # Group F
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/8213/Stages/18655/Show/International-FIFA-World-Cup-2022",  # Group G
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/8213/Stages/18654/Show/International-FIFA-World-Cup-2022",  # Group H
        ]),
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
        # FotMob's OWN round label for a 2022 knockout match is USELESS: verified live
        # (fotmob_fetch_match_details) that every R16/QF/SF/3rd-place game reports the
        # identical generic leagueName "World Cup Final Stage", and the FINAL itself
        # reports just "World Cup" — no round word at all. 2022's whole knockout bracket
        # sits on ONE combined WhoScored page too (see whoscored_urls above), unlike
        # 2018 where FotMob gives each round a distinct, correctly-classifiable label
        # ("World Cup 1/8 Finals", "World Cup Quarter Finals", …) — so only 2022 needs
        # this override. The real 2022 schedule has a hard date gap between every round,
        # so a date range is an unambiguous, curated substitute (same class of hand-
        # checkable fact as group_teams). Labels match STAGE_LABEL in app.js exactly so
        # histRoundOf's substring checks (round of 16/quarter/semi/third/final) resolve
        # each one correctly. build_data.py applies this by match date, group stage
        # matches are untouched (FotMob's per-group label there is already specific).
        "ko_round_dates": [
            ("2022-12-03", "2022-12-06", "Round of 16"),
            ("2022-12-09", "2022-12-10", "Quarter-final"),
            ("2022-12-13", "2022-12-14", "Semi-final"),
            ("2022-12-17", "2022-12-17", "Third place"),
            ("2022-12-18", "2022-12-18", "Final"),
        ],
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
        # Same override as 2022 (see its comment) — 2018's knockout is FIVE separate
        # WhoScored stage pages (Season 5967), not one combined "Final Stage". Group
        # pages use /Show/ not /Fixtures/ for the same reason as 2022 (see its long
        # comment — /Fixtures/ is month-paginated and silently drops earlier
        # matchdays); 2018's group stage sits entirely within June so this mattered
        # less in practice, but /Show/ is the correct, always-complete choice.
        "whoscored_urls": "|".join([
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12759/Fixtures/International-FIFA-World-Cup-2018",  # 1/8-finals (R16)
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12760/Fixtures/International-FIFA-World-Cup-2018",  # Quarter-finals
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12761/Fixtures/International-FIFA-World-Cup-2018",  # Semi-finals
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12762/Fixtures/International-FIFA-World-Cup-2018",  # Bronze match
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12763/Fixtures/International-FIFA-World-Cup-2018",  # Final
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12751/Show/International-FIFA-World-Cup-2018",  # Group A
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12752/Show/International-FIFA-World-Cup-2018",  # Group B
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12753/Show/International-FIFA-World-Cup-2018",  # Group C
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12754/Show/International-FIFA-World-Cup-2018",  # Group D
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12755/Show/International-FIFA-World-Cup-2018",  # Group E
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12756/Show/International-FIFA-World-Cup-2018",  # Group F
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12757/Show/International-FIFA-World-Cup-2018",  # Group G
            "https://www.whoscored.com/Regions/247/Tournaments/36/Seasons/5967/Stages/12758/Show/International-FIFA-World-Cup-2018",  # Group H
        ]),
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


def resolve_stage(year, raw_stage, date):
    """Override a knockout match's raw stage label with the edition's curated
    ko_round_dates fact when the match's date falls in a known knockout window —
    see the long comment on 2022's ko_round_dates for why this exists (FotMob's own
    label is generic/wrong there). Group-stage matches (no date match, or an edition
    with no ko_round_dates at all) keep whatever label the raw file carries. Shared
    by build_data.py and build_match_details.py so data.js and matches_detail/<id>.js
    can never disagree on a match's round."""
    if int(year) == 2026 or not date:
        return raw_stage
    ed = edition(year)
    for start, end, label in ed.get("ko_round_dates", []):
        if start <= date <= end:
            return label
    return raw_stage


def date_strings(year) -> list:
    """Every YYYYMMDD in the edition's window (FotMob's per-day matches feed)."""
    from datetime import date, timedelta
    a, b = (date.fromisoformat(d) for d in edition(year)["date_range"])
    out, d = [], a
    while d <= b:
        out.append(d.strftime("%Y%m%d"))
        d += timedelta(days=1)
    return out
