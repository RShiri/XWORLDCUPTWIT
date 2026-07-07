# -*- coding: utf-8 -*-
"""xg_core_v3 — self-contained deployable runtime: 23-feature xG + pass-level xA.

Everything needed is in THIS folder (stdlib-only; lightgbm optional). No external
package dependencies and no absolute paths — commit the folder to the repo and it
works on GitHub/CI as-is.

    from xg_core_v3 import XGScorer, XAScorer
    xg = dict(XGScorer().iter_match_xg(match_data, league=LEAGUE))    # eventId -> xG
    xa = XAScorer().player_xa_from_events(match_data, league=LEAGUE)  # playerId -> xA
    #   LEAGUE = "LaLiga" | "EPL" | "WorldCup"
"""
from .features import (FEATURE_NAMES, feature_dict, shot_feature_dict,  # noqa: F401
                       iter_shots)
from .score import XGScorer  # noqa: F401
from .xa_features import (PASS_FEATURE_NAMES, pass_feature_dict, quals_of,  # noqa: F401
                          iter_passes)
from .xa_score import XAScorer  # noqa: F401
