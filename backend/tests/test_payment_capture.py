import contextlib
from unittest.mock import Mock
import httpx
import pytest
from fastapi import HTTPException
from app.routers import subscription

@pytest.mark.parametrize("change", [
    {"status": "authorized", "captured": False},
    {"amount": 1}, {"currency": "USD"}, {"order_id": "another"},
])
def test_unpaid_or_mismatched_payment_never_grants(monkeypatch, change):
    order = {"id":"order_1","status":"paid","amount":69900,"amount_paid":69900,"currency":"INR"}
    payment = {"id":"pay_1","order_id":"order_1","status":"captured","captured":True,"amount":69900,"currency":"INR",**change}
    monkeypatch.setattr(subscription.httpx,"get",lambda url,**kw:httpx.Response(200,json=payment if "/payments/" in url else order))
    cur=Mock();cur.__enter__=Mock(return_value=cur);cur.__exit__=Mock(return_value=False)
    cur.fetchone.return_value={"user_id":"u1","plan":"annual","amount":69900,"currency":"INR"}
    conn=Mock();conn.cursor.return_value=cur
    @contextlib.contextmanager
    def connect(**kw): yield conn
    monkeypatch.setattr(subscription,"get_conn",connect)
    grant=Mock();monkeypatch.setattr(subscription,"extend",grant)
    with pytest.raises(HTTPException) as exc:
        subscription._apply_paid_order("order_1","pay_1","u1")
    assert exc.value.status_code == 409
    grant.assert_not_called()


def test_public_price_catalog_matches_approved_inr_prices(monkeypatch):
    monkeypatch.setattr(subscription,"RAZORPAY_KEY_ID","")
    result=subscription.public_plans()
    assert result["prices"]["INR"]=={"monthly":9900,"annual":69900}
    assert result["checkout_available"] is False
