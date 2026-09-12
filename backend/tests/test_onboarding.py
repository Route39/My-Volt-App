"""Platform admin company onboarding (company + first company_admin) tests."""
import pytest
import requests

from conftest import API

PLATFORM = ("platform@myvolt.app", "Platform@2026")

FAB_CODE = "qa-api-weave"
FLEET_CODE = "qa-api-fleet"
FAB_EMAIL = "api.fabric@qaapi.com"
FLEET_EMAIL = "api.fleet@qaapi.com"


def _sess(email, pwd):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"login failed for {email}: {r.status_code} {r.text[:300]}")
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def plat():
    return _sess(*PLATFORM)


# --- platform admin login / access ---
class TestPlatformAccess:
    def test_platform_login_role(self, plat):
        r = plat.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "platform_admin"

    def test_summary(self, plat):
        r = plat.get(f"{API}/platform/summary", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ["total_companies", "active_companies", "trial_companies", "total_users"]:
            assert isinstance(d[k], int)

    def test_non_platform_forbidden(self, admin):
        r = admin.get(f"{API}/platform/companies", timeout=30)
        assert r.status_code == 403


# --- company + admin creation ---
class TestOnboarding:
    def test_create_fabric_company(self, plat):
        payload = {"name": "QA API Weave", "code": FAB_CODE, "industry": "fabric_order_management",
                   "plan": "Trial", "status": "trial",
                   "admin": {"name": "API Fabric Admin", "email": FAB_EMAIL, "phone": "+91 90000 11111",
                             "password": "ApiFabric@2026"}}
        r = plat.post(f"{API}/platform/companies", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert "_id" not in d["company"] and "_id" not in d["admin"]
        c, a = d["company"], d["admin"]
        assert c["org_id"] == FAB_CODE
        assert c["name"] == "QA API Weave"
        assert c["industry"] == "fabric_order_management"
        assert c["industry_label"] == "Fabric Order Management"
        assert set(["dashboard", "orders", "customers", "reports", "settings"]).issubset(set(c["modules"]))
        assert a["email"] == FAB_EMAIL and a["name"] == "API Fabric Admin"

        # GET verify persistence
        g = plat.get(f"{API}/platform/companies/{FAB_CODE}", timeout=30)
        assert g.status_code == 200
        gd = g.json()
        assert gd["name"] == "QA API Weave"
        assert gd["users"] == 1

    def test_create_fleet_company(self, plat):
        payload = {"name": "QA API Fleet", "code": FLEET_CODE, "industry": "fleet",
                   "plan": "Starter", "status": "active",
                   "admin": {"name": "API Fleet Admin", "email": FLEET_EMAIL, "phone": "",
                             "password": "ApiFleet@2026"}}
        r = plat.post(f"{API}/platform/companies", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:400]
        c = r.json()["company"]
        assert c["industry_label"] == "Fleet & Rental"
        assert c["status"] == "active" and c["plan"] == "Starter"
        assert "fleet" in c["modules"]

    def test_duplicate_code_rejected(self, plat):
        r = plat.post(f"{API}/platform/companies", json={
            "name": "Other", "code": FAB_CODE, "industry": "fleet",
            "admin": {"name": "X", "email": "unique.x@qaapi.com", "password": "Abc@1234"}}, timeout=30)
        assert r.status_code == 400
        assert "code already exists" in r.json()["detail"].lower()

    def test_duplicate_email_rejected(self, plat):
        r = plat.post(f"{API}/platform/companies", json={
            "name": "Other2", "code": "qa-api-other2", "industry": "fleet",
            "admin": {"name": "X", "email": FAB_EMAIL, "password": "Abc@1234"}}, timeout=30)
        assert r.status_code == 400
        assert "email already exists" in r.json()["detail"].lower()
        # ensure no org leaked
        assert plat.get(f"{API}/platform/companies/qa-api-other2", timeout=30).status_code == 404

    def test_missing_name_rejected(self, plat):
        r = plat.post(f"{API}/platform/companies", json={"name": "", "code": "", "industry": "fleet"}, timeout=30)
        assert r.status_code == 400

    def test_org_id_not_taken_from_frontend(self, plat):
        """organization_id in payload must be ignored; admin user linked to new org code."""
        r = plat.post(f"{API}/platform/companies", json={
            "name": "QA API Inject", "code": "qa-api-inject", "industry": "fleet",
            "organization_id": "route39-org",
            "admin": {"name": "Inject Admin", "email": "api.inject@qaapi.com",
                      "organization_id": "route39-org", "password": "Inject@2026"}}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        s = _sess("api.inject@qaapi.com", "Inject@2026")
        me = s.get(f"{API}/auth/me", timeout=30).json()
        assert me["organization_id"] == "qa-api-inject"
        assert me["role"] == "company_admin"


# --- new admin login + industry payload + isolation ---
class TestNewAdminLogin:
    def test_fabric_admin_login_payload(self):
        s = _sess(FAB_EMAIL, "ApiFabric@2026")
        me = s.get(f"{API}/auth/me", timeout=30).json()
        assert me["role"] == "company_admin"
        assert me["organization_id"] == FAB_CODE
        assert me.get("industry") == "fabric_order_management"
        assert me.get("org_name") == "QA API Weave"
        orders = s.get(f"{API}/orders", timeout=30)
        assert orders.status_code == 200
        assert orders.json() == [] or len(orders.json()) == 0

    def test_fleet_admin_login_payload_and_isolation(self):
        s = _sess(FLEET_EMAIL, "ApiFleet@2026")
        me = s.get(f"{API}/auth/me", timeout=30).json()
        assert me.get("industry") == "fleet"
        assert me["organization_id"] == FLEET_CODE
        v = s.get(f"{API}/vehicles", timeout=30)
        assert v.status_code == 200
        body = v.json()
        items = body.get("items", body) if isinstance(body, dict) else body
        assert len(items) == 0
        assert s.get(f"{API}/platform/companies", timeout=30).status_code == 403

    def test_wrong_password_rejected(self):
        r = requests.post(f"{API}/auth/login", json={"email": FAB_EMAIL, "password": "wrong"}, timeout=30)
        assert r.status_code in (401, 403, 429)


# --- regression: existing orgs untouched ---
class TestRegression:
    def test_route39_admin_fleet_intact(self, admin):
        me = admin.get(f"{API}/auth/me", timeout=30).json()
        assert me["organization_id"] == "route39-org"
        v = admin.get(f"{API}/vehicles", timeout=30)
        assert v.status_code == 200
        body = v.json()
        items = body.get("items", body) if isinstance(body, dict) else body
        assert len(items) > 0

    def test_nayara_orders_intact(self, nayara):
        r = nayara.get(f"{API}/orders", timeout=30)
        assert r.status_code == 200
        assert len(r.json()) >= 24
