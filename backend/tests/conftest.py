import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "admin": ("support@route39.in", "Route39@2026"),
    "ops": ("ops@route39.in", "Route39@2026"),
    "city": ("chennai@route39.in", "Route39@2026"),
    "service": ("service@route39.in", "Route39@2026"),
    "staff": ("staff@route39.in", "Route39@2026"),
    "nayara_admin": ("admin@nayara.studio", "Nayara@2026"),
    "nayara_staff": ("nandhini@nayara.studio", "Nayara@2026"),
}


def _client(role):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email, pwd = CREDS[role]
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"login failed for {role}: {r.status_code} {r.text[:300]}")
    token = r.json().get("token")
    if not token:
        pytest.fail(f"no token for {role}")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def admin():
    return _client("admin")


@pytest.fixture(scope="module")
def ops():
    return _client("ops")


@pytest.fixture(scope="module")
def city_mgr():
    return _client("city")


@pytest.fixture(scope="module")
def svc_mgr():
    return _client("service")


@pytest.fixture(scope="module")
def staff():
    return _client("staff")


@pytest.fixture(scope="module")
def nayara():
    return _client("nayara_admin")


@pytest.fixture(scope="module")
def nayara_staff():
    return _client("nayara_staff")
