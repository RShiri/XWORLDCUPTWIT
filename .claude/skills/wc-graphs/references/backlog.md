# Chart backlog

The tournament is complete — 104/104 matches played, final 19 Jul 2026. The dataset is
frozen, so new charts no longer arrive with new data; they come off this list.

This is the work queue for the weekly auto-propose Routine (see the bottom of `SKILL.md`)
and a plain to-do list for anyone working by hand. **One chart per pull request.**

## How to use it

Take the highest-ranked item whose status is `todo`. Skip anything marked `blocked` or
`needs-decision` — those want a human call first. When you open the PR, flip that item's
status to `in-review` and put the PR number next to it in the same commit, so the next run
doesn't rebuild the same chart.

Status values: `todo` · `in-review (#PR)` · `shipped` · `blocked` · `needs-decision`.

Effort: **S** ≈ an hour or two · **M** ≈ half a day · **L** ≈ multi-session.

## Verified data inventory

Checked against the live payloads on 17 Aug 2026 — build on these fields with confidence:

- `matches_detail/<id>.js` — `shots[]` (`x,y,xg,min,sec,body,sit,big,blocked,post,onTarget,goal,gy,gz`),
  `passes[]` (`x,y,ex,ey,prog,cross,key,through,assist,ok,recv`), `dribbles[]`, `carries[]`
  (`carry,ok`), `saves[]` (`block`), `goals[]` (`own,pen,assist`), `lineups.{starters,subs}`,
  `formations`, `managers`, `referee`, `venue`, `stage`, `maxMin`
- `players.js` — 1039 players, 50+ fields including `recoveries`, `errors`, `dispossessed`,
  `aerials`/`aer_pct`, `drbPast`, `tkl_pct`, `clrBox`, `gPrev`, `xga90`, `progPasses`,
  `rating_best`, `posList`, `yc`/`rc`, `corners`, `claims`
- `shots.js` — 2575 tournament-wide shots (`t,o,h,x,y,xg,g,ot,s,m`)
- `data.js` — 104 matches with per-source stats; **no scorers** (see item 1)

## Queue

### 1. Golden Boot race — `todo` · M · Players or Standouts tab
Cumulative goals per player across match dates, top ~8 as stepped lines with the leader
labelled. The single most-asked-for tournament chart and the site has no time dimension on
player scoring at all.
**Builder change first:** `data.js` match rows carry no scorers, and `players.js` carries
only totals. Emit a per-player, per-match goal log from `build_players.py` before touching
`app.js`. Precedent for the drawing: `buildMomentum` (stepped cumulative lines).

### 2. Team form sparklines — `todo` · S · Tables / Team totals
A result+xG sparkline per team on the standings rows — five games at a glance, no click.
All of it is in `D.matches` already; no builder change. Roadmap item 13.

### 3. Referee profile — `todo` · M · new panel, Data tab
Cards and fouls per referee, with a per-referee match count. `referee` is captured on every
match detail and is used **only** as a line of scoreboard text — nothing aggregates it, so
this is a whole dimension the site currently throws away.
**Builder change first:** aggregate referee → matches/cards/fouls in `build_data.py`.
Note the honesty device this one needs: with ~104 matches most referees have 2–4 games, so
show the sample size on every row and don't rank on rate alone.

### 4. Shot quality curve — `todo` · S · Team Lab or xG Analysis
xG per shot against distance from goal, all 2575 shots, binned with a fitted curve and the
goals overlaid. Explains *why* the xG model says what it says — good companion to the
existing shot map. Pure `shots.js`, no builder change.

### 5. Big-chance and body-part filters on the Team Lab shot map — `todo` · S
`build_shots.py` drops the `big` and `body` fields that the per-match payloads carry, so
the tournament shot map can't filter by big chance or split header/foot. Add the two fields
to the builder, then two filter chips on the existing map.
Cheapest real win on the list — it extends a chart that already exists.

### 6. Pass sonar — `todo` · M · Team Lab
Polar histogram of pass angle × length per team (or player), a compact fingerprint of how a
side moves the ball. `passes[]` has `x,y,ex,ey`, so angle and length are direct. New polar
geometry — no precedent on the site, so budget time for the axis work.

### 7. Substitution impact — `todo` · M · Match Centre
Momentum either side of each substitution, so the reader can see whether a change turned
the game. `lineups.subs` gives the minute; reuse the momentum series from `buildMomentum`.
Beware the honesty problem: teams sub *because* the game changed, so label it as
association and put the tournament-average post-sub swing behind it as a control — the same
device the Breaks slopegraph uses.

### 8. Keeper shot-stopping map — `todo` · M · Player Lab or Standouts
Shots faced plotted on the goal-mouth frame per keeper, saves vs goals, against `gPrev`.
`shots.js` has `gy,gz`; attributing each shot to the keeper who faced it needs the
opponent's lineup for that match, so confirm the join is clean before committing to it.
Precedent: `GM` / `tlGoalMouth`.

### 9. Field tilt & territory — `todo` · S · Match Centre
Share of passes in each third over time per side. Straight from `passes[]`. Roadmap item 11.

### 10. Aerial duel profile — `todo` · S · Standouts
`aerials`/`aer_pct` are in `players.js` and exposed nowhere. Likely just an addition to
`SO_STATS` plus a preset chip rather than a new chart — check that first; if so it's
15 minutes, not an S.

### Held back

- **Expected Threat (xT) layer** — `needs-decision` · L. Roadmap item 10. Needs a possession-value
  model trained and vendored the way `xg_core/` was, plus a decision on where the canonical copy
  lives. Model work, not chart work — don't let an automated run start this.
- **Player touch heatmaps** — `needs-decision` · M. Roadmap item 9, but Player Lab's action maps
  already cover much of it. Decide whether this is a new chart or a density mode on the existing
  one before building anything.
- **Mobile audit / accessibility pass** — `needs-decision` · M. Roadmap items 15–16. Real work,
  but it's a sweep across every existing chart rather than one new chart, so it doesn't fit the
  one-chart-per-PR loop.

## Keeping this honest

Two failure modes to watch for as the queue gets worked:

**Chart count is not value.** The site has ~50 charts already. A new one has to answer a
question the existing ones don't; "we have the data" is not sufficient reason. If an item
turns out to duplicate something on another tab, mark it `shipped` with a note rather than
building a near-twin.

**Cross off what ships.** `DASHBOARD_ROADMAP.md` drifted out of date — items 5 and 14 were
built and left unmarked, which is how a backlog stops being trusted. Update the status here
in the same PR that ships the chart.
