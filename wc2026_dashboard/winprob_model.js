/* Canonical browser port of live-pipeline/tradepipe/model.py (v3).
 *
 * SOURCE OF TRUTH: rshiri.github.io/live-pipeline/web/winprob_model.js.
 * calibrate.py copies this file into every dashboard next to the
 * winprob_params.js it generates, so the EPL, La Liga and World Cup match
 * pages all price with the same code as the Python pipeline instead of
 * three separately-drifting reimplementations of it.
 *
 * Everything is driven by window.WINPROB_PARAMS; nothing here is tuned by
 * hand. Missing v3 keys fall back to neutral values, so a page still
 * holding a v2 params file keeps working and simply prices the old way.
 *
 *     lam_rem(t) = rem(t) * ((1 - w) * lam_pre + w * 90 * pace) * adj
 *
 * with rem(t) the fitted remaining-scoring profile (falling back to the
 * straight line (90 - t)/90), pace the xG of the last `window` minutes per
 * minute, and adj the score-state and red-card multipliers. The grid is
 * Poisson with the Dixon-Coles low-score correction.
 */
(function (global) {
  "use strict";

  function cfg(P) {
    P = P || {};
    var red = P.red || {};
    return {
      mu: P.mu, hfa: P.hfa == null ? 1 : P.hfa, teams: P.teams || {},
      w: P.w == null ? 0.05 : P.w,
      window: P.window || 15,
      profile: P.profile || null,
      rho: P.rho || 0,
      bLead: P.bLead || 0,
      bTrail: P.bTrail || 0,
      redSelf: red.self == null ? 1 : red.self,
      redOpp: red.opp == null ? 1 : red.opp,
      maxGoals: P.maxGoals || 10,
      lamFloor: P.lamFloor == null ? 0.05 : P.lamFloor
    };
  }

  /* Share of a match's scoring still ahead at minute t. Fractional minutes
     interpolate, because the charts sample just before a goal minute to
     keep the jump sharp. */
  function remainingFraction(t, profile) {
    if (t >= 90) return 0;
    if (t < 0) t = 0;
    if (!profile || !profile.length) return (90 - t) / 90;
    var i = Math.floor(t), lo = profile[i];
    var hi = i + 1 < profile.length ? profile[i + 1] : 0;
    return lo + (hi - lo) * (t - i);
  }

  /* Dixon-Coles correction: independent Poissons misprice the corner where
     both sides score at most once. Only those four cells move. rho > 0 —
     the fitted direction here — damps the low-score draws (0-0, 1-1) and
     lifts the one-goal wins; rho < 0 is the reverse. */
  function tau(i, j, lamH, lamA, rho) {
    if (!rho || i > 1 || j > 1) return 1;
    if (i === 0 && j === 0) return Math.max(0, 1 - lamH * lamA * rho);
    if (i === 0 && j === 1) return Math.max(0, 1 + lamH * rho);
    if (i === 1 && j === 0) return Math.max(0, 1 + lamA * rho);
    return Math.max(0, 1 - rho);
  }

  function poissonTable(lam, maxGoals) {
    var a = [Math.exp(-lam)];
    for (var k = 1; k <= maxGoals; k++) a.push(a[k - 1] * lam / k);
    return a;
  }

  /* A leading side protects its lead and creates less; a trailing side
     chases and creates more. This is what the old momentum weight was
     really picking up. */
  function scoreStateFactors(h, a, bLead, bTrail) {
    var d = h - a;
    if (d === 0 || (!bLead && !bTrail)) return [1, 1];
    var lead = Math.exp(bLead), trail = Math.exp(bTrail);
    return d > 0 ? [lead, trail] : [trail, lead];
  }

  function redCardFactors(redH, redA, self, opp) {
    var fh = 1, fa = 1, i;
    for (i = 0; i < (redH || 0); i++) { fh *= self; fa *= opp; }
    for (i = 0; i < (redA || 0); i++) { fa *= self; fh *= opp; }
    return [fh, fa];
  }

  /* A model bound to one fixture. `state(t)` must return
     {scoreH, scoreA, xgH, xgA, redH, redA} where xgH/xgA are that side's xG
     over the last `window` minutes — the caller owns the event stream, so
     it owns the windowing. */
  function Model(params, lamHPre, lamAPre) {
    this.p = cfg(params);
    this.lamHPre = lamHPre;
    this.lamAPre = lamAPre;
  }

  /* `st.horizon` overrides the remaining-scoring share for clocks that run
     past 90' (stoppage, extra time), where the fitted profile — defined on
     the 90-minute market clock — does not apply. */
  Model.prototype.lams = function (t, st) {
    var p = this.p;
    var frac = st.horizon == null ? remainingFraction(t, p.profile) : st.horizon;
    function one(pre, xgRecent) {
      var lam = frac * ((1 - p.w) * pre + p.w * 90 * (xgRecent / p.window));
      return Math.max(lam, p.lamFloor * frac);
    }
    var lamH = one(this.lamHPre, st.xgH || 0);
    var lamA = one(this.lamAPre, st.xgA || 0);
    var ss = scoreStateFactors(st.scoreH || 0, st.scoreA || 0, p.bLead, p.bTrail);
    var rc = redCardFactors(st.redH, st.redA, p.redSelf, p.redOpp);
    return [lamH * ss[0] * rc[0], lamA * ss[1] * rc[1]];
  };

  /* [P(home win), P(draw), P(away win)] at minute t. */
  Model.prototype.probsAt = function (t, st) {
    var p = this.p, MG = p.maxGoals;
    var lams = this.lams(t, st);
    var ph = poissonTable(lams[0], MG), pa = poissonTable(lams[1], MG);
    var cH = st.scoreH || 0, cA = st.scoreA || 0;
    var pH = 0, pD = 0, pA = 0, tot = 0;
    for (var i = 0; i <= MG; i++) {
      for (var j = 0; j <= MG; j++) {
        var pr = ph[i] * pa[j] * tau(i, j, lams[0], lams[1], p.rho);
        tot += pr;
        var d = cH + i - cA - j;
        if (d > 0) pH += pr; else if (d < 0) pA += pr; else pD += pr;
      }
    }
    return [pH / tot, pD / tot, pA / tot];   // renormalise the truncated grid
  };

  /* Pre-match lambdas for two named teams. `neutral` drops the home-field
     boost — every World Cup venue is neutral. */
  function prematchLams(params, homeName, awayName) {
    var p = cfg(params);
    var mu = p.mu, hfa = params && params.neutral ? 1 : p.hfa;
    function T(name) { return p.teams[name] || { att: mu, def: mu }; }
    var th = T(homeName), ta = T(awayName);
    return [th.att * ta.def / mu * hfa, ta.att * th.def / mu / hfa];
  }

  /* Convenience: build a Model straight from window.WINPROB_PARAMS. */
  function forMatch(params, homeName, awayName) {
    var lams = prematchLams(params, homeName, awayName);
    return new Model(params, lams[0], lams[1]);
  }

  global.WinProb = {
    Model: Model,
    forMatch: forMatch,
    prematchLams: prematchLams,
    remainingFraction: remainingFraction,
    scoreStateFactors: scoreStateFactors,
    redCardFactors: redCardFactors,
    tau: tau,
    version: 3
  };
})(window);
