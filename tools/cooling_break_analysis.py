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
import glob
import json
import os
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


def load_group_matches(root):
    out = []
    for p in sorted(glob.glob(os.path.join(root, "wc2026", "matches", "*.json"))):
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(d, dict):
            continue
        if (d.get("wc_metadata") or {}).get("stage") != "Group Stage":
            continue
        if not d.get("events"):
            continue
        out.append((os.path.basename(p)[:-5], d))
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
            s[tid]["xg"] += shot_xg(e)[0]
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


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--window", type=int, default=WINDOW)
    ap.add_argument("--json", help="write full summary JSON here")
    args = ap.parse_args()
    root = os.path.join(os.path.dirname(__file__), "..")
    summary, results, pace, dominance = analyse(root, args.window)
    if args.json:
        json.dump(dict(summary=summary, breaks=results, dominance=dominance),
                  open(args.json, "w"), indent=2, default=float)
