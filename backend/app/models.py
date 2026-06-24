from pydantic import BaseModel
from typing import Optional


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
