/* WC2026 dashboard front-end. Consumes window.WC_DATA from data.js (no build step,
   no network). Renders group tables, fixtures, and the xG analysis section. */
(function () {
  "use strict";
  var D = window.WC_DATA;
  // Which edition this page shows (?edition=2018|2022, set by the HTML loader).
  // 2026 = the live tournament, today's behavior. Historical editions load
  // editions/<year>/ data whose payload self-describes its format (D.format).
  var ED = window.WC_EDITION || 2026;
  var ED_BASE = ED === 2026 ? "" : "editions/" + ED + "/";
  if (!D) {
    document.body.innerHTML = ED === 2026
      ? "<p style='padding:40px'>data.js failed to load.</p>"
      : "<p style='padding:40px'>No data published for the " + ED + " World Cup yet — " +
        "the owner lights it up via the backfill workflows (see ROADMAP.md). " +
        "<a href='" + location.pathname.split("/").pop() + "'>Back to 2026</a></p>";
    return;
  }
  // Tournament format, from the data itself (historical payloads embed it; the 2026
  // payload predates the field, so its shape is the default).
  var FMT = D.format || { groups: "ABCDEFGHIJKL", koEntry: "R32", thirds: true, fairPlay: false };
  var ED_LABEL = "World Cup " + ED;

  var LOGO = "../team_logos/wc2026/";
  var tooltip = document.getElementById("tooltip");

  // URL to a Match Centre page, carrying the edition along.
  function matchUrl(id) {
    var q = "id=" + encodeURIComponent(id);
    if (ED !== 2026) q += "&edition=" + ED;
    return "match.html?" + q;
  }

  /* ---------------- Edition chrome ----------------
     Header pills (2018 · 2022 · 2026) on both skins, the brand-year swap, and the
     2026-only tabs (Breaks, Power Rank) hidden for historical editions. */
  (function initEditionChrome() {
    var pills = document.getElementById("editionPills");
    if (pills) {
      var page = location.pathname.split("/").pop() || "index.html";
      pills.innerHTML = [2018, 2022, 2026].map(function (y) {
        var href = page + (y === 2026 ? "" : "?edition=" + y);
        return '<a class="ed-pill' + (y === ED ? " active" : "") + '" href="' + href + '">' + y + "</a>";
      }).join("");
    }
    if (ED !== 2026) {
      var yr = document.querySelector(".brand .title .ed-year");
      if (yr) yr.textContent = ED;
      document.title = document.title.replace(/2026/, String(ED));
      // Breaks (cooling-break study) and Power Rank (FIFA-2026 inputs) are 2026-only.
      ["breaks", "predict"].forEach(function (v) {
        var b = document.querySelector('nav.tabs button[data-view="' + v + '"]');
        if (b) b.remove();
      });
    }
  })();

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function logoImg(team, cls) {
    var safe = esc(team);
    return '<img class="' + (cls || "") + '" src="' + LOGO + encodeURIComponent(team) +
      '.png" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'" title="' + safe + '">';
  }

  /* ---------------- Shared scatter helpers (ticks, label de-clutter, legends) ----------------
     The team scatter charts in the xG lab share one renderer so they all get readable axis
     numbers, a colour legend the average fan can parse, and team labels that don't pile on
     top of each other. */
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var pow = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / pow;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * pow;
  }
  function niceTicks(max, target) {
    target = target || 5;
    var raw = max / target, pow = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / pow;
    var step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
    var ticks = [];
    for (var v = 0; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(4));
    return ticks;
  }
  function fmtTick(v) { return Math.round(v) === v ? String(v) : v.toFixed(v < 1 ? 2 : 1); }
  // Greedy vertical de-clutter: place each team label to the right of its dot, then push
  // colliding labels downward so names stay legible. `led` flags a label nudged far enough
  // to warrant a leader line back to its dot.
  function declutter(pts, fontPx) {
    var LH = fontPx + 2.6, CW = fontPx * 0.56, placed = [];
    pts.map(function (p, i) { return i; })
      .sort(function (a, b) { return pts[a].cy - pts[b].cy; })
      .forEach(function (i) {
        var p = pts[i], w = String(p.team).length * CW + 5;
        var lx = p.cx + 8, ly = p.cy + 3, guard = 0, moved = true;
        while (moved && guard++ < 400) {
          moved = false;
          for (var j = 0; j < placed.length; j++) {
            var q = placed[j];
            if (lx < q.x2 && q.lx < lx + w && Math.abs(ly - q.ly) < LH) { ly = q.ly + LH; moved = true; }
          }
        }
        p.lx = lx; p.ly = ly; p.led = Math.abs(ly - (p.cy + 3)) > 3.5;
        placed.push({ lx: lx, x2: lx + w, ly: ly });
      });
    return pts;
  }
  // Shared soft-glow filter for chart marks (dots, lines, nodes) — the neon-HUD signature.
  // Reused by id across every SVG chart on the page; duplicate <defs> with the same id are
  // harmless (identical filter), so each renderer can just prepend GLOW_DEFS to its own <svg>.
  var GLOW_DEFS = '<defs><filter id="wcGlow" x="-80%" y="-80%" width="260%" height="260%">' +
    '<feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
    "</filter></defs>";
  function chartLegend(items, note) {
    return '<div class="chart-legend">' + items.map(function (it) {
      return '<span class="cl-item"><span class="cl-sw" style="background:' + it[0] + '"></span>' + it[1] + "</span>";
    }).join("") + (note ? '<span class="cl-note">' + note + "</span>" : "") + "</div>";
  }
  /* One renderer for every team scatter in the xG lab. cfg:
     {x,y} accessors already applied (rows carry .x/.y/.col/.team); xLabel/yLabel; flipY
     (higher value plotted lower — used for "xG conceded"); avgX/avgY (dashed average lines);
     diagonal (dashed y=x reference); corners ([{h:'l'|'r',v:'t'|'b',text,color}]);
     legend (html appended under the chart). */
  function teamScatter(hostId, rows, cfg) {
    var host = document.getElementById(hostId);
    if (!host) return;
    if (!rows.length) { host.innerHTML = '<p class="hint">Not enough data yet.</p>'; return; }
    var W = 960, H = cfg.h || 560, padL = 58, padR = 14, padT = 24, padB = 50;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    // Floors default to 0 so the axis fits the data. Don't force a floor of 1 — for tiny
    // metrics like xG-per-shot (~0.1–0.3) that squashed every dot to the bottom.
    var xMax, yMax;
    if (cfg.centerAvg && cfg.avgX != null && cfg.avgY != null) {
      // Centre the avg lines: span each axis from 0 to avg + the farthest point's distance
      // from avg, so the avg intersection sits near the middle and there's no dead space —
      // without clipping outliers (the extreme dot lands exactly on the far edge).
      var dx = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.x - cfg.avgX); }));
      var dy = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.y - cfg.avgY); }));
      xMax = cfg.avgX + dx;
      yMax = cfg.avgY + dy;
    } else {
      xMax = niceMax(Math.max.apply(null, rows.map(function (r) { return r.x; }).concat([cfg.xMin || 0])) * 1.08);
      yMax = niceMax(Math.max.apply(null, rows.map(function (r) { return r.y; }).concat([cfg.yMin || 0])) * 1.08);
    }
    function sx(v) { return padL + (v / xMax) * plotW; }
    function sy(v) { return cfg.flipY ? padT + (v / yMax) * plotH : (padT + plotH) - (v / yMax) * plotH; }
    var svg = ['<svg viewBox="0 0 ' + W + " " + H + '" width="100%" class="scatter-svg">' + GLOW_DEFS];
    niceTicks(xMax).forEach(function (t) {
      var X = sx(t);
      svg.push('<line x1="' + X.toFixed(1) + '" y1="' + padT + '" x2="' + X.toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="#14152e" stroke-width="0.6"/>');
      svg.push('<text x="' + X.toFixed(1) + '" y="' + (padT + plotH + 16) + '" fill="#8b8fb8" font-size="10" text-anchor="middle">' + fmtTick(t) + "</text>");
    });
    niceTicks(yMax).forEach(function (t) {
      var Y = sy(t);
      svg.push('<line x1="' + padL + '" y1="' + Y.toFixed(1) + '" x2="' + (padL + plotW) + '" y2="' + Y.toFixed(1) + '" stroke="#14152e" stroke-width="0.6"/>');
      svg.push('<text x="' + (padL - 8) + '" y="' + (Y + 3).toFixed(1) + '" fill="#8b8fb8" font-size="10" text-anchor="end">' + fmtTick(t) + "</text>");
    });
    if (cfg.diagonal) {
      var lo = Math.min(xMax, yMax);
      svg.push('<line x1="' + sx(0) + '" y1="' + sy(0) + '" x2="' + sx(lo) + '" y2="' + sy(lo) + '" stroke="#8b8fb8" stroke-width="1.2" stroke-dasharray="5 4"/>');
      svg.push('<text x="' + (sx(lo) - 4).toFixed(1) + '" y="' + (sy(lo) - 6).toFixed(1) + '" fill="#8b8fb8" font-size="10" text-anchor="end">exactly deserved</text>');
    }
    if (cfg.avgX != null) {
      var AX = sx(cfg.avgX);
      svg.push('<line x1="' + AX.toFixed(1) + '" y1="' + padT + '" x2="' + AX.toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="#5a5f95" stroke-width="1" stroke-dasharray="4 4"/>');
      svg.push('<text x="' + (AX + 3).toFixed(1) + '" y="' + (padT + 11) + '" fill="#7a7fb0" font-size="9.5">avg</text>');
    }
    if (cfg.avgY != null) {
      var AY = sy(cfg.avgY);
      svg.push('<line x1="' + padL + '" y1="' + AY.toFixed(1) + '" x2="' + (padL + plotW) + '" y2="' + AY.toFixed(1) + '" stroke="#5a5f95" stroke-width="1" stroke-dasharray="4 4"/>');
      svg.push('<text x="' + (padL + plotW - 4) + '" y="' + (AY - 4).toFixed(1) + '" fill="#7a7fb0" font-size="9.5" text-anchor="end">avg</text>');
    }
    (cfg.corners || []).forEach(function (c) {
      var x = c.h === "l" ? padL + 8 : padL + plotW - 8, anc = c.h === "l" ? "start" : "end";
      var y = c.v === "t" ? padT + 14 : padT + plotH - 8;
      svg.push('<text x="' + x + '" y="' + y + '" fill="' + c.color + '" font-size="11" font-weight="700" text-anchor="' + anc + '" opacity="0.85">' + c.text + "</text>");
    });
    svg.push('<text x="' + (padL + plotW / 2) + '" y="' + (H - 6) + '" fill="#eef0fb" font-size="12.5" text-anchor="middle">' + cfg.xLabel + "</text>");
    svg.push('<text x="15" y="' + (padT + plotH / 2) + '" fill="#eef0fb" font-size="12.5" text-anchor="middle" transform="rotate(-90 15 ' + (padT + plotH / 2) + ')">' + cfg.yLabel + "</text>");
    rows.forEach(function (r) { r.cx = sx(r.x); r.cy = sy(r.y); });
    rows.forEach(function (r) {
      svg.push('<circle cx="' + r.cx.toFixed(1) + '" cy="' + r.cy.toFixed(1) + '" r="5" fill="' + r.col +
        '" fill-opacity="0.9" stroke="#050611" stroke-width="0.9" filter="url(#wcGlow)"><title>' + esc(r.team) + (cfg.tip ? " — " + cfg.tip(r) : "") + "</title></circle>");
    });
    declutter(rows, 8.7);
    rows.forEach(function (r) {
      if (r.led) svg.push('<line x1="' + r.cx.toFixed(1) + '" y1="' + r.cy.toFixed(1) + '" x2="' + (r.lx - 1).toFixed(1) + '" y2="' + (r.ly - 3).toFixed(1) + '" stroke="#33366e" stroke-width="0.6"/>');
      svg.push('<text x="' + r.lx.toFixed(1) + '" y="' + r.ly.toFixed(1) + '" fill="#d6d9f5" font-size="8.7">' + esc(r.team) + "</text>");
    });
    svg.push("</svg>");
    host.innerHTML = svg.join("") + (cfg.legend || "");
  }

  /* ---------------- Tabs ---------------- */
  var tabs = document.querySelectorAll("nav.tabs button");
  tabs.forEach(function (b) {
    b.addEventListener("click", function () {
      tabs.forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
      document.getElementById("view-" + b.dataset.view).classList.add("active");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  /* ---------------- Overview stats ---------------- */
  function renderOverviewStats() {
    var c = D.counts;
    var items = [
      ["v accent", c.played, "Matches played"],
      ["v", c.total - c.played, "Still to come"],
      ["v blue", c.teams, "Teams"],
      ["v", c.groups, "Groups"],
      ["v", c.with_xg, "Matches with xG"],
    ];
    var wrap = document.getElementById("overviewStats");
    items.forEach(function (it) {
      var s = el("div", "stat");
      s.innerHTML = '<div class="' + it[0] + '">' + it[1] + '</div><div class="k">' + it[2] + "</div>";
      wrap.appendChild(s);
    });
  }

  /* ---------------- Group tables ---------------- */
  function renderGroups() {
    var grid = document.getElementById("groupGrid");
    Object.keys(D.standings).forEach(function (letter) {
      var rows = D.standings[letter];
      var card = el("div", "group-card");
      var body = rows.map(function (r, i) {
        var cls = i === 0 ? "qual" : i === 1 ? "qual2" : "";
        return '<tr class="' + cls + '">' +
          '<td class="team"><div class="team-cell"><span class="pos">' + (i + 1) + "</span>" +
          logoImg(r.team) + '<span class="nm">' + esc(r.team) + "</span></div></td>" +
          "<td>" + r.P + "</td><td>" + r.W + "</td><td>" + r.D + "</td><td>" + r.L + "</td>" +
          "<td>" + r.GF + "</td><td>" + r.GA + "</td><td>" + (r.GD > 0 ? "+" + r.GD : r.GD) + "</td>" +
          '<td class="pts">' + r.Pts + "</td></tr>";
      }).join("");
      card.innerHTML =
        "<h3>Group <b>" + letter + "</b></h3>" +
        "<table><thead><tr><th class='team'>Team</th><th>P</th><th>W</th><th>D</th><th>L</th>" +
        "<th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>" + body + "</tbody></table>";
      grid.appendChild(card);
    });
  }

  /* ---------------- Matches (fixtures + results + full stats) ---------------- */
  var mSearch = document.getElementById("mSearch");
  var mStatus = document.getElementById("mStatus");

  function fmtDate(d) {
    if (!d) return "";
    var dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  /* ---- Knockout calendar resolution ----
     Knockout fixtures arrive in the data with slot codes for teams ("2A", "3ABCDF",
     "Winner EF 1"). Once the groups (and then earlier ties) are decided we can show the
     real — or possible — teams instead, and it updates by itself as results land:
       · R32 (groups done)  → the actual two teams ("South Africa vs Canada")
       · a side still waiting on one earlier tie → the two candidates ("South Africa / Canada")
       · a side waiting on a whole sub-bracket (3+ candidates) → the bracket placeholder
     Played-and-scraped knockout games already carry real names, so they pass straight through. */
  var STAGE_LABEL = { R32: "Round of 32", R16: "Round of 16", QF: "Quarter-final", SF: "Semi-final", F: "Final", TP: "Third place" };
  var _koInfo = null;
  function koInfo() {
    if (_koInfo) return _koInfo;
    var K = buildKnockout();
    _koInfo = { K: K, round: {} };
    if (K) ["R32", "R16", "QF", "SF", "F", "TP"].forEach(function (rd) {
      (K.rounds[rd] || []).forEach(function (m) { _koInfo.round[m.id] = rd; });
    });
    return _koInfo;
  }
  function koUniq(arr) { var s = {}, o = []; arr.forEach(function (t) { if (t && !s[t]) { s[t] = 1; o.push(t); } }); return o; }
  // Teams that can still emerge as the WINNER of match m.
  function koCands(K, m) {
    if (!m) return [];
    if (m.played && m.hs != null && m.as != null) {
      if (m.hs !== m.as) return [m.hs > m.as ? m.home : m.away];
      // level on goals -> decided on penalties; never assume the away team won
      if (m.hpen != null && m.apen != null && m.hpen !== m.apen) return [m.hpen > m.apen ? m.home : m.away];
      return [];
    }
    if (m._kids && m._kids.length === 2) return koUniq(koCands(K, m._kids[0]).concat(koCands(K, m._kids[1])));
    return koUniq(koSideCands(K, m, 0).concat(koSideCands(K, m, 1)));   // R32 leaf
  }
  function koSideCands(K, m, idx) {
    if (m.played && m.hs != null) return [idx === 0 ? m.home : m.away];
    if (m._kids && m._kids[idx]) return koCands(K, m._kids[idx]);
    var code = K.strip(m.id).split("_vs_")[idx], r = K.resolveSlot(code);
    if (r.team) return [r.team];
    var g2 = code.match(/^([12])([A-L])$/);
    if (g2) { var grp = D.standings && D.standings[g2[2]]; return grp ? grp.map(function (x) { return x.team; }) : []; }
    var g3 = code.match(/^3([A-L]{2,})$/);
    if (g3) return g3[1].split("").map(function (g) { var gr = D.standings && D.standings[g]; return gr && gr[2] ? gr[2].team : ("3" + g); });
    return [];
  }
  // Teams that can still emerge as the LOSER of match m — what a "Loser_SF_n" slot
  // (the third-place play-off) actually feeds on. A decided tie narrows to its beaten
  // side; an undecided one leaves everyone still alive in the tie as a possible loser.
  function koLoserCands(K, m) {
    if (!m) return [];
    if (m.played && m.hs != null && m.as != null) {
      if (m.hs !== m.as) return [m.hs > m.as ? m.away : m.home];
      if (m.hpen != null && m.apen != null && m.hpen !== m.apen) return [m.hpen > m.apen ? m.away : m.home];
      return [];
    }
    return koCands(K, m);   // unplayed: any remaining participant could lose it
  }
  // {team, label} for one side of a knockout fixture (team = null when not narrowed to one).
  function koSide(K, m, idx) {
    if (m.played && m.hs != null) { var t = idx === 0 ? m.home : m.away; return { team: t, label: t, possible: [t] }; }
    var rawSide = K.strip(m.id).split("_vs_")[idx];
    var poss;
    if (m._kids && m._kids[idx])
      // A "Loser_SF_n" side (third-place play-off) advances the BEATEN semi-finalist —
      // following koCands here would promote the winner into the bronze match.
      poss = /^Loser_/.test(rawSide) ? koLoserCands(K, m._kids[idx]) : koCands(K, m._kids[idx]);
    else {
      var code = K.strip(m.id).split("_vs_")[idx], r = K.resolveSlot(code);
      if (r.team) return { team: r.team, label: r.team, possible: [r.team] };
      poss = koSideCands(K, m, idx);
    }
    if (poss.length === 1) return { team: poss[0], label: poss[0], possible: poss };
    if (poss.length === 2) return { team: null, label: poss.join(" / "), possible: poss };
    var raw = K.strip(m.id).split("_vs_")[idx];
    var pretty = raw.replace(/^Winner_?/, "Winner ").replace(/EF_?(\d)/, "R16 #$1")
      .replace(/QF_?(\d)/, "QF #$1").replace(/SF_?(\d)/, "SF #$1").replace(/_/g, " ");
    return { team: null, label: pretty, possible: poss };
  }
  // Display shape for a calendar row: real/possible teams + stage tag + a search haystack.
  // `koUp` flags an upcoming knockout fixture → the calendar shows team BADGES (one for a
  // settled side, two for a side still down to two candidates) instead of plain names.
  function matchDisplay(m) {
    var ki = koInfo(), rd = ki.round[m.id];
    if (!rd || !ki.K || (m.played && m.hs != null))
      return { home: m.home, away: m.away, hTeam: m.home, aTeam: m.away, hPoss: [m.home], aPoss: [m.away],
               stage: rd ? STAGE_LABEL[rd] : "", koUp: false, hay: (m.home + " " + m.away).toLowerCase() };
    var h = koSide(ki.K, m, 0), a = koSide(ki.K, m, 1);
    return { home: h.label, away: a.label, hTeam: h.team, aTeam: a.team, hPoss: h.possible, aPoss: a.possible,
             stage: STAGE_LABEL[rd] || "", koUp: true,
             hay: (h.possible.concat(a.possible).join(" ") + " " + h.label + " " + a.label).toLowerCase() };
  }
  function isKnownTeam(t) { return t && D.teamGroup && Object.prototype.hasOwnProperty.call(D.teamGroup, t); }
  // Badge cluster for one knockout side: 1–2 known teams → badges (with names on hover),
  // anything still wider (a Winner-of placeholder) → the italic slot label.
  function koSideBadges(possible, label) {
    var known = (possible || []).filter(isKnownTeam);
    if (known.length >= 1 && known.length <= 2)
      return '<span class="cal-badges" title="' + esc(known.join(" / ")) + '">' +
        known.map(function (t) { return logoImg(t, "cal-badge"); }).join('<span class="bvs">/</span>') + "</span>";
    return '<span class="nm slot">' + esc(label) + "</span>";
  }

  function renderMatches() {
    var q = (mSearch.value || "").toLowerCase().trim();
    var mode = mStatus.value;
    var list = document.getElementById("matchList");
    list.innerHTML = "";

    var matches = D.matches.filter(function (m) {
      if (mode === "played" && !m.played) return false;
      if (mode === "upcoming" && m.played) return false;
      if (mode === "xg" && m.xg_home == null) return false;
      if (q && matchDisplay(m).hay.indexOf(q) < 0) return false;
      return true;
    });
    if (!matches.length) { list.appendChild(el("p", "footer-note", "No matches match your filter.")); return; }

    var byDay = {};
    matches.forEach(function (m) { (byDay[m.date] = byDay[m.date] || []).push(m); });

    Object.keys(byDay).sort().forEach(function (day) {
      var dayWrap = el("div", "match-day");
      dayWrap.appendChild(el("div", "day-label", fmtDate(day) || day));
      byDay[day].forEach(function (m) {
        var dsp = matchDisplay(m);
        var expandable = m.played && m.has_stats;
        var toCentre = m.has_events;            // has event data → open the full Match Centre on click
        var clickable = toCentre || expandable;
        // A drawn knockout tie is decided on penalties: the pen winner is the match
        // winner (mark their name) and the row shows the shootout score under the result.
        var pens = m.played && m.hs === m.as && m.hpen != null && m.apen != null;
        var hWin = m.played && (m.hs > m.as || (pens && m.hpen > m.apen));
        var aWin = m.played && (m.as > m.hs || (pens && m.apen > m.hpen));
        var score = m.played
          ? '<div class="score">' + m.hs + " – " + m.as +
              (pens ? '<span class="pens">' + m.hpen + "–" + m.apen + " pens</span>" : "") + "</div>"
          : '<div class="score upcoming">vs</div>';
        var links = [];
        // The whole played-match row opens the Match Centre now, so no separate link.
        // Prefer the dark infographic (matches the dark dashboard); fall back to light.
        var mpng = m.png_dark || m.png;
        if (mpng) links.push('<a class="open-match png" href="' + esc(mpng) +
          '" target="_blank" rel="noopener">PNG 🖼️</a>');
        var xgline = "";
        {
          // Show our model xG and FotMob xG separately (no longer the blended average).
          var xgparts = [];
          if (m.model_xg_home != null)
            xgparts.push('Model <b>' + m.model_xg_home.toFixed(2) + "</b>–<b>" + m.model_xg_away.toFixed(2) + "</b>");
          if (m.fot_xg_home != null)
            xgparts.push('FotMob <b>' + m.fot_xg_home.toFixed(2) + "</b>–<b>" + m.fot_xg_away.toFixed(2) + "</b>");
          xgline = xgparts.join(' <span class="xg-cmp">·</span> ');
        }
        var meta = (xgline || links.length)
          ? '<div class="xgline">' + xgline + (xgline && links.length ? " &nbsp;·&nbsp; " : "") + links.join(" ") + "</div>"
          : "";

        var row = el("div", "db-match" + (clickable ? "" : " noexp"));
        row.dataset.id = m.id;
        var headTitle = toCentre ? ' title="Open Match Centre"'
          : m.played ? "" : ' title="Not played yet — no data to show"';
        var stageChip = dsp.stage ? '<span class="ko-stage">' + esc(dsp.stage) + "</span>" : "";
        // Upcoming knockout fixtures show badges (settled or possible teams); everything else
        // keeps the familiar name + single badge.
        var homeSide = dsp.koUp
          ? koSideBadges(dsp.hPoss, dsp.home)
          : '<span class="nm' + (dsp.hTeam ? "" : " slot") + '" style="' + (hWin ? "color:var(--good)" : "") + '">' +
              esc(dsp.home) + "</span>" + (dsp.hTeam ? logoImg(dsp.hTeam) : "");
        var awaySide = dsp.koUp
          ? koSideBadges(dsp.aPoss, dsp.away)
          : (dsp.aTeam ? logoImg(dsp.aTeam) : "") + '<span class="nm' + (dsp.aTeam ? "" : " slot") + '" style="' +
              (aWin ? "color:var(--good)" : "") + '">' + esc(dsp.away) + "</span>";
        row.innerHTML =
          '<div class="db-match-head"' + headTitle + '>' +
            '<div class="side home">' + homeSide + "</div>" +
            score +
            '<div class="side away">' + awaySide + "</div>" +
            (toCentre ? '<div class="db-date">' + (fmtDate(m.date) || m.date) + ' <span class="chev nav">↗</span></div>'
              : expandable ? '<div class="db-date">' + (fmtDate(m.date) || m.date) + ' <span class="chev">▾</span></div>'
              : stageChip ? '<div class="db-date">' + stageChip + "</div>" : "") +
            meta +
          "</div>";
        dayWrap.appendChild(row);

        if (toCentre) {
          row.querySelector(".db-match-head").addEventListener("click", function (e) {
            if (e.target.closest("a.open-match")) return;   // let explicit links handle themselves
            window.location.href = matchUrl(m.id);
          });
        } else if (expandable) {
          row.querySelector(".db-match-head").addEventListener("click", function (e) {
            if (e.target.closest("a.open-match")) return;
            var open = row.classList.toggle("open");
            if (open && !row.querySelector(".stat-panel"))
              row.insertAdjacentHTML("beforeend", buildStatPanel(m));
          });
        }
      });
      list.appendChild(dayWrap);
    });
  }
  mSearch.addEventListener("input", renderMatches);
  mStatus.addEventListener("change", renderMatches);

  // Matches sub-mode toggle (list vs team totals)
  document.getElementById("mModeList").addEventListener("click", function () { setMMode("list"); });
  document.getElementById("mModeTeam").addEventListener("click", function () { setMMode("team"); });
  function setMMode(mode) {
    document.getElementById("mModeList").classList.toggle("active", mode === "list");
    document.getElementById("mModeTeam").classList.toggle("active", mode === "team");
    document.getElementById("mListView").style.display = mode === "list" ? "" : "none";
    document.getElementById("mTeamView").style.display = mode === "team" ? "" : "none";
  }

  /* ================= xG ANALYSIS ================= */
  var R = D.xgRecords; // one per team per match with xG

  function pearson(xs, ys) {
    var n = xs.length, sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
    for (var i = 0; i < n; i++) {
      sx += xs[i]; sy += ys[i]; sxy += xs[i] * ys[i]; sx2 += xs[i] * xs[i]; sy2 += ys[i] * ys[i];
    }
    var num = n * sxy - sx * sy;
    var den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
    return den === 0 ? 0 : num / den;
  }
  function linreg(xs, ys) {
    var n = xs.length, sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (var i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxy += xs[i] * ys[i]; sx2 += xs[i] * xs[i]; }
    var slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
    var intercept = (sy - slope * sx) / n;
    return { slope: slope, intercept: intercept };
  }

  var xgVals = R.map(function (r) { return r.xgf; });
  var goalVals = R.map(function (r) { return r.gf; });
  var rPearson = R.length ? pearson(xgVals, goalVals) : 0;
  var fit = R.length ? linreg(xgVals, goalVals) : { slope: 0, intercept: 0 };

  function renderXgStats() {
    var totalGoals = goalVals.reduce(function (a, b) { return a + b; }, 0);
    var totalXg = xgVals.reduce(function (a, b) { return a + b; }, 0);
    var ratio = totalXg ? totalGoals / totalXg : 0;
    var items = [
      ["v accent", rPearson.toFixed(2), "xG↔Goals correlation (r)"],
      ["v blue", totalGoals + " / " + totalXg.toFixed(1), "Goals vs xG (total)"],
      ["v", (ratio * 100).toFixed(0) + "%", "Conversion vs expected"],
      ["v", R.length, "Team-matches analysed"],
    ];
    var wrap = document.getElementById("xgStats");
    items.forEach(function (it) {
      var s = el("div", "stat");
      s.innerHTML = '<div class="' + it[0] + '">' + it[1] + '</div><div class="k">' + it[2] + "</div>";
      wrap.appendChild(s);
    });
    wrap.insertAdjacentHTML("afterend", '<p class="hint" style="margin-top:8px">Avg. match duration (incl. stoppage time): ~97 min across 54 matches played.</p>');
  }

  /* Scatter plot (hand-rolled SVG) */
  function renderScatter() {
    var W = 560, H = 420, pad = 46;
    var maxX = Math.max(5, Math.ceil(Math.max.apply(null, xgVals.concat([1]))));
    var maxY = Math.max(5, Math.ceil(Math.max.apply(null, goalVals.concat([1]))));
    var maxV = Math.max(maxX, maxY);
    function sx(v) { return pad + (v / maxV) * (W - pad - 14); }
    function sy(v) { return H - pad - (v / maxV) * (H - pad - 14); }

    var svg = ['<svg viewBox="0 0 ' + W + " " + H + '" width="100%" class="scatter-svg">' + GLOW_DEFS];
    // grid + axes
    for (var g = 0; g <= maxV; g++) {
      svg.push('<line x1="' + sx(g) + '" y1="' + sy(0) + '" x2="' + sx(g) + '" y2="' + sy(maxV) +
        '" stroke="#262c52" stroke-width="' + (g === 0 ? 1.4 : 0.5) + '"/>');
      svg.push('<line x1="' + sx(0) + '" y1="' + sy(g) + '" x2="' + sx(maxV) + '" y2="' + sy(g) +
        '" stroke="#262c52" stroke-width="' + (g === 0 ? 1.4 : 0.5) + '"/>');
      svg.push('<text x="' + sx(g) + '" y="' + (sy(0) + 16) + '" fill="#8b8fb8" font-size="10" text-anchor="middle">' + g + "</text>");
      if (g > 0) svg.push('<text x="' + (sx(0) - 8) + '" y="' + (sy(g) + 3) + '" fill="#8b8fb8" font-size="10" text-anchor="end">' + g + "</text>");
    }
    // y=x perfect-finishing reference
    svg.push('<line x1="' + sx(0) + '" y1="' + sy(0) + '" x2="' + sx(maxV) + '" y2="' + sy(maxV) +
      '" stroke="#8b8fb8" stroke-width="1.2" stroke-dasharray="5 4"/>');
    // regression line
    var x0 = 0, x1 = maxV;
    svg.push('<line x1="' + sx(x0) + '" y1="' + sy(fit.intercept) + '" x2="' + sx(x1) + '" y2="' +
      sy(fit.slope * x1 + fit.intercept) + '" stroke="#33e893" stroke-width="2"/>');
    // axis labels
    svg.push('<text x="' + (W / 2) + '" y="' + (H - 6) + '" fill="#eef0fb" font-size="12" text-anchor="middle">Expected goals (xG)</text>');
    svg.push('<text x="14" y="' + (H / 2) + '" fill="#eef0fb" font-size="12" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')">Actual goals</text>');
    // points (jitter identical points slightly so they don't fully overlap)
    R.forEach(function (r, i) {
      var jx = ((i * 7) % 5 - 2) * 1.2, jy = ((i * 3) % 5 - 2) * 1.2;
      var cx = sx(r.xgf) + jx, cy = sy(r.gf) + jy;
      var over = r.gf - r.xgf;
      var col = over > 0.4 ? "#33e893" : over < -0.4 ? "#ff5c7a" : "#9d6bff";
      svg.push('<circle class="pt" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) +
        '" r="5.5" fill="' + col + '" fill-opacity="0.78" stroke="#050611" stroke-width="1" ' +
        'data-team="' + esc(r.team) + '" data-opp="' + esc(r.opp) + '" data-g="' + r.gf +
        '" data-xg="' + r.xgf.toFixed(2) + '"/>');
    });
    svg.push("</svg>");
    var host = document.getElementById("scatter");
    host.innerHTML = svg.join("");

    host.querySelectorAll("circle.pt").forEach(function (c) {
      c.addEventListener("mousemove", function (e) {
        tooltip.innerHTML = '<div class="t-team">' + c.dataset.team + " vs " + c.dataset.opp + "</div>" +
          '<div class="t-line">Goals: ' + c.dataset.g + " · xG: " + c.dataset.xg + "</div>";
        tooltip.style.opacity = "1";
        tooltip.style.left = (e.clientX + 14) + "px";
        tooltip.style.top = (e.clientY + 14) + "px";
      });
      c.addEventListener("mouseleave", function () { tooltip.style.opacity = "0"; });
    });
  }

  // Distribution companion to the scatter: bucket every team-game by its xG and
  // show how many games landed in each bucket + whether those chances converted
  // (avg goals vs avg xG per bucket — green over-delivered, red under, blue ≈ even).
  function renderXgDist() {
    var host = document.getElementById("xgDist");
    if (!host) return;
    if (!R.length) { host.innerHTML = '<p class="hint">Not enough data yet.</p>'; return; }
    var BW = 0.5, NB = 9;                      // eight half-goal buckets + a "4+" catch-all
    var buckets = [];
    for (var b = 0; b < NB; b++) buckets.push({ n: 0, xg: 0, g: 0 });
    R.forEach(function (r) {
      var i = Math.min(Math.floor(r.xgf / BW), NB - 1);
      buckets[i].n++; buckets[i].xg += r.xgf; buckets[i].g += r.gf;
    });
    var maxN = Math.max.apply(null, buckets.map(function (bk) { return bk.n; }).concat([1]));
    var W = 560, H = 300, padL = 14, padB = 44, padT = 26;
    var slot = (W - padL - 12) / NB, bw = slot - 8;
    function by(n) { return H - padB - (n / maxN) * (H - padB - padT); }
    var svg = ['<svg viewBox="0 0 ' + W + " " + H + '" width="100%" class="scatter-svg">' + GLOW_DEFS];
    svg.push('<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - 8) + '" y2="' + (H - padB) + '" stroke="#262c52" stroke-width="1.2"/>');
    buckets.forEach(function (bk, i) {
      var x = padL + i * slot + 4;
      var lab = (i === NB - 1) ? (BW * (NB - 1)).toFixed(1) + "+" : (BW * i).toFixed(1) + "–" + (BW * (i + 1)).toFixed(1);
      svg.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - padB + 14) + '" fill="#8b8fb8" font-size="9.5" text-anchor="middle">' + lab + "</text>");
      if (!bk.n) return;
      var ax = bk.xg / bk.n, ag = bk.g / bk.n, d = ag - ax;
      var col = d > 0.15 ? "#33e893" : d < -0.15 ? "#ff5c7a" : "#9d6bff";
      var y = by(bk.n);
      var info = lab + " xG · " + bk.n + " team-games · avg xG " + ax.toFixed(2) + " → avg goals " + ag.toFixed(2) +
                 " (" + (d >= 0 ? "+" : "") + d.toFixed(2) + ")";
      svg.push('<rect class="xd" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) +
        '" height="' + (H - padB - y).toFixed(1) + '" rx="4" fill="' + col + '" fill-opacity="0.55" stroke="' + col +
        '" stroke-width="1" data-info="' + esc(info) + '"/>');
      svg.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" fill="#eef0fb" font-size="11" font-weight="700" text-anchor="middle">' + bk.n + "</text>");
      svg.push('<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - padB + 27) + '" fill="' + col + '" font-size="9.5" text-anchor="middle">' + ax.toFixed(1) + "→" + ag.toFixed(1) + "</text>");
    });
    svg.push('<text x="' + (W / 2) + '" y="' + (H - 3) + '" fill="#8b8fb8" font-size="11" text-anchor="middle">xG created in the game · below each bar: avg xG → avg goals actually scored</text>');
    svg.push("</svg>");
    host.innerHTML = svg.join("");
    host.querySelectorAll("rect.xd").forEach(function (c) {
      c.addEventListener("mousemove", function (e) {
        tooltip.innerHTML = '<div class="t-line">' + c.getAttribute("data-info") + "</div>";
        tooltip.style.opacity = "1";
        tooltip.style.left = (e.clientX + 14) + "px";
        tooltip.style.top = (e.clientY + 14) + "px";
      });
      c.addEventListener("mouseleave", function () { tooltip.style.opacity = "0"; });
    });
  }

  function renderCorr() {
    var rr = rPearson;
    var r2 = rr * rr;
    var strength = rr > 0.75 ? "strong" : rr > 0.5 ? "moderate" : rr > 0.3 ? "modest" : "weak";
    // 0 = no relationship, 1 = goals follow xG perfectly
    var scalePct = Math.max(0, Math.min(100, rr * 100));
    document.getElementById("corrBox").innerHTML =
      '<div class="r-row"><span class="r-big">' + rr.toFixed(2) + '</span><span class="lab">link strength (0 = none, 1 = perfect) — <b>' + strength + '</b></span></div>' +
      '<div class="corr-scale"><div class="corr-scale-fill" style="width:' + scalePct.toFixed(0) + '%"></div></div>' +
      '<div class="r-row" style="margin-top:12px"><span style="font-size:22px;font-weight:800;color:var(--accent-2)">' +
        (r2 * 100).toFixed(0) + '%</span><span class="lab">of the difference in goals is explained by chance quality (xG). The rest is finishing skill, goalkeeping &amp; luck.</span></div>' +
      '<div class="r-row"><span style="font-size:18px;font-weight:700">' + fit.slope.toFixed(2) +
        '</span><span class="lab">goals scored, on average, for every 1.0 xG of chances created</span></div>';
    document.getElementById("corrInsight").innerHTML =
      "In plain terms: across the <b>" + R.length + "</b> team-performances measured so far, teams that created better " +
      "chances did tend to score more — a <b>" + strength + "</b> relationship. But it's far from one-to-one, which is " +
      "exactly why upsets happen: on any given day finishing and luck can override who created the better chances. " +
      "Each 1.0 xG has turned into about <b>" + fit.slope.toFixed(2) + " goals</b>, so teams are finishing slightly <b>" +
      (fit.slope < 1 ? "below" : "above") + "</b> their chances overall.";
  }

  /* Aggregate per team for finishing & ledger */
  function teamAggregates() {
    var t = {};
    R.forEach(function (r) {
      var a = t[r.team] || (t[r.team] = { team: r.team, gf: 0, ga: 0, xgf: 0, xga: 0, n: 0 });
      a.gf += r.gf; a.ga += r.ga; a.xgf += r.xgf; a.xga += r.xga; a.n++;
    });
    return Object.keys(t).map(function (k) {
      var a = t[k];
      a.attDelta = a.gf - a.xgf;       // finishing: + = clinical
      a.defDelta = a.xga - a.ga;       // defence/keeping: + = conceded fewer than expected
      a.xgd = a.xgf - a.xga;           // deserved margin
      return a;
    });
  }
  var AGG = teamAggregates();

  /* Attack vs defence quadrant: xG created/game (x) vs xG conceded/game (y, better up).
     Dots coloured by which quadrant a team falls in, with a legend + corner labels. */
  var COL = { green: "#33e893", blue: "#9d6bff", orange: "#ffc857", red: "#ff5c7a" };
  function renderQuadrant() {
    var src = AGG.filter(function (a) { return a.n > 0; });
    if (!src.length) return;
    var avgF = src.reduce(function (s, a) { return s + a.xgf / a.n; }, 0) / src.length;
    var avgA = src.reduce(function (s, a) { return s + a.xga / a.n; }, 0) / src.length;
    var rows = src.map(function (a) {
      var fwd = a.xgf / a.n, def = a.xga / a.n;
      var attGood = fwd >= avgF, defGood = def <= avgA;
      var col = attGood && defGood ? COL.green : !attGood && defGood ? COL.blue : attGood && !defGood ? COL.orange : COL.red;
      return { team: a.team, x: fwd, y: def, col: col, _f: fwd, _d: def };
    });
    teamScatter("quadrant", rows, {
      h: 580, flipY: true, avgX: avgF, avgY: avgA,
      xLabel: "xG created per game  →  (more dangerous attack)",
      yLabel: "xG conceded per game  (higher up = meaner defence)",
      corners: [
        { h: "r", v: "t", text: "Strong both ends ↗", color: COL.green },
        { h: "l", v: "t", text: "↖ Defence-first", color: COL.blue },
        { h: "r", v: "b", text: "All-out attack ↘", color: COL.orange },
        { h: "l", v: "b", text: "↙ Struggling", color: COL.red }
      ],
      tip: function (r) { return "create " + r._f.toFixed(2) + " / concede " + r._d.toFixed(2) + " xG per game"; },
      legend: chartLegend([
        [COL.green, "Strong both ends — good attack &amp; mean defence"],
        [COL.blue, "Defence-first — solid at the back, blunt up front"],
        [COL.orange, "All-out attack — dangerous but leaky"],
        [COL.red, "Struggling — out-created at both ends"]
      ], "Dashed lines mark the tournament average for each axis.")
    });
  }

  /* Expected points (Poisson on match xG) vs actual points */
  function poisson(k, lam) {
    var f = 1; for (var i = 2; i <= k; i++) f *= i;
    return Math.exp(-lam) * Math.pow(lam, k) / f;
  }
  function matchXpts(lh, la) {
    var pw = 0, pd = 0, pl = 0;
    for (var i = 0; i <= 8; i++) for (var j = 0; j <= 8; j++) {
      var p = poisson(i, lh) * poisson(j, la);
      if (i > j) pw += p; else if (i === j) pd += p; else pl += p;
    }
    return [3 * pw + pd, 3 * pl + pd]; // [home xPts, away xPts]
  }
  function teamPoints() {
    var t = {};
    function g(n) { return t[n] || (t[n] = { team: n, pts: 0, xpts: 0, n: 0 }); }
    D.matches.forEach(function (m) {
      if (!m.played || m.xg_home == null) return;
      var H = g(m.home), A = g(m.away);
      H.n++; A.n++;
      H.pts += m.hs > m.as ? 3 : m.hs === m.as ? 1 : 0;
      A.pts += m.as > m.hs ? 3 : m.hs === m.as ? 1 : 0;
      var xp = matchXpts(m.xg_home, m.xg_away);
      H.xpts += xp[0]; A.xpts += xp[1];
    });
    return Object.keys(t).map(function (k) { return t[k]; });
  }
  function renderXpts() {
    var src = teamPoints();
    if (!src.length) return;
    var rows = src.map(function (r) {
      var d = r.pts - r.xpts;
      var col = d > 0.5 ? COL.green : d < -0.5 ? COL.red : COL.blue;
      return { team: r.team, x: r.xpts, y: r.pts, col: col, _d: d };
    });
    teamScatter("xpts", rows, {
      h: 560, diagonal: true,
      xLabel: "Expected points from xG  →  (what the chances were worth)",
      yLabel: "Actual points won",
      tip: function (r) { return r.y + " pts vs " + r.x.toFixed(1) + " deserved (" + (r._d >= 0 ? "+" : "") + r._d.toFixed(1) + ")"; },
      legend: chartLegend([
        [COL.green, "Over-performing — more points than the chances deserved (clinical or lucky)"],
        [COL.blue, "About right — points roughly match performances"],
        [COL.red, "Under-performing — fewer points than deserved (wasteful or unlucky)"]
      ], "Dashed line = got exactly the points the xG says they earned. Above it = lucky, below = unlucky.")
    });
    var rr = src.slice().sort(function (a, b) { return (b.pts - b.xpts) - (a.pts - a.xpts); });
    var lucky = rr[0], unlucky = rr[rr.length - 1];
    document.getElementById("xptsInsight").innerHTML =
      "Biggest over-achiever so far: <b>" + esc(lucky.team) + "</b> (+" + (lucky.pts - lucky.xpts).toFixed(1) +
      " pts vs expected). Most unlucky: <b>" + esc(unlucky.team) + "</b> (" + (unlucky.pts - unlucky.xpts).toFixed(1) +
      "). Expected points come from a Poisson model on each match's xG.";
  }

  /* Player leaderboards (Players tab) */
  function renderPlayerBoards() {
    var host = document.getElementById("playerBoards");
    if (!host || !PLAYERS.length) return;
    function rows(list, valFn, subFn, cls) {
      var html = list.slice(0, 8).map(function (p) {
        return '<div class="fin-row"><div class="nm">' + logoImg(p.team) + "<span>" + esc(p.name) +
          '</span></div><div class="fin-stat">' + (subFn ? '<span class="sub">' + subFn(p) + "</span>" : "") +
          '<span class="lb-val ' + (cls || "") + '">' + valFn(p) + "</span></div></div>";
      }).join("");
      return html || '<p class="hint">Not enough data yet.</p>';
    }
    function card(title, hint, body) {
      return '<div class="card lboard"><h3>' + title + '</h3><p class="hint">' + hint + "</p>" + body + "</div>";
    }
    function desc(key) {
      return PLAYERS.slice().filter(function (p) { return p[key] != null; })
        .sort(function (a, b) { return b[key] - a[key]; });
    }
    var fin = PLAYERS.filter(function (p) { return p.xg >= 1.0; });
    var rated = PLAYERS.filter(function (p) { return p.mp >= 2 && p.rating != null; })
      .sort(function (a, b) { return b.rating - a.rating; });
    var xgSub = function (p) { return p.g + "G vs " + p.xg.toFixed(2) + " xG"; };
    var shooters = PLAYERS.filter(function (p) { return p.shots >= 3; })
      .map(function (p) { return Object.assign({}, p, { conv: Math.round(p.g / p.shots * 100) }); })
      .sort(function (a, b) { return b.conv - a.conv; });
    var goalsPer90 = PLAYERS.filter(function (p) { return p.mins >= 90 && p.g > 0; })
      .map(function (p) { return Object.assign({}, p, { gp90: p.g / p.mins * 90 }); })
      .sort(function (a, b) { return b.gp90 - a.gp90; });
    var dribblers = PLAYERS.filter(function (p) { return p.mins >= 90 && p.dribbles > 0; })
      .map(function (p) { return Object.assign({}, p, { dp90: p.dribbles / p.mins * 90 }); })
      .sort(function (a, b) { return b.dp90 - a.dp90; });
    var chancesPer90 = PLAYERS.filter(function (p) { return p.mins >= 90 && p.keyPasses > 0; })
      .map(function (p) { return Object.assign({}, p, { kpp90: p.keyPasses / p.mins * 90 }); })
      .sort(function (a, b) { return b.kpp90 - a.kpp90; });
    var passersPer90 = PLAYERS.filter(function (p) { return p.mins >= 90 && p.passes > 0; })
      .map(function (p) { return Object.assign({}, p, { pp90: p.passes / p.mins * 90 }); })
      .sort(function (a, b) { return b.pp90 - a.pp90; });
    var tacklersPer90 = PLAYERS.filter(function (p) { return p.mins >= 90 && p.tackles > 0; })
      .map(function (p) { return Object.assign({}, p, { tp90: p.tackles / p.mins * 90 }); })
      .sort(function (a, b) { return b.tp90 - a.tp90; });
    var boards = [
      card("Top scorers", "Goals scored.", rows(desc("g"), function (p) { return p.g; }, function (p) { return p.team; })),
      card("Goals per 90'", "Goals per 90 minutes, min. 90 mins played.",
        rows(goalsPer90, function (p) { return p.gp90.toFixed(2); }, function (p) { return p.team; })),
      card("Dribbles per 90'", "Successful dribbles per 90 minutes, min. 90 mins played.",
        rows(dribblers, function (p) { return p.dp90.toFixed(1); }, function (p) { return p.dribbles + " total"; })),
      card("Best shot conversion", "Goals per shot %, min. 3 attempts.",
        rows(shooters, function (p) { return p.conv + "%"; }, function (p) { return p.g + "G / " + p.shots + " shots"; })),
      card("Most assists", "Assists provided.", rows(desc("a"), function (p) { return p.a; }, function (p) { return p.team; })),
      card("Goal involvements", "Goals + assists combined.", rows(desc("ga"), function (p) { return p.ga; }, function (p) { return p.g + "G " + p.a + "A"; })),
      card("Highest average rating", "Match rating, min. 2 games.", rows(rated, function (p) { return p.rating.toFixed(2); }, function (p) { return p.mp + " gms"; })),
      card("Most clinical finishers", "Goals above shot xG (min. 1.0 xG faced).",
        rows(fin.slice().sort(function (a, b) { return b.xg_diff - a.xg_diff; }),
          function (p) { return (p.xg_diff > 0 ? "+" : "") + p.xg_diff.toFixed(2); }, xgSub, "pos")),
      card("Wasteful in front of goal", "Goals below shot xG (min. 1.0 xG faced).",
        rows(fin.slice().sort(function (a, b) { return a.xg_diff - b.xg_diff; }),
          function (p) { return p.xg_diff.toFixed(2); }, xgSub, "neg")),
      card("Chances created per 90'", "Key passes per 90 minutes, min. 90 mins played.",
        rows(chancesPer90, function (p) { return p.kpp90.toFixed(2); }, function (p) { return p.keyPasses + " total"; })),
      card("Most shots on target", "Shots that hit the target.", rows(desc("sot"), function (p) { return p.sot; }, function (p) { return p.shots + " shots"; })),
      card("Most shots taken", "Total attempts.", rows(desc("shots"), function (p) { return p.shots; }, function (p) { return p.team; })),
      card("Passes per 90'", "Passes completed per 90 minutes, min. 90 mins played.",
        rows(passersPer90, function (p) { return Math.round(p.pp90); }, function (p) { return p.pass_pct + "%"; })),
      card("Tackles per 90'", "Tackles per 90 minutes, min. 90 mins played.",
        rows(tacklersPer90, function (p) { return p.tp90.toFixed(1); }, function (p) { return p.team; })),
    ];
    host.innerHTML = boards.join("");
  }

  /* Shot quality vs volume per team (needs shot counts from match stats) */
  function teamShotAgg() {
    var t = {};
    function g(n) { return t[n] || (t[n] = { team: n, shots: 0, xg: 0, n: 0 }); }
    D.matches.forEach(function (m) {
      if (!m.played || !m.has_stats) return;
      var s = m.stats;
      if (s.shots[0] == null) return;
      var H = g(m.home), A = g(m.away);
      H.shots += s.shots[0] || 0; H.xg += s.xg[0] || 0; H.n++;
      A.shots += s.shots[1] || 0; A.xg += s.xg[1] || 0; A.n++;
    });
    return Object.keys(t).map(function (k) { return t[k]; }).filter(function (r) { return r.shots > 0; });
  }
  function renderShotQuality() {
    var src = teamShotAgg();
    if (!src.length) return;
    src.forEach(function (r) { r.spg = r.shots / r.n; r.xgPerShot = r.xg / r.shots; });
    var avgX = src.reduce(function (s, r) { return s + r.spg; }, 0) / src.length;
    var avgY = src.reduce(function (s, r) { return s + r.xgPerShot; }, 0) / src.length;
    var rows = src.map(function (r) {
      var hiVol = r.spg >= avgX, hiQual = r.xgPerShot >= avgY;
      var col = hiVol && hiQual ? COL.green : !hiVol && hiQual ? COL.blue : hiVol && !hiQual ? COL.orange : COL.red;
      return { team: r.team, x: r.spg, y: r.xgPerShot, col: col, _s: r.spg, _q: r.xgPerShot };
    });
    teamScatter("shotquality", rows, {
      h: 560, avgX: avgX, avgY: avgY, centerAvg: true,
      xLabel: "Shots per game  →  (volume)",
      yLabel: "xG per shot  (chance quality)",
      corners: [
        { h: "r", v: "t", text: "Lots of great chances ↗", color: COL.green },
        { h: "l", v: "t", text: "↖ Few but excellent", color: COL.blue },
        { h: "r", v: "b", text: "High volume, long-range ↘", color: COL.orange },
        { h: "l", v: "b", text: "↙ Creating little", color: COL.red }
      ],
      tip: function (r) { return r._s.toFixed(1) + " shots/game · " + r._q.toFixed(2) + " xG per shot"; },
      legend: chartLegend([
        [COL.green, "Lots of high-quality chances — volume + quality"],
        [COL.blue, "Fewer but excellent looks — picky, high quality"],
        [COL.orange, "High volume, lower quality — lots of long-range shots"],
        [COL.red, "Creating little — low volume and low quality"]
      ], "Dashed lines mark the tournament average for each axis.")
    });
  }

  /* Home vs away xG */
  function renderHomeAway() {
    var h = R.filter(function (r) { return r.home; }), a = R.filter(function (r) { return !r.home; });
    if (!h.length || !a.length) return;
    function avg(arr, k) { return arr.reduce(function (s, r) { return s + r[k]; }, 0) / arr.length; }
    var hx = avg(h, "xgf"), ax = avg(a, "xgf");
    var hg = avg(h, "gf"), ag = avg(a, "gf");
    var mx = Math.max(hx, ax) * 1.15;
    function bar(label, hv, av) {
      return '<div style="margin-bottom:14px"><div style="font-size:12px;color:var(--muted);margin-bottom:5px">' + label + "</div>" +
        '<div class="ha-row"><span class="ha-lab">Home</span><div class="ha-track"><div class="ha-fill" style="width:' + (100 * hv / mx).toFixed(1) + '%;background:var(--accent)"></div></div><b>' + hv.toFixed(2) + "</b></div>" +
        '<div class="ha-row"><span class="ha-lab">Away</span><div class="ha-track"><div class="ha-fill" style="width:' + (100 * av / mx).toFixed(1) + '%;background:var(--accent-2)"></div></div><b>' + av.toFixed(2) + "</b></div></div>";
    }
    var diff = ((hx - ax) >= 0 ? "+" : "") + (hx - ax).toFixed(2);
    document.getElementById("homeAway").innerHTML =
      bar("Average xG created per game", hx, ax) +
      bar("Average goals scored per game", hg, ag) +
      '<div class="insight">Home teams create <b>' + diff + ' xG</b> more per game than away teams across ' +
      h.length + " home and " + a.length + " away team-matches.</div>";
  }

  /* Unluckiest: out-created the opponent by the most xG but did NOT win */
  function renderUnlucky() {
    var host = document.getElementById("unlucky");
    if (!host) return;
    var rows = D.matches.filter(function (m) { return m.played && m.xg_home != null; }).map(function (m) {
      var hWon = m.hs > m.as, aWon = m.as > m.hs;
      var adv = 0, who = "";
      // the side with more xG that failed to win
      if (m.xg_home > m.xg_away && !hWon) { adv = m.xg_home - m.xg_away; who = m.home; }
      else if (m.xg_away > m.xg_home && !aWon) { adv = m.xg_away - m.xg_home; who = m.away; }
      return { m: m, adv: adv, who: who };
    }).filter(function (x) { return x.adv > 0; })
      .sort(function (a, b) { return b.adv - a.adv; }).slice(0, 10);
    if (!rows.length) { host.innerHTML = '<p class="hint">No unlucky results yet.</p>'; return; }
    var html = '<table class="rank"><thead><tr><th class="team">Match</th><th>Result</th><th>xG</th>' +
      '<th class="team">Deserved more</th><th>xG edge</th></tr></thead><tbody>';
    html += rows.map(function (x) {
      var m = x.m;
      return "<tr><td class='team'>" + esc(m.home) + " v " + esc(m.away) + "</td>" +
        "<td>" + m.hs + "–" + m.as + "</td><td>" + m.xg_home.toFixed(2) + "–" + m.xg_away.toFixed(2) + "</td>" +
        "<td class='team'>" + esc(x.who) + "</td>" +
        "<td><span class='delta pos'>+" + x.adv.toFixed(2) + "</span></td></tr>";
    }).join("");
    html += "</tbody></table>";
    host.innerHTML = html;
  }

  function renderFinishingBars() {
    var rows = AGG.slice().sort(function (a, b) { return b.attDelta - a.attDelta; });
    var maxAbs = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.attDelta); }).concat([1]));
    var host = document.getElementById("finishingBars");
    host.innerHTML = rows.map(function (r) {
      var d = r.attDelta, pct = (Math.abs(d) / maxAbs) * 50;
      var fill = d >= 0
        ? '<div class="bar-fill pos" style="width:' + pct.toFixed(1) + '%"></div>'
        : '<div class="bar-fill neg" style="width:' + pct.toFixed(1) + '%"></div>';
      return '<div class="bar-row"><div class="nm">' + logoImg(r.team) + "<span>" + esc(r.team) +
        '</span></div><div class="bar-track"><div class="bar-mid"></div>' + fill + "</div>" +
        '<div class="bar-val ' + (d >= 0 ? "pos" : "neg") + '">' + (d >= 0 ? "+" : "") + d.toFixed(2) + "</div></div>";
    }).join("");
  }

  /* Sortable ledger table */
  var ledgerSort = { key: "xgd", dir: -1 };
  function renderLedger() {
    var cols = [
      ["team", "Team", false],
      ["n", "MP", true],
      ["gf", "G", true],
      ["xgf", "xG", true],
      ["attDelta", "G−xG", true],
      ["ga", "GA", true],
      ["xga", "xGA", true],
      ["defDelta", "xGA−GA", true],
      ["xgd", "xGD", true],
    ];
    var rows = AGG.slice().sort(function (a, b) {
      var k = ledgerSort.key;
      if (k === "team") return ledgerSort.dir * a.team.localeCompare(b.team);
      return ledgerSort.dir * (a[k] - b[k]);
    });
    function num(v) { return (typeof v === "number") ? (Math.abs(v) < 100 ? v.toFixed(2) : v) : v; }
    var head = cols.map(function (c) {
      var arr = ledgerSort.key === c[0] ? (ledgerSort.dir < 0 ? " ▼" : " ▲") : "";
      return '<th class="' + (c[0] === "team" ? "team" : "") + '" data-k="' + c[0] + '">' +
        c[1] + '<span class="arr">' + arr + "</span></th>";
    }).join("");
    var body = rows.map(function (r) {
      function cell(k) {
        if (k === "team") return '<td class="team"><div class="team-cell">' + logoImg(r.team) +
          '<span class="nm">' + esc(r.team) + "</span></div></td>";
        if (k === "n" || k === "gf" || k === "ga") return "<td>" + r[k] + "</td>";
        if (k === "xgf" || k === "xga") return "<td>" + r[k].toFixed(2) + "</td>";
        if (k === "attDelta" || k === "defDelta" || k === "xgd") {
          var v = r[k], cls = v > 0.05 ? "pos" : v < -0.05 ? "neg" : "";
          return '<td><span class="delta ' + cls + '">' + (v >= 0 ? "+" : "") + v.toFixed(2) + "</span></td>";
        }
        return "<td>" + r[k] + "</td>";
      }
      return "<tr>" + cols.map(function (c) { return cell(c[0]); }).join("") + "</tr>";
    }).join("");
    document.getElementById("ledger").innerHTML =
      '<table class="rank"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table>";
    document.querySelectorAll("#ledger th").forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.dataset.k;
        if (ledgerSort.key === k) ledgerSort.dir *= -1;
        else { ledgerSort.key = k; ledgerSort.dir = k === "team" ? 1 : -1; }
        renderLedger();
      });
    });
  }

  /* xG winner vs actual winner agreement */
  function renderAgreement() {
    var matches = D.matches.filter(function (m) { return m.played && m.xg_home != null; });
    var agree = 0, total = matches.length, draws = 0;
    var rows = matches.map(function (m) {
      var xgWin = m.xg_home > m.xg_away ? "H" : m.xg_home < m.xg_away ? "A" : "D";
      var actWin = m.hs > m.as ? "H" : m.hs < m.as ? "A" : "D";
      var ok = xgWin === actWin;
      if (ok) agree++;
      if (actWin === "D") draws++;
      var xgName = xgWin === "H" ? m.home : xgWin === "A" ? m.away : "Even";
      return { m: m, ok: ok, xgName: xgName, xgWin: xgWin, actWin: actWin };
    });
    var pct = total ? Math.round((agree / total) * 100) : 0;
    var html = '<div class="stats-strip" style="margin-bottom:16px">' +
      '<div class="stat"><div class="v accent">' + pct + '%</div><div class="k">xG winner = actual result</div></div>' +
      '<div class="stat"><div class="v">' + agree + " / " + total + '</div><div class="k">matches in agreement</div></div>' +
      '<div class="stat"><div class="v blue">' + draws + '</div><div class="k">actual draws (hard for xG)</div></div></div>';
    html += '<table class="rank"><thead><tr><th class="team">Match</th><th class="team">xG favoured</th>' +
      "<th>xG</th><th>Result</th><th>Match</th></tr></thead><tbody>";
    html += rows.map(function (x) {
      var m = x.m;
      var mark = x.ok ? '<span style="color:var(--good)">✔ matched</span>' : '<span style="color:var(--bad)">✘ upset</span>';
      return "<tr><td class='team'>" + esc(m.home) + " v " + esc(m.away) + "</td>" +
        "<td class='team'>" + esc(x.xgName) + "</td>" +
        "<td>" + m.xg_home.toFixed(2) + "–" + m.xg_away.toFixed(2) + "</td>" +
        "<td>" + m.hs + "–" + m.as + "</td><td>" + mark + "</td></tr>";
    }).join("");
    html += "</tbody></table>";
    document.getElementById("agreement").innerHTML = html;
  }

  /* ================= MATCH DATABASE ================= */
  // [key, label, % suffix, higher-is-better]
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

  function statVal(v) { return v == null ? null : v; }

  function buildStatPanel(m) {
    var s = m.stats || {};
    var rows = STAT_DEFS.map(function (def) {
      var pair = s[def[0]] || [null, null];
      var h = statVal(pair[0]), a = statVal(pair[1]);
      if (h == null && a == null) return "";
      var hv = h == null ? 0 : h, av = a == null ? 0 : a;
      var total = hv + av;
      var hpct = total > 0 ? (hv / total) * 100 : 50;
      var suffix = def[2] ? "%" : "";
      function disp(x) { return x == null ? "–" : (def[0] === "xg" ? x.toFixed(2) : x) + suffix; }
      // highlight the better side
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
    return '<div class="stat-panel"><div class="sp-head"><span>' + esc(m.home) +
      "</span><span>" + esc(m.away) + "</span></div>" + rows + "</div>";
  }

  /* Team totals across all played games */
  function teamTotals() {
    var t = {};
    function get(name) {
      return t[name] || (t[name] = { team: name, mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0,
        sg: 0, xgf: 0, xga: 0, shots: 0, sot: 0, poss: 0, pacc: 0, bch: 0 });
    }
    D.matches.forEach(function (m) {
      if (!m.played) return;
      var H = get(m.home), A = get(m.away);
      H.mp++; A.mp++;
      H.gf += m.hs; H.ga += m.as; A.gf += m.as; A.ga += m.hs;
      if (m.hs > m.as) { H.w++; A.l++; } else if (m.hs < m.as) { A.w++; H.l++; } else { H.d++; A.d++; }
      if (!m.has_stats) return;
      var s = m.stats;
      function add(side, sign) {
        var i = sign === "h" ? 0 : 1, j = sign === "h" ? 1 : 0;
        side.sg++;
        side.xgf += s.xg[i] || 0; side.xga += s.xg[j] || 0;
        side.shots += s.shots[i] || 0; side.sot += s.sot[i] || 0;
        side.poss += s.possession[i] || 0; side.pacc += s.pass_acc[i] || 0;
        side.bch += s.big_chances[i] || 0;
      }
      add(H, "h"); add(A, "a");
    });
    return Object.keys(t).map(function (k) {
      var r = t[k], n = r.sg || 1;
      r.shotsPg = r.shots / n; r.sotPg = r.sot / n; r.possAvg = r.poss / n;
      r.paccAvg = r.pacc / n; r.bchPg = r.bch / n;
      return r;
    });
  }
  var TOTALS = teamTotals();
  var dbSort = { key: "gf", dir: -1 };

  function renderDbTeamTable() {
    var q = (mSearch.value || "").toLowerCase().trim();
    var cols = [
      ["team", "Team", "t"], ["mp", "MP", "i"], ["w", "W", "i"], ["d", "D", "i"], ["l", "L", "i"],
      ["gf", "GF", "i"], ["ga", "GA", "i"], ["xgf", "xG", "f"], ["xga", "xGA", "f"],
      ["shotsPg", "Sh/g", "f"], ["sotPg", "SoT/g", "f"], ["possAvg", "Poss%", "i"],
      ["paccAvg", "Pass%", "i"], ["bchPg", "BigCh/g", "f"],
    ];
    var rows = TOTALS.filter(function (r) { return !q || r.team.toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) {
        var k = dbSort.key;
        if (k === "team") return dbSort.dir * a.team.localeCompare(b.team);
        return dbSort.dir * ((a[k] || 0) - (b[k] || 0));
      });
    function cell(r, c) {
      var k = c[0];
      if (k === "team") return '<td class="team"><div class="team-cell">' + logoImg(r.team) +
        '<span class="nm">' + esc(r.team) + "</span></div></td>";
      var v = r[k];
      if (c[2] === "f") v = (v || 0).toFixed(2);
      else if (c[2] === "i") v = Math.round(v || 0);
      return "<td>" + v + "</td>";
    }
    var head = cols.map(function (c) {
      var arr = dbSort.key === c[0] ? (dbSort.dir < 0 ? " ▼" : " ▲") : "";
      return '<th class="' + (c[2] === "t" ? "team" : "") + '" data-k="' + c[0] + '">' +
        c[1] + '<span class="arr">' + arr + "</span></th>";
    }).join("");
    var body = rows.map(function (r) {
      return "<tr>" + cols.map(function (c) { return cell(r, c); }).join("") + "</tr>";
    }).join("");
    document.getElementById("teamTable").innerHTML =
      '<table class="rank db-team"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table>";
    document.querySelectorAll("#teamTable th").forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.dataset.k;
        if (dbSort.key === k) dbSort.dir *= -1;
        else { dbSort.key = k; dbSort.dir = k === "team" ? 1 : -1; }
        renderDbTeamTable();
      });
    });
  }
  // the team-totals table also reacts to the shared Matches search box
  mSearch.addEventListener("input", renderDbTeamTable);

  /* ================= PLAYERS ================= */
  var PLAYERS = (window.WC_PLAYERS || []);
  var playerSort = { key: "ga", dir: -1 };
  var playerPreset = "ga";

  // Column registry for the players table: [key, header, type, normalisable, defaultOn, full name].
  // type: i=int, f=2dp float, pc=percent. "normalisable" marks counting stats that make
  // sense per 90/95 minutes (averages and percentages don't). Grouped for the ⚙ Columns
  // chooser; flattened in this order for the table, so the default view keeps the classic
  // column structure and extras slot in beside their family when enabled.
  var PLAYER_COL_GROUPS = [
    { name: "Attacking", cols: [
      ["g", "G", "i", 1, 1, "Goals"], ["a", "A", "i", 1, 1, "Assists"],
      ["ga", "G+A", "i", 1, 1, "Goals + assists"], ["xg", "xG", "f", 1, 1, "Expected goals"],
      ["xg_diff", "xG±", "f", 1, 1, "Finishing (goals − xG)"], ["xa", "xA", "f", 1, 0, "Expected assists"],
      ["shots", "Sh", "i", 1, 1, "Shots"], ["sot", "SoT", "i", 1, 1, "Shots on target"],
      ["post", "Post", "i", 1, 0, "Shots off the woodwork"],
      ["dribbles", "Drb", "i", 1, 0, "Dribbles completed"],
      ["drbAtt", "DrbA", "i", 1, 0, "Dribbles attempted"],
      ["drb_pct", "Drb%", "pc", 0, 0, "Dribble success rate"],
      ["offsides", "Off", "i", 1, 0, "Offsides"] ] },
    { name: "Passing", cols: [
      ["keyPasses", "KP", "i", 1, 1, "Key passes"], ["passes", "Pass", "i", 1, 1, "Passes"],
      ["pass_pct", "Pass%", "pc", 0, 1, "Pass accuracy"],
      ["progPasses", "PrgP", "i", 1, 0, "Progressive passes"],
      ["corners", "Cor", "i", 1, 0, "Corners taken"],
      ["touches", "Tch", "i", 1, 0, "Touches"] ] },
    { name: "Defending", cols: [
      ["tackles", "Tkl", "i", 1, 1, "Tackles"],
      ["tklWon", "TklW", "i", 1, 0, "Tackles won"],
      ["tkl_pct", "Tkl%", "pc", 0, 0, "Tackle success rate"],
      ["interceptions", "Int", "i", 1, 1, "Interceptions"],
      ["recoveries", "Rec", "i", 1, 0, "Loose-ball recoveries"],
      ["clearances", "Clr", "i", 1, 0, "Clearances"], ["clrBox", "BoxClr", "i", 1, 0, "Clearances in own box"],
      ["blocks", "Blk", "i", 1, 0, "Shots blocked"],
      ["drbPast", "DrbdP", "i", 1, 0, "Times dribbled past"],
      ["aerials", "AerW", "i", 1, 0, "Aerial duels won"],
      ["aerTot", "AerT", "i", 1, 0, "Aerial duels contested"],
      ["aer_pct", "Aer%", "pc", 0, 0, "Aerial duel win rate"],
      ["errors", "Err", "i", 1, 0, "Errors leading to a shot or goal"],
      ["fouls", "Fls", "i", 1, 0, "Fouls committed"], ["dispossessed", "Disp", "i", 1, 0, "Dispossessed"] ] },
    { name: "Goalkeeping / on-pitch defence", cols: [
      ["saves", "Saves", "i", 1, 0, "Keeper saves"],
      ["claims", "Claim", "i", 1, 0, "High balls claimed"],
      ["gPrev", "GPrv", "f", 1, 0, "Goals prevented (xG faced − conceded)"],
      ["xga", "xGA", "f", 1, 0, "xG faced while on pitch"],
      ["gConcOn", "GAon", "i", 1, 0, "Goals conceded while on pitch"] ] },
    { name: "General", cols: [
      ["starts", "St", "i", 0, 0, "Starts"], ["yc", "Y", "i", 0, 1, "Yellow cards"],
      ["rc", "R", "i", 0, 1, "Red cards"], ["rating", "Rt", "f", 0, 1, "Average match rating"],
      ["rating_best", "RtB", "f", 0, 0, "Best single-match rating"] ] },
  ];
  var PLAYER_COL_DEFS = [];
  PLAYER_COL_GROUPS.forEach(function (g) { g.cols.forEach(function (c) { PLAYER_COL_DEFS.push(c); }); });
  var PER90_KEYS = {};
  PLAYER_COL_DEFS.forEach(function (c) { if (c[3]) PER90_KEYS[c[0]] = 1; });
  var playerColOn = (function () {
    var st = {};
    PLAYER_COL_DEFS.forEach(function (c) { st[c[0]] = !!c[4]; });
    try {   // remember the user's column picks across visits
      var saved = JSON.parse(localStorage.getItem("wcPlayerCols") || "{}");
      Object.keys(saved).forEach(function (k) { if (k in st) st[k] = !!saved[k]; });
    } catch (e) {}
    return st;
  })();
  function savePlayerCols() {
    try { localStorage.setItem("wcPlayerCols", JSON.stringify(playerColOn)); } catch (e) {}
  }

  // WhoScored position codes → coarse groups (DMC/DML/DMR are midfielders, not defenders).
  function posGroup(pos) {
    if (!pos) return "";
    if (pos === "GK" || pos === "Sub") return pos;
    if (/^D[CLR]/.test(pos)) return "DF";
    if (/^(DM|M|AM)/.test(pos)) return "MF";
    return "FW";
  }

  function renderPlayerLeaders() {
    function top(key, label, fmt) {
      var arr = PLAYERS.filter(function (p) { return p[key] != null; })
        .sort(function (a, b) { return b[key] - a[key]; });
      var p = arr[0];
      if (!p) return "";
      var v = fmt ? fmt(p[key]) : p[key];
      return '<div class="stat"><div class="v accent">' + v + '</div><div class="k">' + label +
        '<br><span style="color:var(--text)">' + esc(p.name) + "</span> · " + esc(p.team) + "</div></div>";
    }
    var wrap = document.getElementById("playerLeaders");
    wrap.innerHTML =
      top("g", "Top scorer") + top("a", "Most assists") +
      top("xg", "Highest xG", function (v) { return v.toFixed(2); }) +
      top("rating", "Best avg rating", function (v) { return v.toFixed(2); });
  }

  function renderPlayersTable() {
    var q = (document.getElementById("playerSearch").value || "").toLowerCase().trim();
    var team = document.getElementById("playerTeam").value;
    var pos = (document.getElementById("playerPos") || {}).value || "";
    var minMins = +((document.getElementById("playerMin") || {}).value || 0);
    // Normaliser: 0 = raw totals, 90 = per 90′, 97 = per average game — measured from
    // our event data: regulation games average 96.8′ (median 97′) with stoppage; the
    // all-games average is 99′ but that's skewed by ten 120′+ extra-time ties.
    // Applies to counting stats only (null with no minutes).
    var norm = +((document.getElementById("playerNorm") || {}).value || 0);
    function pval(p, k) {
      var v = p[k];
      if (v == null || !norm || !PER90_KEYS[k]) return v;
      return p.mins > 0 ? v * norm / p.mins : null;
    }
    var cols = [
      ["name", "Player", "t"], ["team", "Team", "tm"], ["pos", "Pos", "s"],
      ["mp", "MP", "i"], ["mins", "Min", "i"],
    ];
    PLAYER_COL_DEFS.forEach(function (c) { if (playerColOn[c[0]]) cols.push(c); });
    // Sorted column just got disabled? Fall back to minutes (always present).
    if (!cols.some(function (c) { return c[0] === playerSort.key; }))
      playerSort = { key: "mins", dir: -1 };
    var filtered = PLAYERS.filter(function (p) {
      if (team && p.team !== team) return false;
      if (pos && posGroup(p.pos) !== pos) return false;
      if (minMins && (p.mins || 0) < minMins) return false;
      if (q && p.name.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var rows = filtered.sort(function (a, b) {
      var k = playerSort.key;
      if (k === "name" || k === "team" || k === "pos")
        return playerSort.dir * String(a[k]).localeCompare(String(b[k]));
      return playerSort.dir * ((pval(a, k) || 0) - (pval(b, k) || 0));
    }).slice(0, 300);
    var cnt = document.getElementById("playerCount");
    if (cnt) cnt.textContent = filtered.length + " of " + PLAYERS.length + " players" +
      (rows.length < filtered.length ? " · top " + rows.length + " shown" : "");

    function cell(p, c) {
      var k = c[0];
      if (k === "name") return '<td class="team"><span class="nm">' + esc(p.name) + "</span></td>";
      if (k === "team") return '<td class="team"><div class="team-cell">' + logoImg(p.team) +
        '<span class="nm">' + esc(p.team) + "</span></div></td>";
      if (k === "pos") return "<td>" + esc(p.pos || "") + "</td>";
      var v = pval(p, k);
      if (v == null) return "<td>–</td>";
      var n = +v;
      if (c[2] === "f" || (norm && PER90_KEYS[k])) v = n.toFixed(2);
      else if (c[2] === "pc") v = v + "%";
      var cls = (k === "xg_diff") ? (n > 0.05 ? "delta pos" : n < -0.05 ? "delta neg" : "") : "";
      var disp = (k === "xg_diff" && n > 0 ? "+" : "") + v;
      return "<td>" + (cls ? '<span class="' + cls + '">' + disp + "</span>" : disp) + "</td>";
    }
    var head = cols.map(function (c) {
      var arr = playerSort.key === c[0] ? (playerSort.dir < 0 ? " ▼" : " ▲") : "";
      var lbl = c[1] + (norm && PER90_KEYS[c[0]] ? "/" + norm : "");
      return '<th class="' + (c[2] === "t" || c[2] === "tm" ? "team" : "") + '" data-k="' + c[0] +
        '" title="' + esc(c[5] || c[1]) + '">' + lbl + '<span class="arr">' + arr + "</span></th>";
    }).join("");
    var body = rows.map(function (p) {
      return "<tr>" + cols.map(function (c) { return cell(p, c); }).join("") + "</tr>";
    }).join("");
    document.getElementById("playersTable").innerHTML =
      '<table class="rank players"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table>";
    document.querySelectorAll("#playersTable th").forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.dataset.k;
        if (playerSort.key === k) playerSort.dir *= -1;
        else { playerSort.key = k; playerSort.dir = (k === "name" || k === "team" || k === "pos") ? 1 : -1; }
        renderPlayersTable();
      });
    });
  }

  function initPlayers() {
    if (!PLAYERS.length) {
      document.getElementById("view-players").innerHTML +=
        '<p class="footer-note">No player data available yet.</p>';
      return;
    }
    var teams = {};
    PLAYERS.forEach(function (p) { teams[p.team] = 1; });
    var sel = document.getElementById("playerTeam");
    Object.keys(teams).sort().forEach(function (t) {
      var o = document.createElement("option"); o.value = t; o.textContent = t; sel.appendChild(o);
    });
    sel.addEventListener("change", renderPlayersTable);
    document.getElementById("playerSearch").addEventListener("input", renderPlayersTable);
    ["playerPos", "playerMin", "playerNorm"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", renderPlayersTable);
    });
    document.querySelectorAll("#playerPresets .seg-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll("#playerPresets .seg-btn").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        playerPreset = b.dataset.preset;
        playerSort = { key: playerPreset, dir: -1 };
        // A preset must be able to show what it sorts by — re-enable its column if hidden.
        if (playerPreset in playerColOn && !playerColOn[playerPreset]) {
          playerColOn[playerPreset] = true;
          savePlayerCols();
          var cb = document.querySelector('#playerColsPanel input[data-k="' + playerPreset + '"]');
          if (cb) cb.checked = true;
        }
        renderPlayersTable();
      });
    });
    // ⚙ Columns chooser: toggleable panel of extra stat columns, grouped by family.
    var colsBtn = document.getElementById("playerColsBtn"), colsPanel = document.getElementById("playerColsPanel");
    if (colsBtn && colsPanel) {
      colsPanel.innerHTML = PLAYER_COL_GROUPS.map(function (g) {
        return '<div class="cols-group"><div class="cg-title">' + esc(g.name) + "</div>" +
          g.cols.map(function (c) {
            return '<label class="cg-item"><input type="checkbox" data-k="' + c[0] + '"' +
              (playerColOn[c[0]] ? " checked" : "") + "><b>" + esc(c[1]) + "</b><span class='cg-sub'>" +
              esc(c[5] || "") + "</span></label>";
          }).join("") + "</div>";
      }).join("");
      colsBtn.addEventListener("click", function () {
        colsPanel.hidden = !colsPanel.hidden;
        colsBtn.classList.toggle("open", !colsPanel.hidden);
      });
      colsPanel.addEventListener("change", function (e) {
        var k = e.target && e.target.dataset ? e.target.dataset.k : null;
        if (!k) return;
        playerColOn[k] = e.target.checked;
        savePlayerCols();
        renderPlayersTable();
      });
    }
    renderPlayerLeaders();
    renderPlayersTable();
    renderPlayerBoards();
  }

  /* ================= DATA / DOWNLOADS ================= */
  function renderData() {
    var db = window.WC_DATABASE;
    var wrap = document.getElementById("dataDownloads");
    if (!db) { wrap.innerHTML = '<p class="footer-note">Run build_database.py to generate the downloads.</p>'; return; }
    wrap.innerHTML = db.tables.map(function (t) {
      return '<a class="data-card" href="' + ED_BASE + 'database/' + esc(t.file) + '" download>' +
        '<div class="dc-name">' + esc(t.label) + "</div>" +
        '<div class="dc-meta">' + t.rows + " rows · " + esc(t.file) + " · CSV</div>" +
        '<div class="dc-dl">⬇ Download</div></a>';
    }).join("");
    document.getElementById("sqliteLink").setAttribute("href", ED_BASE + "database/" + db.sqlite);
    if (db.raw_match_dir) {
      document.getElementById("rawNote").innerHTML =
        "All <b>" + db.raw_match_files + "</b> scraped match JSON files (FotMob + WhoScored merged, with the full " +
        "event stream) live in <code>wc2026/matches/</code> in the repository.";
    } else if (db.raw_release) {
      document.getElementById("rawNote").innerHTML =
        "The <b>" + db.raw_match_files + "</b> raw scraped match files for " + esc(ED_LABEL) +
        " aren't committed to the repo (repo-size policy) — they're archived as the " +
        "<code>" + esc(db.raw_release) + "</code> GitHub Release asset.";
    }
  }

  /* ================= BEST THIRD-PLACED TEAMS =================
     Ranks the 12 group third-placed teams (Pts, GD, GF, name); the top 8 advance to the R32.
     Which qualifier faces which group winner comes from FIFA's Annex C allocation table — for
     a given set of 8 qualifying groups it maps each relevant group WINNER to the GROUP whose
     third-placed team it plays. Keyed by the sorted qualifying-group combination. Only the
     combinations that can actually occur this tournament need to be listed; if the live combo
     isn't present the bracket simply keeps the "3rd: A/B/.." placeholder. */
  var FIFA_THIRD_ALLOC = {
    // qualifying thirds {B,D,E,F,I,J,K,L}  →  winnerGroup : thirdGroup it faces
    "BDEFIJKL": { A: "E", B: "J", D: "B", E: "D", G: "I", I: "F", K: "L", L: "K" }
  };

  function computeThirds() {
    if (!D.standings) return null;
    var letters = Object.keys(D.standings).sort();
    var ranking = [];
    var allComplete = true;
    letters.forEach(function (g) {
      var grp = D.standings[g];
      if (!grp || grp.length < 4 || !grp.every(function (r) { return r.P >= 3; })) { allComplete = false; return; }
      var r = grp[2];
      ranking.push({ grp: g, team: r.team, P: r.P, W: r.W, D: r.D, L: r.L, GF: r.GF, GA: r.GA, GD: r.GD, Pts: r.Pts });
    });
    ranking.sort(function (a, b) {
      return b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || (a.team < b.team ? -1 : a.team > b.team ? 1 : 0);
    });
    ranking.forEach(function (t, i) { t.rank = i + 1; t.qual = i < 8; });

    // Slot assignment only when all 12 groups are done and the combo is in the table.
    var assignByCode = {}, thirdToWinner = {};
    if (allComplete && ranking.length === 12) {
      var combo = ranking.slice(0, 8).map(function (t) { return t.grp; }).sort().join("");
      var winnerToThird = FIFA_THIRD_ALLOC[combo];
      if (winnerToThird) {
        Object.keys(winnerToThird).forEach(function (w) { thirdToWinner[winnerToThird[w]] = w; });
        // Map each schedule slot code (e.g. "3ABCDF") to its team via the 1X opponent it faces.
        (D.matches || []).forEach(function (m) {
          var s = m.id.replace(/^\d{4}_\d{2}_\d{2}_/, "").split("_vs_");
          s.forEach(function (sideCode, ix) {
            if (!/^3[A-L]{2,}$/.test(sideCode)) return;
            var opp = s[1 - ix], wm = opp.match(/^1([A-L])$/);
            if (!wm) return;
            var thirdG = winnerToThird[wm[1]];
            var row = ranking.find(function (t) { return t.grp === thirdG; });
            if (row) assignByCode[sideCode] = row.team;
          });
        });
      }
    }
    return { ranking: ranking, assignByCode: assignByCode, thirdToWinner: thirdToWinner, complete: allComplete };
  }

  function renderThirdPlace() {
    var host = document.getElementById("thirdTable");
    if (!host) return;
    // Best-thirds only exists for the 12-group/R32 format (2026); 8-group editions go
    // straight from groups to R16, so the whole section is hidden, not just emptied.
    var heading = document.getElementById("thirdSectionHead");
    if (!FMT.thirds) {
      host.innerHTML = "";
      if (heading) heading.style.display = "none";
      host.style.display = "none";
      return;
    }
    if (heading) heading.style.display = "";
    host.style.display = "";
    var info = computeThirds();
    if (!info || !info.ranking.length) {
      host.innerHTML = '<p class="hint">The third-placed ranking appears once groups finish their matches.</p>';
      return;
    }
    var winnerTeam = {};
    Object.keys(D.standings).forEach(function (g) {
      var grp = D.standings[g];
      if (grp && grp[0] && grp.every(function (r) { return r.P >= 3; })) winnerTeam[g] = grp[0].team;
    });
    var body = info.ranking.map(function (t) {
      var dest = "";
      if (t.qual) {
        var w = info.thirdToWinner[t.grp];
        dest = w ? ('R32: vs ' + (winnerTeam[w] ? esc(winnerTeam[w]) : "1" + w) + ' <span class="tp-gw">(1' + w + ')</span>')
                 : '<span class="tp-gw">qualifies</span>';
      } else {
        dest = '<span class="tp-out">eliminated</span>';
      }
      return '<tr class="' + (t.qual ? "qual" : "out") + '">' +
        '<td class="rk">' + t.rank + "</td>" +
        '<td class="grp">' + t.grp + "</td>" +
        '<td class="team"><div class="team-cell">' + logoImg(t.team) + '<span class="nm">' + esc(t.team) + "</span></div></td>" +
        "<td>" + t.P + "</td><td>" + t.W + "</td><td>" + t.D + "</td><td>" + t.L + "</td>" +
        "<td>" + t.GF + "</td><td>" + t.GA + "</td><td>" + (t.GD > 0 ? "+" + t.GD : t.GD) + "</td>" +
        '<td class="pts">' + t.Pts + "</td>" +
        '<td class="dest">' + dest + "</td></tr>";
    }).join("");
    host.innerHTML =
      '<div class="third-card"><table class="third-table"><thead><tr>' +
      "<th>#</th><th>Grp</th><th class='team'>Team</th><th>P</th><th>W</th><th>D</th><th>L</th>" +
      "<th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th class='dest'>Round of 32</th>" +
      "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  /* ================= KNOCKOUT BRACKET (Tables tab) =================
     The bracket shape is read straight from the schedule's knockout match ids. Those ids
     carry slot/Winner/Loser codes (e.g. "2A_vs_2B", "Winner_EF_1_vs_Winner_EF_2") that
     survive even after a tie is played, so the tree always links up. Round → round links:
       R32 → R16 is exact (an R16 side like "2A2B" is the winner of the "2A_vs_2B" tie);
       R16 → QF → SF → Final follow the EF/QF/SF index references in the ids, with R16
       numbered 1..8 in schedule (date) order — the standard FIFA bracket numbering. */
  /* Shared knockout-tree model. Parses the schedule's slot / Winner / Loser match ids into a
     linked R32 → Final tree (each node carries `_kids` = its two feeder ties) plus the
     third-place play-off, and a `resolveSlot` that turns a slot code into a team once known.
     Returns null until the fixtures are loaded. Consumed by both `renderBracket` and the
     Power-Rank predictions, so the projected and actual brackets always share one shape. */
  /* Historical-edition bracket builder (8 groups, knockout enters at R16, no best-thirds).
     Unlike 2026 — which schedules knockout ties before the teams are known, hence the
     slot-code id parsing above — a backfilled historical tournament is 100% already played
     with REAL team names in every match id, so there is no slot code to parse. Rounds are
     identified from each match's `stage` string (FotMob's round name for that match) and
     ties are linked round-to-round by which team actually WON its way into the next one. */
  // Order matters: "final" as a bare substring ALSO matches inside "Semi-final",
  // "Quarter-final" AND FotMob's own "1/8-finals" (R16) — so every more specific
  // pattern must be checked, and excluded, before the catch-all "final" check.
  function histRoundOf(m) {
    var s = (m.stage || "").toLowerCase();
    if (s.indexOf("third") >= 0 || s.indexOf("bronze") >= 0) return "TP";
    if (s.indexOf("round of 16") >= 0 || s.indexOf("1/8") >= 0) return "R16";
    if (s.indexOf("quarter") >= 0) return "QF";
    if (s.indexOf("semi") >= 0) return "SF";
    if (s.indexOf("final") >= 0) return "F";
    return null;
  }
  function buildKnockoutHistory() {
    if (!D.matches) return null;
    function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a._ix - b._ix; }
    var rounds = { R16: [], QF: [], SF: [], F: [], TP: [] };
    D.matches.forEach(function (m, i) {
      var r = histRoundOf(m);
      if (r) { m._ix = i; rounds[r].push(m); }
    });
    if (!rounds.F.length) return null;
    Object.keys(rounds).forEach(function (k) { rounds[k].sort(byDate); });
    // Link each tie to its two feeders in the previous round: the feeder is whichever
    // earlier-round match that team actually won (or reached via a shootout).
    var ORDER = ["R16", "QF", "SF", "F"];
    for (var i = 1; i < ORDER.length; i++) {
      var prevRound = rounds[ORDER[i - 1]];
      rounds[ORDER[i]].forEach(function (m) {
        m._kids = [m.home, m.away].map(function (team) {
          return prevRound.find(function (p) {
            if (p.home !== team && p.away !== team) return false;
            if (!p.played || p.hs == null) return false;
            var pens = p.hs === p.as && p.hpen != null && p.apen != null;
            var winner = p.hs > p.as ? p.home : p.as > p.hs ? p.away
                       : pens ? (p.hpen > p.apen ? p.home : p.away) : null;
            return winner === team;
          }) || null;
        });
      });
    }
    var fin = rounds.F[0];
    var tp = rounds.TP[0];
    if (tp) {
      // Third place feeds the LOSERS of the two semis, not the winners — pair by date order.
      tp._kids = rounds.SF.slice(0, 2);
    }
    function strip(id) { return id.replace(/^\d{4}_\d{2}_\d{2}_/, ""); }
    return { rounds: rounds, fin: fin, tp: tp, strip: strip,
             resolveSlot: function (raw) { return { text: String(raw) }; }, historical: true };
  }
  function buildKnockout() {
    if (FMT.koEntry !== "R32") return buildKnockoutHistory();
    if (!D.matches) return null;
    function strip(id) { return id.replace(/^\d{4}_\d{2}_\d{2}_/, ""); }
    function isSlotExpr(t) { return /^[123][0-9A-L]*$/.test(t); }
    function digits(t) { return (t.match(/[123]/g) || []).length; }
    function roundOf(id) {
      var s = strip(id);
      if (/^Winner_SF_\d_vs_Winner_SF_\d$/.test(s)) return "F";
      if (/^Loser_SF_\d_vs_Loser_SF_\d$/.test(s)) return "TP";
      if (/^Winner_QF_\d_vs_Winner_QF_\d$/.test(s)) return "SF";
      if (/^Winner_EF_\d_vs_Winner_EF_\d$/.test(s)) return "QF";
      var sd = s.split("_vs_");
      if (sd.length === 2 && sd.every(isSlotExpr) && digits(sd[0]) === digits(sd[1])) {
        if (digits(sd[0]) === 1) return "R32";
        if (digits(sd[0]) === 2) return "R16";
      }
      return null;
    }
    var rounds = { R32: [], R16: [], QF: [], SF: [], F: [], TP: [] };
    D.matches.forEach(function (m, i) {
      var r = roundOf(m.id);
      if (r) { m._ix = i; rounds[r].push(m); }
    });
    if (!rounds.F.length || rounds.R32.length < 2) return null;
    function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a._ix - b._ix; }
    ["R32", "R16", "QF", "SF"].forEach(function (k) { rounds[k].sort(byDate); });

    // R32 lookup by its sorted slot-code pair (e.g. "2A|2B")
    var r32by = {};
    rounds.R32.forEach(function (m) {
      var key = strip(m.id).split("_vs_").slice().sort().join("|");
      r32by[key] = m;
    });
    // R16 numbered 1..8 (EF). The QF/SF ids link by EF number, so EF order must follow the
    // OFFICIAL FIFA bracket (match 89 → 96), NOT kickoff order: R16 ties share match-days and
    // same-day order is not the bracket order. The QF ids pair (EF1,EF2)(EF3,EF4)(EF5,EF6)(EF7,EF8)
    // and the SF ids pair (QF1,QF2)→SF1 / (QF3,QF4)→SF2, so EF1–4 form the top half (SF1) and
    // EF5–8 the bottom half (SF2). Getting the half assignment wrong swaps whole quarters between
    // semi-finals. Pin the canonical order by each tie's sorted R32-slot signature = FIFA matches
    // 89..96; a tie not in the table (a different schedule) falls back to date order.
    //  EF1=M89 Par/Fra  EF2=M90 Can/Mor  EF3=M93 Por/Spa  EF4=M94 USA/Bel   → QF97,QF98 → SF1
    //  EF5=M91 Bra/Nor  EF6=M92 Mex/Eng  EF7=M95 Arg-half EF8=M96 Swi-half  → QF99,QF100 → SF2
    var R16_ORDER = ["1E3ABCDF|1I3CDFGH", "1F2C|2A2B", "1H2J|2K2L", "1D3BEFIJ|1G3AEHIJ",
                     "1C2F|2E2I", "1A3CEFHI|1L3EHIJK", "1J2H|2D2G", "1B3EFGIJ|1K3DEIJL"];
    function r16rank(m) { var i = R16_ORDER.indexOf(strip(m.id).split("_vs_").slice().sort().join("|")); return i < 0 ? 99 : i; }
    rounds.R16.sort(function (a, b) { var ra = r16rank(a), rb = r16rank(b); return ra !== rb ? ra - rb : byDate(a, b); });
    // each R16's feeders are its two R32 ties
    var efByNum = {};
    rounds.R16.forEach(function (m, i) {
      efByNum[i + 1] = m;
      m._kids = strip(m.id).split("_vs_").map(function (side) {
        var cs = side.match(/[123][A-L]+/g) || [];
        return r32by[cs.slice().sort().join("|")];
      });
    });
    function refNums(id, tag) {
      var re = new RegExp("Winner_" + tag + "_(\\d)|Loser_" + tag + "_(\\d)", "g"), out = [], mm;
      while ((mm = re.exec(id))) out.push(+(mm[1] || mm[2]));
      return out;
    }
    var qfByNum = {};
    rounds.QF.forEach(function (m) {
      var efs = refNums(m.id, "EF");
      qfByNum[Math.ceil(Math.min(efs[0], efs[1]) / 2)] = m;
      m._kids = efs.map(function (n) { return efByNum[n]; });
    });
    var sfByNum = {};
    rounds.SF.forEach(function (m) {
      var qfs = refNums(m.id, "QF");
      sfByNum[Math.ceil(Math.min(qfs[0], qfs[1]) / 2)] = m;
      m._kids = qfs.map(function (n) { return qfByNum[n]; });
    });
    var fin = rounds.F[0];
    fin._kids = refNums(fin.id, "SF").map(function (n) { return sfByNum[n]; });
    var tp = rounds.TP[0];
    if (tp) tp._kids = refNums(tp.id, "SF").map(function (n) { return sfByNum[n]; });

    var thirdAssign = (computeThirds() || {}).assignByCode || {};
    function resolveSlot(raw) {
      raw = String(raw);
      var m = raw.match(/^([12])([A-L])$/);
      if (m) {
        var code = m[1] + m[2], grp = D.standings && D.standings[m[2]];
        if (grp && grp.length >= 2 && grp.every(function (r) { return r.P >= 3; })) {
          var t = grp[+m[1] - 1];
          if (t) return { team: t.team, code: code };
        }
        return { text: code + " · " + (m[1] === "1" ? "group winner" : "runner-up") };
      }
      if ((m = raw.match(/^3([A-L]{2,})$/))) {
        if (thirdAssign[raw]) return { team: thirdAssign[raw], code: "3rd" };
        return { text: "3rd: " + m[1].split("").join("/") };
      }
      if (/^Winner /.test(raw)) return { text: raw.replace(/EF (\d)/, "R16 #$1").replace(/QF (\d)/, "QF #$1").replace(/SF (\d)/, "SF #$1") };
      if (/^Loser /.test(raw)) return { text: raw.replace(/SF (\d)/, "SF #$1") };
      return { text: raw };
    }
    return { rounds: rounds, r32by: r32by, efByNum: efByNum, qfByNum: qfByNum,
             sfByNum: sfByNum, fin: fin, tp: tp, resolveSlot: resolveSlot, strip: strip };
  }

  function renderBracket() {
    var host = document.getElementById("bracket");
    if (!host) return;
    var K = buildKnockout();
    if (!K) { host.innerHTML = '<p class="hint">The knockout bracket appears once the fixtures are loaded.</p>'; return; }
    var fin = K.fin, tp = K.tp, resolveSlot = K.resolveSlot;
    // One side of a bracket box. Three cases, in priority order:
    //   1. tie played            → the team with its goals, plus the shootout score in
    //                              parens when it finished level and was decided on penalties;
    //   2. fed by a decided tie  → the team that has ALREADY advanced into this slot. koSide
    //      (shared with the calendar) walks the `_kids` feeder tree and is penalty-aware, so
    //      a winner — including a shootout winner — propagates up the bracket automatically;
    //   3. still undecided       → the projected slot label ("2A", "Winner R16 #1", …).
    function side(m, which) {
      var idx = which === "h" ? 0 : 1;
      var sc = which === "h" ? m.hs : m.as, os = which === "h" ? m.as : m.hs;
      var pen = which === "h" ? m.hpen : m.apen, opp = which === "h" ? m.apen : m.hpen;
      if (m.played && sc != null) {
        var nm = which === "h" ? m.home : m.away;
        var pens = sc === os && pen != null && opp != null;   // level on goals → shootout decided it
        var cls = (sc > os || (pens && pen > opp)) ? "win"
                : (sc < os || (pens && pen < opp)) ? "lose" : "draw";
        var penTxt = pens ? ' <span class="pen">(' + pen + ")</span>" : "";
        return '<div class="bk-side ' + cls + '">' + logoImg(nm, "bk-logo") +
          '<span class="nm">' + esc(nm) + '</span><span class="sc">' + sc + penTxt + "</span></div>";
      }
      var rawCode = K.strip(m.id).split("_vs_")[idx];
      // Third-place play-off: a side references a BEATEN semi-finalist ("Loser_SF_n"), so the
      // LOSER of that semi advances here — not the winner koSide would return. Resolve it
      // directly once the semi is played; until then fall through to the "Loser SF #n" label.
      if (/^Loser_/.test(rawCode)) {
        var sf = m._kids && m._kids[idx];
        var w = sf && sf.played ? koCands(K, sf)[0] : null;   // decided winner (goals or pens)
        if (w) {
          var loser = w === sf.home ? sf.away : sf.home;
          return '<div class="bk-side proj">' + logoImg(loser, "bk-logo") +
            '<span class="nm">' + esc(loser) + "</span></div>";
        }
      }
      var s = koSide(K, m, idx);
      if (s.team) {
        // Tag the small group seed it came from (e.g. "2A"/"3rd"); advanced winners get no tag.
        var code = resolveSlot(rawCode).code || "";
        return '<div class="bk-side proj">' + logoImg(s.team, "bk-logo") +
          '<span class="nm">' + esc(s.team) + "</span>" +
          (code ? '<span class="tag">' + esc(code) + "</span>" : "") + "</div>";
      }
      return '<div class="bk-side tbd"><span class="nm">' + esc(s.label) + "</span></div>";
    }
    function box(m) {
      if (!m) return '<div class="bk-match bk-tbd"><div class="bk-side tbd"><span class="nm">TBD</span></div></div>';
      return '<div class="bk-match' + (m.played ? " played" : "") + '">' +
        '<div class="bk-dt">' + esc(fmtDate(m.date)) + "</div>" + side(m, "h") + side(m, "a") + "</div>";
    }
    // Single left-to-right tree: deepest round (R32) on the left, each round flowing
    // right into the next, the Final on the right. Feeders link rightward to their tie.
    function node(m) {
      var kids = m && m._kids && m._kids.length === 2
        ? '<div class="bk-kids">' + node(m._kids[0]) + node(m._kids[1]) + "</div><div class=\"bk-edge\"></div>"
        : "";
      return '<div class="bk-node">' + kids + box(m) + "</div>";
    }
    host.innerHTML = '<div class="bracket-tree lr">' + node(fin) + "</div>" +
      (tp ? '<div class="bk-third"><div class="bk-third-h">Third-place play-off</div>' + box(tp) + "</div>" : "");
    // Header columns aligned to the left-to-right layout (R32 → Final for 2026,
    // R16 → Final for the 8-group/no-thirds historical format).
    var head = document.getElementById("bracketHead");
    if (head) {
      var MW = "var(--bk-mw)", MID = "calc(var(--bk-mw) + var(--bk-edge))";
      var cells = K.historical
        ? [["Round of 16", MW], ["Quarter-finals", MID], ["Semi-finals", MID], ["Final", MID]]
        : [["Round of 32", MW], ["Round of 16", MID], ["Quarter-finals", MID],
           ["Semi-finals", MID], ["Final", MID]];
      head.innerHTML = cells.map(function (c) { return '<span class="bk-hcell" style="width:' + c[1] + '">' + c[0] + "</span>"; }).join("");
    }
  }

  /* ================= POWER RANK & KNOCKOUT PREDICTIONS (Power Rank tab) =================
     A single Power Index per knockout team = pre-tournament FIFA ranking points, plus three
     capped adjustments: (1) recency-weighted goal/xG form across every match played so far —
     group AND knockout, with the most recent matches weighted higher than early group games;
     (2) finishing & shot-stopping quality (goals vs xG, on both ends) beyond raw chance
     volume; (3) squad quality — the minutes-weighted average match rating of each team's
     most-used XI, standardised against the field. The ratings then drive a favourite-advances
     simulation of every knockout tie up to the final. */

  // FIFA/Coca-Cola Men's World Ranking points — 11 June 2026 edition (the last update before
  // kick-off; Argentina 1st on 1877). Top ~45 are the published values; a few of the lowest
  // debutants are approximated. This is the "class" half of the Power Index.
  // Canonical copy now lives in ratings.js (window.FIFA_PTS), shared with the match-page
  // Win-probability chart; the inline literal below is a fallback if that file fails to load.
  var FIFA_PTS = window.FIFA_PTS || {
    "Argentina": 1877, "Spain": 1867, "France": 1862, "England": 1819, "Portugal": 1779, "Brazil": 1760,
    "Netherlands": 1751, "Belgium": 1740, "Morocco": 1736, "Germany": 1724, "Croatia": 1709, "Colombia": 1696,
    "Mexico": 1690, "Senegal": 1684, "Uruguay": 1679, "USA": 1665, "Japan": 1652, "Switzerland": 1648,
    "Iran": 1637, "Turkiye": 1607, "Ecuador": 1587, "Austria": 1578, "South Korea": 1569, "Australia": 1554,
    "Egypt": 1543, "Canada": 1536, "Norway": 1530, "Ivory Coast": 1524, "Algeria": 1512, "Sweden": 1490,
    "Panama": 1475, "Paraguay": 1470, "Scotland": 1466, "Czechia": 1458, "Tunisia": 1452, "DR Congo": 1400,
    "South Africa": 1395, "Qatar": 1394, "Iraq": 1390, "Uzbekistan": 1387, "Jordan": 1383, "Saudi Arabia": 1380,
    "Bosnia and Herzegovina": 1360, "Cape Verde": 1340, "Ghana": 1326, "Curacao": 1270, "Haiti": 1255, "New Zealand": 1250
  };
  // Display rank among the 48 WC teams (1 = highest FIFA points).
  var FIFA_RANK = {};
  Object.keys(FIFA_PTS).sort(function (a, b) { return FIFA_PTS[b] - FIFA_PTS[a]; })
    .forEach(function (t, i) { FIFA_RANK[t] = i + 1; });

  var AGG_BY = {}; AGG.forEach(function (a) { AGG_BY[a.team] = a; });
  function standingRow(team) {
    var st = D.standings || {};
    for (var g in st) {
      var grp = st[g] || [];
      for (var i = 0; i < grp.length; i++) if (grp[i].team === team) return grp[i];
    }
    return null;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Recency-weighted per-game goal/xG difference across EVERY match a team has played so far
  // (group + knockout, in date order) — a half-life of 4 games means a team's most recent
  // outing counts noticeably more than its opener, so a squad peaking late (or fading) shows
  // up in the index instead of being smoothed away by a flat season average.
  var FORM_HALF_LIFE = 4;
  function weightedForm(team) {
    var recs = R.filter(function (r) { return r.team === team; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var n = recs.length;
    if (!n) return { xgdpg: 0, gdpg: 0, n: 0 };
    var decay = Math.pow(0.5, 1 / FORM_HALF_LIFE), wSum = 0, xgdW = 0, gdW = 0;
    recs.forEach(function (r, i) {
      var w = Math.pow(decay, n - 1 - i);          // most recent match → w = 1
      wSum += w; xgdW += w * (r.xgf - r.xga); gdW += w * (r.gf - r.ga);
    });
    return { xgdpg: xgdW / wSum, gdpg: gdW / wSum, n: n };
  }

  // Squad quality — proxy for "best XI": each team's 11 most-used players (by minutes played)
  // this tournament, their match ratings averaged and weighted by minutes. Standardised against
  // the field (48 WC teams) so a small ratings gap can't swamp the FIFA/form terms.
  var SQUAD_SIZE = 11, SQUAD_SCALE = 55, SQUAD_CAP = 55, QUALITY_SCALE = 8, QUALITY_CAP = 20;
  function squadRating(team) {
    var roster = PLAYERS.filter(function (p) { return p.team === team && p.mins > 0 && p.rating > 0; })
      .sort(function (a, b) { return b.mins - a.mins; }).slice(0, SQUAD_SIZE);
    if (!roster.length) return null;
    var wSum = 0, rSum = 0;
    roster.forEach(function (p) { wSum += p.mins; rSum += p.mins * p.rating; });
    return wSum ? rSum / wSum : null;
  }
  var SQUAD_RATING_BY = {}, SQUAD_FIELD_MEAN = (function () {
    var teams = Object.keys(D.teamGroup || {}), sum = 0, n = 0;
    teams.forEach(function (t) {
      var sq = squadRating(t); SQUAD_RATING_BY[t] = sq;
      if (sq != null) { sum += sq; n++; }
    });
    return n ? sum / n : 6.8;
  })();

  // Power Index = FIFA points, plus three capped adjustments: recency-weighted form (points,
  // goal difference, xG difference), finishing/shot-stopping quality (goals vs xG on both
  // ends), and squad quality (best-XI average rating vs the field).
  function powerRating(team) {
    var fifa = FIFA_PTS[team] || 1400;
    var row = standingRow(team), ag = AGG_BY[team];
    var ppg = 0, P = 0;
    if (row && row.P) { P = row.P; ppg = row.Pts / P; }
    var wf = weightedForm(team), xgdpg = wf.xgdpg, gdpg = wf.gdpg;
    var adj = clamp(40 * (ppg - 1.6) + 28 * xgdpg + 10 * gdpg, -100, 100);

    var attDpg = 0, defDpg = 0, qualAdj = 0;
    if (ag && ag.n) {
      attDpg = ag.attDelta / ag.n; defDpg = ag.defDelta / ag.n;
      qualAdj = clamp(QUALITY_SCALE * attDpg + QUALITY_SCALE * defDpg, -QUALITY_CAP, QUALITY_CAP);
    }

    var sq = SQUAD_RATING_BY[team], squadAdj = sq != null ? clamp((sq - SQUAD_FIELD_MEAN) * SQUAD_SCALE, -SQUAD_CAP, SQUAD_CAP) : 0;

    return {
      team: team, fifa: fifa, fifaRank: FIFA_RANK[team] || null, adj: adj,
      qualAdj: qualAdj, squadAdj: squadAdj, squadRating: sq,
      rating: fifa + adj + qualAdj + squadAdj,
      ppg: ppg, gdpg: gdpg, xgdpg: xgdpg, attDpg: attDpg, defDpg: defDpg,
      pts: row ? row.Pts : null, gd: row ? row.GD : null, P: P
    };
  }
  // Elo-style: a 100-pt Power-Index edge ≈ 64%, 200 ≈ 74%. Knockout → this is "A advances".
  function winProb(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / 400)); }

  // Likely regulation scoreline from the rating gap nudged toward each side's group goals-for
  // rate; level games go to the higher-rated team "on penalties".
  function predictScore(fav, dog) {
    var diff = fav.rating - dog.rating;
    var gF = (standingRow(fav.team) || {}).GF, gU = (standingRow(dog.team) || {}).GF;
    var baseF = 1.4 + diff / 300, baseU = 1.3 - diff / 360;
    if (typeof gF === "number") baseF = (baseF + gF / 3) / 2;
    if (typeof gU === "number") baseU = (baseU + gU / 3) / 2;
    var sf = Math.round(Math.max(0.4, baseF)), su = Math.round(Math.max(0.3, baseU));
    var pens = false;
    if (sf <= su) { su = sf; pens = true; }   // not a clear win on goals → tight game, penalties
    return { sf: sf, su: su, pens: pens };
  }
  // If a tie has actually been played, its real result — not the model — is the truth.
  function actualResult(m) {
    if (!m || !m.played || m.hs == null || m.as == null) return null;
    if (m.hs !== m.as) return { winner: m.hs > m.as ? m.home : m.away, loser: m.hs > m.as ? m.away : m.home };
    if (m.hpen != null && m.apen != null && m.hpen !== m.apen)
      return { winner: m.hpen > m.apen ? m.home : m.away, loser: m.hpen > m.apen ? m.away : m.home };
    return null;
  }
  function makePred(m, hName, aName) {
    var res = { m: m, home: hName, away: aName };
    if (hName && aName) {
      var A = powerRating(hName), B = powerRating(aName);
      var pH = winProb(A.rating, B.rating);
      var fav = pH >= 0.5 ? A : B, dog = pH >= 0.5 ? B : A;
      res.A = A; res.B = B; res.pH = pH;
      res.favProb = Math.max(pH, 1 - pH);
      var real = actualResult(m);
      if (real) {
        // The tie already happened — report what did, don't second-guess it with the model.
        res.actual = true;
        res.winner = real.winner; res.loser = real.loser;
        res.upset = fav.team !== real.winner;
        var winIsHome = real.winner === m.home;
        res.score = { sf: winIsHome ? m.hs : m.as, su: winIsHome ? m.as : m.hs, pens: m.hs === m.as };
      } else {
        res.winner = fav.team; res.loser = dog.team;
        res.score = predictScore(fav, dog);
      }
    }
    return res;
  }

  // Walk the linked knockout tree. Already-played ties feed their REAL winner forward;
  // only ties that haven't happened yet get projected from the Power Index model — so the
  // predicted road (and champion) is always seeded by what's actually happened so far.
  function predictAll() {
    var K = buildKnockout();
    if (!K) return null;
    var preds = {};
    function resolveTeam(slot) { var r = K.resolveSlot(slot); return r.team || null; }
    function predictMatch(m) {
      if (!m) return null;
      if (preds[m.id]) return preds[m.id];
      preds[m.id] = { m: m };                         // guard against re-entry
      var sd = K.strip(m.id).split("_vs_");
      var hName = m._kids && m._kids[0] ? (predictMatch(m._kids[0]) || {}).winner : resolveTeam(sd[0]);
      var aName = m._kids && m._kids[1] ? (predictMatch(m._kids[1]) || {}).winner : resolveTeam(sd[1]);
      return (preds[m.id] = makePred(m, hName || null, aName || null));
    }
    predictMatch(K.fin);
    var out = { R32: [], R16: [], QF: [], SF: [], F: null, TP: null, champion: null, K: K };
    ["R32", "R16", "QF", "SF"].forEach(function (rd) {
      K.rounds[rd].forEach(function (m) { out[rd].push(preds[m.id] || predictMatch(m)); });
    });
    out.F = preds[K.fin.id];
    out.champion = out.F ? out.F.winner : null;
    if (K.tp) {                                       // third place = the two beaten semi-finalists
      var l1 = (preds[(K.sfByNum[1] || {}).id] || {}).loser;
      var l2 = (preds[(K.sfByNum[2] || {}).id] || {}).loser;
      out.TP = makePred(K.tp, l1 || null, l2 || null);
    }
    return out;
  }

  function renderPower() {
    var host = document.getElementById("powerTable");
    if (!host) return;
    var K = buildKnockout();
    var groupsDone = D.standings && Object.keys(D.standings).length >= 12 &&
      Object.keys(D.standings).every(function (g) { return (D.standings[g] || []).every(function (r) { return r.P >= 3; }); });
    if (!K || !groupsDone) {
      host.innerHTML = '<p class="hint">The Power Rank and predictions appear once all groups have finished and the Round of 32 is set.</p>';
      var rr = document.getElementById("predRounds"); if (rr) rr.innerHTML = "";
      var pc = document.getElementById("predChampion"); if (pc) pc.innerHTML = "";
      var pk0 = document.getElementById("powerKOCard"); if (pk0) pk0.style.display = "none";
      return;
    }

    // The 32 = both resolved sides of every Round-of-32 tie.
    var teamSet = {};
    K.rounds.R32.forEach(function (m) {
      K.strip(m.id).split("_vs_").forEach(function (s) { var r = K.resolveSlot(s); if (r.team) teamSet[r.team] = 1; });
    });
    var list = Object.keys(teamSet).map(powerRating).sort(function (a, b) { return b.rating - a.rating; });
    var maxR = list[0].rating, minR = list[list.length - 1].rating, span = (maxR - minR) || 1;

    var P = predictAll();

    // Biggest riser: the team that gained the most places vs its FIFA seeding among these 32
    // (group-stage form lifting it above where pedigree alone would rank it).
    var fifaRank32 = {};
    list.slice().sort(function (a, b) { return b.fifa - a.fifa; }).forEach(function (p, i) { fifaRank32[p.team] = i + 1; });
    var riser = list[0], riseBy = -99;
    list.forEach(function (p, i) { var j = fifaRank32[p.team] - (i + 1); if (j > riseBy) { riseBy = j; riser = p; } });

    // Headline stats
    var stats = [
      ["v accent", Math.round(list[0].rating), "Top Power Index — " + list[0].team],
      ["v blue", P && P.champion ? P.champion : "—", "Predicted champion"],
      ["v", "▲ " + riseBy, "Biggest riser — " + riser.team],
      ["v", list.length, "Teams in the Round of 32"]
    ];
    document.getElementById("predStats").innerHTML = stats.map(function (it) {
      return '<div class="stat"><div class="' + it[0] + '" style="font-size:' + (String(it[1]).length > 6 ? 20 : 28) + 'px">' +
        esc(String(it[1])) + '</div><div class="k">' + esc(it[2]) + "</div></div>";
    }).join("");

    // Power Index table
    var body = list.map(function (p, i) {
      var w = ((p.rating - minR) / span) * 100;
      var champ = P && P.champion === p.team;
      var formAdj = p.adj + p.qualAdj;
      return '<tr' + (champ ? ' class="champ-row"' : '') + '>' +
        '<td class="rk">' + (i + 1) + "</td>" +
        '<td class="team"><div class="team-cell">' + logoImg(p.team) + '<span class="nm">' + esc(p.team) +
          (champ ? ' <span class="champ-star">★</span>' : '') + "</span></div></td>" +
        '<td class="fifa">' + (p.fifaRank ? "#" + p.fifaRank : "–") + ' <span class="sub">' + p.fifa + "</span></td>" +
        "<td>" + (p.pts != null ? p.pts : "–") + ' <span class="sub">' + (p.gd != null ? (p.gd > 0 ? "+" + p.gd : p.gd) : "") + "</span></td>" +
        "<td>" + (p.xgdpg >= 0 ? "+" : "") + p.xgdpg.toFixed(2) + "</td>" +
        '<td><span class="delta ' + (formAdj > 2 ? "pos" : formAdj < -2 ? "neg" : "") + '">' + (formAdj >= 0 ? "+" : "") + Math.round(formAdj) + "</span></td>" +
        "<td>" + (p.squadRating != null ? p.squadRating.toFixed(2) : "–") +
          ' <span class="delta ' + (p.squadAdj > 2 ? "pos" : p.squadAdj < -2 ? "neg" : "") + '">' +
          (p.squadAdj >= 0 ? "+" : "") + Math.round(p.squadAdj) + "</span></td>" +
        '<td class="pwr"><div class="pwr-bar"><span style="width:' + w.toFixed(1) + '%"></span></div><b>' + Math.round(p.rating) + "</b></td>" +
        "</tr>";
    }).join("");
    host.innerHTML = '<table class="rank power-table"><thead><tr>' +
      "<th>#</th><th class='team'>Team</th><th>FIFA</th><th>Group</th><th>xGD/g</th><th>Form</th><th>Squad</th><th class='pwr'>Power Index</th>" +
      "</tr></thead><tbody>" + body + "</tbody></table>";

    renderPredChampion(P);
    renderPredRounds(P);
    renderPowerKO(list, P, K);
  }

  /* ---- Updated Power Index for Quarter-finalists and beyond ----
     The Round-of-32 index above is frozen at "pedigree + group-stage form". Once the Round
     of 16 is done we know who actually won knockout matches, so surviving teams get a second,
     updated index: their Round-of-32 rating plus a bonus for each knockout win (bigger for a
     later round and a wider margin, discounted if it took penalties). Rendered as a separate
     table below the original so both views stay visible. */
  var KO_ROUND_BASE = { R32: 16, R16: 22, QF: 28, SF: 34 };
  var KO_ROUND_LABEL = { R32: "Round of 32", R16: "Round of 16", QF: "quarter-final", SF: "semi-final" };
  function koRoundWin(m, team) {
    var isHome = m.home === team;
    if (m.hs === m.as) return isHome ? (m.hpen != null && m.hpen > m.apen) : (m.apen != null && m.apen > m.hpen);
    return isHome ? m.hs > m.as : m.as > m.hs;
  }
  function koBonusFor(team, K) {
    var bonus = 0, notes = [];
    ["R32", "R16", "QF", "SF"].forEach(function (rd) {
      (K.rounds[rd] || []).forEach(function (m) {
        if (!m.played || m.hs == null || m.as == null) return;
        if (m.home !== team && m.away !== team) return;
        if (!koRoundWin(m, team)) return;
        var isHome = m.home === team;
        var gf = isHome ? m.hs : m.as, ga = isHome ? m.as : m.hs;
        var opp = isHome ? m.away : m.home;
        var pens = gf === ga;
        var margin = Math.max(0, gf - ga);
        bonus += KO_ROUND_BASE[rd] + Math.min(margin, 3) * 4 - (pens ? 6 : 0);
        notes.push(opp + " " + gf + "–" + ga + (pens ? " (pens)" : "") + " in the " + KO_ROUND_LABEL[rd]);
      });
    });
    return { bonus: bonus, notes: notes };
  }
  function renderPowerKO(list, P, K) {
    var card = document.getElementById("powerKOCard"), host = document.getElementById("powerKOTable");
    if (!card || !host) return;
    // QF fixtures carry "Winner EF n" placeholders until the Round of 16 is actually played,
    // so use the real bracket resolver (koSide, same as the calendar/bracket views) rather
    // than the projection model — this table reports what happened, not what's predicted.
    var teamSet = {};
    var qfSet = K.rounds.QF && K.rounds.QF.length > 0 && K.rounds.QF.every(function (m) {
      var s0 = koSide(K, m, 0), s1 = koSide(K, m, 1);
      if (s0.team) teamSet[s0.team] = 1;
      if (s1.team) teamSet[s1.team] = 1;
      return !!(s0.team && s1.team);
    });
    if (!qfSet) { card.style.display = "none"; host.innerHTML = ""; return; }
    card.style.display = "";

    var oldRank = {};
    list.forEach(function (p, i) { oldRank[p.team] = i + 1; });

    var rows = Object.keys(teamSet).map(function (team) {
      var base = powerRating(team), ko = koBonusFor(team, K);
      return { team: team, base: base, ko: ko, rating: base.rating + ko.bonus };
    }).sort(function (a, b) { return b.rating - a.rating; });
    var maxR = rows[0].rating, minR = rows[rows.length - 1].rating, span = (maxR - minR) || 1;
    var champ = P && P.champion;

    var body = rows.map(function (p, i) {
      var w = ((p.rating - minR) / span) * 100;
      var old = oldRank[p.team];
      var delta = old ? old - (i + 1) : 0;
      var deltaTxt = delta > 0 ? "▲" + delta : delta < 0 ? "▼" + (-delta) : "–";
      var deltaCls = delta > 0 ? "pos" : delta < 0 ? "neg" : "";
      var explain = p.ko.notes.length
        ? "Beat " + p.ko.notes.join(", then beat ") + " — knockout form adds +" +
          Math.round(p.ko.bonus) + " to its Round-of-32 index of " + Math.round(p.base.rating) + "."
        : "No completed knockout matches yet — index unchanged from the Round-of-32 table.";
      return '<tr' + (champ === p.team ? ' class="champ-row"' : '') + '>' +
        '<td class="rk">' + (i + 1) + "</td>" +
        '<td class="team"><div class="team-cell">' + logoImg(p.team) + '<span class="nm">' + esc(p.team) +
          (champ === p.team ? ' <span class="champ-star">★</span>' : '') + "</span></div></td>" +
        '<td><span class="delta ' + deltaCls + '">' + deltaTxt + "</span></td>" +
        '<td><span class="delta ' + (p.ko.bonus > 0 ? "pos" : "") + '">+' + Math.round(p.ko.bonus) + "</span></td>" +
        '<td class="pwr"><div class="pwr-bar"><span style="width:' + w.toFixed(1) + '%"></span></div><b>' + Math.round(p.rating) + "</b></td>" +
        '<td class="why">' + esc(explain) + "</td>" +
        "</tr>";
    }).join("");

    host.innerHTML = '<table class="rank power-table power-table-ko"><thead><tr>' +
      "<th>#</th><th class='team'>Team</th><th>Δ vs R32</th><th>KO bonus</th><th class='pwr'>Power Index</th><th>Why</th>" +
      "</tr></thead><tbody>" + body + "</tbody></table>";
  }

  function predSide(p, name, isWin) {
    if (!name) return '<div class="ps tbd"><span class="nm">TBD</span></div>';
    var rt = powerRating(name);
    return '<div class="ps ' + (isWin ? "win" : "out") + '">' + logoImg(name, "ps-logo") +
      '<span class="nm">' + esc(name) + '</span><span class="pidx">' + Math.round(rt.rating) + "</span></div>";
  }
  function predCard(p, label) {
    if (!p) return "";
    var head = label ? '<div class="pc-tag">' + esc(label) + "</div>" : "";
    if (!p.winner) {
      return '<div class="pred-card">' + head + predSide(p, p.home, false) + predSide(p, p.away, false) +
        '<div class="pc-foot">Awaiting feeders</div></div>';
    }
    var hWin = p.winner === p.home;
    var sc = p.score, scoreTxt = hWin ? (sc.sf + "–" + sc.su) : (sc.su + "–" + sc.sf);
    var foot;
    if (p.actual) {
      foot = "Result: <b>" + esc(p.winner) + "</b> " + scoreTxt + (sc.pens ? " (pens)" : "") +
        (p.upset ? ' <span class="pc-upset">upset</span> — model favoured ' + esc(p.loser) +
          " (" + Math.round(p.favProb * 100) + "%)" : "");
    } else {
      foot = "Predicted: <b>" + esc(p.winner) + "</b> " + Math.round(p.favProb * 100) + "% · " +
        scoreTxt + (sc.pens ? " (pens)" : "");
    }
    return '<div class="pred-card' + (p.actual ? " pc-actual" : "") + '">' + head +
      predSide(p, p.home, hWin) + predSide(p, p.away, !hWin) +
      '<div class="pc-foot">' + foot + "</div></div>";
  }
  function renderPredRounds(P) {
    var host = document.getElementById("predRounds");
    if (!host || !P) return;
    var defs = [["R32", "Round of 32"], ["R16", "Round of 16"], ["QF", "Quarter-finals"], ["SF", "Semi-finals"]];
    var html = defs.map(function (d) {
      var cards = (P[d[0]] || []).map(function (p) { return predCard(p); }).join("");
      return '<div class="pred-round"><h4>' + d[1] + "</h4><div class=\"pred-grid\">" + cards + "</div></div>";
    }).join("");
    html += '<div class="pred-round"><h4>Final &amp; third place</h4><div class="pred-grid">' +
      predCard(P.F, "Final") + (P.TP ? predCard(P.TP, "3rd-place play-off") : "") + "</div></div>";
    host.innerHTML = html;
  }
  function renderPredChampion(P) {
    var host = document.getElementById("predChampion");
    if (!host) return;
    if (!P || !P.champion) { host.innerHTML = '<p class="hint">The predicted champion appears once the bracket is set.</p>'; return; }
    var f = P.F, runnerUp = f.winner === f.home ? f.away : f.home;
    var sc = f.score, hWin = f.winner === f.home;
    var scoreTxt = hWin ? (sc.sf + "–" + sc.su) : (sc.su + "–" + sc.sf);
    host.innerHTML = '<div class="champ-hero">' +
      '<div class="champ-badge">' + logoImg(P.champion, "champ-logo") +
        '<div class="champ-name">' + esc(P.champion) + '</div>' +
        '<div class="champ-sub">Projected World Cup 2026 winners</div></div>' +
      '<div class="champ-line">Predicted final: <b>' + esc(P.champion) + "</b> " + scoreTxt + (sc.pens ? " (pens)" : "") +
        " vs " + esc(runnerUp) + " · " + Math.round(f.favProb * 100) + "% win probability</div>" +
      "</div>";
  }

  /* ---------------- Standouts (player distributions) ----------------
     A density (KDE) plot of every qualifying player for a chosen stat: the curve
     shows how the field spreads, each dot is a player placed at their value (jittered
     under the curve), the dashed line is the mean, and players >= 2σ above the mean
     are flagged as anomalies (pink). A spotlight picker highlights one player (gold)
     and reports their percentile. All client-side from window.WC_PLAYERS. */
  var SO_STATS = [
    ["ga", "Goals + assists", 0], ["g", "Goals", 0], ["a", "Assists", 0],
    ["xg", "Expected goals (xG)", 2], ["xa", "Expected assists (xA)", 2],
    ["xg_diff", "Finishing (goals − xG)", 2], ["shots", "Shots", 0], ["sot", "Shots on target", 0],
    ["keyPasses", "Key passes", 0], ["progPasses", "Progressive passes", 0],
    ["dribbles", "Dribbles completed", 0], ["passes", "Passes", 0], ["tackles", "Tackles", 0],
    ["interceptions", "Interceptions", 0], ["clearances", "Clearances", 0],
    ["blocks", "Shots blocked", 0], ["clrBox", "Clearances in own box", 0], ["saves", "Saves", 0],
    ["xga", "xG faced (on pitch)", 2], ["xga90", "xG faced per 90", 2],
    ["gPrev", "Goals prevented (on pitch)", 2],
    ["touches", "Touches", 0], ["rating", "Average match rating", 2]
  ];
  var SO_POS_LABEL = { FWD: "attackers", MID: "midfielders", DEF: "defenders", GK: "goalkeepers" };
  var soState = { stat: "ga", pos: "all", mins: 90, player: "" };

  function soPosGroup(pos) {
    var s = (pos || "").toUpperCase();
    if (s === "GK") return "GK";
    if (s[0] === "F" || s === "ST" || s === "CF" || s[0] === "A") return "FWD";
    if (s[0] === "M" || s.indexOf("DM") === 0) return "MID";
    if (s[0] === "D" || s[0] === "W" || s === "B") return "DEF";
    return "OTH";
  }
  function soFmt(v, dp) { return dp ? (+v).toFixed(dp) : Math.round(v); }
  function normPdf(z) { return Math.exp(-0.5 * z * z) / 2.5066282746310002; }
  function soStatMeta() {
    for (var i = 0; i < SO_STATS.length; i++) if (SO_STATS[i][0] === soState.stat) return SO_STATS[i];
    return SO_STATS[0];
  }
  function soQualify() {
    return PLAYERS.filter(function (p) {
      if ((p.mins || 0) < soState.mins) return false;
      if (soState.pos !== "all" && soPosGroup(p.pos) !== soState.pos) return false;
      if (soState.stat === "rating" && !(p.rating > 0)) return false;  // unrated → not a data point
      return true;
    });
  }

  // Gaussian-kernel density chart with a jittered strip of player dots.
  function soDistChart(rows, statKey, dp, spotPid, mean, sd) {
    var W = 880, H = 380, padL = 22, padR = 22, padT = 20, padB = 50;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var vals = rows.map(function (p) { return +p[statKey] || 0; });
    var n = vals.length;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = (hi - lo) || 1;
    var xMin = statKey === "rating" ? lo - span * 0.06 : Math.min(lo, 0) - span * 0.03;
    var xMax = hi + span * 0.10;
    function sx(v) { return padL + plotW * (v - xMin) / (xMax - xMin); }
    var baseY = padT + plotH;
    var h = 1.06 * (sd || span * 0.1) * Math.pow(n, -0.2);
    if (!(h > 0)) h = span * 0.08;
    // KDE grid
    var GRID = 140, dens = [], maxD = 0;
    for (var i = 0; i <= GRID; i++) {
      var x = xMin + (xMax - xMin) * i / GRID, d = 0;
      for (var j = 0; j < n; j++) d += normPdf((x - vals[j]) / h);
      d /= (n * h);
      dens.push(d);
      if (d > maxD) maxD = d;
    }
    function densInterp(v) {
      var t = (v - xMin) / (xMax - xMin) * GRID;
      var i = Math.max(0, Math.min(GRID - 1, Math.floor(t))), frac = t - i;
      return dens[i] * (1 - frac) + dens[i + 1] * frac;
    }
    function sy(d) { return baseY - (maxD ? d / maxD : 0) * plotH; }
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="so-chart" preserveAspectRatio="xMidYMid meet" role="img">' + GLOW_DEFS];
    // filled density area
    var area = "M " + sx(xMin).toFixed(1) + " " + baseY.toFixed(1);
    for (var k = 0; k <= GRID; k++) area += " L " + sx(xMin + (xMax - xMin) * k / GRID).toFixed(1) + " " + sy(dens[k]).toFixed(1);
    area += " L " + sx(xMax).toFixed(1) + " " + baseY.toFixed(1) + " Z";
    svg.push('<path d="' + area + '" fill="rgba(78,161,255,0.10)" stroke="none"/>');
    // curve line
    var line = "";
    for (var k2 = 0; k2 <= GRID; k2++) line += (k2 ? " L " : "M ") + sx(xMin + (xMax - xMin) * k2 / GRID).toFixed(1) + " " + sy(dens[k2]).toFixed(1);
    svg.push('<path d="' + line + '" fill="none" stroke="#8aa0d8" stroke-width="1.4" stroke-opacity="0.85"/>');
    // baseline
    svg.push('<line x1="' + padL + '" y1="' + baseY.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + baseY.toFixed(1) + '" stroke="#262c52" stroke-width="1"/>');
    // x-axis ticks
    niceTicks(xMax, 6).forEach(function (t) {
      if (t < xMin - 1e-9 || t > xMax + 1e-9) return;
      svg.push('<line x1="' + sx(t).toFixed(1) + '" y1="' + baseY.toFixed(1) + '" x2="' + sx(t).toFixed(1) + '" y2="' + (baseY + 4).toFixed(1) + '" stroke="#33366e" stroke-width="1"/>');
      svg.push('<text x="' + sx(t).toFixed(1) + '" y="' + (baseY + 17) + '" fill="#7a7fb0" font-size="10.5" text-anchor="middle">' + fmtTick(t) + "</text>");
    });
    // average line
    var ax = sx(mean);
    svg.push('<line x1="' + ax.toFixed(1) + '" y1="' + padT + '" x2="' + ax.toFixed(1) + '" y2="' + baseY.toFixed(1) + '" stroke="#d6d9f5" stroke-width="1.2" stroke-dasharray="5 4" stroke-opacity="0.7"/>');
    svg.push('<text x="' + ax.toFixed(1) + '" y="' + (padT - 6) + '" fill="#d6d9f5" font-size="11" text-anchor="middle">average ' + soFmt(mean, dp || 1) + "</text>");
    // dots — deterministic jitter from pid so re-renders are stable
    function jit(pid) { var s = Math.sin((pid + 1) * 12.9898) * 43758.5453; return s - Math.floor(s); }
    rows.forEach(function (p) {
      var v = +p[statKey] || 0, z = sd ? (v - mean) / sd : 0;
      var dx = sx(v), band = (maxD ? densInterp(v) / maxD : 0) * plotH;
      var dy = baseY - 4 - jit(p.pid) * Math.max(6, band - 6);
      var isSpot = spotPid && p.pid === spotPid, anom = z >= 2;
      var r = isSpot ? 5.5 : anom ? 3.4 : 2.3;
      var fill = isSpot ? "#ffc857" : anom ? "#ff4fa8" : "#9d6bff";
      var op = isSpot ? 1 : anom ? 0.92 : 0.5;
      var stroke = (isSpot || anom) ? ' stroke="#050611" stroke-width="0.8"' : "";
      var info = p.name + " · " + p.team + " — " + soFmt(v, dp) + " (" + (z >= 0 ? "+" : "") + z.toFixed(1) + "σ)";
      svg.push('<circle cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) + '" r="' + r + '" fill="' + fill + '" fill-opacity="' + op + '"' + stroke + ' data-info="' + esc(info) + '"></circle>');
    });
    // labels: top anomalies by value, plus the spotlight player
    var labels = [];
    rows.slice().sort(function (a, b) { return (+b[statKey] || 0) - (+a[statKey] || 0); })
      .slice(0, 5).forEach(function (p) {
        var v = +p[statKey] || 0, z = sd ? (v - mean) / sd : 0;
        if (z < 1.2) return;
        labels.push({ x: sx(v), y: baseY - 6 - (maxD ? densInterp(v) / maxD : 0) * plotH, txt: p.name, gold: false });
      });
    if (spotPid) {
      var sp = rows.filter(function (p) { return p.pid === spotPid; })[0];
      if (sp) {
        var v = +sp[statKey] || 0;
        labels.push({ x: sx(v), y: baseY - 6 - (maxD ? densInterp(v) / maxD : 0) * plotH, txt: sp.name, gold: true });
      }
    }
    labels.sort(function (a, b) { return a.x - b.x; });
    var lastX = -999, tier = 0;
    labels.forEach(function (L) {
      tier = (L.x - lastX < 86) ? tier + 1 : 0; lastX = L.x;
      var ly = Math.max(padT + 6, L.y - 8 - tier * 13);
      var lx = Math.max(padL + 18, Math.min(W - padR - 18, L.x));
      svg.push('<line x1="' + L.x.toFixed(1) + '" y1="' + L.y.toFixed(1) + '" x2="' + lx.toFixed(1) + '" y2="' + ly.toFixed(1) + '" stroke="' + (L.gold ? "#ffc857" : "#ff4fa8") + '" stroke-width="0.7" stroke-opacity="0.6"/>');
      svg.push('<text x="' + lx.toFixed(1) + '" y="' + (ly - 3).toFixed(1) + '" fill="' + (L.gold ? "#ffd98a" : "#ff8fc4") + '" font-size="10.5" text-anchor="middle">' + esc(L.txt) + "</text>");
    });
    svg.push("</svg>");
    return svg.join("");
  }

  function renderStandouts() {
    if (!document.getElementById("view-standouts")) return;
    var setHTML = function (id, h) { var e = document.getElementById(id); if (e) e.innerHTML = h; };
    var meta = soStatMeta(), statKey = meta[0], label = meta[1], dp = meta[2];
    var rows = soQualify();
    setHTML("soChartTitle", label + " — distribution across " + rows.length + " players");
    setHTML("soChartHint", "Each dot is one player with " + (soState.mins ? soState.mins + "+ minutes" : "any minutes") +
      (soState.pos === "all" ? "" : " · " + SO_POS_LABEL[soState.pos]) + ". Pink = 2σ or more above average.");
    if (!rows.length) {
      setHTML("soChart", '<p class="hint">No players match these filters — try lowering the minimum minutes.</p>');
      ["soStats", "soStandouts", "soSpotlight"].forEach(function (id) { setHTML(id, ""); });
      return;
    }
    if (!(statKey in rows[0])) {
      setHTML("soChart", '<p class="hint">"' + esc(label) + '" isn\'t in the current data — the data files need regenerating with the latest pipeline.</p>');
      ["soStats", "soStandouts", "soSpotlight"].forEach(function (id) { setHTML(id, ""); });
      return;
    }
    var vals = rows.map(function (p) { return +p[statKey] || 0; }), n = vals.length;
    var mean = vals.reduce(function (s, v) { return s + v; }, 0) / n;
    var sd = Math.sqrt(vals.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / n);
    var sorted = rows.slice().sort(function (a, b) { return (+b[statKey] || 0) - (+a[statKey] || 0); });
    var leader = sorted[0], leadZ = sd ? ((+leader[statKey] || 0) - mean) / sd : 0;

    // spotlight resolution (exact name first, then substring)
    var spot = null;
    if (soState.player) {
      var q = soState.player.toLowerCase();
      spot = rows.filter(function (p) { return p.name.toLowerCase() === q; })[0] ||
        rows.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0; })[0] || null;
    }
    var spotPid = spot ? spot.pid : null;

    // stats strip
    var anomCount = rows.filter(function (p) { return sd && ((+p[statKey] || 0) - mean) / sd >= 2; }).length;
    var items = [
      ["v accent", soFmt(mean, dp || 1), "Average"],
      ["v blue", soFmt(sd, dp || 1), "Std dev (σ)"],
      ["v", n, "Players"],
      ["v", anomCount, "Anomalies (2σ+)"],
      ["v accent", soFmt(+leader[statKey] || 0, dp) + " <span style='font-size:13px;color:var(--muted)'>" + esc(leader.name) + "</span>", "Highest value"],
      ["v", "+" + leadZ.toFixed(1) + "σ", "Leader vs average"],
    ];
    setHTML("soStats", items.map(function (it) {
      return '<div class="stat"><div class="' + it[0] + '">' + it[1] + '</div><div class="k">' + it[2] + "</div></div>";
    }).join(""));

    setHTML("soChart", soDistChart(rows, statKey, dp, spotPid, mean, sd));

    // spotlight callout
    if (spot) {
      var sv = +spot[statKey] || 0, sz = sd ? (sv - mean) / sd : 0;
      var better = Math.min(99, Math.round(100 * rows.filter(function (p) { return (+p[statKey] || 0) < sv; }).length / n));
      setHTML("soSpotlight",
        '<div class="so-spot"><span class="so-spot-tag">spotlight</span> <b>' + esc(spot.name) + "</b> (" + esc(spot.team) +
        (spot.pos ? ", " + esc(spot.pos) : "") + ") — <b>" + soFmt(sv, dp) + "</b> " + esc(label.toLowerCase()) +
        ', <b style="color:' + (sz >= 0 ? "var(--good)" : "var(--bad)") + '">' + (sz >= 0 ? "+" : "") + sz.toFixed(1) +
        "σ</b> " + (sz >= 0 ? "over" : "below") + " average — better than <b>" + better + "%</b> of " +
        (soState.pos === "all" ? "players" : "players in this position") + ".</div>");
    } else if (soState.player) {
      setHTML("soSpotlight", '<span class="hint">No qualifying player matches "' + esc(soState.player) + '". Check the spelling or relax the filters.</span>');
    } else {
      setHTML("soSpotlight", '<span class="hint">Tip: type a name in <b>Spotlight player</b> to highlight one player (gold) and see their percentile.</span>');
    }

    // standouts bars — top by σ over average
    var top = sorted.slice(0, 12).map(function (p) {
      var v = +p[statKey] || 0; return { p: p, v: v, z: sd ? (v - mean) / sd : 0 };
    });
    var maxZ = Math.max.apply(null, top.map(function (t) { return t.z; }).concat([0.001]));
    setHTML("soStandouts", '<div class="so-bars">' + top.map(function (t) {
      var pct = Math.max(2, 100 * t.z / maxZ), hot = t.z >= 2;
      return '<div class="so-bar-row"><div class="nm">' + logoImg(t.p.team) + "<span>" + esc(t.p.name) + "</span></div>" +
        '<div class="so-bar-track"><div class="so-bar-fill" style="width:' + pct.toFixed(1) + "%;background:" + (hot ? "#ff4fa8" : "var(--accent-2)") + '"></div></div>' +
        '<div class="so-bar-val">' + soFmt(t.v, dp) + ' <span class="so-z">' + (t.z >= 0 ? "+" : "") + t.z.toFixed(1) + "σ</span></div></div>";
    }).join("") + "</div>");
  }

  /* ---- Two-stat scatter (find the complete players) ---- */
  var soSc = { x: "tackles", y: "gPrev", size: "xga", pos: "DEF", mins: 180 };
  var SO_PRESETS = [
    { label: "🧱 Solid defenders", x: "tackles", y: "gPrev", size: "xga", pos: "DEF", mins: 180 },
    { label: "🚧 Shot blockers", x: "blocks", y: "clrBox", size: "interceptions", pos: "DEF", mins: 90 },
    { label: "🧤 Shot-stoppers", x: "xga", y: "gPrev", size: "saves", pos: "GK", mins: 180 },
    { label: "🎨 Creators", x: "xa", y: "a", size: "keyPasses", pos: "all", mins: 180 },
    { label: "🛡 Ball winners", x: "tackles", y: "interceptions", size: "clearances", pos: "DEF", mins: 180 },
    { label: "🎯 Finishers", x: "xg", y: "g", size: "shots", pos: "all", mins: 90 },
    { label: "⚡ Dribble & create", x: "dribbles", y: "keyPasses", size: "xa", pos: "all", mins: 180 }
  ];
  function soStatLabel(k) { var m = SO_STATS.filter(function (s) { return s[0] === k; })[0]; return m ? m[1] : k; }
  function soStatDp(k) { var m = SO_STATS.filter(function (s) { return s[0] === k; })[0]; return m ? m[2] : 0; }
  function soNiceStep(raw) {
    raw = raw || 1; var pow = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  }
  function soLTicks(lo, hi) {
    var step = soNiceStep((hi - lo) / 5), start = Math.ceil(lo / step - 1e-9) * step, out = [];
    for (var v = start; v <= hi + 1e-9; v += step) out.push(+v.toFixed(4));
    return out;
  }
  function soQualifyFor(pos, mins) {
    return PLAYERS.filter(function (p) {
      if ((p.mins || 0) < mins) return false;
      if (pos !== "all" && soPosGroup(p.pos) !== pos) return false;
      return true;
    });
  }

  function soScatterSVG(rows, xKey, yKey, sizeKey, spotPid) {
    var W = 880, H = 480, padL = 56, padR = 22, padT = 22, padB = 54;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var xs = rows.map(function (p) { return +p[xKey] || 0; });
    var ys = rows.map(function (p) { return +p[yKey] || 0; });
    var mean = function (a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; };
    var stdev = function (a, m) { return Math.sqrt(a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / a.length); };
    var mx = mean(xs), my = mean(ys), sdx = stdev(xs, mx) || 1, sdy = stdev(ys, my) || 1;
    function dom(vals) {
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      lo = Math.min(lo, 0); var pad = (hi - lo) * 0.08 || 1;
      return [lo - (lo < 0 ? pad * 0.4 : 0), hi + pad];
    }
    var dx = dom(xs), dy = dom(ys);
    function sx(v) { return padL + plotW * (v - dx[0]) / (dx[1] - dx[0]); }
    function sy(v) { return padT + plotH * (1 - (v - dy[0]) / (dy[1] - dy[0])); }
    var sizeMax = sizeKey ? Math.max.apply(null, rows.map(function (p) { return +p[sizeKey] || 0; }).concat([0.0001])) : 1;
    function radius(p) { if (!sizeKey) return 4.2; return 3 + 9 * Math.sqrt(Math.max(0, +p[sizeKey] || 0) / sizeMax); }
    var dpx = soStatDp(xKey), dpy = soStatDp(yKey), dps = soStatDp(sizeKey);
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="so-chart" preserveAspectRatio="xMidYMid meet" role="img">' + GLOW_DEFS];
    // gridlines + ticks
    soLTicks(dx[0], dx[1]).forEach(function (t) {
      var x = sx(t);
      svg.push('<line x1="' + x.toFixed(1) + '" y1="' + padT + '" x2="' + x.toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="#0b0d1f" stroke-width="1"/>');
      svg.push('<text x="' + x.toFixed(1) + '" y="' + (padT + plotH + 16) + '" fill="#7a7fb0" font-size="10.5" text-anchor="middle">' + soFmt(t, dpx) + "</text>");
    });
    soLTicks(dy[0], dy[1]).forEach(function (t) {
      var y = sy(t);
      svg.push('<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#0b0d1f" stroke-width="1"/>');
      svg.push('<text x="' + (padL - 7) + '" y="' + (y + 3.5).toFixed(1) + '" fill="#7a7fb0" font-size="10.5" text-anchor="end">' + soFmt(t, dpy) + "</text>");
    });
    // average lines
    svg.push('<line x1="' + sx(mx).toFixed(1) + '" y1="' + padT + '" x2="' + sx(mx).toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="#d6d9f5" stroke-width="1" stroke-dasharray="5 4" stroke-opacity="0.5"/>');
    svg.push('<line x1="' + padL + '" y1="' + sy(my).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + sy(my).toFixed(1) + '" stroke="#d6d9f5" stroke-width="1" stroke-dasharray="5 4" stroke-opacity="0.5"/>');
    // axis titles
    svg.push('<text x="' + (padL + plotW / 2).toFixed(1) + '" y="' + (H - 6) + '" fill="#eef0fb" font-size="12.5" text-anchor="middle">' + esc(soStatLabel(xKey)) + " →</text>");
    svg.push('<text x="16" y="' + (padT + plotH / 2).toFixed(1) + '" fill="#eef0fb" font-size="12.5" text-anchor="middle" transform="rotate(-90 16 ' + (padT + plotH / 2).toFixed(1) + ')">' + esc(soStatLabel(yKey)) + " →</text>");
    // dots
    var pts = [];
    rows.forEach(function (p) {
      var vx = +p[xKey] || 0, vy = +p[yKey] || 0;
      var cx = sx(vx), cy = sy(vy), r = radius(p);
      var elite = vx > mx && vy > my;
      var isSpot = spotPid && p.pid === spotPid;
      var fill = isSpot ? "#ffc857" : elite ? "#ff4fa8" : "#9d6bff";
      var op = isSpot ? 1 : elite ? 0.85 : 0.5;
      var stroke = (isSpot || elite) ? ' stroke="#050611" stroke-width="0.9"' : "";
      var glow = isSpot ? ' filter="url(#wcGlow)"' : "";
      var info = p.name + " · " + p.team + " — " + soStatLabel(xKey) + " " + soFmt(vx, dpx) +
        ", " + soStatLabel(yKey) + " " + soFmt(vy, dpy) + (sizeKey ? " · " + soStatLabel(sizeKey) + " " + soFmt(+p[sizeKey] || 0, dps) : "");
      svg.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + fill + '" fill-opacity="' + op + '"' + stroke + glow + ' data-info="' + esc(info) + '"></circle>');
      var zx = (vx - mx) / sdx, zy = (vy - my) / sdy;
      pts.push({ p: p, cx: cx, cy: cy, score: zx + zy, team: p.name, spot: isSpot });
    });
    // label top performers (by combined z) + the spotlight player
    var labelSet = pts.slice().sort(function (a, b) { return b.score - a.score; }).filter(function (q) { return q.score > 1.4; }).slice(0, 9);
    pts.forEach(function (q) { if (q.spot && labelSet.indexOf(q) < 0) labelSet.push(q); });
    declutter(labelSet, 8.7);
    labelSet.forEach(function (q) {
      if (q.led) svg.push('<line x1="' + q.cx.toFixed(1) + '" y1="' + q.cy.toFixed(1) + '" x2="' + (q.lx - 1).toFixed(1) + '" y2="' + (q.ly - 3).toFixed(1) + '" stroke="#33366e" stroke-width="0.6"/>');
      svg.push('<text x="' + q.lx.toFixed(1) + '" y="' + q.ly.toFixed(1) + '" fill="' + (q.spot ? "#ffd98a" : "#d6d9f5") + '" font-size="8.9">' + esc(q.team) + "</text>");
    });
    svg.push("</svg>");
    return svg.join("");
  }

  function renderScatter2() {
    var host = document.getElementById("soScatter");
    if (!host) return;
    var rows = soQualifyFor(soSc.pos, soSc.mins);
    var setHTML = function (id, h) { var e = document.getElementById(id); if (e) e.innerHTML = h; };
    if (rows.length < 3) {
      host.innerHTML = '<p class="hint">Not enough players match these filters.</p>';
      setHTML("soScInsight", "");
      return;
    }
    // guard: a stat missing from the dataset (e.g. data regenerated by an older pipeline)
    var missing = [soSc.x, soSc.y, soSc.size].filter(function (k) { return k && !(k in rows[0]); });
    if (missing.length) {
      host.innerHTML = '<p class="hint">Some selected metrics (' + missing.map(soStatLabel).join(", ") +
        ') aren\'t in the current data — the data files need regenerating with the latest pipeline.</p>';
      setHTML("soScInsight", "");
      return;
    }
    var spot = null;
    if (soState.player) {
      var q = soState.player.toLowerCase();
      spot = rows.filter(function (p) { return p.name.toLowerCase() === q; })[0] ||
        rows.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0; })[0] || null;
    }
    host.innerHTML = soScatterSVG(rows, soSc.x, soSc.y, soSc.size, spot ? spot.pid : null);
    // top-right complete players (above average in BOTH)
    var xs = rows.map(function (p) { return +p[soSc.x] || 0; }), ys = rows.map(function (p) { return +p[soSc.y] || 0; });
    var mx = xs.reduce(function (s, v) { return s + v; }, 0) / xs.length;
    var my = ys.reduce(function (s, v) { return s + v; }, 0) / ys.length;
    var elite = rows.filter(function (p) { return (+p[soSc.x] || 0) > mx && (+p[soSc.y] || 0) > my; });
    var best = elite.slice().sort(function (a, b) {
      return ((+b[soSc.x] || 0) / (mx || 1) + (+b[soSc.y] || 0) / (my || 1)) - ((+a[soSc.x] || 0) / (mx || 1) + (+a[soSc.y] || 0) / (my || 1));
    }).slice(0, 5).map(function (p) { return esc(p.name); });
    setHTML("soScInsight", "<b>" + elite.length + "</b> player" + (elite.length === 1 ? "" : "s") +
      " are above average in <b>both</b> " + esc(soStatLabel(soSc.x).toLowerCase()) + " and " + esc(soStatLabel(soSc.y).toLowerCase()) +
      " (top-right quadrant)" + (best.length ? " — led by " + best.join(", ") : "") + "." +
      (soSc.size ? ' Dot size = ' + esc(soStatLabel(soSc.size).toLowerCase()) + "." : ""));
  }

  /* ---- Player percentile radar (uses the shared spotlight player) ---- */
  var RADAR_OUT = [["g", "Goals"], ["a", "Assists"], ["xa", "xA"], ["keyPasses", "Key passes"],
    ["progPasses", "Prog passes"], ["dribbles", "Dribbles"], ["tackles", "Tackles"], ["interceptions", "Intercept"]];
  var RADAR_GK = [["saves", "Saves"], ["gPrev", "Goals prevented"], ["xga", "xG faced"],
    ["passes", "Passes"], ["pass_pct", "Pass %"], ["clrBox", "Box clears"]];

  function radarSVG(player) {
    var grp = soPosGroup(player.pos);
    var axes = grp === "GK" ? RADAR_GK : RADAR_OUT;
    function inPool(p) {
      if ((p.mins || 0) < 90) return false;
      var g = soPosGroup(p.pos);
      if (grp === "GK") return g === "GK";
      if (grp === "OTH") return g !== "GK";
      return g === grp;
    }
    var pool = PLAYERS.filter(inPool);
    if (pool.indexOf(player) < 0) pool.push(player);
    var N = axes.length, W = 580, H = 470, cx = W / 2, cy = H / 2 + 4, R = 148;
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="so-radar" preserveAspectRatio="xMidYMid meet" role="img">' + GLOW_DEFS];
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var pts = [];
      for (var i = 0; i < N; i++) { var a = -Math.PI / 2 + i * 2 * Math.PI / N; pts.push((cx + R * f * Math.cos(a)).toFixed(1) + "," + (cy + R * f * Math.sin(a)).toFixed(1)); }
      svg.push('<polygon points="' + pts.join(" ") + '" fill="none" stroke="#14152e" stroke-width="1"/>');
    });
    var poly = [];
    axes.forEach(function (ax, i) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / N;
      svg.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + R * Math.cos(a)).toFixed(1) + '" y2="' + (cy + R * Math.sin(a)).toFixed(1) + '" stroke="#14152e" stroke-width="1"/>');
      var pv = +player[ax[0]] || 0;
      var below = pool.filter(function (p) { return (+p[ax[0]] || 0) < pv; }).length;
      var pct = pool.length ? below / pool.length : 0;
      poly.push((cx + R * pct * Math.cos(a)).toFixed(1) + "," + (cy + R * pct * Math.sin(a)).toFixed(1));
      var lx = cx + (R + 16) * Math.cos(a), ly = cy + (R + 16) * Math.sin(a);
      var anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : (Math.cos(a) > 0 ? "start" : "end");
      svg.push('<text x="' + lx.toFixed(1) + '" y="' + (ly - 2).toFixed(1) + '" fill="#a8ace0" font-size="10.5" text-anchor="' + anchor + '">' + esc(ax[1]) + "</text>");
      svg.push('<text x="' + lx.toFixed(1) + '" y="' + (ly + 10).toFixed(1) + '" fill="#eef0fb" font-size="11" font-weight="700" text-anchor="' + anchor + '">' + soFmt(pv, soStatDp(ax[0])) + " (" + Math.round(pct * 100) + "%)</text>");
    });
    svg.push('<polygon points="' + poly.join(" ") + '" fill="rgba(255,210,77,0.18)" stroke="#ffc857" stroke-width="2" filter="url(#wcGlow)"/>');
    poly.forEach(function (pt) { var c = pt.split(","); svg.push('<circle cx="' + c[0] + '" cy="' + c[1] + '" r="3" fill="#ffc857" filter="url(#wcGlow)"/>'); });
    svg.push("</svg>");
    return svg.join("");
  }

  function renderRadar() {
    var host = document.getElementById("soRadar");
    if (!host) return;
    if (!soState.player) {
      host.innerHTML = '<p class="hint">Pick a <b>spotlight player</b> at the top of this page to see their percentile radar.</p>';
      return;
    }
    var q = soState.player.toLowerCase();
    var pl = PLAYERS.filter(function (p) { return p.name.toLowerCase() === q; })[0] ||
      PLAYERS.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0; })[0];
    if (!pl) { host.innerHTML = '<p class="hint">No player matches "' + esc(soState.player) + '".</p>'; return; }
    var grp = soPosGroup(pl.pos);
    var grpLabel = { FWD: "attackers", MID: "midfielders", DEF: "defenders", GK: "goalkeepers", OTH: "outfield players" }[grp] || "peers";
    host.innerHTML = '<div class="so-radar-head"><b>' + esc(pl.name) + "</b> · " + esc(pl.team) +
      (pl.pos ? " · " + esc(pl.pos) : "") + " — percentiles vs other " + grpLabel + " (90+ min)</div>" + radarSVG(pl);
  }

  /* Tap-to-identify: SVG dots carry data-info; on tap/click show it in a caption line
     below the chart (and highlight the dot). Hover still works via <title> on desktop,
     but tap is the only way on touch devices. Delegated on the persistent container so
     it survives the chart's innerHTML being re-rendered. */
  // data-info is "Title — detail"; format like the rest of the graphs' tooltip.
  function tipHTML(info) {
    var i = info.indexOf(" — ");
    var a = i >= 0 ? info.slice(0, i) : info, b = i >= 0 ? info.slice(i + 3) : "";
    return '<div class="t-team">' + esc(a) + "</div>" + (b ? '<div class="t-line">' + esc(b) + "</div>" : "");
  }
  function wireChartTaps(hostId, tipId) {
    var host = document.getElementById(hostId), tip = document.getElementById(tipId);
    if (!host || host._tapWired) return;
    host._tapWired = true;
    var last = null;
    function isDot(el) { return el && (el.tagName || "").toLowerCase() === "circle" && el.hasAttribute("data-info"); }
    // desktop hover: the same floating tooltip the other charts use
    host.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      if (isDot(e.target)) {
        tooltip.innerHTML = tipHTML(e.target.getAttribute("data-info"));
        tooltip.style.opacity = "1";
        tooltip.style.left = (e.clientX + 14) + "px";
        tooltip.style.top = (e.clientY + 14) + "px";
      } else { tooltip.style.opacity = "0"; }
    });
    host.addEventListener("pointerleave", function () { tooltip.style.opacity = "0"; });
    // touch tap: highlight the dot + show its details in the caption line (a tooltip
    // under the finger would be hidden), plus the floating tooltip at the tap point.
    host.addEventListener("click", function (e) {
      if (!isDot(e.target)) return;
      var el = e.target;
      if (last && last.parentNode) { last.setAttribute("stroke", last._os || "none"); last.setAttribute("stroke-width", last._ow || "0"); }
      el._os = el.getAttribute("stroke") || "none"; el._ow = el.getAttribute("stroke-width") || "0";
      el.setAttribute("stroke", "#fff"); el.setAttribute("stroke-width", "2");
      last = el;
      if (tip) { tip.textContent = el.getAttribute("data-info"); tip.classList.add("show"); }
    });
  }

  function initStandouts() {
    var statSel = document.getElementById("soStat");
    if (!statSel) return;
    if (!PLAYERS.length) {
      var c = document.getElementById("soChart");
      if (c) c.innerHTML = '<p class="hint">No player data available yet.</p>';
      return;
    }
    statSel.innerHTML = SO_STATS.map(function (s) { return '<option value="' + s[0] + '">' + esc(s[1]) + "</option>"; }).join("");
    statSel.value = soState.stat;
    var dl = document.getElementById("soPlayerList");
    if (dl) dl.innerHTML = PLAYERS.map(function (p) { return p.name; }).sort()
      .map(function (nm) { return '<option value="' + esc(nm) + '">'; }).join("");
    statSel.addEventListener("change", function () { soState.stat = statSel.value; renderStandouts(); });
    document.getElementById("soPos").addEventListener("change", function (e) { soState.pos = e.target.value; renderStandouts(); });
    document.getElementById("soMins").addEventListener("change", function (e) { soState.mins = +e.target.value; renderStandouts(); });
    var pin = document.getElementById("soPlayer"), deb;
    pin.addEventListener("input", function () {
      clearTimeout(deb);
      deb = setTimeout(function () { soState.player = pin.value.trim(); renderStandouts(); renderScatter2(); renderRadar(); }, 200);
    });
    renderStandouts();
    renderRadar();
    wireChartTaps("soChart", "soChartTip");
    wireChartTaps("soScatter", "soScatterTip");

    // --- two-stat scatter controls ---
    var axisOpts = SO_STATS.map(function (s) { return '<option value="' + s[0] + '">' + esc(s[1]) + "</option>"; }).join("");
    var xSel = document.getElementById("soScX"), ySel = document.getElementById("soScY"), sizeSel = document.getElementById("soScSize");
    if (xSel) {
      xSel.innerHTML = axisOpts; ySel.innerHTML = axisOpts;
      sizeSel.innerHTML = '<option value="">— none —</option>' + axisOpts;
      function syncScatterControls() {
        xSel.value = soSc.x; ySel.value = soSc.y; sizeSel.value = soSc.size;
        document.getElementById("soScPos").value = soSc.pos;
        document.getElementById("soScMins").value = String(soSc.mins);
      }
      syncScatterControls();
      xSel.addEventListener("change", function () { soSc.x = xSel.value; renderScatter2(); });
      ySel.addEventListener("change", function () { soSc.y = ySel.value; renderScatter2(); });
      sizeSel.addEventListener("change", function () { soSc.size = sizeSel.value; renderScatter2(); });
      document.getElementById("soScPos").addEventListener("change", function (e) { soSc.pos = e.target.value; renderScatter2(); });
      document.getElementById("soScMins").addEventListener("change", function (e) { soSc.mins = +e.target.value; renderScatter2(); });
      var pHost = document.getElementById("soPresets");
      pHost.innerHTML = SO_PRESETS.map(function (pr, i) {
        var on = pr.x === soSc.x && pr.y === soSc.y && pr.pos === soSc.pos;
        return '<button class="so-preset' + (on ? " active" : "") + '" data-i="' + i + '">' + esc(pr.label) + "</button>";
      }).join("");
      pHost.querySelectorAll(".so-preset").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var pr = SO_PRESETS[+btn.dataset.i];
          soSc.x = pr.x; soSc.y = pr.y; soSc.size = pr.size; soSc.pos = pr.pos; soSc.mins = pr.mins;
          pHost.querySelectorAll(".so-preset").forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          syncScatterControls();
          renderScatter2();
        });
      });
      renderScatter2();
    }
  }

  /* ---------------- Team Lab (shot map + style fingerprint) ----------------
     Tournament-wide shot data (window.WC_SHOTS, built by build_shots.py) drives a
     per-team shot map / xG heatmap; team play-style is a percentile radar built from
     the data.js team stats plus the shot dataset. WhoScored coords attack toward
     x=100; the pitch is drawn goal-at-top (attacking ↑). */
  var SHOTS = (window.WC_SHOTS || []);
  var tlState = { team: "all", teamB: "none", teamC: "none", filter: "all", sit: "all", mode: "dots" };
  var TL_COLORS = ["#9d6bff", "#ff4fa8", "#ffc857"];  // up to 3 compared teams

  function tlMatchSit(s, sit) {
    if (sit === "all") return true;
    if (sit === "open") return s.s === "Open Play" || s.s === "Fast Break";
    if (sit === "set") return s.s === "Corner" || s.s === "Free Kick" || s.s === "Set Piece";
    if (sit === "pen") return s.s === "Penalty";
    return true;
  }
  function tlShotsFor(team) {
    return SHOTS.filter(function (s) {
      if (team !== "all" && s.t !== team) return false;
      if (tlState.filter === "ot" && !s.ot) return false;
      if (tlState.filter === "goal" && !s.g) return false;
      return tlMatchSit(s, tlState.sit);
    });
  }

  // Half-pitch (attacking up, goal at top), WhoScored coords. Returns {svg:[], px, py}.
  function tlPitch(W, H) {
    var padX = 12, padTop = 12, padBot = 12;
    var plotW = W - padX * 2, plotH = H - padTop - padBot;
    function px(yws) { return padX + plotW * (yws / 100); }                  // width across
    function py(xws) { return padTop + plotH * (1 - (Math.max(50, Math.min(100, xws)) - 50) / 50); } // length up
    var st = 'stroke="#33366e" stroke-width="1.3" fill="none"';
    var svg = [];
    svg.push('<rect x="' + px(0).toFixed(1) + '" y="' + py(100).toFixed(1) + '" width="' + (px(100) - px(0)).toFixed(1) + '" height="' + (py(50) - py(100)).toFixed(1) + '" ' + st + ' rx="2"/>');
    // penalty area (xws 83-100, yws 21.1-78.9)
    svg.push('<rect x="' + px(21.1).toFixed(1) + '" y="' + py(100).toFixed(1) + '" width="' + (px(78.9) - px(21.1)).toFixed(1) + '" height="' + (py(83) - py(100)).toFixed(1) + '" ' + st + '/>');
    // 6-yard box (xws 94.2-100, yws 36.8-63.2)
    svg.push('<rect x="' + px(36.8).toFixed(1) + '" y="' + py(100).toFixed(1) + '" width="' + (px(63.2) - px(36.8)).toFixed(1) + '" height="' + (py(94.2) - py(100)).toFixed(1) + '" ' + st + '/>');
    // goal
    svg.push('<rect x="' + px(44.2).toFixed(1) + '" y="' + (py(100) - 4).toFixed(1) + '" width="' + (px(55.8) - px(44.2)).toFixed(1) + '" height="4" stroke="#6f7fb0" fill="none"/>');
    // penalty spot + arc (the D)
    svg.push('<circle cx="' + px(50).toFixed(1) + '" cy="' + py(88.5).toFixed(1) + '" r="1.8" fill="#33366e"/>');
    var ay = py(83);
    svg.push('<path d="M ' + px(36).toFixed(1) + ' ' + ay.toFixed(1) + ' A ' + ((px(64) - px(36)) / 2).toFixed(1) + ' ' + (py(83) - py(73)).toFixed(1) + ' 0 0 1 ' + px(64).toFixed(1) + ' ' + ay.toFixed(1) + '" ' + st + '/>');
    // halfway line + centre arc (bottom)
    svg.push('<line x1="' + px(0).toFixed(1) + '" y1="' + py(50).toFixed(1) + '" x2="' + px(100).toFixed(1) + '" y2="' + py(50).toFixed(1) + '" ' + st + '/>');
    svg.push('<path d="M ' + px(40).toFixed(1) + ' ' + py(50).toFixed(1) + ' A ' + ((px(60) - px(40)) / 2).toFixed(1) + ' ' + (py(50) - py(60)).toFixed(1) + ' 0 0 1 ' + px(60).toFixed(1) + ' ' + py(50).toFixed(1) + '" ' + st + '/>');
    return { svg: svg, px: px, py: py };
  }

  /* Goal-placement ("behind the net") map — every on-target shot plotted where it
     crossed the goal line (WhoScored GoalMouthY across / GoalMouthZ height, crossbar
     ≈ 38), goalkeeper's view. Aggregates a team's placement across the whole tournament,
     the Team-Lab complement to the per-match on-target map on the match pages. */
  function tlGoalMouth(shots) {
    var GW = 100, GROUND = 50, GY0 = 43, GYR = 14, GZTOP = 48;
    function gxOf(gy) { return (Math.max(GY0, Math.min(GY0 + GYR, gy)) - GY0) / GYR * GW; }
    function gyOf(gz) { return GROUND - Math.max(0, Math.min(GZTOP, gz)); }
    var postL = gxOf(45.2), postR = gxOf(54.8), barY = gyOf(38);
    var svg = ['<svg viewBox="-2 -2 104 56" class="tl-goalmouth" preserveAspectRatio="xMidYMid meet" role="img">'];
    svg.push('<rect x="-2" y="-2" width="104" height="' + (GROUND + 6) + '" fill="#0b0d1f"/>');
    svg.push('<rect x="' + postL.toFixed(1) + '" y="' + barY.toFixed(1) + '" width="' + (postR - postL).toFixed(1) +
      '" height="' + (GROUND - barY).toFixed(1) + '" fill="rgba(255,255,255,0.04)"/>');
    var ng = "rgba(255,255,255,0.13)", nx, ny;
    for (nx = postL; nx <= postR + 0.01; nx += 3.2) svg.push('<line x1="' + nx.toFixed(1) + '" y1="' + barY.toFixed(1) + '" x2="' + nx.toFixed(1) + '" y2="' + GROUND + '" stroke="' + ng + '" stroke-width="0.18"/>');
    for (ny = barY; ny <= GROUND + 0.01; ny += 3.0) svg.push('<line x1="' + postL.toFixed(1) + '" y1="' + ny.toFixed(1) + '" x2="' + postR.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="' + ng + '" stroke-width="0.18"/>');
    svg.push('<line x1="0" y1="' + GROUND + '" x2="' + GW + '" y2="' + GROUND + '" stroke="rgba(255,255,255,0.3)" stroke-width="0.4"/>');
    var fr = "#eef0fb";
    svg.push('<line x1="' + postL.toFixed(1) + '" y1="' + GROUND + '" x2="' + postL.toFixed(1) + '" y2="' + barY.toFixed(1) + '" stroke="' + fr + '" stroke-width="1.1"/>');
    svg.push('<line x1="' + postR.toFixed(1) + '" y1="' + GROUND + '" x2="' + postR.toFixed(1) + '" y2="' + barY.toFixed(1) + '" stroke="' + fr + '" stroke-width="1.1"/>');
    svg.push('<line x1="' + (postL - 0.55).toFixed(1) + '" y1="' + barY.toFixed(1) + '" x2="' + (postR + 0.55).toFixed(1) + '" y2="' + barY.toFixed(1) + '" stroke="' + fr + '" stroke-width="1.1"/>');
    var onT = shots.filter(function (s) { return s.ot && s.gy != null && s.gz != null; });
    onT.sort(function (a, b) { return (a.g ? 1 : 0) - (b.g ? 1 : 0); }).forEach(function (s) {
      var cx = GW - gxOf(s.gy), cy = gyOf(s.gz);   // GW − x → goalkeeper's view (matches match.js)
      var r = 1.1 + 2.6 * Math.sqrt(Math.max(0, s.xg));
      var fill = s.g ? "#ff4fa8" : "#9d6bff", op = s.g ? 0.95 : 0.55;
      var info = s.t + " vs " + s.o + " — xG " + s.xg.toFixed(2) + (s.g ? " (GOAL)" : " (saved)") + " · " + s.s + " · " + s.m + "'";
      svg.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + fill + '" fill-opacity="' + op + '"' + (s.g ? ' stroke="#050611" stroke-width="0.5"' : "") + ' data-info="' + esc(info) + '"></circle>');
    });
    svg.push("</svg>");
    if (!onT.length) return '<p class="hint">No on-target shots with goal-mouth data for this selection.</p>';
    return '<p class="hint tl-gm-note">Goalkeeper\'s view · ' + onT.length + ' on-target shots (dot size = xG) · ' +
      '<b style="color:#ff4fa8">goals</b> / <b style="color:#9d6bff">saved</b></p>' + svg.join("");
  }

  function tlShotMap(shots) {
    if (tlState.mode === "goal") return tlGoalMouth(shots);
    var W = 600, H = 470;
    var P = tlPitch(W, H);
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="tl-pitch" preserveAspectRatio="xMidYMid meet" role="img">' + GLOW_DEFS];
    svg.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#0d1322"/>');
    svg = svg.concat(P.svg);
    if (tlState.mode === "heat") {
      // bin the half pitch into cells, shade by summed xG
      var CW = 12, CH = 10; // columns (width) x rows (length)
      var cells = [];
      for (var i = 0; i < CW * CH; i++) cells.push(0);
      shots.forEach(function (s) {
        // Flip WhoScored y (100 - y) into broadcast/PNG orientation, matching
        // match.js ty(), renderer build_shot_df (80 - y) and Player Lab plMapX.
        // Raw y is the attacker's-left frame and mirrors the shot map left↔right.
        var cx = Math.min(CW - 1, Math.max(0, Math.floor((100 - s.y) / 100 * CW)));
        var cr = Math.min(CH - 1, Math.max(0, Math.floor((Math.max(50, Math.min(100, s.x)) - 50) / 50 * CH)));
        cells[cr * CW + cx] += s.xg;
      });
      var maxC = Math.max.apply(null, cells.concat([0.0001]));
      var x0 = P.px(0), x1 = P.px(100), y0 = P.py(50), y1 = P.py(100);
      var cw = (x1 - x0) / CW, ch = (y0 - y1) / CH;
      for (var r = 0; r < CH; r++) for (var c = 0; c < CW; c++) {
        var v = cells[r * CW + c]; if (v <= 0) continue;
        var op = 0.08 + 0.78 * (v / maxC);
        var rx = x0 + c * cw, ry = y1 + (CH - 1 - r) * ch;
        svg.push('<rect x="' + rx.toFixed(1) + '" y="' + ry.toFixed(1) + '" width="' + cw.toFixed(1) + '" height="' + ch.toFixed(1) + '" fill="#ff6a3d" fill-opacity="' + op.toFixed(3) + '"/>');
      }
      svg = svg.concat(P.svg); // redraw markings over the heat
    } else {
      // individual shots, sized by xG, drawn faint→goals on top
      shots.slice().sort(function (a, b) { return (a.g ? 1 : 0) - (b.g ? 1 : 0); }).forEach(function (s) {
        var r = 2.3 + 6 * Math.sqrt(Math.max(0, s.xg));
        var fill = s.g ? "#ff4fa8" : s.ot ? "#9d6bff" : "#7a7fb0";
        var op = s.g ? 0.95 : s.ot ? 0.6 : 0.35;
        var stroke = s.g ? ' stroke="#050611" stroke-width="0.8"' : "";
        var glow = s.g ? ' filter="url(#wcGlow)"' : "";
        var info = s.t + " vs " + s.o + " — xG " + s.xg.toFixed(2) + (s.g ? " (GOAL)" : s.ot ? " (on target)" : "") + " · " + s.s + " · " + s.m + "'";
        svg.push('<circle cx="' + P.px(100 - s.y).toFixed(1) + '" cy="' + P.py(s.x).toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + fill + '" fill-opacity="' + op + '"' + stroke + glow + ' data-info="' + esc(info) + '"></circle>');
      });
    }
    svg.push("</svg>");
    return svg.join("");
  }

  // Per-team style aggregates (data.js team stats + the shot dataset).
  // Generic version of the style-fingerprint aggregation: takes matches/shots as
  // params instead of closing over the current page's D/SHOTS, so the SAME formula
  // (and therefore the SAME tlRadar renderer) works for another edition's data —
  // used by both Team Lab (current edition) and the Eras tab (every edition at once).
  function teamStyleFrom(matches, shotsArr) {
    var T = {};
    function get(t) { return T[t] || (T[t] = { gp: 0, poss: 0, possN: 0, shots: 0, paSum: 0, paN: 0, xgf: 0, xga: 0, distSum: 0, shotN: 0, xgAll: 0, spXg: 0 }); }
    (matches || []).forEach(function (m) {
      if (!m.played) return;
      [["home", m.home], ["away", m.away]].forEach(function (z) {
        var side = z[0], t = get(z[1]);
        var st = m.stats || {};
        var pi = side === "home" ? 0 : 1;
        function v(k) { var a = st[k]; return a && a[pi] != null ? a[pi] : null; }
        t.gp++;
        var po = v("possession"); if (po != null) { t.poss += po; t.possN++; }
        var sh = v("shots"); if (sh != null) t.shots += sh;
        var pa = v("pass_acc"); if (pa != null) { t.paSum += pa; t.paN++; }
        t.xgf += side === "home" ? (m.xg_home || 0) : (m.xg_away || 0);
        t.xga += side === "home" ? (m.xg_away || 0) : (m.xg_home || 0);
      });
    });
    (shotsArr || []).forEach(function (s) {
      var t = T[s.t]; if (!t) return;
      t.distSum += Math.sqrt((100 - s.x) * (100 - s.x) + (50 - s.y) * (50 - s.y));
      t.shotN++; t.xgAll += s.xg;
      if (s.s !== "Open Play" && s.s !== "Fast Break") t.spXg += s.xg;
    });
    var out = {};
    Object.keys(T).forEach(function (k) {
      var t = T[k]; if (!t.gp) return;
      out[k] = {
        team: k, gp: t.gp,
        poss: t.possN ? t.poss / t.possN : 0,
        shotsPG: t.shots / t.gp,
        xgPG: t.xgf / t.gp,
        xgPerShot: t.shotN ? t.xgAll / t.shotN : 0,
        spShare: t.xgAll ? t.spXg / t.xgAll * 100 : 0,
        passAcc: t.paN ? t.paSum / t.paN : 0,
        xgaPG: t.xga / t.gp
      };
    });
    return out;
  }
  function tlTeamStyle() { return teamStyleFrom(D.matches, SHOTS); }

  var TL_AXES = [["poss", "Possession", 0], ["shotsPG", "Shots /game", 1], ["xgPG", "xG /game", 2],
    ["xgPerShot", "xG /shot", 2], ["spShare", "Set-piece xG %", 0], ["passAcc", "Pass accuracy", 0], ["DEF", "Defensive", 2]];

  // Percentile radar; `teams` is an array (1–3). One polygon per team, coloured by index.
  // A single team also gets value+percentile labels; multiple teams get trait labels + a legend.
  function tlRadar(teams, styleMap) {
    var pool = Object.keys(styleMap).map(function (k) { return styleMap[k]; });
    var present = teams.filter(function (t) { return styleMap[t]; });
    if (!present.length) return '<p class="hint">No style data for these teams yet.</p>';
    var single = present.length === 1;
    var N = TL_AXES.length, W = 580, H = 470, cx = W / 2, cy = H / 2 + 4, R = 146;
    function axVal(me, ax) { return ax[0] === "DEF" ? -me.xgaPG : me[ax[0]]; }
    function axGet(ax) { return ax[0] === "DEF" ? function (s) { return -s.xgaPG; } : function (s) { return s[ax[0]]; }; }
    function pctOf(me, ax) {
      var v = axVal(me, ax), get = axGet(ax);
      var below = pool.filter(function (s) { return get(s) < v; }).length;
      return pool.length ? below / pool.length : 0;
    }
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="so-radar" preserveAspectRatio="xMidYMid meet" role="img">' + GLOW_DEFS];
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var pts = [];
      for (var i = 0; i < N; i++) { var a = -Math.PI / 2 + i * 2 * Math.PI / N; pts.push((cx + R * f * Math.cos(a)).toFixed(1) + "," + (cy + R * f * Math.sin(a)).toFixed(1)); }
      svg.push('<polygon points="' + pts.join(" ") + '" fill="none" stroke="#14152e" stroke-width="1"/>');
    });
    // spokes + axis labels
    TL_AXES.forEach(function (ax, i) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / N;
      svg.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + R * Math.cos(a)).toFixed(1) + '" y2="' + (cy + R * Math.sin(a)).toFixed(1) + '" stroke="#14152e" stroke-width="1"/>');
      var lx = cx + (R + 16) * Math.cos(a), ly = cy + (R + 16) * Math.sin(a);
      var anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : (Math.cos(a) > 0 ? "start" : "end");
      svg.push('<text x="' + lx.toFixed(1) + '" y="' + ((single ? ly - 2 : ly + 3.5)).toFixed(1) + '" fill="#a8ace0" font-size="10.5" text-anchor="' + anchor + '">' + esc(ax[1]) + "</text>");
      if (single) {
        var me = styleMap[present[0]], dp = ax[2];
        var disp = ax[0] === "DEF" ? me.xgaPG.toFixed(2) + " xGA" : soFmt(me[ax[0]], dp) + (ax[0] === "poss" || ax[0] === "passAcc" || ax[1].indexOf("%") >= 0 ? "%" : "");
        svg.push('<text x="' + lx.toFixed(1) + '" y="' + (ly + 10).toFixed(1) + '" fill="#eef0fb" font-size="11" font-weight="700" text-anchor="' + anchor + '">' + disp + " (" + Math.round(pctOf(me, ax) * 100) + "%)</text>");
      }
    });
    // one polygon per team
    present.forEach(function (t, ti) {
      var me = styleMap[t], col = TL_COLORS[ti % TL_COLORS.length], poly = [];
      TL_AXES.forEach(function (ax, i) {
        var a = -Math.PI / 2 + i * 2 * Math.PI / N, pct = pctOf(me, ax);
        poly.push((cx + R * pct * Math.cos(a)).toFixed(1) + "," + (cy + R * pct * Math.sin(a)).toFixed(1));
      });
      svg.push('<polygon points="' + poly.join(" ") + '" fill="' + col + '" fill-opacity="' + (single ? 0.18 : 0.12) + '" stroke="' + col + '" stroke-width="2" filter="url(#wcGlow)"/>');
      poly.forEach(function (pt) { var c = pt.split(","); svg.push('<circle cx="' + c[0] + '" cy="' + c[1] + '" r="3" fill="' + col + '" filter="url(#wcGlow)"/>'); });
    });
    svg.push("</svg>");
    return svg.join("");
  }

  function tlMapCard(label, shots) {
    var goals = shots.filter(function (s) { return s.g; }).length;
    var xg = shots.reduce(function (a, s) { return a + s.xg; }, 0);
    var head = '<div class="tl-map-head"><b>' + esc(label) + "</b> · " + shots.length + " shots · " +
      goals + " goals · " + xg.toFixed(1) + " xG</div>";
    var body = shots.length ? tlShotMap(shots) : '<p class="hint">No shots match these filters.</p>';
    return '<div class="tl-map-card">' + head + '<div class="tl-pitch-wrap">' + body + "</div></div>";
  }

  function renderTeamLab() {
    if (!document.getElementById("view-teamlab")) return;
    var setHTML = function (id, h) { var e = document.getElementById(id); if (e) e.innerHTML = h; };
    var allMode = tlState.team === "all";
    // selected specific teams, de-duplicated, in A/B/C order
    var teams = allMode ? [] : [tlState.team, tlState.teamB, tlState.teamC].filter(function (t, i, arr) {
      return t && t !== "none" && t !== "all" && arr.indexOf(t) === i;
    });
    var mapList = allMode ? [["All teams", "all"]] : teams.map(function (t) { return [t, t]; });
    if (!mapList.length) mapList = [["All teams", "all"]];

    setHTML("tlMapTitle", allMode ? "All teams — shot map"
      : (teams.length > 1 ? "Shot maps — " + teams.join(" vs ") : teams[0] + " — shot map"));
    setHTML("tlMaps", mapList.map(function (m) { return tlMapCard(m[0], tlShotsFor(m[1])); }).join(""));
    document.getElementById("tlMaps").classList.toggle("compare", mapList.length > 1);

    // big stats strip only when a single map is shown
    var statsEl = document.getElementById("tlStats");
    if (mapList.length === 1) {
      var shots = tlShotsFor(mapList[0][1]);
      var goals = shots.filter(function (s) { return s.g; }).length;
      var ot = shots.filter(function (s) { return s.ot; }).length;
      var xg = shots.reduce(function (a, s) { return a + s.xg; }, 0);
      // own goals count in match scores but aren't shots — annotate the card so the
      // lower number is self-explaining (only in the unfiltered view)
      var goalsLabel = "Goals";
      if (tlState.filter === "all" && tlState.sit === "all") {
        var selTeam = allMode ? null : mapList[0][1];
        var scoreGoals = 0;
        (D.matches || []).forEach(function (m) {
          if (!m.played) return;
          if (!selTeam || selTeam === "all") scoreGoals += (m.hs || 0) + (m.as || 0);
          else if (m.home === selTeam) scoreGoals += (m.hs || 0);
          else if (m.away === selTeam) scoreGoals += (m.as || 0);
        });
        var og = scoreGoals - goals;
        if (og > 0) goalsLabel = "Goals from shots<br>+" + og + " own goal" + (og > 1 ? "s" : "") + " in scores";
      }
      var items = [
        ["v accent", shots.length, "Shots"], ["v", goals, goalsLabel], ["v blue", xg.toFixed(1), "Total xG"],
        ["v", shots.length ? (xg / shots.length).toFixed(2) : "0", "xG per shot"],
        ["v", shots.length ? Math.round(100 * ot / shots.length) + "%" : "0%", "On target"],
        ["v", goals && xg ? (goals / xg).toFixed(2) : "—", "Goals / xG"],
      ];
      statsEl.innerHTML = items.map(function (it) { return '<div class="stat"><div class="' + it[0] + '">' + it[1] + '</div><div class="k">' + it[2] + "</div></div>"; }).join("");
      statsEl.style.display = "";
    } else { statsEl.innerHTML = ""; statsEl.style.display = "none"; }

    // style fingerprint (hidden for all-teams)
    var styleCard = document.getElementById("tlStyleCard");
    if (allMode || !teams.length) { if (styleCard) styleCard.style.display = "none"; return; }
    styleCard.style.display = "";
    setHTML("tlStyleTitle", teams.length > 1 ? "Style fingerprints — " + teams.join(" vs ") : teams[0] + " — style fingerprint");
    var sm = tlTeamStyle();
    setHTML("tlRadar", tlRadar(teams, sm));
    setHTML("tlLegend", teams.length > 1 ? teams.map(function (t, i) {
      return '<span class="tl-leg"><i style="background:' + TL_COLORS[i % TL_COLORS.length] + '"></i>' + esc(t) + "</span>";
    }).join("") : "");
  }

  function initTeamLab() {
    var sel = document.getElementById("tlTeam");
    if (!sel) return;
    if (!SHOTS.length) { var m = document.getElementById("tlMaps"); if (m) m.innerHTML = '<p class="hint">No shot data available yet.</p>'; return; }
    var teams = {}; SHOTS.forEach(function (s) { teams[s.t] = 1; });
    var sorted = Object.keys(teams).sort();
    var teamOpts = sorted.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + "</option>"; }).join("");
    sel.innerHTML = '<option value="all">All teams</option>' + teamOpts;
    var selB = document.getElementById("tlTeamB"), selC = document.getElementById("tlTeamC");
    selB.innerHTML = '<option value="none">— none —</option>' + teamOpts;
    selC.innerHTML = '<option value="none">— none —</option>' + teamOpts;
    sel.addEventListener("change", function () { tlState.team = sel.value; renderTeamLab(); });
    selB.addEventListener("change", function () { tlState.teamB = selB.value; renderTeamLab(); });
    selC.addEventListener("change", function () { tlState.teamC = selC.value; renderTeamLab(); });
    document.getElementById("tlFilter").addEventListener("change", function (e) { tlState.filter = e.target.value; renderTeamLab(); });
    document.getElementById("tlSit").addEventListener("change", function (e) { tlState.sit = e.target.value; renderTeamLab(); });
    document.getElementById("tlMode").addEventListener("change", function (e) { tlState.mode = e.target.value; renderTeamLab(); });
    renderTeamLab();
    wireChartTaps("tlMaps", "tlMapTip");
  }

  /* ---------------- Breaks (cooling-break analysis) ----------------
     Powered by window.WC_BREAKS (breaks.js, built by build_breaks.py; the math is
     tools/cooling_break_analysis.py::export_breaks). meta.base holds the GROUP-STAGE
     baseline churn (mu/sd) and the regression-to-mean control per window length, so
     every panel can say how much of an effect is just "hot spells end anyway". */
  var BREAKS = window.WC_BREAKS || { meta: null, matches: [] };
  // Defaults to "all" now the knockout rounds are underway, so freshly played R32/R16 (and
  // later QF/SF) matches show up without an extra click — the μ/σ baseline in BREAKS.meta.base
  // stays frozen on the group stage regardless of this filter (see file header note).
  var bkState = { br: 1, win: "420", dom: "auto", stage: "all", match: null };

  function bkAvg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  function bkMatches() {
    return BREAKS.matches.filter(function (m) { return bkState.stage === "all" || m.st === bkState.stage; });
  }
  // {m, b, w} rows for the current break number + window length (null windows =
  // clipped by a half boundary — skipped so rates stay honest)
  function bkRows() {
    var rows = [];
    bkMatches().forEach(function (m) {
      m.breaks.forEach(function (b) {
        if (b.n === bkState.br && b.w[bkState.win]) rows.push({ m: m, b: b, w: b.w[bkState.win] });
      });
    });
    return rows;
  }
  // Same collision fallback as match.js buildMomentum (two similar team colours
  // become the distinct blue/orange pair), plus a darkness guard: a near-black
  // kit colour (Germany) is unreadable on the dark chart surface, so it falls
  // back too.
  function bkColors(m) {
    function hx(c) {
      var r = /^#?([0-9a-f]{6})$/i.exec(c || "");
      if (!r) return null;
      var n = parseInt(r[1], 16);
      return [n >> 16 & 255, n >> 8 & 255, n & 255];
    }
    var ch = m.hc || "#9d6bff", ca = m.ac || "#ff6a3d", A = hx(ch), B = hx(ca);
    if (A && (0.299 * A[0] + 0.587 * A[1] + 0.114 * A[2]) < 60) { ch = "#9d6bff"; A = hx(ch); }
    if (B && (0.299 * B[0] + 0.587 * B[1] + 0.114 * B[2]) < 60) { ca = "#ff6a3d"; B = hx(ca); }
    if (A && B && Math.sqrt(Math.pow(A[0] - B[0], 2) + Math.pow(A[1] - B[1], 2) + Math.pow(A[2] - B[2], 2)) < 90) {
      ch = "#9d6bff"; ca = "#ff6a3d";
    }
    return [ch, ca];
  }
  // Dominant side of a break row: leader on goals at the break, else (or in
  // "mom" mode) the side with the higher pre-window momentum index. "score"
  // mode returns null for level games (row is skipped).
  function bkDomSide(r, mode) {
    if (mode !== "mom" && r.b.gh !== r.b.ga) return r.b.gh > r.b.ga ? "h" : "a";
    if (mode === "score") return null;
    return r.w.m[0] >= r.w.m[1] ? "h" : "a";
  }
  function bkDate(d) {
    if (!d) return "";
    var p = d.split("-");
    return (+p[2]) + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+p[1] - 1];
  }
  function bkLabel(m) {
    return bkDate(m.d) + " — " + m.h + " " + m.hs + "–" + m.as + " " + m.a + (m.st === "G" ? "" : " · " + m.st);
  }

  function renderBkStats() {
    var host = document.getElementById("bkStats");
    if (!host) return;
    var base = BREAKS.meta && BREAKS.meta.base[bkState.win];
    var rows = bkRows();
    if (!base || !rows.length) { host.innerHTML = ""; return; }
    var det = 0, conf = 0, dead = 0;
    bkMatches().forEach(function (m) {
      m.breaks.forEach(function (b) { det++; conf += b.conf; dead += b.dur; });
    });
    var avgDead = Math.floor(dead / det / 60) + ":" + ("0" + Math.round((dead / det) % 60)).slice(-2);
    var above = rows.filter(function (r) { return r.w.sh > base.mu + base.sd; }).length;
    var domRows = rows.filter(function (r) { return bkDomSide(r, bkState.dom); });
    var chase = bkAvg(domRows.map(function (r) {
      return bkDomSide(r, bkState.dom) === "h" ? r.w.m[3] - r.w.m[1] : r.w.m[2] - r.w.m[0];
    }));
    var pasPre = bkAvg(rows.map(function (r) { return r.w.pace.pas[0]; }));
    var pasPost = bkAvg(rows.map(function (r) { return r.w.pace.pas[1]; }));
    var pasPct = pasPre ? Math.round(100 * (pasPost - pasPre) / pasPre) : 0;
    var items = [
      ["v accent", conf + "/" + det, "cooling breaks ≥150 s / detected · avg dead time " + avgDead],
      ["v", Math.round(100 * above / rows.length) + "%", "of matches shifted > μ+1σ after break " + bkState.br + " (μ " + base.mu.toFixed(2) + " · σ " + base.sd.toFixed(2) + ")"],
      ["v blue", (chase >= 0 ? "+" : "") + chase.toFixed(2), "chasing side's avg momentum gain · control +" + base.ctrl.sub.toFixed(2) + " (regression to the mean)"],
      ["v", (pasPct >= 0 ? "+" : "") + pasPct + "%", "passes/min after the restart — games do not slow down"],
    ];
    host.innerHTML = items.map(function (it) {
      return '<div class="stat"><div class="' + it[0] + '">' + it[1] + '</div><div class="k">' + it[2] + "</div></div>";
    }).join("");
  }

  function renderBkRiver() {
    var host = document.getElementById("bkRiver");
    if (!host) return;
    var ms = bkMatches(), m = null;
    ms.forEach(function (x) { if (x.id === bkState.match) m = x; });
    if (!m) {
      m = ms[0];
      bkState.match = m ? m.id : null;
      var sel0 = document.getElementById("bkMatch");
      if (sel0 && m) sel0.value = m.id;
    }
    if (!m) { host.innerHTML = '<p class="hint">No matches for this filter.</p>'; return; }
    var title = document.getElementById("bkRiverTitle");
    if (title) title.textContent = m.h + " " + m.hs + "–" + m.as + " " + m.a + " — momentum river";
    var pts = m.series[bkState.win] || [];
    if (!pts.length) { host.innerHTML = '<p class="hint">No series for this match.</p>'; return; }
    var cols = bkColors(m);
    var W = 860, H = 330, padL = 46, padR = 14, padT = 16, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var xmax = Math.max(90, m.end);
    var ymax = niceMax(Math.max.apply(null, pts.map(function (p) { return Math.abs(p[1]); }).concat([0.5])) * 1.05);
    function sx(min) { return padL + plotW * (min / xmax); }
    function sy(v) { return padT + plotH * (1 - (v + ymax) / (2 * ymax)); }
    var s = ['<svg viewBox="0 0 ' + W + " " + H + '" class="bk-svg">' + GLOW_DEFS];
    // cooling-break bands (behind everything); dashed outline = low-confidence gap
    m.breaks.forEach(function (b) {
      s.push('<rect class="bk-band' + (b.conf ? "" : " soft") + '" x="' + sx(b.s).toFixed(1) + '" y="' + padT +
        '" width="' + Math.max(2, sx(b.e) - sx(b.s)).toFixed(1) + '" height="' + plotH + '"/>');
      s.push('<text x="' + sx((b.s + b.e) / 2).toFixed(1) + '" y="' + (padT + 11) +
        '" fill="#7a7fb0" font-size="9.5" text-anchor="middle">break ' + b.n + (b.conf ? "" : " ?") + "</text>");
    });
    // y grid at fractions of ymax, x ticks every 15'
    [-1, -0.5, 0, 0.5, 1].forEach(function (f) {
      var Y = sy(f * ymax);
      s.push('<line x1="' + padL + '" y1="' + Y.toFixed(1) + '" x2="' + (padL + plotW) + '" y2="' + Y.toFixed(1) +
        '" stroke="' + (f === 0 ? "#33366e" : "#14152e") + '" stroke-width="' + (f === 0 ? 1 : 0.6) + '"/>');
      s.push('<text x="' + (padL - 8) + '" y="' + (Y + 3).toFixed(1) + '" fill="#8b8fb8" font-size="10" text-anchor="end">' +
        (f > 0 ? "+" : "") + (f * ymax).toFixed(1) + "</text>");
    });
    for (var t = 0; t <= xmax; t += 15) {
      s.push('<text x="' + sx(t).toFixed(1) + '" y="' + (padT + plotH + 16) + '" fill="#8b8fb8" font-size="10" text-anchor="middle">' + t + "′</text>");
    }
    // half-time
    s.push('<line x1="' + sx(m.ht).toFixed(1) + '" y1="' + padT + '" x2="' + sx(m.ht).toFixed(1) + '" y2="' + (padT + plotH) +
      '" stroke="#5a5f95" stroke-width="1" stroke-dasharray="4 4"/>');
    s.push('<text x="' + (sx(m.ht) + 3).toFixed(1) + '" y="' + (padT + plotH - 5) + '" fill="#7a7fb0" font-size="9.5">HT</text>');
    // the river itself: split at HT, then into sign runs so each side's colour
    // strokes "their" spells; faint area fill down to the zero line.
    [pts.filter(function (p) { return p[0] <= m.ht; }), pts.filter(function (p) { return p[0] > m.ht; })].forEach(function (run) {
      if (run.length < 2) return;
      var segs = [], cur = [run[0]];
      for (var i = 1; i < run.length; i++) {
        var a = run[i - 1], b = run[i];
        if ((a[1] >= 0) !== (b[1] >= 0)) {
          var f = Math.abs(a[1]) / (Math.abs(a[1]) + Math.abs(b[1]) || 1);
          var xz = a[0] + (b[0] - a[0]) * f;
          cur.push([xz, 0]); segs.push(cur); cur = [[xz, 0]];
        }
        cur.push(b);
      }
      segs.push(cur);
      segs.forEach(function (seg) {
        var col = (Math.max.apply(null, seg.map(function (p) { return p[1]; })) > 0 ||
                   seg.every(function (p) { return p[1] === 0; })) ? cols[0] : cols[1];
        var line = seg.map(function (p, i2) { return (i2 ? "L" : "M") + sx(p[0]).toFixed(1) + " " + sy(p[1]).toFixed(1); }).join("");
        s.push('<path d="' + line + " L" + sx(seg[seg.length - 1][0]).toFixed(1) + " " + sy(0).toFixed(1) +
          " L" + sx(seg[0][0]).toFixed(1) + " " + sy(0).toFixed(1) + 'Z" fill="' + col + '" fill-opacity="0.16"/>');
        s.push('<path d="' + line + '" fill="none" stroke="' + col + '" stroke-width="2.2" stroke-linejoin="round" filter="url(#wcGlow)"/>');
      });
    });
    // goal markers on the line (data-info feeds the shared tap/hover tooltip)
    m.goals.forEach(function (g) {
      var yv = 0;
      for (var i = 0; i < pts.length; i++) if (pts[i][0] <= g.m) yv = pts[i][1];
      var col = g.s === "h" ? cols[0] : cols[1];
      var team = g.s === "h" ? m.h : m.a;
      var info = Math.round(g.m) + "′ Goal — " + team + (g.og ? " (OG)" : "") + (g.pen ? " (pen)" : "");
      s.push('<circle cx="' + sx(g.m).toFixed(1) + '" cy="' + sy(yv).toFixed(1) + '" r="5.5" fill="' + col +
        '" stroke="#050611" stroke-width="1.2" data-info="' + esc(info) + '"/>');
      s.push('<text x="' + sx(g.m).toFixed(1) + '" y="' + (sy(yv) - 9).toFixed(1) + '" font-size="9" text-anchor="middle">⚽</text>');
    });
    s.push("</svg>");
    host.innerHTML = s.join("") +
      chartLegend([[cols[0], m.h], [cols[1], m.a]], "shaded band = cooling break · dashed = HT · above 0 = " + m.h + " on top");
  }

  function renderBkStrip() {
    var host = document.getElementById("bkStrip");
    if (!host) return;
    var base = BREAKS.meta && BREAKS.meta.base[bkState.win];
    var rows = bkRows();
    var title = document.getElementById("bkStripTitle");
    if (title) title.textContent = "Who got shaken by break " + bkState.br + " — every match";
    if (!base || !rows.length) { host.innerHTML = '<p class="hint">No data for this filter.</p>'; return; }
    rows.sort(function (a, b) { return b.w.sh - a.w.sh; });
    var W = 860, rowH = 9, padT = 18, padB = 6, padSide = 8;
    var H = padT + rows.length * rowH + padB;
    var vmax = niceMax(Math.max.apply(null, rows.map(function (r) { return Math.abs(r.w.sh - base.mu); })) * 1.05);
    var xC = W / 2;
    function xv(v) { return xC + (v / vmax) * (W / 2 - padSide - 60); }
    var s = ['<svg viewBox="0 0 ' + W + " " + H + '" class="bk-svg">' + GLOW_DEFS];
    s.push('<line x1="' + xC + '" y1="' + padT + '" x2="' + xC + '" y2="' + (H - padB) + '" stroke="#33366e" stroke-width="1"/>');
    s.push('<text x="' + xC + '" y="11" fill="#8b8fb8" font-size="10" text-anchor="middle">μ (normal churn)</text>');
    s.push('<line x1="' + xv(base.sd).toFixed(1) + '" y1="' + padT + '" x2="' + xv(base.sd).toFixed(1) + '" y2="' + (H - padB) +
      '" stroke="#5a5f95" stroke-width="1" stroke-dasharray="4 4"/>');
    s.push('<text x="' + xv(base.sd).toFixed(1) + '" y="11" fill="#7a7fb0" font-size="10" text-anchor="middle">+1σ</text>');
    rows.forEach(function (r, i) {
      var v = r.w.sh - base.mu, y = padT + i * rowH;
      var x0 = Math.min(xC, xv(v)), bw = Math.max(1.5, Math.abs(xv(v) - xC));
      var big = r.w.sh > base.mu + base.sd;
      var tip = r.m.h + " " + r.m.hs + "–" + r.m.as + " " + r.m.a + " — shift " + r.w.sh.toFixed(2) +
        " (μ " + base.mu.toFixed(2) + ")" + (r.b.conf ? "" : " · low-confidence break");
      s.push('<rect class="bk-bar" data-id="' + esc(r.m.id) + '" x="' + x0.toFixed(1) + '" y="' + y + '" width="' + bw.toFixed(1) +
        '" height="' + (rowH - 2) + '" rx="2" fill="' + (v >= 0 ? "#9d6bff" : "#52568c") + '" fill-opacity="' + (big ? "0.95" : "0.55") +
        '"><title>' + esc(tip) + "</title></rect>");
      if (big) {
        // Long names on the longest bars overflow the viewBox and get clipped —
        // flip those to the empty left half of the row (big bars are always positive).
        var lbl = r.m.h + " – " + r.m.a, lx = xv(v) + 5, anc = "start";
        if (lx + lbl.length * 4.8 > W - 2) { lx = xC - 6; anc = "end"; }
        s.push('<text x="' + lx.toFixed(1) + '" y="' + (y + rowH - 3) + '" fill="#d6d9f5" font-size="8.7" text-anchor="' + anc + '">' +
          esc(lbl) + "</text>");
      }
    });
    s.push("</svg>");
    host.innerHTML = s.join("") +
      chartLegend([["#9d6bff", "shift above normal churn"], ["#52568c", "below"]],
        Math.round(100 * rows.filter(function (r) { return r.w.sh > base.mu + base.sd; }).length / rows.length) +
        "% past +1σ · click a bar to load the match");
  }

  function renderBkPace() {
    var host = document.getElementById("bkPace");
    if (!host) return;
    var rows = bkRows();
    if (!rows.length) { host.innerHTML = '<p class="hint">No data for this filter.</p>'; return; }
    var mets = [["pas", "Passes / min"], ["tou", "Touches / min"], ["fte", "Final-3rd entries / min"]];
    var agg = mets.map(function (mt) {
      return { label: mt[1],
        pre: bkAvg(rows.map(function (r) { return r.w.pace[mt[0]][0]; })),
        post: bkAvg(rows.map(function (r) { return r.w.pace[mt[0]][1]; })) };
    });
    var bp = [0, 0], da = [0, 0];
    rows.forEach(function (r) {
      r.w.pace.ppda.forEach(function (p, i) { bp[i] += p[0]; da[i] += p[1]; });
    });
    agg.push({ label: "PPDA (higher = less pressing)", own: true,
      pre: da[0] ? bp[0] / da[0] : null, post: da[1] ? bp[1] / da[1] : null });
    var W = 460, rowH = 52, padT = 8, padL = 12, padR = 118;
    var H = padT + agg.length * rowH + 4;
    var s = ['<svg viewBox="0 0 ' + W + " " + H + '" class="bk-svg">' + GLOW_DEFS];
    var shared = niceMax(Math.max.apply(null, agg.filter(function (a) { return !a.own; })
      .map(function (a) { return Math.max(a.pre, a.post); })) * 1.15);
    agg.forEach(function (a, i) {
      var y = padT + i * rowH + 30;
      if (a.pre == null || a.post == null) {
        s.push('<text x="' + padL + '" y="' + (y - 16) + '" fill="#8b8fb8" font-size="11">' + a.label + " —</text>");
        return;
      }
      var max = a.own ? niceMax(Math.max(a.pre, a.post) * 1.3) : shared;
      function px(v) { return padL + (W - padL - padR) * (v / max); }
      var pct = Math.round(100 * (a.post - a.pre) / a.pre);
      s.push('<text x="' + padL + '" y="' + (y - 16) + '" fill="#d6d9f5" font-size="11">' + a.label + "</text>");
      s.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#14152e" stroke-width="0.8"/>');
      s.push('<line x1="' + px(a.pre).toFixed(1) + '" y1="' + y + '" x2="' + px(a.post).toFixed(1) + '" y2="' + y + '" stroke="#7a7fb0" stroke-width="2"/>');
      s.push('<circle cx="' + px(a.pre).toFixed(1) + '" cy="' + y + '" r="5" fill="#7a7fb0"><title>before: ' + a.pre.toFixed(2) + "</title></circle>");
      s.push('<circle cx="' + px(a.post).toFixed(1) + '" cy="' + y + '" r="5.5" fill="#9d6bff" stroke="#050611" stroke-width="0.8"><title>after: ' + a.post.toFixed(2) + "</title></circle>");
      s.push('<text x="' + (W - padR + 8) + '" y="' + (y + 4) + '" fill="#d6d9f5" font-size="10.5" font-weight="700">' +
        a.pre.toFixed(1) + "→" + a.post.toFixed(1) + " (" + (pct >= 0 ? "+" : "") + pct + "%)</text>");
    });
    s.push("</svg>");
    host.innerHTML = s.join("") + chartLegend([["#7a7fb0", "before the break"], ["#9d6bff", "after the restart"]],
      "n = " + rows.length + " matches");
  }

  function renderBkDominance() {
    var host = document.getElementById("bkDominance");
    if (!host) return;
    var base = BREAKS.meta && BREAKS.meta.base[bkState.win];
    var rows = bkRows().filter(function (r) { return bkDomSide(r, bkState.dom); });
    if (!base || !rows.length) { host.innerHTML = '<p class="hint">No data for this filter.</p>'; return; }
    function sideVals(which) {
      return rows.map(function (r) {
        var dom = bkDomSide(r, bkState.dom) === "h";
        var home = which === "dom" ? dom : !dom;
        return home ? [r.w.m[0], r.w.m[2]] : [r.w.m[1], r.w.m[3]];
      });
    }
    var domV = sideVals("dom"), subV = sideVals("sub");
    var d0 = bkAvg(domV.map(function (v) { return v[0]; })), d1 = bkAvg(domV.map(function (v) { return v[1]; }));
    var s0 = bkAvg(subV.map(function (v) { return v[0]; })), s1 = bkAvg(subV.map(function (v) { return v[1]; }));
    var ctlD = d0 + base.ctrl.dom, ctlS = s0 + base.ctrl.sub;   // expected post with NO break
    var lo = Math.min(d0, d1, s0, s1, ctlD, ctlS), hi = Math.max(d0, d1, s0, s1, ctlD, ctlS);
    var span = (hi - lo) || 1; lo -= span * 0.25; hi += span * 0.25;
    var W = 430, H = 240, padL = 60, padR = 96, padT = 18, padB = 30;
    var x0 = padL + 30, x1 = W - padR - 30;
    function yv(v) { return padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo)); }
    var s = ['<svg viewBox="0 0 ' + W + " " + H + '" class="bk-svg">' + GLOW_DEFS];
    [["before", x0], ["after", x1]].forEach(function (c) {
      s.push('<line x1="' + c[1] + '" y1="' + padT + '" x2="' + c[1] + '" y2="' + (H - padB) + '" stroke="#14152e" stroke-width="0.8"/>');
      s.push('<text x="' + c[1] + '" y="' + (H - 10) + '" fill="#8b8fb8" font-size="10.5" text-anchor="middle">' + c[0] + "</text>");
    });
    // grey control band: where each side would land from regression alone
    [[ctlD, "#7a7fb0"], [ctlS, "#7a7fb0"]].forEach(function (c) {
      s.push('<rect x="' + (x1 - 14) + '" y="' + (yv(c[0]) - 5).toFixed(1) + '" width="28" height="10" rx="3" fill="' + c[1] + '" fill-opacity="0.35"/>');
    });
    s.push('<text x="' + (x1 + 20) + '" y="' + (yv(ctlD) + 3).toFixed(1) + '" fill="#7a7fb0" font-size="9">control</text>');
    s.push('<text x="' + (x1 + 20) + '" y="' + (yv(ctlS) + 3).toFixed(1) + '" fill="#7a7fb0" font-size="9">control</text>');
    [[d0, d1, "#ff6a3d", "dominant"], [s0, s1, "#9d6bff", "chasing"]].forEach(function (L) {
      s.push('<line x1="' + x0 + '" y1="' + yv(L[0]).toFixed(1) + '" x2="' + x1 + '" y2="' + yv(L[1]).toFixed(1) +
        '" stroke="' + L[2] + '" stroke-width="2.4"/>');
      s.push('<circle cx="' + x0 + '" cy="' + yv(L[0]).toFixed(1) + '" r="5" fill="' + L[2] + '"><title>' + L[3] + " before: " + L[0].toFixed(2) + "</title></circle>");
      s.push('<circle cx="' + x1 + '" cy="' + yv(L[1]).toFixed(1) + '" r="5" fill="' + L[2] + '"><title>' + L[3] + " after: " + L[1].toFixed(2) + "</title></circle>");
      s.push('<text x="' + (x0 - 8) + '" y="' + (yv(L[0]) + 3.5).toFixed(1) + '" fill="' + L[2] + '" font-size="10.5" text-anchor="end">' + L[3] + "</text>");
    });
    s.push("</svg>");
    var exD = (d1 - d0) - base.ctrl.dom, exS = (s1 - s0) - base.ctrl.sub;
    host.innerHTML = s.join("") +
      '<p class="hint" style="margin-top:6px">n = ' + rows.length + " · beyond regression to the mean the break itself costs the dominant side " +
      (exD >= 0 ? "+" : "") + exD.toFixed(2) + " and hands the chasing side " + (exS >= 0 ? "+" : "") + exS.toFixed(2) + ".</p>";
  }

  function renderBreaks() {
    renderBkStats();
    renderBkRiver();
    renderBkStrip();
    renderBkPace();
    renderBkDominance();
  }

  function initBreaks() {
    if (!document.getElementById("view-breaks")) return;
    if (!BREAKS.matches.length) {
      var r0 = document.getElementById("bkRiver");
      if (r0) r0.innerHTML = '<p class="hint">No break data yet — rebuild breaks.js (build_breaks.py).</p>';
      return;
    }
    function fillSelect() {
      var sel = document.getElementById("bkMatch");
      var ms = bkMatches().slice().sort(function (a, b) { return (a.d || "") < (b.d || "") ? -1 : 1; });
      sel.innerHTML = ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(bkLabel(m)) + "</option>"; }).join("");
      if (!ms.some(function (m) { return m.id === bkState.match; })) {
        var rows = bkRows().sort(function (a, b) { return b.w.sh - a.w.sh; });
        bkState.match = rows.length ? rows[0].m.id : (ms[0] && ms[0].id);
      }
      if (bkState.match) sel.value = bkState.match;
    }
    [["bkBr", "br", true], ["bkWin", "win", false], ["bkStage", "stage", false], ["bkDom", "dom", false]].forEach(function (g) {
      document.querySelectorAll("#" + g[0] + " .seg-btn").forEach(function (b) {
        b.addEventListener("click", function () {
          document.querySelectorAll("#" + g[0] + " .seg-btn").forEach(function (x) { x.classList.remove("active"); });
          b.classList.add("active");
          bkState[g[1]] = g[2] ? +b.getAttribute("data-v") : b.getAttribute("data-v");
          if (g[0] === "bkStage") fillSelect();
          renderBreaks();
        });
      });
    });
    var sel = document.getElementById("bkMatch");
    sel.addEventListener("change", function () { bkState.match = sel.value; renderBkRiver(); });
    document.getElementById("bkStrip").addEventListener("click", function (e) {
      var id = e.target && e.target.getAttribute && e.target.getAttribute("data-id");
      if (!id) return;
      bkState.match = id;
      sel.value = id;
      renderBkRiver();
      document.getElementById("bkRiverTitle").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    fillSelect();
    renderBreaks();
    wireChartTaps("bkRiver", "bkRiverTip");
  }

  /* ======================= STORY OF THE TOURNAMENT ======================= */
  /* The post-final centrepiece, written to degrade gracefully BEFORE the final:
     every section renders from whatever has been played so far, and the hero/roads
     complete themselves the moment the final's data lands (renderStory is also on
     the live-update path, so a page left open flips to "champions" by itself).
     All client-side from D.matches + PLAYERS + SHOTS + AGG — no new data files. */
  function stDecided(m) {
    if (!m || !m.played || m.hs == null) return null;
    if (m.hs !== m.as) return m.hs > m.as ? m.home : m.away;
    if (m.hpen != null && m.apen != null && m.hpen !== m.apen) return m.hpen > m.apen ? m.home : m.away;
    return null;
  }
  function stScoreStr(m) {
    var pens = m.hs === m.as && m.hpen != null && m.apen != null;
    return m.hs + "–" + m.as + (pens ? " (" + m.hpen + "–" + m.apen + " p)" : "");
  }
  function renderStory() {
    var hero = document.getElementById("storyHero");
    if (!hero) return;
    var K = buildKnockout();   // fresh tree each render — respects live-updated results
    var played = D.matches.filter(function (m) { return m.played && m.hs != null; });

    // match id → round chip text ("Quarter-final" / "Group C")
    var roundOfId = {};
    if (K) Object.keys(K.rounds).forEach(function (rd) {
      (K.rounds[rd] || []).forEach(function (m) { roundOfId[m.id] = rd; });
    });
    function stageChip(m) {
      var rd = roundOfId[m.id];
      if (rd) return STAGE_LABEL[rd] || rd;
      var g = (D.teamGroup && (D.teamGroup[m.home] || D.teamGroup[m.away])) || "";
      return g ? "Group " + g : "Group stage";
    }

    /* ---- hero ---- */
    var fin = K && K.fin, tp = K && K.tp;
    var champion = fin ? stDecided(fin) : null;
    if (champion) {
      var runnerUp = champion === fin.home ? fin.away : fin.home;
      var third = tp ? stDecided(tp) : null;
      hero.className = "story-hero champ";
      hero.innerHTML =
        logoImg(champion, "hero-flag") +
        '<div><div class="hero-kicker">' + esc(ED_LABEL) + '</div>' +
        '<div class="hero-title">🏆 ' + esc(champion) + " are world champions</div>" +
        '<div class="hero-sub">Beat ' + esc(runnerUp) + " " + stScoreStr(fin) + " in the final" +
        (third ? " · Bronze: " + esc(third) + " (" + stScoreStr(tp) + ")" : "") + "</div></div>";
    } else if (fin) {
      var fh = koSide(K, fin, 0), fa = koSide(K, fin, 1);
      hero.className = "story-hero";
      hero.innerHTML =
        '<div class="hero-flags">' +
          (fh.team ? logoImg(fh.team, "hero-flag") : "") +
          (fa.team ? logoImg(fa.team, "hero-flag") : "") + "</div>" +
        '<div><div class="hero-kicker">' + esc(ED_LABEL) + ' · Final — ' + esc(fmtDate(fin.date) || fin.date) + "</div>" +
        '<div class="hero-title">' + esc(fh.label) + ' <span class="hero-vs">vs</span> ' + esc(fa.label) + "</div>" +
        '<div class="hero-sub">The bracket fills this in by itself as the semi-finals are decided.</div></div>';
    } else {
      hero.className = "story-hero";
      hero.innerHTML = '<div><div class="hero-title">The tournament so far</div></div>';
    }

    try { renderFinalHub(K); } catch (e) { /* hub is non-critical — never break the Story tab */ }

    /* ---- headline numbers ---- */
    var goals = 0, xgSum = 0, xgN = 0, shootouts = 0, koPlayed = 0;
    played.forEach(function (m) {
      goals += m.hs + m.as;
      if (m.model_xg_home != null) { xgSum += m.model_xg_home + m.model_xg_away; xgN++; }
      if (m.hpen != null && m.apen != null) shootouts++;
      if (roundOfId[m.id]) koPlayed++;
    });
    var sWrap = document.getElementById("storyStats");
    sWrap.innerHTML = "";
    [["v accent", played.length, "Matches played"],
     ["v", goals, "Goals"],
     ["v blue", played.length ? (goals / played.length).toFixed(2) : "–", "Goals per game"],
     ["v", xgN ? (xgSum / xgN).toFixed(2) : "–", "xG per game"],
     ["v", koPlayed, "Knockout ties played"],
     ["v", shootouts, "Penalty shootouts"]].forEach(function (it) {
      var s = el("div", "stat");
      s.innerHTML = '<div class="' + it[0] + '">' + it[1] + '</div><div class="k">' + it[2] + "</div>";
      sWrap.appendChild(s);
    });

    /* ---- the finalists' roads ---- */
    var roads = document.getElementById("storyRoads");
    roads.innerHTML = "";
    document.getElementById("storyRoadTitle").textContent =
      champion ? "The road to the trophy" : "The road to the final";
    function roadFor(team, crownClass) {
      var steps = played.filter(function (m) { return m.home === team || m.away === team; })
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var html = steps.map(function (m) {
        var home = m.home === team;
        var opp = home ? m.away : m.home;
        var gf = home ? m.hs : m.as, ga = home ? m.as : m.hs;
        var pf = home ? m.hpen : m.apen, pa = home ? m.apen : m.hpen;
        var res = gf > ga ? "W" : gf < ga ? "L" : (pf != null && pa != null && pf !== pa) ? (pf > pa ? "W" : "L") : "D";
        var pens = gf === ga && pf != null && pa != null;
        return '<a class="road-step ' + res + '" href="' + matchUrl(m.id) + '">' +
          '<div class="rs-stage">' + esc(stageChip(m)) + "</div>" +
          '<div class="rs-line">' + logoImg(opp) + '<span class="rs-opp">' + esc(opp) + "</span>" +
          '<span class="rs-score">' + gf + "–" + ga + (pens ? " (" + pf + "–" + pa + ")" : "") + "</span></div></a>";
      }).join("");
      var road = el("div", "road" + (crownClass ? " " + crownClass : ""));
      road.innerHTML = '<div class="road-head">' + logoImg(team) + "<span>" + esc(team) + "</span>" +
        (crownClass === "champ-road" ? '<span class="road-tag">🏆 champions</span>' : "") + "</div>" +
        '<div class="road-steps">' + html + "</div>";
      roads.appendChild(road);
    }
    if (fin) {
      [0, 1].forEach(function (idx) {
        var s = koSide(K, fin, idx);
        if (s.team) roadFor(s.team, champion === s.team ? "champ-road" : "");
        else {
          var pend = el("div", "road");
          pend.innerHTML = '<div class="road-head"><span>' + esc(s.label) + "</span></div>" +
            '<div class="road-steps"><span class="road-step pending">Decided in the semi-final — the winner\'s full road appears here.</span></div>';
          roads.appendChild(pend);
        }
      });
    }

    /* ---- Golden Boot race (single-series bars; badges carry identity) ---- */
    var sc = PLAYERS.filter(function (p) { return p.g > 0; }).sort(function (a, b) {
      return b.g - a.g || (b.a || 0) - (a.a || 0) || (a.mins || 0) - (b.mins || 0);
    }).slice(0, 8);
    var gMax = sc.length ? sc[0].g : 1;
    document.getElementById("storyScorers").innerHTML = sc.map(function (p, i) {
      return '<div class="sc-row" title="' + esc(p.name + " (" + p.team + ") — " + p.g + " goals, " +
          (p.a || 0) + " assists, " + (p.mins || 0) + " mins") + '">' +
        '<span class="sc-rank">' + (i + 1) + "</span>" + logoImg(p.team) +
        '<span class="sc-name">' + esc(p.name) + "</span>" +
        '<span class="sc-bar-wrap"><span class="sc-bar" style="width:' + (p.g / gMax * 100).toFixed(1) + '%"></span></span>' +
        '<span class="sc-val">' + p.g + "</span>" +
        '<span class="sc-sub">' + (p.a || 0) + "A · " + (p.xg || 0).toFixed(1) + " xG</span></div>";
    }).join("") || '<p class="hint">No goals yet.</p>';

    /* ---- biggest upsets (pre-tournament FIFA points → Elo win prob) ---- */
    var ups = [];
    played.forEach(function (m) {
      var w = stDecided(m);
      if (!w) return;                                   // draws can't be upsets
      var l = w === m.home ? m.away : m.home;
      var pw = FIFA_PTS[w], pl = FIFA_PTS[l];
      if (pw == null || pl == null || pw >= pl) return; // favourite won → not an upset
      ups.push({ m: m, w: w, l: l, p: winProb(pw, pl), gap: Math.round(pl - pw) });
    });
    ups.sort(function (a, b) { return a.p - b.p; });
    var upHost = document.getElementById("storyUpsets");
    upHost.innerHTML = ups.slice(0, 6).map(function (u) {
      return '<div class="up-row" data-id="' + esc(u.m.id) + '">' + logoImg(u.w) +
        '<span class="up-txt"><b>' + esc(u.w) + "</b> beat " + esc(u.l) + " " + stScoreStr(u.m) +
        '<span class="up-sub">' + esc(stageChip(u.m)) + " · " + esc(fmtDate(u.m.date) || u.m.date) + "</span></span>" +
        '<span class="up-prob"><span class="p">' + Math.round(u.p * 100) + "%</span>" +
        '<span class="sub">−' + u.gap + " FIFA pts</span></span></div>";
    }).join("") || '<p class="hint">No upsets yet — the favourites keep winning.</p>';
    upHost.querySelectorAll(".up-row").forEach(function (r) {
      r.addEventListener("click", function () {
        window.location.href = matchUrl(r.dataset.id);
      });
    });

    /* ---- records & numbers ---- */
    var rec = [];
    var big = null, most = null;
    played.forEach(function (m) {
      if (!big || Math.abs(m.hs - m.as) > Math.abs(big.hs - big.as)) big = m;
      if (!most || m.hs + m.as > most.hs + most.as) most = m;
    });
    if (big) rec.push(["v accent", Math.abs(big.hs - big.as) + "-goal win",
      big.home + " " + big.hs + "–" + big.as + " " + big.away]);
    if (most) rec.push(["v", (most.hs + most.as) + " goals",
      "Highest-scoring: " + most.home + " " + most.hs + "–" + most.as + " " + most.away]);
    var fastest = null;
    SHOTS.forEach(function (s) { if (s.g && (fastest == null || s.m < fastest.m)) fastest = s; });
    if (fastest) rec.push(["v blue", fastest.m + "′", "Fastest goal — " + fastest.t + " vs " + fastest.o]);
    var clin = null, wall = null;
    AGG.forEach(function (a) {
      if (a.n >= 3 && (!clin || a.attDelta > clin.attDelta)) clin = a;
      if (a.n >= 3 && (!wall || a.ga / a.n < wall.ga / wall.n)) wall = a;
    });
    if (clin) rec.push(["v", "+" + clin.attDelta.toFixed(1), "Most clinical: " + clin.team + " (goals − xG)"]);
    if (wall) rec.push(["v", (wall.ga / wall.n).toFixed(2), "Best defence: " + wall.team + " (GA per game)"]);
    var glove = PLAYERS.filter(function (p) { return p.pos === "GK" && (p.mins || 0) >= 270; })
      .sort(function (a, b) { return (b.gPrev || 0) - (a.gPrev || 0); })[0];
    if (glove) rec.push(["v accent", "+" + (glove.gPrev || 0).toFixed(1),
      "Goals prevented — " + glove.name + " (" + glove.team + ")"]);
    var rWrap = document.getElementById("storyRecords");
    rWrap.innerHTML = "";
    rec.forEach(function (it) {
      var s = el("div", "stat");
      s.innerHTML = '<div class="' + it[0] + '">' + esc(it[1]) + '</div><div class="k">' + esc(it[2]) + "</div>";
      rWrap.appendChild(s);
    });
  }

  /* ======================= FINAL HUB ======================= */
  /* The Opta-style pre-final page, living at the top of the Story tab. Adaptive to the
     bracket state: before SF2 is decided it shows the confirmed finalist vs each possible
     opponent (win prob for each); once both finalists are known it collapses to the one
     matchup; once the final is played it shows the result. Style radar, per-match xG-
     dominance trend and key-player columns all render for "the teams that can still
     contest the final" (2 when decided, 3 while a semi is open). Pure client-side, reusing
     the Power model (powerRating/winProb/predictScore) and the Team-Lab style radar. */
  function matchProb(tA, tB) {
    var A = powerRating(tA), B = powerRating(tB), pA = winProb(A.rating, B.rating);
    var favA = A.rating >= B.rating, ps = predictScore(favA ? A : B, favA ? B : A);
    return { pA: pA, pB: 1 - pA, scoreA: favA ? ps.sf : ps.su, scoreB: favA ? ps.su : ps.sf, pens: ps.pens };
  }
  function fhTeamStat(team) {
    // xG/game + top scorer, for a finalist summary line
    var recs = R.filter(function (r) { return r.team === team; });
    var xgpg = recs.length ? recs.reduce(function (a, r) { return a + r.xgf; }, 0) / recs.length : 0;
    var scorer = PLAYERS.filter(function (p) { return p.team === team && p.g > 0; })
      .sort(function (a, b) { return b.g - a.g || (b.a || 0) - (a.a || 0); })[0];
    return { xgpg: xgpg, scorer: scorer };
  }
  function fhTrend(teams, colors) {
    // one line per team: net xG (xG for − against) across their matches, in date order.
    var series = teams.map(function (t) {
      return {
        team: t,
        pts: R.filter(function (r) { return r.team === t; })
          .slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })
          .map(function (r, i) { return [i + 1, r.xgf - r.xga]; })
      };
    }).filter(function (s) { return s.pts.length; });
    if (!series.length) return "";
    var maxN = Math.max.apply(null, series.map(function (s) { return s.pts.length; }));
    var vals = series.reduce(function (a, s) { return a.concat(s.pts.map(function (p) { return p[1]; })); }, []);
    var lo = Math.min(-0.5, Math.min.apply(null, vals)), hi = Math.max(0.5, Math.max.apply(null, vals));
    var W = 560, H = 250, padL = 34, padR = 12, padT = 14, padB = 30;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    function sx(n) { return padL + plotW * (maxN <= 1 ? 0.5 : (n - 1) / (maxN - 1)); }
    function sy(v) { return padT + plotH * (1 - (v - lo) / (hi - lo)); }
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="fh-trend-svg" preserveAspectRatio="xMidYMid meet" role="img">'];
    var zeroY = sy(0);
    svg.push('<line x1="' + padL + '" y1="' + zeroY.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + zeroY.toFixed(1) + '" stroke="#33405f" stroke-width="1" stroke-dasharray="4 3"/>');
    svg.push('<text x="' + (padL - 5) + '" y="' + (zeroY + 3).toFixed(1) + '" fill="#7a7fb0" font-size="9.5" text-anchor="end">0</text>');
    svg.push('<text x="' + (padL - 5) + '" y="' + (padT + 6) + '" fill="#7a7fb0" font-size="9.5" text-anchor="end">+' + hi.toFixed(1) + '</text>');
    for (var g = 1; g <= maxN; g++) svg.push('<text x="' + sx(g).toFixed(1) + '" y="' + (H - 10) + '" fill="#7a7fb0" font-size="9.5" text-anchor="middle">' + g + "</text>");
    svg.push('<text x="' + (padL + plotW / 2).toFixed(1) + '" y="' + (H - 1) + '" fill="#8b8fb8" font-size="10" text-anchor="middle">Match number</text>');
    series.forEach(function (s, si) {
      var col = colors[si % colors.length];
      var d = s.pts.map(function (p, i) { return (i ? "L" : "M") + sx(p[0]).toFixed(1) + " " + sy(p[1]).toFixed(1); }).join(" ");
      svg.push('<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.4" stroke-linejoin="round"/>');
      s.pts.forEach(function (p) { svg.push('<circle cx="' + sx(p[0]).toFixed(1) + '" cy="' + sy(p[1]).toFixed(1) + '" r="3" fill="' + col + '"/>'); });
    });
    svg.push("</svg>");
    return svg.join("");
  }
  function fhPlayers(team) {
    var top = PLAYERS.filter(function (p) { return p.team === team && (p.mins || 0) >= 90; })
      .map(function (p) { return Object.assign({}, p, { ga: (p.g || 0) + (p.a || 0) }); })
      .sort(function (a, b) { return b.ga - a.ga || (b.rating || 0) - (a.rating || 0); }).slice(0, 3);
    return top.map(function (p) {
      return '<div class="fh-pl"><span class="fh-pl-nm">' + esc(p.name) + "</span>" +
        '<span class="fh-pl-st">' + p.g + "G " + (p.a || 0) + "A · " + (p.rating ? p.rating.toFixed(2) : "–") + "</span></div>";
    }).join("") || '<div class="fh-pl"><span class="fh-pl-st">—</span></div>';
  }
  function renderFinalHub(K) {
    var host = document.getElementById("finalHub");
    if (!host) return;
    if (!K || !K.fin) { host.innerHTML = ""; return; }
    var fin = K.fin;
    var h = koSide(K, fin, 0), a = koSide(K, fin, 1);
    var hSide = h.team ? [h.team] : (h.possible || []).filter(isKnownTeam);
    var aSide = a.team ? [a.team] : (a.possible || []).filter(isKnownTeam);
    if (!hSide.length && !aSide.length) { host.innerHTML = ""; return; }
    var decided = hSide.length === 1 && aSide.length === 1;
    var hubTeams = hSide.concat(aSide).filter(function (t, i, arr) { return arr.indexOf(t) === i; });
    if (hubTeams.length < 2) { host.innerHTML = ""; return; }

    var kicker = '<span class="fh-kicker">🏆 The Final</span><span class="fh-date">' +
      esc(fmtDate(fin.date) || fin.date || "") + "</span>";

    // ---- matchup band ----
    var band;
    if (fin.played && fin.hs != null) {
      var win = stDecided(fin), other = win === fin.home ? fin.away : fin.home;
      band = '<div class="fh-band champ">' + logoImg(fin.home, "fh-crest") +
        '<div class="fh-score">' + fin.hs + " – " + fin.as +
        (fin.hs === fin.as && fin.hpen != null ? ' <span class="fh-pens">(' + fin.hpen + "–" + fin.apen + " p)</span>" : "") +
        '<div class="fh-champ-line">🏆 ' + esc(win || "") + " — world champions</div></div>" +
        logoImg(fin.away, "fh-crest") + "</div>";
    } else if (decided) {
      var mp = matchProb(hSide[0], aSide[0]);
      band = '<div class="fh-band">' +
        '<div class="fh-team"><span class="fh-pct" style="color:' + TL_COLORS[0] + '">' + Math.round(mp.pA * 100) + "%</span>" +
          logoImg(hSide[0], "fh-crest") + '<span class="fh-tn">' + esc(hSide[0]) + "</span></div>" +
        '<div class="fh-mid"><div class="fh-vs">vs</div><div class="fh-pred">predicted ' + mp.scoreA + "–" + mp.scoreB + (mp.pens ? " (pens)" : "") + "</div>" +
          '<div class="fh-probbar"><span style="width:' + (mp.pA * 100).toFixed(1) + '%;background:' + TL_COLORS[0] + '"></span><span style="width:' + (mp.pB * 100).toFixed(1) + '%;background:' + TL_COLORS[1] + '"></span></div></div>' +
        '<div class="fh-team"><span class="fh-pct" style="color:' + TL_COLORS[1] + '">' + Math.round(mp.pB * 100) + "%</span>" +
          logoImg(aSide[0], "fh-crest") + '<span class="fh-tn">' + esc(aSide[0]) + "</span></div>" +
        "</div>";
    } else {
      // one finalist locked, other still to be decided in a semi → prob vs each candidate
      var lockSide = hSide.length === 1 ? hSide[0] : aSide[0];
      var cands = hSide.length === 1 ? aSide : hSide;
      var rows = cands.map(function (c) {
        var mp = matchProb(lockSide, c);
        return '<div class="fh-cand">' + logoImg(c, "fh-crest-sm") + '<span class="fh-cand-nm">' + esc(c) + "</span>" +
          '<div class="fh-probbar sm"><span style="width:' + (mp.pB * 100).toFixed(1) + '%;background:#5b6a8a"></span>' +
            '<span style="width:' + (mp.pA * 100).toFixed(1) + '%;background:' + TL_COLORS[0] + '"></span></div>' +
          '<span class="fh-cand-pct">' + esc(lockSide) + " " + Math.round(mp.pA * 100) + "% · " + mp.scoreA + "–" + mp.scoreB + (mp.pens ? " (p)" : "") + "</span></div>";
      }).join("");
      band = '<div class="fh-locked">' +
        '<div class="fh-team big"><span class="fh-locktag">Finalist</span>' + logoImg(lockSide, "fh-crest") +
          '<span class="fh-tn">' + esc(lockSide) + "</span></div>" +
        '<div class="fh-cands"><div class="fh-cands-h">Awaiting ' + esc(a.team ? "the other semi-final" : "Semi-final 2") + " — if they face " + esc(lockSide) + ":</div>" + rows + "</div>" +
        "</div>";
    }

    // ---- style radar (reuse Team-Lab) + xG-dominance trend ----
    var style = tlTeamStyle();
    var radar = tlRadar(hubTeams, style);
    var trend = fhTrend(hubTeams, TL_COLORS);
    var legend = '<div class="fh-legend">' + hubTeams.map(function (t, i) {
      return '<span><i style="background:' + TL_COLORS[i % TL_COLORS.length] + '"></i>' + esc(t) + "</span>";
    }).join("") + "</div>";

    // ---- key-player columns ----
    var cols = hubTeams.map(function (t, i) {
      var s = fhTeamStat(t);
      return '<div class="fh-pcol"><div class="fh-pcol-h">' + logoImg(t) + "<span>" + esc(t) + "</span>" +
        '<i class="fh-dot" style="background:' + TL_COLORS[i % TL_COLORS.length] + '"></i></div>' +
        '<div class="fh-pcol-sub">' + s.xgpg.toFixed(2) + " xG/game" + (s.scorer ? " · " + esc(s.scorer.name.split(" ").slice(-1)[0]) + " " + s.scorer.g + "G" : "") + "</div>" +
        fhPlayers(t) + "</div>";
    }).join("");

    host.innerHTML =
      '<div class="fh-card' + (fin.played ? " champ" : "") + '">' +
        '<div class="fh-head">' + kicker + "</div>" + band +
        '<div class="fh-grid">' +
          '<div class="fh-panel"><h4>Style fingerprint <span class="fh-note">percentile vs all teams</span></h4>' + radar + legend + "</div>" +
          '<div class="fh-panel"><h4>xG dominance by match <span class="fh-note">xG for − against, per game</span></h4>' + trend + legend + "</div>" +
        "</div>" +
        '<div class="fh-duel"><h4>Key players <span class="fh-note">top goal contributors, 90+ min</span></h4><div class="fh-pcols">' + cols + "</div></div>" +
      "</div>";
  }

  /* ======================= ERAS (cross-tournament comparison) =======================
     ROADMAP Phase E. Loads every edition's data.js/players.js/shots.js under namespaced
     globals (window.WC_DATA_2018, …) and compares them side by side: headline tiles,
     an attack-vs-defence scatter with every team-tournament as a dot coloured by edition,
     a champion style-fingerprint radar overlay (reusing teamStyleFrom/tlRadar so the
     methodology matches Team Lab exactly), Golden Boot bars, and a goals/xG/pens trend
     strip. Renders gracefully with only 2026 published; lights up as editions/<year>/
     data lands (see the backfill workflows in ROADMAP.md). Simplifications vs the full
     ROADMAP ambition: "upsets count" is dropped (it needs a cross-era ranking source
     that doesn't exist — FIFA_PTS is a 2026-dated snapshot) and "roads side-by-side" is
     a W/D/L + goals summary rather than a literal round-by-round bracket walk. */
  var ERAS_YEARS = [2018, 2022, 2026];
  var ERAS_COLORS = { 2018: TL_COLORS[0], 2022: TL_COLORS[1], 2026: TL_COLORS[2] };
  var ERA_CACHE = {};   // year -> {data, players, shots} | null (null = confirmed unpublished)
  var ERAS_LOADED = false;

  function parseWindowAssign(text, varName) {
    var w = {};
    try { (new Function("window", text))(w); } catch (e) { return null; }
    return w[varName] || null;
  }
  function fetchGlobal(url, varName) {
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (txt) { return txt ? parseWindowAssign(txt, varName) : null; })
      .catch(function () { return null; });
  }
  // Load one edition's trio of generated files. 2026 (or whichever ED this page is
  // already showing) reuses the data already in memory instead of re-fetching.
  function loadEraYear(year) {
    if (ERA_CACHE[year] !== undefined) return Promise.resolve(ERA_CACHE[year]);
    if (year === ED) {
      var self = { data: D, players: PLAYERS, shots: SHOTS };
      ERA_CACHE[year] = self;
      return Promise.resolve(self);
    }
    var base = year === 2026 ? "" : "editions/" + year + "/";
    return Promise.all([
      fetchGlobal(base + "data.js", "WC_DATA"),
      fetchGlobal(base + "players.js", "WC_PLAYERS"),
      fetchGlobal(base + "shots.js", "WC_SHOTS"),
    ]).then(function (r) {
      var out = r[0] ? { data: r[0], players: r[1] || [], shots: r[2] || [] } : null;
      ERA_CACHE[year] = out;
      return out;
    });
  }

  // Per-edition headline stats + champion, computed straight from that edition's own
  // data.js/players.js/shots.js — no bracket-tree reconstruction needed (see note above).
  function eraStats(year, bundle) {
    var data = bundle.data, shotsArr = bundle.shots || [], playersArr = bundle.players || [];
    var matches = (data.matches || []).filter(function (m) { return m.played; });
    if (!matches.length) return null;
    var goals = 0, modelXg = 0, withXg = 0, shootouts = 0;
    matches.forEach(function (m) {
      goals += (m.hs || 0) + (m.as || 0);
      if (m.model_xg_home != null) { modelXg += m.model_xg_home + m.model_xg_away; withXg++; }
      if (m.hpen != null && m.apen != null) shootouts++;
    });
    var totalXg = 0, penGoals = 0, setPieceShots = 0;
    shotsArr.forEach(function (s) {
      totalXg += s.xg || 0;
      if (s.s === "Penalty" && s.g) penGoals++;
      if (s.s !== "Open Play" && s.s !== "Fast Break") setPieceShots++;
    });
    // histRoundOf (buildKnockoutHistory) already gets this right, incl. the "1/8-finals"
    // (R16) / "Quarter-final" / "Semi-final" collisions with a bare "final" substring —
    // reuse it instead of a second regex that would repeat the same misclassification.
    var fin = matches.find(function (m) { return histRoundOf(m) === "F"; });
    var champion = null;
    if (fin) {
      if (fin.hs !== fin.as) champion = fin.hs > fin.as ? fin.home : fin.away;
      else if (fin.hpen != null && fin.apen != null && fin.hpen !== fin.apen) champion = fin.hpen > fin.apen ? fin.home : fin.away;
    }
    var scorers = playersArr.slice().sort(function (a, b) { return (b.g || 0) - (a.g || 0) || (b.mins || 0) - (a.mins || 0); });
    var finishers = playersArr.filter(function (p) { return (p.mins || 0) >= 270; })
      .sort(function (a, b) { return (b.xg_diff || 0) - (a.xg_diff || 0); });
    var champRoad = champion ? matches.filter(function (m) { return m.home === champion || m.away === champion; }) : [];
    var road = champRoad.reduce(function (a, m) {
      var forT = m.home === champion ? m.hs : m.as, agT = m.home === champion ? m.as : m.hs;
      a.gf += forT || 0; a.ga += agT || 0;
      if (forT > agT) a.w++; else if (forT < agT) a.l++; else a.d++;
      return a;
    }, { w: 0, d: 0, l: 0, gf: 0, ga: 0 });
    return {
      year: year, label: (data.format && data.format.name) || ("World Cup " + year),
      matches: matches.length, goalsPerGame: goals / matches.length,
      xgPerGame: withXg ? modelXg / withXg : null,
      xgPerShot: shotsArr.length ? totalXg / shotsArr.length : null,
      setPieceShare: shotsArr.length ? setPieceShots / shotsArr.length : null,
      penGoals: penGoals, shootouts: shootouts,
      champion: champion, championGames: champRoad.length, road: road,
      topScorer: scorers[0] || null, topFinisher: finishers[0] || null,
      style: teamStyleFrom(data.matches, shotsArr), matches_: matches,
    };
  }

  function erasTile(label, val, note) {
    return '<div class="stat"><div class="v accent">' + (val == null ? "—" : val) + '</div><div class="k">' + esc(label) + (note ? '<div class="hint" style="margin-top:2px">' + esc(note) + "</div>" : "") + "</div></div>";
  }

  function renderEras() {
    var host = document.getElementById("erasBody");
    if (!host) return;
    if (!ERAS_LOADED) { host.innerHTML = '<p class="footer-note">Loading every published edition…</p>'; }

    Promise.all(ERAS_YEARS.map(loadEraYear)).then(function (bundles) {
      ERAS_LOADED = true;
      var stats = [];
      ERAS_YEARS.forEach(function (y, i) { if (bundles[i]) { var s = eraStats(y, bundles[i]); if (s) stats.push(s); } });
      if (!stats.length) { host.innerHTML = '<p class="hint">No edition data published yet.</p>'; return; }

      // ---- headline tiles, one card per published edition ----
      var tiles = stats.map(function (s) {
        return '<div class="fh-card" style="border-color:' + ERAS_COLORS[s.year] + '44">' +
          '<div class="fh-head"><b style="color:' + ERAS_COLORS[s.year] + '">' + esc(s.label) + "</b></div>" +
          '<div class="stats-strip" style="margin-top:8px">' +
            erasTile("Goals/game", s.goalsPerGame.toFixed(2)) +
            erasTile("Model xG/game", s.xgPerGame != null ? s.xgPerGame.toFixed(2) : "—") +
            erasTile("xG/shot", s.xgPerShot != null ? s.xgPerShot.toFixed(3) : "—") +
            erasTile("Set-piece shots", s.setPieceShare != null ? Math.round(s.setPieceShare * 100) + "%" : "—") +
            erasTile("Penalty goals", s.penGoals) +
            erasTile("Shootouts", s.shootouts) +
          "</div>" +
          (s.champion
            ? '<div class="fh-duel"><h4>Champions</h4><div class="fin-row aw-lead"><div class="nm">🏆 ' + logoImg(s.champion) + "<span>" + esc(s.champion) + '</span></div><div class="fin-stat">' +
                s.road.w + "W " + s.road.d + "D " + s.road.l + "L · " + s.road.gf + "-" + s.road.ga + "</div></div></div>"
            : '<p class="hint">Champion appears once the final is played.</p>') +
          "</div>";
      }).join("");

      // ---- era scatter: every team-tournament, attack xG/g vs defence xGA/g ----
      var scatterRows = [];
      stats.forEach(function (s) {
        Object.keys(s.style).forEach(function (t) {
          var st = s.style[t];
          scatterRows.push({ team: t + " " + s.year, x: st.xgPG, y: st.xgaPG, col: ERAS_COLORS[s.year] });
        });
      });
      var scatterHost = '<div id="erasScatter"></div>';

      // ---- champions' style radar overlay ----
      var champStyle = {}, champTeams = [];
      stats.forEach(function (s) {
        if (!s.champion) return;
        var key = s.champion + " '" + String(s.year).slice(2);
        champStyle[key] = s.style[s.champion];
        champTeams.push(key);
      });
      var radarLegend = chartLegend(stats.filter(function (s) { return s.champion; })
        .map(function (s) { return [ERAS_COLORS[s.year], s.champion + " (" + s.year + ")"]; }));

      // ---- Golden Boot across eras (one shared scale) ----
      var bootMax = Math.max.apply(null, stats.map(function (s) { return (s.topScorer && s.topScorer.g) || 0; }).concat([1]));
      var bootBars = stats.map(function (s) {
        if (!s.topScorer) return "";
        var pct = Math.round((s.topScorer.g / bootMax) * 100);
        return '<div class="fin-row"><div class="nm">' + logoImg(s.topScorer.team) + "<span>" + esc(s.topScorer.name) + " (" + s.year + ")</span></div>" +
          '<div class="fin-bar-wrap"><div class="fin-bar" style="width:' + pct + "%;background:" + ERAS_COLORS[s.year] + '"></div></div>' +
          '<div class="fin-stat">' + s.topScorer.g + "G</div></div>";
      }).join("");
      var finMax = Math.max.apply(null, stats.map(function (s) { return (s.topFinisher && s.topFinisher.xg_diff) || 0; }).concat([0.1]));
      var finBars = stats.map(function (s) {
        if (!s.topFinisher) return "";
        var pct = Math.max(4, Math.round((s.topFinisher.xg_diff / finMax) * 100));
        return '<div class="fin-row"><div class="nm">' + logoImg(s.topFinisher.team) + "<span>" + esc(s.topFinisher.name) + " (" + s.year + ")</span></div>" +
          '<div class="fin-bar-wrap"><div class="fin-bar" style="width:' + pct + "%;background:" + ERAS_COLORS[s.year] + '"></div></div>' +
          '<div class="fin-stat">+' + s.topFinisher.xg_diff.toFixed(1) + "</div></div>";
      }).join("");

      // ---- trend strip: goals/game, model xG/game, penalty goals/game across eras ----
      var trendHost = '<div id="erasTrend"></div>';

      host.innerHTML =
        '<div class="fh-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">' + tiles + "</div>" +
        '<div class="section-head" style="margin-top:28px"><h3>Attack vs defence, every team-tournament</h3>' +
          '<p>Every team\'s xG for/against per game across all three editions — colour = edition.</p></div>' + scatterHost +
        (champTeams.length ? '<div class="section-head" style="margin-top:28px"><h3>Champions compared</h3>' +
          '<p>Style-fingerprint percentile vs their own edition\'s field — same methodology as Team Lab.</p></div>' +
          '<div class="fh-panel">' + tlRadar(champTeams, champStyle) + radarLegend + "</div>" : "") +
        '<div class="section-head" style="margin-top:28px"><h3>Golden Boot across eras</h3></div>' +
        '<div class="fh-duel"><div class="fin-list">' + bootBars + "</div></div>" +
        '<div class="section-head" style="margin-top:20px"><h3>Finishing (goals above xG)</h3></div>' +
        '<div class="fh-duel"><div class="fin-list">' + finBars + "</div></div>" +
        '<div class="section-head" style="margin-top:28px"><h3>Trend across World Cups</h3></div>' + trendHost;

      teamScatter("erasScatter", scatterRows, {
        xLabel: "xG for / game", yLabel: "xG against / game", flipY: true,
        legend: chartLegend(stats.map(function (s) { return [ERAS_COLORS[s.year], String(s.year)]; })),
      });

      (function renderTrend() {
        var el2 = document.getElementById("erasTrend");
        if (!el2 || stats.length < 2) { if (el2) el2.innerHTML = '<p class="hint">Needs at least two published editions.</p>'; return; }
        var ordered = stats.slice().sort(function (a, b) { return a.year - b.year; });
        var W = 900, H = 260, padL = 46, padR = 20, padT = 20, padB = 34;
        var plotW = W - padL - padR, plotH = H - padT - padB;
        function series(fn, color, label) {
          var pts = ordered.map(function (s, i) { return { x: padL + (i / (ordered.length - 1)) * plotW, v: fn(s) }; }).filter(function (p) { return p.v != null; });
          if (pts.length < 2) return "";
          var maxV = Math.max.apply(null, pts.map(function (p) { return p.v; })) * 1.2 || 1;
          function sy(v) { return padT + plotH - (v / maxV) * plotH; }
          var d = pts.map(function (p, i) { return (i ? "L" : "M") + p.x.toFixed(1) + "," + sy(p.v).toFixed(1); }).join(" ");
          var dots = pts.map(function (p) { return '<circle cx="' + p.x.toFixed(1) + '" cy="' + sy(p.v).toFixed(1) + '" r="4" fill="' + color + '" filter="url(#wcGlow)"/>' +
            '<text x="' + p.x.toFixed(1) + '" y="' + (sy(p.v) - 9).toFixed(1) + '" fill="' + color + '" font-size="10" text-anchor="middle">' + p.v.toFixed(2) + "</text>"; }).join("");
          return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" filter="url(#wcGlow)"/>' + dots;
        }
        var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" class="scatter-svg">' + GLOW_DEFS];
        ordered.forEach(function (s, i) {
          var x = padL + (i / (ordered.length - 1)) * plotW;
          svg.push('<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" fill="#8b8fb8" font-size="11" text-anchor="middle">' + s.year + "</text>");
        });
        svg.push(series(function (s) { return s.goalsPerGame; }, "#33e893", "Goals/game"));
        svg.push(series(function (s) { return s.xgPerGame; }, "#9d6bff", "xG/game"));
        svg.push(series(function (s) { return s.matches ? s.penGoals / s.matches : null; }, "#ffc857", "Pens/game"));
        svg.push("</svg>");
        el2.innerHTML = svg.join("") + chartLegend([["#33e893", "Goals/game"], ["#9d6bff", "Model xG/game"], ["#ffc857", "Penalty goals/game"]]);
      })();
    });
  }

  /* ======================= AWARDS ======================= */
  /* Individual honours from the players.js aggregates. Golden Glove & Golden Ball use
     minute floors so a one-cameo wonder can't top the table; Boot/Playmaker follow the
     FIFA tiebreak rules. Best XI is position-aware (WhoScored role codes → 4-3-3 slots,
     using every position a player occupied this tournament + realistic stretches). */
  function renderAwards() {
    var host = document.getElementById("awardCards");
    if (!host || !PLAYERS.length) return;
    function rows(list, valFn, subFn) {
      if (!list.length) return '<p class="hint">Not enough data yet.</p>';
      return list.slice(0, 5).map(function (p, i) {
        var medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
        return '<div class="fin-row' + (i === 0 ? " aw-lead" : "") + '"><div class="nm">' +
          '<span class="aw-rank">' + medal + "</span>" + logoImg(p.team) +
          "<span>" + esc(p.name) + '</span></div><div class="fin-stat">' +
          '<span class="sub">' + subFn(p) + '</span><span class="lb-val">' + valFn(p) + "</span></div></div>";
      }).join("");
    }
    function card(icon, title, hint, body) {
      return '<div class="card award-card"><h3>' + icon + " " + title + '</h3><p class="hint">' +
        hint + "</p>" + body + "</div>";
    }
    var byRating = PLAYERS.filter(function (p) { return (p.mins || 0) >= 270 && p.rating != null; })
      .sort(function (a, b) { return b.rating - a.rating; });
    var boot = PLAYERS.filter(function (p) { return p.g > 0; }).sort(function (a, b) {
      return b.g - a.g || (b.a || 0) - (a.a || 0) || (a.mins || 0) - (b.mins || 0);
    });
    var play = PLAYERS.filter(function (p) { return (p.a || 0) > 0; }).sort(function (a, b) {
      return (b.a || 0) - (a.a || 0) || (b.xa || 0) - (a.xa || 0);
    });
    var glove = PLAYERS.filter(function (p) { return p.pos === "GK" && (p.mins || 0) >= 270; })
      .sort(function (a, b) { return (b.gPrev || 0) - (a.gPrev || 0); });
    // Outfielders only — a keeper's long kicks count as progressive but aren't "engine" play.
    var engine = PLAYERS.filter(function (p) { return (p.mins || 0) >= 180 && (p.progPasses || 0) > 0 && p.pos !== "GK"; })
      .sort(function (a, b) { return (b.progPasses || 0) - (a.progPasses || 0); });
    var winners = PLAYERS.filter(function (p) { return (p.mins || 0) >= 180; })
      .map(function (p) { return Object.assign({}, p, { ti: (p.tackles || 0) + (p.interceptions || 0) }); })
      .filter(function (p) { return p.ti > 0; })
      .sort(function (a, b) { return b.ti - a.ti; });
    host.innerHTML =
      card("👑", "Golden Ball", "Best player — average match rating, min 270 minutes.",
        rows(byRating, function (p) { return p.rating.toFixed(2); },
          function (p) { return p.g + "G " + (p.a || 0) + "A · " + p.mins + "′"; })) +
      card("⚽", "Golden Boot", "Top scorer. Ties break by assists, then fewer minutes.",
        rows(boot, function (p) { return p.g; },
          function (p) { return (p.a || 0) + "A · " + (p.xg || 0).toFixed(1) + " xG"; })) +
      card("🎯", "Playmaker", "Most assists; expected assists break ties. KP = key passes.",
        rows(play, function (p) { return p.a; },
          function (p) { return (p.xa || 0).toFixed(1) + " xA · " + (p.keyPasses || 0) + " KP"; })) +
      card("🧤", "Golden Glove", "Keeper shot-stopping: goals prevented = xG faced − conceded on pitch (min 270′).",
        rows(glove, function (p) { return "+" + (p.gPrev || 0).toFixed(1); },
          function (p) { return (p.xga || 0).toFixed(1) + " xGF · " + (p.gConcOn != null ? p.gConcOn : "–") + " GA"; })) +
      card("⚙️", "The engine", "Progressive passes — successful passes moving play ≥15 units toward goal (min 180′).",
        rows(engine, function (p) { return p.progPasses; },
          function (p) { return ((p.progPasses || 0) / (p.mins || 1) * 90).toFixed(1) + " per 90"; })) +
      card("🛡️", "Ball winner", "Tackles + interceptions (min 180′).",
        rows(winners, function (p) { return p.ti; },
          function (p) { return p.tackles + "T " + p.interceptions + "I"; }));
    renderBestXI();
  }

  function renderBestXI() {
    var host = document.getElementById("bestXI");
    if (!host) return;
    // Deep-run bonus: a Team of the Tournament should lean toward players still playing
    // in the final stages, not group-stage peaks from eliminated sides. Each player's
    // pick score = avg rating + DEEP_BONUS per knockout round their team reached — a
    // finalist gets +0.75, a round-of-32 exit +0.15. Sides already RESOLVED into an
    // unplayed tie count as having reached it (the finalists rank as finalists before
    // kick-off), so the XI shifts by itself as the bracket advances.
    var runIdx = { R32: 1, R16: 2, QF: 3, SF: 4, TP: 4, F: 5 };
    var runName = { 1: "Round of 32", 2: "Round of 16", 3: "Quarter-final", 4: "Semi-final", 5: "Final" };
    var deep = {};
    var K = buildKnockout();
    if (K) Object.keys(K.rounds).forEach(function (rd) {
      (K.rounds[rd] || []).forEach(function (m) {
        if (m.played && m.hs != null)
          [m.home, m.away].forEach(function (t) { deep[t] = Math.max(deep[t] || 0, runIdx[rd]); });
        else [0, 1].forEach(function (i) {
          var s = koSide(K, m, i);
          if (s.team) deep[s.team] = Math.max(deep[s.team] || 0, runIdx[rd]);
        });
      });
    });
    var DEEP_BONUS = 0.15;   // per knockout round reached
    // Keepers: average match rating rewards SAVE VOLUME, so keepers of dominant
    // deep-run sides (little to do) rate below busy keepers on eliminated teams.
    // Counting the run double for the GK slot corrects that skew — a Team of the
    // Tournament keeper should have survived deep, not just faced many shots.
    function xiScore(p) {
      var w = p.pos === "GK" ? 2 : 1;
      return p.rating + w * DEEP_BONUS * (deep[p.team] || 0);
    }
    // Equal scores are common (same avg rating, same team run — e.g. two team-mates at
    // 7.16). Don't let players.js array order decide the shirt: break ties on tournament
    // peak rating, then on minutes played — at the same average, the bigger body of
    // evidence wins.
    var pool = PLAYERS.filter(function (p) { return (p.mins || 0) >= 180 && p.rating != null; })
      .sort(function (a, b) {
        return (xiScore(b) - xiScore(a)) ||
               ((b.rating_best || 0) - (a.rating_best || 0)) ||
               ((b.mins || 0) - (a.mins || 0));
      });
    // Slot model. Each 4-3-3 slot lists the role codes that natively play there
    // ("primary") plus the stretches a coach would actually make ("alt") — a second
    // striker shifted wide, wingers swapping flanks, a wing-back covering full-back.
    // Players are placed best-score-first into the most natural free slot, considering
    // EVERY position they occupied this tournament (posList, most-played first), so
    // e.g. Mbappe/Haaland (both FW) join Messi in the front line instead of being
    // locked out of the XI by the single ST slot.
    // Defensive slots take natural defenders only (no attacker may cascade into the
    // back line), and one midfield seat is reserved for a holding player so three
    // attacking mids cannot squeeze the pivot out of the XI.
    var SLOTS = [
      { id: "gk", primary: ["GK"], alt: [] },
      { id: "lb", primary: ["DL", "DML"], alt: [] },
      { id: "cb", primary: ["DC"], alt: [] },
      { id: "rb", primary: ["DR", "DMR"], alt: [] },
      { id: "dm", primary: ["DMC"], alt: ["MC", "DML", "DMR"] },
      { id: "cm", primary: ["MC", "AMC"], alt: ["DMC", "ML", "MR"] },
      { id: "lw", primary: ["AML", "FWL"], alt: ["FW", "AMR", "FWR", "ML"] },
      { id: "st", primary: ["FW"], alt: ["AMC", "AML", "AMR", "FWL", "FWR"] },
      { id: "rw", primary: ["AMR", "FWR"], alt: ["FW", "AML", "FWL", "MR"] },
    ];
    var CAP = { gk: 1, lb: 1, cb: 2, rb: 1, dm: 1, cm: 2, lw: 1, st: 1, rw: 1 };
    var used = {}, placed = {}, total = 0;
    SLOTS.forEach(function (s) { placed[s.id] = []; });
    pool.forEach(function (p) {
      if (total >= 11) return;
      var roles = (p.posList && p.posList.length ? p.posList : [p.pos || ""])
        .map(function (r) { return String(r).toUpperCase(); });
      // Slot preference: for each role in most-played order, its primary slots first;
      // then the alt stretches, again in most-played role order.
      var pref = [];
      ["primary", "alt"].forEach(function (tier) {
        roles.forEach(function (r) {
          SLOTS.forEach(function (s) {
            if (s[tier].indexOf(r) >= 0 && pref.indexOf(s.id) < 0) pref.push(s.id);
          });
        });
      });
      for (var j = 0; j < pref.length; j++) {
        var sid = pref[j];
        if (placed[sid].length < CAP[sid]) {
          placed[sid].push(p); used[p.pid] = 1; total++; break;
        }
      }
    });
    var gk = placed.gk, lb = placed.lb, cbs = placed.cb, rb = placed.rb,
        lw = placed.lw, st = placed.st, rw = placed.rw,
        // middle row: the holding player sits between the two CMs
        mid = [placed.cm[0], placed.dm[0], placed.cm[1]].filter(Boolean);
    // Backfill any unfilled slot with the best remaining outfielder so the XI is always 11.
    function fill(arr, n) {
      for (var i = 0; i < pool.length && arr.length < n; i++) {
        var p = pool[i];
        if (used[p.pid] || p.pos === "GK") continue;
        used[p.pid] = 1; arr.push(p);
      }
      return arr;
    }
    var lines = [
      fill([].concat(lw, st, rw), 3),          // front three (attacking ↑ top)
      fill(mid, 3),
      fill([].concat(lb, cbs, rb), 4),
      gk,
    ];
    var W = 460, H = 640;
    var svg = ['<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Best XI on a pitch">'];
    svg.push('<rect x="6" y="6" width="' + (W - 12) + '" height="' + (H - 12) + '" rx="12" fill="#10231c" stroke="#2c4a3e"/>');
    svg.push('<line x1="6" y1="' + (H / 2) + '" x2="' + (W - 6) + '" y2="' + (H / 2) + '" stroke="#2c4a3e"/>');
    svg.push('<circle cx="' + (W / 2) + '" cy="' + (H / 2) + '" r="52" fill="none" stroke="#2c4a3e"/>');
    svg.push('<rect x="' + (W / 2 - 110) + '" y="6" width="220" height="72" fill="none" stroke="#2c4a3e"/>');
    svg.push('<rect x="' + (W / 2 - 110) + '" y="' + (H - 78) + '" width="220" height="72" fill="none" stroke="#2c4a3e"/>');
    var rowY = [120, 285, 455, 580];
    lines.forEach(function (line, li) {
      line.forEach(function (p, i) {
        var x = W * (i + 1) / (line.length + 1), y = rowY[li];
        var tip = p.name + " (" + p.team + ") · " +
          ((p.posList && p.posList.length ? p.posList.slice(0, 3).join("/") : p.pos) || "?") +
          " · rating " + p.rating.toFixed(2) +
          " · " + p.g + "G " + (p.a || 0) + "A · " + p.mins + "′ · run: " +
          (deep[p.team] ? runName[deep[p.team]] : "Group stage");
        svg.push('<g class="axi-node"><title>' + esc(tip) + "</title>" +
          '<circle cx="' + x + '" cy="' + y + '" r="24" fill="#1b2440" stroke="#33e893" stroke-width="1.4"/>' +
          '<image href="' + LOGO + encodeURIComponent(p.team) + '.png" x="' + (x - 15) + '" y="' + (y - 15) +
            '" width="30" height="30" preserveAspectRatio="xMidYMid meet"/>' +
          '<text x="' + x + '" y="' + (y + 40) + '" text-anchor="middle" fill="#eef0fb" font-size="12.5" font-weight="600">' +
            esc(p.name.split(" ").slice(-1)[0]) + "</text>" +
          '<text x="' + x + '" y="' + (y + 54) + '" text-anchor="middle" fill="#8b8fb8" font-size="10.5">' +
            p.rating.toFixed(2) + "</text></g>");
      });
    });
    svg.push("</svg>");
    host.innerHTML = svg.join("");
  }

  /* ======================= MVP — all-stats Player of the Tournament =======================
     One composite "MVP Index" per player, built from every stat players.js carries.
     Pipeline: per-90 rates → z-scores WITHIN position group (GK/DF/MF/FW, clamped ±2.5 so a
     defender's two goals can't explode a low-variance distribution; attacking components
     blend in a whole-pool z capped at 3.0 so absolute output counts) → six weighted
     components → availability damping + knockout-run bonus − card penalty. Component
     colours are a CVD-validated categorical set derived from the site palette. */
  var MVP_COMPS = [
    { k: "att", name: "Goal threat", color: "#24ad74", w: 0.20,
      parts: "0.5·goals (stage-weighted) + 0.3·xG + 0.2·finishing (goals−xG), per 90" },
    { k: "cre", name: "Creation", color: "#c07f2e", w: 0.20,
      parts: "0.4·assists (stage-weighted) + 0.3·xA + 0.3·key passes, per 90" },
    { k: "pro", name: "Progression", color: "#3a84d9", w: 0.15,
      parts: "0.5·progressive passes + 0.3·dribbles won, per 90 + 0.2·pass accuracy" },
    { k: "def", name: "Defensive work", color: "#d94f65", w: 0.15,
      parts: "0.5·defensive actions (Tkl+Int+Rec+Blk+Clr) per 90 + 0.3·defensive quality (least xG faced on pitch) + 0.2·aerial win% — keepers: 0.7·goals prevented + 0.3·saves & claims per 90" },
    { k: "imp", name: "Team impact", color: "#1ba3ad", w: 0.15,
      parts: "0.45·share of the team's goals + assists + 0.35·share of team xG + xA + 0.20·share of possible minutes — position-agnostic (whole-pool z): carrying is carrying" },
    { k: "rat", name: "Judgment", color: "#8a55ee", w: 0.15,
      parts: "WhoScored average match rating (the eye-test proxy)" },
  ];

  function mvpCompute() {
    var pool = PLAYERS.filter(function (p) { return (p.mins || 0) >= 270 && p.rating != null; });
    if (pool.length < 12) return null;
    function n(p, k) { return +p[k] || 0; }
    function p90(p, k) { return n(p, k) * 90 / p.mins; }
    // team totals for the Team-impact shares (goals scored, xG, games played)
    var tt = {};
    TOTALS.forEach(function (t) { tt[t.team] = t; });
    var feats = {};
    pool.forEach(function (p) {
      var defActs = n(p, "tackles") + n(p, "interceptions") + n(p, "recoveries") +
                    n(p, "blocks") + n(p, "clearances");
      var T = tt[p.team] || {};
      feats[p.pid] = {
        // goals/assists are STAGE-WEIGHTED (wg/wa from build_players: group x1.0 ...
        // final x2.0) — a knockout goal is worth more; fall back to raw counts on
        // edition data built before the field existed
        g: (p.wg != null ? p.wg : n(p, "g")) * 90 / p.mins,
        a: (p.wa != null ? p.wa : n(p, "a")) * 90 / p.mins,
        xg: p90(p, "xg"), xgd: p90(p, "xg_diff"),
        xa: p90(p, "xa"), kp: p90(p, "keyPasses"),
        prog: p90(p, "progPasses"), drb: p90(p, "dribbles"), pp: n(p, "pass_pct"),
        da: defActs * 90 / p.mins, aer: n(p, "aer_pct"),
        nxga: -n(p, "xga90"),   // on-pitch defensive quality: less xG faced = better
        gprev: p90(p, "gPrev"), stop: (n(p, "saves") + n(p, "claims")) * 90 / p.mins,
        rt: p.rating,
        // impact shares: how much of the TEAM's output runs through this player
        gi: (n(p, "g") + n(p, "a")) / Math.max(1, T.gf || 0),
        xi: (n(p, "xg") + n(p, "xa")) / Math.max(0.5, T.xgf || 0),
        ms: p.mins / Math.max(1, (T.mp || 1) * 97),
      };
      var gg = posGroup(p.pos);
      p._mvpGrp = (gg === "GK" || gg === "DF" || gg === "FW") ? gg : "MF";
    });
    // z-scores within position group, plus whole-pool z for the attacking features
    var groups = {};
    pool.forEach(function (p) { (groups[p._mvpGrp] = groups[p._mvpGrp] || []).push(p); });
    function zmap(players, k, cap) {
      var vals = players.map(function (q) { return feats[q.pid][k]; });
      var m = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      var sd = Math.sqrt(vals.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / vals.length);
      var out = {};
      players.forEach(function (q) {
        // soft saturation: outliers damp toward ±cap without the fake ties a hard clamp makes
        out[q.pid] = sd ? cap * Math.tanh(((feats[q.pid][k] - m) / sd) / cap) : 0;
      });
      return out;
    }
    var Z = {};
    Object.keys(groups).forEach(function (gn) {
      Z[gn] = {};
      Object.keys(feats[groups[gn][0].pid]).forEach(function (k) { Z[gn][k] = zmap(groups[gn], k, 2.5); });
    });
    // Attacking components also use a whole-pool z: positional-only let "elite for a
    // defender" outrank "elite outright" (a full-back's 0.30 g/90 is a 3σ freak among
    // defenders, but absolute production has to count too). The pool z is capped at 3.0
    // so the true monsters (a 5σ scorer vs a 4σ one) still separate. Goal threat leans
    // 70% pool / 30% positional; Creation stays an even blend.
    var ZALL = {};
    ["g", "xg", "xgd", "a", "xa", "kp"].forEach(function (k) { ZALL[k] = zmap(pool, k, 3.0); });
    function zb(gn, k, pid, wPos) { return wPos * Z[gn][k][pid] + (1 - wPos) * ZALL[k][pid]; }
    // Team impact is position-AGNOSTIC by design: carrying 63% of your team's goals is
    // carrying, whoever you are — pool z only, so a defender's modest share can't beat
    // a superstar's massive one on positional rarity.
    var ZIMP = {};
    ["gi", "xi", "ms"].forEach(function (k) { ZIMP[k] = zmap(pool, k, 2.5); });
    // knockout-run map (same source as the Best XI deep-run bonus)
    var deep = {};
    try {
      var runIdx = { R32: 1, R16: 2, QF: 3, SF: 4, TP: 4, F: 5 };
      var K = buildKnockout();
      if (K) Object.keys(K.rounds).forEach(function (rd) {
        (K.rounds[rd] || []).forEach(function (m) {
          if (m.played && m.hs != null)
            [m.home, m.away].forEach(function (t) { deep[t] = Math.max(deep[t] || 0, runIdx[rd]); });
          else [0, 1].forEach(function (i) {
            var s = koSide(K, m, i);
            if (s.team) deep[s.team] = Math.max(deep[s.team] || 0, runIdx[rd]);
          });
        });
      });
    } catch (e) {}
    var rows = pool.map(function (p) {
      var z = Z[p._mvpGrp], gn = p._mvpGrp, pid = p.pid, c = {};
      // availability damps INSIDE each component, so the leader panels can't be
      // topped by a 300-minute hot streak the final index would never reward
      var avail = Math.sqrt(Math.min(1, p.mins / 600));
      // Goal threat is ABSOLUTE (pure whole-pool z): a goal is a goal whoever scores
      // it — positional fairness lives in the other components instead
      c.att = (0.5 * zb(gn, "g", pid, 0) + 0.3 * zb(gn, "xg", pid, 0) + 0.2 * zb(gn, "xgd", pid, 0)) * avail;
      c.cre = (0.4 * zb(gn, "a", pid, 0.5) + 0.3 * zb(gn, "xa", pid, 0.5) + 0.3 * zb(gn, "kp", pid, 0.5)) * avail;
      c.pro = (0.5 * z.prog[pid] + 0.3 * z.drb[pid] + 0.2 * z.pp[pid]) * avail;
      // outfield defence: volume of actions + QUALITY (xG faced on pitch, so members of
      // a great defence score even when possession means they rarely have to tackle)
      c.def = (p._mvpGrp === "GK" ? 0.7 * z.gprev[pid] + 0.3 * z.stop[pid]
                                  : 0.5 * z.da[pid] + 0.3 * z.nxga[pid] + 0.2 * z.aer[pid]) * avail;
      c.imp = (0.45 * ZIMP.gi[pid] + 0.35 * ZIMP.xi[pid] + 0.20 * ZIMP.ms[pid]) * avail;
      c.rat = z.rt[pid] * avail;
      var base = MVP_COMPS.reduce(function (s, cc) { return s + cc.w * c[cc.k]; }, 0);
      var ctx = 0.06 * (deep[p.team] || 0);
      var disc = 0.03 * (p.yc || 0) + 0.10 * (p.rc || 0);
      return { p: p, c: c, base: base, avail: avail, ctx: ctx, disc: disc,
               S: base + ctx - disc, run: deep[p.team] || 0 };
    }).sort(function (a, b) { return b.S - a.S; });
    var Smax = rows[0].S || 1;
    rows.forEach(function (r) { r.idx = Math.round(1000 * r.S / Smax) / 10; });
    return { rows: rows, pool: pool };
  }

  function mvpPct(rows, key, val) {   // percentile of a component value within the ranked pool
    var below = 0;
    rows.forEach(function (r) { if (r.c[key] < val) below++; });
    return Math.round(100 * below / Math.max(1, rows.length - 1));
  }

  function renderMVP() {
    var hero = document.getElementById("mvpHero");
    if (!hero) return;
    var M = mvpCompute();
    if (!M) {
      document.getElementById("view-mvp").innerHTML +=
        '<p class="footer-note">Not enough player data for the MVP index yet.</p>';
      return;
    }
    var rows = M.rows, win = rows[0], sec = rows[1];
    var runName = { 0: "group stage", 1: "Round of 32", 2: "Round of 16", 3: "quarter-final", 4: "semi-final", 5: "final" };
    function compTip(r) {
      return MVP_COMPS.map(function (cc) {
        return cc.name + " " + (r.c[cc.k] >= 0 ? "+" : "") + r.c[cc.k].toFixed(2);
      }).join(" · ") + " · context +" + r.ctx.toFixed(2) + (r.disc ? " · cards −" + r.disc.toFixed(2) : "");
    }
    // ── hero ──
    var topDecile = MVP_COMPS.filter(function (cc) {
      return mvpPct(rows, cc.k, win.c[cc.k]) >= 90;
    }).length;
    hero.innerHTML =
      '<div class="mvp-hero">' +
        '<div class="mvp-crown">🏆 MVP · index 100</div>' +
        '<div class="mvp-name">' + logoImg(win.p.team) + esc(win.p.name) +
          ' <span class="mvp-team">' + esc(win.p.team) + " · " + esc(win.p.pos) + "</span></div>" +
        '<div class="mvp-line">' + win.p.g + " goals · " + (win.p.a || 0) + " assists · " +
          (win.p.xa || 0).toFixed(1) + " xA · rating " + win.p.rating.toFixed(2) + " · " +
          win.p.mins + "′ · reached the " + runName[win.run] + "</div>" +
        '<div class="mvp-verdict">Top <b>decile</b> of the whole 270′+ pool in <b>' + topDecile + " of " + MVP_COMPS.length + "</b> components — " +
          "the breadth argument: others win single dimensions, nobody else is elite almost everywhere. " +
          "№2 " + esc(sec.p.name) + " scores <b>" + sec.idx.toFixed(1) + "</b>.</div>" +
      "</div>";
    // ── methodology ──
    document.getElementById("mvpMethod").innerHTML =
      '<ol class="mvp-steps">' +
        "<li>Every counting stat becomes a <b>per-90 rate</b> (a 500′ player and an 800′ player compare fairly). <b>Goals and assists are stage-weighted first</b> — group ×1.0, R32 ×1.15, R16 ×1.3, QF ×1.5, SF ×1.75, third-place ×1.5, final ×2.0 — every round is harder, so every round pays more — <b>and by game state</b>: go-ahead goals ×1.25 and equalisers ×1.2 (+15% more after 75′), sparking a comeback ×1.1, padding an already-decided score ×0.7 (×0.5 late) — a goal that changes the game outweighs one that decorates it. The assist inherits its goal’s weight.</li>" +
        "<li>Each rate is <b>z-scored against positional peers</b> (GK / DF / MF / FW), softly capped at ±2.5 (tanh) so one freak outlier can't run away — \"how unusual is this number <i>for that job</i>?\" <b>Goal threat uses pure whole-pool z</b> (absolute production — a goal is a goal whoever scores it) and <b>Creation blends 50% whole-pool z</b>, capped at 3.0, so absolute output counts too and \"elite for a defender\" can't outrank \"elite outright\".</li>" +
        "<li>The z-scores combine into <b>six weighted components</b> (below), each damped by <b>availability</b> (×√min(1, minutes/600)) so a short hot streak can't top a panel.</li>" +
        "<li>The weighted sum then gains <b>+0.06 per knockout round reached</b> and loses <b>−0.03 per yellow / −0.10 per red</b>.</li>" +
        "<li>Scaled so the <b>winner = 100</b>. Pool: 270′+ played (" + rows.length + " players).</li>" +
      "</ol>" +
      '<div class="mvp-weightbar">' + MVP_COMPS.map(function (cc) {
        return '<div class="mw-seg" style="flex-basis:' + (cc.w * 100) + '%;background:' + cc.color +
          '" title="' + esc(cc.name + " " + Math.round(cc.w * 100) + "% — " + cc.parts) + '"><span>' +
          esc(cc.name) + " " + Math.round(cc.w * 100) + "%</span></div>";
      }).join("") + "</div>" +
      '<ul class="mvp-parts">' + MVP_COMPS.map(function (cc) {
        return '<li><i style="background:' + cc.color + '"></i><b>' + esc(cc.name) + "</b> — " + esc(cc.parts) + "</li>";
      }).join("") + "</ul>";
    // ── top 10 bars ──
    var W = 940, RH = 34, PADL = 190, PADR = 60, H = 10 * RH + 8;
    var t10 = rows.slice(0, 10);
    var svg = ['<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Top 10 MVP index">'];
    [25, 50, 75, 100].forEach(function (gx) {
      var x = PADL + (W - PADL - PADR) * gx / 100;
      svg.push('<line x1="' + x + '" y1="2" x2="' + x + '" y2="' + (H - 6) + '" stroke="rgba(147,160,189,0.14)"/>' +
        '<text x="' + x + '" y="' + (H - 0) + '" font-size="9" fill="#93a0bd" text-anchor="middle">' + gx + "</text>");
    });
    t10.forEach(function (r, i) {
      var y = i * RH + 6, bw = (W - PADL - PADR) * Math.max(0, r.idx) / 100;
      var col = i === 0 ? "#3ddc97" : "#3a84d9";
      svg.push('<g class="mvp-row"><title>' + esc("#" + (i + 1) + " " + r.p.name + " (" + r.p.team + ") · index " +
          r.idx.toFixed(1) + " · " + compTip(r)) + "</title>" +
        '<text x="' + (PADL - 34) + '" y="' + (y + 15) + '" font-size="12.5" fill="#e8edf7" text-anchor="end" font-weight="600">' +
          esc(r.p.name) + "</text>" +
        '<image href="' + LOGO + encodeURIComponent(r.p.team) + '.png" x="' + (PADL - 28) + '" y="' + (y + 4) + '" width="22" height="15"/>' +
        '<rect x="' + PADL + '" y="' + (y + 2) + '" width="' + bw.toFixed(1) + '" height="' + (RH - 12) +
          '" rx="4" fill="' + col + '"' + (i === 0 ? "" : ' opacity="0.75"') + "/>" +
        '<text x="' + (PADL + bw + 8) + '" y="' + (y + 16) + '" font-size="12" fill="#e8edf7" font-weight="700">' +
          r.idx.toFixed(1) + "</text></g>");
    });
    svg.push("</svg>");
    document.getElementById("mvpTop10").innerHTML = svg.join("");
    // ── component leader panels ──
    document.getElementById("mvpComponents").innerHTML = '<div class="mvp-panels">' +
      MVP_COMPS.map(function (cc) {
        var sorted = rows.slice().sort(function (a, b) { return b.c[cc.k] - a.c[cc.k]; });
        var top5 = sorted.slice(0, 5), winRank = sorted.indexOf(win) + 1;
        var mx = Math.max(0.001, sorted[0].c[cc.k]);
        function row(r, rank) {
          var pct = Math.max(3, 100 * Math.max(0, r.c[cc.k]) / mx);
          return '<div class="mp-row' + (r === win ? " winner" : "") + '" title="' +
              esc("#" + rank + " " + r.p.name + " · " + cc.name + " " + r.c[cc.k].toFixed(2) + " (z vs " + r.p._mvpGrp + " peers)") + '">' +
            '<span class="mp-nm">' + (r === win ? "★ " : "") + esc(r.p.name.split(" ").slice(-1)[0]) + "</span>" +
            '<div class="mp-track"><div class="mp-fill" style="width:' + pct.toFixed(0) + "%;background:" + cc.color + '"></div></div>' +
            '<span class="mp-val">' + (r.c[cc.k] >= 0 ? "+" : "") + r.c[cc.k].toFixed(2) + "</span></div>";
        }
        return '<div class="mvp-panel"><h4><i style="background:' + cc.color + '"></i>' + esc(cc.name) + "</h4>" +
          top5.map(function (r, i) { return row(r, i + 1); }).join("") +
          // the breadth argument: always show where the winner sits, even outside the top 5
          (winRank > 5 ? '<div class="mp-more">… ★ ' + esc(win.p.name.split(" ").slice(-1)[0]) +
            " is #" + winRank + " of " + rows.length + "</div>" : "") + "</div>";
      }).join("") + "</div>";
    // ── head-to-head №1 vs №2 ──
    document.getElementById("mvpH2H").innerHTML =
      '<div class="mvp-h2h-head"><span class="h2h-a">' + logoImg(win.p.team) + esc(win.p.name) + " · " + win.idx.toFixed(1) + "</span>" +
        '<span class="h2h-b">' + sec.idx.toFixed(1) + " · " + esc(sec.p.name) + logoImg(sec.p.team) + "</span></div>" +
      MVP_COMPS.map(function (cc) {
        var a = cc.w * win.c[cc.k], b = cc.w * sec.c[cc.k];
        if (Math.abs(a) < 0.005) a = 0;
        if (Math.abs(b) < 0.005) b = 0;
        var mx = Math.max(Math.abs(a), Math.abs(b), 0.001);
        function half(v, side) {
          var w = Math.abs(v) / mx * 46;
          var col = side === "a" ? "#3ddc97" : "#4ea1ff";
          var dim = v < 0 ? ";opacity:0.35" : "";
          return '<div class="h2h-track ' + side + '"><div style="width:' + w.toFixed(1) + "%;background:" + col + dim + '"></div></div>';
        }
        return '<div class="mvp-h2h-row" title="' + esc(cc.name + ": " + win.p.name.split(" ").slice(-1)[0] + " " +
            a.toFixed(2) + " vs " + sec.p.name.split(" ").slice(-1)[0] + " " + b.toFixed(2) + " (weighted contribution)") + '">' +
          '<span class="h2h-val">' + a.toFixed(2) + "</span>" + half(a, "a") +
          '<span class="h2h-lbl">' + esc(cc.name) + "</span>" + half(b, "b") +
          '<span class="h2h-val">' + b.toFixed(2) + "</span></div>";
      }).join("") +
      '<p class="hint" style="margin:10px 0 0">Bars show each component × its weight — the actual contribution to the index. Faded = negative (below the positional average). Context: ' +
        esc(win.p.name.split(" ").slice(-1)[0]) + " +" + win.ctx.toFixed(2) + " run" +
        (win.disc ? " / −" + win.disc.toFixed(2) + " cards" : "") + " · " +
        esc(sec.p.name.split(" ").slice(-1)[0]) + " +" + sec.ctx.toFixed(2) +
        (sec.disc ? " / −" + sec.disc.toFixed(2) : "") + ".</p>";
    // ── radar: top 3 on component percentiles ──
    var R = 128, CX = 210, CY = 168, NAMES = MVP_COMPS.map(function (c) { return c.name; });
    var NAX = MVP_COMPS.length, AXI = NAMES.map(function (_, i) { return i; });
    var tri = rows.slice(0, 3), triCol = ["#3ddc97", "#4ea1ff", "#ffb454"];
    function pt(i, frac) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / NAX;
      return [(CX + Math.cos(ang) * R * frac).toFixed(1), (CY + Math.sin(ang) * R * frac).toFixed(1)];
    }
    var rsvg = ['<svg viewBox="0 0 620 336" role="img" aria-label="Top three component percentiles">'];
    [0.25, 0.5, 0.75, 1].forEach(function (fr) {
      rsvg.push('<polygon points="' + AXI.map(function (i) { return pt(i, fr).join(","); }).join(" ") +
        '" fill="none" stroke="rgba(147,160,189,0.18)"/>');
    });
    NAMES.forEach(function (nm, i) {
      var lp = pt(i, 1.22);
      rsvg.push('<line x1="' + CX + '" y1="' + CY + '" x2="' + pt(i, 1)[0] + '" y2="' + pt(i, 1)[1] + '" stroke="rgba(147,160,189,0.18)"/>' +
        '<text x="' + lp[0] + '" y="' + lp[1] + '" font-size="11" fill="#93a0bd" text-anchor="middle">' + esc(nm) + "</text>");
    });
    tri.forEach(function (r, ti) {
      var pts = MVP_COMPS.map(function (cc, i) { return pt(i, Math.max(0.04, mvpPct(rows, cc.k, r.c[cc.k]) / 100)); });
      rsvg.push('<polygon points="' + pts.map(function (q) { return q.join(","); }).join(" ") +
        '" fill="' + triCol[ti] + '" fill-opacity="0.10" stroke="' + triCol[ti] + '" stroke-width="2"><title>' +
        esc(r.p.name + " — " + MVP_COMPS.map(function (cc) { return cc.name + " " + mvpPct(rows, cc.k, r.c[cc.k]) + "th pct"; }).join(" · ")) +
        "</title></polygon>");
    });
    rsvg.push('<g font-size="12.5">' + tri.map(function (r, ti) {
      return '<g transform="translate(430,' + (100 + ti * 26) + ')"><rect x="0" y="-9" width="12" height="12" rx="3" fill="' + triCol[ti] + '"/>' +
        '<text x="18" y="1" fill="#e8edf7" font-weight="600">' + esc(r.p.name) + '</text>' +
        '<text x="18" y="14" fill="#93a0bd" font-size="10.5">index ' + r.idx.toFixed(1) + "</text></g>";
    }).join("") + "</g></svg>");
    document.getElementById("mvpRadar").innerHTML = rsvg.join("");
    document.getElementById("mvpFoot").innerHTML =
      "Honest caveats: the index is <b>context-blind</b> (it can't see marking assignments or tactical roles), " +
      "match ratings inherit WhoScored's own biases, keepers are only comparable to keepers, and the knockout bonus " +
      "deliberately rewards winning — remove it and the ranking above barely changes at the top.";
  }

  /* ---------------- init ---------------- */
  renderOverviewStats();
  renderGroups();
  renderThirdPlace();
  renderBracket();
  renderMatches();
  renderDbTeamTable();
  initPlayers();
  renderXgStats();
  renderScatter();
  renderCorr();
  renderXgDist();
  renderQuadrant();
  renderXpts();
  renderFinishingBars();
  renderShotQuality();
  renderHomeAway();
  renderLedger();
  renderAgreement();
  renderUnlucky();
  initStandouts();
  initTeamLab();
  renderMVP();
  // Cooling-break analysis and Power Rank predictions are 2026-only by design (frozen
  // baselines / a 2026-dated FIFA snapshot — see ROADMAP.md); their tab buttons are
  // already removed above, and their data files aren't even loaded for history.
  if (ED === 2026) { initBreaks(); renderPower(); }
  renderData();
  renderStory();
  renderAwards();
  document.getElementById("footerNote").textContent =
    "Data generated " + D.generated + " · " + D.counts.played + " matches played · " +
    D.counts.with_xg + " with xG · " + PLAYERS.length + " players · built from the WC2026 pipeline.";

  /* ---------------- live auto-update ----------------
     The site is a static build; data.js is regenerated and pushed after every match
     scrape. Poll it so a page left open picks up new results — the knockout bracket,
     group tables and fixtures — without a manual refresh. We splice the fresh
     window.WC_DATA into the live D object (closures keep their reference) and re-render
     the result-driven views. */
  function parseDataJs(text) {
    var w = {};
    (new Function("window", text))(w);   // data.js body is `window.WC_DATA = {...}`
    return w.WC_DATA;
  }
  function showUpdateToast() {
    var t = document.getElementById("liveToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "liveToast"; t.className = "live-toast";
      document.body.appendChild(t);
    }
    t.textContent = "↻ Results updated";
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("show"); }, 4000);
  }
  function renderResultsViews() {
    [renderOverviewStats, renderGroups, renderThirdPlace, renderBracket, renderMatches, renderStory].forEach(function (fn) {
      try { fn(); } catch (e) { /* keep going if one view fails */ }
    });
    try {
      document.getElementById("footerNote").textContent =
        "Data generated " + D.generated + " · " + D.counts.played + " matches played · " +
        D.counts.with_xg + " with xG · " + PLAYERS.length + " players · built from the WC2026 pipeline.";
    } catch (e) {}
  }
  /* ======================= PLAYER LAB ======================= */
  // Ported from the XLALIGA dashboard (itself from the BCN dashboard): pick a TEAM,
  // then a player, plus an optional compare player — the flag badges filter which
  // nations the compare list draws from. Stat cards / radar / head-to-head bars read
  // the tournament aggregates already in players.js; the action maps read a per-team
  // event file (player_lab/<slug>.js) fetched on demand.
  var PL_ACC = "#33e893", PL_BLUE = "#9d6bff", PL_MUTED = "#8b8fb8", PL_RED = "#ff5c7a";
  var PL = { main: null, cmp: null, teams: {} };   // main/cmp store "Team @@ Player"
  var PL_MAPS = [["shots", "Shots"], ["dribbles", "Take-ons"], ["passes", "Passes"], ["prog", "Progressive passes"]];
  var PL_RADAR = [
    { k: "g", t: "Finishing" }, { k: "ga", t: "G+A" }, { k: "shots", t: "Shooting" },
    { k: "keyPasses", t: "Creativity" }, { k: "dribbles", t: "Dribbling" },
    { k: "def", t: "Defending" }, { k: "aerials", t: "Aerials" }, { k: "rating", t: "Rating", raw: true }
  ];
  function plN2(x) { return (Math.round((x || 0) * 100) / 100).toFixed(2); }
  function plSgn(x) { x = Math.round((x || 0) * 100) / 100; return (x > 0 ? "+" : "") + x.toFixed(2); }
  function plSlug(t) { return t.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
  function plFind(team, name) {
    for (var i = 0; i < PLAYERS.length; i++) if (PLAYERS[i].team === team && PLAYERS[i].name === name) return PLAYERS[i];
    return null;
  }
  function plPer90(p, k) {
    var m = p.mins || 0;
    if (k === "def") return m ? ((p.tackles || 0) + (p.interceptions || 0)) / m * 90 : 0;
    return m ? (p[k] || 0) / m * 90 : 0;
  }
  function plVal(p, mt) { return mt.raw ? (p[mt.k] || 0) : plPer90(p, mt.k); }
  function plPct(pool, val, getter) {
    var below = 0;
    for (var i = 0; i < pool.length; i++) if (getter(pool[i]) <= val) below++;
    return pool.length ? Math.round(100 * below / pool.length) : 0;
  }
  function plTipWire(host) {
    if (!host || host._plTip) return;
    host._plTip = 1;
    host.addEventListener("pointermove", function (e) {
      var t = e.target, inf = t && t.getAttribute && t.getAttribute("data-info");
      if (inf) {
        tooltip.innerHTML = tipHTML(inf); tooltip.style.opacity = "1";
        tooltip.style.left = (e.clientX + 14) + "px"; tooltip.style.top = (e.clientY + 14) + "px";
      } else tooltip.style.opacity = "0";
    });
    host.addEventListener("pointerleave", function () { tooltip.style.opacity = "0"; });
  }

  // stat card; shows a second (compare) player's value SIDE BY SIDE when picked
  function plCard(mv, cv, k, cls) {
    if (cv == null) return '<div class="stat"><div class="v ' + (cls || "") + '">' + mv + '</div><div class="k">' + k + "</div></div>";
    return '<div class="stat"><div class="cmp-vals"><div class="v accent">' + mv +
      '</div><div class="v2">' + cv + '</div></div><div class="k">' + k + "</div></div>";
  }

  function plRadarDraw(host, players, pool) {
    var W = 360, H = 340, cx = W / 2, cy = H / 2 + 6, R = 118, N = PL_RADAR.length, i, g;
    var svg = ['<svg viewBox="0 0 ' + W + " " + H + '" width="100%" class="scatter-svg">' + GLOW_DEFS];
    for (g = 1; g <= 4; g++) {
      var ring = [];
      for (i = 0; i < N; i++) { var a = -Math.PI / 2 + i / N * 2 * Math.PI, rr = R * g / 4; ring.push((cx + rr * Math.cos(a)).toFixed(1) + "," + (cy + rr * Math.sin(a)).toFixed(1)); }
      svg.push('<polygon points="' + ring.join(" ") + '" fill="none" stroke="#262c52" stroke-width="0.8"/>');
    }
    for (i = 0; i < N; i++) {
      var a2 = -Math.PI / 2 + i / N * 2 * Math.PI;
      var lx = cx + (R + 16) * Math.cos(a2), ly = cy + (R + 16) * Math.sin(a2);
      var anc = Math.abs(Math.cos(a2)) < 0.3 ? "middle" : (Math.cos(a2) > 0 ? "start" : "end");
      svg.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + R * Math.cos(a2)).toFixed(1) + '" y2="' + (cy + R * Math.sin(a2)).toFixed(1) + '" stroke="#262c52" stroke-width="0.8"/>');
      svg.push('<text x="' + lx.toFixed(1) + '" y="' + (ly + 3).toFixed(1) + '" fill="' + PL_MUTED + '" font-size="10.5" text-anchor="' + anc + '">' + PL_RADAR[i].t + "</text>");
    }
    var cols = [PL_ACC, PL_BLUE];
    players.forEach(function (p, pi) {
      var pts = [], dots = "";
      for (i = 0; i < N; i++) {
        var mt = PL_RADAR[i], val = plVal(p, mt);
        var pct = plPct(pool, val, (function (m) { return function (q) { return plVal(q, m); }; })(mt)) / 100;
        var a3 = -Math.PI / 2 + i / N * 2 * Math.PI, rr2 = R * Math.max(0.04, pct);
        var vx = cx + rr2 * Math.cos(a3), vy = cy + rr2 * Math.sin(a3);
        pts.push(vx.toFixed(1) + "," + vy.toFixed(1));
        var info = p.name + " — " + mt.t + ": " + Math.round(pct * 100) + " pctl (" + val.toFixed(2) + (mt.raw ? "" : "/90") + ")";
        dots += '<circle cx="' + vx.toFixed(1) + '" cy="' + vy.toFixed(1) + '" r="3.4" fill="' + cols[pi] + '" stroke="#050611" stroke-width="1" data-info="' + esc(info) + '"/>';
      }
      svg.push('<polygon points="' + pts.join(" ") + '" fill="' + cols[pi] + '" fill-opacity="0.18" stroke="' + cols[pi] + '" stroke-width="2"/>');
      svg.push(dots);
    });
    svg.push("</svg>");
    host.innerHTML = svg.join("");
    plTipWire(host);
    var leg = document.getElementById("plRadarLegend");
    if (leg) leg.innerHTML = players.map(function (p, pi) { return '<span class="pl-leg"><i class="pl-sw" style="background:' + cols[pi] + '"></i>' + esc(p.name) + "</span>"; }).join("");
  }

  // --- action maps: shots on a vertical HALF pitch (goal on top); rest on the full pitch
  var _plGid = 0, PL_HPW = 68, PL_HPH = 52;
  function plMapX(wy) { return (100 - wy) / 100 * PL_HPW; }
  function plMapY(wx) { return Math.max(-1, Math.min(1.03, (100 - wx) / 50)) * PL_HPH; }
  function plPitchHalf(inner) {
    var midx = PL_HPW / 2, boxW = 40.3, boxD = 16.5, sixW = 18.32, sixD = 5.5, goalW = 7.32;
    var s = '<svg viewBox="-1 -3 ' + (PL_HPW + 2) + " " + (PL_HPH + 5) + '" width="100%" style="display:block;background:#0b0d1f;border-radius:6px">';
    s += '<rect x="0.3" y="0.3" width="' + (PL_HPW - 0.6) + '" height="' + (PL_HPH - 0.6) + '" fill="none" stroke="#262c52" stroke-width="0.4"/>';
    s += '<rect x="' + (midx - boxW / 2).toFixed(1) + '" y="0.3" width="' + boxW + '" height="' + boxD + '" fill="none" stroke="#262c52" stroke-width="0.4"/>';
    s += '<rect x="' + (midx - sixW / 2).toFixed(1) + '" y="0.3" width="' + sixW + '" height="' + sixD + '" fill="none" stroke="#262c52" stroke-width="0.4"/>';
    s += '<rect x="' + (midx - goalW / 2).toFixed(1) + '" y="-1.6" width="' + goalW + '" height="1.6" fill="none" stroke="#33e893" stroke-width="0.5"/>';
    s += '<path d="M ' + (midx - 7.3) + " " + boxD + " A 9.15 9.15 0 0 0 " + (midx + 7.3) + " " + boxD + '" fill="none" stroke="#262c52" stroke-width="0.4"/>';
    return s + inner + "</svg>";
  }
  function plPitchFull(inner) {
    return '<svg viewBox="0 0 100 64" width="100%" style="display:block;background:#0b0d1f;border-radius:6px">' +
      '<rect x="0.4" y="0.4" width="99.2" height="63.2" fill="none" stroke="#262c52" stroke-width="0.4"/>' +
      '<line x1="50" y1="0" x2="50" y2="64" stroke="#262c52" stroke-width="0.4"/>' +
      '<circle cx="50" cy="32" r="7" fill="none" stroke="#262c52" stroke-width="0.4"/>' +
      '<rect x="83" y="18" width="17" height="28" fill="none" stroke="#262c52" stroke-width="0.4"/>' +
      '<rect x="0" y="18" width="17" height="28" fill="none" stroke="#262c52" stroke-width="0.4"/>' + inner + "</svg>";
  }
  function plGraph(host, events, kind) {
    if (!host) return;
    events = events || [];
    if (events.length > 400) { var st = Math.ceil(events.length / 400); events = events.filter(function (_, ix) { return ix % st === 0; }); }
    var gid = "plg" + (_plGid++), GREEN = "#33e893", RED = PL_RED, half = kind === "shots";
    function di(t) { return ' data-info="' + esc(t) + '"'; }
    function opp(e) { var o = e[e.length - 1]; return o ? " — vs " + o : ""; }
    function pt(wx, wy) { return half ? [plMapX(wy), plMapY(wx)] : [wx, 64 - wy * 0.64]; }
    var s = '<defs><marker id="' + gid + 'g" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 Z" fill="' + GREEN + '"/></marker>' +
      '<marker id="' + gid + 'r" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 Z" fill="' + RED + '"/></marker></defs>';
    if (kind === "shots") {
      events.forEach(function (e) { // [x,y,gy,xg,goal,ot,min,opp]
        var a = pt(e[0], e[1]), b = pt(100, e[2]), xg = e[3], goal = e[4], ot = e[5];
        var r = 0.25 + Math.sqrt(xg) * 0.7, col = goal ? GREEN : RED, solid = goal || ot;
        var out = goal ? "GOAL" : ot ? "On target" : "Off target / blocked";
        var info = e[6] + "' — xG " + xg.toFixed(2) + " · " + out + opp(e);
        s += '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) +
          '" stroke="' + col + '" stroke-width="' + (goal ? 0.3 : 0.2) + '" stroke-opacity="' + (goal ? 0.8 : 0.28) + '"/>';
        s += '<circle cx="' + a[0].toFixed(1) + '" cy="' + a[1].toFixed(1) + '" r="' + r.toFixed(1) +
          '" fill="' + (solid ? col : "none") + '" fill-opacity="0.6" stroke="' + col + '" stroke-width="' + (solid ? 0 : 0.32) + '"' + di(info) + "/>";
      });
    } else if (kind === "dribbles") {
      events.forEach(function (e) { // [x,y,ex,ey,ok,min,opp] — carry arrow when the end is known
        var a = pt(e[0], e[1]), ok = e[4], col = ok ? GREEN : RED;
        var info = e[5] + "' — Take-on " + (ok ? "won" : "lost") + opp(e);
        if (e[2] >= 0) {
          var b = pt(e[2], e[3]), mk = "url(#" + gid + (ok ? "g" : "r") + ")";
          s += '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) +
            '" stroke="' + col + '" stroke-width="0.4" stroke-opacity="0.75" marker-end="' + mk + '"' + di(info) + "/>";
        }
        s += '<circle cx="' + a[0].toFixed(1) + '" cy="' + a[1].toFixed(1) + '" r="0.9" fill="' + (ok ? col : "none") +
          '" stroke="' + col + '" stroke-width="0.4"' + di(info) + "/>";
      });
    } else { // passes / prog on the full pitch (attacking right)
      events.forEach(function (e) { // [x,y,ex,ey,ok,prog,min,opp]
        var a = pt(e[0], e[1]), b = pt(e[2], e[3]), ok = e[4], prog = kind === "prog" ? 1 : e[5], mn = e[6];
        var info = mn + "' — " + (ok ? "Complete" : "Incomplete") + (prog ? " · progressive" : "") + opp(e);
        var col = ok ? (prog ? GREEN : "#22b871") : RED, mk = "url(#" + gid + (ok ? "g" : "r") + ")";
        s += '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) +
          '" stroke="' + col + '" stroke-width="' + (prog ? 0.45 : 0.28) + '" stroke-opacity="0.72"' + (ok ? "" : ' stroke-dasharray="0.9 0.9"') + ' marker-end="' + mk + '"' + di(info) + "/>";
      });
    }
    host.innerHTML = half ? plPitchHalf(s) : plPitchFull(s);
    plTipWire(host);
  }
  function plMapSummary(arr, kind, passes) {
    arr = arr || []; var n = arr.length, i;
    if (kind === "shots") {
      var g = 0, ot = 0;
      for (i = 0; i < n; i++) { if (arr[i][4]) g++; if (arr[i][5]) ot++; }
      return n + " shots · " + ot + " on target · " + g + " goals · " + (n ? Math.round(100 * g / n) : 0) + "% conv";
    }
    if (kind === "prog") { var tp = passes ? passes.length : 0; return n + " progressive · " + (tp ? Math.round(100 * n / tp) : 0) + "% of passes"; }
    var ok = 0;
    for (i = 0; i < n; i++) if (arr[i][4]) ok++;
    var w = { dribbles: ["take-ons", "won", "lost"], passes: ["passes", "complete", "incomplete"] }[kind] || ["", "ok", "fail"];
    return n + " " + w[0] + " · " + ok + " " + w[1] + " · " + (n - ok) + " " + w[2] + " · " + (n ? Math.round(100 * ok / n) : 0) + "%";
  }

  function plEvents(team, name) { var t = (window.WC_PLAYERLAB || {})[team] || {}; return t[name] || { shots: [], dribbles: [], passes: [] }; }
  function plDataFor(ev, kind) { return kind === "prog" ? (ev.passes || []).filter(function (q) { return q[5]; }) : (ev[kind] || []); }
  function plLoadTeam(team, cb) {
    if ((window.WC_PLAYERLAB || {})[team]) { cb(); return; }
    var sc = document.createElement("script");
    sc.src = ED_BASE + "player_lab/" + plSlug(team) + ".js";
    sc.onload = cb; sc.onerror = function () { cb(); };
    document.head.appendChild(sc);
  }
  function plDrawMaps(main, pc, cmpTeam) {
    var ea = plEvents(main.team, main.name), eb = pc ? plEvents(cmpTeam, pc.name) : null;
    var cols = pc ? "1fr 1fr" : "1fr", host = document.getElementById("plHeatGrid");
    // Comparing: one map per full-width row (bigger A|B pitches); single: compact 2x2.
    host.classList.toggle("pl-heat-grid--rows", !!pc);
    host.innerHTML = PL_MAPS.map(function (mt, i) {
      var sumA = '<div class="pl-map-sum" style="color:' + PL_ACC + '">' + (pc ? "<b>" + esc(main.name) + "</b> · " : "") + plMapSummary(plDataFor(ea, mt[0]), mt[0], ea.passes) + "</div>";
      var sumB = pc ? '<div class="pl-map-sum" style="color:' + PL_BLUE + '"><b>' + esc(pc.name) + "</b> · " + plMapSummary(plDataFor(eb, mt[0]), mt[0], eb.passes) + "</div>" : "";
      // Summaries share the pitch column grid so each player's line sits above their own pitch.
      var sums = '<div class="pl-map-sums" style="grid-template-columns:' + cols + '">' + sumA + sumB + "</div>";
      return '<div class="pl-map"><div class="pl-map-title">' + mt[1] + "</div>" + sums +
        '<div class="pl-map-cols" style="grid-template-columns:' + cols + '"><div id="plg_a_' + i + '"></div>' + (pc ? '<div id="plg_b_' + i + '"></div>' : "") + "</div></div>";
    }).join("");
    PL_MAPS.forEach(function (mt, i) {
      plGraph(document.getElementById("plg_a_" + i), plDataFor(ea, mt[0]), mt[0]);
      if (pc) plGraph(document.getElementById("plg_b_" + i), plDataFor(eb, mt[0]), mt[0]);
    });
  }
  function plRender() {
    if (!PLAYERS.length || !PL.main) { var h = document.getElementById("plStats"); if (h) h.innerHTML = ""; return; }
    var mparts = PL.main.split(" @@ ");
    var main = plFind(mparts[0], mparts[1]); if (!main) return;
    var cmpTeam = null, cmpName = null;
    if (PL.cmp) { var parts = PL.cmp.split(" @@ "); cmpTeam = parts[0]; cmpName = parts[1]; }
    var pc = cmpName ? plFind(cmpTeam, cmpName) : null;
    function rtg(q) { return q.rating ? q.rating.toFixed(2) : "&ndash;"; }
    function xgi(q) { return plN2((q.xg || 0) + (q.xa || 0)); }
    var s = "";
    s += plCard(main.mp, pc ? pc.mp : null, "Apps");
    s += plCard(main.mins, pc ? pc.mins : null, "Minutes");
    s += plCard(main.g, pc ? pc.g : null, "Goals", "accent");
    s += plCard(main.a, pc ? pc.a : null, "Assists", "blue");
    s += plCard(plN2(main.xg), pc ? plN2(pc.xg) : null, "xG");
    s += plCard(plSgn(main.xg_diff), pc ? plSgn(pc.xg_diff) : null, "xG&plusmn;", main.xg_diff >= 0 ? "pos" : "neg");
    s += plCard(plN2(main.xa), pc ? plN2(pc.xa) : null, "xA", "blue");
    s += plCard(xgi(main), pc ? xgi(pc) : null, "xGI", "accent");
    s += plCard(main.shots, pc ? pc.shots : null, "Shots");
    s += plCard(main.keyPasses, pc ? pc.keyPasses : null, "Key Passes");
    s += plCard(rtg(main), pc ? rtg(pc) : null, "Avg Rating", "accent");
    document.getElementById("plStats").innerHTML = s;

    var pool = PLAYERS.filter(function (q) { return (q.mins || 0) >= 90; });
    var players = [main]; if (pc) players.push(pc);
    plRadarDraw(document.getElementById("plRadar"), players, pool.length ? pool : PLAYERS);

    var barsCard = document.getElementById("plBarsCard");
    if (pc) {
      document.getElementById("plCompareTitle").innerHTML = esc(main.name) + " vs " + esc(pc.name);
      var mets = [["g", "Goals"], ["a", "Assists"], ["shots", "Shots"], ["keyPasses", "Key passes"],
                  ["dribbles", "Take-ons"], ["tackles", "Tackles"], ["interceptions", "Interceptions"], ["passes", "Passes"]];
      document.getElementById("plCompareBody").innerHTML = mets.map(function (mt) {
        var av = main[mt[0]] || 0, bv = pc[mt[0]] || 0, t = (av + bv) || 1, ap = Math.round(100 * av / t);
        return '<div class="stat-cmp"><div class="sc-val' + (av >= bv ? " win" : "") + '">' + av + "</div>" +
          '<div><div class="sc-label">' + mt[1] + '</div><div class="sc-bar">' +
          '<div class="sc-fill h" style="width:' + ap + '%"></div><div class="sc-fill a" style="width:' + (100 - ap) + '%"></div></div></div>' +
          '<div class="sc-val' + (bv > av ? " win" : "") + '">' + bv + "</div></div>";
      }).join("");
      barsCard.style.display = "";
    } else barsCard.style.display = "none";

    document.getElementById("plHeatNameA").textContent = main.name;
    document.getElementById("plHeatNameB").textContent = pc ? pc.name : "";
    // stamp the render so a slower earlier load can't overdraw a newer selection
    var seq = ++_plRenderSeq;
    plLoadTeam(main.team, function () {
      if (pc) plLoadTeam(cmpTeam, function () { if (seq === _plRenderSeq) plDrawMaps(main, pc, cmpTeam); });
      else if (seq === _plRenderSeq) plDrawMaps(main, null, null);
    });
  }
  var _plRenderSeq = 0;
  function plTeamList() {
    var seen = {}, out = [];
    PLAYERS.forEach(function (p) { if (p.team && !seen[p.team]) { seen[p.team] = 1; out.push(p.team); } });
    return out.sort();
  }
  function plTeamsActive() {
    return Object.keys(PL.teams || {}).filter(function (k) { return PL.teams[k]; });
  }
  function plPool() {
    // players from the badge-selected nations (none selected = the whole tournament)
    var filtered = plTeamsActive().length > 0;
    return PLAYERS.filter(function (p) { return (p.mp || 0) > 0 && (!filtered || PL.teams[p.team]); });
  }
  function plGroupedOptions(pool, withNone) {
    var byTeam = {};
    pool.forEach(function (p) { (byTeam[p.team] = byTeam[p.team] || []).push(p); });
    var opts = withNone ? '<option value="">&mdash; none &mdash;</option>' : "";
    Object.keys(byTeam).sort().forEach(function (t) {
      opts += '<optgroup label="' + esc(t) + '">';
      byTeam[t].sort(function (a, b) { return (b.ga || 0) - (a.ga || 0); }).forEach(function (p) {
        opts += '<option value="' + esc(t + " @@ " + p.name) + '">' + esc(p.name) + "</option>";
      });
      opts += "</optgroup>";
    });
    return opts;
  }
  function plBuildPlayers() {
    var mainSel = document.getElementById("plMain"), pool = plPool();
    mainSel.innerHTML = plGroupedOptions(pool, false);
    var ok = PL.main && pool.some(function (p) { return (p.team + " @@ " + p.name) === PL.main; });
    if (!ok) {
      var top = pool.slice().sort(function (a, b) { return (b.ga || 0) - (a.ga || 0); })[0];
      PL.main = top ? (top.team + " @@ " + top.name) : null;
    }
    mainSel.value = PL.main || "";
  }
  function plBuildCompare() {
    var cmpSel = document.getElementById("plCompare");
    cmpSel.innerHTML = plGroupedOptions(plPool(), true);
    cmpSel.value = PL.cmp || "";
    if (cmpSel.value !== (PL.cmp || "")) PL.cmp = null;
  }
  // Clickable flag badges — THE team filter for the whole lab (replaces the old Team
  // dropdown). Toggle one or more nations to narrow BOTH player lists; "All" clears.
  function plBuildBadges() {
    var host = document.getElementById("plBadges");
    if (!host) return;
    var any = plTeamsActive().length > 0;
    host.innerHTML = '<button type="button" class="pl-badge pl-badge-all' + (any ? "" : " on") + '" data-team="">All</button>' +
      plTeamList().map(function (t) {
        return '<button type="button" class="pl-badge' + (PL.teams[t] ? " on" : "") +
          '" data-team="' + esc(t) + '" title="' + esc(t) + '">' + logoImg(t, "pl-crest") + "</button>";
      }).join("");
    if (!host._wired) {
      host._wired = 1;
      host.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest(".pl-badge") : null;
        if (!btn) return;
        var t = btn.getAttribute("data-team");
        if (!t) PL.teams = {};                      // "All" resets the filter
        else PL.teams[t] = !PL.teams[t];
        // drop the compare pick if its nation fell out; the main pick re-defaults in build
        if (PL.cmp && plTeamsActive().length && !PL.teams[PL.cmp.split(" @@ ")[0]]) PL.cmp = null;
        plBuildBadges();
        plBuildPlayers();
        plBuildCompare();
        plRender();
      });
    }
  }
  function plBuild() {
    if (!document.getElementById("plMain") || !PLAYERS.length) return;
    plBuildBadges();
    plBuildPlayers();
    plBuildCompare();
  }
  function wirePlayerLab() {
    var mainSel = document.getElementById("plMain"), cmpSel = document.getElementById("plCompare");
    if (!mainSel || mainSel._wired) return;
    mainSel._wired = 1;
    mainSel.addEventListener("change", function () { PL.main = mainSel.value; plRender(); });
    cmpSel.addEventListener("change", function () { PL.cmp = cmpSel.value || null; plRender(); });
  }
  // Build lazily on the first visit to the tab (keeps initial page load light).
  wirePlayerLab();
  var _plTabBtn = document.querySelector('nav.tabs button[data-view="playerlab"]');
  if (_plTabBtn) _plTabBtn.addEventListener("click", function () {
    if (!PL._init) { PL._init = 1; plBuild(); plRender(); }
  });
  // Eras fetches the other two editions' data over the network — lazy on first visit.
  var _erasInit = false;
  var _erasTabBtn = document.querySelector('nav.tabs button[data-view="eras"]');
  if (_erasTabBtn) _erasTabBtn.addEventListener("click", function () {
    if (!_erasInit) { _erasInit = 1; renderEras(); }
  });

  var _polling = false;
  function refreshData() {
    // Historical editions are static (backfilled once, never re-scraped) — no point polling.
    if (ED !== 2026 || _polling || document.hidden) return;
    _polling = true;
    fetch("data.js?v=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (txt) {
        if (txt) {
          var nd = parseDataJs(txt);
          if (nd && nd.generated && nd.generated !== D.generated) {
            Object.keys(D).forEach(function (k) { delete D[k]; });
            Object.assign(D, nd);
            renderResultsViews();
            showUpdateToast();
          }
        }
      })
      .catch(function () { /* offline / file:// — ignore */ })
      .then(function () { _polling = false; });
  }
  setInterval(refreshData, 90000);                 // every 90s while the tab is visible
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshData(); });
})();
