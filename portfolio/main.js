/* ===========================================================================
   Ram Shiri - portfolio interactions (dependency-free).
   Nav + scrollspy + interactive Lamine Yamal shot map (real season data).
   Each shot draws a path to goal + a marker sized by xG, styled by outcome:
     goal = team colour · on target = solid · off target = hollow · blocked = black
   Page content is fully visible without JS; this only adds enhancements.
   =========================================================================== */
(function () {
  "use strict";

  /* Set your LinkedIn URL here to activate the LinkedIn link: */
  var LINKEDIN_URL = "";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var NS = "http://www.w3.org/2000/svg";
  var GOAL_X = 340, GOAL_Y = 30;    // goal-mouth centre (top-centre) in the SVG's coord space
  var GOAL_SCALE = 6.4;             // SVG px per WhoScored goalMouthY unit (640px pitch width / 100):
                                    // gy 50 → x 340 (centre), gy 45/55 → x 308/372 (posts)

  var y = $("#year"); if (y) y.textContent = new Date().getFullYear();
  if (LINKEDIN_URL) $$("[data-linkedin]").forEach(function (a) { a.href = LINKEDIN_URL; });

  /* ---- theme toggle (dark by default; choice saved per visitor) ---- */
  var themeBtn = $("#themeToggle");
  var setThemeIcon = function () {
    var dark = document.documentElement.getAttribute("data-theme") !== "light";
    if (themeBtn) {
      themeBtn.textContent = dark ? "☀️" : "🌙";
      themeBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    }
  };
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var toLight = document.documentElement.getAttribute("data-theme") !== "light";
      document.documentElement.setAttribute("data-theme", toLight ? "light" : "dark");
      try { localStorage.setItem("theme", toLight ? "light" : "dark"); } catch (e) {}
      setThemeIcon();
    });
    setThemeIcon();
  }

  /* ---- sticky nav shadow ---- */
  var nav = $("#nav");
  var onScroll = function () { if (nav) nav.classList.toggle("scrolled", window.scrollY > 8); };
  onScroll(); window.addEventListener("scroll", onScroll, { passive: true });

  /* ---- mobile menu ---- */
  var toggle = $("#navToggle"), links = $("#navLinks");
  if (toggle && links) {
    var close = function () { links.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); };
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    $$("a", links).forEach(function (a) { a.addEventListener("click", close); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  /* ---- scrollspy ---- */
  var anchors = $$('.nav-links > a[href^="#"]'), map = {};
  anchors.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
  var secs = $$("main section[id]");
  if ("IntersectionObserver" in window && secs.length) {
    var spy = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var a = map[e.target.id]; if (!a) return;
        if (e.isIntersecting) { anchors.forEach(function (x) { x.classList.remove("active"); }); a.classList.add("active"); }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    secs.forEach(function (s) { spy.observe(s); });
  }

  /* =========================================================================
     Lamine Yamal - xG shot map.
     Real 2025/26 shots aggregated from WhoScored match data
     (assets/data/yamal_shots.json). xG is a geometry-based model estimate.
     out ∈ {goal, saved (on target), off, blocked}.
     gy = WhoScored goalMouthY (0–100) where the ball crossed the line: 50 = centre,
     ≈45/≈55 = posts. Optional - without it a path fans out to a stable, outcome-aware
     spot (see goalEndX) so shots don't all stack on the goal centre.
     ========================================================================= */
  var FALLBACK = [
    { x: 560, y: 222, xg: 0.34, min: 38, out: "goal",    body: "Right foot", note: "", situ: "Open play", gy: 46.5 },
    { x: 512, y: 150, xg: 0.05, min: 21, out: "goal",    body: "Left foot",  note: "", situ: "Open play", gy: 53   },
    { x: 470, y: 250, xg: 0.06, min: 12, out: "saved",   body: "Left foot",  note: "", situ: "Open play", gy: 48   },
    { x: 505, y: 300, xg: 0.04, min: 60, out: "off",     body: "Left foot",  note: "", situ: "Open play", gy: 58   },
    { x: 540, y: 205, xg: 0.09, min: 71, out: "blocked", body: "Right foot", note: "", situ: "Open play", gy: 44   }
  ];

  var pathLayer = $("#pathLayer"), layer = $("#shotLayer"), tip = $("#tooltip"), caption = $("#shotTip");
  if (!layer) return;

  var radius = function (xg) { return Math.max(3, Math.min(14, 3.5 + xg * 12)); };
  var showTip = function (h, x, yy) {
    if (!tip) return;
    tip.innerHTML = h; tip.classList.add("show");
    var pad = 14, w = tip.offsetWidth, ht = tip.offsetHeight;
    tip.style.left = Math.min(x + pad, window.innerWidth - w - 8) + "px";
    tip.style.top = Math.max(8, yy - ht - pad) + "px";
  };
  var hideTip = function () { if (tip) tip.classList.remove("show"); };
  var OUT_LABEL = { goal: "Goal ⚽", saved: "On target", off: "Off target", blocked: "Blocked" };
  var vs = function (s) { return s.note ? "vs " + s.note : "Shot"; };
  var tipHtml = function (s) {
    return "<b>" + vs(s) + "</b><br>" + s.min + "' · " + s.body + " · " + s.situ +
           "<br><span class='tt-x'>xG " + Number(s.xg).toFixed(2) + "</span> · " + OUT_LABEL[s.out];
  };
  var setCaption = function (s) {
    if (!caption) return;
    caption.textContent = s.min + "' " + vs(s) + " · " + s.situ + " · " + OUT_LABEL[s.out] + " · xG " + Number(s.xg).toFixed(2);
    caption.classList.add("show");
  };

  // --- where a shot's path ends on the goal line ---------------------------
  // Prefer the measured WhoScored goalMouthY (s.gy). Without it, derive a
  // STABLE, outcome-aware spot so paths fan out naturally instead of all
  // stacking on the goal centre. Add a real gy later and it overrides exactly.
  var hash01 = function (s) {                  // stable pseudo-random [0,1) per shot
    var h = Math.sin(s.x * 12.9898 + s.y * 78.233 + s.min * 37.719) * 43758.5453;
    return h - Math.floor(h);
  };
  var goalEndX = function (s) {
    if (typeof s.gy === "number") return GOAL_X + (s.gy - 50) * GOAL_SCALE;
    var jit = hash01(s) - 0.5;                 // −0.5..0.5
    if (s.out === "off") {                      // missed: end wide of a post
      var side = (s.x >= GOAL_X) ? 1 : -1;
      return GOAL_X + side * (42 + Math.abs(jit) * 26);
    }
    var lean = (s.x - GOAL_X) / 40;            // gentle pull toward the shot's side
    var x = GOAL_X + lean + jit * 50;          // on target/blocked: fill most of the mouth
    return Math.max(311, Math.min(369, x));    // keep just inside the posts (308 / 372)
  };

  var makePath = function (s) {
    var ex = goalEndX(s), ey = GOAL_Y;
    if (s.out === "blocked") {                  // blocked en route - stop short of goal
      ex = s.x + (ex - s.x) * 0.6;
      ey = s.y + (ey - s.y) * 0.6;
    }
    var ln = document.createElementNS(NS, "line");
    ln.setAttribute("x1", s.x); ln.setAttribute("y1", s.y);
    ln.setAttribute("x2", ex); ln.setAttribute("y2", ey);
    ln.setAttribute("class", "shot-path " + s.out);
    return ln;
  };

  var makeDot = function (s, line) {
    var c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", s.x); c.setAttribute("cy", s.y); c.setAttribute("r", radius(s.xg));
    c.setAttribute("class", "shot " + s.out);
    c.setAttribute("tabindex", "0"); c.setAttribute("role", "img");
    c.setAttribute("aria-label", vs(s) + ", " + s.min + " min, " + OUT_LABEL[s.out] + ", xG " + Number(s.xg).toFixed(2));
    var enter = function (ev) {
      c.classList.add("active"); if (line) line.classList.add("lit"); setCaption(s);
      var p = ("touches" in ev && ev.touches[0]) ? ev.touches[0] : ev;
      if (p && p.clientX != null && (p.clientX || p.clientY)) showTip(tipHtml(s), p.clientX, p.clientY);
      else { var r = c.getBoundingClientRect(); showTip(tipHtml(s), r.left + r.width / 2, r.top); }
    };
    var leave = function () { c.classList.remove("active"); if (line) line.classList.remove("lit"); hideTip(); };
    c.addEventListener("mouseenter", enter);
    c.addEventListener("mousemove", function (ev) { showTip(tipHtml(s), ev.clientX, ev.clientY); });
    c.addEventListener("mouseleave", leave);
    c.addEventListener("focus", enter);
    c.addEventListener("blur", leave);
    c.addEventListener("click", function (ev) { ev.preventDefault(); enter(ev); });
    return c;
  };

  var render = function (shots) {
    [pathLayer, layer].forEach(function (g) { if (g) while (g.firstChild) g.removeChild(g.firstChild); });
    // draw non-goals first, goals last, so goals sit on top in both layers
    var ordered = shots.filter(function (s) { return s.out !== "goal"; })
                       .concat(shots.filter(function (s) { return s.out === "goal"; }));
    ordered.forEach(function (s) {
      var line = null;
      if (pathLayer) { line = makePath(s); pathLayer.appendChild(line); }
      layer.appendChild(makeDot(s, line));
    });

    var goals = shots.filter(function (s) { return s.out === "goal"; }).length;
    var xgSum = shots.reduce(function (a, s) { return a + Number(s.xg); }, 0);
    var stats = $("#shotStats");
    if (stats) {
      stats.innerHTML =
        "<div class='st'><b>" + shots.length + "</b><span>Shots</span></div>" +
        "<div class='st'><b>" + goals + "</b><span>Goals</span></div>" +
        "<div class='st'><b>" + xgSum.toFixed(1) + "</b><span>Total xG</span></div>";
    }
  };

  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest(".shot, .takeon")) hideTip();
  });

  fetch("assets/data/yamal_shots.json?v=4", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
    .then(function (data) { render(Array.isArray(data) && data.length ? data : FALLBACK); })
    .catch(function () { render(FALLBACK); });

  /* =========================================================================
     Lamine Yamal - take-on map (assets/data/yamal_takeons.json).
     won (beat his marker) vs failed. Toggle buttons show/hide each category.
     ========================================================================= */
  (function () {
    var tkLayer = $("#takeonLayer"), tkArrows = $("#takeonArrows"), tkSvg = $("#takeonmap");
    if (!tkLayer || !tkSvg) return;
    var tkTip = function (p, cat) {
      return "<b>" + (p.opp ? "vs " + p.opp : "Take-on") + "</b><br>" + p.min + "' · " +
             (cat === "won" ? "<span class='tt-x'>Won</span>" : "Failed") + " take-on";
    };
    var dot = function (p, cat) {
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", p.x); c.setAttribute("cy", p.y);
      c.setAttribute("r", cat === "won" ? 4.6 : 4);
      c.setAttribute("class", "takeon " + cat);
      c.setAttribute("tabindex", "0"); c.setAttribute("role", "img");
      c.setAttribute("aria-label", (p.opp ? "vs " + p.opp + ", " : "") + p.min + " min, " + (cat === "won" ? "won" : "failed") + " take-on");
      var enter = function (ev) {
        c.classList.add("active");
        var q = ("touches" in ev && ev.touches[0]) ? ev.touches[0] : ev;
        if (q && q.clientX != null && (q.clientX || q.clientY)) showTip(tkTip(p, cat), q.clientX, q.clientY);
        else { var r = c.getBoundingClientRect(); showTip(tkTip(p, cat), r.left + r.width / 2, r.top); }
      };
      c.addEventListener("mouseenter", enter);
      c.addEventListener("mousemove", function (ev) { showTip(tkTip(p, cat), ev.clientX, ev.clientY); });
      c.addEventListener("mouseleave", function () { c.classList.remove("active"); hideTip(); });
      c.addEventListener("focus", enter);
      c.addEventListener("blur", function () { c.classList.remove("active"); hideTip(); });
      c.addEventListener("click", function (ev) { ev.preventDefault(); enter(ev); });
      return c;
    };
    var arrow = function (p) {
      var ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", p.x); ln.setAttribute("y1", p.y);
      ln.setAttribute("x2", p.ex); ln.setAttribute("y2", p.ey);
      ln.setAttribute("class", "tk-arrow"); ln.setAttribute("marker-end", "url(#tkArrow)");
      return ln;
    };
    var renderTk = function (data) {
      var won = (data && data.won) || [], failed = (data && data.failed) || [];
      [tkLayer, tkArrows].forEach(function (g) { if (g) while (g.firstChild) g.removeChild(g.firstChild); });
      won.forEach(function (p) { if (tkArrows && p.ex != null && p.ey != null) tkArrows.appendChild(arrow(p)); });
      failed.forEach(function (p) { tkLayer.appendChild(dot(p, "failed")); });
      won.forEach(function (p) { tkLayer.appendChild(dot(p, "won")); });   // won on top
      var total = won.length + failed.length;
      var rate = total ? Math.round(100 * won.length / total) : 0;
      var stats = $("#takeonStats");
      if (stats) stats.innerHTML =
        "<div class='st'><b>" + won.length + "</b><span>Won</span></div>" +
        "<div class='st'><b>" + failed.length + "</b><span>Failed</span></div>" +
        "<div class='st'><b>" + rate + "%</b><span>Success</span></div>";
    };
    $$("#takeonToggles .toggle-chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var cat = btn.getAttribute("data-cat");
        var on = btn.getAttribute("aria-pressed") === "false";  // becomes ON
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        tkSvg.classList.toggle("hide-" + cat, !on);
      });
    });
    fetch("assets/data/yamal_takeons.json?v=2", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(renderTk)
      .catch(function () {});
  })();

  /* =========================================================================
     Match Centre - Argentina vs Algeria (assets/data/arg_alg_match.json).
     Native rebuild of my WC2026 match centre: scoreboard, head-to-head stat
     bars, a two-team shot map, and animated pass-by-pass goal replays.
     Pitch space: inner rect x 18..682, y 18..422 (same as the take-on map).
     Data coords are 0-100 along/across the pitch; home attacks left -> right.
     ========================================================================= */
  (function () {
    var scoreEl = $("#mcScore"), statsEl = $("#mcStats"),
        shotLayerMc = $("#mcShotLayer"), shotLegend = $("#mcShotLegend"), shotCaption = $("#mcShotTip"),
        tabsEl = $("#mcGoalTabs"), playBtn = $("#mcPlay"),
        replaySvg = $("#mcReplay"), replayLayer = $("#mcReplayLayer"),
        replayDir = $("#mcReplayDir"), replayMeta = $("#mcReplayMeta");
    if (!scoreEl || !shotLayerMc || !replayLayer) return;

    var X0 = 18, Y0 = 18, PW = 664, PH = 404;          // inner pitch rect (px)
    var UNIT = PW / 100;                                // px per data unit
    var MAX_SEG = 52 * UNIT;                            // hide glitched cross-pitch spans
    var tx = function (side, x) { return side === "home" ? X0 + x * PW / 100 : X0 + (100 - x) * PW / 100; };
    var ty = function (side, y) { return side === "home" ? Y0 + (100 - y) * PH / 100 : Y0 + y * PH / 100; };
    var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var E = function (n, a) { var e = document.createElementNS(NS, n); if (a) for (var k in a) e.setAttribute(k, a[k]); return e; };
    var fmtDate = function (iso) {
      var d = new Date(iso + "T12:00:00");
      return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    };

    /* ---- scoreboard + goals ---- */
    var renderScore = function (D) {
      var goalsFor = function (side) {
        return D.goals.filter(function (g) { return g.team === side; })
          .map(function (g) { return esc(g.scorer) + " " + g.min + "'" + (g.pen ? " (p)" : "") + (g.own ? " (og)" : ""); }).join(" · ");
      };
      scoreEl.innerHTML =
        '<div class="mc-row">' +
          '<div class="mc-team home"><i style="background:' + D.home.color + '"></i>' + esc(D.home.name) + "</div>" +
          '<div class="mc-num">' + D.home.score + " - " + D.away.score + "</div>" +
          '<div class="mc-team away">' + esc(D.away.name) + '<i style="background:' + D.away.color + '"></i></div>' +
        "</div>" +
        '<div class="mc-row mc-scorers">' +
          '<div class="mc-team home">⚽ ' + (goalsFor("home") || "-") + "</div>" +
          '<div class="mc-num sm">xG ' + D.xg[0].toFixed(2) + " - " + D.xg[1].toFixed(2) + "</div>" +
          '<div class="mc-team away">' + (goalsFor("away") ? "⚽ " + goalsFor("away") : "") + "</div>" +
        "</div>" +
        '<div class="mc-meta">' + esc(D.stage) + " · " + esc(D.venue) + " · " + fmtDate(D.date) + "</div>";
    };

    /* ---- head-to-head stat bars ---- */
    var renderStats = function (D) {
      statsEl.innerHTML = D.stats.map(function (s) {
        var h = Number(s.h), a = Number(s.a), tot = (h + a) || 1;
        var vh = s.fmt === "pct" ? h + "%" : (s.fmt === "dec" ? h.toFixed(2) : h);
        var va = s.fmt === "pct" ? a + "%" : (s.fmt === "dec" ? a.toFixed(2) : a);
        return '<div class="mc-stat">' +
          '<div class="mc-stat-line"><b class="' + (h >= a ? "lead" : "") + '">' + vh + "</b><span>" + esc(s.label) + '</span><b class="' + (a > h ? "lead" : "") + '">' + va + "</b></div>" +
          '<div class="mc-bar"><i class="h" style="width:' + (100 * h / tot).toFixed(1) + '%;background:' + D.home.color + '"></i>' +
          '<i class="a" style="width:' + (100 * a / tot).toFixed(1) + '%;background:' + D.away.color + '"></i></div>' +
        "</div>";
      }).join("");
    };

    /* ---- shot map (both teams, opposite directions) ---- */
    var OUTC = function (s) { return s.goal ? "goal" : s.blocked ? "blocked" : s.onTarget ? "on" : "off"; };
    var OUT_TXT = { goal: "Goal ⚽", on: "On target", off: "Off target", blocked: "Blocked" };
    var mcRadius = function (xg) { return Math.max(4, Math.min(15, 4 + xg * 15)); };
    var renderShots = function (D) {
      var name = { home: D.home.name, away: D.away.name };
      var ordered = D.shots.filter(function (s) { return !s.goal; }).concat(D.shots.filter(function (s) { return s.goal; }));
      ordered.forEach(function (s) {
        var out = OUTC(s);
        var c = E("circle", {
          cx: tx(s.team, s.x).toFixed(1), cy: ty(s.team, s.y).toFixed(1), r: mcRadius(s.xg),
          "class": "mc-shot " + s.team + " " + out, tabindex: "0", role: "img",
          "aria-label": s.player + " (" + name[s.team] + "), " + s.min + " min, " + OUT_TXT[out] + ", xG " + s.xg.toFixed(2)
        });
        var html = "<b>" + esc(s.player) + "</b> · " + esc(name[s.team]) + "<br>" + s.min + "' · " + esc(s.body) + " · " + esc(s.sit) +
                   "<br><span class='tt-x'>xG " + s.xg.toFixed(2) + "</span> · " + OUT_TXT[out];
        var enter = function (ev) {
          c.classList.add("active");
          if (shotCaption) { shotCaption.textContent = s.min + "' " + s.player + " (" + name[s.team] + ") · " + OUT_TXT[out] + " · xG " + s.xg.toFixed(2); shotCaption.classList.add("show"); }
          var p = ("touches" in ev && ev.touches[0]) ? ev.touches[0] : ev;
          if (p && p.clientX != null && (p.clientX || p.clientY)) showTip(html, p.clientX, p.clientY);
          else { var r = c.getBoundingClientRect(); showTip(html, r.left + r.width / 2, r.top); }
        };
        c.addEventListener("mouseenter", enter);
        c.addEventListener("mousemove", function (ev) { showTip(html, ev.clientX, ev.clientY); });
        c.addEventListener("mouseleave", function () { c.classList.remove("active"); hideTip(); });
        c.addEventListener("focus", enter);
        c.addEventListener("blur", function () { c.classList.remove("active"); hideTip(); });
        c.addEventListener("click", function (ev) { ev.preventDefault(); enter(ev); });
        shotLayerMc.appendChild(c);
      });
      if (shotLegend) shotLegend.innerHTML =
        '<span><i class="lg-mc-h"></i> ' + esc(D.home.name) + "</span>" +
        '<span><i class="lg-mc-a"></i> ' + esc(D.away.name) + "</span>" +
        '<span><i class="lg-mc-goal"></i> Goal (white ring)</span>' +
        '<span><i class="lg-mc-off"></i> Off target (hollow)</span>' +
        '<span class="lg-size"><i></i><i></i><i></i> size = xG</span>';
    };

    /* ---- goal replays: ball travels the real build-up ---------------------
       steps come pre-extracted from the pipeline (same sequence logic as the
       WC2026 dashboard). Node = touch; pass = dotted; carry = dashed; shot =
       solid red into the goal mouth. Play animates the ball along each move. */
    var segD = function (m) {
      if (m.type === "cross") {
        var dx = m.x2 - m.x1, dy = m.y2 - m.y1, len = Math.hypot(dx, dy) || 1, off = Math.min(7 * UNIT, len * 0.2);
        var cx = (m.x1 + m.x2) / 2 + (-dy / len) * off, cy = (m.y1 + m.y2) / 2 + (dx / len) * off;
        return "M" + m.x1.toFixed(1) + "," + m.y1.toFixed(1) + " Q" + cx.toFixed(1) + "," + cy.toFixed(1) + " " + m.x2.toFixed(1) + "," + m.y2.toFixed(1);
      }
      return "M" + m.x1.toFixed(1) + "," + m.y1.toFixed(1) + " L" + m.x2.toFixed(1) + "," + m.y2.toFixed(1);
    };
    var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
    var segTip = function (kind, opt) {
      if (kind === "pass") return "<b>Pass</b><br>from " + esc(opt.by);
      if (kind === "cross") return "<b>Cross</b><br>from " + esc(opt.by);
      if (kind === "carry") return "<b>Carry / dribble</b>" + (opt.to ? "<br>to " + esc(opt.to) : "");
      return "<b>Shot</b><br>" + esc(opt.by) + (opt.xg != null ? " · xG " + opt.xg.toFixed(2) : "");
    };
    var nodeTip = function (pt, i, seq) {
      var who = "<b>" + esc(pt.player) + (pt.num != null ? " · #" + pt.num : "") + "</b><br>";
      if (pt.k === "save") return who + "Goalkeeper save";
      if (pt.k === "shot") return who + "⚽ Goal" + (pt.xg != null ? " · xG " + pt.xg.toFixed(2) : "") + " · " + seq.min + "'";
      if (pt.k === "shot_eff") return who + "Shot saved" + (pt.xg != null ? " · xG " + pt.xg.toFixed(2) : "");
      if (pt.k === "dribble") return who + "Take-on / dribble";
      return who + (i === 0 ? "Move start" : "On the ball");
    };
    // Order steps into ball moves: node -(pass)-> pass-end -(carry)-> next node ... -(shot)-> goal
    var journey = function (P, side) {
      var mv = [], i, nx, L;
      for (i = 0; i < P.length; i++) {
        var pt = P[i];
        if (pt.k === "pass") {
          mv.push({ type: pt.cross ? "cross" : "pass", x1: pt.x, y1: pt.y, x2: pt.ex, y2: pt.ey, litNode: null, tip: segTip(pt.cross ? "cross" : "pass", { by: pt.player }) });
          if (i < P.length - 1) {
            nx = P[i + 1]; L = Math.hypot(nx.x - pt.ex, nx.y - pt.ey);
            mv.push({ type: nx.k === "save" ? "shotln" : "carry", x1: pt.ex, y1: pt.ey, x2: nx.x, y2: nx.y, litNode: i + 1,
                      hidden: !(L > UNIT && L <= MAX_SEG),
                      tip: nx.k === "save" ? segTip("shot", { by: pt.player }) : segTip("carry", { to: nx.player }) });
          }
        } else if (i < P.length - 1) {
          nx = P[i + 1]; L = Math.hypot(nx.x - pt.x, nx.y - pt.y);
          mv.push({ type: nx.k === "save" ? "shotln" : "carry", x1: pt.x, y1: pt.y, x2: nx.x, y2: nx.y, litNode: i + 1,
                    hidden: !(L > UNIT && L <= MAX_SEG),
                    tip: nx.k === "save" ? segTip("shot", { by: pt.player, xg: pt.xg }) : segTip("carry", { to: nx.player }) });
        }
      }
      var Lp = P[P.length - 1], gx = tx(side, 99.4), gy = ty(side, 50);
      mv.push({ type: "shot", x1: Lp.x, y1: Lp.y, x2: gx, y2: gy, litNode: null,
                hidden: !(Math.hypot(gx - Lp.x, gy - Lp.y) <= MAX_SEG), tip: segTip("shot", { by: Lp.player, xg: Lp.xg }) });
      mv.forEach(function (m) {
        var len = Math.hypot(m.x2 - m.x1, m.y2 - m.y1) / UNIT;   // back to pitch units for pacing
        if (m.hidden) { m.dur = 160; m.dwell = 0; }
        else if (m.type === "pass" || m.type === "cross") { m.dur = clamp(380 + len * 9, 380, 950); m.dwell = 150; }
        else if (m.type === "shot") { m.dur = 470; m.dwell = 0; }
        else if (m.type === "shotln") { m.dur = 380; m.dwell = 120; }
        else { m.dur = clamp(360 + len * 30, 360, 1500); m.dwell = 220; }  // carries are slower than passes
      });
      return mv;
    };

    var current = null;   // { mv, nodeEls, ball, trail, goalText, cancel }
    var buildReplay = function (seq, D) {
      if (current && current.cancel) current.cancel();
      while (replayLayer.firstChild) replayLayer.removeChild(replayLayer.firstChild);
      var P = seq.steps.map(function (st) {
        var sd = st.team || seq.side;   // saves are recorded in the opposition frame
        return { k: st.k, player: st.player, num: st.num, xg: st.xg, cross: !!st.cross,
                 x: tx(sd, st.x), y: ty(sd, st.y),
                 ex: st.ex != null ? tx(sd, st.ex) : null, ey: st.ey != null ? ty(sd, st.ey) : null };
      });
      // pass end defaults to own spot (keeps journey() simple)
      P.forEach(function (p) { if (p.ex == null) { p.ex = p.x; p.ey = p.y; } });
      var mv = journey(P, seq.side);
      var teamName = seq.side === "home" ? D.home.name : D.away.name;
      if (replayDir) replayDir.textContent = seq.side === "home" ? teamName + " attacking →" : "← " + teamName + " attacking";
      if (replayMeta) replayMeta.textContent = seq.min + "' " + seq.scorer + (seq.assist ? " · assist " + seq.assist : "") +
        (seq.xg != null ? " · xG " + seq.xg.toFixed(2) : "") + " · " + seq.passes + " passes, " + seq.players + " players";

      mv.forEach(function (m) {
        m.len = Math.hypot(m.x2 - m.x1, m.y2 - m.y1); m.el = null;
        if (m.hidden) return;
        var segCls = m.type === "cross" ? "mc-pass mc-cross" : m.type === "pass" ? "mc-pass" : m.type === "carry" ? "mc-carry" : "mc-shotln";
        var p = E("path", { "class": segCls, d: segD(m),
                            "marker-end": "url(#" + (m.type === "shot" || m.type === "shotln" ? "mcArrShot" : "mcArrPass") + ")" });
        replayLayer.appendChild(p); m.el = p; m.len = p.getTotalLength();
        var hit = E("path", { "class": "mc-hit", d: segD(m), "data-tip": encodeURIComponent(m.tip) });
        replayLayer.appendChild(hit);
      });
      var nodeEls = P.map(function (pt, i) {
        var cls = pt.k === "save" ? " save" : pt.k === "shot" ? " shot" : pt.k === "shot_eff" ? " shot" : pt.k === "dribble" ? " drib" : (i === 0 ? " start" : "");
        var g = E("g", { "data-tip": encodeURIComponent(nodeTip(pt, i, seq)), "class": "mc-nodeg" });
        g.appendChild(E("circle", { "class": "mc-node" + cls, cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: 9 }));
        var t = E("text", { "class": "mc-nt", x: pt.x.toFixed(1), y: pt.y.toFixed(1) });
        t.textContent = pt.num != null ? pt.num : (i + 1);
        g.appendChild(t); replayLayer.appendChild(g); return g;
      });
      // scorer + xG labels above the finishing node
      var Lp = P[P.length - 1], ly = Math.max(30, Lp.y - 14);
      var lab = E("text", { "class": "mc-scorelab", x: Lp.x.toFixed(1), y: (ly - 12).toFixed(1), "text-anchor": "middle" });
      lab.textContent = seq.scorer; replayLayer.appendChild(lab);
      if (seq.xg != null) {
        var lab2 = E("text", { "class": "mc-xglab", x: Lp.x.toFixed(1), y: ly.toFixed(1), "text-anchor": "middle" });
        lab2.textContent = "xG " + seq.xg.toFixed(2); replayLayer.appendChild(lab2);
      }
      var trail = E("polyline", { "class": "mc-trail", points: "" }); replayLayer.appendChild(trail);
      var ball = E("circle", { "class": "mc-ball", cx: P[0].x.toFixed(1), cy: P[0].y.toFixed(1), r: 6.5 });
      ball.style.opacity = "0"; replayLayer.appendChild(ball);
      var gEnd = mv[mv.length - 1];
      var goalText = E("text", { "class": "mc-goalflash", x: (seq.side === "home" ? gEnd.x2 - 66 : gEnd.x2 + 66).toFixed(1), y: Math.max(40, gEnd.y2 - 46).toFixed(1), "text-anchor": "middle" });
      goalText.textContent = "Goal!"; goalText.style.opacity = "0"; replayLayer.appendChild(goalText);

      current = {
        mv: mv, nodeEls: nodeEls, ball: ball, trail: trail, goalText: goalText, P: P, cancel: null,
        rest: function () {
          if (current.cancel) { current.cancel(); current.cancel = null; }
          mv.forEach(function (m) { if (m.el) m.el.style.opacity = "1"; });
          nodeEls.forEach(function (g) { g.style.opacity = "1"; });
          ball.style.opacity = "0"; trail.setAttribute("points", ""); goalText.style.opacity = "0";
        },
        play: function () {
          current.rest();
          mv.forEach(function (m) { if (m.el) m.el.style.opacity = "0.14"; });
          nodeEls.forEach(function (g, i) { g.style.opacity = i === 0 ? "1" : "0.25"; });
          goalText.style.opacity = "0";
          ball.style.opacity = "1"; ball.setAttribute("cx", P[0].x.toFixed(1)); ball.setAttribute("cy", P[0].y.toFixed(1));
          var i = 0, t0 = performance.now(), arrived = false, pts = [], raf;
          var SPEED = 1.15;
          var step = function (now) {
            var m = mv[i], dur = Math.max(60, m.dur / SPEED), e = now - t0, f = Math.min(e, dur) / dur;
            var pos = m.el ? m.el.getPointAtLength(f * m.len) : { x: m.x1 + (m.x2 - m.x1) * f, y: m.y1 + (m.y2 - m.y1) * f };
            if (m.el) m.el.style.opacity = "1";
            ball.setAttribute("cx", pos.x.toFixed(1)); ball.setAttribute("cy", pos.y.toFixed(1));
            pts.push(pos.x.toFixed(1) + "," + pos.y.toFixed(1)); if (pts.length > 16) pts.shift();
            trail.setAttribute("points", pts.join(" "));
            if (e >= dur && !arrived) {
              arrived = true;
              if (m.litNode != null && nodeEls[m.litNode]) nodeEls[m.litNode].style.opacity = "1";
              if (m.el) m.el.style.opacity = "0.6";
            }
            if (e >= dur + (m.dwell || 0) / SPEED) {
              i++; arrived = false; t0 = now;
              if (i >= mv.length) {
                goalText.style.opacity = "1"; current.cancel = null;
                if (playBtn) playBtn.textContent = "↻ Replay";
                return;
              }
            }
            raf = requestAnimationFrame(step);
          };
          raf = requestAnimationFrame(step);
          current.cancel = function () { cancelAnimationFrame(raf); };
        }
      };
      current.rest();
    };

    /* delegated hover tips for replay segments + nodes */
    if (replaySvg) {
      replaySvg.addEventListener("mousemove", function (e) {
        var t = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
        if (t) showTip(decodeURIComponent(t.getAttribute("data-tip")), e.clientX, e.clientY);
        else hideTip();
      });
      replaySvg.addEventListener("mouseleave", hideTip);
    }

    var renderReplays = function (D) {
      if (!D.replays.length) return;
      var sel = 0;
      var select = function (i) {
        sel = i;
        $$(".toggle-chip", tabsEl).forEach(function (b, j) { b.setAttribute("aria-pressed", j === i ? "true" : "false"); });
        if (playBtn) playBtn.textContent = "▶ Play";
        buildReplay(D.replays[i], D);
      };
      tabsEl.innerHTML = "";
      D.replays.forEach(function (r, i) {
        var b = document.createElement("button");
        b.className = "toggle-chip mc-goaltab";
        b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
        b.innerHTML = "⚽ " + r.min + "' " + esc(r.scorer.split(" ").pop());
        b.addEventListener("click", function () { select(i); });
        tabsEl.appendChild(b);
      });
      if (playBtn) playBtn.addEventListener("click", function () { if (current) { playBtn.textContent = "↻ Replay"; current.play(); } });
      select(0);
    };

    fetch("assets/data/arg_alg_match.json?v=1", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (D) {
        renderScore(D); renderStats(D); renderShots(D); renderReplays(D);
      })
      .catch(function (e) {
        if (replayMeta) replayMeta.textContent = "Match data could not be loaded.";
      });
  })();
})();
