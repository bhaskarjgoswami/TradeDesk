import contextlib
from datetime import datetime,timezone
import hashlib,hmac
from unittest.mock import Mock
import httpx
import pytest
from fastapi import HTTPException
from app.routers import subscription as payments

USER={"user_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","email":"qa@example.invalid"}

@pytest.fixture(autouse=True)
def test_keys(monkeypatch):
    monkeypatch.setattr(payments,"RAZORPAY_KEY_ID","rzp_test_example")
    monkeypatch.setattr(payments,"RAZORPAY_KEY_SECRET","unit-test-payment-secret")
    monkeypatch.setattr(payments,"RAZORPAY_WEBHOOK_SECRET","")

@pytest.mark.parametrize("amount",[0,99,-1,True,1.5,"9900"])
def test_invalid_amount_never_creates_an_order(monkeypatch,amount):
    provider=Mock();monkeypatch.setattr(payments.httpx,"post",provider)
    with pytest.raises(HTTPException) as error:payments.create_checkout({"amount":amount},USER)
    assert error.value.status_code==400
    provider.assert_not_called()

def test_client_cannot_lower_pro_price(monkeypatch):
    provider=Mock();monkeypatch.setattr(payments.httpx,"post",provider)
    with pytest.raises(HTTPException) as error:payments.create_checkout({"amount":100},USER)
    assert error.value.status_code==400
    provider.assert_not_called()

@pytest.mark.parametrize("body",[{"plan":[]},{"currency":[]},{"receipt":"x"*41},{"receipt":""}])
def test_malformed_order_fields_are_rejected(body):
    with pytest.raises(HTTPException) as error:payments.create_checkout(body,USER)
    assert error.value.status_code==400

def test_server_order_receipt_and_public_response(monkeypatch):
    provider=Mock(return_value=httpx.Response(200,json={"id":"order_test","amount":9900,"currency":"INR"}))
    monkeypatch.setattr(payments.httpx,"post",provider)
    cursor=Mock();cursor.__enter__=Mock(return_value=cursor);cursor.__exit__=Mock(return_value=False)
    conn=Mock();conn.cursor.return_value=cursor
    @contextlib.contextmanager
    def connect(**kwargs):yield conn
    monkeypatch.setattr(payments,"get_conn",connect)
    order=payments.create_checkout({"plan":"monthly","currency":"inr"},USER)
    payload=provider.call_args.kwargs["json"]
    assert payload["amount"]==9900 and 1<=len(payload["receipt"])<=40
    assert payload["notes"]["user_id"]==USER["user_id"]
    assert order["order_id"]=="order_test" and order["amount"]==9900
    assert order["key_id"]=="rzp_test_example" and "key_secret" not in order
    assert "INSERT INTO public.billing_orders" in cursor.execute.call_args.args[0]

@pytest.mark.parametrize("status,expected",[(401,401),(403,401),(400,500),(500,500)])
def test_provider_errors_are_mapped_without_leaking_credentials(monkeypatch,status,expected):
    monkeypatch.setattr(payments.httpx,"post",lambda *a,**kw:httpx.Response(status))
    with pytest.raises(HTTPException) as error:payments.create_checkout({},USER)
    assert error.value.status_code==expected
    assert payments.RAZORPAY_KEY_SECRET not in str(error.value.detail)

def test_provider_timeout_is_controlled(monkeypatch):
    def timeout(*a,**kwargs):raise httpx.ReadTimeout("provider timeout")
    monkeypatch.setattr(payments.httpx,"post",timeout)
    with pytest.raises(HTTPException) as error:payments.create_checkout({},USER)
    assert error.value.status_code==500

@pytest.mark.parametrize("body",[{}, {"razorpay_order_id":"order_1"},
    {"razorpay_order_id":[],"razorpay_payment_id":"pay_1","razorpay_signature":"0"*64},
    {"razorpay_order_id":"order_1","razorpay_payment_id":"pay_1","razorpay_signature":"0"*64}])
def test_missing_or_forged_signature_never_grants(monkeypatch,body):
    grant=Mock();monkeypatch.setattr(payments,"_apply_paid_order",grant)
    with pytest.raises(HTTPException) as error:payments.verify_payment(body,USER)
    assert error.value.status_code==400
    grant.assert_not_called()

def test_valid_signature_continues_to_captured_payment_verification(monkeypatch):
    expiry=datetime(2027,1,1,tzinfo=timezone.utc)
    grant=Mock(return_value=("monthly",expiry));monkeypatch.setattr(payments,"_apply_paid_order",grant)
    signature=hmac.new(payments.RAZORPAY_KEY_SECRET.encode(),b"order_1|pay_1",hashlib.sha256).hexdigest()
    body={"razorpay_order_id":"order_1","razorpay_payment_id":"pay_1","razorpay_signature":signature}
    response=payments.verify_payment(body,USER)
    assert response["success"] is True and response["tier"]=="pro"
    grant.assert_called_once_with("order_1","pay_1",USER["user_id"])

def test_test_checkout_does_not_require_webhook_but_live_checkout_does(monkeypatch):
    assert payments.public_plans()["checkout_available"] is True
    assert payments.public_plans()["mode"]=="test"
    monkeypatch.setattr(payments,"RAZORPAY_KEY_ID","rzp_live_example")
    assert payments.public_plans()["checkout_available"] is False
    with pytest.raises(HTTPException) as error:payments.create_checkout({},USER)
    assert error.value.status_code==503
    monkeypatch.setattr(payments,"RAZORPAY_WEBHOOK_SECRET","live-webhook-secret")
    assert payments.public_plans()["checkout_available"] is True
