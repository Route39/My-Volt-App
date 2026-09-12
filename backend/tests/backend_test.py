"""MyVolt backend API tests — auth, dashboard, fleet, drivers, rentals, service, docs, permissions."""
import requests
import pytest
from conftest import API, CREDS


# ---------- module: auth ----------
class TestAuth:
    def test_login_admin(self):
        r = requests.post(f"{API}/auth/login", json={"email": CREDS["admin"][0], "password": CREDS["admin"][1]}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["email"] == "support@route39.in"
        assert d["role"] == "admin"
        assert isinstance(d["token"], str) and len(d["token"]) > 20
        assert "password_hash" not in d
        assert "_id" not in d and "id" in d
        # httpOnly cookie set
        assert "access_token" in r.cookies, f"cookies: {r.cookies.get_dict()}"
        assert "httponly" in r.headers.get("set-cookie", "").lower()

    def test_me_with_bearer(self, admin):
        r = admin.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == "support@route39.in"

    def test_invalid_password_401(self):
        r = requests.post(f"{API}/auth/login", json={"email": CREDS["admin"][0], "password": "wrongpass"}, timeout=30)
        assert r.status_code == 401

    def test_no_token_401(self):
        for ep in ["/auth/me", "/vehicles", "/drivers", "/rentals", "/dashboard/summary", "/reports", "/search?q=a"]:
            r = requests.get(f"{API}{ep}", timeout=30)
            assert r.status_code == 401, f"{ep} -> {r.status_code}"

    def test_brute_force_lockout(self):
        codes = []
        for _ in range(7):
            # use a throwaway identifier so real accounts are not locked for other tests
            r = requests.post(f"{API}/auth/login", json={"email": "TEST_lockout@route39.in", "password": "bad"}, timeout=30)
            codes.append(r.status_code)
        # expect 423/429 lockout after 5 attempts per playbook
        assert any(c in (423, 429) for c in codes), f"no lockout, codes={codes}"

    def test_all_roles_login(self):
        for role, (email, pwd) in CREDS.items():
            r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
            assert r.status_code == 200, f"{role}: {r.status_code} {r.text[:200]}"


# ---------- module: dashboard / reports / search ----------
class TestDashboard:
    def test_summary(self, admin):
        r = admin.get(f"{API}/dashboard/summary?city=all", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ["fleet", "cities", "rentals", "attention", "cities_list"]:
            assert k in d
        assert d["fleet"]["total"] > 0
        assert len(d["cities"]) == 4
        assert sum(c["total"] for c in d["cities"]) == d["fleet"]["total"]
        assert set(["active", "expiring_today", "expiring_soon", "payment_pending", "suspended"]) <= set(d["rentals"])

    def test_summary_city_filter(self, admin):
        r = admin.get(f"{API}/dashboard/summary?city=Chennai", timeout=30)
        assert r.status_code == 200
        d = r.json()
        chennai = [c for c in d["cities"] if c["city"] == "Chennai"][0]
        assert d["fleet"]["total"] == chennai["total"]

    def test_recent(self, admin):
        r = admin.get(f"{API}/dashboard/recent", timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) > 0
        assert "action" in items[0] and "created_at" in items[0]

    def test_reports(self, admin):
        r = admin.get(f"{API}/reports", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ["fleet", "rentals", "service", "compliance", "drivers"]:
            assert k in d
        assert d["fleet"]["total"] > 0
        assert len(d["fleet"]["by_city"]) == 4
        assert d["drivers"]["total"] > 0

    def test_search(self, admin):
        v = admin.get(f"{API}/vehicles?page_size=1", timeout=30).json()["items"][0]
        r = admin.get(f"{API}/search", params={"q": v["vehicle_number"]}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert set(["vehicles", "drivers", "rentals", "service_requests"]) <= set(d)
        assert any(x["vehicle_number"] == v["vehicle_number"] for x in d["vehicles"])

    def test_notifications_and_audit(self, admin):
        assert admin.get(f"{API}/notifications", timeout=30).status_code == 200
        assert admin.get(f"{API}/audit-logs?limit=5", timeout=30).status_code == 200
        assert admin.get(f"{API}/cities", timeout=30).json() == ["Tiruppur", "Coimbatore", "Chennai", "Bangalore"]


# ---------- module: fleet ----------
class TestFleet:
    def test_list_and_filters(self, admin):
        r = admin.get(f"{API}/vehicles", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["total"] > 0 and len(d["items"]) > 0
        assert all("_id" not in i for i in d["items"])

        r2 = admin.get(f"{API}/vehicles?status=available", timeout=30).json()
        assert all(i["status"] == "available" for i in r2["items"])

        r3 = admin.get(f"{API}/vehicles?city=Chennai", timeout=30).json()
        assert r3["total"] > 0 and all(i["city"] == "Chennai" for i in r3["items"])

        num = d["items"][0]["vehicle_number"]
        r4 = admin.get(f"{API}/vehicles", params={"q": num}, timeout=30).json()
        assert any(i["vehicle_number"] == num for i in r4["items"])

        p1 = admin.get(f"{API}/vehicles?page=1&page_size=5", timeout=30).json()
        p2 = admin.get(f"{API}/vehicles?page=2&page_size=5", timeout=30).json()
        assert len(p1["items"]) == 5
        assert p1["items"][0]["id"] != p2["items"][0]["id"]

    def test_get_single_vehicle_nested(self, admin):
        vid = admin.get(f"{API}/vehicles?page_size=1", timeout=30).json()["items"][0]["id"]
        r = admin.get(f"{API}/vehicles/{vid}", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ["assignments", "services", "documents", "incidents", "service_requests"]:
            assert isinstance(d[k], list), k

    def test_get_vehicle_bad_id(self, admin):
        assert admin.get(f"{API}/vehicles/not-an-oid", timeout=30).status_code == 400
        assert admin.get(f"{API}/vehicles/64b7f9f9f9f9f9f9f9f9f9f9", timeout=30).status_code == 404

    def test_create_update_transfer_vehicle(self, ops):
        payload = {"vehicle_number": "TEST-V1", "registration_number": "TEST-REG-1", "city": "Coimbatore",
                   "status": "available", "parking": "TEST Hub", "odometer": 10}
        r = ops.post(f"{API}/vehicles", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:300]
        v = r.json()
        vid = v["id"]
        assert v["vehicle_number"] == "TEST-V1" and v["city"] == "Coimbatore"

        g = ops.get(f"{API}/vehicles/{vid}", timeout=30).json()
        assert g["registration_number"] == "TEST-REG-1"

        u = ops.put(f"{API}/vehicles/{vid}", json={"status": "idle", "battery_percent": 42}, timeout=30)
        assert u.status_code == 200
        assert ops.get(f"{API}/vehicles/{vid}", timeout=30).json()["status"] == "idle"

        t = ops.post(f"{API}/vehicles/{vid}/transfer", json={"to_city": "Chennai", "parking": "TEST Hub 2", "reason": "test"}, timeout=30)
        assert t.status_code == 200, t.text[:300]
        assert t.json()["city"] == "Chennai"
        assert ops.get(f"{API}/vehicles/{vid}", timeout=30).json()["city"] == "Chennai"


# ---------- module: drivers ----------
class TestDrivers:
    def test_list_filters(self, admin):
        r = admin.get(f"{API}/drivers", timeout=30)
        assert r.status_code == 200
        drivers = r.json()
        assert len(drivers) > 0
        assert all("_id" not in d for d in drivers)
        assert all(d["city"] == "Chennai" for d in admin.get(f"{API}/drivers?city=Chennai", timeout=30).json())
        name = drivers[0]["name"]
        assert any(d["name"] == name for d in admin.get(f"{API}/drivers", params={"q": name}, timeout=30).json())

    def test_driver_profile(self, admin):
        did = admin.get(f"{API}/drivers", timeout=30).json()[0]["id"]
        d = admin.get(f"{API}/drivers/{did}", timeout=30)
        assert d.status_code == 200
        for k in ["assignments", "rentals", "incidents", "documents"]:
            assert isinstance(d.json()[k], list), k

    def test_create_driver_and_assign_vehicle(self, ops):
        r = ops.post(f"{API}/drivers", json={"name": "TEST_Driver A", "phone": "9000000001", "city": "Coimbatore"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        did = r.json()["id"]
        assert ops.get(f"{API}/drivers/{did}", timeout=30).json()["name"] == "TEST_Driver A"

        veh = ops.get(f"{API}/vehicles?city=Coimbatore&status=available&page_size=1", timeout=30).json()["items"][0]
        a = ops.post(f"{API}/drivers/{did}/assign-vehicle", json={"vehicle_id": veh["id"], "notes": "test"}, timeout=30)
        assert a.status_code == 200, a.text[:300]

        prof = ops.get(f"{API}/drivers/{did}", timeout=30).json()
        assert prof["current_vehicle_number"] == veh["vehicle_number"]
        assert len(prof["assignments"]) == 1 and prof["assignments"][0]["end"] is None
        assert ops.get(f"{API}/vehicles/{veh['id']}", timeout=30).json()["current_driver_name"] == "TEST_Driver A"


# ---------- module: rental plans + rental lifecycle ----------
class TestRentals:
    def test_plans_list_and_create(self, ops):
        assert len(ops.get(f"{API}/rental-plans", timeout=30).json()) > 0
        r = ops.post(f"{API}/rental-plans", json={"name": "TEST_Plan Weekly", "amount": 2100, "duration_days": 7,
                                                 "deposit": 500, "cities": ["Coimbatore"]}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["amount"] == 2100
        assert any(p["name"] == "TEST_Plan Weekly" for p in ops.get(f"{API}/rental-plans", timeout=30).json())

    def test_rental_full_lifecycle(self, ops):
        drv = ops.post(f"{API}/drivers", json={"name": "TEST_Rental Driver", "phone": "9000000002", "city": "Coimbatore"}, timeout=30).json()
        veh = ops.post(f"{API}/vehicles", json={"vehicle_number": "TEST-V2", "registration_number": "TEST-REG-2",
                                               "city": "Coimbatore", "status": "available"}, timeout=30).json()
        plan = ops.get(f"{API}/rental-plans", timeout=30).json()[0]

        body = {"driver_id": drv["id"], "vehicle_id": veh["id"], "plan_id": plan["id"],
                "start": "2026-07-01T00:00:00+00:00", "end": "2026-07-31T00:00:00+00:00",
                "amount": 9000, "deposit": 1000, "notes": "TEST rental"}
        r = ops.post(f"{API}/rentals", json=body, timeout=30)
        assert r.status_code == 200, r.text[:300]
        rental = r.json()
        rid = rental["id"]
        assert rental["status"] == "pending_payment"
        assert rental["rental_code"].startswith("RNT-")
        assert rental["paid"] == 0 and rental["outstanding"] == 10000 and rental["payment_status"] == "pending"

        # partial payment
        p1 = ops.post(f"{API}/rentals/{rid}/payments", json={"amount": 4000, "method": "upi"}, timeout=30)
        assert p1.status_code == 200, p1.text[:300]
        g = ops.get(f"{API}/rentals/{rid}", timeout=30).json()
        assert g["paid"] == 4000 and g["outstanding"] == 6000 and g["payment_status"] == "partial"
        assert len(g["payments"]) == 1

        # full payment
        ops.post(f"{API}/rentals/{rid}/payments", json={"amount": 6000, "method": "cash"}, timeout=30)
        g = ops.get(f"{API}/rentals/{rid}", timeout=30).json()
        assert g["paid"] == 10000 and g["outstanding"] == 0 and g["payment_status"] == "paid"

        # activate
        a = ops.post(f"{API}/rentals/{rid}/activate", timeout=30)
        assert a.status_code == 200, a.text[:300]
        g = ops.get(f"{API}/rentals/{rid}", timeout=30).json()
        assert g["status"] == "active"
        assert ops.get(f"{API}/vehicles/{veh['id']}", timeout=30).json()["status"] == "rented"
        assert ops.get(f"{API}/drivers/{drv['id']}", timeout=30).json()["rental_status"] == "active"

        # renew
        rn = ops.post(f"{API}/rentals/{rid}/renew", json={"end": "2026-08-31T00:00:00+00:00", "amount": 9500}, timeout=30)
        assert rn.status_code == 200, rn.text[:300]
        g = ops.get(f"{API}/rentals/{rid}", timeout=30).json()
        assert g["end"].startswith("2026-08-31")
        assert len(g["renewals"]) == 1
        assert g["amount"] == 9500 and g["outstanding"] == 500

        # suspend
        s = ops.post(f"{API}/rentals/{rid}/suspend", json={"reason": "TEST suspend"}, timeout=30)
        assert s.status_code == 200
        assert ops.get(f"{API}/rentals/{rid}", timeout=30).json()["status"] == "suspended"
        assert ops.get(f"{API}/drivers/{drv['id']}", timeout=30).json()["rental_status"] == "suspended"

        # close
        c = ops.post(f"{API}/rentals/{rid}/close", timeout=30)
        assert c.status_code == 200
        g = ops.get(f"{API}/rentals/{rid}", timeout=30).json()
        assert g["status"] == "closed"
        vv = ops.get(f"{API}/vehicles/{veh['id']}", timeout=30).json()
        assert vv["status"] == "available" and vv["current_rental_id"] is None
        assert ops.get(f"{API}/drivers/{drv['id']}", timeout=30).json()["rental_status"] == "none"

    def test_rental_status_filters(self, admin):
        for st in ["active", "expiring", "pending_payment", "suspended", "closed"]:
            r = admin.get(f"{API}/rentals?status={st}", timeout=30)
            assert r.status_code == 200, f"{st}: {r.text[:200]}"
            items = r.json()
            for it in items:
                if st == "expiring":
                    assert it["display_status"] in ("expiring_soon", "expired")
                else:
                    assert it["display_status"] == st or it["status"] == st, f"{st} -> {it['display_status']}/{it['status']}"

    def test_rental_missing_refs_404(self, ops):
        body = {"driver_id": "64b7f9f9f9f9f9f9f9f9f9f9", "vehicle_id": "64b7f9f9f9f9f9f9f9f9f9f9",
                "plan_id": "64b7f9f9f9f9f9f9f9f9f9f9", "start": "2026-07-01", "end": "2026-07-31", "amount": 100}
        assert ops.post(f"{API}/rentals", json=body, timeout=30).status_code == 404


# ---------- module: service requests + vehicle service ----------
class TestService:
    def test_sr_lifecycle(self, ops, svc_mgr):
        veh = ops.get(f"{API}/vehicles?status=available&page_size=1", timeout=30).json()["items"][0]
        body = {"vehicle_id": veh["id"], "vehicle_number": veh["vehicle_number"], "city": veh["city"],
                "issue_type": "TEST_Brake noise", "priority": "high", "description": "TEST sr"}
        r = ops.post(f"{API}/service-requests", json=body, timeout=30)
        assert r.status_code == 200, r.text[:300]
        sr = r.json()
        sid = sr["id"]
        assert sr["code"].startswith("SR-") and sr["status"] == "new"
        assert len(sr["timeline"]) == 1

        for st in ["assigned", "inspection", "repair", "ready"]:
            u = svc_mgr.put(f"{API}/service-requests/{sid}", json={"status": st}, timeout=30)
            assert u.status_code == 200, f"{st}: {u.text[:200]}"
            assert u.json()["status"] == st
        got = svc_mgr.get(f"{API}/service-requests/{sid}", timeout=30).json()
        assert len(got["timeline"]) == 5
        assert svc_mgr.get(f"{API}/vehicles/{veh['id']}", timeout=30).json()["status"] == "service"

        # service record linked to SR closes it and frees the vehicle
        svc = svc_mgr.post(f"{API}/vehicle-services", json={
            "vehicle_id": veh["id"], "vehicle_number": veh["vehicle_number"], "city": veh["city"],
            "service_request_id": sid, "issue": "TEST_Brake pads", "cost": 1200,
            "start_date": "2026-07-01", "completion_date": "2026-07-02", "next_service_date": "2026-10-01"}, timeout=30)
        assert svc.status_code == 200, svc.text[:300]
        assert svc_mgr.get(f"{API}/service-requests/{sid}", timeout=30).json()["status"] == "closed"
        vv = svc_mgr.get(f"{API}/vehicles/{veh['id']}", timeout=30).json()
        assert vv["status"] == "available" and vv["next_service_date"] == "2026-10-01"
        assert any(s["issue"] == "TEST_Brake pads" for s in svc_mgr.get(f"{API}/vehicle-services?vehicle_id={veh['id']}", timeout=30).json())

    def test_sr_list_filters(self, admin):
        assert admin.get(f"{API}/service-requests", timeout=30).status_code == 200
        for it in admin.get(f"{API}/service-requests?status=new", timeout=30).json():
            assert it["status"] == "new"
        for it in admin.get(f"{API}/service-requests?priority=critical", timeout=30).json():
            assert it["priority"] == "critical"


# ---------- module: documents / incidents / locations / handovers ----------
class TestMisc:
    def test_documents(self, admin):
        docs = admin.get(f"{API}/documents", timeout=30).json()
        assert len(docs) > 0 and all("doc_status" in d for d in docs)
        for d in admin.get(f"{API}/documents?owner_type=driver", timeout=30).json():
            assert d["owner_type"] == "driver"
        for d in admin.get(f"{API}/documents?status=expired", timeout=30).json():
            assert d["doc_status"] == "expired"

        veh = admin.get(f"{API}/vehicles?page_size=1", timeout=30).json()["items"][0]
        created = admin.post(f"{API}/documents", json={"owner_type": "vehicle", "owner_id": veh["id"],
                                                       "owner_name": veh["vehicle_number"], "doc_type": "TEST_Insurance",
                                                       "city": veh["city"], "expiry_date": "2020-01-01"}, timeout=30)
        assert created.status_code == 200, created.text[:300]
        found = [d for d in admin.get(f"{API}/documents?owner_id={veh['id']}", timeout=30).json() if d["doc_type"] == "TEST_Insurance"]
        assert found and found[0]["doc_status"] == "expired"

    def test_incidents(self, admin):
        assert admin.get(f"{API}/incidents", timeout=30).status_code == 200
        veh = admin.get(f"{API}/vehicles?page_size=1", timeout=30).json()["items"][0]
        r = admin.post(f"{API}/incidents", json={"vehicle_id": veh["id"], "vehicle_number": veh["vehicle_number"],
                                                 "city": veh["city"], "incident_type": "TEST_Minor scratch",
                                                 "description": "TEST"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        inc = r.json()
        assert inc["code"].startswith("INC-") and inc["status"] == "reported"
        u = admin.put(f"{API}/incidents/{inc['id']}", json={"status": "resolved"}, timeout=30)
        assert u.status_code == 200 and u.json()["status"] == "resolved"
        assert all(i["status"] == "resolved" for i in admin.get(f"{API}/incidents?status=resolved", timeout=30).json())

    def test_locations(self, ops):
        locs = ops.get(f"{API}/locations", timeout=30).json()
        assert len(locs) > 0 and all("current_vehicles" in l for l in locs)
        r = ops.post(f"{API}/locations", json={"name": "TEST_Hub X", "city": "Coimbatore", "type": "parking",
                                              "capacity": 20, "address": "TEST"}, timeout=30)
        assert r.status_code == 200
        assert any(l["name"] == "TEST_Hub X" for l in ops.get(f"{API}/locations", timeout=30).json())

    def test_handovers_and_returns(self, ops):
        veh = ops.get(f"{API}/vehicles?page_size=1", timeout=30).json()["items"][0]
        h = ops.post(f"{API}/handovers", json={"vehicle_id": veh["id"], "vehicle_number": veh["vehicle_number"],
                                              "city": veh["city"], "odometer": 100, "notes": "TEST"}, timeout=30)
        assert h.status_code == 200, h.text[:300]
        assert any(x["vehicle_id"] == veh["id"] for x in ops.get(f"{API}/handovers?vehicle_id={veh['id']}", timeout=30).json())
        rt = ops.post(f"{API}/returns", json={"vehicle_id": veh["id"], "vehicle_number": veh["vehicle_number"],
                                             "city": veh["city"], "odometer": 150}, timeout=30)
        assert rt.status_code == 200
        assert ops.get(f"{API}/returns", timeout=30).status_code == 200


# ---------- module: permissions & city scoping ----------
class TestPermissions:
    def test_staff_cannot_create_vehicle(self, staff):
        r = staff.post(f"{API}/vehicles", json={"vehicle_number": "TEST-X", "registration_number": "TEST-X",
                                                "city": "Chennai"}, timeout=30)
        assert r.status_code == 403, f"{r.status_code} {r.text[:200]}"

    def test_staff_cannot_create_driver_or_plan(self, staff):
        assert staff.post(f"{API}/drivers", json={"name": "TEST_x", "phone": "1", "city": "Chennai"}, timeout=30).status_code == 403
        assert staff.post(f"{API}/rental-plans", json={"name": "TEST_x", "amount": 1, "duration_days": 1}, timeout=30).status_code == 403

    def test_service_manager_cannot_create_vehicle_but_can_service(self, svc_mgr):
        assert svc_mgr.post(f"{API}/vehicles", json={"vehicle_number": "TEST-Y", "registration_number": "TEST-Y",
                                                     "city": "Chennai"}, timeout=30).status_code == 403
        veh = svc_mgr.get(f"{API}/vehicles?page_size=1", timeout=30).json()["items"][0]
        r = svc_mgr.post(f"{API}/vehicle-services", json={"vehicle_id": veh["id"], "vehicle_number": veh["vehicle_number"],
                                                          "city": veh["city"], "issue": "TEST_svc perm", "cost": 100,
                                                          "start_date": "2026-07-01"}, timeout=30)
        assert r.status_code == 200, r.text[:300]

    def test_staff_cannot_create_vehicle_service(self, staff):
        veh = staff.get(f"{API}/vehicles?page_size=1", timeout=30).json()["items"][0]
        assert staff.post(f"{API}/vehicle-services", json={"vehicle_id": veh["id"], "issue": "TEST"}, timeout=30).status_code == 403

    def test_city_manager_scoped_to_chennai(self, city_mgr):
        vs = city_mgr.get(f"{API}/vehicles?page_size=200", timeout=30).json()
        assert vs["total"] > 0
        assert all(v["city"] == "Chennai" for v in vs["items"]), "city_manager sees non-Chennai vehicles"
        assert all(d["city"] == "Chennai" for d in city_mgr.get(f"{API}/drivers", timeout=30).json())
        assert all(r["city"] == "Chennai" for r in city_mgr.get(f"{API}/rentals", timeout=30).json())
        assert all(s["city"] == "Chennai" for s in city_mgr.get(f"{API}/service-requests", timeout=30).json())
        summary = city_mgr.get(f"{API}/dashboard/summary?city=all", timeout=30).json()
        assert len(summary["cities"]) == 1 and summary["cities"][0]["city"] == "Chennai"

    def test_city_manager_cannot_read_other_city_vehicle(self, admin, city_mgr):
        others = admin.get(f"{API}/vehicles?city=Bangalore&page_size=1", timeout=30).json()["items"]
        assert others, "no Bangalore vehicles seeded"
        r = city_mgr.get(f"{API}/vehicles/{others[0]['id']}", timeout=30)
        assert r.status_code == 404, f"leaked cross-city vehicle: {r.status_code}"

    def test_staff_cannot_list_users(self, staff, admin):
        assert staff.get(f"{API}/users", timeout=30).status_code == 403
        assert admin.get(f"{API}/users", timeout=30).status_code == 200
