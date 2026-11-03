import contextlib
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import get_current_user
from app.billing import active_tier, extend
from app.routers import exchange
from app.routers.stats import _summary
from app.secretbox import encrypt, decrypt

app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1", "email": "a@b.c"}
client = TestClient(app)


class FakeCursor:
    def __init__(self, row):
        self.row, self.sql = row, []
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def execute(self, sql, args=None): self.sql.append((sql, args))
    def fetchone(self): return self.row


class FakeConn:
    def __init__(self, row): self.cur = FakeCursor(row)
    def cursor(self): return self.cur


# ── billing ──────────────────────────────────────────────
def test_active_tier_expiry():
    future = datetime.now(timezone.utc) + timedelta(days=3)
    past = datetime.now(timezone.utc) - timedelta(days=1)
    assert active_tier(FakeConn({"subscription_tier": "pro", "subscription_expires_at": future}), "u") == "pro"
    assert active_tier(FakeConn({"subscription_tier": "pro", "subscription_expires_at": past}), "u") == "free"
    assert active_tier(FakeConn({"subscription_tier": "free", "subscription_expires_at": future}), "u") == "free"
    assert active_tier(FakeConn(None), "u") == "free"


def test_extend_is_idempotent_and_stacks():
    exp = datetime.now(timezone.utc) + timedelta(days=10)
    same = FakeConn({"subscription_expires_at": exp, "razorpay_payment_id": "pay_1"})
    assert extend(same, "u", "monthly", "pay_1") == exp  # replay: no change
    assert len(same.cur.sql) == 1
    fresh = FakeConn({"subscription_expires_at": exp, "razorpay_payment_id": "pay_1"})
    new = extend(fresh, "u", "monthly", "pay_2")
    assert abs((new - exp) - timedelta(days=30)) < timedelta(seconds=1)  # stacked on remaining time
    assert "FOR UPDATE" in fresh.cur.sql[0][0]
    with pytest.raises(ValueError):
        extend(fresh, "u", "weekly", "pay_3")


# ── stats ────────────────────────────────────────────────
def test_summary_is_net_of_fees():
    rows = [{"pnl": 10, "fee": 1}, {"pnl": -4, "fee": 1}, {"pnl": 0.5, "fee": 1}, {"pnl": None, "fee": 2}]
    s = _summary(rows)
    assert s["net_pnl"] == 3.5  # 9 - 5 - 0.5; open trade excluded
    assert len(s["wins"]) == 1 and len(s["losses"]) == 2
    assert s["profit_factor"] == round(9 / 5.5, 2)
    assert _summary([{"pnl": 5, "fee": 0}])["profit_factor"] == 999
    assert _summary([])["profit_factor"] == 0


# ── secrets ──────────────────────────────────────────────
def test_secretbox_roundtrip_and_legacy():
    from cryptography.fernet import Fernet
    import app.secretbox as sb
    sb._fernet = Fernet(Fernet.generate_key())
    tok = encrypt("s3cret")
    assert tok.startswith("enc:v1:") and "s3cret" not in tok
    assert decrypt(tok) == "s3cret"
    assert decrypt("legacy-plain") == "legacy-plain"
    assert decrypt(None) == "" and encrypt("") == ""


# ── delta import ─────────────────────────────────────────
def test_fill_day_uses_user_timezone():
    assert exchange._fill_day("2026-11-02T20:00:00Z", -330) == "2026-11-03"  # IST
    assert exchange._fill_day("2026-11-02T20:00:00.5Z", 0) == "2026-11-02"
    assert exchange._fill_day(1793707360000000, 0) == "2026-11-03"


def test_delta_round_trips_have_stable_ids(monkeypatch):
    day = "2026-11-03"
    fills = [
        {"id": 1, "product_symbol": "BTCUSD", "side": "buy", "size": 10, "price": 70000, "created_at": day + "T05:00:00Z", "commission": "0.1"},
        {"id": 2, "product_symbol": "BTCUSD", "side": "sell", "size": 10, "price": 70100, "created_at": day + "T05:05:00Z",
         "commission": "0.1", "meta_data": {"new_position": {"realized_pnl": "1.0"}}},
        {"id": 3, "product_symbol": "BTCUSD", "side": "sell", "size": 5, "price": 70200, "created_at": day + "T06:00:00Z"},
    ]
    monkeypatch.setattr(exchange, "_signed_get", lambda k, s, p, q="": {"result": fills if p == "/v2/fills" else []})
    monkeypatch.setattr(exchange, "_cv", lambda s: 0.001)

    @contextlib.contextmanager
    def conn():
        yield FakeConn({"delta_key": "k", "delta_secret": "s"})
    monkeypatch.setattr(exchange, "get_conn", conn)

    r = client.get(f"/api/delta/today?date={day}&tz=0").json()["trades"]
    closed = [t for t in r if not t["open"]]
    assert len(closed) == 1
    assert closed[0]["ext_id"] == "delta:BTCUSD:1" and closed[0]["pnl"] == 1.0 and closed[0]["direction"] == "Long"
    assert [t for t in r if t["open"]][0]["direction"] == "Short"


# ── uploads ──────────────────────────────────────────────
@pytest.mark.parametrize("data", ["nocomma", "data:text/plain;base64,aGk=", "data:image/png;base64,!!!", "data:image/svg+xml;base64,PHN2Zz4="])
def test_upload_rejects_bad_input(data):
    assert client.post("/api/trades/upload", json={"data": data}).status_code == 400


def test_upload_rejects_oversize():
    big = "data:image/png;base64," + "A" * (8 * 1024 * 1024)
    assert client.post("/api/trades/upload", json={"data": big}).status_code == 413


def test_image_urls_only_signs_own_paths():
    assert client.post("/api/trades/image-urls", json={"paths": ["other/x.png", "u1/../other/x.png"]}).json() == {}


# ── rate limits ──────────────────────────────────────────
def test_rate_limit_blocks_after_quota():
    from app import ratelimit
    ratelimit._hits.clear()
    codes = [client.post("/api/trades/upload", json={"data": "bad"}).status_code for _ in range(21)]
    assert codes[:20] == [400] * 20 and codes[20] == 429
    ratelimit._hits.clear()


# ── CSV import ───────────────────────────────────────────
def test_import_row_derives_values_with_contract_size():
    from app.routers.trades import _import_row
    r = _import_row({"date": "2026-11-01", "symbol": "btcusd", "direction": "short", "entry": "70,100",
                     "stop": "70200", "exit": "70000", "qty": "10", "fee": "0.2", "contract_value": "0.001"}, 2)
    assert r["symbol"] == "BTCUSD" and r["direction"] == "Short"
    assert r["pnl"] == 1.0 and r["risk"] == 1.0 and r["r_multiple"] == 1.0 and r["outcome"] == "Win"
    assert r["ext_id"].startswith("csv:") and "contract_value" not in r
    same = _import_row({"date": "2026-11-01", "symbol": "BTCUSD", "direction": "Short", "entry": "70100",
                        "stop": "70200", "exit": "70000", "qty": "10", "fee": "0.2", "contract_value": "0.001"}, 3)
    assert same["ext_id"] == r["ext_id"]  # identical record -> same dedupe key


@pytest.mark.parametrize("raw,msg", [
    ({"date": "01/11/2026", "symbol": "X", "direction": "Long"}, "YYYY-MM-DD"),
    ({"date": "2026-02-30", "symbol": "X", "direction": "Long"}, "YYYY-MM-DD"),
    ({"date": "2026-11-01", "symbol": "", "direction": "Long"}, "symbol"),
    ({"date": "2026-11-01", "symbol": "X", "direction": "Up"}, "Long/Short"),
    ({"date": "2026-11-01", "symbol": "X", "direction": "Long", "qty": "-1"}, "qty"),
    ({"date": "2026-11-01", "symbol": "X", "direction": "Long", "pnl": "abc"}, "pnl"),
])
def test_import_row_rejects_bad_rows(raw, msg):
    from app.routers.trades import _import_row
    with pytest.raises(ValueError, match=msg):
        _import_row(raw, 7)


def test_import_reports_errors_without_writing():
    r = client.post("/api/trades/import", json={"rows": [{"date": "bad", "symbol": "X", "direction": "Long"}]}).json()
    assert r["ok"] is False and r["error_count"] == 1 and "Row 2" in r["errors"][0]
    assert client.post("/api/trades/import", json={"rows": []}).status_code == 400


def test_max_drawdown_and_expectancy():
    from app.routers.stats import _max_drawdown
    assert _max_drawdown([10, -4, -8, 5, 20, -3]) == -12  # peak 10 -> trough -2
    assert _max_drawdown([-5, -5]) == -10                  # below the zero start
    assert _max_drawdown([]) == 0


# ── trade review ─────────────────────────────────────────
def test_review_validation():
    from pydantic import ValidationError
    from app.models import TradeIn
    t = TradeIn(review={"followed_plan": False, "quality": "B", "emotion_in": "Anxious",
                        "mistakes": ["Moved stop", "Moved stop"], "junk": 1})
    assert t.review.mistakes == ["Moved stop"] and t.review.quality == "B"
    for bad in ({"quality": "Z"}, {"emotion_in": "Hungry"}, {"mistakes": ["Bad luck"]}):
        with pytest.raises(ValidationError):
            TradeIn(review=bad)


def test_review_stored_as_json():
    from psycopg2.extras import Json
    from app.models import TradeIn
    from app.routers.trades import _vals, TRADE_FIELDS
    v = _vals(TradeIn(symbol="X", review={"followed_plan": True}))
    r = v[TRADE_FIELDS.index("review")]
    assert isinstance(r, Json) and r.adapted["followed_plan"] is True
    assert _vals(TradeIn())[TRADE_FIELDS.index("review")] is None
