"""
FIFA World Cup 2026 – Schedule module
Fetches the live WC2026 fixture list from FotMob and converts all kick-off times
to Israel Daylight Time (IDT = UTC+3).

Usage:
    from wc2026.schedule import get_upcoming_matches, print_todays_matches
    matches = get_upcoming_matches(hours_ahead=12)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

log = logging.getLogger(__name__)

# Israel Daylight Time = UTC+3 (summer, when WC is played)
IDT = timezone(timedelta(hours=3), name="IDT")

WC2026_FOTMOB_LEAGUE_ID = 77   # FotMob league ID for FIFA World Cup 2026

# ── Known group-stage schedule (partial, times in UTC) ────────────────────
# Used as fallback if FotMob API is unreachable.
# Format: (utc_datetime_str, home, away, venue, stage)
KNOWN_SCHEDULE_UTC: list[tuple[str, str, str, str, str]] = [
    # ── June 11 ──────────────────────────────────────────────────────────
    ("2026-06-11 19:00", "Mexico",       "South Africa", "Estadio Azteca, Mexico City",       "Group A"),
    ("2026-06-11 22:00", "South Korea",  "Czechia",      "MetLife Stadium, New York/NJ",       "Group B"),
    # ── June 12 ──────────────────────────────────────────────────────────
    ("2026-06-12 17:00", "Canada",       "Bosnia-Herzegovina", "BMO Field, Toronto",           "Group C"),
    ("2026-06-12 20:00", "USA",          "Paraguay",     "SoFi Stadium, Los Angeles",          "Group D"),
    ("2026-06-12 23:00", "Netherlands",  "Ukraine",      "Levi's Stadium, San Francisco",      "Group E"),
    # ── June 13 ──────────────────────────────────────────────────────────
    ("2026-06-13 17:00", "Qatar",        "Switzerland",  "AT&T Stadium, Dallas",               "Group F"),
    ("2026-06-13 20:00", "Brazil",       "Morocco",      "Rose Bowl, Los Angeles",             "Group G"),
    ("2026-06-13 23:00", "Scotland",     "Haiti",        "Empower Field, Denver",              "Group H"),
    # ── June 14 ──────────────────────────────────────────────────────────
    ("2026-06-14 18:00", "Australia",    "Nigeria",      "BC Place, Vancouver",                "Group I"),
    ("2026-06-14 21:00", "Germany",      "Spain",        "Hard Rock Stadium, Miami",           "Group J"),
    ("2026-06-15 00:00", "Japan",        "Portugal",     "Gillette Stadium, Boston",           "Group K"),
    # ── June 15 ──────────────────────────────────────────────────────────
    ("2026-06-15 17:00", "Belgium",      "Egypt",        "Estadio BBVA, Monterrey",            "Group H"),
    ("2026-06-15 20:00", "Iran",         "New Zealand",  "Lumen Field, Seattle",               "Group I"),
    ("2026-06-15 23:00", "Colombia",     "DR Congo",     "NRG Stadium, Houston",               "Group L"),
    # ── June 16 ──────────────────────────────────────────────────────────
    ("2026-06-16 20:00", "France",       "Senegal",      "MetLife Stadium, New York/NJ",       "Group I"),
    ("2026-06-16 23:00", "Iraq",         "Norway",       "Levi's Stadium, San Francisco",      "Group I"),
    ("2026-06-17 02:00", "Argentina",    "Algeria",      "AT&T Stadium, Dallas",               "Group J"),
    # ── June 17 ──────────────────────────────────────────────────────────
    ("2026-06-17 17:00", "England",      "Croatia",      "SoFi Stadium, Los Angeles",          "Group L"),
    ("2026-06-17 20:00", "Uruguay",      "Cape Verde",   "Estadio Akron, Guadalajara",         "Group H"),
    ("2026-06-17 23:00", "Portugal",     "DR Congo",     "Hard Rock Stadium, Miami",           "Group K"),
    # ── June 18 ──────────────────────────────────────────────────────────
    ("2026-06-18 17:00", "Austria",      "Jordan",       "Rose Bowl, Los Angeles",             "Group J"),
    ("2026-06-18 20:00", "Uzbekistan",   "Colombia",     "NRG Stadium, Houston",               "Group L"),
    ("2026-06-18 23:00", "Spain",        "Qatar",        "Arrowhead Stadium, Kansas City",     "Group F"),
    # ── June 19 ──────────────────────────────────────────────────────────
    ("2026-06-19 17:00", "Switzerland",  "Germany",      "Gillette Stadium, Boston",           "Group F"),
    ("2026-06-19 20:00", "Mexico",       "Ghana",        "Estadio Azteca, Mexico City",        "Group A"),
    ("2026-06-19 23:00", "South Korea",  "Canada",       "BMO Field, Toronto",                 "Group B"),
    # ── June 20 ──────────────────────────────────────────────────────────
    ("2026-06-20 17:00", "USA",          "Morocco",      "Empower Field, Denver",              "Group D"),
    ("2026-06-20 20:00", "Netherlands",  "Brazil",       "BC Place, Vancouver",                "Group E"),
    ("2026-06-20 23:00", "Scotland",     "Australia",    "Lumen Field, Seattle",               "Group B"),
    # ── June 21 ──────────────────────────────────────────────────────────
    ("2026-06-21 17:00", "South Africa", "Czechia",      "MetLife Stadium, New York/NJ",       "Group A"),
    ("2026-06-21 20:00", "Haiti",        "Belgium",      "Levi's Stadium, San Francisco",      "Group H"),
    ("2026-06-21 23:00", "Nigeria",      "New Zealand",  "SoFi Stadium, Los Angeles",          "Group I"),
    # ── June 22 ──────────────────────────────────────────────────────────
    ("2026-06-22 17:00", "Bosnia-Herzegovina", "South Korea", "AT&T Stadium, Dallas",          "Group B"),
    ("2026-06-22 20:00", "Paraguay",     "Netherlands",  "Hard Rock Stadium, Miami",           "Group E"),
    ("2026-06-22 23:00", "Ukraine",      "USA",          "Rose Bowl, Los Angeles",             "Group D"),
    # ── June 23 ──────────────────────────────────────────────────────────
    ("2026-06-23 17:00", "Iran",         "Australia",    "Gillette Stadium, Boston",           "Group C"),
    ("2026-06-23 20:00", "DR Congo",     "Algeria",      "NRG Stadium, Houston",               "Group J"),
    ("2026-06-23 23:00", "Ghana",        "South Africa", "Estadio Akron, Guadalajara",         "Group A"),
    # ── June 24 ──────────────────────────────────────────────────────────
    ("2026-06-24 17:00", "Canada",       "Haiti",        "BMO Field, Toronto",                 "Group C"),
    ("2026-06-24 20:00", "Japan",        "Colombia",     "Arrowhead Stadium, Kansas City",     "Group K"),
    ("2026-06-24 23:00", "Norway",       "Senegal",      "BC Place, Vancouver",                "Group I"),
    # ── June 25 ──────────────────────────────────────────────────────────
    ("2026-06-25 17:00", "Portugal",     "Uzbekistan",   "Lumen Field, Seattle",               "Group K"),
    ("2026-06-25 20:00", "England",      "Panama",       "Empower Field, Denver",              "Group L"),
    ("2026-06-25 23:00", "Argentina",    "Jordan",       "AT&T Stadium, Dallas",               "Group J"),
    # ── June 26 ──────────────────────────────────────────────────────────
    ("2026-06-26 20:00", "Norway",       "France",       "Gillette Stadium, Boston",           "Group I"),
    ("2026-06-26 20:00", "Senegal",      "Iraq",         "BMO Field, Toronto",                 "Group I"),
    ("2026-06-27 01:00", "Cape Verde",   "Saudi Arabia", "NRG Stadium, Houston",               "Group H"),
    ("2026-06-27 01:00", "Uruguay",      "Spain",        "Estadio Akron, Guadalajara",         "Group H"),
    ("2026-06-27 04:00", "Egypt",        "Iran",         "Lumen Field, Seattle",               "Group G"),
    ("2026-06-27 04:00", "New Zealand",  "Belgium",      "BC Place, Vancouver",                "Group H"),
    # ── June 27 ──────────────────────────────────────────────────────────
    ("2026-06-27 22:00", "Panama",       "England",      "MetLife Stadium, New York/NJ",       "Group L"),
    ("2026-06-27 22:00", "Croatia",      "Ghana",        "Lincoln Financial Field, Philadelphia", "Group L"),
    ("2026-06-28 00:30", "Colombia",     "Portugal",     "Hard Rock Stadium, Miami",           "Group K"),
    ("2026-06-28 00:30", "DR Congo",     "Uzbekistan",   "Mercedes-Benz Stadium, Atlanta",     "Group K"),
    ("2026-06-28 03:00", "Algeria",      "Austria",      "Arrowhead Stadium, Kansas City",     "Group J"),
    ("2026-06-28 03:00", "Jordan",       "Argentina",    "AT&T Stadium, Dallas",               "Group J"),
    # ── Round of 32 (June 28 – July 3) ──────────────────────────────────
    ("2026-06-28 17:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-06-28 21:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-06-29 01:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-06-29 17:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-06-29 21:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-06-30 01:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-06-30 06:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-06-30 17:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-06-30 21:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-07-01 01:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-07-01 05:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-07-01 17:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-07-01 21:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-07-02 01:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-07-02 20:00", "TBD",  "TBD", "TBD", "Round of 32"),
    ("2026-07-03 00:00", "TBD",  "TBD", "TBD", "Round of 32"),
    # ── Round of 16 (July 4-7) ───────────────────────────────────────────
    ("2026-07-04 19:00", "TBD",  "TBD", "TBD", "Round of 16"),
    ("2026-07-04 23:00", "TBD",  "TBD", "TBD", "Round of 16"),
    ("2026-07-05 19:00", "TBD",  "TBD", "TBD", "Round of 16"),
    ("2026-07-05 23:00", "TBD",  "TBD", "TBD", "Round of 16"),
    ("2026-07-06 19:00", "TBD",  "TBD", "TBD", "Round of 16"),
    ("2026-07-06 23:00", "TBD",  "TBD", "TBD", "Round of 16"),
    ("2026-07-07 19:00", "TBD",  "TBD", "TBD", "Round of 16"),
    ("2026-07-07 23:00", "TBD",  "TBD", "TBD", "Round of 16"),
    # ── Quarterfinals (July 9-11) ────────────────────────────────────────
    ("2026-07-09 23:00", "TBD",  "TBD", "TBD", "Quarterfinal"),
    ("2026-07-10 23:00", "TBD",  "TBD", "TBD", "Quarterfinal"),
    ("2026-07-11 19:00", "TBD",  "TBD", "TBD", "Quarterfinal"),
    ("2026-07-11 23:00", "TBD",  "TBD", "TBD", "Quarterfinal"),
    # ── Semifinals (July 14-15) ──────────────────────────────────────────
    ("2026-07-14 23:00", "TBD",  "TBD", "TBD", "Semifinal"),
    ("2026-07-15 23:00", "TBD",  "TBD", "TBD", "Semifinal"),
    # ── Bronze medal & Final ─────────────────────────────────────────────
    ("2026-07-18 23:00", "TBD",  "TBD", "TBD", "Third Place"),
    ("2026-07-19 23:00", "TBD",  "TBD", "TBD", "Final"),
]


def _utc_to_idt(utc_dt: datetime) -> datetime:
    """Convert an aware UTC datetime to IDT (UTC+3)."""
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=timezone.utc)
    return utc_dt.astimezone(IDT)


def get_schedule_from_fotmob() -> list[dict]:
    """
    Fetch upcoming WC2026 matches from FotMob API.
    Returns list of match dicts with UTC and IDT times.
    """
    try:
        import cloudscraper
        scraper = cloudscraper.create_scraper()
        url = f"https://www.fotmob.com/api/leagues?id={WC2026_FOTMOB_LEAGUE_ID}&ccode3=INT"
        resp = scraper.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        log.warning("FotMob schedule fetch failed: %s", exc)
        return []

    matches = []
    for section in data.get("matches", {}).get("allMatches", []):
        try:
            utc_str  = section.get("status", {}).get("utcTime", "")
            if not utc_str:
                continue
            utc_dt   = datetime.fromisoformat(utc_str.replace("Z", "+00:00"))
            idt_dt   = _utc_to_idt(utc_dt)
            home     = section.get("home", {}).get("name", "?")
            away     = section.get("away", {}).get("name", "?")
            match_id = section.get("id")
            stage    = section.get("roundName", "")
            matches.append({
                "fotmob_id":   match_id,
                "home":        home,
                "away":        away,
                "stage":       stage,
                "utc":         utc_dt,
                "idt":         idt_dt,
                "idt_str":     idt_dt.strftime("%Y-%m-%d %H:%M IDT"),
                "status":      section.get("status", {}).get("scoreStr", ""),
                "finished":    section.get("status", {}).get("finished", False),
            })
        except Exception:
            continue

    log.info("FotMob: fetched %d WC2026 matches", len(matches))
    return matches


def get_schedule_from_fallback() -> list[dict]:
    """Build schedule from embedded KNOWN_SCHEDULE_UTC list."""
    matches = []
    for row in KNOWN_SCHEDULE_UTC:
        utc_str, home, away, venue, stage = row
        utc_dt = datetime.strptime(utc_str, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        idt_dt = _utc_to_idt(utc_dt)
        matches.append({
            "fotmob_id": None,
            "home":      home,
            "away":      away,
            "venue":     venue,
            "stage":     stage,
            "utc":       utc_dt,
            "idt":       idt_dt,
            "idt_str":   idt_dt.strftime("%Y-%m-%d %H:%M IDT"),
            "status":    "",
            "finished":  False,
        })
    return matches


def get_upcoming_matches(hours_ahead: float = 24) -> list[dict]:
    """
    Return WC2026 matches kicking off within the next `hours_ahead` hours
    (relative to now UTC). Prefers live FotMob data; falls back to embedded list.
    Matches that are already finished are excluded.
    """
    now = datetime.now(tz=timezone.utc)
    cutoff = now + timedelta(hours=hours_ahead)

    matches = get_schedule_from_fotmob() or get_schedule_from_fallback()
    upcoming = [
        m for m in matches
        if not m.get("finished") and now <= m["utc"] <= cutoff
    ]
    upcoming.sort(key=lambda m: m["utc"])
    return upcoming


def get_todays_matches() -> list[dict]:
    """Return all WC2026 matches whose IDT date is today (Israel date)."""
    today_idt = datetime.now(tz=IDT).date()
    matches   = get_schedule_from_fotmob() or get_schedule_from_fallback()
    return [m for m in matches if m["idt"].date() == today_idt]


def seconds_until_scrape(match: dict, scrape_after_minutes: int = 100) -> float:
    """
    Return seconds until the optimal scrape time for a match
    (kick-off + scrape_after_minutes, to allow the match to finish + stats settle).
    Negative value means the window has already passed.
    """
    target = match["utc"] + timedelta(minutes=scrape_after_minutes)
    return (target - datetime.now(tz=timezone.utc)).total_seconds()


def print_schedule(matches: Optional[list[dict]] = None, *, source: str = "auto") -> None:
    """Pretty-print the WC2026 schedule in IDT."""
    if matches is None:
        if source == "fotmob":
            matches = get_schedule_from_fotmob()
        elif source == "fallback":
            matches = get_schedule_from_fallback()
        else:
            matches = get_schedule_from_fotmob() or get_schedule_from_fallback()

    print(f"\n{'─'*72}")
    print(f"  FIFA World Cup 2026 – Schedule (Israel Daylight Time UTC+3)")
    print(f"{'─'*72}")
    prev_date = None
    for m in matches:
        d = m["idt"].date()
        if d != prev_date:
            print(f"\n  📅  {d.strftime('%A, %d %B %Y')}")
            prev_date = d
        time_str = m["idt"].strftime("%H:%M")
        home, away = m["home"], m["away"]
        stage = m.get("stage", "")
        status = m.get("status") or ""
        fid = m.get("fotmob_id") or "—"
        print(f"    {time_str} IDT  {home:25s} vs {away:25s}  [{stage}]  id={fid}  {status}")
    print(f"\n{'─'*72}\n")


if __name__ == "__main__":
    print_schedule()
