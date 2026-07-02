# Cooling-break validation — WC2026 group stage

Validation of the four claims from The Times' cooling-break analysis against our own
scraped dataset (all **72** group-stage matches have full WhoScored event streams in
`wc2026/matches/`).
Reproduce everything with **`py tools/cooling_break_analysis.py`** (repo root).

> **Revision note.** The first version of this report ran on 71 files whose
> `wc_metadata.stage` said exactly `"Group Stage"`. That sample was subtly wrong both
> ways: three Round-of-32 **slot-stub files** (`2A_vs_2B`, `1C_vs_2F`, `1E_vs_3ABCDF`)
> kept the stub's "Group Stage" metadata when the scraper overwrote them in place, and
> four real group games carried non-standard stage strings (`"World Cup Grp. C"`,
> `"Group I"`, `None`). Stage classification now also reads the slot-coded file id
> (`load_group_matches`/`_stage_code`), giving the correct 72-match sample. All numbers
> below are from the corrected run; no verdict changed, percentages moved 1–3 points.

## Verdict at a glance

| # | Times claim | Our data says | Verdict |
|---|---|---|---|
| 1 | 32% of games: higher-than-average momentum shift after break 1 | 18.1% (>μ+1σ) / 41.7% (>μ) | **Not confirmed** |
| 2 | 26% after break 2 | 18.3% (>μ+1σ) / 46.5% (>μ) | **Not confirmed — no break-1 > break-2 gap** (the two breaks disrupt about equally; if anything break 2 edges it) |
| 3 | Games slow down after the breaks | Ball-in-play tempo *rises* slightly; final-third penetration falls after break 2 | **Not confirmed** (only partially, and only late) |
| 4 | The dominant side declines more post-break | Directionally yes (~61% of games) — but a control shows most of it is regression to the mean; the clearest break-specific excess is the chasing side's gain at break 1 | **Weakly confirmed** |

## Method (what the numbers mean)

- **Cooling breaks aren't tagged** in any of our three sources. They are detected as
  the longest dead gap in the event stream inside the canonical windows (H1 min
  15–40, H2 min 60–85). The 2026 breaks are unmistakable: a ~180–240 s hole in an
  otherwise ~5 s-granular feed. Detection: **break 1 in 72/72** matches (70 with
  ≥150 s dead time, mean start **23.1'**), **break 2 in 71/72** (68 confirmed, mean
  start **73.7'**). Low-confidence detections (gap 90–150 s): 2 matches at break 1,
  3 at break 2 — kept, flagged in the output.
- **Momentum** mirrors the dashboard's xG-momentum view and uses the shared
  `xg_model.py`, blended per guideline A: window **xG rate (50%) + field tilt =
  final-third-touch share (25%) + possession = pass share (25%)**, each z-scored
  against every rolling 7-minute window of every match. Match momentum = home
  index − away index; the **break shift** = |post-window − pre-window| of that
  differential, 7 in-play minutes either side of the dead gap (the gap itself
  excluded).
- **"Higher than average"** is tested against real churn, not against zero: the
  baseline is |Δ| across **2,945 rolling adjacent-window pairs** in the same
  matches away from the breaks — baseline mean **μ = 1.15**, **σ = 0.97** (z-units).

## 1–2. Numerical validation

| | Break 1 (n=72) | Break 2 (n=71) | Baseline |
|---|---|---|---|
| Mean shift | 1.27 | 1.32 | 1.15 |
| % of matches > μ (plain "above average") | **41.7%** | **46.5%** | ~44% by construction |
| % > μ+1σ (guideline A definition) | **18.1%** | **18.3%** | ~10% |
| % > μ+2σ | 6.9% | 7.0% | ~3% |

- Under the definition the guidelines prescribe (≥1σ above the mean shift), we get
  **18.1% / 18.3%** — well short of the article's 32% / 26%.
- Under the loosest reading ("above the average shift"), break 1 lands at 42%
  and break 2 at 47% — but ~44% of *random* window pairs clear that bar too, so
  it says nothing break-specific.
- The article's ordering (break 1 clearly more disruptive than break 2) does not
  appear in any definition: the two breaks land within a fraction of a point of
  each other (18.1% vs 18.3%; mean shift 1.27 vs 1.32), with break 2 slightly
  ahead at 5–7-minute windows. Both sit only ~0.12–0.18σ above normal churn.
- Caveat worth naming: 32% is exactly the two-sided 1σ tail of a normal
  distribution — if The Times measured shift against its own break-shift
  distribution rather than a within-game baseline, their "32%" is close to what any
  data would produce by construction.

Biggest single-match swings, if you want case studies: **Germany–Ivory Coast
(20 Jun)** — largest shift at *both* breaks (6.0σ-units, then 3.6); Türkiye–USA
(26 Jun, 4.5); Netherlands–Sweden (3.6); Ivory Coast–Ecuador (3.5); Panama–England
break 2 (4.1); Norway–France break 2 (3.7); Iraq–Norway break 2 (3.3).

## 3. Pace / intensity (per in-play minute, both teams pooled)

| Metric | Break 1 pre → post | Break 2 pre → post |
|---|---|---|
| Passes / min | 10.76 → 11.24 (**+4%**) | 9.69 → 9.88 (+2%) |
| In-play touches / min | 13.58 → 14.33 (+6%) | 12.49 → 12.71 (+2%) |
| Final-third entries / min | 1.11 → 1.21 (+9%) | 1.07 → 0.95 (**−11%**) |
| PPDA (pooled; higher = less pressing) | 12.2 → 13.0 (−7% press intensity) | 11.8 → 10.9 (+8%) |
| Matches with fewer passes/min post | 50% | 46% |

The game does **not** slow down in ball-in-play terms — tempo ticks *up* after both
breaks (rested legs, and post-restart play resumes cleanly). What does change:
after **break 1 the pressing eases** (PPDA +7% at 7-minute windows — though this
one flips sign at 5-minute windows, so treat it as a lean, not a law), and after
**break 2 penetration drops** (−11% final-third entries — game management sets in
around min 74–80, which spectators plausibly *perceive* as "slower"). Note we have
no tracking data in this pipeline, so sprint/distance claims are untestable here;
this is event-stream pace only.

## 4. Dominant-team analysis

Dominant = side leading on goals at the break; if level, the side with the higher
pre-break momentum index (same rule applied everywhere).

| | Break 1 | Break 2 | **Control** (2,945 random adjacent-window pairs, same rule) |
|---|---|---|---|
| Dominant side Δ momentum | **−0.24** | **−0.28** | −0.20 |
| Chasing side Δ momentum | **+0.36** | **+0.24** | +0.22 |
| Dominant fared worse than opponent | 61.1% | 60.6% | 62.1% |
| Scoreline-leaders only: Δ dom / Δ chaser | −0.30 / +0.17 (n=33) | −0.14 / +0.08 (n=45) | — |

The raw pattern is exactly what the article describes — the side on top comes out
of the break flatter in ~6 of 10 games while the chaser picks up. **But the control
matters**: dominant teams give back −0.20 across *any* random 7-minute boundary
(regression to the mean — you were only "dominant" because your last window was
hot). The leader's break-specific excess decline is small (≈ −0.05 at break 1,
≈ −0.08 at break 2); the clearest genuine break effect is on the **chasing side at
break 1**, which gains +0.36 vs the +0.22 a random boundary already gives (+0.14
excess). So: the *phenomenon* is real and bankable for a coach; the *causal role of
the break itself* is smaller than the article implies, and it shows up more as the
chaser waking up than the leader collapsing.

## Code

Full pipeline: [`tools/cooling_break_analysis.py`](tools/cooling_break_analysis.py)
(`--window 300..600` to vary guideline A's window; `--json out.json` for the raw
per-match rows). Core logic in pandas form:

```python
import pandas as pd, json, glob
import sys; sys.path.insert(0, "wc2026_dashboard")
from xg_model import SHOT_TYPES, shot_xg, is_shootout

rows = []
for p in glob.glob("wc2026/matches/*.json"):
    d = json.load(open(p, encoding="utf-8"))
    if (d.get("wc_metadata") or {}).get("stage") != "Group Stage" or not d.get("events"):
        continue
    for e in d["events"]:
        rows.append(dict(
            match=p, half=e["period"]["displayName"], team=e.get("teamId"),
            t=e.get("expandedMinute", 0) * 60 + (e.get("second") or 0),
            typ=e["type"]["displayName"], x=e.get("x") or 0,
            touch=bool(e.get("isTouch")),
            xg=shot_xg(e)[0] if e["type"]["displayName"] in SHOT_TYPES
               and not is_shootout(e) else 0.0))
ev = pd.DataFrame(rows).sort_values(["match", "half", "t"])

# cooling break = longest inter-event gap in the canonical window of each half
ev["gap"] = ev.groupby(["match", "half"])["t"].diff().shift(-1)
win = {"FirstHalf": (15*60, 40*60), "SecondHalf": (60*60, 85*60)}
cand = ev[ev.apply(lambda r: win[r.half][0] <= r.t < win[r.half][1], axis=1)
          & (ev.gap >= 90)]
breaks = cand.loc[cand.groupby(["match", "half"])["gap"].idxmax(),
                  ["match", "half", "t", "gap"]]

def window(df, m, h, t0, t1):           # per-team rates in [t0, t1)
    w = df[(df.match == m) & (df.half == h) & (df.t >= t0) & (df.t < t1)]
    g = w.groupby("team").agg(xg=("xg", "sum"),
                              passes=("typ", lambda s: (s == "Pass").sum()),
                              ft=("x", lambda s: (s >= 66.7).sum()))
    return g / ((t1 - t0) / 60)          # per-minute

W = 420                                  # guideline A: 5–10 min → 7 min default
for _, b in breaks.iterrows():
    pre  = window(ev, b.match, b.half, b.t - W, b.t)
    post = window(ev, b.match, b.half, b.t + b.gap, b.t + b.gap + W)
    # → z-score xg/ft/passes vs all rolling windows, blend 0.5/0.25/0.25,
    #   shift = |Δ(home_index − away_index)| ; compare vs baseline μ+1σ
```

**SQL:** the published sqlite (`wc2026_dashboard/database/wc2026.sqlite`) only holds
match-level aggregates — minute-level analysis is impossible against the current
schema. If we productionise this (see dashboard tab below), `build_database.py`
should emit a `break_windows` table, after which the article's claims are one query:

```sql
-- proposed table: break_windows(match_id, break_no, start_s, dur_s, team, side,
--                                phase /*pre|post*/, xg_pm, passes_pm, ft_pm, mom_index)
WITH shift AS (
  SELECT match_id, break_no,
         ABS(SUM(CASE WHEN phase='post' THEN CASE side WHEN 'home' THEN mom_index
                                             ELSE -mom_index END END)
           - SUM(CASE WHEN phase='pre'  THEN CASE side WHEN 'home' THEN mom_index
                                             ELSE -mom_index END END)) AS d
  FROM break_windows GROUP BY match_id, break_no)
SELECT break_no,
       100.0 * AVG(d > (SELECT AVG(d) + 1 * (
           SELECT SQRT(AVG(d*d) - AVG(d)*AVG(d)) FROM shift) FROM shift)) AS pct_above_1sd
FROM shift GROUP BY break_no;
```

## Tactical takeaways for coaches

1. **If you're on top, the break is a threat, not a rest.** In ~61% of games the
   dominant side came out flatter. Script the first three possessions after the
   restart before the break happens (restart routine, first press trigger, one
   designated outlet) so the team resumes on autopilot instead of re-finding rhythm.
2. **One message, not five.** The dead time is ~3 minutes including the walk to the
   touchline. The data says the risk is loss of *rhythm*, not tactics — so spend
   the break on hydration plus a single actionable instruction, and save
   restructuring for actual substitutions.
3. **If you're chasing, the break is a free timeout — especially the first one.**
   The chasing side gains +0.24–0.36 momentum on average post-break, clearly above
   what a random boundary gives (+0.22) at break 1. This is the moment to change
   something structural: press height, build-up side, a prepared set-piece call.
4. **Press the restart after break 1.** League-wide pressing intensity eases after
   the first break (PPDA 12.2 → 13.0 over 7-minute windows, though the dip flips at
   shorter windows). A team that re-engages its press immediately is pressing
   opponents who, on average, aren't pressing back yet.
5. **Guard against passive game management after break 2.** Final-third entries fall
   ~11% after the second break. Leading teams drift into their own half; our
   dominance numbers show that's exactly when chasers gain. Keep one committed
   outball/runner rather than dropping the whole block.
6. **Don't over-index on the interruption myth.** Most of the "leader loses momentum
   at the break" effect is regression to the mean — hot spells end anyway. The
   coaching edge is in points 3–5 (the pressing and penetration dips), which *are*
   break-specific.

## Dashboard concept: a dedicated **“Breaks”** tab

> **Status: shipped.** The tab is live as `#view-breaks` (`renderBreaks`/`initBreaks`
> in `app.js`), fed by `build_breaks.py` → `breaks.js`; the math is
> `tools/cooling_break_analysis.py::export_breaks`. The concept below is the design
> it was built from.

New nav button after Team Lab (`data-view="breaks"` → `#view-breaks`; tab switching
is already `data-view`-driven so it's pure HTML + one render function). Data
plumbing follows the house pattern: a new **`build_breaks.py`** emits **`breaks.js`**
(`window.WC_BREAKS`) with, per match × break: start/end/duration, per-team pre/post
component rates (xG, tilt, possession, passes, FT entries, PPDA inputs), the shift,
and the tournament baseline (μ, σ) — all computed once at build time, so the tab is
static-site cheap like every other view. Register it in `_refresh_web_dashboard_db()`
so it regenerates on every scrape.

Layout, top to bottom:

1. **KPI row — four stat tiles** (headline numbers, not charts): *Breaks detected*
   (with avg dead time), *Shift > μ+1σ* per break (≈18% · 18%), *Momentum swing to
   the chasing team* (+0.36, with the control value as the small caption — honesty
   built into the tile), *Post-break pressing/pace delta*.
2. **Match explorer — "momentum river"** (the hero chart): match picker + a full-match
   rolling momentum-differential line (the same index as the analysis, so the tab
   and the numbers agree). Shaded vertical bands mark HT and both detected cooling
   breaks; ⚽ markers on goals (reuse `buildMomentum` conventions, incl. the
   blue/orange fallback when team colours collide). Crosshair + tooltip showing the
   minute's xG/tilt/possession components. Pre/post windows glow on hover of a band.
3. **Tournament strip — diverging bars**: one thin bar per match (x = shift − baseline
   μ, diverging around 0, sorted), toggle break 1 / break 2. Bars above +1σ carry a
   direct label (team names); everything else stays quiet. Click → loads that match
   in the explorer above. This is the "32% claim" made visible: the reader can
   count the tail themselves.
4. **Pace panel — dumbbell chart**: pre → post per metric (passes/min, touches/min,
   FT entries/min, PPDA), one dumbbell per metric, two shades of a single hue,
   break 1 / break 2 toggle shared with the strip. Direct-labeled deltas
   (+5%, −9%, …); no second axis — PPDA gets its own small multiple since its scale
   differs.
5. **Dominance panel — slopegraph + control band**: two lines (dominant, chasing)
   from pre-index to post-index, with a grey band showing the regression-to-mean
   control so the honest effect size is visible at a glance; a small
   scoreline-vs-momentum dominance filter chip row.
6. **Filter row** (single row above panels 2–5, house style): break (1/2/both) ·
   group · window length (5/7/10 min — guideline A's sensitivity knob, recomputed
   client-side from the shipped component rates) · dominance definition.
   Every panel keeps the per-section **Download PNG** button and the
   "@RShiri" credit like the All Goals Map, plus a table-view toggle (the
   accessibility fallback and the analyst's export).

Colour rules: the two-team charts reuse team colours with the existing
close-colour fallback; single-hue sequential for everything magnitude (pace,
strip intensity); the diverging pair only in panel 3 where polarity is the point;
status colours untouched.

## Limitations (read before quoting)

- Break minutes are *inferred* from event-stream dead time, not official records —
  5 of 143 detections are low-confidence (90–150 s gap), and a goal celebration
  immediately before a break merges into the same gap in a handful of games.
- No tracking data: sprint distance / physical intensity is out of reach; pace here
  is event-stream pace.
- The momentum index weights (0.5/0.25/0.25) are a choice. The headline conclusions
  are stable across 5/7/10-minute windows (>μ+1σ stays at 14–20%, never near 32%;
  no break-1 > break-2 gap; tempo up post-break; late penetration dip; chaser
  gains), but exact percentages move a few points, and the break-1 pressing dip is
  window-sensitive (reverses at 5 min, −7% at 7 min).
- Stage metadata in the raw files is unreliable (see the revision note); stage
  classification uses the slot-coded file ids as well as the stage string.
