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

  function renderMatches() {
    var q = (mSearch.value || "").toLowerCase().trim();
    var mode = mStatus.value;
    var list = document.getElementById("matchList");
    list.innerHTML = "";

    var matches = D.matches.filter(function (m) {
      if (mode === "played" && !m.played) return false;
      if (mode === "upcoming" && m.played) return false;
      if (mode === "xg" && m.xg_home == null) return false;
      if (q && m.home.toLowerCase().indexOf(q) < 0 && m.away.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    if (!matches.length) { list.appendChild(el("p", "footer-note", "No matches match your filter.")); return; }

    var byDay = {};
    matches.forEach(function (m) { (byDay[m.date] = byDay[m.date] || []).push(m); });

    Object.keys(byDay).sort().forEach(function (day) {
      var dayWrap = el("div", "match-day");
      dayWrap.appendChild(el("div", "day-label", fmtDate(day) || day));
      byDay[day].forEach(function (m) {
        var expandable = m.played && m.has_stats;
        var toCentre = m.has_events;            // has event data → open the full Match Centre on click
        var clickable = toCentre || expandable;
        var hWin = m.played && m.hs > m.as, aWin = m.played && m.as > m.hs;
        var score = m.played
          ? '<div class="score">' + m.hs + " – " + m.as + "</div>"
          : '<div class="score upcoming">vs</div>';
        var links = [];
        // The whole played-match row opens the Match Centre now, so no separate link.
        if (m.png) links.push('<a class="open-match png" href="' + esc(m.png) +
          '" target="_blank" rel="noopener">PNG 🖼️</a>');
        var xgline = "";
        if (m.xg_home != null) xgline = 'xG <b>' + m.xg_home.toFixed(2) + "</b> — <b>" +
          m.xg_away.toFixed(2) + "</b>" + (m.xg_estimated ? ' <span class="est-tag">est</span>' : "");
        var meta = (xgline || links.length)
          ? '<div class="xgline">' + xgline + (xgline && links.length ? " &nbsp;·&nbsp; " : "") + links.join(" ") + "</div>"
          : "";

        var row = el("div", "db-match" + (clickable ? "" : " noexp"));
        row.dataset.id = m.id;
        var headTitle = toCentre ? ' title="Open Match Centre"'
          : m.played ? "" : ' title="Not played yet — no data to show"';
        row.innerHTML =
          '<div class="db-match-head"' + headTitle + '>' +
            '<div class="side home"><span class="nm" style="' + (hWin ? "color:var(--good)" : "") + '">' +
              esc(m.home) + "</span>" + logoImg(m.home) + "</div>" +
            score +
            '<div class="side away">' + logoImg(m.away) + '<span class="nm" style="' +
              (aWin ? "color:var(--good)" : "") + '">' + esc(m.away) + "</span></div>" +
            (toCentre ? '<div class="db-date">' + (fmtDate(m.date) || m.date) + ' <span class="chev nav">↗</span></div>'
              : expandable ? '<div class="db-date">' + (fmtDate(m.date) || m.date) + ' <span class="chev">▾</span></div>' : "") +
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

  /* ================= KNOCKOUT BRACKET (Tables tab) =================
     The bracket shape is read straight from the schedule's knockout match ids. Those ids
     carry slot/Winner/Loser codes (e.g. "2A_vs_2B", "Winner_EF_1_vs_Winner_EF_2") that
     survive even after a tie is played, so the tree always links up. Round → round links:
       R32 → R16 is exact (an R16 side like "2A2B" is the winner of the "2A_vs_2B" tie);
       R16 → QF → SF → Final follow the EF/QF/SF index references in the ids, with R16
       numbered 1..8 in schedule (date) order — the standard FIFA bracket numbering. */
  function renderBracket() {
    var host = document.getElementById("bracket");
    if (!host || !D.matches) return;
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
    if (!rounds.F.length || rounds.R32.length < 2) {
      host.innerHTML = '<p class="hint">The knockout bracket appears once the fixtures are loaded.</p>';
      return;
    }
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
      if ((m = raw.match(/^3([A-L]{2,})$/))) return { text: "3rd: " + m[1].split("").join("/") };
      if (/^Winner /.test(raw)) return { text: raw.replace(/EF (\d)/, "R16 #$1").replace(/QF (\d)/, "QF #$1").replace(/SF (\d)/, "SF #$1") };
      if (/^Loser /.test(raw)) return { text: raw.replace(/SF (\d)/, "SF #$1") };
      return { text: raw };
    }
    function side(m, which) {
      var nm = which === "h" ? m.home : m.away;
      var sc = which === "h" ? m.hs : m.as, os = which === "h" ? m.as : m.hs;
      if (m.played && sc != null) {
        var cls = sc > os ? "win" : sc < os ? "lose" : "draw";
        return '<div class="bk-side ' + cls + '">' + logoImg(nm, "bk-logo") +
          '<span class="nm">' + esc(nm) + '</span><span class="sc">' + sc + "</span></div>";
      }
      var r = resolveSlot(nm);
      if (r.team) return '<div class="bk-side proj">' + logoImg(r.team, "bk-logo") +
        '<span class="nm">' + esc(r.team) + '</span><span class="tag">' + esc(r.code) + "</span></div>";
      return '<div class="bk-side tbd"><span class="nm">' + esc(r.text) + "</span></div>";
    }
    function box(m) {
      if (!m) return '<div class="bk-match bk-tbd"><div class="bk-side tbd"><span class="nm">TBD</span></div></div>';
      return '<div class="bk-match' + (m.played ? " played" : "") + '">' +
        '<div class="bk-dt">' + esc(fmtDate(m.date)) + "</div>" + side(m, "h") + side(m, "a") + "</div>";
    }
    // Left half: deeper rounds on the left, flowing right toward the centre.
    function node(m) {
      var kids = m && m._kids && m._kids.length === 2
        ? '<div class="bk-kids">' + node(m._kids[0]) + node(m._kids[1]) + "</div><div class=\"bk-edge\"></div>"
        : "";
      return '<div class="bk-node">' + kids + box(m) + "</div>";
    }
    // Right half: mirrored — the match sits on the left (toward centre), feeders on the right.
    function nodeR(m) {
      var kids = m && m._kids && m._kids.length === 2
        ? "<div class=\"bk-edge\"></div><div class=\"bk-kids\">" + nodeR(m._kids[0]) + nodeR(m._kids[1]) + "</div>"
        : "";
      return '<div class="bk-node">' + box(m) + kids + "</div>";
    }
    var sf = fin._kids || [];
    host.innerHTML = '<div class="bracket-tree two-sided">' +
        '<div class="bk-half left">' + node(sf[0]) + "</div>" +
        '<div class="bk-center"><div class="bk-edge"></div>' + box(fin) + '<div class="bk-edge"></div></div>' +
        '<div class="bk-half right">' + nodeR(sf[1]) + "</div>" +
      "</div>" +
      (tp ? '<div class="bk-third"><div class="bk-third-h">Third-place play-off</div>' + box(tp) + "</div>" : "");
    // Symmetric header. Cell widths are kept in sync with the layout via the CSS vars.
    var head = document.getElementById("bracketHead");
    if (head) {
      var MW = "var(--bk-mw)", MID = "calc(var(--bk-mw) + var(--bk-edge))", FW = "calc(var(--bk-mw) + var(--bk-edge) * 2)";
      var cells = [["Round of 32", MW], ["Round of 16", MID], ["Quarter-finals", MID], ["Semi-finals", MID],
        ["Final", FW], ["Semi-finals", MID], ["Quarter-finals", MID], ["Round of 16", MID], ["Round of 32", MW]];
      head.innerHTML = cells.map(function (c) { return '<span class="bk-hcell" style="width:' + c[1] + '">' + c[0] + "</span>"; }).join("");
    }
  }

  /* ---------------- init ---------------- */
  renderOverviewStats();
  renderGroups();
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
  renderData();
  document.getElementById("footerNote").textContent =
    "Data generated " + D.generated + " · " + D.counts.played + " matches played · " +
    D.counts.with_xg + " with xG · " + PLAYERS.length + " players · built from the WC2026 pipeline.";
})();
