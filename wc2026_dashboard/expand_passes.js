/* Expand the columnar pass stream back into plain objects.
 *
 * matches_detail/*.js files are ~93% pass data. Storing that stream as one
 * object per pass repeats fifteen key names and six mostly-false booleans
 * about a thousand times per match, which costs ~600 MB across the corpus.
 * The files therefore ship a columnar form (see tools/compact_passes.py)
 * and call this on the way in:
 *
 *     window.MATCH_DETAIL = window.__mdExpand({ ... "passes": {"__c":1,...} });
 *
 * By the time match.js reads window.MATCH_DETAIL the passes are ordinary
 * objects again, identical field for field to what they were before — so no
 * dashboard code has to know this happened. Load this BEFORE the data file.
 *
 * A file that was never compacted passes through untouched, so old and new
 * data files both work.
 */
(function (global) {
  "use strict";

  function expandPasses(block) {
    if (!block || block.__c !== 1 || !block.r) return block;   // already plain
    var names = block.n || [], flags = block.f || [], rows = block.r;
    var out = new Array(rows.length);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], bits = r[9];
      var p = {
        team: r[0] === 0 ? "home" : "away",
        x: r[1], y: r[2], ex: r[3], ey: r[4],
        min: r[5], sec: r[6],
        player: r[7] >= 0 ? names[r[7]] : null,
        recv: r[8] >= 0 ? names[r[8]] : null
      };
      for (var f = 0; f < flags.length; f++) {
        p[flags[f]] = (bits & (1 << f)) !== 0;
      }
      out[i] = p;
    }
    return out;
  }

  /* The hook the data files call. Mutates and returns the match object. */
  global.__mdExpand = function (detail) {
    if (detail && detail.passes) detail.passes = expandPasses(detail.passes);
    return detail;
  };
  global.__mdExpandPasses = expandPasses;
})(window);
