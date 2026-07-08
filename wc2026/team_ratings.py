"""Shared FIFA/Coca-Cola Men's World Ranking points — 11 June 2026 edition (the last update
before kick-off; Argentina 1st on 1877). Top ~45 are the published values; a few of the
lowest debutants are approximated.

This is the Python mirror of ``wc2026_dashboard/ratings.js`` (which is the site-wide source of
truth used by app.js Power Rank and match.js Win-probability). Keep the two in sync by hand —
the same manual-sync convention the repo uses for the vendored xg_core copies. Used by
``renderer.py`` to seed the pre-match win probability on the PNG infographic.
"""

FIFA_PTS = {
    "Argentina": 1877, "Spain": 1867, "France": 1862, "England": 1819, "Portugal": 1779, "Brazil": 1760,
    "Netherlands": 1751, "Belgium": 1740, "Morocco": 1736, "Germany": 1724, "Croatia": 1709, "Colombia": 1696,
    "Mexico": 1690, "Senegal": 1684, "Uruguay": 1679, "USA": 1665, "Japan": 1652, "Switzerland": 1648,
    "Iran": 1637, "Turkiye": 1607, "Ecuador": 1587, "Austria": 1578, "South Korea": 1569, "Australia": 1554,
    "Egypt": 1543, "Canada": 1536, "Norway": 1530, "Ivory Coast": 1524, "Algeria": 1512, "Sweden": 1490,
    "Panama": 1475, "Paraguay": 1470, "Scotland": 1466, "Czechia": 1458, "Tunisia": 1452, "DR Congo": 1400,
    "South Africa": 1395, "Qatar": 1394, "Iraq": 1390, "Uzbekistan": 1387, "Jordan": 1383, "Saudi Arabia": 1380,
    "Bosnia and Herzegovina": 1360, "Cape Verde": 1340, "Ghana": 1326, "Curacao": 1270, "Haiti": 1255, "New Zealand": 1250,
}

DEFAULT_PTS = 1400


def fifa_pts(team):
    """FIFA ranking points for ``team`` (case-insensitive), or the 1400 default for unknowns."""
    if team in FIFA_PTS:
        return FIFA_PTS[team]
    low = str(team or "").strip().lower()
    for name, pts in FIFA_PTS.items():
        if name.lower() == low:
            return pts
    return DEFAULT_PTS


def win_prob(ra, rb):
    """Elo-style logistic: a 100-pt edge ~64%, 200 ~74%. Mirrors app.js winProb()."""
    return 1.0 / (1.0 + 10 ** ((rb - ra) / 400.0))
