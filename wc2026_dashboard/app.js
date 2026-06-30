/* WC2026 dashboard front-end. Consumes window.WC_DATA from data.js (no build step,
   no network). Renders group tables, fixtures, and the xG analysis section. */
(function () {
  "use strict";
  var D = window.WC_DATA;
  if (!D) { document.body.innerHTML = "<p style='padding:40px'>data.js failed to load.</p>"; return; }

  var LOGO = "../team_logos/wc2026/";
  var tooltip = document.getElementById("tooltip");

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
    var svg = ['<svg viewBox="0 0 ' + W + " " + H + '" width="100%" class="scatter-svg">'];
    niceTicks(xMax).forEach(function (t) {
      var X = sx(t);
      svg.push('<line x1="' + X.toFixed(1) + '" y1="' + padT + '" x2="' + X.toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="#222b44" stroke-width="0.6"/>');
      svg.push('<text x="' + X.toFixed(1) + '" y="' + (padT + plotH + 16) + '" fill="#93a0bd" font-size="10" text-anchor="middle">' + fmtTick(t) + "</text>");
    });
    niceTicks(yMax).forEach(function (t) {
      var Y = sy(t);
      svg.push('<line x1="' + padL + '" y1="' + Y.toFixed(1) + '" x2="' + (padL + plotW) + '" y2="' + Y.toFixed(1) + '" stroke="#222b44" stroke-width="0.6"/>');
      svg.push('<text x="' + (padL - 8) + '" y="' + (Y + 3).toFixed(1) + '" fill="#93a0bd" font-size="10" text-anchor="end">' + fmtTick(t) + "</text>");
    });
    if (cfg.diagonal) {
      var lo = Math.min(xMax, yMax);
      svg.push('<line x1="' + sx(0) + '" y1="' + sy(0) + '" x2="' + sx(lo) + '" y2="' + sy(lo) + '" stroke="#93a0bd" stroke-width="1.2" stroke-dasharray="5 4"/>');
      svg.push('<text x="' + (sx(lo) - 4).toFixed(1) + '" y="' + (sy(lo) - 6).toFixed(1) + '" fill="#93a0bd" font-size="10" text-anchor="end">exactly deserved</text>');
    }
    if (cfg.avgX != null) {
      var AX = sx(cfg.avgX);
      svg.push('<line x1="' + AX.toFixed(1) + '" y1="' + padT + '" x2="' + AX.toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="#5d6a90" stroke-width="1" stroke-dasharray="4 4"/>');
      svg.push('<text x="' + (AX + 3).toFixed(1) + '" y="' + (padT + 11) + '" fill="#7e8bb0" font-size="9.5">avg</text>');
    }
    if (cfg.avgY != null) {
      var AY = sy(cfg.avgY);
      svg.push('<line x1="' + padL + '" y1="' + AY.toFixed(1) + '" x2="' + (padL + plotW) + '" y2="' + AY.toFixed(1) + '" stroke="#5d6a90" stroke-width="1" stroke-dasharray="4 4"/>');
      svg.push('<text x="' + (padL + plotW - 4) + '" y="' + (AY - 4).toFixed(1) + '" fill="#7e8bb0" font-size="9.5" text-anchor="end">avg</text>');
    }
    (cfg.corners || []).forEach(function (c) {
      var x = c.h === "l" ? padL + 8 : padL + plotW - 8, anc = c.h === "l" ? "start" : "end";
      var y = c.v === "t" ? padT + 14 : padT + plotH - 8;
      svg.push('<text x="' + x + '" y="' + y + '" fill="' + c.color + '" font-size="11" font-weight="700" text-anchor="' + anc + '" opacity="0.85">' + c.text + "</text>");
    });
    svg.push('<text x="' + (padL + plotW / 2) + '" y="' + (H - 6) + '" fill="#e8edf7" font-size="12.5" text-anchor="middle">' + cfg.xLabel + "</text>");
    svg.push('<text x="15" y="' + (padT + plotH / 2) + '" fill="#e8edf7" font-size="12.5" text-anchor="middle" transform="rotate(-90 15 ' + (padT + plotH / 2) + ')">' + cfg.yLabel + "</text>");
    rows.forEach(function (r) { r.cx = sx(r.x); r.cy = sy(r.y); });
    rows.forEach(function (r) {
      svg.push('<circle cx="' + r.cx.toFixed(1) + '" cy="' + r.cy.toFixed(1) + '" r="5" fill="' + r.col +
        '" fill-opacity="0.9" stroke="#0b0f1a" stroke-width="0.9"><title>' + esc(r.team) + (cfg.tip ? " — " + cfg.tip(r) : "") + "</title></circle>");
    });
    declutter(rows, 8.7);
    rows.forEach(function (r) {
      if (r.led) svg.push('<line x1="' + r.cx.toFixed(1) + '" y1="' + r.cy.toFixed(1) + '" x2="' + (r.lx - 1).toFixed(1) + '" y2="' + (r.ly - 3).toFixed(1) + '" stroke="#46527a" stroke-width="0.6"/>');
      svg.push('<text x="' + r.lx.toFixed(1) + '" y="' + r.ly.toFixed(1) + '" fill="#c2cce0" font-size="8.7">' + esc(r.team) + "</text>");
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
  // {team, label} for one side of a knockout fixture (team = null when not narrowed to one).
  function koSide(K, m, idx) {
    if (m.played && m.hs != null) { var t = idx === 0 ? m.home : m.away; return { team: t, label: t, possible: [t] }; }
    var poss;
    if (m._kids && m._kids[idx]) poss = koCands(K, m._kids[idx]);
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
        if (m.png) links.push('<a class="open-match png" href="' + esc(m.png) +
          '" target="_blank" rel="noopener">PNG 🖼️</a>');
        var xgline = "";
        if (m.xg_home != null) {
          // Canonical xG = average of our model + FotMob when both exist (see build_data).
          xgline = 'xG <b>' + m.xg_home.toFixed(2) + "</b> — <b>" + m.xg_away.toFixed(2) + "</b>";
          if (m.xg_source === "avg") xgline += ' <span class="xg-cmp">avg</span>';
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
            window.location.href = "match.html?id=" + encodeURIComponent(m.id);
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

    var svg = ['<svg viewBox="0 0 ' + W + " " + H + '" width="100%" class="scatter-svg">'];
    // grid + axes
    for (var g = 0; g <= maxV; g++) {
      svg.push('<line x1="' + sx(g) + '" y1="' + sy(0) + '" x2="' + sx(g) + '" y2="' + sy(maxV) +
        '" stroke="#26304d" stroke-width="' + (g === 0 ? 1.4 : 0.5) + '"/>');
      svg.push('<line x1="' + sx(0) + '" y1="' + sy(g) + '" x2="' + sx(maxV) + '" y2="' + sy(g) +
        '" stroke="#26304d" stroke-width="' + (g === 0 ? 1.4 : 0.5) + '"/>');
      svg.push('<text x="' + sx(g) + '" y="' + (sy(0) + 16) + '" fill="#93a0bd" font-size="10" text-anchor="middle">' + g + "</text>");
      if (g > 0) svg.push('<text x="' + (sx(0) - 8) + '" y="' + (sy(g) + 3) + '" fill="#93a0bd" font-size="10" text-anchor="end">' + g + "</text>");
    }
    // y=x perfect-finishing reference
    svg.push('<line x1="' + sx(0) + '" y1="' + sy(0) + '" x2="' + sx(maxV) + '" y2="' + sy(maxV) +
      '" stroke="#93a0bd" stroke-width="1.2" stroke-dasharray="5 4"/>');
    // regression line
    var x0 = 0, x1 = maxV;
    svg.push('<line x1="' + sx(x0) + '" y1="' + sy(fit.intercept) + '" x2="' + sx(x1) + '" y2="' +
      sy(fit.slope * x1 + fit.intercept) + '" stroke="#3ddc97" stroke-width="2"/>');
    // axis labels
    svg.push('<text x="' + (W / 2) + '" y="' + (H - 6) + '" fill="#e8edf7" font-size="12" text-anchor="middle">Expected goals (xG)</text>');
    svg.push('<text x="14" y="' + (H / 2) + '" fill="#e8edf7" font-size="12" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')">Actual goals</text>');
    // points (jitter identical points slightly so they don't fully overlap)
    R.forEach(function (r, i) {
      var jx = ((i * 7) % 5 - 2) * 1.2, jy = ((i * 3) % 5 - 2) * 1.2;
      var cx = sx(r.xgf) + jx, cy = sy(r.gf) + jy;
      var over = r.gf - r.xgf;
      var col = over > 0.4 ? "#3ddc97" : over < -0.4 ? "#ff6b81" : "#4ea1ff";
      svg.push('<circle class="pt" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) +
        '" r="5.5" fill="' + col + '" fill-opacity="0.78" stroke="#0b0f1a" stroke-width="1" ' +
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
  var COL = { green: "#3ddc97", blue: "#4ea1ff", orange: "#ffb454", red: "#ff6b81" };
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
    var cols = [
      ["name", "Player", "t"], ["team", "Team", "tm"], ["pos", "Pos", "s"],
      ["mp", "MP", "i"], ["mins", "Min", "i"], ["g", "G", "i"], ["a", "A", "i"], ["ga", "G+A", "i"],
      ["xg", "xG", "f"], ["xg_diff", "xG±", "f"], ["shots", "Sh", "i"], ["sot", "SoT", "i"],
      ["keyPasses", "KP", "i"], ["passes", "Pass", "i"], ["pass_pct", "Pass%", "pc"],
      ["tackles", "Tkl", "i"], ["interceptions", "Int", "i"], ["yc", "Y", "i"], ["rc", "R", "i"],
      ["rating", "Rt", "f"],
    ];
    var rows = PLAYERS.filter(function (p) {
      if (team && p.team !== team) return false;
      if (q && p.name.toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var k = playerSort.key;
      if (k === "name" || k === "team" || k === "pos")
        return playerSort.dir * String(a[k]).localeCompare(String(b[k]));
      return playerSort.dir * ((a[k] || 0) - (b[k] || 0));
    }).slice(0, 300);

    function cell(p, c) {
      var k = c[0], v = p[k];
      if (k === "name") return '<td class="team"><span class="nm">' + esc(p.name) + "</span></td>";
      if (k === "team") return '<td class="team"><div class="team-cell">' + logoImg(p.team) +
        '<span class="nm">' + esc(p.team) + "</span></div></td>";
      if (k === "pos") return "<td>" + esc(p.pos || "") + "</td>";
      if (v == null) return "<td>–</td>";
      if (c[2] === "f") v = (+v).toFixed(2);
      else if (c[2] === "pc") v = v + "%";
      var cls = (k === "xg_diff") ? (p.xg_diff > 0.05 ? "delta pos" : p.xg_diff < -0.05 ? "delta neg" : "") : "";
      var disp = (k === "xg_diff" && p.xg_diff > 0 ? "+" : "") + v;
      return "<td>" + (cls ? '<span class="' + cls + '">' + disp + "</span>" : disp) + "</td>";
    }
    var head = cols.map(function (c) {
      var arr = playerSort.key === c[0] ? (playerSort.dir < 0 ? " ▼" : " ▲") : "";
      return '<th class="' + (c[2] === "t" || c[2] === "tm" ? "team" : "") + '" data-k="' + c[0] + '">' +
        c[1] + '<span class="arr">' + arr + "</span></th>";
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
    document.querySelectorAll("#playerPresets .seg-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll("#playerPresets .seg-btn").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        playerPreset = b.dataset.preset;
        playerSort = { key: playerPreset, dir: -1 };
        renderPlayersTable();
      });
    });
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
      return '<a class="data-card" href="database/' + esc(t.file) + '" download>' +
        '<div class="dc-name">' + esc(t.label) + "</div>" +
        '<div class="dc-meta">' + t.rows + " rows · " + esc(t.file) + " · CSV</div>" +
        '<div class="dc-dl">⬇ Download</div></a>';
    }).join("");
    document.getElementById("sqliteLink").setAttribute("href", "database/" + db.sqlite);
    if (db.raw_match_files) {
      document.getElementById("rawNote").innerHTML =
        "All <b>" + db.raw_match_files + "</b> scraped match JSON files (FotMob + WhoScored merged, with the full " +
        "event stream) live in <code>wc2026/matches/</code> in the repository.";
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
  function buildKnockout() {
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
    // R16 numbered 1..8 (EF) in schedule order; each R16's feeders are its two R32 ties
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
    // Header columns aligned to the left-to-right layout (R32 → Final).
    var head = document.getElementById("bracketHead");
    if (head) {
      var MW = "var(--bk-mw)", MID = "calc(var(--bk-mw) + var(--bk-edge))";
      var cells = [["Round of 32", MW], ["Round of 16", MID], ["Quarter-finals", MID],
        ["Semi-finals", MID], ["Final", MID]];
      head.innerHTML = cells.map(function (c) { return '<span class="bk-hcell" style="width:' + c[1] + '">' + c[0] + "</span>"; }).join("");
    }
  }

  /* ================= POWER RANK & KNOCKOUT PREDICTIONS (Power Rank tab) =================
     A single Power Index per knockout team = pre-tournament FIFA ranking points + a capped
     group-stage "form" adjustment (points, goal difference and xG difference per game). The
     ratings then drive a favourite-advances simulation of every knockout tie up to the final. */

  // FIFA/Coca-Cola Men's World Ranking points — 11 June 2026 edition (the last update before
  // kick-off; Argentina 1st on 1877). Top ~45 are the published values; a few of the lowest
  // debutants are approximated. This is the "class" half of the Power Index.
  var FIFA_PTS = {
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

  // Power Index = FIFA points + group-stage form adjustment, the adjustment capped at ±100 so
  // a hot group stage tilts but can't fully override pedigree.
  function powerRating(team) {
    var fifa = FIFA_PTS[team] || 1400;
    var row = standingRow(team), ag = AGG_BY[team];
    var ppg = 0, gdpg = 0, xgdpg = 0, P = 0;
    if (row && row.P) { P = row.P; ppg = row.Pts / P; gdpg = row.GD / P; }
    if (ag && ag.n) { xgdpg = (ag.xgf - ag.xga) / ag.n; }
    var adj = 40 * (ppg - 1.6) + 28 * xgdpg + 10 * gdpg;
    adj = Math.max(-100, Math.min(100, adj));
    return {
      team: team, fifa: fifa, fifaRank: FIFA_RANK[team] || null, adj: adj, rating: fifa + adj,
      ppg: ppg, gdpg: gdpg, xgdpg: xgdpg, pts: row ? row.Pts : null, gd: row ? row.GD : null, P: P
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
  function makePred(m, hName, aName) {
    var res = { m: m, home: hName, away: aName };
    if (hName && aName) {
      var A = powerRating(hName), B = powerRating(aName);
      var pH = winProb(A.rating, B.rating);
      var fav = pH >= 0.5 ? A : B, dog = pH >= 0.5 ? B : A;
      res.A = A; res.B = B; res.pH = pH;
      res.winner = fav.team; res.loser = dog.team;
      res.favProb = Math.max(pH, 1 - pH);
      res.score = predictScore(fav, dog);
    }
    return res;
  }

  // Walk the linked knockout tree, projecting each tie from the predicted winners feeding it.
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
      return '<tr' + (champ ? ' class="champ-row"' : '') + '>' +
        '<td class="rk">' + (i + 1) + "</td>" +
        '<td class="team"><div class="team-cell">' + logoImg(p.team) + '<span class="nm">' + esc(p.team) +
          (champ ? ' <span class="champ-star">★</span>' : '') + "</span></div></td>" +
        '<td class="fifa">' + (p.fifaRank ? "#" + p.fifaRank : "–") + ' <span class="sub">' + p.fifa + "</span></td>" +
        "<td>" + (p.pts != null ? p.pts : "–") + ' <span class="sub">' + (p.gd != null ? (p.gd > 0 ? "+" + p.gd : p.gd) : "") + "</span></td>" +
        "<td>" + (p.xgdpg >= 0 ? "+" : "") + p.xgdpg.toFixed(2) + "</td>" +
        '<td><span class="delta ' + (p.adj > 2 ? "pos" : p.adj < -2 ? "neg" : "") + '">' + (p.adj >= 0 ? "+" : "") + Math.round(p.adj) + "</span></td>" +
        '<td class="pwr"><div class="pwr-bar"><span style="width:' + w.toFixed(1) + '%"></span></div><b>' + Math.round(p.rating) + "</b></td>" +
        "</tr>";
    }).join("");
    host.innerHTML = '<table class="rank power-table"><thead><tr>' +
      "<th>#</th><th class='team'>Team</th><th>FIFA</th><th>Group</th><th>xGD/g</th><th>Form</th><th class='pwr'>Power Index</th>" +
      "</tr></thead><tbody>" + body + "</tbody></table>";

    renderPredChampion(P);
    renderPredRounds(P);
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
    var foot = "Predicted: <b>" + esc(p.winner) + "</b> " + Math.round(p.favProb * 100) + "% · " +
      scoreTxt + (sc.pens ? " (pens)" : "");
    return '<div class="pred-card">' + head +
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
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="so-chart" preserveAspectRatio="xMidYMid meet" role="img">'];
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
    svg.push('<line x1="' + padL + '" y1="' + baseY.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + baseY.toFixed(1) + '" stroke="#26304d" stroke-width="1"/>');
    // x-axis ticks
    niceTicks(xMax, 6).forEach(function (t) {
      if (t < xMin - 1e-9 || t > xMax + 1e-9) return;
      svg.push('<line x1="' + sx(t).toFixed(1) + '" y1="' + baseY.toFixed(1) + '" x2="' + sx(t).toFixed(1) + '" y2="' + (baseY + 4).toFixed(1) + '" stroke="#46527a" stroke-width="1"/>');
      svg.push('<text x="' + sx(t).toFixed(1) + '" y="' + (baseY + 17) + '" fill="#7c89a8" font-size="10.5" text-anchor="middle">' + fmtTick(t) + "</text>");
    });
    // average line
    var ax = sx(mean);
    svg.push('<line x1="' + ax.toFixed(1) + '" y1="' + padT + '" x2="' + ax.toFixed(1) + '" y2="' + baseY.toFixed(1) + '" stroke="#cfd8ee" stroke-width="1.2" stroke-dasharray="5 4" stroke-opacity="0.7"/>');
    svg.push('<text x="' + ax.toFixed(1) + '" y="' + (padT - 6) + '" fill="#cfd8ee" font-size="11" text-anchor="middle">average ' + soFmt(mean, dp || 1) + "</text>");
    // dots — deterministic jitter from pid so re-renders are stable
    function jit(pid) { var s = Math.sin((pid + 1) * 12.9898) * 43758.5453; return s - Math.floor(s); }
    rows.forEach(function (p) {
      var v = +p[statKey] || 0, z = sd ? (v - mean) / sd : 0;
      var dx = sx(v), band = (maxD ? densInterp(v) / maxD : 0) * plotH;
      var dy = baseY - 4 - jit(p.pid) * Math.max(6, band - 6);
      var isSpot = spotPid && p.pid === spotPid, anom = z >= 2;
      var r = isSpot ? 5.5 : anom ? 3.4 : 2.3;
      var fill = isSpot ? "#ffd24d" : anom ? "#ff3d8b" : "#4ea1ff";
      var op = isSpot ? 1 : anom ? 0.92 : 0.5;
      var stroke = (isSpot || anom) ? ' stroke="#0b0f1a" stroke-width="0.8"' : "";
      svg.push('<circle cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) + '" r="' + r + '" fill="' + fill + '" fill-opacity="' + op + '"' + stroke + '><title>' + esc(p.name) + " · " + esc(p.team) + " — " + soFmt(v, dp) + " (" + (z >= 0 ? "+" : "") + z.toFixed(1) + "σ)</title></circle>");
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
      svg.push('<line x1="' + L.x.toFixed(1) + '" y1="' + L.y.toFixed(1) + '" x2="' + lx.toFixed(1) + '" y2="' + ly.toFixed(1) + '" stroke="' + (L.gold ? "#ffd24d" : "#ff3d8b") + '" stroke-width="0.7" stroke-opacity="0.6"/>');
      svg.push('<text x="' + lx.toFixed(1) + '" y="' + (ly - 3).toFixed(1) + '" fill="' + (L.gold ? "#ffe08a" : "#ffaecb") + '" font-size="10.5" text-anchor="middle">' + esc(L.txt) + "</text>");
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
        '<div class="so-bar-track"><div class="so-bar-fill" style="width:' + pct.toFixed(1) + "%;background:" + (hot ? "#ff3d8b" : "var(--accent-2)") + '"></div></div>' +
        '<div class="so-bar-val">' + soFmt(t.v, dp) + ' <span class="so-z">' + (t.z >= 0 ? "+" : "") + t.z.toFixed(1) + "σ</span></div></div>";
    }).join("") + "</div>");
  }

  /* ---- Two-stat scatter (find the complete players) ---- */
  var soSc = { x: "tackles", y: "gPrev", size: "xga", pos: "DEF", mins: 180 };
  var SO_PRESETS = [
    { label: "🧱 Solid defenders", x: "tackles", y: "gPrev", size: "xga", pos: "DEF", mins: 180 },
    { label: "🚧 Shot blockers", x: "blocks", y: "clrBox", size: "interceptions", pos: "DEF", mins: 90 },
    { label: "🧤 Shot-stoppers", x: "xga", y: "gPrev", size: "saves", pos: "GK", mins: 180 },
    { label: "🎨 Creators", x: "progPasses", y: "keyPasses", size: "xa", pos: "all", mins: 180 },
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
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="so-chart" preserveAspectRatio="xMidYMid meet" role="img">'];
    // gridlines + ticks
    soLTicks(dx[0], dx[1]).forEach(function (t) {
      var x = sx(t);
      svg.push('<line x1="' + x.toFixed(1) + '" y1="' + padT + '" x2="' + x.toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="#161d31" stroke-width="1"/>');
      svg.push('<text x="' + x.toFixed(1) + '" y="' + (padT + plotH + 16) + '" fill="#7c89a8" font-size="10.5" text-anchor="middle">' + soFmt(t, dpx) + "</text>");
    });
    soLTicks(dy[0], dy[1]).forEach(function (t) {
      var y = sy(t);
      svg.push('<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#161d31" stroke-width="1"/>');
      svg.push('<text x="' + (padL - 7) + '" y="' + (y + 3.5).toFixed(1) + '" fill="#7c89a8" font-size="10.5" text-anchor="end">' + soFmt(t, dpy) + "</text>");
    });
    // average lines
    svg.push('<line x1="' + sx(mx).toFixed(1) + '" y1="' + padT + '" x2="' + sx(mx).toFixed(1) + '" y2="' + (padT + plotH) + '" stroke="#cfd8ee" stroke-width="1" stroke-dasharray="5 4" stroke-opacity="0.5"/>');
    svg.push('<line x1="' + padL + '" y1="' + sy(my).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + sy(my).toFixed(1) + '" stroke="#cfd8ee" stroke-width="1" stroke-dasharray="5 4" stroke-opacity="0.5"/>');
    // axis titles
    svg.push('<text x="' + (padL + plotW / 2).toFixed(1) + '" y="' + (H - 6) + '" fill="#e8edf7" font-size="12.5" text-anchor="middle">' + esc(soStatLabel(xKey)) + " →</text>");
    svg.push('<text x="16" y="' + (padT + plotH / 2).toFixed(1) + '" fill="#e8edf7" font-size="12.5" text-anchor="middle" transform="rotate(-90 16 ' + (padT + plotH / 2).toFixed(1) + ')">' + esc(soStatLabel(yKey)) + " →</text>");
    // dots
    var pts = [];
    rows.forEach(function (p) {
      var vx = +p[xKey] || 0, vy = +p[yKey] || 0;
      var cx = sx(vx), cy = sy(vy), r = radius(p);
      var elite = vx > mx && vy > my;
      var isSpot = spotPid && p.pid === spotPid;
      var fill = isSpot ? "#ffd24d" : elite ? "#ff3d8b" : "#4ea1ff";
      var op = isSpot ? 1 : elite ? 0.85 : 0.5;
      var stroke = (isSpot || elite) ? ' stroke="#0b0f1a" stroke-width="0.9"' : "";
      var tip = esc(p.name) + " · " + esc(p.team) + " — " + esc(soStatLabel(xKey)) + " " + soFmt(vx, dpx) +
        ", " + esc(soStatLabel(yKey)) + " " + soFmt(vy, dpy) + (sizeKey ? " · " + esc(soStatLabel(sizeKey)) + " " + soFmt(+p[sizeKey] || 0, dps) : "");
      svg.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + fill + '" fill-opacity="' + op + '"' + stroke + '><title>' + tip + "</title></circle>");
      var zx = (vx - mx) / sdx, zy = (vy - my) / sdy;
      pts.push({ p: p, cx: cx, cy: cy, score: zx + zy, team: p.name, spot: isSpot });
    });
    // label top performers (by combined z) + the spotlight player
    var labelSet = pts.slice().sort(function (a, b) { return b.score - a.score; }).filter(function (q) { return q.score > 1.4; }).slice(0, 9);
    pts.forEach(function (q) { if (q.spot && labelSet.indexOf(q) < 0) labelSet.push(q); });
    declutter(labelSet, 8.7);
    labelSet.forEach(function (q) {
      if (q.led) svg.push('<line x1="' + q.cx.toFixed(1) + '" y1="' + q.cy.toFixed(1) + '" x2="' + (q.lx - 1).toFixed(1) + '" y2="' + (q.ly - 3).toFixed(1) + '" stroke="#46527a" stroke-width="0.6"/>');
      svg.push('<text x="' + q.lx.toFixed(1) + '" y="' + q.ly.toFixed(1) + '" fill="' + (q.spot ? "#ffe08a" : "#c2cce0") + '" font-size="8.9">' + esc(q.team) + "</text>");
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
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="so-radar" preserveAspectRatio="xMidYMid meet" role="img">'];
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var pts = [];
      for (var i = 0; i < N; i++) { var a = -Math.PI / 2 + i * 2 * Math.PI / N; pts.push((cx + R * f * Math.cos(a)).toFixed(1) + "," + (cy + R * f * Math.sin(a)).toFixed(1)); }
      svg.push('<polygon points="' + pts.join(" ") + '" fill="none" stroke="#1e2740" stroke-width="1"/>');
    });
    var poly = [];
    axes.forEach(function (ax, i) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / N;
      svg.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + R * Math.cos(a)).toFixed(1) + '" y2="' + (cy + R * Math.sin(a)).toFixed(1) + '" stroke="#1e2740" stroke-width="1"/>');
      var pv = +player[ax[0]] || 0;
      var below = pool.filter(function (p) { return (+p[ax[0]] || 0) < pv; }).length;
      var pct = pool.length ? below / pool.length : 0;
      poly.push((cx + R * pct * Math.cos(a)).toFixed(1) + "," + (cy + R * pct * Math.sin(a)).toFixed(1));
      var lx = cx + (R + 16) * Math.cos(a), ly = cy + (R + 16) * Math.sin(a);
      var anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : (Math.cos(a) > 0 ? "start" : "end");
      svg.push('<text x="' + lx.toFixed(1) + '" y="' + (ly - 2).toFixed(1) + '" fill="#aab4cc" font-size="10.5" text-anchor="' + anchor + '">' + esc(ax[1]) + "</text>");
      svg.push('<text x="' + lx.toFixed(1) + '" y="' + (ly + 10).toFixed(1) + '" fill="#e8edf7" font-size="11" font-weight="700" text-anchor="' + anchor + '">' + soFmt(pv, soStatDp(ax[0])) + " (" + Math.round(pct * 100) + "%)</text>");
    });
    svg.push('<polygon points="' + poly.join(" ") + '" fill="rgba(255,210,77,0.18)" stroke="#ffd24d" stroke-width="2"/>');
    poly.forEach(function (pt) { var c = pt.split(","); svg.push('<circle cx="' + c[0] + '" cy="' + c[1] + '" r="3" fill="#ffd24d"/>'); });
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
  renderQuadrant();
  renderXpts();
  renderFinishingBars();
  renderShotQuality();
  renderHomeAway();
  renderLedger();
  renderAgreement();
  renderUnlucky();
  initStandouts();
  renderData();
  renderPower();
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
    [renderOverviewStats, renderGroups, renderThirdPlace, renderBracket, renderMatches].forEach(function (fn) {
      try { fn(); } catch (e) { /* keep going if one view fails */ }
    });
    try {
      document.getElementById("footerNote").textContent =
        "Data generated " + D.generated + " · " + D.counts.played + " matches played · " +
        D.counts.with_xg + " with xG · " + PLAYERS.length + " players · built from the WC2026 pipeline.";
    } catch (e) {}
  }
  var _polling = false;
  function refreshData() {
    if (_polling || document.hidden) return;
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
