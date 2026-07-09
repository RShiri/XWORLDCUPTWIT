/* ============================================================================
   pro/shell.js — shared chrome for the "Stats Lab Pro" skin.

   MUST load BEFORE app.js. It does three jobs, in order:
     1. Builds the premium top-nav (5 real <a> links) + skin switcher into #proHeader,
        and the contextual sub-nav pills from the page's .pro-section[data-sub] blocks.
     2. Injects a hidden #pro-sink containing a stub <div> for every host id that
        app.js's (unguarded) boot writes into but that this page doesn't feature —
        so app.js renders cleanly on every page while we reuse it verbatim.
     3. After load, fires Player Lab's lazy build when that section is featured.

   The page declares its active section via <body data-page="matches"> and its
   sub-tabs via <section class="pro-section" data-sub="fixtures" data-sub-label="Fixtures">.
   ============================================================================ */
(function () {
  "use strict";

  /* ---- top-level sections (order = nav order) ---- */
  var SECTIONS = [
    { key: "matches", href: "pro-matches.html", ic: "⚽", label: "Matches" },
    { key: "leagues", href: "pro-leagues.html", ic: "🏆", label: "Leagues" },
    { key: "players", href: "pro-players.html", ic: "👤", label: "Player Stats" },
    { key: "teams",   href: "pro-teams.html",   ic: "📊", label: "Team Analytics" },
    { key: "predict", href: "pro-predict.html", ic: "🔮", label: "Prediction Lab" }
  ];

  /* ---- every host id app.js's boot touches (guarded ones excluded: plMain/plCompare) ---- */
  var HOST_IDS = [
    "overviewStats", "groupGrid", "thirdTable", "bracket", "bracketHead",
    "matchList", "teamTable", "mSearch", "mStatus", "mListView", "mTeamView", "mModeList", "mModeTeam",
    "playersTable", "playerBoards", "playerLeaders", "playerSearch", "playerTeam", "playerPresets",
    "xgStats", "scatter", "corrBox", "corrInsight", "xgDist", "quadrant", "xpts", "xptsInsight",
    "finishingBars", "shotquality", "homeAway", "ledger", "agreement", "unlucky",
    "soStat", "soPos", "soMins", "soPlayer", "soPlayerList", "soStats", "soChart",
    "soChartTitle", "soChartHint", "soChartTip", "soSpotlight", "soStandouts", "soPresets",
    "soScX", "soScY", "soScSize", "soScPos", "soScMins", "soScatter", "soScatterTip", "soScInsight", "soRadar",
    "tlTeam", "tlTeamB", "tlTeamC", "tlFilter", "tlSit", "tlMode", "tlStats", "tlMaps",
    "tlMapTitle", "tlMapTip", "tlRadar", "tlLegend", "tlStyleTitle", "tlStyleCard",
    "bkStats", "bkBr", "bkWin", "bkStage", "bkDom", "bkMatch", "bkRiver", "bkRiverTitle",
    "bkRiverTip", "bkStrip", "bkStripTitle", "bkPace", "bkDominance",
    "dataDownloads", "sqliteLink", "rawNote",
    "predStats", "powerTable", "powerKOCard", "powerKOTable", "champCard", "predChampion",
    "predRounds", "powerKOTable",
    "footerNote", "tooltip"
  ];
  /* segmented-control groups whose .seg-btn children app.js iterates — stub with a child
     so nothing that expects at least the container breaks (empty NodeList is already safe). */

  function byId(id) { return document.getElementById(id); }

  /* ---- 1. build header ---- */
  function buildHeader() {
    var host = byId("proHeader");
    if (!host) return;
    var active = document.body.getAttribute("data-page") || "";

    var brand =
      '<a class="pro-brand" href="pro-matches.html">' +
        '<span class="mark">⚡</span>' +
        '<span class="txt"><span class="t">Stats Lab <b style="color:var(--accent)">Pro</b></span>' +
        '<span class="s">World Cup 2026</span></span>' +
      "</a>";

    var toggle = '<button class="pro-navtoggle" id="proNavToggle" aria-label="Menu">☰</button>';

    var nav = '<nav class="pro-topnav" id="proTopnav">';
    SECTIONS.forEach(function (s) {
      nav += '<a href="' + s.href + '"' + (s.key === active ? ' class="active"' : "") + ">" +
        '<span class="ic">' + s.ic + "</span>" + s.label + "</a>";
    });
    nav += "</nav>";

    var skins =
      '<div class="pro-skins">' +
        '<a href="index.html" title="Classic dashboard">Classic</a>' +
        '<a href="index_futuristic.html" title="Futuristic concept skin">✦ FX</a>' +
      "</div>";

    host.innerHTML = brand + toggle + skins + nav;

    var tgl = byId("proNavToggle"), tn = byId("proTopnav");
    if (tgl && tn) tgl.addEventListener("click", function () { tn.classList.toggle("open"); });
  }

  /* ---- 2. sub-nav pills + section switching ---- */
  function buildSubnav() {
    var host = byId("proSubnav");
    var secs = [].slice.call(document.querySelectorAll(".pro-section[data-sub]"));
    if (!host) return;
    if (secs.length <= 1) {
      var wrap = document.querySelector(".pro-subnav-wrap");
      if (wrap) wrap.style.display = "none";
      if (secs.length === 1) secs[0].classList.add("active");
      return;
    }
    var want = new URLSearchParams(location.search).get("tab");
    var initial = 0;
    secs.forEach(function (s, i) { if (s.getAttribute("data-sub") === want) initial = i; });

    host.innerHTML = "";
    secs.forEach(function (s, i) {
      var b = document.createElement("button");
      b.textContent = s.getAttribute("data-sub-label") || s.getAttribute("data-sub");
      b.setAttribute("data-sub", s.getAttribute("data-sub"));
      if (i === initial) { b.classList.add("active"); s.classList.add("active"); }
      b.addEventListener("click", function () {
        host.querySelectorAll("button").forEach(function (x) { x.classList.remove("active"); });
        secs.forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active"); s.classList.add("active");
        var u = new URL(location.href); u.searchParams.set("tab", s.getAttribute("data-sub"));
        history.replaceState(null, "", u);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      host.appendChild(b);
    });
  }

  /* ---- 3. inject hidden sink so app.js's unguarded boot never hits a missing host ---- */
  function buildSink() {
    var sink = document.createElement("div");
    sink.id = "pro-sink";
    sink.setAttribute("aria-hidden", "true");
    sink.style.cssText = "display:none !important";
    var featuresPlayerLab = !!byId("plBadges");

    HOST_IDS.forEach(function (id) {
      if (byId(id)) return;               // page already provides a real one
      var d = document.createElement("div");
      d.id = id;
      d.value = "";                        // harmless string default for .value reads
      if (id === "tooltip") d.className = "tooltip";
      sink.appendChild(d);
    });

    /* If Player Lab is featured, app.js only builds it on a nav.tabs playerlab click,
       so give it a hidden button to attach to; we click it on load (see step 4). */
    if (featuresPlayerLab) {
      var nav = document.createElement("nav");
      nav.className = "tabs";
      var btn = document.createElement("button");
      btn.setAttribute("data-view", "playerlab");
      btn.id = "proPlTrigger";
      nav.appendChild(btn);
      sink.appendChild(nav);
    }
    document.body.appendChild(sink);
  }

  /* ---- 4. fire Player Lab lazy build after app.js has wired its listener ----
     Clicking the trigger also runs app.js's generic tab handler, which force-adds
     .active to #view-playerlab. We restore the intended sub-tab state right after. */
  function restoreSubState() {
    var active = document.querySelector(".pro-subnav button.active");
    var want = active ? active.getAttribute("data-sub") : null;
    var secs = [].slice.call(document.querySelectorAll(".pro-section[data-sub]"));
    if (!secs.length) return;
    secs.forEach(function (s) { s.classList.remove("active"); });
    var target = want && document.querySelector('.pro-section[data-sub="' + want + '"]');
    (target || secs[0]).classList.add("active");
  }
  function armPlayerLab() {
    if (!byId("plBadges")) return;
    window.addEventListener("load", function () {
      var btn = byId("proPlTrigger");
      if (btn) setTimeout(function () { btn.click(); restoreSubState(); }, 0);
    });
  }

  buildHeader();
  buildSubnav();
  buildSink();
  armPlayerLab();
})();
