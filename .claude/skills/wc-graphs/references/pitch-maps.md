# Pitch maps — coordinates, orientation, and the traps

Anything drawn on a pitch has to survive three separate coordinate systems and a
180° rotation. Getting one of them wrong produces a chart that looks plausible and is
wrong — a shot at the correct end for the wrong team, or a map that's a mirror image of
the broadcast the reader just watched. That's why the transforms live in named functions
rather than inline arithmetic.

## Contents
- [Source coordinates (WhoScored)](#source-coordinates-whoscored)
- [The full pitch — `match.js`](#the-full-pitch--matchjs)
- [The goal-mouth view — `GM`](#the-goal-mouth-view--gm)
- [Team Lab half pitch](#team-lab-half-pitch)
- [Player Lab pitches](#player-lab-pitches)
- [Own goals](#own-goals)
- [Build-up diagrams (All Goals Map / Goal replays)](#build-up-diagrams-all-goals-map--goal-replays)
- [Which pitch should a new chart use?](#which-pitch-should-a-new-chart-use)

## Source coordinates (WhoScored)

Raw events arrive as `x, y ∈ [0, 100]`, always from the **acting team's** point of view:
`x = 100` is the goal they're attacking, `y` grows towards the attacker's left. Shot
events additionally carry `GoalMouthY` (across the goal, posts at 45.2 / 54.8) and
`GoalMouthZ` (height, crossbar ≈ 38).

Two derived conventions used throughout the builders:
- attacking third = `x ≥ 66.7`
- progressive pass = successful and advances `x` by ≥ 15 toward goal

## The full pitch — `match.js`

```js
var PW = 100, PH = 64;                       // SVG units: length × width
function tx(side, x) { return side === "home" ? x : PW - x; }
function ty(side, y) { return side === "home" ? PH - y * (PH / 100) : y * (PH / 100); }
```

Home attacks **right**, away is rotated 180° so it attacks **left** on the same pitch.
The `PH - y` flip on the home side is not redundant with the rotation: WhoScored's `y`
grows towards the attacker's left, whereas SVG `y` grows downward, so without the flip the
map is mirrored across the halfway axis relative to the broadcast and the PNG. This has
been "simplified away" before and it un-mirrors every map on the page — leave it.

`pitchMarkup()` draws the surface: background, mowing stripes, touchlines, halfway line,
centre circle, both penalty and six-yard boxes, penalty spots, the penalty arc ("the D",
computed as the slice of the 8.3-radius circle that pokes past the box edge), and the goal
frame with posts and net. All of it is class-driven — `.pitch-bg`, `.pitch-line`,
`.pitch-goal`, `.pitch-net` in `match.css` — so a theme change moves every pitch at once.
Call it; do not hand-roll a subset of markings.

Add a `.dir-label` arrow (`▶` for home, `◀` for away) on any pitch where the reader can't
otherwise tell which way a team is shooting.

## The goal-mouth view — `GM`

`match.js` exposes a small module for "behind the net" charts, shared by the on-target
shot map and the shootout map:

```js
GM.gxOf(goalMouthY)   // → 0..100 across the goal
GM.gyOf(goalMouthZ)   // → height, ground at GM.GROUND
GM.frame()            // posts, crossbar, net mesh, ground line
GM.viewBox            // "-2 -2 104 56"
```

`tlGoalMouth` in `app.js` reimplements the same two mappers for the Team Lab. If you touch
the geometry, touch both — or better, factor the second one onto `GM`.

## Team Lab half pitch

`tlPitch(W, H)` draws a **vertical** half pitch, goal at the top, attacking upward, and
returns the markup plus its own mappers:

```js
px(wsY) → across the width      // WhoScored y → SVG x
py(wsX) → up the length         // WhoScored x (clamped to 50..100) → SVG y
```

Note the axis swap versus the full pitch: on a vertical pitch the source `x` (length)
becomes screen `y`. This is where most half-pitch bugs come from.

## Player Lab pitches

`plPitchHalf(inner)` / `plPitchFull(inner)` (~app.js 4700) carry a **third** geometry —
`PL_HPW = 68`, `PL_HPH = 52`, real-metre box dimensions, hardcoded hex colours instead of
CSS variables, and their own `plMapX`/`plMapY`. They predate the Team Lab pitch and were
not consolidated with it.

If you're extending Player Lab, follow its local convention rather than importing
`tlPitch` halfway — a half-migrated pitch is worse than either. If you have room to
consolidate the two properly, that's a genuine improvement; do it as its own change with a
visual before/after, not as a side effect of adding a chart.

`plGraph` also downsamples above 400 events (`ix % step`), which keeps a busy player's map
readable and the payload small. Reuse that guard for any dense action map.

## Own goals

WhoScored records an own goal with `isOwnGoal:true`, the **conceding** team's `teamId`,
and coordinates at that player's own goal end. Three consequences the builders already
handle, and that any new chart has to respect:

1. Credit the goal to the **opponent** (`own:true` on the timeline entry, displayed "(OG)").
2. Keep it **out of `shots[]`** and out of every shot map. It has no xG, and left in it
   plots a bogus goal at the wrong end for the wrong team.
3. In build-up diagrams, mirror the coordinates 180° (done in `build_match_details.py`) so
   the move reads at the *beneficiary's* attacking end.

Detect it as `isOwnGoal || "OwnGoal" in qualifiers`. Team score totals come from the feed
and are already correct — don't recompute them from events.

## Build-up diagrams (All Goals Map / Goal replays)

`buildGoalSequences(D)` reconstructs each goal from `D.shots`, `D.passes`, `D.dribbles`
and `D.saves`; `agmSeqSVG` draws it and `agmBuildAnimSVG` animates the same sequence.
Visual grammar (classes in `match.css`):

| Element | Class | Look |
|---|---|---|
| Pass | `.agm-pass` | dotted straight line |
| Cross | `.agm-cross` | dotted **curved** arc (`agmArc`) |
| Carry / dribble | `.agm-carry` | solid line |
| Shot | `.agm-shotln` | solid, `--bad` red |
| Touch node | `.agm-node` | shirt number, `--card-2` fill |
| Move start | `.agm-node.start` | amber |
| Finish | `.agm-node.shot` | red, scorer + xG floated above |
| Keeper save (rebound) | `.agm-node.save` | grey |

Two things that took real debugging and are easy to undo:

- **The own-goal look-back anchor.** OG events carry no seconds. Anchoring the build-up
  window at `:59` of the OG minute puts the window *after* the play and collapses the
  diagram to a single node. Anchor on the beneficiary's **last touch in that minute**.
- **`AGM_MAX_SEG`** drops any segment longer than about half the pitch. Source coordinates
  occasionally glitch, and without the guard one bad event draws a line across the whole
  diagram.

Export: `exportGoalPNG` serialises the SVG to a canvas dependency-free, with a metadata
header (teams + score · stage · date · scorer + minute) and the
"All rights reserved to @RShiri" credit. `exportGoalVideo` does the WebM equivalent via
`MediaRecorder` + `canvas.captureStream`, falling back to the PNG when unsupported. Any
new exportable chart should carry the same header band and credit — that's the published
artefact, and it travels without the page around it.

The animation SVG suffixes its marker ids with `…2` (`agmAp2`, `agmAc2`, `agmAs2`) to
avoid clashing with the static map's `<defs>` on the same page. Any second copy of a
diagram on one page needs the same treatment.

## Which pitch should a new chart use?

| You're plotting | Use |
|---|---|
| Both teams, whole match, on one surface | `pitchMarkup()` + `tx`/`ty` (`match.js`) |
| One team's attacking output | `tlPitch` half pitch, goal at top |
| Shot placement in the frame | `GM` (or `tlGoalMouth` in the Team Lab) |
| A single player's actions | `plPitchHalf` / `plPitchFull` (Player Lab convention) |
| A single goal's build-up | `agmSeqSVG` via `buildGoalSequences` |
| A matplotlib PNG panel | `mplsoccer` `Pitch`, see `references/png-renderer.md` |
