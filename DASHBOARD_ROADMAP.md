# WC2026 Dashboard — Roadmap of Future Updates

Future improvements for the interactive site (`wc2026_dashboard/`, live at
**https://rshiri.github.io/XWORLDCUPTWIT/**). Each item lists **why**, **where it touches**,
and a rough **effort** (S ≈ hours, M ≈ half-day, L ≈ multi-session). Ordered into
**Now / Next / Later** by value-to-effort. Nothing here exists yet — current features are
in `wc2026_dashboard/README.md`.

> How to work on these: build/serve locally with `py wc2026_dashboard/build_site.py --serve`
> (→ `http://localhost:8777/wc2026_dashboard/`). Source files (`app.js`/`match.js`/CSS/HTML)
> need a **manual** `git push`; only generated data auto-deploys. Verify with the preview
> tools before pushing.

---

## NOW — reliability & observability (directly addresses the stale-site problem)

1. **"Last updated" freshness badge** — *S, high value.*
   Show the newest deployed match + its date and a build timestamp in the site header (e.g.
   "Data current to: Colombia 2–1 DR Congo · 24 Jun"). A stale site becomes *visible at a
   glance* instead of being discovered days later.
   *Touches:* `build_data.py` (stamp `window.WC_DATA.generated_at` + `latest_match`),
   `app.js` (render badge), `styles.css`.

2. **Auto-deploy health: fail loudly, not silently** — *S, high value.*
   The #1 stale-site cause is the bot push failing on a missing/expired `GIT_TOKEN` while
   `run_match` swallows it. Add a startup pre-flight in `run_match` that validates the token
   (`GET https://api.github.com/user`) and **warns prominently / exits non-zero** if invalid,
   plus a WhatsApp alert on push failure. (Pipeline-side, but it's what keeps the dashboard live.)
   *Touches:* `wc2026/run_match.py`, `wc2026/git_ops.py`.

3. **Coverage panel for missing-data matches** — *S.*
   A small banner on Matches/Match Centre for the games with no event data yet (currently 3),
   with a "re-checks automatically when published" note, so blank shot maps look intentional.
   *Touches:* `build_data.py` (flag `no_events`), `app.js`, `match.js`.

---

## NEXT — high-value analytics & navigation

4. **Knockout bracket view** — *M, high value.*
   An interactive R32→Final bracket that fills in as results land (the schedule already has
   the knockout placeholders). Today only group Tables exist; the bracket is the natural
   tournament centerpiece.
   *Touches:* new `app.js` section + `build_data.py` (derive bracket from results/schedule).

5. **xG flow / momentum timeline (per match)** — *M, high value.*
   Cumulative "xG race" line per team over match minutes, plus a momentum bar — the single
   most-requested modern match-viz. Event stream already has per-shot minute + xG.
   *Touches:* `build_match_details.py` (already has shots w/ minute+xG), `match.js` (new chart).

6. **Player profile pages** — *M.*
   Click a player in the Players table → a per-player page: per-match log, season totals,
   a position radar (percentile vs peers), and shot/key-pass maps aggregated across games.
   *Touches:* new `player.html`/`player.js` (mirror `match.html` pattern), `build_players.py`
   (emit per-player detail files like `matches_detail/`).

7. **Per-90 / minutes-adjusted toggle** — *S.*
   Toggle the Players table between totals and per-90 values (fairer for subs/rotation).
   *Touches:* `players.js` data already has minutes; `app.js` (toggle + recompute).

8. **Global search** — *S.*
   One search box that jumps to any team, player, or match.
   *Touches:* `app.js`.

---

## LATER — depth, polish, breadth

9. **Player touch heatmaps** — *M.* From event coordinates per player (Match Centre + profile).
10. **Expected Threat (xT) layer** — *L.* Add xT to pass explorer / pass network (weight links
    by threat added), and an xT leaderboard. Extends `xg_model.py` thinking to possession value.
11. **Field tilt & territory** — *S.* Possession-territory and final-third entry maps per match.
12. **Golden Boot / POTT race trackers** — *S.* Running leaderboards with sparkline trends.
13. **Team form & trends** — *S.* Result/xG sparklines per team on the Team-totals view.
14. **Dark mode** — *S.* Theme toggle; the CSS is already variable-driven via cache-busted sheets.
15. **Mobile/responsive audit** — *M.* The pitch SVGs and wide tables need a small-screen pass.
16. **Accessibility pass** — *M.* Keyboard nav for shot/pass dots, ARIA labels, contrast check.
17. **Shareable cards / Open Graph** — *S.* Per-match `og:image` (reuse the PNG) so links unfurl.

---

## Cross-cutting tech debt (do alongside the above)

- **Shared pitch/render module.** `match.js` re-implements pitch drawing per section; extract
  one helper to cut the `ty()` y-flip bug surface (see the shot/pass-map gotcha in `CLAUDE.md`).
- **Generated-file size.** `matches_detail/<id>.js` and `players.js` are large; consider JSON +
  `fetch` (served) with the `file://` `<script>` fallback kept for offline use.
- **One xG model, one source of truth.** `xg_model.py` is copied from `renderer.py`; make the
  dashboard import the renderer's model (or vice-versa) so they can't drift.
- **A11y/perf budget in `build_site.py`** as a lightweight check before deploy.

---

### Suggested first sprint
Items **1, 2, 4, 5** — the freshness badge + loud push-failure (so the site never silently
goes stale again), then the knockout bracket and the xG-flow timeline for immediate
visible value. All four are S/M and touch isolated, well-understood files.
