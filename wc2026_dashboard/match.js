/* Interactive single-match dashboard: clickable shot map + pass explorer with a
   minute timeline. Loads matches_detail/<id>.js (set via ?id=) as a <script> tag
   so it works on file:// without fetch/CORS. */
(function () {
  "use strict";

  var LOGO = "../team_logos/wc2026/";
  var PW = 100, PH = 64; // pitch SVG units (length x width)
  var tooltip = document.getElementById("tooltip");

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

  // Inject the match data file.
  var s = document.createElement("script");
  s.src = "matches_detail/" + encodeURIComponent(id) + ".js?v=" + Date.now();
  s.onload = function () {
    if (window.MATCH_DETAIL) boot(window.MATCH_DETAIL);
    else fail("Match data loaded but was empty.");
  };
  s.onerror = function () { fail("No detailed data for this match (it may not have shot/pass events yet)."); };
  document.head.appendChild(s);

  function fail(msg) {
    document.getElementById("matchRoot").innerHTML =
      '<div class="card" style="text-align:center;padding:40px">' + esc(msg) +
      '<br><br><a class="back-link" href="index.html">← Back to all matches</a></div>';
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
    [["L"], ["R"]].forEach(function (sd) {
      var right = sd[0] === "R";
      var bx = right ? PW - 15.7 : 0.6, sbx = right ? PW - 5.6 : 0.6;
      p.push('<rect class="' + L + '" x="' + bx + '" y="' + by1 + '" width="15.1" height="' + (by2 - by1) + '"/>');
      p.push('<rect class="' + L + '" x="' + sbx + '" y="' + sby1 + '" width="5" height="' + (sby2 - sby1) + '"/>');
      var spot = right ? PW - 10.5 : 10.5;
      p.push('<circle cx="' + spot + '" cy="32" r="0.5" fill="rgba(255,255,255,0.5)"/>');
      var gx = right ? PW - 0.6 : 0.6;
      p.push('<line class="' + L + '" x1="' + gx + '" y1="28.5" x2="' + gx + '" y2="35.5" stroke-width="0.8"/>');
    });
    return p.join("");
  }

  /* ================= BOOT ================= */
  function boot(D) {
    document.title = D.home.name + " " + D.home.score + "-" + D.away.score + " " + D.away.name + " · WC2026";
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
    root.innerHTML = scoreboard(D) +
      (hasStats ? block("Match stats", "mv-stats") : "") +
      block("Shot map", "mv-shots") +
      block("Pass explorer", "mv-passes") +
      (hasDribbles ? block("Dribbles", "mv-dribbles") : "") +
      block("Pass network", "mv-network") +
      block("Line-ups", "mv-lineups") +
      // All Goals Map sits below every stats section (last block on the page).
      (hasGoals ? block("All goals map", "mv-goals") : "");

    if (hasStats) buildMatchStats(rec, D);
    buildShots(D);
    buildPasses(D);
    if (hasDribbles) buildDribbles(D);
    buildNetwork(D);
    buildLineups(D);
    if (hasGoals) buildAllGoals(D);
  }

  function scoreboard(D) {
    var xgTxt = "";
    var hs = D.shots.filter(function (s) { return s.team === "home"; });
    var as = D.shots.filter(function (s) { return s.team === "away"; });
    function sum(a) { return a.reduce(function (t, s) { return t + s.xg; }, 0); }
    xgTxt = '<div class="sb-xg">Expected goals (xG): <b>' + sum(hs).toFixed(2) + "</b> — <b>" +
      sum(as).toFixed(2) + '</b> <span class="est">· model-estimated from ' + D.shots.length + " shots</span></div>";

    var goals = D.goals.map(function (g) {
      var as = g.assist ? '<span class="as">(' + esc(g.assist) + ")</span>" : "";
      return '<span class="goal-ev ' + g.team + '"><span class="min">' + g.min + "'</span> ⚽ " +
        esc(g.scorer) + (g.pen ? " (P)" : "") + (g.own ? " (OG)" : "") + " " + as + "</span>";
    }).join("");

    var pngBtn = D.png
      ? '<a class="png-btn" href="' + esc(D.png) + '" target="_blank" rel="noopener" download>' +
        '🖼️ Infographic PNG</a>'
      : "";

    return '<div class="match-top">' + pngBtn + "</div>" +
      '<div class="scoreboard"><div class="sb-main">' +
        '<div class="sb-team home"><span class="nm">' + esc(D.home.name) + "</span>" + logoImg(D.home.name) + "</div>" +
        '<div class="sb-score">' + (D.home.score == null ? "-" : D.home.score) + " : " +
          (D.away.score == null ? "-" : D.away.score) + "</div>" +
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
    host.innerHTML = '<div class="stat-panel" style="border-top:none">' +
      '<div class="sp-head"><span>' + esc(D.home.name) + "</span><span>" + esc(D.away.name) + "</span></div>" +
      rows + "</div>";
  }

  /* ================= SHOT MAP ================= */
  function buildShots(D) {
    var host = document.getElementById("mv-shots");
    host.innerHTML =
      '<div class="controls-bar">' +
        '<span class="chip-toggle on home" id="shHome">' + esc(D.home.name) + "</span>" +
        '<span class="chip-toggle on away" id="shAway">' + esc(D.away.name) + "</span>" +
        '<span class="chip-toggle" id="shGoals">Goals only</span>' +
        '<span class="grp">Min xG <input type="text" id="shMinXg" value="0" size="3" style="width:42px"></span>' +
      "</div>" +
      '<div class="pitch-wrap"><svg class="pitch-svg" viewBox="-2 -2 ' + (PW + 4) + " " + (PH + 8) + '">' +
        pitchMarkup() +
        '<text class="dir-label" x="3" y="' + (PH + 4) + '">◀ ' + esc(D.away.name) + "</text>" +
        '<text class="dir-label" x="' + (PW - 3) + '" y="' + (PH + 4) + '" text-anchor="end">' + esc(D.home.name) + " ▶</text>" +
        '<g id="shotLayer"></g>' +
      "</svg></div>" +
      '<div class="legend-row">' +
        '<span><i class="dot" style="background:var(--c-home);border:1.5px solid #ffd34e"></i>Goal (team colour)</span>' +
        '<span><i class="dot" style="background:var(--c-home)"></i>On target</span>' +
        '<span><i class="dot" style="background:transparent;border:1px solid var(--muted)"></i>Off target</span>' +
        '<span><i class="dot" style="background:#7a869f"></i>Blocked</span>' +
        '<span>● size = xG</span>' +
      "</div>" +
      '<div class="shot-detail empty" id="shotDetail">Click any shot to see who took it, when, and its xG.</div>';

    var state = { home: true, away: true, goalsOnly: false, minXg: 0, sel: null };
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
        var fill, stroke = "none", op = 0.85;
        if (sh.goal) { fill = col; op = 1; }                        // goals = team colour
        else if (sh.blocked) { fill = "#7a869f"; op = 0.7; }
        else if (sh.onTarget) { fill = col; }
        else { fill = "none"; stroke = col; }
        // goals: a tight ring around the (same-size) dot so they read as goals
        if (sh.goal) {
          var ring = document.createElementNS(NS, "circle");
          ring.setAttribute("cx", cx.toFixed(2)); ring.setAttribute("cy", cy.toFixed(2));
          ring.setAttribute("r", (r + 0.55).toFixed(2));
          ring.setAttribute("fill", "none"); ring.setAttribute("stroke", "#ffd34e");
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
    document.getElementById("shMinXg").addEventListener("input", function () {
      state.minXg = parseFloat(this.value) || 0; draw(); });
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
          '<option value="fail">Incomplete</option><option value="key">Key passes</option>' +
          '<option value="assist">Assists</option><option value="cross">Crosses</option>' +
          '<option value="through">Through balls</option></select></span>' +
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
        '<span><i class="dot" style="background:#43e8a0"></i>completed · progressive/key</span>' +
        '<span><i class="dot" style="background:#1f9d5e"></i>completed · normal</span>' +
        '<span><i class="dot" style="background:#ff5e7a"></i>incomplete · forward/key</span>' +
        '<span><i class="dot" style="background:#a83646"></i>incomplete · normal</span>' +
        '<span>dashed = incomplete · dot = start</span>' +
      "</div>" +
      '<div class="stat-note" id="paCount"></div>';

    var state = { home: true, away: true, player: "", type: "all", windowMode: false, upper: D.maxMin || 90 };
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
      if (t === "key" && !p.key && !p.assist) return false;
      if (t === "assist" && !p.assist) return false;
      if (t === "cross" && !p.cross) return false;
      if (t === "through" && !p.through) return false;
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
          ? (dangerous ? "#43e8a0" : "#1f9d5e")
          : (dangerous ? "#ff5e7a" : "#a83646");
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
        pitchMarkup() +
        '<text class="dir-label" x="3" y="' + (PH + 4) + '">◀ ' + esc(D.away.name) + "</text>" +
        '<text class="dir-label" x="' + (PW - 3) + '" y="' + (PH + 4) + '" text-anchor="end">' + esc(D.home.name) + " ▶</text>" +
        '<g id="dribLayer"></g>' +
      "</svg></div>" +
      '<div class="legend-row">' +
        '<span><i class="dot" style="background:#43e8a0"></i>successful</span>' +
        '<span><i class="dot" style="background:transparent;border:1px solid #ff5e7a"></i>unsuccessful</span>' +
        '<span>● = where the take-on happened</span>' +
      "</div>" +
      '<div class="stat-note" id="drCount"></div>';

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
        var col = p.ok ? "#43e8a0" : "#ff5e7a";
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

    function draw() {
      var net = compute();
      var col = state.side === "home" ? D.home.color : D.away.color;
      linkG.innerHTML = ""; nodeG.innerHTML = "";
      var maxPasses = 1;
      Object.keys(net.nodes).forEach(function (k) { maxPasses = Math.max(maxPasses, net.nodes[k].passes); });
      var maxLink = 1;
      Object.keys(net.links).forEach(function (k) { maxLink = Math.max(maxLink, net.links[k]); });

      var nLinks = 0;
      Object.keys(net.links).forEach(function (key) {
        var count = net.links[key];
        if (count < state.minLink) return;
        var parts = key.split("|");
        var a = net.nodes[parts[0]], b = net.nodes[parts[1]];
        if (!a || !b) return;
        nLinks++;
        var ln = document.createElementNS(NS, "line");
        ln.setAttribute("x1", tx(state.side, a.x).toFixed(2)); ln.setAttribute("y1", ty(state.side, a.y).toFixed(2));
        ln.setAttribute("x2", tx(state.side, b.x).toFixed(2)); ln.setAttribute("y2", ty(state.side, b.y).toFixed(2));
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
        var cx = tx(state.side, nd.x), cy = ty(state.side, nd.y);
        var r = 1.6 + 2.6 * nd.passes / maxPasses;
        var c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", cx.toFixed(2)); c.setAttribute("cy", cy.toFixed(2));
        c.setAttribute("r", r.toFixed(2));
        c.setAttribute("fill", col); c.setAttribute("fill-opacity", "0.92");
        c.setAttribute("stroke", "#0b0f1a"); c.setAttribute("stroke-width", "0.3");
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
        .map(function (p) { return { k: "pass", t: agmT(p), team: p.team, x: p.x, y: p.y, ex: p.ex, ey: p.ey, player: p.player, cross: !!p.cross }; }),
      (D.dribbles || []).filter(function (d) { return d.ok; })
        .map(function (d) { return { k: "dribble", t: agmT(d), team: d.team, x: d.x, y: d.y, player: d.player }; })
    ).sort(function (a, b) { return a.t - b.t; });
    var saves = D.saves || [];
    function assistFor(shot) {
      var g = D.goals || [];
      for (var i = 0; i < g.length; i++) if (g[i].min === shot.min && agmNorm(g[i].scorer) === agmNorm(shot.player)) return g[i].assist;
      return null;
    }
    var seqs = (D.shots || []).filter(function (s) { return s.goal; }).map(function (shot) {
      var T = agmT(shot);
      var chain = ev.filter(function (e) { return e.team === shot.team && e.t <= T && e.t >= T - 35; });
      var seq = [];
      for (var i = chain.length - 1; i >= 0; i--) { if (seq.length && seq[0].t - chain[i].t > 6) break; seq.unshift(chain[i]); }
      var rebound = false;
      // Rebound: a same-team shot saved/blocked in the ~4s before the goal → splice in
      // the original effort + keeper save, in time order, before the goal node. Runs
      // whether or not passes preceded, so rebounds show even with a build-up chain.
      var prior = null, best = -1;
      (D.shots || []).forEach(function (s2) { var tt = agmT(s2); if (s2.team === shot.team && !s2.goal && tt < T && T - tt <= 4 && tt > best) { best = tt; prior = s2; } });
      if (prior) {
        rebound = true;
        seq.push({ k: "shot_eff", team: prior.team, x: prior.x, y: prior.y, player: prior.player, xg: prior.xg });
        var sv = null, sb = -1;
        saves.forEach(function (v) { var tt = agmT(v); if (v.team !== shot.team && Math.abs(tt - T) <= 2 && tt > sb) { sb = tt; sv = v; } });
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
    // Own goals: not shots, but show them as a single "Own goal" node at the beneficiary's
    // attacking end (coords were mirrored into their frame in build_match_details).
    (D.goals || []).forEach(function (g) {
      if (!g.own || g.x == null) return;
      seqs.push({
        scorer: "Own goal", ogBy: g.scorer, min: g.min, side: g.team, assist: null, rebound: false, own: true,
        steps: [{ k: "shot", team: g.team, x: g.x, y: g.y, player: g.scorer, og: true }],
        players: 1, passes: 0, crosses: 0, dribbles: 0, xg: null
      });
    });
    seqs.sort(function (a, b) { return (a.min || 0) - (b.min || 0); });
    return seqs;
  }
  function agmLine(x1, y1, x2, y2, cls) {
    var m = cls === "agm-pass" ? "agmAp" : (cls === "agm-shotln" ? "agmAs" : "agmAc");
    return '<line class="' + cls + '" x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) +
      '" y2="' + y2.toFixed(2) + '" marker-end="url(#' + m + ')"/>';
  }
  // A cross renders like a pass (same fine dots) but CURVED — a quadratic arc bowed
  // perpendicular to the line, so it reads as a cross while staying a pass-type delivery.
  function agmArc(x1, y1, x2, y2, cls) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    var off = Math.min(7, len * 0.2);                      // bow height, capped
    var cx = mx + (-dy / len) * off, cy = my + (dx / len) * off;
    return '<path class="' + cls + '" d="M' + x1.toFixed(2) + ',' + y1.toFixed(2) +
      ' Q' + cx.toFixed(2) + ',' + cy.toFixed(2) + ' ' + x2.toFixed(2) + ',' + y2.toFixed(2) +
      '" marker-end="url(#agmAp)"/>';
  }
  function agmNode(x, y, label, title, cls) {
    var dark = (cls === "start" || cls === "shot" || cls === "save");
    return '<g><title>' + esc(title) + '</title><circle class="agm-node' + (cls ? (" " + cls) : "") +
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
      return { k: st.k, player: st.player, xg: st.xg, team: sd, cross: !!st.cross,
               x: tx(sd, st.x), y: ty(sd, st.y), ex: tx(sd, st.ex != null ? st.ex : st.x), ey: ty(sd, st.ey != null ? st.ey : st.y) };
    });
    var teamName = seq.side === "home" ? D.home.name : D.away.name;
    // Home attacks right (▶); away attacks left (◀) — match the rest of the dashboard.
    var dirTxt = seq.side === "home" ? (esc(teamName) + " attacking ▶") : ("◀ " + esc(teamName) + " attacking");
    var a = [defs, pitchMarkup(),
      '<text class="dir-label" x="' + (PW / 2) + '" y="' + (PH + 4) + '" text-anchor="middle">' + dirTxt + '</text>'];
    for (var i = 0; i < P.length; i++) {
      var pt = P[i];
      if (pt.k === "pass") a.push(pt.cross ? agmArc(pt.x, pt.y, pt.ex, pt.ey, "agm-cross")   // curved dotted = cross
                                           : agmLine(pt.x, pt.y, pt.ex, pt.ey, "agm-pass")); // straight dotted = pass
      if (i < P.length - 1) {
        var nx = P[i + 1];
        var fx = pt.k === "pass" ? pt.ex : pt.x, fy = pt.k === "pass" ? pt.ey : pt.y;
        var cls = (nx.k === "save") ? "agm-shotln" : "agm-carry";                   // saved effort→keeper = red; else solid carry
        var dcon = Math.hypot(nx.x - fx, nx.y - fy);
        if (dcon > 1.0 && dcon <= AGM_MAX_SEG) a.push(agmLine(fx, fy, nx.x, nx.y, cls)); // skip cross-pitch spans from bad source coords
      }
    }
    var L = P[P.length - 1];
    var gx = tx(L.team, 99.4), gy = ty(L.team, 50);
    // Only draw the shot→goal line when the shot is plausibly in the attacking half.
    // A few feeds carry a glitched goal coordinate (e.g. at the wrong end); without
    // this guard that produced a line straight across the whole pitch.
    if (Math.hypot(gx - L.x, gy - L.y) <= AGM_MAX_SEG) a.push(agmLine(L.x, L.y, gx, gy, "agm-shotln"));
    P.forEach(function (pt, i) {
      var cls = pt.k === "save" ? "save" : (pt.k === "shot" ? "shot" : (pt.k === "dribble" ? "drib" : (i === 0 ? "start" : "")));
      var num = numMap[agmNorm(pt.player)];
      var label = pt.og ? "OG" : ((num != null) ? num : (agmIni(pt.player) || (i + 1)));
      var ttl = pt.og ? ("Own goal — " + (pt.player || "")) :
        ((pt.k === "save" ? "Save — " : pt.k === "shot" ? "Goal — " : pt.k === "shot_eff" ? "Shot (saved) — " : "") +
        (pt.player || ("Touch " + (i + 1))) + (pt.k === "pass" && pt.cross ? " · cross" : "") + (pt.xg != null ? " · xG " + pt.xg.toFixed(2) : ""));
      a.push(agmNode(pt.x, pt.y, label, ttl, cls));
    });
    var ly = Math.max(3.4, L.y - 2.0);                                              // scorer name + xG ABOVE the finishing node
    a.push('<text class="agm-scorelab" x="' + L.x.toFixed(2) + '" y="' + (ly - 1.7).toFixed(2) + '">' + esc(seq.scorer) + "</text>");
    if (L.xg != null) a.push('<text class="agm-xglab" x="' + L.x.toFixed(2) + '" y="' + ly.toFixed(2) + '">xG ' + L.xg.toFixed(2) + "</text>");
    for (var j = 0; j < P.length; j++) if (P[j].k === "save") { a.push('<text class="agm-savelab" x="' + P[j].x.toFixed(2) + '" y="' + (P[j].y - 2.0).toFixed(2) + '" text-anchor="middle">SAVE</text>'); break; }
    return '<svg class="pitch-svg" viewBox="-2 -2 ' + (PW + 4) + " " + (PH + 8) + '">' + a.join("") + "</svg>";
  }
  // Self-contained <style> for export: the live SVG relies on external match.css
  // classes + CSS vars, which don't travel into a serialized/standalone SVG. Resolve
  // the theme vars to literal colours and embed the needed rules so the PNG matches.
  function agmExportStyle() {
    var rc = getComputedStyle(document.documentElement);
    function v(n, d) { var x = rc.getPropertyValue(n).trim(); return x || d; }
    var TEXT = v("--text", "#e8edf7"), BAD = v("--bad", "#ff6b81"), WARN = v("--warn", "#ffb454"),
        MUTED = v("--muted", "#93a0bd"), CARD2 = v("--card-2", "#1b2440"), BG = v("--bg", "#0b0f1a");
    return "<style>" +
      ".pitch-bg{fill:#14361f}.pitch-line{fill:none;stroke:rgba(255,255,255,.28);stroke-width:.3}" +
      ".dir-label{fill:rgba(255,255,255,.5);font-size:2.4px;font-weight:700;font-family:sans-serif}" +
      ".agm-pass{stroke:" + TEXT + ";stroke-width:.5;fill:none;stroke-linecap:round;stroke-dasharray:.15 1.05}" +
      ".agm-cross{stroke:" + TEXT + ";stroke-width:.5;fill:none;stroke-linecap:round;stroke-dasharray:.15 1.05}" +
      ".agm-carry{stroke:" + TEXT + ";stroke-width:.34;fill:none}" +
      ".agm-shotln{stroke:" + BAD + ";stroke-width:.45;fill:none}" +
      ".agm-mk{fill:" + TEXT + "}.agm-mk-shot{fill:" + BAD + "}" +
      ".agm-node{fill:" + CARD2 + ";stroke:" + TEXT + ";stroke-width:.22}" +
      ".agm-node.start{fill:" + WARN + ";stroke:#c98a2e}.agm-node.shot{fill:" + BAD + ";stroke:#c9455a}.agm-node.save{fill:" + MUTED + ";stroke:#6b7488}" +
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
      var bg = cvar("--card", "#161d31"), text = cvar("--text", "#e8edf7"), muted = cvar("--muted", "#93a0bd"),
          bad = cvar("--bad", "#ff6b81"), line = cvar("--line", "#26304d");
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
      if (g.own) return '<div class="agm-meta"><span class="agm-pill lead">Own goal</span>' +
        '<span class="agm-pill">scored by <b>' + esc(g.ogBy || "") + "</b></span></div>";
      var counts = g.players + " player" + (g.players === 1 ? "" : "s") + " · " + g.passes + " pass" + (g.passes === 1 ? "" : "es") +
        " · " + g.dribbles + " dribble" + (g.dribbles === 1 ? "" : "s");
      var assist = g.assist ? '<span class="agm-pill">assist <b>' + esc(g.assist) + "</b></span>" : '<span class="agm-pill">unassisted</span>';
      var reb = g.rebound ? '<span class="agm-pill">rebound</span>' : "";
      var crs = g.crosses ? '<span class="agm-pill">' + g.crosses + " cross" + (g.crosses === 1 ? "" : "es") + "</span>" : "";
      return '<div class="agm-meta"><span class="agm-pill lead">' + counts + '</span><span class="agm-pill">xG <b>' +
        (g.xg != null ? g.xg.toFixed(2) : "—") + "</b></span>" + crs + assist + reb + "</div>";
    }
    function roster(g) {
      if (g.own) return '<div class="agm-roster"><b>Own goal</b> by ' + esc(g.ogBy || "") + "</div>";
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
      '<span class="it"><span class="agm-lln shot"></span>Shot</span></div>';
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

  /* ---- tooltip ---- */
  function showTip(e, html) {
    tooltip.innerHTML = html; tooltip.style.opacity = "1";
    tooltip.style.left = (e.clientX + 14) + "px"; tooltip.style.top = (e.clientY + 14) + "px";
  }
  function hideTip() { tooltip.style.opacity = "0"; }
})();
