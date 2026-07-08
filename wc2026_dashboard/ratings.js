/* Shared FIFA/Coca-Cola Men's World Ranking points — 11 June 2026 edition (the last update
   before kick-off; Argentina 1st on 1877). Top ~45 are the published values; a few of the
   lowest debutants are approximated.

   SOURCE OF TRUTH for team strength across the site. Loaded by index.html (before app.js,
   powers Power Rank) and match.html (before match.js, seeds the Win-probability chart).
   The Python renderer keeps its own copy in wc2026/team_ratings.py — keep the two in sync
   (same manual-sync convention the repo uses for xg_core). */
window.FIFA_PTS = {
  "Argentina": 1877, "Spain": 1867, "France": 1862, "England": 1819, "Portugal": 1779, "Brazil": 1760,
  "Netherlands": 1751, "Belgium": 1740, "Morocco": 1736, "Germany": 1724, "Croatia": 1709, "Colombia": 1696,
  "Mexico": 1690, "Senegal": 1684, "Uruguay": 1679, "USA": 1665, "Japan": 1652, "Switzerland": 1648,
  "Iran": 1637, "Turkiye": 1607, "Ecuador": 1587, "Austria": 1578, "South Korea": 1569, "Australia": 1554,
  "Egypt": 1543, "Canada": 1536, "Norway": 1530, "Ivory Coast": 1524, "Algeria": 1512, "Sweden": 1490,
  "Panama": 1475, "Paraguay": 1470, "Scotland": 1466, "Czechia": 1458, "Tunisia": 1452, "DR Congo": 1400,
  "South Africa": 1395, "Qatar": 1394, "Iraq": 1390, "Uzbekistan": 1387, "Jordan": 1383, "Saudi Arabia": 1380,
  "Bosnia and Herzegovina": 1360, "Cape Verde": 1340, "Ghana": 1326, "Curacao": 1270, "Haiti": 1255, "New Zealand": 1250
};
