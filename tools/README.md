# tools/ — maintenance, one-time & legacy scripts

These are **not** part of the live per-match pipeline. The live flow is only
`wc2026/{run_match, scraper, renderer, git_ops, team_colors}.py`. Everything here is
run by hand when needed. They are kept out of the `wc2026/` package so the core stays
small and obvious.

Run them from the **repo root** (they resolve repo root as `Path(__file__).parents[1]`,
so this top-level folder keeps that correct):

```bash
py tools/<script>.py [...]
```

| Script | What it does | When you'd run it |
|---|---|---|
| `schedule.py` | Fetches the live WC2026 fixture list from FotMob, converts kick-offs to IDT (UTC+3), and writes `wc2026/REMAINING_SCHEDULE.json` / `.txt`. | When the fixture list changes (knockout bracket fills in, kickoff times move). Re-run, then re-run `wc2026/register_tasks.ps1`. |
| `catchup.py` | Reads `REMAINING_SCHEDULE.json`, finds every match whose scrape time already passed, and processes the ones with no JSON yet. | After the PC was off / a scheduled run was missed and you want to backfill in bulk. |
| `scrape_wc.py` | Standalone manual WhoScored scraper (visible browser, solve Cloudflare CAPTCHA by hand). | When the automated scrape can't get WhoScored events for a match and you need to grab them manually. |
| `render_all.py` | Re-renders **every** cached match JSON in `wc2026/matches/`. | After a renderer change, to regenerate all PNGs + refresh dashboard data locally. |
| `push_all_pngs.py` | Pushes all re-rendered PNGs to GitHub in one commit. | Bulk backfill of the `WorldCup2026/` PNG archive (pairs with `render_all.py`). Needs a valid `GIT_TOKEN`. |
| `patch_ws_players.py` | Re-scrapes WhoScored for FotMob-only match JSONs to add player ratings. | One-off backfill of ratings on older matches scraped before WhoScored merge. |
| `backfill_ws_extras.py` | Re-opens each already-scraped match on WhoScored and patches in the extras the pipeline now keeps (formations + shape changes, captain, managers, referee) without touching events/stats. Resumable; `--limit N` for a careful start, `--rebuild` to regenerate dashboard data after. | One-off backfill of matches scraped before 2026-07-20, when `scraper.py` started carrying these fields. Run on the scrape PC (needs WhoScored/Chrome access). |
| `download_badges.py` | Downloads flag PNGs for all 48 nations from flagcdn.com into `team_logos/wc2026/`. | One-time asset setup / refreshing a missing flag. |
| `generate_placeholders.py` | Generates shield-crest placeholder badges for all 48 nations. | One-time asset setup when a real crest is missing. |
| `pipeline.py` | **LEGACY.** The original file-watcher pipeline (watches `wc2026/matches/` and renders+posts on new JSON). Superseded by `wc2026/run_match.py` (one-shot) + Windows Task Scheduler. | Not used in normal operation. Kept for reference. |
| `twitter_bot.py` | X/Twitter (Tweepy) posting integration. **Only** imported by `pipeline.py`. The live flow posts to WhatsApp instead (`run_match.py` step 5), so this is dormant. | Only if you revive Twitter posting. |

## Notes
- Anything that pushes to GitHub (`push_all_pngs.py`, and the live `run_match`) needs a
  **valid** `GIT_TOKEN` in `.env` — see the auth note in the root `CLAUDE.md`.
- The per-match scheduled tasks call `py -m wc2026.run_match --fotmob-id <id>` directly;
  none of them depend on anything in this folder.
