import pytest
from app.journal.core import validate_trade

@pytest.mark.parametrize("patch", [
    {"date":"2026-02-30"},{"direction":"Sideways"},{"qty":-10},
    {"entry":float("inf")},{"pnl":float("nan")},{"symbol":""},
])
def test_invalid_journal_trade_is_rejected(patch):
    with pytest.raises(ValueError):
        validate_trade({"date":"2026-11-04","symbol":"BTCUSD","direction":"Long",**patch})

def test_journal_trade_keeps_signed_pnl_and_blank_optional_numbers():
    data=validate_trade({"date":"2026-11-04","symbol":"BTCUSD","direction":"Short","pnl":-12.5,"entry":""})
    assert data["pnl"] == -12.5 and data["entry"] is None
