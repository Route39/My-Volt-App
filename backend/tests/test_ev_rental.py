"""End-to-end backend tests for MyEVRental (driver app) + MyVolt Rental Drivers admin.

Covers driver login, /driver/me payloads for the 4 seeded personas, packages,
create-order + verify (sandbox) for deposit / daily / outstanding, blocking rules,
full-outstanding reactivation, organization isolation, and MyVolt admin summary + list + detail.
"""
import os
import time
import pytest
import requests
from dotenv import dotenv_values

fe = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or fe.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

DRIVERS = {
    "silver_paid":    ("+919000000001", "Driver@2026"),  # active
    "gold_overdue":   ("+919000000002", "Driver@2026"),  # overdue 1 day
    "platinum_block": ("+919000000003", "Driver@2026"),  # blocked 2 days
    "gold_deposit":   ("+919000000004", "Driver@2026"),  # deposit pending
}


def _driver_session(key):
    phone, pwd = DRIVERS[key]
    s = requests.Session()
    r = s.post(f"{API}/driver/auth/login", json={"phone": phone, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"driver login failed for {key}: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


def _admin_session(email, pwd):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"admin login failed {email}: {r.text}"
    tok = r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


# ---------------- Driver auth & personas ----------------
class TestDriverAuth:
    def test_bad_password_401(self):
        r = requests.post(f"{API}/driver/auth/login", json={"phone": "+919000000001", "password": "wrong"})
        assert r.status_code == 401

    def test_silver_active_paid(self):
        s = _driver_session("silver_paid")
        r = s.get(f"{API}/driver/me"); assert r.status_code == 200
        d = r.json()
        assert d["rental"]["package_name"].lower() == "silver"
        assert d["rental"]["daily_rate"] == 800
        assert d["account"]["status"] == "active"
        assert d["account"]["today_paid"] is True
        assert d["account"]["outstanding_amount"] == 0
        assert d["deposit"]["status"] == "paid"

    def test_gold_overdue(self):
        s = _driver_session("gold_overdue")
        d = s.get(f"{API}/driver/me").json()
        assert d["rental"]["package_name"].lower() == "gold"
        assert d["rental"]["daily_rate"] == 900
        assert d["account"]["status"] == "overdue"
        assert d["account"]["overdue_days"] == 1
        assert d["account"]["outstanding_amount"] == 900
        assert d["rental"]["vehicle_reg"] == "TN 07 CD 1002"

    def test_platinum_blocked(self):
        s = _driver_session("platinum_block")
        d = s.get(f"{API}/driver/me").json()
        assert d["rental"]["package_name"].lower() == "platinum"
        assert d["rental"]["daily_rate"] == 1000
        assert d["account"]["status"] == "blocked"
        assert d["account"]["overdue_days"] == 2
        assert d["account"]["outstanding_amount"] == 2000

    def test_gold_deposit_pending(self):
        s = _driver_session("gold_deposit")
        d = s.get(f"{API}/driver/me").json()
        assert d["deposit"]["status"] == "pending"
        assert d["deposit"]["amount"] == 5000


# ---------------- Packages ----------------
class TestPackages:
    def test_packages_three_tiers(self):
        s = _driver_session("silver_paid")
        r = s.get(f"{API}/driver/packages")
        assert r.status_code == 200
        pkgs = r.json()
        names = {p["name"].lower(): p["daily_rate"] for p in pkgs}
        assert names.get("silver") == 800
        assert names.get("gold") == 900
        assert names.get("platinum") == 1000


# ---------------- Payment flows (sandbox) ----------------
class TestDepositPayment:
    """gold_deposit driver: pay ₹5000 deposit -> flips to paid."""

    def test_deposit_pay_flow(self):
        s = _driver_session("gold_deposit")
        # confirm pending before
        me = s.get(f"{API}/driver/me").json()
        if me["deposit"]["status"] == "paid":
            pytest.skip("deposit already paid in previous run")

        r = s.post(f"{API}/driver/payments/create-order", json={"kind": "deposit"})
        assert r.status_code == 200, r.text
        order = r.json()
        assert order["amount"] == 5000
        assert order["gateway"] == "sandbox"
        assert order.get("sandbox_token")

        # wrong token => 403 (no fake success)
        bad = s.post(f"{API}/driver/payments/verify",
                     json={"payment_id": order["payment_id"], "sandbox_token": "wrong"})
        assert bad.status_code == 403

        good = s.post(f"{API}/driver/payments/verify",
                      json={"payment_id": order["payment_id"], "sandbox_token": order["sandbox_token"]})
        assert good.status_code == 200, good.text
        gj = good.json()
        assert gj["ok"] is True
        assert gj["transaction_id"].startswith("SBX-")

        me2 = s.get(f"{API}/driver/me").json()
        assert me2["deposit"]["status"] == "paid"
        assert me2["deposit"]["transaction_id"] == gj["transaction_id"]


class TestDailyRentPayment:
    """Silver already paid today -> daily create-order should reject; Gold overdue can pay today."""

    def test_silver_daily_rejected_today_paid(self):
        s = _driver_session("silver_paid")
        r = s.post(f"{API}/driver/payments/create-order", json={"kind": "daily"})
        assert r.status_code == 400
        assert "already paid" in r.text.lower()

    def test_platinum_blocked_daily_rejected(self):
        s = _driver_session("platinum_block")
        r = s.post(f"{API}/driver/payments/create-order", json={"kind": "daily"})
        assert r.status_code == 400
        assert "blocked" in r.text.lower()


class TestOutstandingReactivation:
    """Platinum: pay full outstanding -> becomes active. Runs LAST."""

    def test_platinum_full_outstanding_reactivates(self):
        s = _driver_session("platinum_block")
        me = s.get(f"{API}/driver/me").json()
        if me["account"]["status"] == "active":
            pytest.skip("already reactivated by previous run")
        assert me["account"]["outstanding_amount"] == 2000

        order = s.post(f"{API}/driver/payments/create-order", json={"kind": "outstanding"}).json()
        assert order["amount"] == 2000
        assert order.get("sandbox_token")

        vr = s.post(f"{API}/driver/payments/verify",
                    json={"payment_id": order["payment_id"], "sandbox_token": order["sandbox_token"]})
        assert vr.status_code == 200, vr.text
        v = vr.json()
        assert v["account"]["status"] == "active"
        assert v["account"]["outstanding_amount"] == 0

        me2 = s.get(f"{API}/driver/me").json()
        assert me2["account"]["status"] == "active"
        assert me2["account"]["outstanding_amount"] == 0

    def test_no_outstanding_rejected(self):
        s = _driver_session("silver_paid")
        r = s.post(f"{API}/driver/payments/create-order", json={"kind": "outstanding"})
        assert r.status_code == 400


# ---------------- Payment history ----------------
class TestPaymentHistory:
    def test_silver_history_has_paid(self):
        s = _driver_session("silver_paid")
        recs = s.get(f"{API}/driver/payments").json()
        assert isinstance(recs, list)
        assert any(p["payment_status"] == "paid" for p in recs)


# ---------------- MyVolt Admin: Rental Drivers ----------------
class TestRentalAdmin:
    def test_summary_shape(self):
        s = _admin_session("support@route39.in", "Route39@2026")
        r = s.get(f"{API}/rental-admin/summary")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("total_drivers", "active_rentals", "overdue_rentals", "blocked_rentals",
                  "today_expected", "today_collected", "outstanding_total", "deposits_collected"):
            assert k in d
        assert d["total_drivers"] >= 4

    def test_drivers_list_and_filter(self):
        s = _admin_session("support@route39.in", "Route39@2026")
        allrows = s.get(f"{API}/rental-admin/drivers").json()
        assert isinstance(allrows, list) and len(allrows) >= 4
        # each row keys
        row = allrows[0]
        for k in ("driver_id", "driver_name", "status", "outstanding", "overdue_days", "daily_rate"):
            assert k in row
        # status filters
        for st in ("active", "overdue", "blocked"):
            rows = s.get(f"{API}/rental-admin/drivers?status={st}").json()
            for x in rows:
                assert x["status"] == st

    def test_driver_detail_has_payments(self):
        s = _admin_session("support@route39.in", "Route39@2026")
        rows = s.get(f"{API}/rental-admin/drivers").json()
        # find the silver driver by rate
        silver = next(r for r in rows if r["daily_rate"] == 800)
        d = s.get(f"{API}/rental-admin/drivers/{silver['driver_id']}").json()
        assert d["rental"]["package_name"].lower() == "silver"
        assert isinstance(d["payments"], list)
        assert d["account"]["status"] == "active"


# ---------------- Isolation ----------------
class TestIsolation:
    def test_nayara_admin_zero_rental_drivers(self):
        s = _admin_session("admin@nayara.studio", "Nayara@2026")
        r = s.get(f"{API}/rental-admin/drivers")
        # Nayara is not fleet, so either 403 or empty list
        assert r.status_code in (200, 403)
        if r.status_code == 200:
            assert r.json() == []

    def test_driver_cannot_hit_admin(self):
        s = _driver_session("silver_paid")
        r = s.get(f"{API}/rental-admin/summary")
        assert r.status_code == 403

    def test_admin_cannot_hit_driver_me(self):
        s = _admin_session("support@route39.in", "Route39@2026")
        r = s.get(f"{API}/driver/me")
        assert r.status_code == 403

    def test_no_myvolt_regression_route39(self):
        s = _admin_session("support@route39.in", "Route39@2026")
        r = s.get(f"{API}/vehicles")
        assert r.status_code == 200
        assert len(r.json()) > 0
