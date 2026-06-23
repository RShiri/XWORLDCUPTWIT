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

    var root = document.getElementById("matchRoot");
    root.innerHTML = scoreboard(D) + tabsBar() +
      '<section id="mv-shots" class="mview active"></section>' +
      '<section id="mv-passes" class="mview"></section>' +
      '<section id="mv-network" class="mview"></section>' +
      '<section id="mv-lineups" class="mview"></section>';

    buildShots(D);
    buildPasses(D);
    buildNetwork(D);
    buildLineups(D);

    var btns = root.querySelectorAll(".mtabs button");
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        btns.forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        root.querySelectorAll(".mview").forEach(function (v) { v.classList.remove("active"); });
        document.getElementById("mv-" + b.dataset.v).classList.add("active");
      });
    });
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
        esc(g.scorer) + (g.pen ? " (P)" : "") + " " + as + "</span>";
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

  function tabsBar() {
    return '<div class="mtabs">' +
      '<button data-v="shots" class="active">Shot map</button>' +
      '<button data-v="passes">Pass explorer</button>' +
      '<button data-v="network">Pass network</button>' +
      '<button data-v="lineups">Line-ups</button></div>';
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
      '<div class="timeline-scrub">' +
        '<button class="play-btn" id="nwPlay">▶</button>' +
        '<input type="range" id="nwRange" min="5" max="' + (D.maxMin || 90) + '" value="' + (D.maxMin || 90) + '">' +
        '<span class="minlab" id="nwMinuteLab"></span>' +
      "</div>" +
      '<div class="pitch-wrap"><svg class="pitch-svg" viewBox="-2 -2 ' + (PW + 4) + " " + (PH + 8) + '">' +
        pitchMarkup() +
        '<text class="dir-label" x="' + (PW / 2) + '" y="' + (PH + 4) + '" text-anchor="middle" id="nwDir">attacking →</text>' +
        '<g id="nwLinks"></g><g id="nwNodes"></g>' +
      "</svg></div>" +
      '<div class="legend-row">' +
        '<span>● node = player at average position · size = passes involved</span>' +
        '<span>line thickness = passes between the pair</span>' +
        '<span>numbers = shirt</span>' +
      "</div>" +
      '<div class="stat-note" id="nwNote"></div>';

    var state = { side: "home", upper: D.maxMin || 90, minLink: 3 };
    var linkG = document.getElementById("nwLinks");
    var nodeG = document.getElementById("nwNodes");
    var minuteLab = document.getElementById("nwMinuteLab");
    var note = document.getElementById("nwNote");
    var NS = "http://www.w3.org/2000/svg";

    function compute() {
      var nodes = {}; // name -> {sx,sy,n, passes}
      var links = {}; // "a|b" -> count
      function node(name) {
        return nodes[name] || (nodes[name] = { name: name, x: 0, y: 0, n: 0, passes: 0 });
      }
      D.passes.forEach(function (p) {
        if (p.team !== state.side || !p.ok || p.min > state.upper) return;
        var passer = node(p.player);
        passer.x += p.x; passer.y += p.y; passer.n++; passer.passes++;
        if (p.recv) {
          var r = node(p.recv);
          r.x += p.ex; r.y += p.ey; r.n++; r.passes++;
          var key = [p.player, p.recv].sort().join("|");
          links[key] = (links[key] || 0) + 1;
        }
      });
      Object.keys(nodes).forEach(function (k) {
        var nd = nodes[k]; if (nd.n) { nd.x /= nd.n; nd.y /= nd.n; }
      });
      return { nodes: nodes, links: links };
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
        nLinks + " passing links (min " + state.minLink + ") · up to " + state.upper + "'";
      document.getElementById("nwDir").textContent =
        (state.side === "home" ? teamName + " attacking →" : "← " + teamName + " attacking");
    }
    function setUpper(v) { state.upper = v; minuteLab.textContent = "0–" + v + "'"; draw(); }

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
    var range = document.getElementById("nwRange");
    var timer = null, playBtn = document.getElementById("nwPlay");
    function stopPlay() { if (timer) { clearInterval(timer); timer = null; playBtn.classList.remove("playing"); playBtn.textContent = "▶"; } }
    range.addEventListener("input", function () { stopPlay(); setUpper(parseInt(this.value, 10)); });
    playBtn.addEventListener("click", function () {
      if (timer) { stopPlay(); return; }
      if (state.upper >= (D.maxMin || 90)) { range.value = 5; setUpper(5); }
      playBtn.classList.add("playing"); playBtn.textContent = "❚❚";
      timer = setInterval(function () {
        var v = state.upper + 2;
        if (v > (D.maxMin || 90)) { v = D.maxMin || 90; range.value = v; setUpper(v); stopPlay(); return; }
        range.value = v; setUpper(v);
      }, 220);
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

  /* ---- tooltip ---- */
  function showTip(e, html) {
    tooltip.innerHTML = html; tooltip.style.opacity = "1";
    tooltip.style.left = (e.clientX + 14) + "px"; tooltip.style.top = (e.clientY + 14) + "px";
  }
  function hideTip() { tooltip.style.opacity = "0"; }
})();
