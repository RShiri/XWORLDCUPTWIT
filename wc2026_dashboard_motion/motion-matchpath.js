/* motion-matchpath.js — surgical path fix for the Motion edition's match page.
 *
 * The match page reuses the original ../wc2026_dashboard/match.js verbatim. That
 * script loads the per-match event file with a PAGE-relative src
 * ("matches_detail/<id>.js"), which in this folder would 404 — the detail files
 * live only in the original dashboard folder (we deliberately share them rather
 * than duplicating ~78 files that would drift on every auto-deploy).
 *
 * So we shadow document.head.appendChild for exactly that one injected <script>,
 * rewriting its already-absolutised src from .../wc2026_dashboard_motion/
 * matches_detail/ back to .../wc2026_dashboard/matches_detail/. Nothing else is
 * touched — every other asset on the page uses an explicit ../wc2026_dashboard/
 * path already. Must load BEFORE match.js.
 */
(function () {
  "use strict";
  var head = document.head || document.getElementsByTagName("head")[0];
  if (!head) return;
  var orig = head.appendChild.bind(head);
  head.appendChild = function (node) {
    try {
      if (node && node.tagName === "SCRIPT" && node.src &&
          node.src.indexOf("/wc2026_dashboard_motion/matches_detail/") !== -1) {
        node.src = node.src.replace(
          "/wc2026_dashboard_motion/matches_detail/",
          "/wc2026_dashboard/matches_detail/"
        );
      }
    } catch (e) { /* fall through and append unchanged */ }
    return orig(node);
  };
})();
