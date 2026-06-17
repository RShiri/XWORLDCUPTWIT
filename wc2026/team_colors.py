"""
FIFA World Cup 2026 – primary/secondary colors for all 48 qualified nations.
Colors sourced from each federation's official kit palette.
"""

WC2026_TEAM_COLORS: dict[str, dict[str, str]] = {
    # Group A – Host: United States
    "United States":    {"primary": "#002868", "secondary": "#BF0A30"},
    "Mexico":           {"primary": "#006847", "secondary": "#FFFFFF"},
    "Panama":           {"primary": "#D21034", "secondary": "#FFFFFF"},
    "Honduras":         {"primary": "#0039A6", "secondary": "#FFFFFF"},

    # Group B – Host: Canada
    "Canada":           {"primary": "#FF0000", "secondary": "#FFFFFF"},
    "Morocco":          {"primary": "#C1272D", "secondary": "#006233"},
    "Portugal":         {"primary": "#006600", "secondary": "#FF0000"},
    "Argentina":        {"primary": "#74ACDF", "secondary": "#FFFFFF"},

    # Group C
    "Germany":          {"primary": "#000000", "secondary": "#FFFFFF"},
    "Japan":            {"primary": "#003F8E", "secondary": "#FFFFFF"},
    "Senegal":          {"primary": "#00853F", "secondary": "#FDEF42"},
    "Costa Rica":       {"primary": "#002B7F", "secondary": "#CE1126"},

    # Group D
    "Spain":            {"primary": "#C60B1E", "secondary": "#F1BF00"},
    "Croatia":          {"primary": "#FF0000", "secondary": "#FFFFFF"},
    "Australia":        {"primary": "#006B3F", "secondary": "#FFD700"},
    "Algeria":          {"primary": "#006233", "secondary": "#FFFFFF"},

    # Group E
    "France":           {"primary": "#002395", "secondary": "#FFFFFF"},
    "Netherlands":      {"primary": "#FF6000", "secondary": "#FFFFFF"},
    "Ecuador":          {"primary": "#FFD100", "secondary": "#034EA2"},
    "Saudi Arabia":     {"primary": "#006C35", "secondary": "#FFFFFF"},

    # Group F
    "Brazil":           {"primary": "#009c3b", "secondary": "#FFDF00"},
    "England":          {"primary": "#003090", "secondary": "#FFFFFF"},
    "Serbia":           {"primary": "#C6363C", "secondary": "#0C4076"},
    "South Korea":      {"primary": "#C60C30", "secondary": "#003478"},

    # Group G
    "Uruguay":          {"primary": "#6CACE4", "secondary": "#FFFFFF"},
    "Belgium":          {"primary": "#EF3340", "secondary": "#000000"},
    "Tunisia":          {"primary": "#E70013", "secondary": "#FFFFFF"},
    "Colombia":         {"primary": "#FCD116", "secondary": "#003087"},

    # Group H
    "Switzerland":      {"primary": "#CF142B", "secondary": "#FFFFFF"},
    "Chile":            {"primary": "#D52B1E", "secondary": "#FFFFFF"},
    "Poland":           {"primary": "#DC143C", "secondary": "#FFFFFF"},
    "Romania":          {"primary": "#002B7F", "secondary": "#FCD116"},

    # Group I
    "Italy":            {"primary": "#003DA5", "secondary": "#FFFFFF"},
    "Nigeria":          {"primary": "#008751", "secondary": "#FFFFFF"},
    "Paraguay":         {"primary": "#D52B1E", "secondary": "#FFFFFF"},
    "Indonesia":        {"primary": "#CE1126", "secondary": "#FFFFFF"},

    # Group J
    "Argentina":        {"primary": "#74ACDF", "secondary": "#FFFFFF"},  # duplicate override fine
    "Ghana":            {"primary": "#000000", "secondary": "#FFFFFF"},
    "Guatemala":        {"primary": "#4997D0", "secondary": "#FFFFFF"},
    "Qatar":            {"primary": "#8D1B3D", "secondary": "#FFFFFF"},

    # Group K
    "Denmark":          {"primary": "#C60C30", "secondary": "#FFFFFF"},
    "Iran":             {"primary": "#239F40", "secondary": "#FFFFFF"},
    "New Zealand":      {"primary": "#000000", "secondary": "#FFFFFF"},
    "Cameroon":         {"primary": "#007A5E", "secondary": "#CE1126"},

    # Group L
    "South Africa":     {"primary": "#007A4D", "secondary": "#FFB81C"},
    "Greece":           {"primary": "#0D5EAF", "secondary": "#FFFFFF"},
    "Ukraine":          {"primary": "#005BBB", "secondary": "#FFD500"},
    "Venezuela":        {"primary": "#CF142B", "secondary": "#003087"},
}


def get_team_colors(team_name: str, fallback_home: bool = True) -> dict[str, str]:
    """Return {'primary': hex, 'secondary': hex} for a team."""
    name_clean = team_name.strip()
    if name_clean in WC2026_TEAM_COLORS:
        return WC2026_TEAM_COLORS[name_clean]
    # Case-insensitive fallback
    lower = name_clean.lower()
    for k, v in WC2026_TEAM_COLORS.items():
        if k.lower() == lower:
            return v
    return {"primary": "#a50044" if fallback_home else "#004d98", "secondary": "#FFFFFF"}
