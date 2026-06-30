/* motion-enhance.js — the animation layer for the WC2026 "Motion edition".
 *
 * Loads AFTER the original app.js / match.js (which it reuses verbatim from
 * ../wc2026_dashboard/) and layers `motion` animations on top WITHOUT touching
 * any of the original logic or markup:
 *   - header badge + "Classic" link back to the original site
 *   - top scroll-progress bar (Motion.scroll)
 *   - staggered fade-up reveals of each view's cards on first paint & tab switch
 *   - count-up of headline stat numbers
 *   - spring hover lift on cards / tabs (event-delegated, survives re-renders)
 *   - section reveals on the match page as match.js fills #matchRoot
 *
 * Everything degrades safely: if `motion` failed to load, or the user prefers
 * reduced motion, the page renders exactly like the classic dashboard. The layer
 * never leaves an element stuck hidden — every reveal also clears its inline
 * styles on a timeout, independent of the animation promise.
 */
(function () {
  "use strict";

  var M = window.Motion;
  var REDUCED = false;
  try { REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // The badge/link are nice even without animation; add them regardless.
  function decorateHeader() {
    var nav = document.querySelector("header.site nav.tabs");
    var brandSub = document.querySelector("header.site .brand .sub");
    if (brandSub && !brandSub.querySelector(".mo-badge")) {
      var badge = document.createElement("span");
      badge.className = "mo-badge";
      badge.textContent = "✨ Motion";
      brandSub.appendChild(badge);
    }
    if (nav && !nav.querySelector(".mo-classic-link")) {
      var a = document.createElement("a");
      a.className = "mo-classic-link";
      // Link to the matching classic page: the match page keeps its ?id=.
      var isMatch = !!document.getElementById("matchRoot");
      a.href = "../wc2026_dashboard/" + (isMatch ? "match.html" + location.search : "index.html");
      a.textContent = "Classic ↗";
      a.title = "Open the original (non-animated) dashboard";
      nav.appendChild(a);
    }
  }

  if (!M || REDUCED) {
    // No animation — just add the badge/link and bail.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", decorateHeader);
    } else {
      decorateHeader();
    }
    return;
  }

  var animate = M.animate, stagger = M.stagger, inView = M.inView, scroll = M.scroll;
  var EASE = [0.22, 1, 0.36, 1]; // gentle ease-out

  /* ---- staggered fade-up reveal of a container's direct children ---- */
  function reveal(container, opts) {
    if (!container) return;
    opts = opts || {};
    var kids = Array.prototype.filter.call(container.children, function (k) {
      return k.nodeType === 1 && k.id !== "mo-scrollbar";
    });
    if (!kids.length) return;

    kids.forEach(function (k) { k.style.opacity = "0"; k.style.transform = "translateY(16px)"; });

    var dur = opts.duration || 0.5;
    var step = opts.step != null ? opts.step : 0.05;
    try {
      animate(
        kids,
        { opacity: [0, 1], y: [16, 0] },
        { duration: dur, delay: stagger(step, { start: 0.02 }), ease: EASE }
      );
    } catch (e) { /* fall through to the cleanup timeout */ }

    // Hard safety: clear inline styles no matter what the engine did, so a
    // glitch can never leave content invisible.
    var settle = (dur + step * kids.length + 0.15) * 1000;
    setTimeout(function () {
      kids.forEach(function (k) { k.style.opacity = ""; k.style.transform = ""; });
    }, Math.min(settle, 2500));
  }

  /* ---- count-up of headline stat numbers (.stats-strip .stat .v) ---- */
  function countUp(el) {
    if (!el || el._moCounted) return;
    var raw = (el.textContent || "").trim();
    // capture: optional prefix, number (with optional decimals), suffix (%, etc.)
    var m = raw.match(/^([^\d-]*)(-?\d+(?:\.\d+)?)(.*)$/);
    if (!m) return;
    el._moCounted = true;
    var prefix = m[1], target = parseFloat(m[2]), suffix = m[3];
    if (!isFinite(target)) return;
    var decimals = (m[2].split(".")[1] || "").length;
    el.textContent = prefix + (0).toFixed(decimals) + suffix;
    try {
      animate(0, target, {
        duration: 0.9,
        ease: EASE,
        onUpdate: function (v) { el.textContent = prefix + v.toFixed(decimals) + suffix; }
      });
    } catch (e) {
      el.textContent = raw; // restore exact original on any failure
    }
  }
  function countUpIn(scope) {
    (scope || document).querySelectorAll(".stats-strip .stat .v").forEach(countUp);
  }

  /* ---- spring hover lift (event-delegated → survives app re-renders) ---- */
  var HOVER_SEL = ".card,.group-card,.data-card,.third-card,.pred-card,.stat,.stat-panel";
  function hoverTarget(node) {
    if (!node || !node.closest) return null;
    var t = node.closest(HOVER_SEL);
    if (!t) return null;
    // Never lift/scale a card that holds a graph: a CSS scale blurs the SVG and
    // the lift fights the chart's own hover tooltips / clickable dots. Leave any
    // card containing an <svg> or <canvas> perfectly still and interactive.
    if (t.querySelector("svg, canvas")) return null;
    return t;
  }
  document.addEventListener("mouseover", function (e) {
    var t = hoverTarget(e.target);
    if (!t || t._moHover) return;
    t._moHover = true;
    try { animate(t, { y: -4, scale: 1.012 }, { type: "spring", stiffness: 320, damping: 22 }); } catch (x) {}
  }, true);
  document.addEventListener("mouseout", function (e) {
    var t = hoverTarget(e.target);
    if (!t || !t._moHover) return;
    if (e.relatedTarget && t.contains(e.relatedTarget)) return;
    t._moHover = false;
    try { animate(t, { y: 0, scale: 1 }, { type: "spring", stiffness: 320, damping: 26 }); } catch (x) {}
  }, true);

  // Tab buttons get a quick press feedback.
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("nav.tabs button") : null;
    if (!b) return;
    try {
      animate(b, { scale: [0.94, 1] }, { duration: 0.28, ease: EASE });
    } catch (x) {}
  }, true);

  /* ---- top scroll-progress bar ---- */
  function mountScrollBar() {
    if (document.getElementById("mo-scrollbar")) return;
    var bar = document.createElement("div");
    bar.id = "mo-scrollbar";
    document.body.appendChild(bar);
    try { scroll(animate(bar, { scaleX: [0, 1] }, { ease: "linear" })); }
    catch (x) { bar.remove(); }
  }

  /* ================= INDEX (dashboard) page ================= */
  function initIndex() {
    var header = document.querySelector("header.site");
    if (header) {
      try { animate(header, { opacity: [0, 1], y: [-14, 0] }, { duration: 0.5, ease: EASE }); } catch (x) {}
    }

    var active = document.querySelector(".view.active");
    reveal(active);
    countUpIn(active);

    // Reveal each view's cards when its tab is activated. App.js toggles the
    // .active class on click; our handler runs after (registered later) so the
    // right view is already active.
    var tabs = document.querySelectorAll("nav.tabs button");
    tabs.forEach(function (b) {
      b.addEventListener("click", function () {
        // let app.js flip .active first
        requestAnimationFrame(function () {
          var v = document.querySelector(".view.active");
          reveal(v);
          countUpIn(v);
        });
      });
    });

    // Scroll-reveal section heads as they enter the viewport. Heads in the
    // initially-active view are already handled by reveal() above, so skip them.
    // Every head gets an UNCONDITIONAL clear timeout so a missed inView/IO event
    // can never leave it stuck hidden.
    document.querySelectorAll(".view .section-head").forEach(function (sh) {
      if (sh.closest(".view.active")) return;
      sh.style.opacity = "0";
      sh.style.transform = "translateY(18px)";
      var done = false;
      var clr = function () { if (done) return; done = true; sh.style.opacity = ""; sh.style.transform = ""; };
      try {
        inView(sh, function () {
          animate(sh, { opacity: [0, 1], y: [18, 0] }, { duration: 0.5, ease: EASE });
          setTimeout(clr, 700);
        }, { amount: 0.2 });
      } catch (x) { clr(); }
      setTimeout(clr, 6000); // absolute safety net
    });
  }

  /* ================= MATCH page ================= */
  function initMatch() {
    var header = document.querySelector("header.site");
    if (header) {
      try { animate(header, { opacity: [0, 1], y: [-14, 0] }, { duration: 0.5, ease: EASE }); } catch (x) {}
    }
    var root = document.getElementById("matchRoot");
    if (!root) return;

    // match.js fills #matchRoot asynchronously (fetch). Reveal each top-level
    // section as it lands, debounced so a burst of inserts animates together.
    var pending = [];
    var timer = null;
    function flush() {
      timer = null;
      var batch = pending.slice(); pending.length = 0;
      batch.forEach(function (el, i) {
        if (el._moRevealed) return;
        el._moRevealed = true;
        el.style.opacity = "0"; el.style.transform = "translateY(18px)";
        try {
          animate(el, { opacity: [0, 1], y: [18, 0] },
            { duration: 0.5, delay: i * 0.05, ease: EASE });
        } catch (x) {}
        setTimeout(function () { el.style.opacity = ""; el.style.transform = ""; }, 1000);
      });
      countUpIn(root);
    }
    function queue(el) {
      if (el.nodeType !== 1 || el._moRevealed) return;
      pending.push(el);
      if (!timer) timer = setTimeout(flush, 60);
    }

    // reveal whatever is already there
    Array.prototype.forEach.call(root.children, queue);

    var obs = new MutationObserver(function (muts) {
      muts.forEach(function (mu) {
        Array.prototype.forEach.call(mu.addedNodes, function (n) {
          if (n.nodeType === 1 && n.parentNode === root) queue(n);
        });
      });
    });
    obs.observe(root, { childList: true });
  }

  /* ================= IN-GRAPH ANIMATION ENGINE =================
   * Animates the DATA MARKS inside each chart (scatter dots, shot/pass/node
   * circles, radar areas, heat cells, the xG-momentum lines, match-stat bars)
   * — never the axes, gridlines or pitch markings, and never breaking the
   * charts' own <title>/click/mousemove interactivity (we only set inline
   * style on existing nodes, never replace them, and clear it afterwards).
   *
   * Each chart animates ONCE, when it first scrolls into view. We deliberately
   * do NOT re-animate on the rapid scrubber/filter redraws (shot/pass/dribble/
   * avg-pos/shootout redraw ~every 180ms while playing) — that would strobe.
   */
  var CHART_SEL = "svg.scatter-svg, svg.so-chart, svg.so-radar, svg.tl-pitch, svg.mv-mom-chart, svg.pitch-svg";

  function clearMark(el) {
    var s = el.style;
    s.opacity = ""; s.transform = ""; s.transformBox = ""; s.transformOrigin = "";
    s.strokeDasharray = ""; s.strokeDashoffset = "";
  }

  // Data circles, excluding axis/pitch decoration. `allowR`: also accept an
  // unclassed, title-less circle if it's big enough to be a node (match pass
  // network / avg-position nodes have neither class nor <title>); used only for
  // match pitch-svg where tiny pitch spots are r<1.5.
  function dataCircles(svg, allowR) {
    return Array.prototype.filter.call(svg.querySelectorAll("circle"), function (c) {
      var cls = c.getAttribute("class") || "";
      if (/pitch/.test(cls)) return false;            // pitch marking
      if (c.getElementsByTagName("title").length) return true; // has tooltip → data
      if (cls) return true;                            // shot-dot / pass-dot / pt / agm-node …
      return allowR ? (parseFloat(c.getAttribute("r") || "0") >= 1.5) : false;
    });
  }
  function dataLines(svg) {
    // pitch-svg only: passes / dribbles / network links / shot paths / agm lines.
    return Array.prototype.filter.call(svg.querySelectorAll("line, path, polyline"), function (el) {
      var cls = el.getAttribute("class") || "";
      return !/pitch|dir-label/.test(cls);
    });
  }

  function popIn(els, base, step, cap, spring) {
    if (!els.length) return;
    var big = els.length > 120; // perf: lighter (no spring) for dense plots
    els.forEach(function (el) {
      el.style.opacity = "0";
      if (!big) { el.style.transformBox = "fill-box"; el.style.transformOrigin = "center"; el.style.transform = "scale(0.35)"; }
    });
    els.forEach(function (el, i) {
      var d = base + Math.min(i * step, cap);
      try {
        if (big) animate(el, { opacity: 1 }, { duration: 0.35, delay: d, ease: EASE });
        else animate(el, { opacity: 1, scale: 1 }, spring || { type: "spring", stiffness: 420, damping: 24, delay: d });
      } catch (e) {}
    });
    setTimeout(function () { els.forEach(clearMark); }, Math.min((base + cap + 0.7) * 1000, 3200));
  }
  function fadeIn(els, step, cap, dur) {
    if (!els.length) return;
    els.forEach(function (el) { el.style.opacity = "0"; });
    els.forEach(function (el, i) {
      try { animate(el, { opacity: 1 }, { duration: dur || 0.4, delay: Math.min(i * step, cap), ease: EASE }); } catch (e) {}
    });
    setTimeout(function () { els.forEach(function (el) { el.style.opacity = ""; }); }, Math.min((cap + (dur || 0.4) + 0.5) * 1000, 3200));
  }
  function drawPath(path, dur, delay) {
    var len = 0; try { len = path.getTotalLength(); } catch (e) {}
    if (!len) { fadeIn([path], 0, 0, 0.4); return; }
    path.style.strokeDasharray = len; path.style.strokeDashoffset = len;
    try { animate(path, { strokeDashoffset: [len, 0] }, { duration: dur, delay: delay, ease: EASE }); } catch (e) {}
    setTimeout(function () { path.style.strokeDasharray = ""; path.style.strokeDashoffset = ""; }, ((delay + dur) + 0.6) * 1000);
  }

  function revealChart(svg) {
    if (!svg || svg._moChart) return;
    svg._moChart = true;
    var cls = svg.getAttribute("class") || "";
    try {
      if (/mv-mom-chart/.test(cls)) {
        // xG momentum: draw the two cumulative lines, then pop the goal markers.
        var paths = Array.prototype.filter.call(svg.querySelectorAll("path"), function (p) {
          return (p.getAttribute("fill") || "") === "none" && p.getAttribute("stroke");
        });
        paths.forEach(function (p, i) { drawPath(p, 0.9, i * 0.12); });
        popIn(dataCircles(svg, false), 0.8, 0.05, 0.4);
        fadeIn(Array.prototype.filter.call(svg.querySelectorAll("text"), function (t) {
          return (t.textContent || "").indexOf("⚽") >= 0; // ⚽ goal emoji
        }), 0.05, 0.4, 0.4);
        return;
      }
      if (/so-radar/.test(cls)) {
        // radar: scale the filled area from its centre, then pop the vertices.
        var polys = Array.prototype.filter.call(svg.querySelectorAll("polygon"), function (p) {
          var f = p.getAttribute("fill") || ""; return f && f !== "none";
        });
        polys.forEach(function (p) {
          p.style.opacity = "0"; p.style.transformBox = "fill-box"; p.style.transformOrigin = "center"; p.style.transform = "scale(0.2)";
          try { animate(p, { opacity: 1, scale: 1 }, { type: "spring", stiffness: 240, damping: 20 }); } catch (e) {}
        });
        popIn(dataCircles(svg, false), 0.12, 0.03, 0.3);
        setTimeout(function () { polys.forEach(clearMark); }, 1500);
        return;
      }
      // generic: scatter-svg / so-chart / tl-pitch / pitch-svg
      var isPitch = /pitch-svg/.test(cls);
      var circles = dataCircles(svg, isPitch);
      var rects = Array.prototype.filter.call(svg.querySelectorAll("rect"), function (r) {
        return (r.getAttribute("fill") || "").toLowerCase() === "#ff6a3d"; // tl heat cells
      });
      var lines = isPitch ? dataLines(svg) : [];
      if (lines.length) fadeIn(lines, lines.length > 60 ? 0.004 : 0.012, 0.5, 0.4);
      if (rects.length) fadeIn(rects, 0.01, 0.45, 0.45);
      if (circles.length) popIn(circles, lines.length ? 0.18 : 0.04, circles.length > 80 ? 0.005 : 0.014, 0.6);
    } catch (e) { /* a chart animation must never break the page */ }
  }

  function registerChart(svg) {
    if (!svg || svg._moChartReg) return;
    if (svg.closest && svg.closest("#mv-goals-anim")) return; // replay owns its own opacity
    svg._moChartReg = true;
    try { inView(svg, function () { revealChart(svg); }, { amount: 0.12 }); }
    catch (e) { revealChart(svg); }
  }
  function scanCharts(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(CHART_SEL)) registerChart(root);
    Array.prototype.forEach.call(root.querySelectorAll(CHART_SEL), registerChart);
  }

  // Match-stats comparison bars are HTML (.sc-fill width:%), not SVG — grow them.
  function registerBar(f) {
    if (!f || f._moBar) return;
    f._moBar = true;
    var w = f.style.width; if (!w) return;
    f.style.width = "0%";
    var grown = false;
    var grow = function () { if (grown) return; grown = true; f.style.width = w; };
    try {
      inView(f, function () { try { animate(f, { width: ["0%", w] }, { duration: 0.7, ease: EASE }); } catch (e) {} setTimeout(grow, 850); }, { amount: 0.4 });
    } catch (e) { grow(); }
    setTimeout(grow, 6000); // safety net
  }
  function scanBars(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll(".sc-fill"), registerBar);
  }

  function initGraphs() {
    scanCharts(document);
    scanBars(document);
    // Discover charts/bars created later (tab opens, match.js fetch). We only
    // REGISTER new svgs/bars here; existing ones keep their one-shot guard, so
    // scrubber/filter redraws (which only swap child marks, not the svg) never
    // re-trigger an animation.
    try {
      var mo = new MutationObserver(function (muts) {
        muts.forEach(function (mu) {
          Array.prototype.forEach.call(mu.addedNodes, function (n) {
            if (n.nodeType !== 1) return;
            scanCharts(n);
            scanBars(n);
          });
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  /* ---- boot ---- */
  function boot() {
    decorateHeader();
    mountScrollBar();
    if (document.getElementById("matchRoot")) initMatch();
    else initIndex();
    initGraphs();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
