@echo off
REM ============================================================================
REM  Safely pull code/data updates without losing your scraped matches.
REM
REM  Every pipeline run regenerates the dashboard data files (data.js, players.js,
REM  database\, matches_detail\) in the working tree, which leaves it "dirty" and
REM  blocks `git pull`. Those files are throwaway locally (the deploy rebuilds and
REM  pushes them), so we discard them and then pull. Your scraped
REM  wc2026\matches\*.json files are NEVER touched by this script.
REM ============================================================================
echo Discarding locally-regenerated dashboard files (data.js, players.js, database, matches_detail)...
git checkout -- wc2026_dashboard/data.js wc2026_dashboard/players.js wc2026_dashboard/database wc2026_dashboard/matches_detail 2>nul
git clean -fd wc2026_dashboard/matches_detail 2>nul
echo Pulling latest from origin/main...
git pull
echo.
echo Done. Your wc2026\matches\*.json were left untouched.
