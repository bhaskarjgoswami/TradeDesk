from pydantic import BaseModel, field_validator
from typing import Optional, Literal

MISTAKES = [
    "FOMO entry", "No setup", "Chased price", "Oversized", "Moved stop",
    "No stop", "Early exit", "Held a loser", "Revenge trade", "Overtraded",
]
EMOTIONS = ["Calm", "Confident", "Anxious", "Fearful", "Greedy", "Impatient", "Frustrated", "Bored"]


class Review(BaseModel):
    """Post-trade review. Unknown keys are dropped by pydantic."""
    followed_plan: Optional[bool] = None
    quality: Optional[Literal["A+", "A", "B", "C", "F"]] = None
    emotion_in: Optional[str] = None
    emotion_out: Optional[str] = None
    mistakes: list[str] = []

    @field_validator("emotion_in", "emotion_out")
    @classmethod
    def _emotion(cls, v):
        if v not in (None, "") and v not in EMOTIONS:
            raise ValueError("unknown emotion")
        return v or None

    @field_validator("mistakes")
    @classmethod
    def _mistakes(cls, v):
        bad = [m for m in v if m not in MISTAKES]
        if bad:
            raise ValueError(f"unknown mistake: {bad[0]}")
        return list(dict.fromkeys(v))


class TradeIn(BaseModel):
    date: Optional[str] = None
    symbol: Optional[str] = None
    direction: Optional[str] = None
    setup: Optional[str] = None
    tf_bias: Optional[str] = None
    logic: Optional[str] = None
    entry: Optional[float] = None
    stop: Optional[float] = None
    exit: Optional[float] = None
    qty: Optional[float] = None
    risk: Optional[float] = None
    pnl: Optional[float] = None
    r_multiple: Optional[float] = None
    outcome: Optional[str] = None
    rating: Optional[int] = None
    tags: Optional[str] = None
    notes: Optional[str] = None
    images: Optional[str] = None
    checklist: Optional[str] = None
    fee: Optional[float] = None
    ext_id: Optional[str] = None  # exchange round-trip id, for import dedupe
    review: Optional[Review] = None
    playbook_id: Optional[int] = None


class DayLogIn(BaseModel):
    date: str
    market: Optional[str] = ""
    watchlist: Optional[str] = ""
    mistakes: Optional[str] = ""
    did_great: Optional[str] = ""
    reinforcement: Optional[str] = ""
    overall: Optional[str] = ""
    tags: Optional[str] = ""
    checklist: Optional[str] = ""


class ExchangeIn(BaseModel):
    exchange: Optional[str] = "delta"
    key: Optional[str] = ""
    secret: Optional[str] = ""
    passphrase: Optional[str] = ""


class ImageUploadIn(BaseModel):
    data: str  # data:image/...;base64,...


class PlaybookIn(BaseModel):
    name: str
    description: Optional[str] = None
    checklist: list[str] = []
    exit_rules: Optional[str] = None
    management: Optional[str] = None
    notes: Optional[str] = None
    active: bool = True

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        v = (v or "").strip()
        if not v or len(v) > 120:
            raise ValueError("name is required (max 120 characters)")
        return v

    @field_validator("checklist")
    @classmethod
    def _checklist(cls, v):
        items = [s.strip() for s in v if s and s.strip()]
        if len(items) > 50 or any(len(s) > 300 for s in items):
            raise ValueError("checklist: up to 50 items of 300 characters")
        return list(dict.fromkeys(items))


class ImportIn(BaseModel):
    rows: list[dict]
    dry_run: bool = False


class ImageUrlsIn(BaseModel):
    paths: list[str]
