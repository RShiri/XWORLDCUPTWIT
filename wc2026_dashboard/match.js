/* Interactive single-match dashboard: clickable shot map + pass explorer with a
   minute timeline. Loads matches_detail/<id>.js (set via ?id=) as a <script> tag
   so it works on file:// without fetch/CORS. */
(function () {
  "use strict";

  var LOGO = "../team_logos/wc2026/";
  var PW = 100, PH = 64; // pitch SVG units (length x width)
  var tooltip = document.getElementById("tooltip");
  // Shared soft-glow filter for chart marks — the neon-HUD signature. Duplicate <defs>
  // with the same id across multiple SVGs on the page are harmless (identical filter).
  var GLOW_DEFS = '<defs><filter id="wcGlow" x="-80%" y="-80%" width="260%" height="260%">' +
    '<feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
    "</filter></defs>";

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function logoImg(team) {
    return '<img src="' + LOGO + encodeURIComponent(team) + '.png" alt="" ' +
      'onerror="this.style.visibility=\'hidden\'">';
  }
  function qid() {
    var m = location.search.match(/[?&]id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  var id = qid();
  if (!id) { fail("No match id in the URL. Open this page from the dashboard."); return; }

  // Which edition this page shows (set by match.html's loader from ?edition=).
  // 2026 keeps today's paths; history loads from editions/<year>/.
  var ED = window.WC_EDITION || 2026;
  var ED_BASE = ED === 2026 ? "" : "editions/" + ED + "/";
  var INDEX_URL = "index.html" + (ED === 2026 ? "" : "?edition=" + ED);
  (function () {
    var y = document.querySelector(".brand .title .ed-year");
    if (y && ED !== 2026) { y.textContent = ED; document.title = "Match Dashboard — WC" + ED; }
    var back = document.getElementById("backLink");
    if (back) back.href = INDEX_URL;
  })();

  // Inject the match data file.
  var s = document.createElement("script");
  s.src = ED_BASE + "matches_detail/" + encodeURIComponent(id) + ".js?v=" + Date.now();
  s.onload = function () {
    if (window.MATCH_DETAIL) boot(window.MATCH_DETAIL);
    else fail("Match data loaded but was empty.");
  };
  s.onerror = function () { fail("No detailed data for this match (it may not have shot/pass events yet)."); };
  document.head.appendChild(s);

  function fail(msg) {
    document.getElementById("matchRoot").innerHTML =
      '<div class="card" style="text-align:center;padding:40px">' + esc(msg) +
      '<br><br><a class="back-link" href="' + INDEX_URL + '">← Back to all matches</a></div>';
  }

  /* ---- coordinate transforms (WhoScored 0-100 → pitch units) ---- */
  // Home attacks right; away is rotated 180° so it attacks left on the same pitch.
  // WhoScored y grows towards the attacker's left, so we flip it (PH - y) to match
  // the broadcast/PNG orientation; away gets the opposite flip (180° rotation).
  function tx(side, x) { return side === "home" ? x : PW - x; }
  function ty(side, y) { return side === "home" ? PH - y * (PH / 100) : y * (PH / 100); }

  /* ---- pitch markings ---- */
  function pitchMarkup() {
    var p = [];
    p.push('<rect class="pitch-bg" x="0" y="0" width="' + PW + '" height="' + PH + '" rx="1.5"/>');
    // subtle mowing stripes
    for (var i = 0; i < 10; i++) {
      if (i % 2 === 0) p.push('<rect x="' + (i * 10) + '" y="0" width="10" height="' + PH +
        '" fill="rgba(255,255,255,0.025)"/>');
    }
    var L = "pitch-line";
    p.push('<rect class="' + L + '" x="0.6" y="0.6" width="' + (PW - 1.2) + '" height="' + (PH - 1.2) + '"/>');
    p.push('<line class="' + L + '" x1="50" y1="0.6" x2="50" y2="' + (PH - 0.6) + '"/>');
    p.push('<circle class="' + L + '" cx="50" cy="32" r="8.3"/>');
    p.push('<circle cx="50" cy="32" r="0.5" fill="rgba(255,255,255,0.5)"/>');
    // boxes (left + right)
    var by1 = 13, by2 = PH - 13, sby1 = 23.4, sby2 = PH - 23.4;
    var GW1 = 28.5, GW2 = 35.5;          // goal-mouth y span
    [["L"], ["R"]].forEach(function (sd) {
      var right = sd[0] === "R";
      var bx = right ? PW - 15.7 : 0.6, sbx = right ? PW - 5.6 : 0.6;
      p.push('<rect class="' + L + '" x="' + bx + '" y="' + by1 + '" width="15.1" height="' + (by2 - by1) + '"/>');
      p.push('<rect class="' + L + '" x="' + sbx + '" y="' + sby1 + '" width="5" height="' + (sby2 - sby1) + '"/>');
      var spot = right ? PW - 10.5 : 10.5;
      p.push('<circle cx="' + spot + '" cy="32" r="0.5" fill="rgba(255,255,255,0.5)"/>');
      var gx = right ? PW - 0.6 : 0.6;
      p.push('<line class="' + L + '" x1="' + gx + '" y1="' + GW1 + '" x2="' + gx + '" y2="' + GW2 + '" stroke-width="0.8"/>');
      // penalty arc (the "D"): the slice of the 8.3-radius circle round the spot that pokes
      // out beyond the penalty box.
      var arcR = 8.3, boxEdge = right ? bx : bx + 15.1, ddx = Math.abs(boxEdge - spot);
      if (ddx < arcR) {
        var ddy = Math.sqrt(arcR * arcR - ddx * ddx), sweep = right ? 0 : 1;
        p.push('<path class="' + L + '" d="M ' + boxEdge.toFixed(2) + " " + (32 - ddy).toFixed(2) +
          " A " + arcR + " " + arcR + " 0 0 " + sweep + " " + boxEdge.toFixed(2) + " " + (32 + ddy).toFixed(2) + '"/>');
      }
      // goal frame (posts + net) just outside the goal line
      var gd = 1.6, gxOut = right ? PW - 0.6 : 0.6 - gd;
      p.push('<rect class="pitch-goal" x="' + gxOut.toFixed(2) + '" y="' + GW1 + '" width="' + gd + '" height="' + (GW2 - GW1) + '"/>');
      p.push('<line class="pitch-net" x1="' + gxOut.toFixed(2) + '" y1="32" x2="' + (gxOut + gd).toFixed(2) + '" y2="32"/>');
      p.push('<line class="pitch-net" x1="' + (gxOut + gd / 2).toFixed(2) + '" y1="' + GW1 + '" x2="' + (gxOut + gd / 2).toFixed(2) + '" y2="' + GW2 + '"/>');
    });
    return p.join("");
  }

  /* ---- goal-mouth ("behind the net") view, shared by the on-target shot map and
     the penalty-shootout map. WhoScored GoalMouthY runs across the goal (posts at
     45.2 / 54.8), GoalMouthZ is height (crossbar ≈ 38). Exposes the frame markup,
     the coordinate mappers and key frame positions. ---- */
  var GM = (function () {
    var GW = 100, GROUND = 50, GY0 = 43, GYR = 14, GZTOP = 48;
    function gxOf(gy) { return (Math.max(GY0, Math.min(GY0 + GYR, gy)) - GY0) / GYR * GW; }
    function gyOf(gz) { return GROUND - Math.max(0, Math.min(GZTOP, gz)); }
    var postL = gxOf(45.2), postR = gxOf(54.8), barY = gyOf(38);
    function frame() {
      var fr = "#eef0fb", ng = "rgba(255,255,255,0.14)", net = [];
      net.push('<rect x="-2" y="-2" width="' + (GW + 4) + '" height="' + (GROUND + 6) + '" fill="#0b0d1f"/>');
      net.push('<rect x="' + postL.toFixed(1) + '" y="' + barY.toFixed(1) + '" width="' + (postR - postL).toFixed(1) +
        '" height="' + (GROUND - barY).toFixed(1) + '" fill="rgba(255,255,255,0.04)"/>');
      for (var nx = postL; nx <= postR + 0.01; nx += 3.2)
        net.push('<line x1="' + nx.toFixed(1) + '" y1="' + barY.toFixed(1) + '" x2="' + nx.toFixed(1) + '" y2="' + GROUND + '" stroke="' + ng + '" stroke-width="0.18"/>');
      for (var ny = barY; ny <= GROUND + 0.01; ny += 3.0)
        net.push('<line x1="' + postL.toFixed(1) + '" y1="' + ny.toFixed(1) + '" x2="' + postR.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="' + ng + '" stroke-width="0.18"/>');
      net.push('<line x1="0" y1="' + GROUND + '" x2="' + GW + '" y2="' + GROUND + '" stroke="rgba(255,255,255,0.3)" stroke-width="0.4"/>');
      net.push('<line x1="' + postL.toFixed(1) + '" y1="' + GROUND + '" x2="' + postL.toFixed(1) + '" y2="' + barY.toFixed(1) + '" stroke="' + fr + '" stroke-width="1.1"/>');
      net.push('<line x1="' + postR.toFixed(1) + '" y1="' + GROUND + '" x2="' + postR.toFixed(1) + '" y2="' + barY.toFixed(1) + '" stroke="' + fr + '" stroke-width="1.1"/>');
      net.push('<line x1="' + (postL - 0.55).toFixed(1) + '" y1="' + barY.toFixed(1) + '" x2="' + (postR + 0.55).toFixed(1) + '" y2="' + barY.toFixed(1) + '" stroke="' + fr + '" stroke-width="1.1"/>');
      return net.join("");
    }
    return { GW: GW, GROUND: GROUND, gxOf: gxOf, gyOf: gyOf, postL: postL, postR: postR,
             barY: barY, frame: frame, viewBox: "-2 -2 " + (GW + 4) + " " + (GROUND + 8) };
  })();

  /* ================= BOOT ================= */
  function boot(D) {
    document.title = D.home.name + " " + D.home.score + "-" + D.away.score + " " + D.away.name + " · WC" + ED;
    document.documentElement.style.setProperty("--c-home", D.home.color);
    document.documentElement.style.setProperty("--c-away", D.away.color);

    var rec = matchRecord();                       // head-to-head team stats from data.js
    var hasStats = !!(rec && rec.stats);

    var root = document.getElementById("matchRoot");
    // Single scrolling page: every section is rendered one under the other.
    function block(title, id) {
      return '<section class="mv-block"><h2 class="mv-title">' + title + '</h2><div id="' + id + '"></div></section>';
    }
    var hasDribbles = !!(D.dribbles && D.dribbles.length);
    var hasGoals = !!(D.goals && D.goals.length);
    var hasShootout = !!(D.shootout && D.shootout.length);
    root.innerHTML = scoreboard(D) +
      (hasStats ? block("Match stats", "mv-stats") : "") +
      block("xG momentum", "mv-momentum") +
      // Live win probability sits right under the xG race — both are minute-based timelines.
      block("Win probability", "mv-winprob") +
      block("Shot map", "mv-shots") +
      // On-target shot map sits directly under the xG shot map.
      block("On-target shots", "mv-shots-ot") +
      block("Pass explorer", "mv-passes") +
      (hasDribbles ? block("Dribbles", "mv-dribbles") : "") +
      block("Pass network", "mv-network") +
      block("Average position", "mv-avgpos") +
      block("Line-ups", "mv-lineups") +
      // All Goals Map sits below every stats section.
      (hasGoals ? block("All goals map", "mv-goals") : "") +
      // Animated "movie" replays of each goal sit directly below the static map.
      (hasGoals ? block("Goal replays", "mv-goals-anim") : "") +
      // Penalty shootout (goal-mouth placement) is the last block — below all graphs.
      (hasShootout ? block("Penalty shootout", "mv-shootout") : "");

    // Share button → copy the crawler-friendly OG shim URL (share/<id>.html), which
    // unfurls with the infographic and redirects to this page. Falls back to showing the
    // URL for manual copy where the async clipboard API is unavailable (http/file://).
    var shareBtn = root.querySelector(".share-btn");
    if (shareBtn) shareBtn.addEventListener("click", function () {
      // historical shims live one level deeper: share/<edition>/<id>.html
      var url = new URL("share/" + (ED === 2026 ? "" : ED + "/") + D.id + ".html", location.href).href;
      function flash(txt) { shareBtn.textContent = txt; setTimeout(function () { shareBtn.textContent = "🔗 Share"; }, 2600); }
      if (navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText(url).then(function () { flash("✓ Link copied"); }, function () { window.prompt("Copy this link:", url); });
      else window.prompt("Copy this link:", url);
    });

    if (hasStats) buildMatchStats(rec, D);
    buildMomentum(D);
    buildWinProb(D);
    buildShots(D);
    buildOnTargetShots(D);
    buildPasses(D);
    if (hasDribbles) buildDribbles(D);
    buildNetwork(D);
    buildAvgPos(D);
    buildLineups(D);
    if (hasGoals) buildAllGoals(D);
    if (hasGoals) buildGoalReplays(D);
    if (hasShootout) buildShootout(D);
  }

  /* xG momentum — cumulative xG "race" over the 90 minutes, with goal markers.
     Each shot steps that side's line up by its xG; the steeper/higher line shows who
     built the better chances and when. Own goals carry no xG (no step) but are marked. */
  function buildMomentum(D) {
    var host = document.getElementById("mv-momentum");
    if (!host) return;
    var shots = (D.shots || []).filter(function (s) { return s.min != null; });
    if (!shots.length) { host.innerHTML = '<p class="hint">No shot data for the xG timeline.</p>'; return; }
    function tm(s) { return (s.min || 0) + (s.sec || 0) / 60; }
    shots = shots.slice().sort(function (a, b) { return tm(a) - tm(b); });
    var lastMin = Math.max.apply(null, shots.map(function (s) { return s.min || 0; }));
    (D.goals || []).forEach(function (g) { if (g.min > lastMin) lastMin = g.min; });
    var maxMin = Math.max(90, Math.ceil(lastMin / 5) * 5);
    function series(side) {
      var pts = [[0, 0]], c = 0;
      shots.forEach(function (s) { if (s.team === side) { c += s.xg; pts.push([tm(s), c]); } });
      pts.push([maxMin, c]);
      return pts;
    }
    var SH = series("home"), SA = series("away");
    var finH = SH[SH.length - 1][1], finA = SA[SA.length - 1][1];
    var maxY = Math.max(0.5, finH, finA) * 1.08;
    var colH = D.home.color || "#9d6bff", colA = D.away.color || "#ff6a3d";
    // if the two team colours are too close (e.g. both green), the lines blur together —
    // fall back to a clearly distinct blue/orange pair.
    function hex(c) { var m = /^#?([0-9a-f]{6})$/i.exec(c || ""); if (!m) return null; var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    var ch = hex(colH), ca = hex(colA);
    if (ch && ca && Math.sqrt(Math.pow(ch[0] - ca[0], 2) + Math.pow(ch[1] - ca[1], 2) + Math.pow(ch[2] - ca[2], 2)) < 90) {
      colH = "#9d6bff"; colA = "#ff6a3d";
    }
    var W = 820, HT = 360, padL = 46, padR = 16, padT = 18, padB = 42;
    var plotW = W - padL - padR, plotH = HT - padT - padB;
    function sx(m) { return padL + plotW * m / maxMin; }
    function sy(v) { return padT + plotH * (1 - v / maxY); }
    function stepPath(pts) {
      var d = "";
      pts.forEach(function (p, i) {
        if (i === 0) { d = "M " + sx(p[0]).toFixed(1) + " " + sy(p[1]).toFixed(1); }
        else { var pr = pts[i - 1]; d += " L " + sx(p[0]).toFixed(1) + " " + sy(pr[1]).toFixed(1) + " L " + sx(p[0]).toFixed(1) + " " + sy(p[1]).toFixed(1); }
      });
      return d;
    }
    function cumAt(pts, minute) { var v = 0; for (var i = 0; i < pts.length; i++) { if (pts[i][0] <= minute + 1e-9) v = pts[i][1]; else break; } return v; }
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + HT + '" class="mv-mom-chart" preserveAspectRatio="xMidYMid meet" role="img">' + GLOW_DEFS];
    // y gridlines
    var yStep = maxY <= 1 ? 0.25 : maxY <= 2 ? 0.5 : 1;
    for (var yv = 0; yv <= maxY + 1e-9; yv += yStep) {
      var y = sy(yv);
      svg.push('<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#14152e" stroke-width="1"/>');
      svg.push('<text x="' + (padL - 6) + '" y="' + (y + 3.5).toFixed(1) + '" fill="#7a7fb0" font-size="10.5" text-anchor="end">' + yv.toFixed(yStep < 1 ? 1 : 0) + "</text>");
    }
    // x ticks every 15', plus HT line at 45
    for (var xm = 0; xm <= maxMin; xm += 15) {
      svg.push('<text x="' + sx(xm).toFixed(1) + '" y="' + (HT - padB + 16) + '" fill="#7a7fb0" font-size="10.5" text-anchor="middle">' + xm + "'</text>");
    }
    svg.push('<line x1="' + sx(45).toFixed(1) + '" y1="' + padT + '" x2="' + sx(45).toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="#262c52" stroke-width="1" stroke-dasharray="3 3"/>');
    svg.push('<text x="' + (padL + plotW / 2).toFixed(1) + '" y="' + (HT - 4) + '" fill="#eef0fb" font-size="12" text-anchor="middle">Minute</text>');
    // step lines
    svg.push('<path d="' + stepPath(SA) + '" fill="none" stroke="' + colA + '" stroke-width="2.4" filter="url(#wcGlow)"/>');
    svg.push('<path d="' + stepPath(SH) + '" fill="none" stroke="' + colH + '" stroke-width="2.4" filter="url(#wcGlow)"/>');
    // goal markers
    (D.goals || []).forEach(function (g) {
      var col = g.team === "home" ? colH : colA;
      var pts = g.team === "home" ? SH : SA;
      var gx = sx(g.min), gy = sy(cumAt(pts, g.min + 1e-6));
      var gName = g.team === "home" ? D.home.name : D.away.name;
      var info = g.min + "' " + g.scorer + (g.pen ? " (pen)" : "") + (g.own ? " (OG)" : "") + " — " + gName;
      svg.push('<circle cx="' + gx.toFixed(1) + '" cy="' + gy.toFixed(1) + '" r="5" fill="' + col + '" stroke="#050611" stroke-width="1.2" filter="url(#wcGlow)" data-info="' + esc(info) + '"></circle>');
      svg.push('<text x="' + gx.toFixed(1) + '" y="' + (gy - 9).toFixed(1) + '" fill="' + col + '" font-size="11" text-anchor="middle">⚽</text>');
    });
    svg.push("</svg>");
    var legend = '<div class="mv-mom-legend">' +
      '<span><i style="background:' + colH + '"></i>' + esc(D.home.name) + " — <b>" + finH.toFixed(2) + "</b> xG (" + (D.home.score == null ? "-" : D.home.score) + " goals)</span>" +
      '<span><i style="background:' + colA + '"></i>' + esc(D.away.name) + " — <b>" + finA.toFixed(2) + "</b> xG (" + (D.away.score == null ? "-" : D.away.score) + " goals)</span>" +
      "</div>";
    host.innerHTML = '<p class="hint">Cumulative <b>expected goals</b> over the match — each step is a shot, sized by its xG. ' +
      'The higher line built the better chances; ⚽ marks goals (tap one for the scorer).</p>' +
      '<div class="mv-mom-wrap">' + svg.join("") + "</div>" + legend +
      '<div class="chart-tip" id="mvMomTip"></div>';
    var tip = document.getElementById("mvMomTip");
    function isDot(el) { return el && (el.tagName || "").toLowerCase() === "circle" && el.hasAttribute("data-info"); }
    function momHTML(info) {
      var i = info.indexOf(" — "), a = i >= 0 ? info.slice(0, i) : info, bb = i >= 0 ? info.slice(i + 3) : "";
      return '<div class="t-team">' + esc(a) + "</div>" + (bb ? '<div class="t-line">' + esc(bb) + "</div>" : "");
    }
    // desktop hover: floating tooltip like every other match-page chart
    host.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      if (isDot(e.target)) showTip(e, momHTML(e.target.getAttribute("data-info"))); else hideTip();
    });
    host.addEventListener("pointerleave", hideTip);
    // touch tap: caption line under the chart
    host.addEventListener("click", function (e) {
      if (isDot(e.target)) { tip.textContent = e.target.getAttribute("data-info"); tip.classList.add("show"); }
    });
  }

  /* Live win probability — a betting-style "who wins?" timeline. Each side's line is seeded at
     kickoff from the FIFA-ranking gap (the favourite starts higher), then re-estimated every
     minute from the running score + live xG through a double-Poisson outcome model. It converges
     to the actual result by full time (a level knockout resolves to the shootout winner).
     Knockouts fold the draw 50/50 into the two team lines; group games add a grey Draw line. */
  function buildWinProb(D) {
    var host = document.getElementById("mv-winprob");
    if (!host) return;
    var shots = (D.shots || []).filter(function (s) { return s.min != null; });
    if (!shots.length) { host.innerHTML = '<p class="hint">No shot data for the win-probability timeline.</p>'; return; }
    function tm(s) { return (s.min || 0) + (s.sec || 0) / 60; }
    shots = shots.slice().sort(function (a, b) { return tm(a) - tm(b); });
    var lastMin = Math.max.apply(null, shots.map(function (s) { return s.min || 0; }));
    (D.goals || []).forEach(function (g) { if (g.min > lastMin) lastMin = g.min; });
    var maxMin = Math.max(90, Math.ceil(lastMin / 5) * 5);
    var isKO = /round of|quarter|semi|final|3rd place|third place|play-?off/i.test(D.stage || "");

    // ---- model constants ----
    var HALF_MU = 1.35, GOAL_PER_ELO = 0.006, HFA = 0.10, T0 = 25;
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function poisson(k, lam) { var f = 1; for (var i = 2; i <= k; i++) f *= i; return Math.exp(-lam) * Math.pow(lam, k) / f; }
    // double-Poisson over remaining goals, offset by the current score → P(final H/D/A)
    function P3(muH, muA, cH, cA) {
      var pW = 0, pD = 0, pL = 0;
      for (var i = 0; i <= 8; i++) for (var j = 0; j <= 8; j++) {
        var p = poisson(i, muH) * poisson(j, muA);
        var fh = cH + i, fa = cA + j;
        if (fh > fa) pW += p; else if (fh === fa) pD += p; else pL += p;
      }
      return [pW, pD, pL];
    }
    var FIFA = window.FIFA_PTS || {};
    function fifa(name) { return FIFA[name] || 1400; }

    // pre-match seed λ from the ranking gap
    var sup = GOAL_PER_ELO * (fifa(D.home.name) - fifa(D.away.name));
    var lamH0 = clamp(HALF_MU + sup / 2 + HFA / 2, 0.15, 4);
    var lamA0 = clamp(HALF_MU - sup / 2 - HFA / 2, 0.15, 4);
    var baseRateH = lamH0 / 90, baseRateA = lamA0 / 90;

    // cumulative xG up to a given minute, per side
    function xgUpTo(side, t) { var c = 0; for (var i = 0; i < shots.length; i++) { if (tm(shots[i]) <= t + 1e-9) { if (shots[i].team === side) c += shots[i].xg; } else break; } return c; }
    function goalsUpTo(side, t) { var c = 0; (D.goals || []).forEach(function (g) { if (g.team === side && g.min <= t + 1e-9) c++; }); return c; }

    // win-prob (home,away,draw) at minute t
    function wpAt(t) {
      var R = Math.max(0, maxMin - t);
      var cH = goalsUpTo("home", t), cA = goalsUpTo("away", t);
      var xgRH = t > 0 ? xgUpTo("home", t) / t : baseRateH;
      var xgRA = t > 0 ? xgUpTo("away", t) / t : baseRateA;
      var w = t / (t + T0);
      var rateH = (1 - w) * baseRateH + w * xgRH, rateA = (1 - w) * baseRateA + w * xgRA;
      // Game state: a side chasing a deficit pushes (rate up ~25% per goal down, capped
      // at two), the side protecting a lead manages the game (rate down ~15%). Without
      // this, a trailing team is priced off its own starved in-match xG — France '26 SF
      // (0.40 xG all game) flat-lined at 0% from the second goal, which no in-play
      // model would show while a comeback was still mathematically live.
      var d = cH - cA;
      if (d < 0) { rateH *= 1 + 0.25 * Math.min(2, -d); rateA *= 0.85; }
      else if (d > 0) { rateA *= 1 + 0.25 * Math.min(2, d); rateH *= 0.85; }
      // Residual threat: blended rates never drop below half the pre-match base — a
      // World Cup side always carries some chance of the next goal, however blunt its
      // xG has been so far.
      rateH = Math.max(rateH, 0.5 * baseRateH);
      rateA = Math.max(rateA, 0.5 * baseRateA);
      var pr = P3(clamp(rateH, 0, 10) * R, clamp(rateA, 0, 10) * R, cH, cA);
      var pW = pr[0], pD = pr[1], pL = pr[2];
      if (isKO) return [(pW + pD / 2) * 100, (pL + pD / 2) * 100, 0];
      return [pW * 100, pL * 100, pD * 100];
    }
    // Display honesty: a live 0.6% is a sliver reading "<1%", never a flat 0 glued to
    // the axis — only the full-time endpoint may sit at a true 0/100.
    function liveCl(v) { return Math.max(0.8, Math.min(99.2, v)); }
    function fmtPct(p) { return p > 0 && p < 1 ? "<1" : p > 99 && p < 100 ? ">99" : String(Math.round(p)); }

    // sample every minute + a sharp kink either side of each goal minute
    var goalMins = {};
    (D.goals || []).forEach(function (g) { goalMins[g.min] = true; });
    var times = [];
    for (var t = 0; t <= maxMin; t++) {
      if (goalMins[t] && t > 0) times.push(t - 0.001);
      times.push(t);
    }
    var ptsH = [], ptsA = [], ptsD = [];
    times.forEach(function (tt) { var wp = wpAt(tt); ptsH.push([tt, liveCl(wp[0])]); ptsA.push([tt, liveCl(wp[1])]); ptsD.push([tt, wp[2]]); });

    // force the endpoint to the true result (level KO → shootout winner)
    var finH, finA;
    var hs = D.home.score, as = D.away.score;
    if (hs != null && as != null && hs !== as) { finH = hs > as ? 100 : 0; finA = 100 - finH; }
    else if (isKO && D.home.pens != null && D.away.pens != null) { finH = D.home.pens > D.away.pens ? 100 : 0; finA = 100 - finH; }
    else { var lw = wpAt(maxMin); finH = lw[0]; finA = lw[1]; }
    if (finH === 100 || finH === 0) {   // decided (on goals or pens) → snap the lines to the truth
      ptsH[ptsH.length - 1] = [maxMin, finH]; ptsA[ptsA.length - 1] = [maxMin, finA];
    }
    var finD = isKO ? 0 : ptsD[ptsD.length - 1][1];

    // ---- colours (reuse the momentum blue/orange fallback for near-identical kits) ----
    var colH = D.home.color || "#9d6bff", colA = D.away.color || "#ff6a3d";
    function hex(c) { var m = /^#?([0-9a-f]{6})$/i.exec(c || ""); if (!m) return null; var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    var ch = hex(colH), ca = hex(colA);
    if (ch && ca && Math.sqrt(Math.pow(ch[0] - ca[0], 2) + Math.pow(ch[1] - ca[1], 2) + Math.pow(ch[2] - ca[2], 2)) < 90) {
      colH = "#9d6bff"; colA = "#ff6a3d";
    }
    var colD = "#8a94ad";

    // ---- geometry (mirrors buildMomentum) ----
    var W = 820, HT = 360, padL = 46, padR = 64, padT = 18, padB = 42;
    var plotW = W - padL - padR, plotH = HT - padT - padB;
    function sx(m) { return padL + plotW * m / maxMin; }
    function sy(p) { return padT + plotH * (1 - p / 100); }
    function valAt(pts, minute) { var v = pts.length ? pts[0][1] : 0; for (var i = 0; i < pts.length; i++) { if (pts[i][0] <= minute + 1e-9) v = pts[i][1]; else break; } return v; }
    function cl(v) { return Math.max(0, Math.min(100, v)); }
    // Smooth each line WITHIN inter-goal segments (moving avg + Catmull-Rom→bézier), but keep
    // the goal jumps sharp: the series carries a t-ε pre-goal + t post-goal point, so a jump is
    // a pair with tiny Δx — we split there and join the two segments with a straight vertical L.
    function smoothD(pts) {
      var d = "", seg = [];
      function flush() {
        if (!seg.length) return;
        var ys = seg.map(function (p) { return p[1]; });
        var P = seg.map(function (p, i) {
          if (i === 0 || i === seg.length - 1) return [p[0], cl(p[1])];
          var lo = Math.max(0, i - 2), hi = Math.min(seg.length - 1, i + 2), s = 0, c = 0;
          for (var k = lo; k <= hi; k++) { s += ys[k]; c++; }
          return [p[0], cl(s / c)];
        });
        d += (d === "" ? "M " : " L ") + sx(P[0][0]).toFixed(1) + " " + sy(P[0][1]).toFixed(1);
        for (var i = 0; i < P.length - 1; i++) {
          var p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
          var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
          var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
          d += " C " + sx(c1x).toFixed(1) + " " + sy(c1y).toFixed(1) + " " + sx(c2x).toFixed(1) + " " + sy(c2y).toFixed(1) + " " + sx(p2[0]).toFixed(1) + " " + sy(p2[1]).toFixed(1);
        }
        seg = [];
      }
      for (var i = 0; i < pts.length; i++) {
        if (seg.length && Math.abs(pts[i][0] - seg[seg.length - 1][0]) < 0.5) flush();
        seg.push(pts[i]);
      }
      flush();
      return d;
    }
    var baseY = sy(0);
    function areaD(pts) { return smoothD(pts) + " L " + sx(maxMin).toFixed(1) + " " + baseY.toFixed(1) + " L " + sx(0).toFixed(1) + " " + baseY.toFixed(1) + " Z"; }

    var svg = ['<svg viewBox="0 0 ' + W + ' ' + HT + '" class="mv-mom-chart" preserveAspectRatio="xMidYMid meet" role="img">' + GLOW_DEFS];
    // vertical fade gradients for the area fills (opaque near the line → transparent at baseline)
    svg.push('<defs>' +
      '<linearGradient id="wpGradH" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + colH + '" stop-opacity="0.30"/><stop offset="1" stop-color="' + colH + '" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="wpGradA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + colA + '" stop-opacity="0.30"/><stop offset="1" stop-color="' + colA + '" stop-opacity="0"/></linearGradient>' +
      '</defs>');
    // y gridlines at 0/25/50/75/100 with a brighter 50% midline
    [0, 25, 50, 75, 100].forEach(function (yv) {
      var y = sy(yv);
      svg.push('<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="' + (yv === 50 ? "#33405f" : "#14152e") + '" stroke-width="' + (yv === 50 ? 1.3 : 1) + '"/>');
      svg.push('<text x="' + (padL - 6) + '" y="' + (y + 3.5).toFixed(1) + '" fill="#7a7fb0" font-size="10.5" text-anchor="end">' + yv + '%</text>');
    });
    // x ticks every 15' + HT dashed line at 45
    for (var xm = 0; xm <= maxMin; xm += 15) {
      svg.push('<text x="' + sx(xm).toFixed(1) + '" y="' + (HT - padB + 16) + '" fill="#7a7fb0" font-size="10.5" text-anchor="middle">' + xm + "'</text>");
    }
    svg.push('<line x1="' + sx(45).toFixed(1) + '" y1="' + padT + '" x2="' + sx(45).toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="#262c52" stroke-width="1" stroke-dasharray="3 3"/>');
    svg.push('<text x="' + (padL + plotW / 2).toFixed(1) + '" y="' + (HT - 4) + '" fill="#eef0fb" font-size="12" text-anchor="middle">Minute</text>');
    // area fills (behind the lines), then draw line (group only), away, home on top
    svg.push('<path d="' + areaD(ptsA) + '" fill="url(#wpGradA)" stroke="none"/>');
    svg.push('<path d="' + areaD(ptsH) + '" fill="url(#wpGradH)" stroke="none"/>');
    if (!isKO) svg.push('<path d="' + smoothD(ptsD) + '" fill="none" stroke="' + colD + '" stroke-width="1.8" stroke-dasharray="5 4" opacity="0.85"/>');
    svg.push('<path d="' + smoothD(ptsA) + '" fill="none" stroke="' + colA + '" stroke-width="2.6" stroke-linejoin="round"/>');
    svg.push('<path d="' + smoothD(ptsH) + '" fill="none" stroke="' + colH + '" stroke-width="2.6" stroke-linejoin="round"/>');
    // running score at each goal (sorted), for the callout chips
    var gsorted = (D.goals || []).slice().sort(function (a, b) { return a.min - b.min; });
    var _hc = 0, _ac = 0;
    gsorted.forEach(function (g) { if (g.team === "home") _hc++; else _ac++; g._sh = _hc; g._sa = _ac; });
    var placed = [];   // chip bounding boxes, to avoid overlaps
    function overlaps(a, b) { return !(a.x2 < b.x1 - 3 || b.x2 < a.x1 - 3 || a.y2 < b.y1 - 3 || b.y2 < a.y1 - 3); }
    gsorted.forEach(function (g) {
      var col = g.team === "home" ? colH : colA;
      var pts = g.team === "home" ? ptsH : ptsA;
      var gx = sx(g.min), gy = sy(valAt(pts, g.min));
      var gName = g.team === "home" ? D.home.name : D.away.name;
      var info = g.min + "' " + g.scorer + (g.pen ? " (pen)" : "") + (g.own ? " (OG)" : "") + " — " + gName;
      svg.push('<circle cx="' + gx.toFixed(1) + '" cy="' + gy.toFixed(1) + '" r="5" fill="' + col + '" stroke="#050611" stroke-width="1.4" data-info="' + esc(info) + '"></circle>');
      // score chip: bold score line + "min' scorer" sub-line
      var scoreTxt = g._sh + "–" + g._sa;
      var sub = g.min + "′ " + g.scorer + (g.pen ? " (pen)" : "") + (g.own ? " (OG)" : "");
      var chipW = Math.max(30, sub.length * 5.4 + 12), chipH = 27;
      var near = (maxMin - g.min) < 5;                  // last goal on the endpoint → place left
      var preferAbove = g.team === "home";              // home above, away below (then step away)
      // candidate top-left positions, in preference order: (near→left), preferred dir stepped, other dir stepped
      var cands = [];
      if (near) cands.push([gx - chipW - 12, gy - chipH / 2]);
      for (var st = 0; st < 7; st++) { var off = 14 + st * (chipH + 5); cands.push(preferAbove ? [gx - chipW / 2, gy - off - chipH] : [gx - chipW / 2, gy + off]); }
      for (var st2 = 0; st2 < 7; st2++) { var off2 = 14 + st2 * (chipH + 5); cands.push(preferAbove ? [gx - chipW / 2, gy + off2] : [gx - chipW / 2, gy - off2 - chipH]); }
      var chosen = null;
      for (var ci = 0; ci < cands.length; ci++) {
        var cx = Math.max(padL + 2, Math.min(cands[ci][0], W - padR - chipW - 2));
        var cy = Math.max(padT + 2, Math.min(cands[ci][1], HT - padB - chipH - 2));
        var rect = { x1: cx, y1: cy, x2: cx + chipW, y2: cy + chipH };
        var clash = false;
        for (var pi = 0; pi < placed.length; pi++) { if (overlaps(rect, placed[pi])) { clash = true; break; } }
        if (!clash || ci === cands.length - 1) { chosen = rect; break; }
      }
      placed.push(chosen);
      var cx0 = chosen.x1, cy0 = chosen.y1, midX = cx0 + chipW / 2;
      var leadY = cy0 + (cy0 + chipH / 2 < gy ? chipH : 0);   // connect to the chip edge facing the dot
      svg.push('<line x1="' + gx.toFixed(1) + '" y1="' + gy.toFixed(1) + '" x2="' + midX.toFixed(1) + '" y2="' + leadY.toFixed(1) + '" stroke="' + col + '" stroke-width="1" opacity="0.55"/>');
      svg.push('<rect x="' + cx0.toFixed(1) + '" y="' + cy0.toFixed(1) + '" width="' + chipW.toFixed(1) + '" height="' + chipH + '" rx="4" fill="#050611" fill-opacity="0.82" stroke="' + col + '" stroke-opacity="0.6"/>');
      svg.push('<text x="' + midX.toFixed(1) + '" y="' + (cy0 + 12).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="bold" fill="' + col + '">' + esc(scoreTxt) + '</text>');
      svg.push('<text x="' + midX.toFixed(1) + '" y="' + (cy0 + 23).toFixed(1) + '" text-anchor="middle" font-size="9.5" fill="#d6d9f5">' + esc(sub) + '</text>');
    });
    // crest + final-% endpoints (bigger, in the right margin; nudge apart if finals coincide)
    var yH = sy(finH), yA = sy(finA);
    if (Math.abs(finH - finA) < 8) { var mid = (yH + yA) / 2; yH = finH >= finA ? mid - 14 : mid + 14; yA = finH >= finA ? mid + 14 : mid - 14; }
    function crest(name, col, y, pct) {
      var ex = sx(maxMin);
      return '<image href="' + LOGO + encodeURIComponent(name) + '.png" x="' + (ex - 15).toFixed(1) + '" y="' + (y - 15).toFixed(1) + '" width="30" height="30"/>' +
        '<text x="' + (ex + 18).toFixed(1) + '" y="' + (y + 4.5).toFixed(1) + '" text-anchor="start" font-size="13.5" font-weight="bold" fill="' + col + '">' + fmtPct(pct) + '%</text>';
    }
    svg.push(crest(D.home.name, colH, yH, finH));
    svg.push(crest(D.away.name, colA, yA, finA));
    // hover crosshair (scrubber) — reads the win % at any minute; moved/shown by JS below
    svg.push('<g id="wpCross" style="display:none" pointer-events="none">' +
      '<line id="wpCrossLine" x1="0" y1="' + padT + '" x2="0" y2="' + (padT + plotH) + '" stroke="#5b6a8a" stroke-width="1" stroke-dasharray="2 3"/>' +
      '<circle id="wpCrossH" r="4.2" fill="' + colH + '" stroke="#050611" stroke-width="1.2"/>' +
      '<circle id="wpCrossA" r="4.2" fill="' + colA + '" stroke="#050611" stroke-width="1.2"/>' +
      (isKO ? "" : '<circle id="wpCrossD" r="3.6" fill="' + colD + '" stroke="#050611" stroke-width="1.2"/>') +
      '</g>');
    svg.push("</svg>");

    var legend = '<div class="mv-mom-legend">' +
      '<span><i style="background:' + colH + '"></i>' + esc(D.home.name) + " — <b>" + fmtPct(finH) + "%</b> win</span>" +
      '<span><i style="background:' + colA + '"></i>' + esc(D.away.name) + " — <b>" + fmtPct(finA) + "%</b> win</span>" +
      (isKO ? "" : '<span><i style="background:' + colD + '"></i>Draw — <b>' + fmtPct(finD) + "%</b></span>") +
      "</div>";
    host.innerHTML = '<p class="hint">Live <b>win probability</b> — seeded at kickoff from the FIFA-ranking gap, then updated each minute by the running score and live xG. ' +
      (isKO ? "A level knockout resolves to the shootout winner. " : "The grey line is the draw chance. ") +
      'Each goal is labelled with the score; <b>hover (or drag) across the chart to read the win % at any minute</b>. An estimate, not a betting market.</p>' +
      '<div class="mv-mom-wrap">' + svg.join("") + "</div>" + legend +
      '<div class="chart-tip" id="mvWpTip"></div>';
    var tip = document.getElementById("mvWpTip");
    var svgEl = host.querySelector("svg");
    var cross = host.querySelector("#wpCross"), crossLine = host.querySelector("#wpCrossLine");
    var dotH = host.querySelector("#wpCrossH"), dotA = host.querySelector("#wpCrossA"), dotD = host.querySelector("#wpCrossD");
    function isDot(el) { return el && (el.tagName || "").toLowerCase() === "circle" && el.hasAttribute("data-info"); }
    function wpHTML(info) {
      var i = info.indexOf(" — "), a = i >= 0 ? info.slice(0, i) : info, bb = i >= 0 ? info.slice(i + 3) : "";
      return '<div class="t-team">' + esc(a) + "</div>" + (bb ? '<div class="t-line">' + esc(bb) + "</div>" : "");
    }
    // client px → SVG viewBox user units, so we can map back to a minute
    function clientToVB(e) {
      if (!svgEl || !svgEl.getScreenCTM) return null;
      var ctm = svgEl.getScreenCTM(); if (!ctm) return null;
      var p = svgEl.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      var q = p.matrixTransform(ctm.inverse());
      return { x: q.x, y: q.y };
    }
    function minuteAt(e) {
      var vb = clientToVB(e); if (!vb) return null;
      if (vb.x < padL - 6 || vb.x > W - padR + 6 || vb.y < padT - 6 || vb.y > padT + plotH + 6) return null;
      var xv = Math.max(padL, Math.min(W - padR, vb.x));
      return Math.round((xv - padL) / plotW * maxMin);
    }
    function rowHTML(c, nm, v) {
      return '<div class="t-line"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + c + ';margin-right:6px;vertical-align:middle"></i>' + esc(nm) + ' <b>' + fmtPct(v) + '%</b></div>';
    }
    function readoutHTML(mn) {
      return '<div class="t-team">' + mn + "′</div>" + rowHTML(colH, D.home.name, valAt(ptsH, mn)) +
        rowHTML(colA, D.away.name, valAt(ptsA, mn)) + (isKO ? "" : rowHTML(colD, "Draw", valAt(ptsD, mn)));
    }
    function showCross(mn) {
      var x = sx(mn);
      crossLine.setAttribute("x1", x); crossLine.setAttribute("x2", x);
      dotH.setAttribute("cx", x); dotH.setAttribute("cy", sy(valAt(ptsH, mn)));
      dotA.setAttribute("cx", x); dotA.setAttribute("cy", sy(valAt(ptsA, mn)));
      if (dotD) { dotD.setAttribute("cx", x); dotD.setAttribute("cy", sy(valAt(ptsD, mn))); }
      cross.style.display = "";
    }
    function hideAll() { hideTip(); if (cross) cross.style.display = "none"; }
    host.addEventListener("pointermove", function (e) {
      if (isDot(e.target)) { showTip(e, wpHTML(e.target.getAttribute("data-info"))); if (cross) cross.style.display = "none"; return; }
      var mn = minuteAt(e);
      if (mn == null) { hideAll(); return; }
      showCross(mn); showTip(e, readoutHTML(mn));
    });
    host.addEventListener("pointerleave", hideAll);
    // touch: tap/drag shows the per-minute readout in the caption line (+ scorer on a dot)
    host.addEventListener("click", function (e) {
      if (isDot(e.target)) { tip.textContent = e.target.getAttribute("data-info"); tip.classList.add("show"); return; }
      var mn = minuteAt(e);
      if (mn == null) return;
      showCross(mn);
      tip.textContent = mn + "′ · " + D.home.name + " " + fmtPct(valAt(ptsH, mn)) + "% · " +
        D.away.name + " " + fmtPct(valAt(ptsA, mn)) + "%" + (isKO ? "" : " · Draw " + fmtPct(valAt(ptsD, mn)) + "%");
      tip.classList.add("show");
    });
  }

  function scoreboard(D) {
    var xgTxt = "";
    var hs = D.shots.filter(function (s) { return s.team === "home"; });
    var as = D.shots.filter(function (s) { return s.team === "away"; });
    function sum(a) { return a.reduce(function (t, s) { return t + s.xg; }, 0); }
    var mH = sum(hs), mA = sum(as);                       // our model (sum of shot dots)
    var fx = D.fotXg || [];
    var hasFot = fx[0] != null && fx[1] != null;
    // Canonical xG = average of our model and FotMob when both exist (matches build_data).
    var cH = hasFot ? (mH + fx[0]) / 2 : mH;
    var cA = hasFot ? (mA + fx[1]) / 2 : mA;
    var detailTxt = '<span class="est">· our model (from ' + D.shots.length + " shots)</span>";
    xgTxt = '<div class="sb-xg">Expected goals (xG): <b>' + mH.toFixed(2) + "</b> — <b>" +
      mA.toFixed(2) + "</b> " + detailTxt + "</div>";

    var goals = D.goals.map(function (g) {
      var as = g.assist ? '<span class="as">(' + esc(g.assist) + ")</span>" : "";
      return '<span class="goal-ev ' + g.team + '"><span class="min">' + g.min + "'</span> ⚽ " +
        esc(g.scorer) + (g.pen ? " (P)" : "") + (g.own ? " (OG)" : "") + " " + as + "</span>";
    }).join("");

    // The infographic matches the dark dashboard: the primary button opens the DARK render
    // when one exists (older matches without a _dark.png fall back to the light file), and the
    // light version is offered as a secondary option.
    var pngPrimary = D.png_dark || D.png;
    var pngBtn = pngPrimary
      ? '<a class="png-btn" href="' + esc(pngPrimary) + '" target="_blank" rel="noopener" download>' +
        '🖼️ Infographic PNG</a>'
      : "";
    var pngLightBtn = (D.png_dark && D.png)
      ? '<a class="png-btn png-btn-alt" href="' + esc(D.png) + '" target="_blank" rel="noopener" download>' +
        '☀️ Light PNG</a>'
      : "";

    var shareBtn = '<button class="png-btn share-btn" type="button">🔗 Share</button>';
    return '<div class="match-top">' + pngBtn + pngLightBtn + shareBtn + "</div>" +
      '<div class="scoreboard"><div class="sb-main">' +
        '<div class="sb-team home"><span class="nm">' + esc(D.home.name) + "</span>" + logoImg(D.home.name) + "</div>" +
        '<div class="sb-score">' + (D.home.score == null ? "-" : D.home.score) + " : " +
          (D.away.score == null ? "-" : D.away.score) +
          (D.home.pens != null && D.away.pens != null
            ? '<span class="sb-pens">(' + D.home.pens + "-" + D.away.pens + " pens)</span>" : "") +
          "</div>" +
        '<div class="sb-team away">' + logoImg(D.away.name) + '<span class="nm">' + esc(D.away.name) + "</span></div>" +
      "</div>" + xgTxt +
      '<div class="sb-meta">' + esc(D.stage || "") + (D.venue ? " · " + esc(D.venue) : "") +
        (D.date ? " · " + esc(D.date) : "") + "</div>" +
      (goals ? '<div class="timeline">' + goals + "</div>" : "") +
      "</div>";
  }

  /* ================= MATCH STATS (head-to-head, from data.js) ================= */
  var STAT_DEFS = [
    ["possession", "Possession", true, true],
    ["xg", "Expected goals (xG)", false, true],
    ["shots", "Shots", false, true],
    ["sot", "Shots on target", false, true],
    ["big_chances", "Big chances", false, true],
    ["passes", "Passes", false, true],
    ["pass_acc", "Pass accuracy", true, true],
    ["saves", "Saves", false, true],
    ["duels_won", "Duels won", true, true],
    ["fouls", "Fouls", false, false],
  ];

  function matchRecord() {
    var arr = (window.WC_DATA && window.WC_DATA.matches) || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  // Stats we can derive from the shot/pass event stream when the provider feed
  // is missing them (e.g. re-scraped matches that only carry xG + pass accuracy).
  function eventStats(D) {
    function compute(t) {
      var sh = D.shots.filter(function (x) { return x.team === t; });
      var ps = D.passes.filter(function (x) { return x.team === t; });
      var okp = ps.filter(function (p) { return p.ok; }).length;
      return {
        xg: +sh.reduce(function (a, s) { return a + s.xg; }, 0).toFixed(2),
        shots: sh.length,
        sot: sh.filter(function (s) { return s.onTarget; }).length,
        big_chances: sh.filter(function (s) { return s.big; }).length,
        passes: ps.length,
        pass_acc: ps.length ? Math.round((100 * okp) / ps.length) : null,
      };
    }
    return { home: compute("home"), away: compute("away") };
  }

  function buildMatchStats(rec, D) {
    var host = document.getElementById("mv-stats");
    if (!host) return;
    var s = rec.stats || {};
    var es = eventStats(D);
    var rows = STAT_DEFS.map(function (def) {
      var key = def[0];
      var pair = s[key] || [null, null];
      // xG: show OUR model (event-derived from the shot dots), not the multi-source average
      if (key === "xg" && D.shots.length) {
        pair = [es.home.xg, es.away.xg];
      }
      // fall back to event-derived numbers when the provider gave us nothing
      if (pair[0] == null && pair[1] == null && es.home[key] != null) {
        pair = [es.home[key], es.away[key]];
      }
      var h = pair[0], a = pair[1];
      if (h == null && a == null) return "";
      var hv = h == null ? 0 : h, av = a == null ? 0 : a;
      var total = hv + av;
      var hpct = total > 0 ? (hv / total) * 100 : 50;
      var suffix = def[2] ? "%" : "";
      function disp(x) { return x == null ? "–" : (def[0] === "xg" ? x.toFixed(2) : x) + suffix; }
      var hBetter = def[3] ? hv > av : hv < av;
      var aBetter = def[3] ? av > hv : av < hv;
      return '<div class="stat-cmp">' +
        '<div class="sc-val ' + (hBetter ? "win" : "") + '">' + disp(h) + "</div>" +
        '<div class="sc-mid"><div class="sc-label">' + def[1] + '</div>' +
          '<div class="sc-bar"><div class="sc-fill h" style="width:' + hpct.toFixed(1) + '%"></div>' +
          '<div class="sc-fill a" style="width:' + (100 - hpct).toFixed(1) + '%"></div></div></div>' +
        '<div class="sc-val ' + (aBetter ? "win" : "") + '">' + disp(a) + "</div>" +
        "</div>";
    }).join("");
    var LABELS = { fotmob: "FotMob", whoscored: "WhoScored", sofascore: "SofaScore" };
    var srcs = (rec.sources || []).map(function (s) { return LABELS[s] || s; });
    var cap = srcs.length
      ? '<div class="stat-src" style="text-align:center;font-size:.78em;opacity:.6;margin-top:8px">' +
          (srcs.length > 1 ? "Combined from " + srcs.length + " sources: " : "Source: ") +
          srcs.join(" · ") + "</div>"
      : "";
    host.innerHTML = '<div class="stat-panel" style="border-top:none">' +
      '<div class="sp-head"><span>' + esc(D.home.name) + "</span><span>" + esc(D.away.name) + "</span></div>" +
      rows + cap + "</div>";
  }

  /* ================= SHOT MAP ================= */
  function buildShots(D) {
    var host = document.getElementById("mv-shots");
    host.innerHTML =
      '<div class="controls-bar">' +
        '<span class="chip-toggle on home" id="shHome">' + esc(D.home.name) + "</span>" +
        '<span class="chip-toggle on away" id="shAway">' + esc(D.away.name) + "</span>" +
        '<span class="chip-toggle" id="shGoals">Goals only</span>' +
        '<span class="chip-toggle on" id="shLines">Shot paths</span>' +
        '<span class="grp">Min xG <input type="text" id="shMinXg" value="0" size="3" style="width:42px"></span>' +
      "</div>" +
      '<div class="pitch-wrap"><svg class="pitch-svg" viewBox="-2 -2 ' + (PW + 4) + " " + (PH + 8) + '">' +
        pitchMarkup() +
        '<text class="dir-label" x="3" y="' + (PH + 4) + '">◀ ' + esc(D.away.name) + "</text>" +
        '<text class="dir-label" x="' + (PW - 3) + '" y="' + (PH + 4) + '" text-anchor="end">' + esc(D.home.name) + " ▶</text>" +
        '<g id="shotLayer"></g>' +
      "</svg></div>" +
      '<div class="legend-row">' +
        '<span><i class="dot" style="background:var(--c-home);border:1.5px solid #ffc857"></i>Goal (team colour)</span>' +
        '<span><i class="dot" style="background:var(--c-home)"></i>On target</span>' +
        '<span><i class="dot" style="background:transparent;border:1px solid var(--muted)"></i>Off target</span>' +
        '<span><i class="dot" style="background:#7a7fb0"></i>Blocked</span>' +
        '<span><i class="ln-swatch"></i>Shot path → goal</span>' +
        '<span>● size = xG</span>' +
      "</div>" +
      '<div class="shot-detail empty" id="shotDetail">Click any shot to see who took it, when, and its xG.</div>';

    var state = { home: true, away: true, goalsOnly: false, lines: true, minXg: 0, sel: null };
    var layer = document.getElementById("shotLayer");
    var detail = document.getElementById("shotDetail");

    function draw() {
      layer.innerHTML = "";
      D.shots.forEach(function (sh, i) {
        if (!state[sh.team]) return;
        if (state.goalsOnly && !sh.goal) return;
        if (sh.xg < state.minXg) return;
        var cx = tx(sh.team, sh.x), cy = ty(sh.team, sh.y);
        // dot radius scaled to the pitch (viewBox 100×64) so dots don't overlap
        var r = 0.55 + Math.sqrt(sh.xg) * 2.0;
        var col = sh.team === "home" ? D.home.color : D.away.color;
        var NS = "http://www.w3.org/2000/svg";
        // Shot path: a line from the shot spot to where it crossed the goal line
        // (raw x=100, y=GoalMouthY). Drawn under the dot; off-target lines point wide
        // of the posts. Only shots with goal-mouth data (gy) get a path.
        if (state.lines && sh.gy != null) {
          var lx = tx(sh.team, 100), ly = ty(sh.team, sh.gy);
          var ln = document.createElementNS(NS, "line");
          ln.setAttribute("x1", cx.toFixed(2)); ln.setAttribute("y1", cy.toFixed(2));
          ln.setAttribute("x2", lx.toFixed(2)); ln.setAttribute("y2", ly.toFixed(2));
          ln.setAttribute("stroke", sh.goal ? "#ffc857" : col);
          ln.setAttribute("stroke-width", sh.goal ? "0.4" : "0.28");
          ln.setAttribute("stroke-opacity", sh.goal ? "0.9" : "0.33");
          ln.setAttribute("stroke-linecap", "round");
          layer.appendChild(ln);
        }
        var fill, stroke = "none", op = 0.85;
        if (sh.goal) { fill = col; op = 1; }                        // goals = team colour
        else if (sh.blocked) { fill = "#7a7fb0"; op = 0.7; }
        else if (sh.onTarget) { fill = col; }
        else { fill = "none"; stroke = col; }
        // goals: a tight ring around the (same-size) dot so they read as goals
        if (sh.goal) {
          var ring = document.createElementNS(NS, "circle");
          ring.setAttribute("cx", cx.toFixed(2)); ring.setAttribute("cy", cy.toFixed(2));
          ring.setAttribute("r", (r + 0.55).toFixed(2));
          ring.setAttribute("fill", "none"); ring.setAttribute("stroke", "#ffc857");
          ring.setAttribute("stroke-width", "0.45");
          layer.appendChild(ring);
        }
        var c = document.createElementNS(NS, "circle");
        c.setAttribute("class", "shot-dot");
        c.setAttribute("cx", cx.toFixed(2)); c.setAttribute("cy", cy.toFixed(2));
        c.setAttribute("r", r.toFixed(2));
        c.setAttribute("fill", fill); c.setAttribute("fill-opacity", op);
        if (stroke !== "none") { c.setAttribute("stroke", stroke); c.setAttribute("stroke-width", fill === "none" ? 0.5 : 0.3); }
        c.addEventListener("click", function () { select(sh, c); });
        c.addEventListener("mousemove", function (e) {
          showTip(e, "<b>" + esc(sh.player) + "</b> " + sh.min + "'<br>xG " + sh.xg.toFixed(2) +
            " · " + (sh.goal ? "GOAL" : sh.onTarget ? "On target" : sh.blocked ? "Blocked" : "Off target"));
        });
        c.addEventListener("mouseleave", hideTip);
        layer.appendChild(c);
      });
    }
    function select(sh, node) {
      layer.querySelectorAll(".sel").forEach(function (n) { n.classList.remove("sel"); });
      node.classList.add("sel");
      detail.className = "shot-detail";
      var teamName = sh.team === "home" ? D.home.name : D.away.name;
      detail.innerHTML = '<div class="sd-head">' + esc(sh.player) + " · " + esc(teamName) + "</div>" +
        '<div class="sd-grid">' +
        "<div><span>Minute</span><br>" + sh.min + "'</div>" +
        "<div><span>xG</span><br>" + sh.xg.toFixed(2) + "</div>" +
        "<div><span>Outcome</span><br>" + (sh.goal ? "⚽ Goal" : sh.onTarget ? "On target" : sh.blocked ? "Blocked" : "Off target") + "</div>" +
        "<div><span>Body</span><br>" + esc(sh.body) + "</div>" +
        "<div><span>Situation</span><br>" + esc(sh.sit) + (sh.big ? " · Big chance" : "") + "</div>" +
        "</div>";
    }

    document.getElementById("shHome").addEventListener("click", function () {
      state.home = !state.home; this.classList.toggle("on"); draw(); });
    document.getElementById("shAway").addEventListener("click", function () {
      state.away = !state.away; this.classList.toggle("on"); draw(); });
    document.getElementById("shGoals").addEventListener("click", function () {
      state.goalsOnly = !state.goalsOnly; this.classList.toggle("on"); draw(); });
    document.getElementById("shLines").addEventListener("click", function () {
      state.lines = !state.lines; this.classList.toggle("on"); draw(); });
    document.getElementById("shMinXg").addEventListener("input", function () {
      state.minXg = parseFloat(this.value) || 0; draw(); });
    draw();
  }

  /* ================= ON-TARGET SHOT MAP (goal-mouth view) ================= */
  // A "behind the goal" view: every on-target attempt (goal + saved) plotted at the
  // spot in the goal it was aimed at (WhoScored GoalMouthY/Z), coloured green for a
  // goal and blue for a save. Dot size = xG. Team chooser isolates a side. (Note:
  // WhoScored often gives saved shots a default height, so saves cluster at one row.)
  function buildOnTargetShots(D) {
    var host = document.getElementById("mv-shots-ot");
    if (!host) return;
    var onT = D.shots.filter(function (s) { return s.onTarget && s.gy != null && s.gz != null; });
    var noCoord = D.shots.filter(function (s) { return s.onTarget && (s.gy == null || s.gz == null); }).length;
    if (!onT.length) {
      host.innerHTML = '<div class="shot-detail empty">No on-target shots with goal-placement data for this match.</div>';
      return;
    }
    var GOAL_COL = "#33e893", SAVE_COL = "#5a9bff";
    host.innerHTML =
      '<div class="controls-bar">' +
        '<span class="chip-toggle on home" id="otHome">' + esc(D.home.name) + "</span>" +
        '<span class="chip-toggle on away" id="otAway">' + esc(D.away.name) + "</span>" +
        '<span class="chip-toggle" id="otGoals">Goals only</span>' +
        '<span class="ot-count" id="otCount"></span>' +
      "</div>" +
      '<div class="pitch-wrap"><svg class="pitch-svg" viewBox="' + GM.viewBox + '">' +
        GM.frame() +
        '<text class="dir-label" x="' + (GM.GW / 2) + '" y="' + (GM.GROUND + 5) +
          '" text-anchor="middle">Goal-mouth view · where on-target shots were aimed</text>' +
        '<g id="otLayer"></g>' +
      "</svg></div>" +
      '<div class="legend-row">' +
        '<span><i class="dot" style="background:' + GOAL_COL + '"></i>Goal</span>' +
        '<span><i class="dot" style="background:' + SAVE_COL + '"></i>On target (saved)</span>' +
        '<span><i class="dot" style="background:#222;border:2px solid var(--c-home)"></i>Team ring</span>' +
        '<span>● size = xG</span>' +
      "</div>" +
      '<div class="shot-detail empty" id="otDetail">' +
        "Each dot is an on-target shot, placed where it was aimed in the goal. Click one for details." +
        (noCoord ? " (" + noCoord + " on-target shot" + (noCoord === 1 ? "" : "s") + " had no placement data.)" : "") +
      "</div>";

    var state = { home: true, away: true, goalsOnly: false };
    var layer = document.getElementById("otLayer");
    var detail = document.getElementById("otDetail");
    var countEl = document.getElementById("otCount");
    var NS = "http://www.w3.org/2000/svg";

    function draw() {
      layer.innerHTML = "";
      var shown = 0, hg = 0, ag = 0;
      onT.forEach(function (sh) {
        if (!state[sh.team]) return;
        if (state.goalsOnly && !sh.goal) return;
        shown++;
        if (sh.team === "home") hg++; else ag++;
        // WhoScored GoalMouthY grows toward the attacker's LEFT (same axis as pitch y),
        // so gxOf puts a far-post finish on the wrong side. Flip (GW - gxOf) to draw the
        // goal from the shooter's/broadcast perspective: attacker's-right → screen right.
        var cx = GM.GW - GM.gxOf(sh.gy), cy = GM.gyOf(sh.gz);
        var r = 1.4 + Math.sqrt(sh.xg) * 2.6;
        var ring = sh.team === "home" ? D.home.color : D.away.color;
        var c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", cx.toFixed(2)); c.setAttribute("cy", cy.toFixed(2));
        c.setAttribute("r", r.toFixed(2));
        c.setAttribute("fill", sh.goal ? GOAL_COL : SAVE_COL);
        c.setAttribute("fill-opacity", sh.goal ? 0.95 : 0.8);
        c.setAttribute("stroke", ring); c.setAttribute("stroke-width", "0.7");
        c.style.cursor = "pointer";
        c.addEventListener("click", function () { select(sh, c); });
        c.addEventListener("mousemove", function (e) {
          showTip(e, "<b>" + esc(sh.player) + "</b> " + sh.min + "'<br>xG " + sh.xg.toFixed(2) +
            " · " + (sh.goal ? "GOAL" : "On target (saved)"));
        });
        c.addEventListener("mouseleave", hideTip);
        layer.appendChild(c);
      });
      countEl.textContent = shown + " on target · " + hg + "–" + ag;
    }
    function select(sh, node) {
      layer.querySelectorAll(".sel").forEach(function (n) { n.classList.remove("sel"); });
      node.classList.add("sel");
      detail.className = "shot-detail";
      var teamName = sh.team === "home" ? D.home.name : D.away.name;
      detail.innerHTML = '<div class="sd-head">' + esc(sh.player) + " · " + esc(teamName) + "</div>" +
        '<div class="sd-grid">' +
        "<div><span>Minute</span><br>" + sh.min + "'</div>" +
        "<div><span>xG</span><br>" + sh.xg.toFixed(2) + "</div>" +
        "<div><span>Outcome</span><br>" + (sh.goal ? "⚽ Goal" : "On target (saved)") + "</div>" +
        "<div><span>Body</span><br>" + esc(sh.body) + "</div>" +
        "<div><span>Situation</span><br>" + esc(sh.sit) + (sh.big ? " · Big chance" : "") + "</div>" +
        "</div>";
    }

    document.getElementById("otHome").addEventListener("click", function () {
      state.home = !state.home; this.classList.toggle("on"); draw(); });
    document.getElementById("otAway").addEventListener("click", function () {
      state.away = !state.away; this.classList.toggle("on"); draw(); });
    document.getElementById("otGoals").addEventListener("click", function () {
      state.goalsOnly = !state.goalsOnly; this.classList.toggle("on"); draw(); });
    draw();
  }

  /* ================= PASS EXPLORER ================= */
  function buildPasses(D) {
    var host = document.getElementById("mv-passes");
    var players = {};
    D.passes.forEach(function (p) { (players[p.team] = players[p.team] || {})[p.player] = 1; });
    function opts(side) {
      return Object.keys(players[side] || {}).sort().map(function (n) {
        return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
    }

    host.innerHTML =
      '<div class="controls-bar">' +
        '<span class="chip-toggle on home" id="paHome">' + esc(D.home.name) + "</span>" +
        '<span class="chip-toggle on away" id="paAway">' + esc(D.away.name) + "</span>" +
        '<span class="grp">Player <select id="paPlayer"><option value="">All players</option>' +
          '<optgroup label="' + esc(D.home.name) + '" data-side="home">' + opts("home") + "</optgroup>" +
          '<optgroup label="' + esc(D.away.name) + '" data-side="away">' + opts("away") + "</optgroup></select></span>" +
        '<span class="grp">Type <select id="paType">' +
          '<option value="all">All passes</option><option value="ok">Completed</option>' +
          '<option value="fail">Incomplete</option><option value="prog">Progressive</option>' +
          '<option value="key">Key passes</option>' +
          '<option value="assist">Assists</option><option value="cross">Crosses</option>' +
          '<option value="through">Through balls</option></select></span>' +
        '<span class="chip-toggle" id="paThird">Final third</span>' +
        '<span class="chip-toggle" id="paWindow">5-min window</span>' +
      "</div>" +
      '<div class="timeline-scrub">' +
        '<button class="play-btn" id="paPlay">▶</button>' +
        '<input type="range" id="paRange" min="0" max="' + (D.maxMin || 90) + '" value="' + (D.maxMin || 90) + '">' +
        '<span class="minlab" id="paMinLab"></span>' +
      "</div>" +
      '<div class="pitch-wrap"><svg class="pitch-svg" viewBox="-2 -2 ' + (PW + 4) + " " + (PH + 8) + '">' +
        pitchMarkup() +
        '<text class="dir-label" x="3" y="' + (PH + 4) + '">◀ ' + esc(D.away.name) + "</text>" +
        '<text class="dir-label" x="' + (PW - 3) + '" y="' + (PH + 4) + '" text-anchor="end">' + esc(D.home.name) + " ▶</text>" +
        '<g id="passLayer"></g>' +
      "</svg></div>" +
      '<div class="legend-row">' +
        '<span><i class="dot" style="background:#33e893"></i>completed · progressive/key</span>' +
        '<span><i class="dot" style="background:#22b871"></i>completed · normal</span>' +
        '<span><i class="dot" style="background:#ff5c7a"></i>incomplete · forward/key</span>' +
        '<span><i class="dot" style="background:#a83646"></i>incomplete · normal</span>' +
        '<span>dashed = incomplete · dot = start</span>' +
      "</div>" +
      '<div class="stat-note" id="paCount"></div>';

    var state = { home: true, away: true, player: "", type: "all", third: false, windowMode: false, upper: D.maxMin || 90 };
    var layer = document.getElementById("passLayer");
    var minLab = document.getElementById("paMinLab");
    var countEl = document.getElementById("paCount");
    var SVGNS = "http://www.w3.org/2000/svg";

    function pass_passes_filter(p) {
      if (!state[p.team]) return false;
      if (state.player && p.player !== state.player) return false;
      var t = state.type;
      if (t === "ok" && !p.ok) return false;
      if (t === "fail" && p.ok) return false;
      if (t === "prog" && !p.prog) return false;
      if (t === "key" && !p.key && !p.assist) return false;
      if (t === "assist" && !p.assist) return false;
      if (t === "cross" && !p.cross) return false;
      if (t === "through" && !p.through) return false;
      // Final third = pass that ENDS in the attacking third (WhoScored x ≥ 66.7).
      if (state.third && p.ex < 200 / 3) return false;
      if (p.min > state.upper) return false;
      if (state.windowMode && p.min < state.upper - 5) return false;
      return true;
    }

    function draw() {
      layer.innerHTML = "";
      var shown = 0;
      var frag = document.createDocumentFragment();
      D.passes.forEach(function (p) {
        if (!pass_passes_filter(p)) return;
        shown++;
        var x1 = tx(p.team, p.x), y1 = ty(p.team, p.y);
        var x2 = tx(p.team, p.ex), y2 = ty(p.team, p.ey);
        // Two greens for completed (bright = progressive/key/assist, dim = normal);
        // two reds for incomplete (bright = forward/key attempt, dim = normal).
        var dangerous = p.prog || p.key || p.assist || p.through;
        var col = p.ok
          ? (dangerous ? "#33e893" : "#22b871")
          : (dangerous ? "#ff5c7a" : "#a83646");
        var ln = document.createElementNS(SVGNS, "line");
        var cls = "pass-line" + (p.assist ? " assist" : p.key || p.prog ? " key" : "");
        ln.setAttribute("class", cls);
        ln.setAttribute("x1", x1.toFixed(2)); ln.setAttribute("y1", y1.toFixed(2));
        ln.setAttribute("x2", x2.toFixed(2)); ln.setAttribute("y2", y2.toFixed(2));
        ln.setAttribute("stroke", col);
        if (!p.ok) ln.setAttribute("stroke-dasharray", "0.9 0.9");
        ln.addEventListener("mousemove", function (e) {
          showTip(e, "<b>" + esc(p.player) + "</b> " + p.min + "'" +
            (p.recv ? " → " + esc(p.recv) : "") + "<br>" +
            (p.ok ? "Completed" : "Incomplete") + (p.assist ? " · ASSIST" : p.key ? " · key pass" :
              p.through ? " · through ball" : p.cross ? " · cross" : p.prog ? " · progressive" : ""));
        });
        ln.addEventListener("mouseleave", hideTip);
        frag.appendChild(ln);
        var d0 = document.createElementNS(SVGNS, "circle");
        d0.setAttribute("class", "pass-dot");
        d0.setAttribute("cx", x1.toFixed(2)); d0.setAttribute("cy", y1.toFixed(2));
        d0.setAttribute("r", "0.6"); d0.setAttribute("fill", col);
        frag.appendChild(d0);
      });
      layer.appendChild(frag);
      countEl.textContent = shown + " passes shown" + (state.windowMode ? " (minutes " + Math.max(0, state.upper - 5) + "–" + state.upper + ")" : " (up to " + state.upper + "')");
    }
    function setUpper(v) {
      state.upper = v;
      minLab.textContent = (state.windowMode ? Math.max(0, v - 5) + "–" + v : "0–" + v) + "'";
      draw();
    }

    document.getElementById("paHome").addEventListener("click", function () { state.home = !state.home; this.classList.toggle("on"); draw(); });
    document.getElementById("paAway").addEventListener("click", function () { state.away = !state.away; this.classList.toggle("on"); draw(); });
    document.getElementById("paPlayer").addEventListener("change", function () { state.player = this.value; draw(); });
    document.getElementById("paType").addEventListener("change", function () { state.type = this.value; draw(); });
    document.getElementById("paThird").addEventListener("click", function () { state.third = !state.third; this.classList.toggle("on"); draw(); });
    document.getElementById("paWindow").addEventListener("click", function () { state.windowMode = !state.windowMode; this.classList.toggle("on"); setUpper(state.upper); });
    var range = document.getElementById("paRange");
    range.addEventListener("input", function () { stopPlay(); setUpper(parseInt(this.value, 10)); });

    // play animation
    var timer = null;
    var playBtn = document.getElementById("paPlay");
    function stopPlay() { if (timer) { clearInterval(timer); timer = null; playBtn.classList.remove("playing"); playBtn.textContent = "▶"; } }
    playBtn.addEventListener("click", function () {
      if (timer) { stopPlay(); return; }
      if (state.upper >= (D.maxMin || 90)) { range.value = 0; setUpper(0); }
      playBtn.classList.add("playing"); playBtn.textContent = "❚❚";
      timer = setInterval(function () {
        var v = state.upper + 1;
        if (v > (D.maxMin || 90)) { stopPlay(); return; }
        range.value = v; setUpper(v);
      }, 180);
    });

    setUpper(state.upper);
  }

  /* ================= DRIBBLES (take-ons) ================= */
  function buildDribbles(D) {
    var host = document.getElementById("mv-dribbles");
    if (!host) return;
    var players = {};
    D.dribbles.forEach(function (p) { (players[p.team] = players[p.team] || {})[p.player] = 1; });
    function opts(side) {
      return Object.keys(players[side] || {}).sort().map(function (n) {
        return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
    }

    host.innerHTML =
      '<div class="controls-bar">' +
        '<span class="chip-toggle on home" id="drHome">' + esc(D.home.name) + "</span>" +
        '<span class="chip-toggle on away" id="drAway">' + esc(D.away.name) + "</span>" +
        '<span class="grp">Player <select id="drPlayer"><option value="">All players</option>' +
          '<optgroup label="' + esc(D.home.name) + '">' + opts("home") + "</optgroup>" +
          '<optgroup label="' + esc(D.away.name) + '">' + opts("away") + "</optgroup></select></span>" +
        '<span class="grp">Outcome <select id="drType">' +
          '<option value="all">All dribbles</option><option value="ok">Successful</option>' +
          '<option value="fail">Unsuccessful</option></select></span>' +
        '<span class="chip-toggle" id="drWindow">5-min window</span>' +
      "</div>" +
      '<div class="timeline-scrub">' +
        '<button class="play-btn" id="drPlay">▶</button>' +
        '<input type="range" id="drRange" min="0" max="' + (D.maxMin || 90) + '" value="' + (D.maxMin || 90) + '">' +
        '<span class="minlab" id="drMinLab"></span>' +
      "</div>" +
      '<div class="pitch-wrap"><svg class="pitch-svg" viewBox="-2 -2 ' + (PW + 4) + " " + (PH + 8) + '">' +
        '<defs>' +
          '<marker id="drArrG" markerWidth="4" markerHeight="4" refX="3.1" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 Z" fill="#33e893"/></marker>' +
          '<marker id="drArrR" markerWidth="4" markerHeight="4" refX="3.1" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 Z" fill="#ff5c7a"/></marker>' +
        "</defs>" +
        pitchMarkup() +
        '<text class="dir-label" x="3" y="' + (PH + 4) + '">◀ ' + esc(D.away.name) + "</text>" +
        '<text class="dir-label" x="' + (PW - 3) + '" y="' + (PH + 4) + '" text-anchor="end">' + esc(D.home.name) + " ▶</text>" +
        '<g id="dribLayer"></g>' +
      "</svg></div>" +
      '<div class="legend-row">' +
        '<span><i class="dot" style="background:#33e893"></i>successful</span>' +
        '<span><i class="dot" style="background:transparent;border:1px solid #ff5c7a"></i>unsuccessful</span>' +
        '<span>● = where the take-on happened · → carry direction (next touch)</span>' +
      "</div>" +
      '<div class="stat-note" id="drCount"></div>';

    // Carry direction: build_match_details now ships ex/ey for each take-on (the player's
    // next on-ball event, found across the FULL event stream). For any older match file
    // without it, fall back to inferring from the next tracked touch (pass/shot/dribble).
    (function () {
      var byPlayer = {}, T = function (o) { return (o.min || 0) * 60 + (o.sec || 0); };
      function add(t, pl, tt, x, y) { var k = t + "|" + pl; (byPlayer[k] = byPlayer[k] || []).push({ t: tt, x: x, y: y }); }
      (D.passes || []).forEach(function (p) { add(p.team, p.player, T(p), p.x, p.y); });
      (D.shots || []).forEach(function (s) { add(s.team, s.player, T(s), s.x, s.y); });
      (D.dribbles || []).forEach(function (d) { add(d.team, d.player, T(d), d.x, d.y); });
      Object.keys(byPlayer).forEach(function (k) { byPlayer[k].sort(function (a, b) { return a.t - b.t; }); });
      D.dribbles.forEach(function (d) {
        if (d.ex != null) { d._ex = d.ex; d._ey = d.ey; return; }   // prefer the server-computed end
        var arr = byPlayer[d.team + "|" + d.player] || [], dt = T(d), nxt = null;
        for (var i = 0; i < arr.length; i++) { if (arr[i].t > dt && arr[i].t - dt <= 8) { nxt = arr[i]; break; } }
        if (nxt && (Math.abs(nxt.x - d.x) > 0.8 || Math.abs(nxt.y - d.y) > 0.8)) { d._ex = nxt.x; d._ey = nxt.y; }
      });
    })();

    var state = { home: true, away: true, player: "", type: "all", windowMode: false, upper: D.maxMin || 90 };
    var layer = document.getElementById("dribLayer");
    var minLab = document.getElementById("drMinLab");
    var countEl = document.getElementById("drCount");
    var SVGNS = "http://www.w3.org/2000/svg";

    function filt(p) {
      if (!state[p.team]) return false;
      if (state.player && p.player !== state.player) return false;
      if (state.type === "ok" && !p.ok) return false;
      if (state.type === "fail" && p.ok) return false;
      if (p.min > state.upper) return false;
      if (state.windowMode && p.min < state.upper - 5) return false;
      return true;
    }

    function draw() {
      layer.innerHTML = "";
      var shown = 0, ok = 0;
      var frag = document.createDocumentFragment();
      D.dribbles.forEach(function (p) {
        if (!filt(p)) return;
        shown++; if (p.ok) ok++;
        var cx = tx(p.team, p.x), cy = ty(p.team, p.y);
        var col = p.ok ? "#33e893" : "#ff5c7a";
        if (p._ex != null) {
          var ax = tx(p.team, p._ex), ay = ty(p.team, p._ey);
          var arr = document.createElementNS(SVGNS, "line");
          arr.setAttribute("class", "drib-arrow");
          arr.setAttribute("x1", cx.toFixed(2)); arr.setAttribute("y1", cy.toFixed(2));
          arr.setAttribute("x2", ax.toFixed(2)); arr.setAttribute("y2", ay.toFixed(2));
          arr.setAttribute("stroke", col); arr.setAttribute("stroke-width", "0.45");
          arr.setAttribute("stroke-opacity", "0.85");
          arr.setAttribute("marker-end", p.ok ? "url(#drArrG)" : "url(#drArrR)");
          arr.addEventListener("mousemove", function (e) {
            showTip(e, "<b>" + esc(p.player) + "</b> " + p.min + "'<br>" +
              (p.ok ? "Successful dribble" : "Unsuccessful dribble") + " · carry direction");
          });
          arr.addEventListener("mouseleave", hideTip);
          frag.appendChild(arr);
        }
        var c = document.createElementNS(SVGNS, "circle");
        c.setAttribute("class", "drib-dot");
        c.setAttribute("cx", cx.toFixed(2)); c.setAttribute("cy", cy.toFixed(2));
        c.setAttribute("r", "1.1");
        c.setAttribute("fill", p.ok ? col : "none");
        c.setAttribute("stroke", col); c.setAttribute("stroke-width", "0.4");
        c.setAttribute("fill-opacity", "0.85");
        c.addEventListener("mousemove", function (e) {
          showTip(e, "<b>" + esc(p.player) + "</b> " + p.min + "'<br>" +
            (p.ok ? "Successful dribble" : "Unsuccessful dribble"));
        });
        c.addEventListener("mouseleave", hideTip);
        frag.appendChild(c);
      });
      layer.appendChild(frag);
      var pct = shown ? Math.round((100 * ok) / shown) : 0;
      countEl.textContent = shown + " dribbles · " + ok + " successful (" + pct + "%)" +
        (state.windowMode ? " · minutes " + Math.max(0, state.upper - 5) + "–" + state.upper
          : " · up to " + state.upper + "'");
    }
    function setUpper(v) {
      state.upper = v;
      minLab.textContent = (state.windowMode ? Math.max(0, v - 5) + "–" + v : "0–" + v) + "'";
      draw();
    }

    document.getElementById("drHome").addEventListener("click", function () { state.home = !state.home; this.classList.toggle("on"); draw(); });
    document.getElementById("drAway").addEventListener("click", function () { state.away = !state.away; this.classList.toggle("on"); draw(); });
    document.getElementById("drPlayer").addEventListener("change", function () { state.player = this.value; draw(); });
    document.getElementById("drType").addEventListener("change", function () { state.type = this.value; draw(); });
    document.getElementById("drWindow").addEventListener("click", function () { state.windowMode = !state.windowMode; this.classList.toggle("on"); setUpper(state.upper); });
    var range = document.getElementById("drRange");
    range.addEventListener("input", function () { stopPlay(); setUpper(parseInt(this.value, 10)); });

    var timer = null;
    var playBtn = document.getElementById("drPlay");
    function stopPlay() { if (timer) { clearInterval(timer); timer = null; playBtn.classList.remove("playing"); playBtn.textContent = "▶"; } }
    playBtn.addEventListener("click", function () {
      if (timer) { stopPlay(); return; }
      if (state.upper >= (D.maxMin || 90)) { range.value = 0; setUpper(0); }
      playBtn.classList.add("playing"); playBtn.textContent = "❚❚";
      timer = setInterval(function () {
        var v = state.upper + 1;
        if (v > (D.maxMin || 90)) { stopPlay(); return; }
        range.value = v; setUpper(v);
      }, 180);
    });

    setUpper(state.upper);
  }

  /* ================= PASS NETWORK (avg position + links) ================= */
  function buildNetwork(D) {
    var host = document.getElementById("mv-network");
    // name -> shirt number, per side, from the line-ups
    var numMap = { home: {}, away: {} };
    ["home", "away"].forEach(function (sd) {
      (D.lineups[sd].starters.concat(D.lineups[sd].subs)).forEach(function (p) {
        numMap[sd][p.name] = p.num;
      });
    });

    host.innerHTML =
      '<div class="controls-bar">' +
        '<span class="chip-toggle on home" id="nwHome">' + esc(D.home.name) + "</span>" +
        '<span class="chip-toggle away" id="nwAway">' + esc(D.away.name) + "</span>" +
        '<span class="grp">Min. combined passes <input type="range" id="nwMin" min="1" max="10" value="3" style="width:90px"> <b id="nwMinLab">3</b></span>' +
      "</div>" +
      '<div class="pitch-wrap"><svg class="pitch-svg" viewBox="-2 -2 ' + (PW + 4) + " " + (PH + 8) + '">' +
        pitchMarkup() +
        '<text class="dir-label" x="' + (PW / 2) + '" y="' + (PH + 4) + '" text-anchor="middle" id="nwDir">attacking →</text>' +
        '<g id="nwLinks"></g><g id="nwNodes"></g>' +
      "</svg></div>" +
      '<div class="legend-row">' +
        '<span>● node = player at average position · size = passes involved</span>' +
        '<span>line thickness = passes between the pair</span>' +
        '<span>starting XI, until the first substitution</span>' +
      "</div>" +
      '<div class="stat-note" id="nwNote"></div>';

    var state = { side: "home", minLink: 3 };
    var linkG = document.getElementById("nwLinks");
    var nodeG = document.getElementById("nwNodes");
    var note = document.getElementById("nwNote");
    var NS = "http://www.w3.org/2000/svg";

    // Standard pass network: the starting XI, using passes up to the first
    // substitution (the window in which all 11 were on the pitch together).
    function cutoffFor(side) {
      var subs = D.lineups[side].subs;
      return (subs && subs.length && subs[0].on != null) ? subs[0].on : (D.maxMin || 90);
    }

    function compute() {
      var nodes = {}; // name -> {sx,sy,n, passes}
      var links = {}; // "a|b" -> count
      var starter = {};
      D.lineups[state.side].starters.forEach(function (p) { starter[p.name] = true; });
      var cutoff = cutoffFor(state.side);
      function node(name) {
        return nodes[name] || (nodes[name] = { name: name, x: 0, y: 0, n: 0, passes: 0 });
      }
      D.passes.forEach(function (p) {
        if (p.team !== state.side || !p.ok || p.min > cutoff) return;
        if (!starter[p.player]) return;            // passer must be a starter
        var passer = node(p.player);
        passer.x += p.x; passer.y += p.y; passer.n++; passer.passes++;
        if (p.recv && starter[p.recv]) {           // receiver must be a starter too
          var r = node(p.recv);
          r.x += p.ex; r.y += p.ey; r.n++; r.passes++;
          var key = [p.player, p.recv].sort().join("|");
          links[key] = (links[key] || 0) + 1;
        }
      });
      Object.keys(nodes).forEach(function (k) {
        var nd = nodes[k]; if (nd.n) { nd.x /= nd.n; nd.y /= nd.n; }
      });
      return { nodes: nodes, links: links, cutoff: cutoff };
    }

    // Iterative overlap removal: push any two nodes whose circles intersect apart
    // along the line between them (each moves half the overlap), a few passes, then
    // clamp inside the pitch. Deterministic tie-break for exactly-coincident nodes.
    function declusterNodes(items, iters, minX, maxX, minY, maxY, pad) {
      for (var it = 0; it < iters; it++) {
        var moved = false;
        for (var i = 0; i < items.length; i++) {
          for (var j = i + 1; j < items.length; j++) {
            var a = items[i], b = items[j];
            var dx = b.cx - a.cx, dy = b.cy - a.cy;
            var d = Math.sqrt(dx * dx + dy * dy);
            var need = a.r + b.r + pad;
            if (d < need) {
              if (d < 1e-4) { dx = (i - j) || 1; dy = (i + 1); d = Math.sqrt(dx * dx + dy * dy); }
              var ux = dx / d, uy = dy / d, sh = (need - d) / 2;
              a.cx -= ux * sh; a.cy -= uy * sh;
              b.cx += ux * sh; b.cy += uy * sh;
              moved = true;
            }
          }
        }
        for (var m = 0; m < items.length; m++) {
          var t = items[m];
          t.cx = Math.max(minX + t.r, Math.min(maxX - t.r, t.cx));
          t.cy = Math.max(minY + t.r, Math.min(maxY - t.r, t.cy));
        }
        if (!moved) break;
      }
    }

    function draw() {
      var net = compute();
      var col = state.side === "home" ? D.home.color : D.away.color;
      linkG.innerHTML = ""; nodeG.innerHTML = "";
      var maxPasses = 1;
      Object.keys(net.nodes).forEach(function (k) { maxPasses = Math.max(maxPasses, net.nodes[k].passes); });
      var maxLink = 1;
      Object.keys(net.links).forEach(function (k) { maxLink = Math.max(maxLink, net.links[k]); });

      // Place each node at its average location (in SVG units), then nudge any
      // that overlap apart so crowded players (same zone) stay readable. Both the
      // pass lines and the nodes use these de-clustered positions.
      var pos = {};
      Object.keys(net.nodes).forEach(function (k) {
        var nd = net.nodes[k];
        pos[k] = { cx: tx(state.side, nd.x), cy: ty(state.side, nd.y),
                   r: 1.6 + 2.6 * nd.passes / maxPasses };
      });
      declusterNodes(Object.keys(pos).map(function (k) { return pos[k]; }), 80, 0, PW, 0, PH, 0.5);

      var nLinks = 0;
      Object.keys(net.links).forEach(function (key) {
        var count = net.links[key];
        if (count < state.minLink) return;
        var parts = key.split("|");
        var a = pos[parts[0]], b = pos[parts[1]];
        if (!a || !b) return;
        nLinks++;
        var ln = document.createElementNS(NS, "line");
        ln.setAttribute("x1", a.cx.toFixed(2)); ln.setAttribute("y1", a.cy.toFixed(2));
        ln.setAttribute("x2", b.cx.toFixed(2)); ln.setAttribute("y2", b.cy.toFixed(2));
        ln.setAttribute("stroke", col);
        ln.setAttribute("stroke-opacity", (0.25 + 0.6 * count / maxLink).toFixed(2));
        ln.setAttribute("stroke-width", (0.3 + 1.5 * count / maxLink).toFixed(2));
        ln.setAttribute("stroke-linecap", "round");
        ln.addEventListener("mousemove", function (e) {
          showTip(e, "<b>" + esc(parts[0]) + " ↔ " + esc(parts[1]) + "</b><br>" + count + " passes");
        });
        ln.addEventListener("mouseleave", hideTip);
        linkG.appendChild(ln);
      });

      Object.keys(net.nodes).forEach(function (k) {
        var nd = net.nodes[k];
        var p = pos[k], cx = p.cx, cy = p.cy, r = p.r;
        var c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", cx.toFixed(2)); c.setAttribute("cy", cy.toFixed(2));
        c.setAttribute("r", r.toFixed(2));
        c.setAttribute("fill", col); c.setAttribute("fill-opacity", "0.92");
        c.setAttribute("stroke", "#050611"); c.setAttribute("stroke-width", "0.3");
        c.addEventListener("mousemove", function (e) {
          showTip(e, "<b>" + esc(nd.name) + "</b><br>" + nd.passes + " passes involved");
        });
        c.addEventListener("mouseleave", hideTip);
        nodeG.appendChild(c);
        var num = numMap[state.side][nd.name];
        if (num != null) {
          var t = document.createElementNS(NS, "text");
          t.setAttribute("x", cx.toFixed(2)); t.setAttribute("y", (cy + 0.9).toFixed(2));
          t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "2.4");
          t.setAttribute("font-weight", "800"); t.setAttribute("fill", "#fff");
          t.setAttribute("pointer-events", "none");
          t.textContent = num;
          nodeG.appendChild(t);
        }
      });
      var teamName = state.side === "home" ? D.home.name : D.away.name;
      note.textContent = teamName + " · " + Object.keys(net.nodes).length + " players · " +
        nLinks + " passing links (min " + state.minLink + ") · positions up to the first sub (" + net.cutoff + "')";
      document.getElementById("nwDir").textContent =
        (state.side === "home" ? teamName + " attacking →" : "← " + teamName + " attacking");
    }

    function setSide(side) {
      state.side = side;
      document.getElementById("nwHome").classList.toggle("on", side === "home");
      document.getElementById("nwAway").classList.toggle("on", side === "away");
      draw();
    }
    document.getElementById("nwHome").addEventListener("click", function () { setSide("home"); });
    document.getElementById("nwAway").addEventListener("click", function () { setSide("away"); });
    document.getElementById("nwMin").addEventListener("input", function () {
      state.minLink = parseInt(this.value, 10); document.getElementById("nwMinLab").textContent = this.value; draw();
    });
    draw();
  }

  /* ================= AVERAGE POSITION (windowed, scrubbable) =================
     Like the pass network but it averages each player's touch positions over a sliding
     time window the user scrubs (or plays). Players appear/disappear as they're subbed
     on/off, so you can watch a team's shape shift across the game. */
  function buildAvgPos(D) {
    var host = document.getElementById("mv-avgpos");
    if (!host) return;
    var maxMin = D.maxMin || 90;
    var info = { home: {}, away: {} };           // name -> {num, on, off} per side
    ["home", "away"].forEach(function (sd) {
      D.lineups[sd].starters.concat(D.lineups[sd].subs).forEach(function (p) {
        info[sd][p.name] = { num: p.num, on: (p.on != null ? p.on : 0), off: (p.off != null ? p.off : maxMin) };
      });
    });

    host.innerHTML =
      '<div class="controls-bar">' +
        '<span class="chip-toggle on home" id="apHome">' + esc(D.home.name) + "</span>" +
        '<span class="chip-toggle away" id="apAway">' + esc(D.away.name) + "</span>" +
        '<span class="grp">Window <select id="apWin">' +
          '<option value="10">10 min</option><option value="15" selected>15 min</option>' +
          '<option value="20">20 min</option><option value="0">Full (0→now)</option></select></span>' +
      "</div>" +
      '<div class="timeline-scrub">' +
        '<button class="play-btn" id="apPlay">▶</button>' +
        '<input type="range" id="apRange" min="0" max="' + maxMin + '" value="' + maxMin + '">' +
        '<span class="minlab" id="apMinLab"></span>' +
      "</div>" +
      '<div class="pitch-wrap"><svg class="pitch-svg" viewBox="-2 -2 ' + (PW + 4) + " " + (PH + 8) + '">' +
        pitchMarkup() +
        '<text class="dir-label" x="' + (PW / 2) + '" y="' + (PH + 4) + '" text-anchor="middle" id="apDir">attacking →</text>' +
        '<g id="apNodes"></g>' +
      "</svg></div>" +
      '<div class="legend-row">' +
        "<span>● node = player's average position in the window · size = touches</span>" +
        "<span>players appear/disappear as they're subbed on and off</span>" +
        "<span>scrub or press ▶ to watch the shape change</span>" +
      "</div>" +
      '<div class="stat-note" id="apNote"></div>';

    var state = { side: "home", win: 15, upper: maxMin };
    var nodeG = document.getElementById("apNodes");
    var minLab = document.getElementById("apMinLab");
    var note = document.getElementById("apNote");
    var NS = "http://www.w3.org/2000/svg";

    function compute() {
      var lo = state.win === 0 ? 0 : Math.max(0, state.upper - state.win), hi = state.upper, side = state.side;
      var acc = {};
      function inWin(m) { return m >= lo && m <= hi; }
      function add(name, x, y) { if (!info[side][name]) return; var a = acc[name] || (acc[name] = { x: 0, y: 0, n: 0 }); a.x += x; a.y += y; a.n++; }
      D.passes.forEach(function (p) {
        if (p.team !== side || !inWin(p.min)) return;
        add(p.player, p.x, p.y);
        if (p.recv) add(p.recv, p.ex, p.ey);     // receiver counts at where the ball arrived
      });
      (D.dribbles || []).forEach(function (d) { if (d.team === side && inWin(d.min)) add(d.player, d.x, d.y); });
      (D.shots || []).forEach(function (s) { if (s.team === side && inWin(s.min)) add(s.player, s.x, s.y); });
      var out = [];
      Object.keys(acc).forEach(function (name) {
        var a = acc[name], pi = info[side][name];
        if (!a.n || !pi || !(pi.on < hi && pi.off > lo)) return;   // must be on the pitch in window
        out.push({ name: name, x: a.x / a.n, y: a.y / a.n, n: a.n, num: pi.num });
      });
      return { players: out, lo: lo, hi: hi };
    }

    function draw() {
      var net = compute();
      var col = state.side === "home" ? D.home.color : D.away.color;
      nodeG.innerHTML = "";
      var maxN = 1; net.players.forEach(function (p) { maxN = Math.max(maxN, p.n); });
      net.players.forEach(function (p) {
        var cx = tx(state.side, p.x), cy = ty(state.side, p.y);
        var r = 1.6 + 2.4 * p.n / maxN;
        var c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", cx.toFixed(2)); c.setAttribute("cy", cy.toFixed(2));
        c.setAttribute("r", r.toFixed(2));
        c.setAttribute("fill", col); c.setAttribute("fill-opacity", "0.92");
        c.setAttribute("stroke", "#050611"); c.setAttribute("stroke-width", "0.3");
        (function (pl) {
          c.addEventListener("mousemove", function (e) {
            var pi = info[state.side][pl.name] || {};
            showTip(e, "<b>" + esc(pl.name) + "</b><br>" + pl.n + " touches · on pitch " + pi.on + "–" + pi.off + "'");
          });
          c.addEventListener("mouseleave", hideTip);
        })(p);
        nodeG.appendChild(c);
        if (p.num != null) {
          var t = document.createElementNS(NS, "text");
          t.setAttribute("x", cx.toFixed(2)); t.setAttribute("y", (cy + 0.9).toFixed(2));
          t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "2.4");
          t.setAttribute("font-weight", "800"); t.setAttribute("fill", "#fff");
          t.setAttribute("pointer-events", "none");
          t.textContent = p.num;
          nodeG.appendChild(t);
        }
      });
      var teamName = state.side === "home" ? D.home.name : D.away.name;
      note.textContent = teamName + " · " + net.players.length + " players on pitch · average positions, minutes " +
        net.lo + "–" + net.hi + (state.win === 0 ? " (full)" : "");
      document.getElementById("apDir").textContent =
        (state.side === "home" ? teamName + " attacking →" : "← " + teamName + " attacking");
    }

    function setUpper(v) {
      state.upper = v;
      var lo = state.win === 0 ? 0 : Math.max(0, v - state.win);
      minLab.textContent = lo + "–" + v + "'";
      draw();
    }
    function setSide(side) {
      state.side = side;
      document.getElementById("apHome").classList.toggle("on", side === "home");
      document.getElementById("apAway").classList.toggle("on", side === "away");
      draw();
    }
    document.getElementById("apHome").addEventListener("click", function () { setSide("home"); });
    document.getElementById("apAway").addEventListener("click", function () { setSide("away"); });
    document.getElementById("apWin").addEventListener("change", function () { state.win = parseInt(this.value, 10); setUpper(state.upper); });
    var range = document.getElementById("apRange");
    range.addEventListener("input", function () { stopPlay(); setUpper(parseInt(this.value, 10)); });

    var timer = null;
    var playBtn = document.getElementById("apPlay");
    function stopPlay() { if (timer) { clearInterval(timer); timer = null; playBtn.classList.remove("playing"); playBtn.textContent = "▶"; } }
    playBtn.addEventListener("click", function () {
      if (timer) { stopPlay(); return; }
      if (state.upper >= maxMin) { range.value = 0; setUpper(0); }
      playBtn.classList.add("playing"); playBtn.textContent = "❚❚";
      timer = setInterval(function () {
        var v = state.upper + 1;
        if (v > maxMin) { stopPlay(); return; }
        range.value = v; setUpper(v);
      }, 180);
    });

    setUpper(state.upper);
  }

  /* ================= LINE-UPS ================= */
  function ratingColor(r) {
    return r >= 7.5 ? "#1a8a1a" : r >= 6.5 ? "#5b9e1e" : r >= 6.0 ? "#9aa6bd" : "#cc4400";
  }
  function buildLineups(D) {
    function badges(p) {
      var b = "";
      for (var i = 0; i < (p.g || 0); i++) b += "⚽";
      if (p.a) b += ' <span class="ast">A' + (p.a > 1 ? "×" + p.a : "") + "</span>";
      for (var y = 0; y < (p.yc || 0); y++) b += ' <span class="cardm yc"></span>';
      if (p.rc) b += ' <span class="cardm rc"></span>';
      return b;
    }
    function li(p) {
      var rt = p.rating != null
        ? '<span class="rt" style="background:' + ratingColor(p.rating) + '">' + p.rating.toFixed(1) + "</span>"
        : '<span class="rt none">–</span>';
      var mins = p.mins != null ? '<span class="mins">' + p.mins + "'</span>" : "";
      return "<li><span class='no'>" + (p.num == null ? "" : p.num) + "</span>" +
        "<span class='pname'>" + (p.motm ? "<span class='star'>★</span> " : "") + esc(p.name) +
        "<span class='pos'>" + esc(p.pos) + "</span></span>" +
        "<span class='badges'>" + badges(p) + "</span>" + mins + rt + "</li>";
    }
    function card(side, data) {
      var name = side === "home" ? D.home.name : D.away.name;
      return '<div class="lineup-card"><h4>' + esc(name) +
        '<span class="lh">Min · G/A · Rating</span></h4><ul>' +
        data.starters.map(li).join("") +
        (data.subs.length ? '<li class="subhdr">Substitutes used</li>' + data.subs.map(li).join("") : "") +
        "</ul></div>";
    }
    document.getElementById("mv-lineups").innerHTML =
      '<div class="lineups-grid">' + card("home", D.lineups.home) + card("away", D.lineups.away) + "</div>" +
      '<div class="legend-row" style="margin-top:14px">' +
        "<span>⚽ goal</span><span><b class='ast'>A</b> assist</span>" +
        '<span><i class="cardm yc"></i> yellow</span><span><i class="cardm rc"></i> red</span>' +
        "<span>rating coloured by value · min = minutes played</span></div>";
  }

  /* ================= ALL GOALS MAP ================= */
  // Opta-style per-goal build-up: shirt-number touch nodes, dotted passes, solid
  // carries/dribbles, red shot, orange move-start, grey keeper-save (from saves[]).
  // Reconstructed from the same arrays the other maps use; reuses tx()/ty()/pitchMarkup().
  function agmNorm(s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
  function agmIni(n) { return n ? n.split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase() : ""; }
  function agmT(o) { return (o.min || 0) * 60 + (o.sec || 0); }
  function agmNumMap(D) {
    var m = {};
    ["home", "away"].forEach(function (sd) {
      var lu = (D.lineups && D.lineups[sd]) || {};
      [].concat(lu.starters || [], lu.subs || []).forEach(function (p) {
        if (p && p.name != null && p.num != null) m[agmNorm(p.name)] = p.num;
      });
    });
    return m;
  }
  function buildGoalSequences(D) {
    var ev = [].concat(
      (D.passes || []).filter(function (p) { return p.ok; })
        .map(function (p) { return { k: "pass", t: agmT(p), team: p.team, x: p.x, y: p.y, ex: p.ex, ey: p.ey, player: p.player, cross: !!p.cross, key: !!p.key, through: !!p.through }; }),
      (D.dribbles || []).filter(function (d) { return d.ok; })
        .map(function (d) { return { k: "dribble", t: agmT(d), team: d.team, x: d.x, y: d.y, player: d.player }; }),
      // Inferred carries (build_match_details `_infer_carries`): uncontested runs onto a loose
      // ball that WhoScored never logs as their own event. Rendered the same as a real take-on
      // (same node/line style) but tagged `carry` so the tooltip can say so.
      (D.carries || [])
        .map(function (c) { return { k: "dribble", t: agmT(c), team: c.team, x: c.x, y: c.y, player: c.player, carry: true }; })
    ).sort(function (a, b) { return a.t - b.t; });
    var saves = D.saves || [];
    function assistFor(shot) {
      var g = D.goals || [];
      for (var i = 0; i < g.length; i++) if (g[i].min === shot.min && agmNorm(g[i].scorer) === agmNorm(shot.player)) return g[i].assist;
      return null;
    }
    var seqs = (D.shots || []).filter(function (s) { return s.goal; }).map(function (shot) {
      var T = agmT(shot);
      // buildupWindow (build_match_details `_buildup_window`) bounds the lookback to when the
      // OPPONENT last actually touched the ball, not a fixed clock — a patient, unbroken
      // keep-ball move can run well past 35s (e.g. a 60s+ passing spell before a stoppage-time
      // winner) without getting truncated. Falls back to 35 for older cached data. Within that
      // window the chain is trusted to be one continuous spell, so gaps between actions (a
      // held-up dribble/carry that isn't itself a logged event) get a generous 9s tolerance
      // instead of the tighter cutoff a fixed-clock heuristic needed to avoid drifting into
      // unrelated earlier play.
      var win = shot.buildupWindow != null ? shot.buildupWindow : 35;
      var chain = ev.filter(function (e) { return e.team === shot.team && e.t <= T && e.t >= T - win; });
      var seq = [];
      for (var i = chain.length - 1; i >= 0; i--) { if (seq.length && seq[0].t - chain[i].t > 9) break; seq.unshift(chain[i]); }
      // Turnover / defensive-error goal: no same-team passing build-up. Show where the ball
      // was won (build_match_details `won`) as the move origin so the map isn't a lone node.
      if (!seq.length && shot.won) seq.push({ k: "won", team: shot.team, x: shot.won.x, y: shot.won.y, player: null, kind: shot.won.kind, by: shot.won.by });
      var rebound = false;
      // Rebound: a same-team shot saved/blocked before the goal → splice in the original
      // effort + keeper save, in time order, before the goal node. Runs whether or not
      // passes preceded, so rebounds show even with a build-up chain. Lookback matches the
      // build-up window (capped) rather than a fixed 4s, so a prior effort that's part of the
      // SAME reconstructed passage (e.g. a saved shot whose rebound is half-cleared, carried,
      // and crossed in for the goal) still gets pulled in even when that scramble runs longer
      // than a typical instant rebound.
      var priorLookback = Math.max(4, Math.min(win, 20));
      var prior = null, best = -1;
      (D.shots || []).forEach(function (s2) { var tt = agmT(s2); if (s2.team === shot.team && !s2.goal && tt < T && T - tt <= priorLookback && tt > best) { best = tt; prior = s2; } });
      if (prior) {
        rebound = true;
        seq.push({ k: "shot_eff", team: prior.team, x: prior.x, y: prior.y, player: prior.player, xg: prior.xg });
        var sv = null, sb = -1;
        // Anchored on the PRIOR SHOT's own time (a save happens the instant the shot is
        // stopped), not the eventual goal's time — otherwise a save several seconds before a
        // goal reached via a longer scramble never matches.
        saves.forEach(function (v) { var tt = agmT(v); if (v.team !== shot.team && Math.abs(tt - best) <= 3 && tt > sb) { sb = tt; sv = v; } });
        if (sv) seq.push({ k: "save", opp: true, team: sv.team, x: sv.x, y: sv.y, player: sv.player });  // graceful: omitted if no saves[]
      }
      seq.push({ k: "shot", team: shot.team, x: shot.x, y: shot.y, player: shot.player, xg: shot.xg });
      var ppl = {}; seq.forEach(function (s) { if (s.k !== "save" && s.player) ppl[agmNorm(s.player)] = 1; });
      return {
        scorer: shot.player, min: shot.min, side: shot.team, assist: assistFor(shot), rebound: rebound, steps: seq,
        players: Object.keys(ppl).length,
        passes: seq.filter(function (s) { return s.k === "pass"; }).length,
        crosses: seq.filter(function (s) { return s.k === "pass" && s.cross; }).length,
        dribbles: seq.filter(function (s) { return s.k === "dribble"; }).length, xg: shot.xg
      };
    });
    // Own goals: reconstruct the BENEFICIARY team's build-up (passes/dribbles) in the
    // seconds before the own goal, then finish on a single red "OG" node at the end they
    // were attacking (coords were mirrored into their frame in build_match_details).
    // Own-goal events carry only a minute (no second), so anchor on the end of that minute
    // to capture the attacking team's touches that forced it.
    (D.goals || []).forEach(function (g) {
      if (!g.own || g.x == null) return;
      var benef = g.team;                                      // side that benefits from the OG
      // Own-goal events carry only a minute (no second), so anchor on the beneficiary's
      // LAST touch within that minute (the cross/shot that forced it) instead of assuming
      // the :59 mark — otherwise the look-back window sits AFTER the real build-up and the
      // diagram collapses to a lone OG node.
      var ogEnd = ((g.min || 0) + 1) * 60, T = (g.min || 0) * 60 + 59;
      for (var q = ev.length - 1; q >= 0; q--) { if (ev[q].team === benef && ev[q].t <= ogEnd) { T = ev[q].t; break; } }
      var chain = ev.filter(function (e) { return e.team === benef && e.t <= T && e.t >= T - 30; });
      var seq = [];
      for (var k = chain.length - 1; k >= 0; k--) { if (seq.length && seq[0].t - chain[k].t > 6) break; seq.unshift(chain[k]); }
      seq.push({ k: "shot", team: benef, x: g.x, y: g.y, player: g.scorer, og: true });
      var ppl = {}; seq.forEach(function (s) { if (s.k !== "save" && s.player && !s.og) ppl[agmNorm(s.player)] = 1; });
      seqs.push({
        scorer: "Own goal", ogBy: g.scorer, min: g.min, side: benef, assist: null, rebound: false, own: true,
        steps: seq,
        players: Object.keys(ppl).length,
        passes: seq.filter(function (s) { return s.k === "pass"; }).length,
        crosses: seq.filter(function (s) { return s.k === "pass" && s.cross; }).length,
        dribbles: seq.filter(function (s) { return s.k === "dribble"; }).length, xg: null
      });
    });
    seqs.sort(function (a, b) { return (a.min || 0) - (b.min || 0); });
    return seqs;
  }
  /* ---- hover tooltips: turn each map from a "picture" into a graph you can probe ----
     Every action (touch node, pass, cross, carry, shot) carries a rich HTML detail
     string, stashed URI-encoded in data-tip and surfaced through the shared floating
     #tooltip (showTip/hideTip) via one delegated handler per SVG (agmWireTips). */
  function agmTipAttr(html) { return html ? ' data-tip="' + encodeURIComponent(html) + '"' : ""; }
  function agmWho(player, numMap, i) {
    var num = (player && numMap) ? numMap[agmNorm(player)] : null;
    return (player ? esc(player) : ("Touch " + ((i || 0) + 1))) + (num != null ? " · #" + num : "");
  }
  function agmNodeTip(pt, i, seq, numMap) {
    if (pt.og) return "<b>Own goal</b><br>" + esc(pt.player || "");
    if (pt.k === "won") {
      var wl = { error: "opponent error", dispossession: "dispossession", interception: "interception",
                 "loose ball": "loose ball", tackle: "tackle won" }[pt.kind] || "turnover";
      return "<b>Ball won</b><br>" + wl + (pt.by ? " · " + esc(pt.by) : "");
    }
    var who = agmWho(pt.player, numMap, i), mm = (seq && seq.min != null) ? (" · " + seq.min + "'") : "";
    if (pt.k === "save") return "<b>" + who + "</b><br>Goalkeeper save";
    if (pt.k === "shot") return "<b>" + who + "</b><br>⚽ Goal" + (pt.xg != null ? " · xG " + pt.xg.toFixed(2) : "") + mm;
    if (pt.k === "shot_eff") return "<b>" + who + "</b><br>Shot saved" + (pt.xg != null ? " · xG " + pt.xg.toFixed(2) : "");
    if (pt.k === "dribble") return "<b>" + who + "</b><br>" + (pt.carry ? "Carried the ball forward" : "Take-on / dribble");
    if (i === 0) return "<b>" + who + "</b><br>Move start" + mm;
    return "<b>" + who + "</b><br>On the ball";
  }
  function agmSegTip(kind, opt) {
    opt = opt || {};
    if (kind === "pass")  {
      var lab = opt.through ? "Through ball" : opt.key ? "Key pass" : "Pass";
      if (opt.assist) lab = (opt.through || opt.key) ? "Assist (" + lab.toLowerCase() + ")" : "Assist";
      return "<b>" + lab + "</b>" + (opt.by ? "<br>from " + esc(opt.by) : "");
    }
    if (kind === "cross") return "<b>" + (opt.assist ? "Assist (cross)" : "Cross") + "</b>" + (opt.by ? "<br>from " + esc(opt.by) : "");
    if (kind === "carry") return "<b>Carry / dribble</b>" + (opt.to ? "<br>to " + esc(opt.to) : "");
    if (kind === "shot")  return "<b>Shot</b>" + (opt.by ? "<br>" + esc(opt.by) : "") + (opt.xg != null ? " · xG " + opt.xg.toFixed(2) : "");
    return "<b>" + esc(kind) + "</b>";
  }
  // One delegated listener per map SVG: reads the nearest data-tip and floats the detail.
  function agmWireTips(svg) {
    if (!svg || svg._tipWired) return;
    svg._tipWired = true;
    svg.addEventListener("mousemove", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
      if (t) showTip(e, decodeURIComponent(t.getAttribute("data-tip")));
      else hideTip();
    });
    svg.addEventListener("mouseleave", hideTip);
  }
  function agmLine(x1, y1, x2, y2, cls, tip) {
    var m = cls === "agm-pass" ? "agmAp" : (cls === "agm-shotln" ? "agmAs" : "agmAc");
    var vis = '<line class="' + cls + '" x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) +
      '" y2="' + y2.toFixed(2) + '" marker-end="url(#' + m + ')"/>';
    if (!tip) return vis;
    // Transparent fat hit-line on top so even dashed passes hover reliably (the gaps
    // between dots aren't painted, so the visible line alone is hard to catch).
    var hit = '<line class="agm-hit" x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) + '"/>';
    return '<g' + agmTipAttr(tip) + '>' + vis + hit + '</g>';
  }
  // A cross renders like a pass (same fine dots) but CURVED — a quadratic arc bowed
  // perpendicular to the line, so it reads as a cross while staying a pass-type delivery.
  function agmArc(x1, y1, x2, y2, cls, tip) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    var off = Math.min(7, len * 0.2);                      // bow height, capped
    var cx = mx + (-dy / len) * off, cy = my + (dx / len) * off;
    var d = 'M' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' Q' + cx.toFixed(2) + ',' + cy.toFixed(2) + ' ' + x2.toFixed(2) + ',' + y2.toFixed(2);
    var vis = '<path class="' + cls + '" d="' + d + '" marker-end="url(#agmAp)"/>';
    if (!tip) return vis;
    var hit = '<path class="agm-hit" d="' + d + '"/>';
    return '<g' + agmTipAttr(tip) + '>' + vis + hit + '</g>';
  }
  function agmNode(x, y, label, tip, cls) {
    var dark = (cls === "start" || cls === "shot" || cls === "save");
    return '<g' + agmTipAttr(tip) + '><circle class="agm-node' + (cls ? (" " + cls) : "") +
      '" cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="1.3"/>' +
      '<text class="agm-nt' + (dark ? " dark" : "") + '" x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '">' + esc(label) + "</text></g>";
  }
  var AGM_MAX_SEG = 52;  // pitch units (~half length); drop diagram segments longer than this (glitched source coords)
  function agmSeqSVG(seq, numMap, D) {
    var defs = '<defs>' +
      '<marker id="agmAp" markerWidth="3" markerHeight="3" refX="2.4" refY="1.5" orient="auto"><path d="M0,0 L3,1.5 L0,3 Z" class="agm-mk"/></marker>' +
      '<marker id="agmAc" markerWidth="3" markerHeight="3" refX="2.4" refY="1.5" orient="auto"><path d="M0,0 L3,1.5 L0,3 Z" class="agm-mk"/></marker>' +
      '<marker id="agmAs" markerWidth="3" markerHeight="3" refX="2.4" refY="1.5" orient="auto"><path d="M0,0 L3,1.5 L0,3 Z" class="agm-mk-shot"/></marker></defs>';
    var P = seq.steps.map(function (st) {
      var sd = st.team || seq.side;
      return { k: st.k, player: st.player, xg: st.xg, team: sd, cross: !!st.cross, key: !!st.key, through: !!st.through, og: !!st.og,
               kind: st.kind, by: st.by,
               x: tx(sd, st.x), y: ty(sd, st.y), ex: tx(sd, st.ex != null ? st.ex : st.x), ey: ty(sd, st.ey != null ? st.ey : st.y) };
    });
    // Mark the assisting delivery — the last pass by the credited assister before the
    // finish — so it labels as "Assist" rather than a generic "Pass".
    var assistNorm = seq.assist ? agmNorm(seq.assist) : null, lastPassIx = -1;
    for (var pi = 0; pi < P.length; pi++) if (P[pi].k === "pass") lastPassIx = pi;
    if (assistNorm && lastPassIx >= 0 && agmNorm(P[lastPassIx].player) === assistNorm) P[lastPassIx].assist = true;
    var teamName = seq.side === "home" ? D.home.name : D.away.name;
    // Home attacks right (▶); away attacks left (◀) — match the rest of the dashboard.
    var dirTxt = seq.side === "home" ? (esc(teamName) + " attacking ▶") : ("◀ " + esc(teamName) + " attacking");
    var a = [defs, pitchMarkup(),
      '<text class="dir-label" x="' + (PW / 2) + '" y="' + (PH + 4) + '" text-anchor="middle">' + dirTxt + '</text>'];
    for (var i = 0; i < P.length; i++) {
      var pt = P[i];
      if (pt.k === "pass") a.push(pt.cross ? agmArc(pt.x, pt.y, pt.ex, pt.ey, "agm-cross", agmSegTip("cross", { by: pt.player, assist: pt.assist }))   // curved dotted = cross
                                           : agmLine(pt.x, pt.y, pt.ex, pt.ey, "agm-pass", agmSegTip("pass", { by: pt.player, key: pt.key, through: pt.through, assist: pt.assist }))); // straight dotted = pass
      if (i < P.length - 1) {
        var nx = P[i + 1];
        var fx = pt.k === "pass" ? pt.ex : pt.x, fy = pt.k === "pass" ? pt.ey : pt.y;
        var toKeeper = (nx.k === "save");
        var cls = toKeeper ? "agm-shotln" : "agm-carry";                            // saved effort→keeper = red; else solid carry
        var segTip = toKeeper ? agmSegTip("shot", { by: pt.player, xg: pt.xg }) : agmSegTip("carry", { to: nx.player });
        var dcon = Math.hypot(nx.x - fx, nx.y - fy);
        if (dcon > 1.0 && dcon <= AGM_MAX_SEG) a.push(agmLine(fx, fy, nx.x, nx.y, cls, segTip)); // skip cross-pitch spans from bad source coords
      }
    }
    var L = P[P.length - 1];
    var gx = tx(L.team, 99.4), gy = ty(L.team, 50);
    // Only draw the shot→goal line when the shot is plausibly in the attacking half.
    // A few feeds carry a glitched goal coordinate (e.g. at the wrong end); without
    // this guard that produced a line straight across the whole pitch.
    if (Math.hypot(gx - L.x, gy - L.y) <= AGM_MAX_SEG) a.push(agmLine(L.x, L.y, gx, gy, "agm-shotln", agmSegTip("shot", { by: seq.scorer, xg: L.xg })));
    P.forEach(function (pt, i) {
      var cls = pt.k === "save" ? "save" : (pt.k === "shot" ? "shot" : (pt.k === "dribble" ? "drib" : (i === 0 ? "start" : "")));
      var num = numMap[agmNorm(pt.player)];
      var label = pt.og ? "OG" : pt.k === "won" ? "" : ((num != null) ? num : (agmIni(pt.player) || (i + 1)));
      a.push(agmNode(pt.x, pt.y, label, agmNodeTip(pt, i, seq, numMap), cls));
    });
    var ly = Math.max(3.4, L.y - 2.0);                                              // scorer name + xG ABOVE the finishing node
    a.push('<text class="agm-scorelab" x="' + L.x.toFixed(2) + '" y="' + (ly - 1.7).toFixed(2) + '">' + esc(seq.scorer) + "</text>");
    if (L.xg != null) a.push('<text class="agm-xglab" x="' + L.x.toFixed(2) + '" y="' + ly.toFixed(2) + '">xG ' + L.xg.toFixed(2) + "</text>");
    for (var j = 0; j < P.length; j++) if (P[j].k === "save") { a.push('<text class="agm-savelab" x="' + P[j].x.toFixed(2) + '" y="' + (P[j].y - 2.0).toFixed(2) + '" text-anchor="middle">SAVE</text>'); break; }
    for (var jw = 0; jw < P.length; jw++) if (P[jw].k === "won") { a.push('<text class="agm-savelab" x="' + P[jw].x.toFixed(2) + '" y="' + (P[jw].y + 3.4).toFixed(2) + '" text-anchor="middle">ball won</text>'); break; }
    return '<svg class="pitch-svg" viewBox="-2 -2 ' + (PW + 4) + " " + (PH + 8) + '">' + a.join("") + "</svg>";
  }
  // Self-contained <style> for export: the live SVG relies on external match.css
  // classes + CSS vars, which don't travel into a serialized/standalone SVG. Resolve
  // the theme vars to literal colours and embed the needed rules so the PNG matches.
  function agmExportStyle() {
    var rc = getComputedStyle(document.documentElement);
    function v(n, d) { var x = rc.getPropertyValue(n).trim(); return x || d; }
    var TEXT = v("--text", "#eef0fb"), BAD = v("--bad", "#ff5c7a"), WARN = v("--warn", "#ffc857"),
        MUTED = v("--muted", "#8b8fb8"), CARD2 = v("--card-2", "#1b2440"), BG = v("--bg", "#050611"),
        BG2 = v("--bg-2", "#0b0d1f");
    return "<style>" +
      ".pitch-bg{fill:" + BG2 + "}.pitch-line{fill:none;stroke:rgba(255,255,255,.28);stroke-width:.3}" +
      ".dir-label{fill:rgba(255,255,255,.5);font-size:2.4px;font-weight:700;font-family:sans-serif}" +
      ".agm-pass{stroke:" + TEXT + ";stroke-width:.5;fill:none;stroke-linecap:round;stroke-dasharray:.15 1.05}" +
      ".agm-cross{stroke:" + TEXT + ";stroke-width:.5;fill:none;stroke-linecap:round;stroke-dasharray:.15 1.05}" +
      ".agm-carry{stroke:" + TEXT + ";stroke-width:.34;fill:none}" +
      ".agm-shotln{stroke:" + BAD + ";stroke-width:.45;fill:none}" +
      ".agm-mk{fill:" + TEXT + "}.agm-mk-shot{fill:" + BAD + "}" +
      ".agm-node{fill:" + CARD2 + ";stroke:" + TEXT + ";stroke-width:.22}" +
      ".agm-node.start{fill:" + WARN + ";stroke:#e0a83a}.agm-node.shot{fill:" + BAD + ";stroke:#e0456f}.agm-node.save{fill:" + MUTED + ";stroke:#6b7488}" +
      ".agm-nt{font-size:1.35px;font-weight:700;fill:" + TEXT + ";text-anchor:middle;dominant-baseline:central;font-family:sans-serif}.agm-nt.dark{fill:" + BG + "}" +
      ".agm-scorelab{font-size:2px;font-weight:700;fill:" + TEXT + ";text-anchor:middle;font-family:sans-serif}" +
      ".agm-xglab{font-size:1.7px;font-weight:700;fill:" + BAD + ";text-anchor:middle;font-family:sans-serif}" +
      ".agm-savelab{font-size:1.5px;font-weight:600;fill:" + MUTED + ";text-anchor:middle;font-family:sans-serif}" +
      "</style>";
  }
  function agmSanitize(s) { return String(s || "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""); }
  function agmFmtDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); if (!m) return s || "";
    var mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return (+m[3]) + " " + mo[(+m[2]) - 1] + " " + m[1];
  }
  // Export one goal's SVG to a PNG (dependency-free) with an "Rshiri" watermark.
  function exportGoalPNG(svgEl, g, D, btn) {
    try {
      var rc = getComputedStyle(document.documentElement);
      function cvar(n, d) { var x = rc.getPropertyValue(n).trim(); return x || d; }
      var bg = cvar("--card", "#0b0d1f"), text = cvar("--text", "#eef0fb"), muted = cvar("--muted", "#8b8fb8"),
          bad = cvar("--bad", "#ff5c7a"), line = cvar("--line", "#262c52");
      var F = "-apple-system,'Segoe UI',Arial,sans-serif";
      var clone = svgEl.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.insertAdjacentHTML("afterbegin", agmExportStyle());   // embed resolved styles
      var scale = 12, W = (PW + 4) * scale, SH = (PH + 8) * scale; // svg (pitch) area
      var band = Math.round(W * 0.11);                            // header band height
      var H = SH + band;
      clone.setAttribute("width", W); clone.setAttribute("height", SH);
      var svgStr = new XMLSerializer().serializeToString(clone);
      var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        var ctx = cv.getContext("2d");
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);            // dark card background
        var pad = Math.round(W * 0.022);
        // ---- header band ----
        var hn = (D.home && D.home.name) || "Home", an = (D.away && D.away.name) || "Away";
        var hs = (D.home && D.home.score != null) ? D.home.score : "", as = (D.away && D.away.score != null) ? D.away.score : "";
        var title = hn + "  " + hs + "–" + as + "  " + an;   // en-dash score
        var sub = [(D.stage || "").trim(), agmFmtDate(D.date)].filter(Boolean).join("   ·   ");
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        ctx.fillStyle = text; ctx.font = "bold " + Math.round(band * 0.32) + "px " + F;
        ctx.fillText(title, pad, Math.round(band * 0.40));
        ctx.fillStyle = muted; ctx.font = Math.round(band * 0.20) + "px " + F;
        ctx.fillText(sub, pad, Math.round(band * 0.74));
        // scorer · minute (right side of band, accent red)
        ctx.textAlign = "right"; ctx.fillStyle = bad; ctx.font = "bold " + Math.round(band * 0.24) + "px " + F;
        ctx.fillText("⚽ " + (g.scorer || "") + "  " + g.min + "'", W - pad, Math.round(band * 0.55));
        // divider under band
        ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, band - 1); ctx.lineTo(W, band - 1); ctx.stroke();
        // ---- pitch diagram below the band ----
        ctx.drawImage(img, 0, band, W, SH);
        // ---- credit, bottom-right corner ----
        ctx.textAlign = "right"; ctx.textBaseline = "bottom";
        ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "bold " + Math.round(W * 0.017) + "px " + F;
        ctx.fillText("All rights reserved to @RShiri", W - pad, H - Math.round(W * 0.012));
        var fname = agmSanitize((D.id || "match") + "_" + (g.scorer || "goal") + "_" + g.min) + ".png";
        cv.toBlob(function (blob) {
          var a = document.createElement("a"); a.download = fname; a.href = URL.createObjectURL(blob);
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
          if (btn) { btn.textContent = "✓ Saved"; setTimeout(function () { btn.textContent = "⤓ Download PNG"; }, 1500); }
        }, "image/png");
      };
      img.onerror = function () { if (btn) btn.textContent = "Export failed"; };
      img.src = url;
    } catch (e) { if (btn) btn.textContent = "Export failed"; }
  }
  function buildAllGoals(D) {
    var host = document.getElementById("mv-goals");
    if (!host) return;
    var seqs = buildGoalSequences(D);
    if (!seqs.length) { if (host.parentNode) host.parentNode.style.display = "none"; return; }  // 0–0 etc → render nothing
    var numMap = agmNumMap(D);
    function meta(g) {
      if (g.own) {
        var ohas = (g.passes + g.dribbles) > 0;
        var olead = ohas
          ? g.players + " player" + (g.players === 1 ? "" : "s") + " · " + g.passes + " pass" + (g.passes === 1 ? "" : "es") +
            (g.dribbles ? " · " + g.dribbles + " dribble" + (g.dribbles === 1 ? "" : "s") : "")
          : "Own goal";
        return '<div class="agm-meta"><span class="agm-pill lead">' + olead + "</span>" +
          (g.crosses ? '<span class="agm-pill">' + g.crosses + " cross" + (g.crosses === 1 ? "" : "es") + "</span>" : "") +
          '<span class="agm-pill">forced own goal by <b>' + esc(g.ogBy || "") + "</b></span></div>";
      }
      var counts = g.players + " player" + (g.players === 1 ? "" : "s") + " · " + g.passes + " pass" + (g.passes === 1 ? "" : "es") +
        " · " + g.dribbles + " dribble" + (g.dribbles === 1 ? "" : "s");
      var assist = g.assist ? '<span class="agm-pill">assist <b>' + esc(g.assist) + "</b></span>" : '<span class="agm-pill">unassisted</span>';
      var reb = g.rebound ? '<span class="agm-pill">rebound</span>' : "";
      var crs = g.crosses ? '<span class="agm-pill">' + g.crosses + " cross" + (g.crosses === 1 ? "" : "es") + "</span>" : "";
      return '<div class="agm-meta"><span class="agm-pill lead">' + counts + '</span><span class="agm-pill">xG <b>' +
        (g.xg != null ? g.xg.toFixed(2) : "—") + "</b></span>" + crs + assist + reb + "</div>";
    }
    function roster(g) {
      if (g.own) {
        var oseen = [], onum = {};
        g.steps.forEach(function (st) { if (!st.og && st.k !== "save" && st.player && oseen.indexOf(st.player) < 0) { oseen.push(st.player); onum[st.player] = numMap[agmNorm(st.player)]; } });
        var obuild = oseen.length
          ? "<b>Build-up:</b> " + oseen.map(function (n) { return esc(n) + (onum[n] != null ? " (#" + onum[n] + ")" : ""); }).join(" · ") + " · "
          : "";
        return '<div class="agm-roster">' + obuild + "<b>Own goal</b> by " + esc(g.ogBy || "") + "</div>";
      }
      var seen = [], num = {};
      g.steps.forEach(function (st) { if (st.k !== "save" && st.player && seen.indexOf(st.player) < 0) { seen.push(st.player); num[st.player] = numMap[agmNorm(st.player)]; } });
      var sv = null; g.steps.forEach(function (s) { if (s.k === "save") sv = s; });
      var sx = sv ? " · saved by " + esc(sv.player) : "";
      return '<div class="agm-roster"><b>Players in move:</b> ' +
        seen.map(function (n) { return esc(n) + (num[n] != null ? " (#" + num[n] + ")" : ""); }).join(" · ") + sx + "</div>";
    }
    var legend = '<div class="agm-legend">' +
      '<span class="it"><span class="agm-lz">7</span>Touch (shirt #)</span>' +
      '<span class="it"><span class="agm-lz start"></span>Move start</span>' +
      '<span class="it"><span class="agm-lz save"></span>Keeper save</span>' +
      '<span class="it"><span class="agm-lz shot"></span>Shot (xG)</span>' +
      '<span class="it"><span class="agm-lln"></span>Pass</span>' +
      '<span class="it"><svg class="agm-crosslg" width="20" height="9" viewBox="0 0 20 9"><path d="M1,7 Q10,0 19,7"/></svg>Cross</span>' +
      '<span class="it"><span class="agm-lln carry"></span>Carry / dribble</span>' +
      '<span class="it"><span class="agm-lln shot"></span>Shot</span>' +
      '<span class="it agm-hint">🛈 Hover any action for detail</span></div>';
    var tabs = '<div class="agm-tabs">' + seqs.map(function (g, i) {
      var col = g.side === "home" ? D.home.color : D.away.color;
      return '<button class="agm-tab" data-i="' + i + '"><span class="sw" style="background:' + col + '"></span><span class="mm">' +
        g.min + "'</span> " + esc(g.scorer) + "</button>";
    }).join("") + "</div>";
    host.innerHTML = tabs + '<div id="agm-feat"></div>';
    var feat = document.getElementById("agm-feat");
    function sel(i) {
      [].forEach.call(host.querySelectorAll(".agm-tab"), function (b, j) { b.classList.toggle("active", j === i); });
      var g = seqs[i];
      feat.innerHTML = meta(g) +
        '<div class="agm-actions"><button type="button" class="agm-dl">⤓ Download PNG</button></div>' +
        roster(g) + '<div class="pitch-wrap">' + agmSeqSVG(g, numMap, D) + "</div>" + legend;
      agmWireTips(feat.querySelector("svg.pitch-svg"));
      var btn = feat.querySelector(".agm-dl");
      if (btn) btn.addEventListener("click", function () {
        exportGoalPNG(feat.querySelector("svg.pitch-svg"), g, D, btn);
      });
    }
    host.querySelector(".agm-tabs").addEventListener("click", function (e) {
      var b = e.target.closest(".agm-tab"); if (!b) return; sel(+b.getAttribute("data-i"));
    });
    var def = 0; seqs.forEach(function (g, i) { if (g.players > seqs[def].players) def = i; });  // open on the richest move
    sel(def);
  }

  /* ================= ANIMATED GOAL REPLAYS ================= */
  // A "movie" version of the All Goals Map: the ball physically travels the build-up —
  // gliding along passes, curving on crosses, carrying on dribbles, then firing the shot
  // into the net. Reuses the SAME geometry (tx/ty, pitchMarkup, buildGoalSequences) and
  // CSS classes as the static map, so the still frame at rest IS the All Goals Map.
  var AGM_ANIM_LABEL = { pass: "Pass", cross: "Cross", carry: "Carry / dribble", shotln: "Shot", shot: "Shot" };
  function agmClamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function agmSegClass(t) { return t === "pass" ? "agm-pass" : t === "cross" ? "agm-cross" : t === "carry" ? "agm-carry" : "agm-shotln"; }
  function agmSegMarker(t) { return t === "pass" ? "agmAp2" : t === "cross" ? "agmAc2" : t === "carry" ? "agmAc2" : "agmAs2"; }
  function agmSegDpath(m) {
    if (m.type === "cross") {
      var dx = m.x2 - m.x1, dy = m.y2 - m.y1, len = Math.hypot(dx, dy) || 1, off = Math.min(7, len * 0.2);
      var mx = (m.x1 + m.x2) / 2, my = (m.y1 + m.y2) / 2, cx = mx + (-dy / len) * off, cy = my + (dx / len) * off;
      return "M" + m.x1.toFixed(2) + "," + m.y1.toFixed(2) + " Q" + cx.toFixed(2) + "," + cy.toFixed(2) + " " + m.x2.toFixed(2) + "," + m.y2.toFixed(2);
    }
    return "M" + m.x1.toFixed(2) + "," + m.y1.toFixed(2) + " L" + m.x2.toFixed(2) + "," + m.y2.toFixed(2);
  }
  // Order the goal's steps into ball-travel "moves": node→(pass)→pass-end→(carry)→next
  // node … →(shot)→goal. Mirrors agmSeqSVG's segment logic so the path matches exactly.
  function agmJourney(P) {
    var mv = [];
    for (var i = 0; i < P.length; i++) {
      var pt = P[i];
      if (pt.k === "pass") {
        mv.push({ type: pt.cross ? "cross" : "pass", x1: pt.x, y1: pt.y, x2: pt.ex, y2: pt.ey, litNode: null,
                  tip: agmSegTip(pt.cross ? "cross" : "pass", { by: pt.player }) });
        if (i < P.length - 1) {
          var nx = P[i + 1], L = Math.hypot(nx.x - pt.ex, nx.y - pt.ey);
          mv.push({ type: nx.k === "save" ? "shotln" : "carry", x1: pt.ex, y1: pt.ey, x2: nx.x, y2: nx.y, litNode: i + 1, hidden: !(L > 1.0 && L <= AGM_MAX_SEG),
                    tip: nx.k === "save" ? agmSegTip("shot", { by: pt.player, xg: pt.xg }) : agmSegTip("carry", { to: nx.player }) });
        }
      } else if (i < P.length - 1) {
        var nx2 = P[i + 1], L2 = Math.hypot(nx2.x - pt.x, nx2.y - pt.y);
        mv.push({ type: nx2.k === "save" ? "shotln" : "carry", x1: pt.x, y1: pt.y, x2: nx2.x, y2: nx2.y, litNode: i + 1, hidden: !(L2 > 1.0 && L2 <= AGM_MAX_SEG),
                  tip: nx2.k === "save" ? agmSegTip("shot", { by: pt.player, xg: pt.xg }) : agmSegTip("carry", { to: nx2.player }) });
      }
    }
    var Lp = P[P.length - 1], gx = tx(Lp.team, 99.4), gy = ty(Lp.team, 50), sl = Math.hypot(gx - Lp.x, gy - Lp.y);
    mv.push({ type: "shot", x1: Lp.x, y1: Lp.y, x2: gx, y2: gy, litNode: null, hidden: !(sl <= AGM_MAX_SEG),
              tip: agmSegTip("shot", { by: Lp.player, xg: Lp.xg }) });
    mv.forEach(function (m) {
      var len = Math.hypot(m.x2 - m.x1, m.y2 - m.y1);
      if (m.hidden) { m.dur = 160; m.dwell = 0; }
      else if (m.type === "pass" || m.type === "cross") { m.dur = agmClamp(380 + len * 9, 380, 950); m.dwell = 150; }
      else if (m.type === "shot") { m.dur = 470; m.dwell = 0; }
      else if (m.type === "shotln") { m.dur = 380; m.dwell = 120; }
      else { m.dur = agmClamp(360 + len * 30, 360, 1500); m.dwell = 220; }   // carry/dribble — deliberately slower than a pass (you can't dribble at pass speed)
    });
    return mv;
  }
  // Generic rAF driver. R = { node(i), seg(i,state), action(type), ball(x,y), trail(pts[]) }.
  // Returns a cancel fn. Used by BOTH the live SVG and the canvas video export.
  function agmAnimateMove(mv, speed, R, done) {
    var i = 0, t0 = performance.now(), arrived = false, trail = [], raf = null;
    R.node(0);
    function lerp(m, f) { return { x: m.x1 + (m.x2 - m.x1) * f, y: m.y1 + (m.y2 - m.y1) * f }; }
    function loop(now) {
      var m = mv[i], dur = Math.max(60, m.dur / speed), e = now - t0, f = Math.min(e, dur) / dur;
      var pos = m.el ? m.el.getPointAtLength(f * m.len) : lerp(m, f);
      R.seg(i, true); R.action(m.type); R.ball(pos.x, pos.y);
      trail.push([pos.x, pos.y]); if (trail.length > 16) trail.shift(); R.trail(trail);
      if (e >= dur && !arrived) { arrived = true; if (m.litNode != null) R.node(m.litNode); R.seg(i, "done"); }
      if (e >= dur + (m.dwell || 0) / speed) { i++; arrived = false; t0 = now; if (i >= mv.length) { done(); return; } }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return function () { if (raf) cancelAnimationFrame(raf); };
  }
  function agmBuildAnimSVG(seq, numMap, D) {
    function E(n, a) { var e = document.createElementNS("http://www.w3.org/2000/svg", n); if (a) for (var k in a) e.setAttribute(k, a[k]); return e; }
    var P = seq.steps.map(function (st) {
      var sd = st.team || seq.side;
      return { k: st.k, player: st.player, xg: st.xg, team: sd, cross: !!st.cross, og: !!st.og,
               x: tx(sd, st.x), y: ty(sd, st.y), ex: tx(sd, st.ex != null ? st.ex : st.x), ey: ty(sd, st.ey != null ? st.ey : st.y) };
    });
    var mv = agmJourney(P);
    var teamName = seq.side === "home" ? D.home.name : D.away.name;
    var dirTxt = seq.side === "home" ? (esc(teamName) + " attacking ▶") : ("◀ " + esc(teamName) + " attacking");
    var defs = '<defs>' +
      '<marker id="agmAp2" markerWidth="3" markerHeight="3" refX="2.4" refY="1.5" orient="auto"><path d="M0,0 L3,1.5 L0,3 Z" class="agm-mk"/></marker>' +
      '<marker id="agmAc2" markerWidth="3" markerHeight="3" refX="2.4" refY="1.5" orient="auto"><path d="M0,0 L3,1.5 L0,3 Z" class="agm-mk"/></marker>' +
      '<marker id="agmAs2" markerWidth="3" markerHeight="3" refX="2.4" refY="1.5" orient="auto"><path d="M0,0 L3,1.5 L0,3 Z" class="agm-mk-shot"/></marker></defs>';
    var L = P[P.length - 1], ly = Math.max(3.4, L.y - 2.0), labels = "";
    labels += '<text class="agm-scorelab" x="' + L.x.toFixed(2) + '" y="' + (ly - 1.7).toFixed(2) + '">' + esc(seq.scorer) + "</text>";
    if (L.xg != null) labels += '<text class="agm-xglab" x="' + L.x.toFixed(2) + '" y="' + ly.toFixed(2) + '">xG ' + L.xg.toFixed(2) + "</text>";
    for (var j = 0; j < P.length; j++) if (P[j].k === "save") { labels += '<text class="agm-savelab" x="' + P[j].x.toFixed(2) + '" y="' + (P[j].y - 2.0).toFixed(2) + '" text-anchor="middle">SAVE</text>'; break; }
    var svg = E("svg", { class: "pitch-svg", viewBox: "-2 -2 " + (PW + 4) + " " + (PH + 8) });
    var gPitch = E("g", {});
    gPitch.innerHTML = defs + pitchMarkup() +
      '<text class="dir-label" x="' + (PW / 2) + '" y="' + (PH + 4) + '" text-anchor="middle">' + dirTxt + "</text>" + labels;
    svg.appendChild(gPitch);
    mv.forEach(function (m) {
      if (m.hidden) { m.len = Math.hypot(m.x2 - m.x1, m.y2 - m.y1); m.el = null; return; }
      var p = E("path", { class: agmSegClass(m.type), d: agmSegDpath(m), "marker-end": "url(#" + agmSegMarker(m.type) + ")" });
      svg.appendChild(p); m.el = p; m.len = p.getTotalLength();
      // transparent fat hit-path on top so each action hovers reliably (dashed passes included)
      if (m.tip) svg.appendChild(E("path", { class: "agm-hit", d: agmSegDpath(m), "data-tip": encodeURIComponent(m.tip) }));
    });
    var nodeEls = P.map(function (pt, i) {
      var cls = pt.k === "save" ? "save" : (pt.k === "shot" ? "shot" : (pt.k === "dribble" ? "drib" : (i === 0 ? "start" : "")));
      var num = numMap[agmNorm(pt.player)], label = pt.og ? "OG" : ((num != null) ? num : (agmIni(pt.player) || (i + 1)));
      var dark = (cls === "start" || cls === "shot" || cls === "save");
      var g = E("g", { "data-tip": encodeURIComponent(agmNodeTip(pt, i, seq, numMap)) });
      g.appendChild(E("circle", { class: "agm-node" + (cls ? " " + cls : ""), cx: pt.x.toFixed(2), cy: pt.y.toFixed(2), r: 1.3 }));
      var tx2 = E("text", { class: "agm-nt" + (dark ? " dark" : ""), x: pt.x.toFixed(2), y: pt.y.toFixed(2) }); tx2.textContent = label;
      g.appendChild(tx2); svg.appendChild(g); return g;
    });
    var trail = E("polyline", { class: "agm-trail", points: "" }); svg.appendChild(trail);
    var ball = E("circle", { class: "agm-ball", cx: P[0].x.toFixed(2), cy: P[0].y.toFixed(2), r: 1.45 }); ball.style.opacity = "0"; svg.appendChild(ball);
    var glast = mv[mv.length - 1], gx = glast.x2, gy = glast.y2;
    var goalText = E("text", { class: "agm-goalflash", x: (seq.side === "home" ? gx - 10 : gx + 10).toFixed(2), y: Math.max(6, gy - 7).toFixed(2), "text-anchor": "middle" });
    goalText.textContent = "Goal!"; goalText.style.opacity = "0"; svg.appendChild(goalText);

    // Scorer-as-player: the finishing node (last shot touch) runs ONTO the ball — i.e. it
    // travels with the ball through the carry that delivers play to the scorer, then plants
    // and shoots. Skipped for own goals (no real scorer movement to show).
    var scorerIdx = P.length - 1, moveScorer = scorerIdx > 0 && !P[scorerIdx].og, carryMoveIdx = null;
    for (var mi = 0; mi < mv.length; mi++) if (mv[mi].litNode === scorerIdx) { carryMoveIdx = mi; break; }
    if (carryMoveIdx == null) moveScorer = false;
    var scorerG = nodeEls[scorerIdx], restX = P[scorerIdx].x, restY = P[scorerIdx].y;
    if (moveScorer) svg.appendChild(scorerG);   // keep the scorer marker above the ball while it runs with it

    var api = { svg: svg, mv: mv, P: P, gx: gx, gy: gy, onAction: null, onDone: null, _cancel: null };
    function goalFlash() { var t0 = performance.now(); (function f(now) { var e = (now - t0) / 600; if (e >= 1) { goalText.style.opacity = "1"; return; } goalText.style.opacity = String(e); requestAnimationFrame(f); })(performance.now()); }
    api.stop = function () { if (api._cancel) { api._cancel(); api._cancel = null; } };
    api.restState = function () {
      api.stop();
      mv.forEach(function (m) { if (m.el) m.el.style.opacity = "1"; });
      nodeEls.forEach(function (g) { g.style.opacity = "1"; g.removeAttribute("transform"); });
      ball.style.opacity = "0"; trail.setAttribute("points", ""); goalText.style.opacity = "0";
    };
    api.play = function (speed) {
      api.stop();
      mv.forEach(function (m) { if (m.el) m.el.style.opacity = "0.16"; });
      nodeEls.forEach(function (g, i) { g.style.opacity = i === 0 ? "1" : "0.28"; g.removeAttribute("transform"); });
      if (moveScorer) scorerG.style.opacity = "0";   // scorer appears only once they get on the ball
      goalText.style.opacity = "0"; trail.setAttribute("points", "");
      ball.style.opacity = "1"; ball.setAttribute("cx", P[0].x.toFixed(2)); ball.setAttribute("cy", P[0].y.toFixed(2));
      var curMove = -1;
      var R = {
        node: function (i) { if (nodeEls[i]) nodeEls[i].style.opacity = "1"; },
        seg: function (i, st) { curMove = i; if (mv[i].el) mv[i].el.style.opacity = (st === "done") ? "0.6" : "1"; },
        action: function (t) { if (api.onAction) api.onAction(t); },
        ball: function (x, y) {
          ball.setAttribute("cx", x.toFixed(2)); ball.setAttribute("cy", y.toFixed(2));
          if (moveScorer && curMove === carryMoveIdx) {   // scorer runs onto the ball and carries it to the shot
            scorerG.style.opacity = "1";
            scorerG.setAttribute("transform", "translate(" + (x - restX).toFixed(2) + "," + (y - restY).toFixed(2) + ")");
          }
        },
        trail: function (pts) { trail.setAttribute("points", pts.map(function (p) { return p[0].toFixed(2) + "," + p[1].toFixed(2); }).join(" ")); }
      };
      api._cancel = agmAnimateMove(mv, speed, R, function () { api._cancel = null; if (moveScorer) scorerG.removeAttribute("transform"); goalFlash(); if (api.onDone) api.onDone(); });
    };
    api.restState();
    return api;
  }
  // Record the replay to a WebM video (dependency-free: MediaRecorder + canvas.captureStream).
  // Backdrop = the canonical static All Goals Map (agmSeqSVG) rasterised once; the ball +
  // comet trail are drawn per frame on top, with the same header band + credit as the PNG.
  function exportGoalVideo(anim, seq, g, D, numMap, btn, speed) {
    var canRec = window.MediaRecorder && typeof document.createElement("canvas").captureStream === "function";
    if (!canRec) { if (btn) btn.textContent = "Saving PNG…"; exportGoalPNG(anim.svg, g, D, btn); return; }
    try {
      var rc = getComputedStyle(document.documentElement);
      function cvar(n, d) { var x = rc.getPropertyValue(n).trim(); return x || d; }
      var bg = cvar("--card", "#0b0d1f"), text = cvar("--text", "#eef0fb"), muted = cvar("--muted", "#8b8fb8"),
          bad = cvar("--bad", "#ff5c7a"), line = cvar("--line", "#262c52");
      var F = "-apple-system,'Segoe UI',Arial,sans-serif";
      var wrap = document.createElement("div"); wrap.innerHTML = agmSeqSVG(seq, numMap, D);
      var s = wrap.firstChild; s.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      s.insertAdjacentHTML("afterbegin", agmExportStyle());
      var scale = 10, W = (PW + 4) * scale, SH = (PH + 8) * scale, band = Math.round(W * 0.11), H = SH + band;
      s.setAttribute("width", W); s.setAttribute("height", SH);
      var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(s));
      var img = new Image();
      img.onerror = function () { if (btn) btn.textContent = "Export failed"; };
      img.onload = function () {
        var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
        var ctx = cv.getContext("2d");
        function MX(x) { return (x + 2) * scale; } function MY(y) { return band + (y + 2) * scale; }
        function drawBase() {
          ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
          var pad = Math.round(W * 0.022);
          var hn = (D.home && D.home.name) || "Home", an = (D.away && D.away.name) || "Away";
          var hs = (D.home && D.home.score != null) ? D.home.score : "", as = (D.away && D.away.score != null) ? D.away.score : "";
          ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
          ctx.fillStyle = text; ctx.font = "bold " + Math.round(band * 0.32) + "px " + F;
          ctx.fillText(hn + "  " + hs + "–" + as + "  " + an, pad, Math.round(band * 0.40));
          ctx.fillStyle = muted; ctx.font = Math.round(band * 0.20) + "px " + F;
          ctx.fillText([(D.stage || "").trim(), agmFmtDate(D.date)].filter(Boolean).join("   ·   "), pad, Math.round(band * 0.74));
          ctx.textAlign = "right"; ctx.fillStyle = bad; ctx.font = "bold " + Math.round(band * 0.24) + "px " + F;
          ctx.fillText("⚽ " + (g.scorer || "") + "  " + g.min + "'", W - pad, Math.round(band * 0.55));
          ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, band - 1); ctx.lineTo(W, band - 1); ctx.stroke();
          ctx.drawImage(img, 0, band, W, SH);
          ctx.textAlign = "right"; ctx.textBaseline = "bottom";
          ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "bold " + Math.round(W * 0.017) + "px " + F;
          ctx.fillText("All rights reserved to @RShiri", W - pad, H - Math.round(W * 0.012));
        }
        function drawBall(pos, trail) {
          if (trail && trail.length > 1) {
            ctx.strokeStyle = "#fff0b3"; ctx.lineWidth = 0.7 * scale; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.globalAlpha = 0.6;
            ctx.beginPath(); trail.forEach(function (p, k) { var X = MX(p[0]), Y = MY(p[1]); if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.stroke(); ctx.globalAlpha = 1;
          }
          ctx.fillStyle = "#fff"; ctx.strokeStyle = bg; ctx.lineWidth = 0.3 * scale;
          ctx.beginPath(); ctx.arc(MX(pos[0]), MY(pos[1]), 1.45 * scale, 0, 6.2832); ctx.fill(); ctx.stroke();
        }
        drawBase();
        var stream = cv.captureStream(30);
        var mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0] || "video/webm";
        var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 }), chunks = [];
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          var blob = new Blob(chunks, { type: mime });
          var fname = agmSanitize((D.id || "match") + "_" + (g.scorer || "goal") + "_" + g.min) + ".webm";
          var a = document.createElement("a"); a.download = fname; a.href = URL.createObjectURL(blob);
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
          if (btn) { btn.textContent = "✓ Saved"; setTimeout(function () { btn.textContent = "⤓ Download video"; }, 1800); }
        };
        rec.start();
        var cur = [anim.P[0].x, anim.P[0].y], curTrail = [];
        var R = {
          node: function () {}, seg: function () {}, action: function () {},
          ball: function (x, y) { cur = [x, y]; },
          trail: function (pts) { curTrail = pts.slice(); drawBase(); drawBall(cur, curTrail); }
        };
        agmAnimateMove(anim.mv, speed, R, function () {
          var t0 = performance.now();
          (function gf(now) {
            var e = (now - t0) / 800; drawBase(); drawBall([anim.gx, anim.gy], curTrail);
            ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.globalAlpha = Math.min(1, e * 1.4);
            ctx.fillStyle = bad; ctx.font = "bold " + Math.round(band * 0.55) + "px " + F;
            ctx.fillText("Goal!", MX(anim.gx) + (seq.side === "home" ? -10 * scale : 10 * scale), MY(anim.gy) - 7 * scale);
            ctx.globalAlpha = 1;
            if (e < 1) requestAnimationFrame(gf); else setTimeout(function () { try { rec.stop(); } catch (z) {} }, 140);
          })(performance.now());
        });
        if (btn) btn.textContent = "● Recording…";
      };
      img.src = url;
    } catch (e) { if (btn) btn.textContent = "Export failed"; }
  }
  function buildGoalReplays(D) {
    var host = document.getElementById("mv-goals-anim");
    if (!host) return;
    var seqs = buildGoalSequences(D);
    if (!seqs.length) { if (host.parentNode) host.parentNode.style.display = "none"; return; }
    var numMap = agmNumMap(D);
    var legend = '<div class="agm-legend">' +
      '<span class="it"><span class="agm-lz">7</span>Touch (shirt #)</span>' +
      '<span class="it"><span class="agm-lz start"></span>Move start</span>' +
      '<span class="it"><span class="agm-lz shot"></span>Shot (xG)</span>' +
      '<span class="it"><span class="agm-lln"></span>Pass</span>' +
      '<span class="it"><svg class="agm-crosslg" width="20" height="9" viewBox="0 0 20 9"><path d="M1,7 Q10,0 19,7"/></svg>Cross</span>' +
      '<span class="it"><span class="agm-lln carry"></span>Carry / dribble</span>' +
      '<span class="it"><span class="agm-lln shot"></span>Shot</span>' +
      '<span class="it agm-hint">🛈 Hover any action for detail</span></div>';
    function metaLine(g) {
      var counts = g.players + " player" + (g.players === 1 ? "" : "s") + " · " + g.passes + " pass" + (g.passes === 1 ? "" : "es") +
        " · " + g.dribbles + " dribble" + (g.dribbles === 1 ? "" : "s");
      return '<div class="agm-meta"><span class="agm-pill lead">' + counts + '</span>' +
        (g.xg != null ? '<span class="agm-pill">xG <b>' + g.xg.toFixed(2) + "</b></span>" : "") +
        (g.assist ? '<span class="agm-pill">assist <b>' + esc(g.assist) + "</b></span>" : "") + "</div>";
    }
    var tabs = '<div class="agm-tabs">' + seqs.map(function (g, i) {
      var col = g.side === "home" ? D.home.color : D.away.color;
      return '<button class="agm-tab" data-i="' + i + '"><span class="sw" style="background:' + col + '"></span><span class="mm">' +
        g.min + "'</span> " + esc(g.scorer) + "</button>";
    }).join("") + "</div>";
    host.innerHTML = tabs + '<div id="agm-anim-feat"></div>';
    var feat = document.getElementById("agm-anim-feat");
    var current = null;
    function sel(i) {
      [].forEach.call(host.querySelectorAll(".agm-tab"), function (b, j) { b.classList.toggle("active", j === i); });
      if (current) current.stop();
      var g = seqs[i];
      feat.innerHTML = metaLine(g) +
        '<div class="agm-anim-bar">' +
          '<button type="button" class="agm-dl agm-play">▶ Play</button>' +
          '<span class="spd">Speed <input type="range" class="agm-spd" min="0.5" max="2" step="0.5" value="1"><b class="agm-spdv">1×</b></span>' +
          '<button type="button" class="agm-dl agm-vid">⤓ Download video</button>' +
          '<span class="agm-action">Press play</span>' +
        "</div>" +
        '<div class="pitch-wrap"></div>' + legend;
      var anim = agmBuildAnimSVG(g, numMap, D);
      current = anim;
      var actionEl = feat.querySelector(".agm-action");
      anim.onAction = function (t) { actionEl.innerHTML = "now: <b>" + (AGM_ANIM_LABEL[t] || t) + "</b>"; };
      anim.onDone = function () { actionEl.innerHTML = "now: <b>Goal!</b>"; };
      feat.querySelector(".pitch-wrap").appendChild(anim.svg);
      agmWireTips(anim.svg);
      var spd = feat.querySelector(".agm-spd"), spdv = feat.querySelector(".agm-spdv");
      var speed = 1;
      spd.addEventListener("input", function () { speed = parseFloat(spd.value); spdv.textContent = speed + "×"; });
      var playBtn = feat.querySelector(".agm-play");
      playBtn.addEventListener("click", function () { playBtn.textContent = "↻ Replay"; anim.play(speed); });
      var vidBtn = feat.querySelector(".agm-vid");
      vidBtn.addEventListener("click", function () { exportGoalVideo(anim, g, g, D, numMap, vidBtn, speed); });
    }
    host.querySelector(".agm-tabs").addEventListener("click", function (e) {
      var b = e.target.closest(".agm-tab"); if (!b) return; sel(+b.getAttribute("data-i"));
    });
    var def = 0; seqs.forEach(function (g, i) { if (g.players > seqs[def].players) def = i; });
    sel(def);
  }

  /* ================= PENALTY SHOOTOUT ================= */
  // A goal-mouth "behind the net" view: every shootout kick plotted where it landed
  // in the goal frame (WhoScored GoalMouthY/Z), coloured by outcome (scored / saved /
  // missed) with a team-colour ring. Team chooser + a kick-by-kick list with the
  // running tally sit alongside. This is the last block on the page (below all graphs).
  function buildShootout(D) {
    var host = document.getElementById("mv-shootout");
    if (!host) return;
    var pens = D.shootout || [];
    if (!pens.length) { if (host.parentNode) host.parentNode.style.display = "none"; return; }

    // goal-mouth view mapping (WhoScored: GoalMouthY across, GoalMouthZ up).
    // Posts sit at GoalMouthY 45.2 / 54.8; crossbar at GoalMouthZ ≈ 38.
    var GW = 100, GROUND = 50, GY0 = 43, GYR = 14, GZTOP = 48;
    function gxOf(gy) { return (Math.max(GY0, Math.min(GY0 + GYR, gy)) - GY0) / GYR * GW; }
    function gyOf(gz) { return GROUND - Math.max(0, Math.min(GZTOP, gz)); }
    var postL = gxOf(45.2), postR = gxOf(54.8), barY = gyOf(38);
    var OUT_COL = { goal: "#33e893", saved: "#ff5c7a", missed: "#ffc857", post: "#ffc857" };
    var OUT_LBL = { goal: "Scored", saved: "Saved", missed: "Off target", post: "Hit post" };
    var OUT_ICON = { goal: "⚽", saved: "🧤", missed: "✗", post: "▮" };

    var fr = "#eef0fb", ng = "rgba(255,255,255,0.14)";
    var net = [];
    net.push('<rect x="-2" y="-2" width="' + (GW + 4) + '" height="' + (GROUND + 6) + '" fill="#0b0d1f"/>');
    net.push('<rect x="' + postL.toFixed(1) + '" y="' + barY.toFixed(1) + '" width="' + (postR - postL).toFixed(1) +
      '" height="' + (GROUND - barY).toFixed(1) + '" fill="rgba(255,255,255,0.04)"/>');
    for (var nx = postL; nx <= postR + 0.01; nx += 3.2)
      net.push('<line x1="' + nx.toFixed(1) + '" y1="' + barY.toFixed(1) + '" x2="' + nx.toFixed(1) + '" y2="' + GROUND + '" stroke="' + ng + '" stroke-width="0.18"/>');
    for (var nyy = barY; nyy <= GROUND + 0.01; nyy += 3.0)
      net.push('<line x1="' + postL.toFixed(1) + '" y1="' + nyy.toFixed(1) + '" x2="' + postR.toFixed(1) + '" y2="' + nyy.toFixed(1) + '" stroke="' + ng + '" stroke-width="0.18"/>');
    net.push('<line x1="0" y1="' + GROUND + '" x2="' + GW + '" y2="' + GROUND + '" stroke="rgba(255,255,255,0.3)" stroke-width="0.4"/>');
    net.push('<line x1="' + postL.toFixed(1) + '" y1="' + GROUND + '" x2="' + postL.toFixed(1) + '" y2="' + barY.toFixed(1) + '" stroke="' + fr + '" stroke-width="1.1"/>');
    net.push('<line x1="' + postR.toFixed(1) + '" y1="' + GROUND + '" x2="' + postR.toFixed(1) + '" y2="' + barY.toFixed(1) + '" stroke="' + fr + '" stroke-width="1.1"/>');
    net.push('<line x1="' + (postL - 0.55).toFixed(1) + '" y1="' + barY.toFixed(1) + '" x2="' + (postR + 0.55).toFixed(1) + '" y2="' + barY.toFixed(1) + '" stroke="' + fr + '" stroke-width="1.1"/>');

    var hp = D.home.pens, ap = D.away.pens;
    var summary = "";
    if (hp != null && ap != null) {
      var win = hp > ap ? D.home.name : ap > hp ? D.away.name : null;
      summary = '<div class="so-summary"><b>' + esc(D.home.name) + " " + hp + " – " + ap + " " + esc(D.away.name) + "</b>" +
        (win ? ' <span class="so-win">' + esc(win) + " win on penalties</span>" : "") + "</div>";
    }

    host.innerHTML = summary +
      '<div class="controls-bar">' +
        '<span class="chip-toggle on home" id="soHome">' + esc(D.home.name) + "</span>" +
        '<span class="chip-toggle on away" id="soAway">' + esc(D.away.name) + "</span>" +
      "</div>" +
      '<div class="pitch-wrap"><svg class="pitch-svg" viewBox="-2 -2 ' + (GW + 4) + ' ' + (GROUND + 8) + '">' +
        net.join("") +
        '<text class="dir-label" x="' + (GW / 2) + '" y="' + (GROUND + 5) + '" text-anchor="middle">Goal-mouth view · placement of each kick</text>' +
        '<g id="soLayer"></g>' +
      "</svg></div>" +
      '<div class="legend-row">' +
        '<span><i class="dot" style="background:' + OUT_COL.goal + '"></i>Scored</span>' +
        '<span><i class="dot" style="background:' + OUT_COL.saved + '"></i>Saved</span>' +
        '<span><i class="dot" style="background:' + OUT_COL.missed + '"></i>Off target / post</span>' +
        '<span><i class="dot" style="background:#222;border:2px solid var(--c-home)"></i>Team ring</span>' +
      "</div>" +
      '<div class="so-list" id="soList"></div>';

    var layer = document.getElementById("soLayer");
    var state = { home: true, away: true };

    function draw() {
      layer.innerHTML = "";
      var NS = "http://www.w3.org/2000/svg";
      pens.forEach(function (k) {
        if (!state[k.team]) return;
        if (k.gy == null || k.gz == null) return;   // no placement coords → list only
        // Flip (GW - gxOf) so placement reads from the shooter's/broadcast perspective —
        // GoalMouthY grows toward the attacker's left. Matches the on-target shot map.
        var cx = GW - gxOf(k.gy), cy = gyOf(k.gz);
        var ring = k.team === "home" ? D.home.color : D.away.color;
        var c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", cx.toFixed(2)); c.setAttribute("cy", cy.toFixed(2));
        c.setAttribute("r", "2.3");
        c.setAttribute("fill", OUT_COL[k.outcome] || "#ffc857");
        c.setAttribute("stroke", ring); c.setAttribute("stroke-width", "0.9");
        c.style.cursor = "pointer";
        var t = document.createElementNS(NS, "text");
        t.setAttribute("x", cx.toFixed(2)); t.setAttribute("y", (cy + 0.9).toFixed(2));
        t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "2.6");
        t.setAttribute("font-weight", "800"); t.setAttribute("fill", "#0b0d1f");
        t.style.pointerEvents = "none";
        t.textContent = k.order;
        function tip(e) {
          showTip(e, "<b>#" + k.order + " " + esc(k.player) + "</b><br>" +
            esc(k.team === "home" ? D.home.name : D.away.name) + " · " + (OUT_LBL[k.outcome] || k.outcome) +
            (k.keeper ? "<br>Keeper: " + esc(k.keeper) : ""));
        }
        c.addEventListener("mousemove", tip);
        c.addEventListener("mouseleave", hideTip);
        layer.appendChild(c);
        layer.appendChild(t);
      });
    }

    // kick-by-kick list with running tally (always shows both teams, in order)
    var hC = 0, aC = 0;
    var rows = pens.map(function (k) {
      if (k.outcome === "goal") { if (k.team === "home") hC++; else aC++; }
      var col = k.team === "home" ? D.home.color : D.away.color;
      var name = k.team === "home" ? D.home.name : D.away.name;
      return '<div class="so-row ' + k.outcome + '">' +
        '<span class="so-n">' + k.order + "</span>" +
        '<span class="so-tm" style="background:' + col + '"></span>' +
        '<span class="so-pl">' + esc(k.player) + ' <span class="so-tn">' + esc(name) + "</span></span>" +
        '<span class="so-oc">' + (OUT_ICON[k.outcome] || "") + " " + (OUT_LBL[k.outcome] || k.outcome) + "</span>" +
        '<span class="so-sc">' + hC + "–" + aC + "</span>" +
        "</div>";
    }).join("");
    document.getElementById("soList").innerHTML = rows;

    document.getElementById("soHome").addEventListener("click", function () {
      state.home = !state.home; this.classList.toggle("on"); draw(); });
    document.getElementById("soAway").addEventListener("click", function () {
      state.away = !state.away; this.classList.toggle("on"); draw(); });
    draw();
  }

  /* ---- tooltip ---- */
  function showTip(e, html) {
    tooltip.innerHTML = html; tooltip.style.opacity = "1";
    tooltip.style.left = (e.clientX + 14) + "px"; tooltip.style.top = (e.clientY + 14) + "px";
  }
  function hideTip() { tooltip.style.opacity = "0"; }
})();
