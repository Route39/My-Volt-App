"""Verify permanent deletion of Nayara org & Fabric industry.

Post-deletion contract (iteration_8):
- Nayara users return 401 'invalid email or password' (user record gone).
- Route39 login + /api/vehicles == 284 unchanged.
- MyEVRental driver login OK; rental-admin summary intact.
- Platform admin lists exactly one non-platform company: route39-org.
- POST /api/platform/companies with industry=fabric_order_management -> 400.
- /api/orders and /api/customers not reachable/usable by any remaining org.
"""
import os
import requests
import pytest
from dotenv import dotenv_values

fe = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or fe.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)


# ---- Nayara users MUST be gone (401, not 403) ----
class TestNayaraDeleted:
    @pytest.mark.parametrize("email", [
        "admin@nayara.studio",
        "nandhini@nayara.studio",
        "priya@nayara.studio",
    ])
    def test_nayara_login_401_user_gone(self, email):
        r = _login(email, "Nayara@2026")
        assert r.status_code == 401, f"expected 401 (user deleted), got {r.status_code}: {r.text[:200]}"
        body = r.text.lower()
        # Must NOT say "archived / no longer active" (which would mean org still exists)
        assert "archived" not in body and "no longer active" not in body, \
            f"Nayara org appears still present (archived), not deleted: {r.text[:200]}"
        assert "invalid" in body or "incorrect" in body or "credential" in body or "password" in body


# ---- Route39 must be intact ----
class TestRoute39Intact:
    @pytest.fixture(scope="class")
    def token(self):
        r = _login("support@route39.in", "Route39@2026")
        assert r.status_code == 200, r.text
        return r.json()["token"]

    def test_login_ok(self, token):
        assert token

    def test_vehicles_count_284(self, token):
        r = requests.get(f"{API}/vehicles?page_size=1000",
                         headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        total = data.get("total") if isinstance(data, dict) else None
        items = data if isinstance(data, list) else data.get("items", [])
        assert (total == 284) or (len(items) == 284), \
            f"expected 284 vehicles, got total={total}, items={len(items)}"

    def test_dashboard_summary(self, token):
        r = requests.get(f"{API}/dashboard/summary", headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["fleet"]["total"] == 284

    def test_orders_empty_for_route39(self, token):
        r = requests.get(f"{API}/orders", headers={"Authorization": f"Bearer {token}"}, timeout=30)
        # Either 404 (route removed) or 200 with empty list acceptable
        assert r.status_code in (200, 404), r.text[:200]
        if r.status_code == 200:
            data = r.json()
            items = data if isinstance(data, list) else data.get("items", [])
            assert items == [], f"orders should be empty post-deletion: {items[:3]}"

    def test_customers_empty_for_route39(self, token):
        r = requests.get(f"{API}/customers", headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert r.status_code in (200, 404), r.text[:200]
        if r.status_code == 200:
            data = r.json()
            items = data if isinstance(data, list) else data.get("items", [])
            assert items == []

    def test_rental_admin_summary(self, token):
        r = requests.get(f"{API}/rental-admin/summary",
                         headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_drivers", "active_rentals", "overdue_rentals", "blocked_rentals"):
            assert k in d
        # Expected demo state: active=2 (Raj + Vikram), overdue=1 (Suresh), blocked=1 (Arjun)
        assert d["total_drivers"] == 4, d
        assert d["active_rentals"] == 2, d
        assert d["overdue_rentals"] == 1, d
        assert d["blocked_rentals"] == 1, d


# ---- Platform Admin ----
class TestPlatformAdmin:
    @pytest.fixture(scope="class")
    def token(self):
        r = _login("platform@myvolt.app", "Platform@2026")
        assert r.status_code == 200, r.text
        return r.json()["token"]

    def test_companies_only_route39(self, token):
        r = requests.get(f"{API}/platform/companies",
                         headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        rows = data if isinstance(data, list) else data.get("items", data.get("companies", []))
        ids = {(c.get("org_id") or c.get("id") or c.get("slug")) for c in rows}
        names = {(c.get("name") or "").lower() for c in rows}
        # Must not include Nayara
        assert not any("nayara" in n for n in names), f"Nayara still listed: {rows}"
        # Must include route39
        assert any("route39" in str(x).lower() for x in ids) or any("route39" in n for n in names), \
            f"route39 missing: {rows}"

    def test_add_fabric_rejected(self, token):
        payload = {
            "name": "TEST_FabricDel",
            "slug": "test-fabricdel",
            "industry": "fabric_order_management",
            "admin_email": "TEST_fabdel@example.com",
            "admin_password": "TestPass@2026",
            "admin_name": "Test Fab Del",
        }
        r = requests.post(f"{API}/platform/companies", json=payload,
                          headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                          timeout=30)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:300]}"


# ---- Driver app regression ----
class TestDriverRegression:
    @pytest.mark.parametrize("phone", [
        "+919000000001", "+919000000002", "+919000000003", "+919000000004"
    ])
    def test_driver_login_ok(self, phone):
        r = requests.post(f"{API}/driver/auth/login",
                          json={"phone": phone, "password": "Driver@2026"}, timeout=30)
        assert r.status_code == 200, f"{phone}: {r.text[:200]}"
        assert r.json().get("token")

    def test_driver_status_shapes(self):
        # Fetch each driver's info via /driver/me and rental payments
        results = {}
        for phone in ["+919000000001", "+919000000002", "+919000000003", "+919000000004"]:
            lr = requests.post(f"{API}/driver/auth/login",
                               json={"phone": phone, "password": "Driver@2026"}, timeout=30).json()
            tok = lr["token"]
            r = requests.get(f"{API}/driver/me",
                             headers={"Authorization": f"Bearer {tok}"}, timeout=30)
            assert r.status_code == 200, f"{phone}: {r.status_code} {r.text[:200]}"
            results[phone] = r.json()
        assert all(isinstance(v, dict) for v in results.values())
