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
    return node && node.closest ? node.closest(HOVER_SEL) : null;
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

  /* ---- boot ---- */
  function boot() {
    decorateHeader();
    mountScrollBar();
    if (document.getElementById("matchRoot")) initMatch();
    else initIndex();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
