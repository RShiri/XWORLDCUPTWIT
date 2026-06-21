# FIFA World Cup 2026 – Match Analytics Pipeline

Automated end-to-end pipeline that pulls match data from **two sources** (FotMob for aggregate stats, WhoScored for player events and ratings), renders high-resolution infographics (≈5920 × 3433 px), pushes them to GitHub, and sends WhatsApp alerts.

---

## Architecture

```
FotMob API  ──────────────────────────────────────────────┐
  (xG, possession, shots, fouls, saves, big chances)       │
                                                           ▼
                                              build_match_json()
WhoScored (Selenium/UC)  ──────────────────────────────────┤
  (player lineups, ratings, pass events, shot events)      │
                                                           ▼
                                          wc2026/matches/YYYY_MM_DD_Team_vs_Team.json
                                                           │
                                                           ▼
                                              renderer.py → output/*.png
                                                           │
                                          ┌────────────────┴──────────────────┐
                                          ▼                                   ▼
                                  git push (WorldCup2026/)          WhatsApp alert
```

### Data sources

| Source | What it provides | How accessed |
|--------|-----------------|--------------|
| **FotMob** | xG, possession %, shots on/off target, big chances, pass accuracy, duels won, saves, fouls, yellow/red cards | Undocumented JSON API (`https://www.fotmob.com/api/matchDetails?matchId=…`) |
| **WhoScored** | Starting XI + subs with shirt numbers, player ratings (0–10), full event stream (passes, shots, dribbles, interceptions) for pass networks and shot maps | Selenium with `undetected_chromedriver` (version_main=149); extracts `matchCentreData:` JSON embedded in the page source |

---

## Infographic Layout

The dashboard is a **≈5920 × 3433 px** canvas (30" × 17" at 200 dpi) with three rows:

```
┌──────────────────────────────────────────────────────────────────┐
│  HEADER — team crests, score, stage, stadium, date               │
├────────────┬──────────────┬──────────────┬──────────────┬────────┤
│  Home      │  Home Pass   │   Stats      │  Away Pass   │  Away  │
│  Lineup    │  Network     │   Table      │  Network     │ Lineup │
│  + Ratings │              │  (9 metrics) │              │+Ratings│
├──────────────────┬───────────────────────┬──────────────────────┤
│  Home Shot Map   │  Final Third Entries  │  Away Shot Map       │
└──────────────────┴───────────────────────┴──────────────────────┘
```

**Lineup panels** show the starting XI sorted by position then shirt number, with per-player WhoScored rating badges color-coded:
- `>=7.5` → bright green
- `>=6.5` → yellow-green
- `>=6.0` → neutral grey
- `<6.0` → orange-red
- Rating column hidden entirely when no WhoScored data is available (no placeholder dashes).

Each row also shows, derived from the event stream (`_lineup_extras()`):
- a goal ball **`●`** per goal scored (one per goal; own goals excluded) and an **`A`** per assist (`IntentionalGoalAssist` qualifier), drawn beside the rating;
- a red **`↓<min>'`** exit marker on any starter that was substituted off.

Below the XI a **SUBS** block lists only the substitutes that actually came on, each with their rating and **who they replaced + when** — `for <Surname> <min>'` (from the sub's `subbedOutPlayerId` and the `SubstitutionOn` minute). `⚽` (U+26BD) is **not** in DejaVu Sans, so a filled circle `●` is used for the goal marker.

**Stats table** shows 9 metrics side-by-side with zebra-stripe rows and bar overlays proportional to each team's share.

---

## Match JSON Schema

Each cached match lives at `wc2026/matches/YYYY_MM_DD_Home_vs_Away.json`:

```jsonc
{
  "match_id": 4670000,          // FotMob match ID
  "date": "2026-06-17",
  "stage": "Group A",
  "stadium": "SoFi Stadium",
  "city": "Inglewood",
  "home": {
    "name": "Portugal",
    "teamId": 12345,             // WhoScored team ID
    "scores": { "fulltime": 2 },
    "players": [                 // from WhoScored
      {
        "playerId": 99,
        "name": "Cristiano Ronaldo",
        "shirtNo": 7,
        "isFirstEleven": true,
        "stats": {
          "ratings": { "0": 8.2 }  // keyed by minute string
        }
      }
    ]
  },
  "away": { /* same structure */ },
  "events": [ /* WhoScored event stream: passes, shots, dribbles… */ ],
  "match_stats": {              // from FotMob
    "xg": [1.4, 0.6],
    "possession": [58, 42],
    "shots_on_target": [5, 2],
    "big_chances": [3, 1],
    "passes": [550, 380],
    "pass_accuracy": [88, 79],
    "duels_won": [24, 19],
    "saves": [2, 4],
    "fouls": [10, 14]
  },
  "_sources": ["fotmob", "whoscored"]
}
```

### Score resolution

The headline score is taken from WhoScored's `home/away.scores.fulltime`. On a
freshly-finished match WhoScored sometimes omits that field, which would leave the
FotMob stub's `0-0` in the header while the goals are clearly in the event stream (the
shot maps, which read goals from `events`, stay correct). When `fulltime` is missing,
`build_match_json()` derives the score by **counting Goal events per team, crediting own
goals (qualifier `OwnGoal`) to the opponent** — WhoScored tags an own goal with the
*scoring player's* team, so a naive `teamId` count is off by the number of own goals.
This own-goal-aware count reproduces every known-good fulltime score in `whoscored_ids.json`.

---

## WhoScored ID Cache

`wc2026/whoscored_ids.json` maps WhoScored numeric match IDs to URL slugs:

```json
{
  "1953875": { "slug": "mexico-south-africa", "played": true },
  "1953892": { "slug": "argentina-algeria",   "played": true }
}
```

The scraper checks this cache first (fast, no browser). If a match is missing, it searches the WhoScored competition page via Selenium and saves the result.

### Team name aliases

FotMob and WhoScored use different spellings for some national teams. Two normalisation layers handle this:

- `FOTMOB_NAME_OVERRIDES` — maps FotMob placeholder names to real names. FotMob keeps
  serving the placeholder slot name even after a play-off team's matches are played, which
  breaks the WhoScored slug search, so each slot is mapped to its real qualifier. The
  override is applied in **both** `build_match_json()` and `fetch_and_save()` (the latter
  *before* the WhoScored search runs, otherwise the search can never match):
  ```python
  {"FIFA Play-Off Tournament 1": "DR Congo", "FIFA Play-Off Tournament 2": "Iraq",
   "European Play-Off A": "Bosnia and Herzegovina", "European Play-Off B": "Sweden",
   "European Play-Off C": "Turkiye", "European Play-Off D": "Czechia"}
  ```

- `_WS_NAME_ALIASES` — maps common variants to WhoScored slug fragments:
  ```python
  {"south korea": "republic-of-korea", "cape verde": "cabo-verde",
   "dr congo": "dr-congo", "turkiye": "turkiye", ...}
  ```

---

## Setup

### Prerequisites

```bash
pip install -r wc2026/requirements.txt
```

Requires Python 3.10+, Google Chrome, and the matching ChromeDriver (managed automatically by `undetected_chromedriver`).

### Environment variables (`.env`)

```env
# GitHub Personal Access Token (repo scope) for pushing infographics
GIT_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
XWORLDCUPTWIT_REPO=https://github.com/RShiri/XWORLDCUPTWIT.git

# WhatsApp alerts (callmebot or twilio)
WHATSAPP_PROVIDER=callmebot
WHATSAPP_PHONE=+1234567890
WHATSAPP_CALLMEBOT_KEY=xxxxxx
```

---

## Usage

### Run a single match (full pipeline)

```bash
# By FotMob match ID — scrapes FotMob + WhoScored, renders, pushes, alerts
py -m wc2026.run_match --fotmob-id 4670000

# From existing JSON (re-render + re-push only)
py -m wc2026.run_match --from-file wc2026/matches/2026_06_17_Portugal_vs_DR_Congo.json

# Render locally, skip Git push
py -m wc2026.run_match --fotmob-id 4670000 --no-push

# Render and push, skip WhatsApp
py -m wc2026.run_match --fotmob-id 4670000 --no-post
```

### Re-render all cached matches

```bash
py wc2026/render_all.py
```

Iterates every `wc2026/matches/2026_*.json`, skips files with no score or no starters (unplayed / placeholder JSONs), writes PNGs to `wc2026/output/`.

### Backfill WhoScored ratings for FotMob-only matches

If a match was scraped from FotMob only (no player ratings), patch it:

```bash
# Patch all matches missing ratings
py -m wc2026.patch_ws_players

# Patch one specific match
py -m wc2026.patch_ws_players --match 2026_06_17_Portugal_vs_DR_Congo.json

# Force re-patch even if ratings already present
py -m wc2026.patch_ws_players --force

# Adjust delay between matches (default 5 s)
py -m wc2026.patch_ws_players --delay 10
```

### Push all PNGs to GitHub

```bash
py wc2026/push_all_pngs.py
```

Clean-slate approach: clones the repo to a temp directory, `git rm` all existing PNGs in `WorldCup2026/`, copies fresh PNGs, commits, and pushes. Filters to `2026_*` dated files only.

### Schedule all remaining matches (Windows Task Scheduler)

```powershell
# Register tasks for all future matches (fires at kick-off + 3 hours)
powershell -ExecutionPolicy Bypass -File wc2026\register_tasks.ps1

# Only matches in the next 7 days
powershell -ExecutionPolicy Bypass -File wc2026\register_tasks.ps1 -DaysAhead 7

# Dry run
powershell -ExecutionPolicy Bypass -File wc2026\register_tasks.ps1 -WhatIf

# Remove all WC2026 tasks
powershell -ExecutionPolicy Bypass -File wc2026\unregister_tasks.ps1
```

---

## Team badge overrides

Crests/flags are stored in `team_logos/wc2026/`. To override a badge, save a transparent PNG named exactly as the team (e.g. `Portugal.png`). The renderer loads it automatically at the next run.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| WhoScored returns empty data | Cloudflare challenge not solved | Ensure `version_main=149` in `uc.Chrome()` matches installed Chrome major version |
| "No WhoScored ID found" | Match missing from `whoscored_ids.json` | Add entry manually or let `whoscored_search_match_id()` find it (requires Chrome) |
| Player ratings all missing | WhoScored scrape failed or not run yet | Run `patch_ws_players.py` for those matches |
| Wrong team name / play-off match scrapes empty | FotMob serves placeholder slot names ("European Play-Off C") even after the game | Add the slot to `FOTMOB_NAME_OVERRIDES` (already covers A/B/C/D → Bosnia/Sweden/Turkiye/Czechia); it's applied before the WhoScored search |
| Header shows `0-0` but shot maps show goals | WhoScored returned no `scores.fulltime` on a just-finished match | Re-scrape (fixed automatically now — score is derived from goal events, own goals credited to the opponent) |
| Header score off by the number of own goals | Naive goal count not crediting own goals to the opponent | Handled in `build_match_json()`; own-goal events carry the scoring player's `teamId` |
| Missing team flag in header | Logo filename doesn't exactly match the team name | Save `team_logos/wc2026/<exact name>.png` (e.g. `Bosnia and Herzegovina.png`, `Turkiye.png`, `Sweden.png`) |
| `git push` fails with credential dialog | No GIT_TOKEN set | Set `GIT_TOKEN` in `.env`; auto-push (`git_ops.py`) uses token auth + `GIT_TERMINAL_PROMPT=0`, so it can't hang unattended |
| Duplicate/ghost PNGs in repo | Old render before name fix was pushed | Delete from `wc2026/output/` and re-run `push_all_pngs.py` |
