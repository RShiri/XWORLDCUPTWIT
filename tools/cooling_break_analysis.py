"""Cooling-break momentum & pace analysis over WC2026 group-stage matches.

Validates the claims from The Times' article:
  1. ~32% of group games showed a higher-than-average momentum shift after cooling break 1
  2. ~26% after cooling break 2
  3. games slow down (pace/intensity) after the breaks
  4. the dominant side pre-break declines more than the chasing side post-break

Method
------
- Cooling breaks are NOT tagged in the WhoScored feed. They are detected as the
  longest dead gap (>= MIN_BREAK_GAP seconds between consecutive events) inside
  the canonical windows: first half minutes 15-40, second half minutes 60-85.
  Real 2026 breaks ran ~180-215s, so they dominate any foul/VAR/celebration gap.
- Momentum uses the same ingredients as the dashboard's xG-momentum view
  (match.js buildMomentum) via the shared xg_model.py: window xG (50%), field
  tilt = share of final-third touches (25%), possession = pass share (25%),
  each z-scored against the distribution of all rolling windows of every match.
  The match momentum differential D = M_home - M_away; the break "shift" is
  |D_post - D_pre| over WINDOW-second windows either side of the dead gap.
- "Higher than average" is tested against the baseline churn: the distribution
  of |D(t+W) - D(t)| over all rolling in-half window pairs that do not overlap
  a detected break. Thresholds reported: > baseline mean, > mean+1sd, > mean+2sd.
- Pace pre/post: passes/min, in-play touches/min, final-third entries/min,
  pooled PPDA (opp build-up passes / defensive actions in the pressing zone).
  No tracking data in the feed, so sprint distance is not measurable.
- Dominance: side leading on goals at the break, else the side with the higher
  pre-window momentum index. Compares each side's own (non-zero-sum) index
  change post vs pre.

Run from repo root:  py tools/cooling_break_analysis.py  [--window 420] [--json out.json]
"""
import argparse
import bisect
import glob
import json
import os
import re
import statistics
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "wc2026_dashboard"))
from xg_model import SHOT_TYPES, is_shootout, shot_xg  # noqa: E402

WINDOW = 420            # seconds analysed either side of the break
MIN_BREAK_GAP = 150     # seconds of dead time = confirmed cooling break
SOFT_BREAK_GAP = 90     # fallback threshold (low-confidence break)
H1_WIN = (15 * 60, 40 * 60)   # where break 1 may start (seconds into H1 clock)
H2_WIN = (60 * 60, 85 * 60)   # where break 2 may start
FINAL_THIRD_X = 66.7
W_XG, W_TILT, W_POSS = 0.5, 0.25, 0.25

TOUCH_TYPES_DEF = {"Tackle", "Interception", "Challenge", "Foul", "BlockedPass"}


def ev_time(ev):
    return ev.get("expandedMinute", ev.get("minute", 0)) * 60 + (ev.get("second") or 0)


def is_own_goal(ev):
    if ev.get("isOwnGoal"):
        return True
    return any((q.get("type") or {}).get("displayName") == "OwnGoal"
               for q in ev.get("qualifiers") or [])


# Stage metadata can't be trusted alone: knockout slot-stubs overwritten in
# place keep the stub's "Group Stage" string, while some real group games say
# "World Cup Grp. C" / "Group I" / None. So classify by the stage string AND
# the slot-coded file id (the bracket's `2A_vs_2B` convention marks knockouts).
_SLOT_SIDE_RE = re.compile(r"^(?:[123][A-L]{1,6}|Winner[_ ].*)$", re.I)


def _slot_stage(mid):
    """Knockout round inferred from a slot-coded file id, or None."""
    m = re.match(r"^\d{4}_\d{2}_\d{2}_(.+)_vs_(.+)$", mid or "")
    if not m:
        return None
    a, b = (s.replace("_", " ").strip() for s in m.groups())
    if not (_SLOT_SIDE_RE.match(a) or _SLOT_SIDE_RE.match(b)):
        return None
    if not a.lower().startswith("winner") and not b.lower().startswith("winner"):
        return "R32"  # both sides group-position codes (1A / 2B / 3ABCDF)
    return "KO"


def _stage_code(stage, mid=""):
    s = (stage or "").lower()
    for token, code in (("32", "R32"), ("16", "R16"), ("quarter", "QF"),
                        ("semi", "SF"), ("third place", "3P"), ("final", "F")):
        if token in s:
            return code
    slot = _slot_stage(mid)
    if slot:
        return slot
    if not s or "group" in s or "grp" in s:
        return "G"
    return stage[:12]


def load_group_matches(root):
    from build_match_details import is_match_file  # via the sys.path insert above
    out = []
    for p in sorted(glob.glob(os.path.join(root, "wc2026", "matches", "*.json"))):
        if not is_match_file(p):
            continue
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(d, dict):
            continue
        mid = os.path.basename(p)[:-5]
        if _stage_code((d.get("wc_metadata") or {}).get("stage"), mid) != "G":
            continue
        if not d.get("events"):
            continue
        out.append((mid, d))
    return out


def half_events(d, half):
    ev = [e for e in d["events"] if (e.get("period") or {}).get("displayName") == half]
    ev.sort(key=ev_time)
    return ev


def find_break(ev, lo, hi):
    """Longest dead gap starting in [lo,hi) seconds. Returns (start,end,dur) or None."""
    best = None
    for a, b in zip(ev, ev[1:]):
        ta, tb = ev_time(a), ev_time(b)
        dur = tb - ta
        if dur >= SOFT_BREAK_GAP and lo <= ta < hi:
            if best is None or dur > best[2]:
                best = (ta, tb, dur)
    return best


def window_stats(ev, t0, t1, home_id, away_id):
    """Per-side raw window numbers between event-times t0..t1."""
    s = {tid: dict(xg=0.0, ft=0, passes=0, touches=0, ft_entries=0,
                   buildup_passes=0, def_actions=0, goals=0)
         for tid in (home_id, away_id)}
    prev_ft = {home_id: False, away_id: False}
    for e in ev:
        t = ev_time(e)
        if t < t0 or t >= t1:
            continue
        tid = e.get("teamId")
        if tid not in s:
            continue
        typ = (e.get("type") or {}).get("displayName")
        x = e.get("x") or 0
        if typ in SHOT_TYPES and not is_shootout(e) and not is_own_goal(e):
            s[tid]["xg"] += shot_xg(e, {"events": ev})[0]
        if typ == "Goal":
            credit = tid
            if is_own_goal(e):
                credit = away_id if tid == home_id else home_id
            s[credit]["goals"] += 1
        if e.get("isTouch"):
            s[tid]["touches"] += 1
            in_ft = x >= FINAL_THIRD_X
            if in_ft:
                s[tid]["ft"] += 1
                if not prev_ft[tid]:
                    s[tid]["ft_entries"] += 1
            prev_ft[tid] = in_ft
        if typ == "Pass":
            s[tid]["passes"] += 1
            if x < 60:                       # opponent may press these (PPDA numerator)
                s[tid]["buildup_passes"] += 1
        if typ in TOUCH_TYPES_DEF and x > 40:  # pressing-zone defensive action (PPDA denom)
            s[tid]["def_actions"] += 1
    return s


def momentum_components(win, tid, other, minutes):
    """Raw (xg_rate, tilt, possession) for one side in one window."""
    xg_rate = win[tid]["xg"] / minutes
    ft_tot = win[tid]["ft"] + win[other]["ft"]
    tilt = win[tid]["ft"] / ft_tot if ft_tot else 0.5
    p_tot = win[tid]["passes"] + win[other]["passes"]
    poss = win[tid]["passes"] / p_tot if p_tot else 0.5
    return xg_rate, tilt, poss


class Zscorer:
    """z-scores each momentum component against the all-windows distribution."""

    def __init__(self):
        self.samples = {"xg": [], "tilt": [], "poss": []}

    def add(self, xg, tilt, poss):
        self.samples["xg"].append(xg)
        self.samples["tilt"].append(tilt)
        self.samples["poss"].append(poss)

    def fit(self):
        self.mu = {k: statistics.mean(v) for k, v in self.samples.items()}
        self.sd = {k: (statistics.pstdev(v) or 1.0) for k, v in self.samples.items()}

    def index(self, xg, tilt, poss):
        z = lambda k, v: (v - self.mu[k]) / self.sd[k]
        return W_XG * z("xg", xg) + W_TILT * z("tilt", tilt) + W_POSS * z("poss", poss)


def rolling_windows(ev, w):
    """Yield (t0_pre, t_mid, t1_post) for adjacent window pairs inside one half."""
    if not ev:
        return
    lo, hi = ev_time(ev[0]), ev_time(ev[-1])
    t = lo + w
    while t + w <= hi:
        yield t - w, t, t + w
        t += 60


def analyse(root, window, verbose=True):
    matches = load_group_matches(root)
    zs = Zscorer()
    per_match = []

    # pass 1: collect matches, detected breaks, and every rolling window sample
    for mid, d in matches:
        home_id, away_id = d["home"]["teamId"], d["away"]["teamId"]
        rec = dict(id=mid, home=d["home"]["name"], away=d["away"]["name"],
                   venue=(d.get("wc_metadata") or {}).get("venue"),
                   home_id=home_id, away_id=away_id, halves={}, breaks={})
        for half, (lo, hi), key in (("FirstHalf", H1_WIN, 1), ("SecondHalf", H2_WIN, 2)):
            ev = half_events(d, half)
            rec["halves"][half] = ev
            br = find_break(ev, lo, hi)
            if br:
                rec["breaks"][key] = dict(start=br[0], end=br[1], dur=br[2],
                                          confirmed=br[2] >= MIN_BREAK_GAP)
            for t0, tm, t1 in rolling_windows(ev, window):
                if br and not (t1 <= br[0] or t0 >= br[1]):
                    continue  # window pair overlaps the break itself
                for a, b in ((t0, tm), (tm, t1)):
                    win = window_stats(ev, a, b, home_id, away_id)
                    zs.add(*momentum_components(win, home_id, away_id, window / 60))
        per_match.append(rec)
    zs.fit()

    def diff_index(ev, t0, t1, home_id, away_id):
        win = window_stats(ev, t0, t1, home_id, away_id)
        mh = zs.index(*momentum_components(win, home_id, away_id, window / 60))
        ma = zs.index(*momentum_components(win, away_id, home_id, window / 60))
        return mh, ma, win

    # pass 2: baseline churn distribution |D(t+w)-D(t)| away from the breaks
    baseline = []
    for rec in per_match:
        for half in ("FirstHalf", "SecondHalf"):
            ev = rec["halves"][half]
            brs = [b for k, b in rec["breaks"].items()]
            for t0, tm, t1 in rolling_windows(ev, window):
                if any(not (t1 <= b["start"] or t0 >= b["end"]) for b in brs):
                    continue
                mh0, ma0, _ = diff_index(ev, t0, tm, rec["home_id"], rec["away_id"])
                mh1, ma1, _ = diff_index(ev, tm, t1, rec["home_id"], rec["away_id"])
                baseline.append(abs((mh1 - ma1) - (mh0 - ma0)))
    b_mu, b_sd = statistics.mean(baseline), statistics.pstdev(baseline)

    # pass 3: break-window shifts, pace deltas, dominance response
    results = {1: [], 2: []}
    pace = {1: [], 2: []}
    dominance = {1: [], 2: []}
    for rec in per_match:
        for key, half in ((1, "FirstHalf"), (2, "SecondHalf")):
            br = rec["breaks"].get(key)
            if not br:
                continue
            ev = rec["halves"][half]
            hid, aid = rec["home_id"], rec["away_id"]
            pre0, pre1 = br["start"] - window, br["start"]
            post0, post1 = br["end"], br["end"] + window
            mh0, ma0, wpre = diff_index(ev, pre0, pre1, hid, aid)
            mh1, ma1, wpost = diff_index(ev, post0, post1, hid, aid)
            shift = abs((mh1 - ma1) - (mh0 - ma0))
            results[key].append(dict(id=rec["id"], shift=shift, dur=br["dur"],
                                     confirmed=br["confirmed"],
                                     start_min=round(br["start"] / 60, 1)))

            minutes = window / 60
            row = {}
            for name, fn in (
                ("passes_pm", lambda w: (w[hid]["passes"] + w[aid]["passes"]) / minutes),
                ("touches_pm", lambda w: (w[hid]["touches"] + w[aid]["touches"]) / minutes),
                ("ft_entries_pm", lambda w: (w[hid]["ft_entries"] + w[aid]["ft_entries"]) / minutes),
            ):
                row[name] = (fn(wpre), fn(wpost))
            row["ppda_raw"] = tuple(
                (w[hid]["buildup_passes"] + w[aid]["buildup_passes"],
                 w[hid]["def_actions"] + w[aid]["def_actions"]) for w in (wpre, wpost))
            pace[key].append(row)

            # dominant side: scoreline first, else pre-window momentum index
            score = window_stats(ev, 0, br["start"], hid, aid)
            full = json_goals_before(rec, half, br["start"])
            gh, ga = full
            if gh != ga:
                dom, sub = (hid, aid) if gh > ga else (aid, hid)
                how = "scoreline"
            else:
                dom, sub = (hid, aid) if mh0 >= ma0 else (aid, hid)
                how = "momentum"
            d_dom = (mh1 - mh0) if dom == hid else (ma1 - ma0)
            d_sub = (ma1 - ma0) if dom == hid else (mh1 - mh0)
            dominance[key].append(dict(id=rec["id"], how=how,
                                       dom_delta=d_dom, sub_delta=d_sub))

    summary = dict(matches=len(per_match),
                   window_seconds=window,
                   baseline=dict(n=len(baseline), mean=b_mu, sd=b_sd),
                   breaks={}, pace={}, dominance={})
    for key in (1, 2):
        rows = results[key]
        confirmed = [r for r in rows if r["confirmed"]]
        shifts = [r["shift"] for r in rows]
        summary["breaks"][key] = dict(
            detected=len(rows), confirmed=len(confirmed),
            mean_start_min=round(statistics.mean(r["start_min"] for r in rows), 1) if rows else None,
            mean_shift=statistics.mean(shifts) if shifts else None,
            pct_above_mean=100 * sum(s > b_mu for s in shifts) / len(shifts) if shifts else None,
            pct_above_1sd=100 * sum(s > b_mu + b_sd for s in shifts) / len(shifts) if shifts else None,
            pct_above_2sd=100 * sum(s > b_mu + 2 * b_sd for s in shifts) / len(shifts) if shifts else None,
        )
        pr = pace[key]
        pool = {}
        for name in ("passes_pm", "touches_pm", "ft_entries_pm"):
            pre = statistics.mean(r[name][0] for r in pr)
            post = statistics.mean(r[name][1] for r in pr)
            slower = 100 * sum(r[name][1] < r[name][0] for r in pr) / len(pr)
            pool[name] = dict(pre=pre, post=post, pct_matches_lower=slower)
        pn_pre = sum(r["ppda_raw"][0][0] for r in pr); pd_pre = sum(r["ppda_raw"][0][1] for r in pr)
        pn_post = sum(r["ppda_raw"][1][0] for r in pr); pd_post = sum(r["ppda_raw"][1][1] for r in pr)
        pool["ppda_pooled"] = dict(pre=pn_pre / pd_pre if pd_pre else None,
                                   post=pn_post / pd_post if pd_post else None)
        summary["pace"][key] = pool
        dr = dominance[key]
        summary["dominance"][key] = dict(
            n=len(dr),
            dom_mean_delta=statistics.mean(r["dom_delta"] for r in dr),
            sub_mean_delta=statistics.mean(r["sub_delta"] for r in dr),
            pct_dom_declined=100 * sum(r["dom_delta"] < 0 for r in dr) / len(dr),
            pct_dom_worse_than_sub=100 * sum(r["dom_delta"] < r["sub_delta"] for r in dr) / len(dr),
            by_scoreline=dict(
                n=sum(r["how"] == "scoreline" for r in dr),
                dom_mean=_mean_or_none([r["dom_delta"] for r in dr if r["how"] == "scoreline"]),
                sub_mean=_mean_or_none([r["sub_delta"] for r in dr if r["how"] == "scoreline"]),
                pct_dom_worse=_pct_or_none([r["dom_delta"] < r["sub_delta"] for r in dr if r["how"] == "scoreline"]),
            ))

    if verbose:
        print(json.dumps(summary, indent=2, default=float))
    return summary, results, pace, dominance


def _mean_or_none(v):
    return statistics.mean(v) if v else None


def _pct_or_none(v):
    return 100 * sum(v) / len(v) if v else None


def json_goals_before(rec, half, t_cut):
    """Goals for home/away up to t_cut (H2 counts include all of H1)."""
    gh = ga = 0
    halves = ["FirstHalf"] if half == "FirstHalf" else ["FirstHalf", "SecondHalf"]
    for h in halves:
        for e in rec["halves"][h]:
            if h == half and ev_time(e) >= t_cut:
                break
            if (e.get("type") or {}).get("displayName") != "Goal":
                continue
            credit = e.get("teamId")
            if is_own_goal(e):
                credit = rec["away_id"] if credit == rec["home_id"] else rec["home_id"]
            if credit == rec["home_id"]:
                gh += 1
            else:
                ga += 1
    return gh, ga


# ---------------------------------------------------------------------------
# Dashboard export — everything below feeds wc2026_dashboard/build_breaks.py
# (breaks.js / window.WC_BREAKS). Same math as analyse() above, but per-window
# (5/7/10 min), for ALL played matches, plus the per-match momentum series and
# the regression-to-mean control. The baseline/Zscorer stay fitted on the
# GROUP STAGE only so the dashboard numbers keep matching this CLI and
# COOLING_BREAK_ANALYSIS.md as knockout games land.

EXPORT_WINDOWS = (300, 420, 600)
MIN_CLAMPED = 180        # a clamped pre/post window shorter than this is dropped
_HALF_KEYS = ((1, "FirstHalf", H1_WIN), (2, "SecondHalf", H2_WIN))


def load_played_matches(root):
    """Every finished match with events, any stage -> [(id, data, stage_code)].
    Unlike load_group_matches this keeps knockout games; stage codes come from
    _stage_code (stage string + slot-coded id, see above)."""
    from build_match_details import is_match_file  # via the sys.path insert above
    out = []
    for p in sorted(glob.glob(os.path.join(root, "wc2026", "matches", "*.json"))):
        if not is_match_file(p):
            continue
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(d, dict) or not d.get("events"):
            continue
        if (d.get("home") or {}).get("score") is None or (d.get("away") or {}).get("score") is None:
            continue
        mid = os.path.basename(p)[:-5]
        out.append((mid, d, _stage_code((d.get("wc_metadata") or {}).get("stage"), mid)))
    return out


def _rec_for_export(mid, d, st):
    from build_match_details import norm
    hid, aid = d["home"]["teamId"], d["away"]["teamId"]
    rec = dict(id=mid, st=st, date=(d.get("wc_metadata") or {}).get("date"),
               h=norm(d["home"]["name"]), a=norm(d["away"]["name"]),
               hs=d["home"]["score"], as_=d["away"]["score"],
               home_id=hid, away_id=aid, halves={}, times={}, breaks={})
    for key, half, win in _HALF_KEYS:
        ev = half_events(d, half)
        rec["halves"][half] = ev
        rec["times"][half] = [ev_time(e) for e in ev]
        br = find_break(ev, *win)
        if br:
            rec["breaks"][key] = dict(start=br[0], end=br[1], dur=br[2],
                                      conf=1 if br[2] >= MIN_BREAK_GAP else 0)
    return rec


def _win_slice(rec, half, t0, t1):
    """Events of `half` with t0 <= time < t1 (bisect on the precomputed times,
    so the rolling passes don't rescan the whole half per window)."""
    times = rec["times"][half]
    return rec["halves"][half][bisect.bisect_left(times, t0):bisect.bisect_left(times, t1)]


def _pair_index(zs, rec, half, t0, t1):
    """(home_index, away_index, raw window stats) for one window."""
    win = window_stats(_win_slice(rec, half, t0, t1), t0, t1,
                       rec["home_id"], rec["away_id"])
    minutes = (t1 - t0) / 60.0
    mh = zs.index(*momentum_components(win, rec["home_id"], rec["away_id"], minutes))
    ma = zs.index(*momentum_components(win, rec["away_id"], rec["home_id"], minutes))
    return mh, ma, win


def _fit_group(group, w):
    """Zscorer over every rolling window of the group-stage matches (same
    sampling as analyse() pass 1: home-perspective components, break excluded)."""
    zs = Zscorer()
    for rec in group:
        for key, half, _win in _HALF_KEYS:
            ev = rec["halves"][half]
            br = rec["breaks"].get(key)
            for t0, tm, t1 in rolling_windows(ev, w):
                if br and not (t1 <= br["start"] or t0 >= br["end"]):
                    continue
                for a, b in ((t0, tm), (tm, t1)):
                    win = window_stats(_win_slice(rec, half, a, b), a, b,
                                       rec["home_id"], rec["away_id"])
                    zs.add(*momentum_components(win, rec["home_id"], rec["away_id"], w / 60))
    zs.fit()
    return zs


def _rolling_pairs(rec, half, w):
    """Adjacent rolling window pairs of `half` that don't overlap a break."""
    brs = list(rec["breaks"].values())
    for t0, tm, t1 in rolling_windows(rec["halves"][half], w):
        if any(not (t1 <= b["start"] or t0 >= b["end"]) for b in brs):
            continue
        yield t0, tm, t1


def _baseline(group, zs, w):
    """|D(t+w) - D(t)| churn distribution away from the breaks."""
    vals = []
    for rec in group:
        for _key, half, _win in _HALF_KEYS:
            for t0, tm, t1 in _rolling_pairs(rec, half, w):
                mh0, ma0, _ = _pair_index(zs, rec, half, t0, tm)
                mh1, ma1, _ = _pair_index(zs, rec, half, tm, t1)
                vals.append(abs((mh1 - ma1) - (mh0 - ma0)))
    return vals


def _control_dom_sub(group, zs, w):
    """Regression-to-mean control: the dominant side's mean index change across
    random (non-break) adjacent window pairs, same scoreline-first rule as the
    break analysis. This is what the break effect must beat to be causal."""
    dom, sub = [], []
    for rec in group:
        for _key, half, _win in _HALF_KEYS:
            for t0, tm, t1 in _rolling_pairs(rec, half, w):
                mh0, ma0, _ = _pair_index(zs, rec, half, t0, tm)
                mh1, ma1, _ = _pair_index(zs, rec, half, tm, t1)
                gh, ga = json_goals_before(rec, half, tm)
                dom_home = (gh > ga) if gh != ga else (mh0 >= ma0)
                dom.append((mh1 - mh0) if dom_home else (ma1 - ma0))
                sub.append((ma1 - ma0) if dom_home else (mh1 - mh0))
    return dict(dom=round(statistics.mean(dom), 3),
                sub=round(statistics.mean(sub), 3), n=len(dom))


def _series_points(rec, zs, w):
    """Trailing-window momentum differential (home - away) at 1-min steps."""
    pts = []
    for _key, half, _win in _HALF_KEYS:
        ev = rec["halves"][half]
        if not ev:
            continue
        lo, hi = ev_time(ev[0]), ev_time(ev[-1])
        t = lo + w
        while t <= hi:
            mh, ma, _ = _pair_index(zs, rec, half, t - w, t)
            pts.append([round(t / 60, 1), round(mh - ma, 2)])
            t += 60
    return pts


def _goal_rows(rec):
    rows = []
    for _key, half, _win in _HALF_KEYS:
        for e in rec["halves"][half]:
            if (e.get("type") or {}).get("displayName") != "Goal":
                continue
            side = "h" if e.get("teamId") == rec["home_id"] else "a"
            og = 1 if is_own_goal(e) else 0
            if og:
                side = "a" if side == "h" else "h"
            pen = 1 if any((q.get("type") or {}).get("displayName") == "Penalty"
                           for q in e.get("qualifiers") or []) else 0
            rows.append(dict(m=round(ev_time(e) / 60, 1), s=side, og=og, pen=pen))
    return rows


def _break_block(rec, half, br, zs, w):
    """Pre/post stats for one break at one window length, or None when a half
    boundary leaves less than MIN_CLAMPED seconds of play on either side."""
    ev = rec["halves"][half]
    if not ev:
        return None
    lo, hi = ev_time(ev[0]), ev_time(ev[-1])
    pre0, pre1 = max(lo, br["start"] - w), br["start"]
    post0, post1 = br["end"], min(hi, br["end"] + w)
    if pre1 - pre0 < MIN_CLAMPED or post1 - post0 < MIN_CLAMPED:
        return None
    mh0, ma0, wpre = _pair_index(zs, rec, half, pre0, pre1)
    mh1, ma1, wpost = _pair_index(zs, rec, half, post0, post1)
    hid, aid = rec["home_id"], rec["away_id"]
    mins = ((pre1 - pre0) / 60.0, (post1 - post0) / 60.0)

    def rate(name):
        return [round((w_[hid][name] + w_[aid][name]) / m_, 2)
                for w_, m_ in zip((wpre, wpost), mins)]

    return dict(
        sh=round(abs((mh1 - ma1) - (mh0 - ma0)), 2),
        m=[round(v, 2) for v in (mh0, ma0, mh1, ma1)],
        pace=dict(pas=rate("passes"), tou=rate("touches"), fte=rate("ft_entries"),
                  ppda=[[w_[hid]["buildup_passes"] + w_[aid]["buildup_passes"],
                         w_[hid]["def_actions"] + w_[aid]["def_actions"]]
                        for w_ in (wpre, wpost)]))


def export_breaks(root, windows=EXPORT_WINDOWS):
    """The window.WC_BREAKS payload (minus team colors, which are a dashboard
    concern added by build_breaks.py). See build_breaks.py for the schema."""
    recs = [_rec_for_export(mid, d, st) for mid, d, st in load_played_matches(root)]
    group = [r for r in recs if r["st"] == "G"]
    base, zss = {}, {}
    for w in windows:
        zs = _fit_group(group, w)
        zss[w] = zs
        vals = _baseline(group, zs, w)
        base[str(w)] = dict(mu=round(statistics.mean(vals), 3),
                            sd=round(statistics.pstdev(vals), 3), n=len(vals),
                            ctrl=_control_dom_sub(group, zs, w))
    matches = []
    for rec in recs:
        h1, h2 = rec["halves"]["FirstHalf"], rec["halves"]["SecondHalf"]
        m = {"id": rec["id"], "d": rec["date"], "st": rec["st"],
             "h": rec["h"], "a": rec["a"], "hs": rec["hs"], "as": rec["as_"],
             "ht": round(ev_time(h1[-1]) / 60, 1) if h1 else 45,
             "end": round(ev_time(h2[-1]) / 60, 1) if h2 else 90,
             "goals": _goal_rows(rec),
             "series": {str(w): _series_points(rec, zss[w], w) for w in windows},
             "breaks": []}
        for key, half, _win in _HALF_KEYS:
            br = rec["breaks"].get(key)
            if not br:
                continue
            gh, ga = json_goals_before(rec, half, br["start"])
            m["breaks"].append(dict(
                n=key, s=round(br["start"] / 60, 1), e=round(br["end"] / 60, 1),
                dur=br["dur"], conf=br["conf"], gh=gh, ga=ga,
                w={str(w): _break_block(rec, half, br, zss[w], w) for w in windows}))
        matches.append(m)
    return dict(meta=dict(windows=list(windows), base=base), matches=matches)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--window", type=int, default=WINDOW)
    ap.add_argument("--json", help="write full summary JSON here")
    ap.add_argument("--export", help="write the breaks.js payload (export_breaks) JSON here")
    args = ap.parse_args()
    root = os.path.join(os.path.dirname(__file__), "..")
    if args.export:
        json.dump(export_breaks(root), open(args.export, "w"), indent=1, default=float)
    else:
        summary, results, pace, dominance = analyse(root, args.window)
        if args.json:
            json.dump(dict(summary=summary, breaks=results, dominance=dominance),
                      open(args.json, "w"), indent=2, default=float)
