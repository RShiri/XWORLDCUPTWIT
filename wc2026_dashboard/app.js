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
        if (m.has_events) links.push('<a class="open-match" href="match.html?id=' +
          encodeURIComponent(m.id) + '">Match centre ↗</a>');
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
        row.innerHTML =
          '<div class="db-match-head">' +
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

  /* Attack vs defence quadrant: xGF/game (x) vs xGA/game (y, inverted) */
  function renderQuadrant() {
    var rows = AGG.filter(function (a) { return a.n > 0; });
    if (!rows.length) return;
    var W = 960, H = 460, pad = 50;
    var fwd = rows.map(function (a) { return a.xgf / a.n; });
    var ag = rows.map(function (a) { return a.xga / a.n; });
    var maxF = Math.max.apply(null, fwd.concat([2])) * 1.1;
    var maxA = Math.max.apply(null, ag.concat([2])) * 1.1;
    var avgF = fwd.reduce(function (s, v) { return s + v; }, 0) / fwd.length;
    var avgA = ag.reduce(function (s, v) { return s + v; }, 0) / ag.length;
    function sx(v) { return pad + (v / maxF) * (W - pad - 16); }
    function sy(v) { return H - pad - ((maxA - v) / maxA) * (H - pad - 16); } // higher xGA = lower
    var svg = ['<svg viewBox="0 0 ' + W + " " + H + '" width="100%">'];
    // average gridlines (quadrant split)
    svg.push('<line x1="' + sx(avgF) + '" y1="' + sy(0) + '" x2="' + sx(avgF) + '" y2="' + sy(maxA) + '" stroke="#33405f" stroke-dasharray="4 4"/>');
    svg.push('<line x1="' + sx(0) + '" y1="' + sy(avgA) + '" x2="' + sx(maxF) + '" y2="' + sy(avgA) + '" stroke="#33405f" stroke-dasharray="4 4"/>');
    svg.push('<text x="' + (W - 8) + '" y="' + (sy(maxA) + 12) + '" fill="#3ddc97" font-size="10" text-anchor="end">strong both ends ↗</text>');
    svg.push('<text x="' + (W / 2) + '" y="' + (H - 8) + '" fill="#e8edf7" font-size="12" text-anchor="middle">xG created per game →</text>');
    svg.push('<text x="14" y="' + (H / 2) + '" fill="#e8edf7" font-size="12" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')">← xG conceded per game (better up)</text>');
    rows.forEach(function (a) {
      var cx = sx(a.xgf / a.n), cy = sy(a.xga / a.n);
      svg.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="4.5" fill="#4ea1ff" fill-opacity="0.85" stroke="#0b0f1a" stroke-width="0.8"/>');
      svg.push('<text x="' + (cx + 6).toFixed(1) + '" y="' + (cy + 3).toFixed(1) + '" fill="#93a0bd" font-size="8.5">' + esc(a.team) + "</text>");
    });
    svg.push("</svg>");
    document.getElementById("quadrant").innerHTML = svg.join("");
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
    var rows = teamPoints();
    if (!rows.length) return;
    var W = 960, H = 440, pad = 50;
    var mx = Math.max.apply(null, rows.map(function (r) { return Math.max(r.pts, r.xpts); }).concat([3])) * 1.1;
    function sx(v) { return pad + (v / mx) * (W - pad - 14); }
    function sy(v) { return H - pad - (v / mx) * (H - pad - 14); }
    var svg = ['<svg viewBox="0 0 ' + W + " " + H + '" width="100%">'];
    svg.push('<line x1="' + sx(0) + '" y1="' + sy(0) + '" x2="' + sx(mx) + '" y2="' + sy(mx) + '" stroke="#93a0bd" stroke-dasharray="5 4" stroke-width="1.2"/>');
    svg.push('<text x="' + (W / 2) + '" y="' + (H - 6) + '" fill="#e8edf7" font-size="12" text-anchor="middle">Expected points (from xG) →</text>');
    svg.push('<text x="14" y="' + (H / 2) + '" fill="#e8edf7" font-size="12" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')">Actual points</text>');
    var over = 0;
    rows.forEach(function (r) {
      var cx = sx(r.xpts), cy = sy(r.pts);
      var d = r.pts - r.xpts;
      if (d > 0.3) over++;
      var col = d > 0.5 ? "#3ddc97" : d < -0.5 ? "#ff6b81" : "#4ea1ff";
      svg.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="4.5" fill="' + col + '" fill-opacity="0.85" stroke="#0b0f1a" stroke-width="0.8"/>');
      svg.push('<text x="' + (cx + 6).toFixed(1) + '" y="' + (cy + 3).toFixed(1) + '" fill="#93a0bd" font-size="8.5">' + esc(r.team) + "</text>");
    });
    svg.push("</svg>");
    document.getElementById("xpts").innerHTML = svg.join("");
    var rr = rows.slice().sort(function (a, b) { return (b.pts - b.xpts) - (a.pts - a.xpts); });
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
    var boards = [
      card("Top scorers", "Goals scored.", rows(desc("g"), function (p) { return p.g; }, function (p) { return p.team; })),
      card("Most assists", "Assists provided.", rows(desc("a"), function (p) { return p.a; }, function (p) { return p.team; })),
      card("Goal involvements", "Goals + assists combined.", rows(desc("ga"), function (p) { return p.ga; }, function (p) { return p.g + "G " + p.a + "A"; })),
      card("Highest average rating", "Match rating, min. 2 games.", rows(rated, function (p) { return p.rating.toFixed(2); }, function (p) { return p.mp + " gms"; })),
      card("Most clinical finishers", "Goals above shot xG (min. 1.0 xG faced).",
        rows(fin.slice().sort(function (a, b) { return b.xg_diff - a.xg_diff; }),
          function (p) { return (p.xg_diff > 0 ? "+" : "") + p.xg_diff.toFixed(2); }, xgSub, "pos")),
      card("Wasteful in front of goal", "Goals below shot xG (min. 1.0 xG faced).",
        rows(fin.slice().sort(function (a, b) { return a.xg_diff - b.xg_diff; }),
          function (p) { return p.xg_diff.toFixed(2); }, xgSub, "neg")),
      card("Top chance creators", "Key passes (a pass that led to a shot).", rows(desc("keyPasses"), function (p) { return p.keyPasses; }, function (p) { return p.team; })),
      card("Most shots on target", "Shots that hit the target.", rows(desc("sot"), function (p) { return p.sot; }, function (p) { return p.shots + " shots"; })),
      card("Most shots taken", "Total attempts.", rows(desc("shots"), function (p) { return p.shots; }, function (p) { return p.team; })),
      card("Busiest passers", "Total passes completed.", rows(desc("passes"), function (p) { return p.passes; }, function (p) { return p.pass_pct + "%"; })),
      card("Top tacklers", "Tackles made.", rows(desc("tackles"), function (p) { return p.tackles; }, function (p) { return p.team; })),
      card("Most minutes played", "Time on the pitch.", rows(desc("mins"), function (p) { return p.mins + "'"; }, function (p) { return p.mp + " gms"; })),
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
    var rows = teamShotAgg();
    if (!rows.length) return;
    var W = 960, H = 440, pad = 50;
    rows.forEach(function (r) { r.spg = r.shots / r.n; r.xgPerShot = r.xg / r.shots; });
    var maxX = Math.max.apply(null, rows.map(function (r) { return r.spg; })) * 1.12;
    var maxY = Math.max.apply(null, rows.map(function (r) { return r.xgPerShot; })) * 1.12;
    function sx(v) { return pad + (v / maxX) * (W - pad - 16); }
    function sy(v) { return H - pad - (v / maxY) * (H - pad - 16); }
    var svg = ['<svg viewBox="0 0 ' + W + " " + H + '" width="100%">'];
    var avgY = rows.reduce(function (s, r) { return s + r.xgPerShot; }, 0) / rows.length;
    svg.push('<line x1="' + sx(0) + '" y1="' + sy(avgY) + '" x2="' + sx(maxX) + '" y2="' + sy(avgY) + '" stroke="#33405f" stroke-dasharray="4 4"/>');
    svg.push('<text x="' + (W / 2) + '" y="' + (H - 6) + '" fill="#e8edf7" font-size="12" text-anchor="middle">Shots per game →</text>');
    svg.push('<text x="14" y="' + (H / 2) + '" fill="#e8edf7" font-size="12" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')">xG per shot (chance quality)</text>');
    rows.forEach(function (r) {
      var cx = sx(r.spg), cy = sy(r.xgPerShot);
      svg.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="4.5" fill="#ffb454" fill-opacity="0.85" stroke="#0b0f1a" stroke-width="0.8"/>');
      svg.push('<text x="' + (cx + 6).toFixed(1) + '" y="' + (cy + 3).toFixed(1) + '" fill="#93a0bd" font-size="8.5">' + esc(r.team) + "</text>");
    });
    svg.push("</svg>");
    document.getElementById("shotquality").innerHTML = svg.join("");
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

  /* Biggest xG upsets: result defied xG by the most */
  function renderUpsets() {
    var rows = D.matches.filter(function (m) { return m.played && m.xg_home != null; }).map(function (m) {
      var resWinner = m.hs > m.as ? "H" : m.hs < m.as ? "A" : "D";
      // xG deficit of the team that did NOT lose
      var deficit = 0, who = "";
      if (resWinner === "H") { deficit = m.xg_away - m.xg_home; who = m.home; }
      else if (resWinner === "A") { deficit = m.xg_home - m.xg_away; who = m.away; }
      else { deficit = Math.abs(m.xg_home - m.xg_away); who = "draw"; }
      return { m: m, deficit: deficit, who: who, res: resWinner };
    }).filter(function (x) { return x.deficit > 0; })
      .sort(function (a, b) { return b.deficit - a.deficit; }).slice(0, 10);
    if (!rows.length) { document.getElementById("upsets").innerHTML = '<p class="hint">No upsets yet.</p>'; return; }
    var html = '<table class="rank"><thead><tr><th class="team">Match</th><th>Result</th><th>xG</th>' +
      '<th class="team">Out-created winner</th><th>xG deficit</th></tr></thead><tbody>';
    html += rows.map(function (x) {
      var m = x.m;
      return "<tr><td class='team'>" + esc(m.home) + " v " + esc(m.away) + "</td>" +
        "<td>" + m.hs + "–" + m.as + "</td><td>" + m.xg_home.toFixed(2) + "–" + m.xg_away.toFixed(2) + "</td>" +
        "<td class='team'>" + (x.who === "draw" ? "<span style='color:var(--muted)'>draw</span>" : esc(x.who)) + "</td>" +
        "<td><span class='delta neg'>−" + x.deficit.toFixed(2) + "</span></td></tr>";
    }).join("");
    html += "</tbody></table>";
    document.getElementById("upsets").innerHTML = html;
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

  /* ---------------- init ---------------- */
  renderOverviewStats();
  renderGroups();
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
  renderUpsets();
  renderData();
  document.getElementById("footerNote").textContent =
    "Data generated " + D.generated + " · " + D.counts.played + " matches played · " +
    D.counts.with_xg + " with xG · " + PLAYERS.length + " players · built from the WC2026 pipeline.";
})();
