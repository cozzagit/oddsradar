from datetime import datetime
from typing import Any

from pydantic import BaseModel


class RawSelectionOdd(BaseModel):
    selection_name: str  # raw string from source, to be normalized downstream
    odd: float
    is_lay: bool = False


class RawMarketSnapshot(BaseModel):
    market_name: str
    selections: list[RawSelectionOdd]


class RawEventSnapshot(BaseModel):
    source_book_slug: str
    source_event_id: str | None
    sport_slug: str
    competition_name: str
    home_team_raw: str
    away_team_raw: str
    kickoff_utc: datetime
    is_in_play: bool = False
    markets: list[RawMarketSnapshot]
    taken_at: datetime
    raw: dict[str, Any] | None = None
    # Live state (opzionali, per detector filter)
    home_goals: int | None = None
    away_goals: int | None = None
    elapsed_min: int | None = None
    red_cards_home: int | None = None
    red_cards_away: int | None = None
