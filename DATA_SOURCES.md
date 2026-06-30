# Data sourcing policy — READ THIS (owner requirement)

> **Owner's requirement (do not "simplify" away):**
> Every match must be scraped from **all three** sources — **FotMob, WhoScored, and
> SofaScore** — and, wherever they report the **same metric**, the published value
> must be the **average of the sources that returned it**. The averaged, multi-source
> figure is the "ultimate" data the PNG infographics and the web dashboard should show.
> One source is a fallback, not the goal: the goal is all three, averaged.

This is the target design. Part of it is built; part is still TODO (see below). Future
sessions: move toward this, don't regress it.

## Why average (the intent)
No single feed is fully reliable: FotMob's `matchDetails` is gated behind a rotating
`x-mas` token, WhoScored is a flaky Selenium scrape, SofaScore is open but occasionally
disagrees on xG/possession. Averaging the sources that responded gives a robust, less
source-biased number and survives any one feed being down.

## The three sources (what each is good for)
- **WhoScored** (`whoscored.com`, Selenium) — the **event stream**: shots, passes,
  dribbles, goals, saves, lineups, coordinates. Richest spatial data; drives the shot/
  pass/dribble maps and the All-Goals-Map. Code: `whoscored_fetch_match`,
  `whoscored_search_match_id` (searches the **knockout stage 23752** *and* group stage
  25505 — `WC2026_WHOSCORED_URLS`).
- **FotMob** — match **stats/xG/venue/lineups** via `www.fotmob.com/api/matchDetails`
  (**needs `x-mas`**: set `FOTMOB_XMAS_TOKEN` or `FOTMOB_TOKEN_URL` in `.env`), plus the
  open fixtures XML (`api.fotmob.com/matches?date=`) used for names/dates/real-id lookup.
  Code: `fotmob_fetch_match_details`, `fotmob_fetch_wc_matches`,
  `knockout_resolve.find_fotmob_id_by_teams`.
- **SofaScore** (`api.sofascore.com`, **no token**) — match **stats/xG/lineups/venue**.
  The reliable second stats source. Code: `sofascore_fetch_match_details` (returns a
  FotMob-shaped dict so the existing `_parse_fotmob_*` parsers consume it).

## Current state vs target
**Current (as of this writing):** the stats slot is **first-available, NOT averaged** —
`fetch_and_save` uses FotMob `matchDetails` if the token works, else falls
back to SofaScore; WhoScored always provides the event stream. `_sources` records which
feeds actually landed (e.g. `["sofascore","whoscored"]`).

**Target (TODO — the owner requirement):**
1. **Fetch all three every match**, independently, and don't stop at the first success.
2. **Average the overlapping numeric `match_stats`** across the sources that returned a
   value: xG, possession, total shots, shots on target, big chances, saves, fouls,
   passes, accurate passes, pass accuracy. Average = mean of the present values
   (1, 2, or 3 of them). Keep a count so a 1-source stat isn't mistaken for a 3-source one.
3. **Provenance:** store each source's raw values alongside the average so it's auditable
   — e.g. `match_stats[k] = {home, away, _by_source: {fotmob:.., sofascore:.., whoscored:..}, _n: <count>}`.
   Keep `_sources` as the list of feeds that contributed.

## What must NOT be averaged
- **Score / goals** — never average; take the consensus / authoritative result
  (WhoScored event stream is canonical for goals; cross-check the others, don't mean them).
- **Event coordinates, shot maps, pass/dribble geometry** — keep **WhoScored** as the
  single geometric source (the renderer/`xg_model.py` orientation is tuned to it).
  FotMob/SofaScore shot coords use different frames; mixing them corrupts the maps.
- **Lineups** — reconcile (union/prefer the most complete), don't numerically average.

## Cross-source matching (already available)
Team names differ across feeds (Türkiye/Turkey, Côte d'Ivoire/Ivory Coast, South Korea/
Korea Republic, USA/United States, IR Iran/Iran, DR Congo, Czechia, …). Use the
alias/accent-folding key `knockout_resolve._team_key` to line up the same match/team
across FotMob, WhoScored, and SofaScore before merging.

## Keep PNG and website in sync
`renderer.py` (PNGs) and `wc2026_dashboard/xg_model.py` + the `build_*` builders must use
the **same** merged/averaged numbers, or the infographics and the live site will disagree.
If you change the merge/average logic, mirror it on both paths (see CLAUDE.md note on
`xg_model.py` being copied verbatim from `renderer.py`).

## Acceptance criteria ("done")
- Each published `wc2026/matches/<id>.json` was attempted against **all three** feeds.
- Overlapping numeric `match_stats` are **means of the sources present**, with per-source
  provenance recorded and `_sources` listing every feed that contributed.
- Score/goals/maps remain single-source (WhoScored) and uncorrupted.
- PNG and dashboard show the identical averaged figures.
