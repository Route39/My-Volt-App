"""Seed realistic MyVolt demo data. Idempotent: only runs if the org has no vehicles."""
import os
import random
from datetime import datetime, timezone, timedelta
from bson import ObjectId

random.seed(39)

ORG_ID = "route39-org"

CITIES = ["Tiruppur", "Coimbatore", "Chennai", "Bangalore"]
CITY_CODE = {"Tiruppur": "TN 42", "Coimbatore": "TN 37", "Chennai": "TN 07", "Bangalore": "KA 05"}

# total, rented, available, service, inactive per city
CITY_PLAN = {
    "Tiruppur":   (68, 52, 9, 4, 3),
    "Coimbatore": (60, 46, 8, 3, 3),
    "Chennai":    (84, 66, 9, 5, 4),
    "Bangalore":  (66, 50, 8, 5, 3),
}

FIRST = ["Kumar", "Ravi", "Suresh", "Arun", "Vijay", "Karthik", "Prakash", "Manoj", "Deepak", "Ganesh",
         "Rahul", "Sanjay", "Ashok", "Naveen", "Vignesh", "Balaji", "Saravanan", "Mani", "Selvam", "Hari",
         "Dinesh", "Gopal", "Ramesh", "Anand", "Bharath", "Sathish", "Murugan", "Praveen", "Rajesh", "Vimal"]
LAST = ["Raj", "Kumar", "S", "M", "Krishnan", "Nair", "Reddy", "Iyer", "Menon", "Pillai", "Gowda", "Rao"]

VEHICLE_MODELS = ["Route39 Volt X1", "Route39 Volt E2", "Route39 Cargo EV", "Route39 Volt Pro"]
CHARGERS = ["3.3 kW Portable", "7.4 kW Fast", "3.3 kW Standard"]
BATTERY_CAPS = ["30 kWh", "40 kWh", "25 kWh"]

VEHICLE_IMG = "https://images.unsplash.com/photo-1587813369290-091c9d432daf?crop=entropy&cs=srgb&fm=jpg&w=1200&q=70"
AVATARS = [
    "https://images.unsplash.com/photo-1551825687-f9de1603ed8b?crop=entropy&cs=srgb&fm=jpg&w=200&q=70",
    "https://images.pexels.com/photos/6868173/pexels-photo-6868173.jpeg?auto=compress&w=200",
]

ISSUE_TYPES = ["Breakdown", "Battery", "Tyre", "Brake", "Electrical", "Charger", "Accident", "General", "Other"]
PRIORITIES = ["critical", "high", "medium", "low"]
SR_STAGES = ["new", "assigned", "inspection", "repair", "ready", "closed"]


def iso(dt):
    return dt.isoformat()


def now():
    return datetime.now(timezone.utc)


async def _seed_ev_rental(db, authlib):
    """MyEVRental demo data (daily EV auto rental) under Route39 org. Idempotent."""
    if await db.rental_packages.count_documents({"organization_id": ORG_ID}) > 0:
        return
    ist_today = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date()
    pkg_defs = [("Silver", 800), ("Gold", 900), ("Platinum", 1000)]
    pkg_ids = {}
    for name, rate in pkg_defs:
        pid = ObjectId()
        pkg_ids[name] = pid
        await db.rental_packages.insert_one({"_id": pid, "organization_id": ORG_ID, "name": name,
                                             "daily_rate": rate, "status": "active", "created_at": iso(now()), "demo": True})
    rate_of = dict(pkg_defs)

    def _pay(did, rid, rate, dstr):
        return {"_id": ObjectId(), "organization_id": ORG_ID, "driver_id": str(did), "rental_id": str(rid),
                "kind": "daily", "amount": rate, "covers_dates": [dstr], "payment_status": "paid",
                "payment_method": "seed", "transaction_id": f"SEED-{random.randint(100000, 999999)}",
                "gateway": "seed", "gateway_order_id": None, "gateway_ref": None,
                "paid_at": iso(now()), "created_at": iso(now()), "demo": True}

    async def mk(name, phone, reg, pkgname, start_ago, dep_status, unpaid_past, today_paid):
        rate = rate_of[pkgname]
        did = ObjectId()
        email = f"drv{''.join(ch for ch in phone if ch.isdigit())[-10:]}@ev.local"
        await db.users.insert_one({"_id": did, "name": name, "phone": phone, "email": email, "role": "driver",
                                   "password_hash": authlib.hash_password("Driver@2026"), "organization_id": ORG_ID,
                                   "vehicle_id": None, "vehicle_reg": reg, "demo": True, "created_at": iso(now())})
        start = ist_today - timedelta(days=start_ago)
        rid = ObjectId()
        await db.driver_rentals.insert_one({"_id": rid, "organization_id": ORG_ID, "driver_id": str(did),
                                            "driver_name": name, "driver_phone": phone, "vehicle_id": None, "vehicle_reg": reg,
                                            "package_id": str(pkg_ids[pkgname]), "package_name": pkgname, "daily_rate": rate,
                                            "start_date": start.isoformat(), "status": "active", "demo": True, "created_at": iso(now())})
        await db.security_deposits.insert_one({"_id": ObjectId(), "organization_id": ORG_ID, "driver_id": str(did),
                                               "amount": 5000, "status": dep_status,
                                               "transaction_id": (f"SEED-DEP-{random.randint(10000, 99999)}" if dep_status == "paid" else None),
                                               "paid_at": (iso(now()) if dep_status == "paid" else None), "demo": True, "created_at": iso(now())})
        past = [start + timedelta(days=i) for i in range((ist_today - start).days)]
        unpaid_dates = set(d.isoformat() for d in past[len(past) - unpaid_past:]) if unpaid_past > 0 else set()
        for d in past:
            if d.isoformat() in unpaid_dates:
                continue
            await db.rental_payments.insert_one(_pay(did, rid, rate, d.isoformat()))
        if today_paid:
            await db.rental_payments.insert_one(_pay(did, rid, rate, ist_today.isoformat()))

    # 1) Silver — today's rent paid, deposit paid → ACTIVE
    await mk("Raj Kumar", "+919000000001", "TN 07 AB 1001", "Silver", 5, "paid", 0, True)
    # 2) Gold — one overdue day, deposit paid → OVERDUE
    await mk("Suresh Menon", "+919000000002", "TN 07 CD 1002", "Gold", 3, "paid", 1, False)
    # 3) Platinum — two overdue days, deposit paid → BLOCKED
    await mk("Arjun Nair", "+919000000003", "TN 07 EF 1003", "Platinum", 4, "paid", 2, False)
    # 4) Deposit pending, fresh start → ACTIVE with deposit pending
    await mk("Vikram Reddy", "+919000000004", "TN 07 GH 1004", "Gold", 0, "pending", 0, False)



async def seed(db, authlib):
    await _seed_orgs(db, authlib)
    await _seed_users(db, authlib)
    await _seed_ev_rental(db, authlib)
    existing = await db.vehicles.count_documents({"organization_id": ORG_ID})
    if existing > 0:
        return

    n = now()
    vehicles, drivers, rentals, payments, assignments, srs, services, documents, incidents, locations, plans, audits, notifs = (
        [], [], [], [], [], [], [], [], [], [], [], [], [])

    # ---- rental plans ----
    plan_defs = [
        ("Daily Rental", 350, 1, 2000, 1, 100),
        ("Weekly Rental", 2100, 7, 3000, 2, 150),
        ("Monthly Rental", 8000, 30, 5000, 3, 200),
        ("Weekend Custom", 900, 3, 2500, 1, 120),
    ]
    plan_ids = {}
    for name, amt, dur, dep, grace, late in plan_defs:
        pid = ObjectId()
        plan_ids[name] = pid
        plans.append({"_id": pid, "organization_id": ORG_ID, "name": name, "amount": amt, "duration_days": dur,
                      "deposit": dep, "grace_period_days": grace, "late_fee": late, "cities": CITIES,
                      "vehicle_category": "EV", "terms": "Standard Route39 rental terms apply. Deposit refundable on return.",
                      "active": True, "created_at": iso(n), "demo": True})

    # ---- locations ----
    for c in CITIES:
        for i, nm in enumerate([f"{c} Central Hub", f"{c} North Depot"]):
            locations.append({"_id": ObjectId(), "organization_id": ORG_ID, "name": nm, "city": c,
                              "address": f"{100+i*23} Industrial Rd, {c}", "capacity": random.choice([40, 50, 60]),
                              "manager": f"{random.choice(FIRST)} {random.choice(LAST)}",
                              "contact": f"+91 9{random.randint(100000000, 999999999)}",
                              "status": "active", "created_at": iso(n), "demo": True})

    seq = 1000
    plan_names = list(plan_ids.keys())

    for city in CITIES:
        total, rented, available, service, inactive = CITY_PLAN[city]
        parkings = [l["name"] for l in locations if l["city"] == city]
        statuses = (["rented"] * rented + ["available"] * available + ["service"] * service + ["inactive"] * inactive)
        # pad idle if mismatch
        while len(statuses) < total:
            statuses.append("idle")
        statuses = statuses[:total]
        random.shuffle(statuses)

        for st in statuses:
            seq += 1
            vid = ObjectId()
            reg = f"{CITY_CODE[city]} {random.choice('ABCXYZ')}{random.choice('ABCXYZ')} {random.randint(1000,9999)}"
            batt = random.randint(35, 100) if st != "service" else random.randint(10, 55)
            bhealth = "Healthy" if batt > 40 else ("Fair" if batt > 20 else "Needs Check")
            next_svc = iso(n + timedelta(days=random.randint(-3, 40)))
            v = {"_id": vid, "organization_id": ORG_ID, "vehicle_number": f"EV-{seq}",
                 "registration_number": reg, "model": random.choice(VEHICLE_MODELS),
                 "manufacturing_year": random.choice([2022, 2023, 2024, 2025]),
                 "chassis_number": f"MB1{random.randint(100000000,999999999)}",
                 "battery_capacity": random.choice(BATTERY_CAPS), "charger": random.choice(CHARGERS),
                 "city": city, "parking": random.choice(parkings), "status": st,
                 "battery_percent": batt, "battery_health": bhealth,
                 "odometer": random.randint(2000, 48000), "image": VEHICLE_IMG,
                 "next_service_date": next_svc, "created_at": iso(n), "demo": True}

            if st == "rented":
                # create driver + rental
                did = ObjectId()
                dname = f"{random.choice(FIRST)} {random.choice(LAST)}"
                phone = f"+91 9{random.randint(100000000, 999999999)}"
                drivers.append({"_id": did, "organization_id": ORG_ID, "name": dname, "phone": phone,
                                "address": f"{random.randint(1,120)} Main St, {city}",
                                "emergency_contact": f"+91 9{random.randint(100000000,999999999)}",
                                "city": city, "status": "active", "avatar": random.choice(AVATARS),
                                "license_number": f"TN{random.randint(10,99)} {random.randint(10000000000000,99999999999999)}",
                                "current_vehicle_id": str(vid), "current_vehicle_number": f"EV-{seq}",
                                "rental_status": "active", "created_at": iso(n), "demo": True})
                v["current_driver_id"] = str(did)
                v["current_driver_name"] = dname

                rid = ObjectId()
                pname = random.choices(plan_names, weights=[3, 3, 4, 1])[0]
                plan = next(p for p in plans if p["name"] == pname)
                # decide rental timing profile
                roll = random.random()
                start = n - timedelta(days=random.randint(1, 25))
                if roll < 0.06:  # expiring today
                    end = n.replace(hour=20, minute=0)
                elif roll < 0.18:  # expiring soon (<36h)
                    end = n + timedelta(hours=random.randint(2, 34))
                else:
                    end = n + timedelta(days=random.randint(2, plan["duration_days"] + 20))
                amount = plan["amount"]
                deposit = plan["deposit"]
                total_due = amount + deposit
                # payment profile
                proll = random.random()
                if proll < 0.15:
                    paid = 0
                elif proll < 0.30:
                    paid = round(total_due * 0.5)
                else:
                    paid = total_due
                outstanding = max(total_due - paid, 0)
                pstatus = "paid" if outstanding <= 0 else ("partial" if paid > 0 else "pending")
                suspended = random.random() < 0.03
                rentals.append({"_id": rid, "organization_id": ORG_ID, "rental_code": f"RNT-{1000+len(rentals)+1}",
                                "driver_id": str(did), "driver_name": dname, "vehicle_id": str(vid),
                                "vehicle_number": f"EV-{seq}", "plan_id": str(plan["_id"]), "plan_name": pname,
                                "city": city, "start": iso(start), "end": iso(end), "amount": amount,
                                "deposit": deposit, "paid": paid, "outstanding": outstanding,
                                "payment_status": pstatus, "status": "suspended" if suspended else "active",
                                "notes": "", "renewal_history": [], "created_at": iso(start), "demo": True})
                v["current_rental_id"] = str(rid)
                v["current_rental_code"] = f"RNT-{1000+len(rentals)}"
                v["rental_end"] = iso(end)
                # assignment
                assignments.append({"_id": ObjectId(), "organization_id": ORG_ID, "driver_id": str(did),
                                    "driver_name": dname, "vehicle_id": str(vid), "vehicle_number": f"EV-{seq}",
                                    "city": city, "start": iso(start), "end": None,
                                    "notes": f"Via rental RNT-{1000+len(rentals)}", "created_at": iso(start), "demo": True})
                # payments
                if paid > 0:
                    payments.append({"_id": ObjectId(), "organization_id": ORG_ID, "rental_id": str(rid),
                                     "rental_code": f"RNT-{1000+len(rentals)}", "city": city, "type": "deposit",
                                     "amount": deposit, "method": "upi", "reference": f"UPI{random.randint(100000,999999)}",
                                     "payment_date": iso(start), "created_at": iso(start), "demo": True})
                    if paid > deposit:
                        payments.append({"_id": ObjectId(), "organization_id": ORG_ID, "rental_id": str(rid),
                                         "rental_code": f"RNT-{1000+len(rentals)}", "city": city, "type": "payment",
                                         "amount": paid - deposit, "method": random.choice(["cash", "upi", "card"]),
                                         "reference": f"TX{random.randint(100000,999999)}",
                                         "payment_date": iso(start + timedelta(hours=1)), "created_at": iso(start), "demo": True})

            vehicles.append(v)

    # ---- extra idle drivers (not renting) ----
    for _ in range(14):
        city = random.choice(CITIES)
        did = ObjectId()
        drivers.append({"_id": did, "organization_id": ORG_ID, "name": f"{random.choice(FIRST)} {random.choice(LAST)}",
                        "phone": f"+91 9{random.randint(100000000,999999999)}", "address": f"{random.randint(1,120)} Cross St, {city}",
                        "emergency_contact": f"+91 9{random.randint(100000000,999999999)}", "city": city,
                        "status": random.choice(["active", "active", "inactive"]), "avatar": random.choice(AVATARS),
                        "license_number": f"TN{random.randint(10,99)} {random.randint(10000000000000,99999999999999)}",
                        "rental_status": "none", "created_at": iso(n), "demo": True})

    # ---- service requests ----
    service_vehicles = [v for v in vehicles if v["status"] == "service"]
    for i, v in enumerate(service_vehicles):
        stage = random.choice(["new", "assigned", "inspection", "repair", "ready"])
        prio = random.choices(PRIORITIES, weights=[2, 3, 4, 2])[0]
        created = n - timedelta(days=random.randint(0, 8), hours=random.randint(0, 20))
        timeline = [{"stage": "new", "at": iso(created), "by": "Operations"}]
        idx = SR_STAGES.index(stage)
        for s in SR_STAGES[1:idx + 1]:
            timeline.append({"stage": s, "at": iso(created + timedelta(hours=random.randint(2, 40))), "by": "Service Team"})
        srs.append({"_id": ObjectId(), "organization_id": ORG_ID, "code": f"SR-{2000+i+1}",
                    "vehicle_id": str(v["_id"]), "vehicle_number": v["vehicle_number"],
                    "driver_id": v.get("current_driver_id"), "driver_name": v.get("current_driver_name", ""),
                    "issue_type": random.choice(ISSUE_TYPES), "priority": prio, "city": v["city"],
                    "source": random.choice(["Driver", "Operations", "Inspection", "Admin"]),
                    "description": "Reported issue requires inspection and repair.",
                    "assigned_to": random.choice(["", "Service Team A", "Ramesh (Tech)", "City Workshop"]),
                    "status": stage, "timeline": timeline, "photos": [],
                    "created_at": iso(created), "demo": True})

    # a couple of critical NEW ones on random rented vehicles
    for i in range(3):
        v = random.choice([x for x in vehicles if x["status"] == "rented"])
        created = n - timedelta(hours=random.randint(1, 20))
        srs.append({"_id": ObjectId(), "organization_id": ORG_ID, "code": f"SR-{2100+i}",
                    "vehicle_id": str(v["_id"]), "vehicle_number": v["vehicle_number"],
                    "driver_id": v.get("current_driver_id"), "driver_name": v.get("current_driver_name", ""),
                    "issue_type": random.choice(["Breakdown", "Accident", "Battery"]), "priority": "critical",
                    "city": v["city"], "source": "Driver", "description": "Urgent - vehicle immobilised on route.",
                    "assigned_to": "", "status": "new",
                    "timeline": [{"stage": "new", "at": iso(created), "by": "Driver"}],
                    "photos": [], "created_at": iso(created), "demo": True})

    # ---- historical vehicle services ----
    svc_issues = [("Brake Service", 2400), ("Battery Inspection", 800), ("General Service", 1250),
                  ("Tyre Replacement", 3200), ("Charger Repair", 1500), ("Motor Check", 1800)]
    for i in range(28):
        v = random.choice(vehicles)
        issue, cost = random.choice(svc_issues)
        start = n - timedelta(days=random.randint(5, 120))
        services.append({"_id": ObjectId(), "organization_id": ORG_ID, "vehicle_id": str(v["_id"]),
                         "vehicle_number": v["vehicle_number"], "city": v["city"],
                         "service_centre": f"{v['city']} Authorised Workshop", "technician": random.choice(FIRST),
                         "start_date": iso(start), "completion_date": iso(start + timedelta(days=random.randint(0, 3))),
                         "issue": issue, "work_performed": f"{issue} performed and quality checked.",
                         "parts": [{"name": "Consumables", "qty": 1, "cost": round(cost * 0.4)}],
                         "labour": round(cost * 0.3), "cost": cost, "warranty": random.choice(["3 months", "6 months", "None"]),
                         "next_service_date": iso(start + timedelta(days=90)), "notes": "", "photos": [],
                         "created_at": iso(start), "demo": True})

    # ---- documents (some valid, expiring, expired) ----
    doc_types_v = ["RC", "Insurance", "Permit", "Fitness", "Pollution", "Tax"]
    for v in random.sample(vehicles, min(40, len(vehicles))):
        for dt in random.sample(doc_types_v, 2):
            roll = random.random()
            if roll < 0.2:
                exp = n - timedelta(days=random.randint(1, 40))
            elif roll < 0.45:
                exp = n + timedelta(days=random.randint(1, 28))
            else:
                exp = n + timedelta(days=random.randint(60, 500))
            documents.append({"_id": ObjectId(), "organization_id": ORG_ID, "owner_type": "vehicle",
                              "owner_id": str(v["_id"]), "owner_label": v["vehicle_number"], "city": v["city"],
                              "doc_type": dt, "number": f"{dt[:3].upper()}{random.randint(100000,999999)}",
                              "expiry_date": exp.strftime("%Y-%m-%d"), "file": None, "created_at": iso(n), "demo": True})
    doc_types_d = ["Driving Licence", "ID Proof"]
    for d in random.sample(drivers, min(30, len(drivers))):
        for dt in doc_types_d:
            roll = random.random()
            if roll < 0.18:
                exp = n - timedelta(days=random.randint(1, 30))
            elif roll < 0.4:
                exp = n + timedelta(days=random.randint(1, 28))
            else:
                exp = n + timedelta(days=random.randint(60, 900))
            documents.append({"_id": ObjectId(), "organization_id": ORG_ID, "owner_type": "driver",
                              "owner_id": str(d["_id"]), "owner_label": d["name"], "city": d["city"],
                              "doc_type": dt, "number": f"{dt[:2].upper()}{random.randint(100000,999999)}",
                              "expiry_date": exp.strftime("%Y-%m-%d"), "file": None, "created_at": iso(n), "demo": True})

    # ---- incidents ----
    inc_types = ["Accident", "Vehicle Damage", "Driver Incident", "Theft", "Lost Equipment", "Other"]
    inc_status = ["reported", "investigation", "action", "resolved", "closed"]
    for i in range(9):
        v = random.choice(vehicles)
        created = n - timedelta(days=random.randint(0, 30))
        incidents.append({"_id": ObjectId(), "organization_id": ORG_ID, "code": f"INC-{3000+i+1}",
                          "vehicle_id": str(v["_id"]), "vehicle_number": v["vehicle_number"],
                          "driver_id": v.get("current_driver_id"), "driver_name": v.get("current_driver_name", ""),
                          "incident_type": random.choice(inc_types), "city": v["city"],
                          "location": f"{v['city']} - Sector {random.randint(1,9)}",
                          "description": "Incident reported and under review by operations.",
                          "police_info": "", "insurance_info": "", "estimated_damage": random.choice([0, 5000, 12000, 25000]),
                          "cost": 0, "status": random.choice(inc_status), "photos": [],
                          "created_at": iso(created), "demo": True})

    # ---- notifications ----
    notif_seed = [
        ("red", "Critical service request", "SR-2100 - Breakdown reported", "/service-requests"),
        ("amber", "Rental expiring tomorrow", "3 rentals expiring within 36 hours", "/rentals?status=expiring"),
        ("red", "Driver licence expired", "Some driver documents have expired", "/documents?status=expired"),
        ("amber", "Insurance expiring soon", "Vehicle documents expiring within 30 days", "/documents?status=expiring_soon"),
        ("green", "Service completed", "General service marked complete", "/vehicle-service"),
        ("blue", "Vehicle transferred", "A vehicle was moved between cities", "/fleet"),
    ]
    for lvl, title, msg, link in notif_seed:
        notifs.append({"_id": ObjectId(), "organization_id": ORG_ID, "level": lvl, "title": title,
                       "message": msg, "link": link, "city": None, "read": False,
                       "created_at": iso(n - timedelta(hours=random.randint(1, 40))), "demo": True})

    # ---- audit / recent operations ----
    audit_samples = [
        ("rental_activated", "rental", "Rental activated for a driver"),
        ("vehicle_assigned", "vehicle", "Vehicle assigned to driver"),
        ("service_request_created", "service_request", "Service request created"),
        ("service_completed", "vehicle_service", "Vehicle service completed"),
        ("vehicle_transferred", "vehicle", "Vehicle moved to Bangalore"),
        ("document_updated", "document", "Insurance document updated"),
        ("driver_assigned", "driver", "Driver assigned to vehicle"),
        ("payment_recorded", "rental", "Rental payment recorded"),
        ("rental_renewed", "rental", "Rental renewed"),
        ("incident_reported", "incident", "Incident reported"),
    ]
    for i in range(16):
        act, ent, summ = random.choice(audit_samples)
        audits.append({"_id": ObjectId(), "organization_id": ORG_ID, "actor_id": "system",
                       "actor_name": "Operations", "action": act, "entity_type": ent, "entity_id": None,
                       "summary": summ, "city": random.choice(CITIES),
                       "created_at": iso(n - timedelta(minutes=random.randint(5, 3000))), "demo": True})

    # ---- bulk insert ----
    async def ins(coll, arr):
        if arr:
            await db[coll].insert_many(arr)

    await ins("rental_plans", plans)
    await ins("locations", locations)
    await ins("vehicles", vehicles)
    await ins("drivers", drivers)
    await ins("rentals", rentals)
    await ins("rental_payments", payments)
    await ins("driver_vehicle_assignments", assignments)
    await ins("service_requests", srs)
    await ins("vehicle_services", services)
    await ins("documents", documents)
    await ins("incidents", incidents)
    await ins("notifications", notifs)
    await ins("audit_logs", audits)


async def _seed_users(db, authlib):
    admin_email = os.environ.get("ADMIN_EMAIL", "support@route39.in").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "Route39@2026")
    users = [
        (admin_email, admin_password, "Route39 Admin", "admin", None),
        ("ops@route39.in", "Route39@2026", "Ops Manager", "operations_manager", None),
        ("chennai@route39.in", "Route39@2026", "Chennai City Manager", "city_manager", "Chennai"),
        ("service@route39.in", "Route39@2026", "Service Manager", "service_manager", None),
        ("staff@route39.in", "Route39@2026", "Ops Staff", "staff", None),
    ]
    for email, pw, name, role, city in users:
        existing = await db.users.find_one({"email": email})
        doc = {"email": email, "password_hash": authlib.hash_password(pw), "name": name, "role": role,
               "city": city, "organization_id": ORG_ID, "created_at": datetime.now(timezone.utc).isoformat()}
        if existing is None:
            await db.users.insert_one(doc)
        elif not authlib.verify_password(pw, existing["password_hash"]):
            await db.users.update_one({"email": email}, {"$set": {"password_hash": authlib.hash_password(pw)}})


NAYARA_ORG = "nayara-org"


async def _seed_orgs(db, authlib):
    orgs = [
        {"org_id": ORG_ID, "name": "Route39", "industry": "fleet", "max_file_mb": 10, "code": "ROUTE39",
         "plan": "Professional", "status": "active", "contact_name": "Route39 Ops", "email": "support@route39.in",
         "phone": "+91 90000 00001", "created_at": iso(now() - timedelta(days=180)),
         "modules": ["dashboard", "fleet", "drivers", "rentals", "service", "locations", "documents", "incidents", "health", "reports", "settings"]},
        {"org_id": "platform", "name": "MyVolt Platform", "industry": "platform", "modules": [], "created_at": iso(now())},
    ]
    for o in orgs:
        await db.organizations.update_one({"org_id": o["org_id"]}, {"$set": o}, upsert=True)
    # platform admin user (idempotent)
    email = "platform@myvolt.app"; pw = "Platform@2026"
    existing = await db.users.find_one({"email": email})
    doc = {"email": email, "password_hash": authlib.hash_password(pw), "name": "Platform Admin",
           "role": "platform_admin", "city": None, "organization_id": "platform", "created_at": iso(now())}
    if existing is None:
        await db.users.insert_one(doc)
    elif not authlib.verify_password(pw, existing["password_hash"]):
        await db.users.update_one({"email": email}, {"$set": {"password_hash": authlib.hash_password(pw), "role": "platform_admin"}})


async def _seed_nayara(db, authlib):
    # users (idempotent)
    users = [
        ("admin@nayara.studio", "Nayara@2026", "Nayara Admin", "admin", None),
        ("nandhini@nayara.studio", "Nayara@2026", "Nandhini", "staff", None),
        ("priya@nayara.studio", "Nayara@2026", "Priya", "staff", None),
    ]
    for email, pw, name, role, city in users:
        existing = await db.users.find_one({"email": email})
        doc = {"email": email, "password_hash": authlib.hash_password(pw), "name": name, "role": role,
               "city": city, "organization_id": NAYARA_ORG, "created_at": iso(now())}
        if existing is None:
            await db.users.insert_one(doc)
        elif not authlib.verify_password(pw, existing["password_hash"]):
            await db.users.update_one({"email": email}, {"$set": {"password_hash": authlib.hash_password(pw)}})

    if await db.orders.count_documents({"organization_id": NAYARA_ORG}) > 0:
        return

    n = now()
    cust_defs = ["ABC Boutique", "Meera Textiles", "Silk Route Retail", "Priya Fashions", "Kovai Garments", "Chennai Silks Co"]
    customers = []
    for nm in cust_defs:
        cid = ObjectId()
        customers.append({"_id": cid, "organization_id": NAYARA_ORG, "name": nm,
                          "phone": f"+91 9{random.randint(100000000,999999999)}",
                          "whatsapp": f"+91 9{random.randint(100000000,999999999)}",
                          "email": nm.lower().replace(' ', '') + "@example.com", "company": nm,
                          "address": f"{random.randint(1,90)} Market St, Tiruppur", "notes": "", "created_at": iso(n), "demo": True})
    await db.customers.insert_many(customers)

    products = ["Floral Cotton Fabric", "Silk Chiffon", "Cotton Poplin", "Linen Blend", "Georgette Print", "Denim Roll", "Rayon Print", "Kora Silk"]
    assignees = ["Nandhini", "Priya", "Arjun"]
    statuses = (["received"] * 6 + ["processing"] * 7 + ["on_hold"] * 3 + ["completed"] * 8)
    random.shuffle(statuses)
    pays = ["paid", "partial", "pending"]
    orders = []
    audits = []
    for i, st in enumerate(statuses):
        cust = random.choice(customers)
        order_date = n - timedelta(days=random.randint(0, 30))
        # due date profiles
        roll = random.random()
        if st == "completed":
            due = order_date + timedelta(days=random.randint(3, 15))
        elif roll < 0.18:
            due = n - timedelta(days=random.randint(1, 6))       # overdue
        elif roll < 0.4:
            due = n + timedelta(days=random.randint(0, 2))       # due soon
        else:
            due = n + timedelta(days=random.randint(4, 25))      # on track
        total = random.choice([5000, 8000, 12000, 15000, 22000])
        pay = random.choice(pays)
        paid = total if pay == "paid" else (round(total * 0.5) if pay == "partial" else 0)
        code = f"ORD-{1000 + i + 1}"
        assignee = random.choice(assignees) if st != "received" or random.random() > 0.4 else ""
        timeline = [{"at": iso(order_date), "by": "Nayara Admin", "text": "Order created"}]
        if assignee:
            timeline.append({"at": iso(order_date + timedelta(hours=1)), "by": "Nayara Admin", "text": f"Assigned to {assignee}"})
        if st in ("processing", "on_hold", "completed"):
            timeline.append({"at": iso(order_date + timedelta(hours=6)), "by": assignee or "Nayara Admin", "text": "Moved to Processing"})
        if st == "on_hold":
            timeline.append({"at": iso(order_date + timedelta(days=1)), "by": assignee or "Nayara Admin", "text": "Moved to On Hold"})
        if st == "completed":
            timeline.append({"at": iso(due), "by": assignee or "Nayara Admin", "text": "Order completed"})
        orders.append({"_id": ObjectId(), "organization_id": NAYARA_ORG, "order_number": code,
                       "customer_id": str(cust["_id"]), "customer_name": cust["name"], "customer_phone": cust["phone"],
                       "order_date": iso(order_date), "due_date": iso(due), "product": random.choice(products),
                       "quantity": random.choice([25, 50, 75, 100, 120, 200]), "unit": "metres",
                       "priority": random.choices(["low", "medium", "high", "urgent"], weights=[2, 4, 3, 1])[0],
                       "assigned_to": assignee, "payment_status": pay, "total_amount": total, "paid_amount": paid,
                       "balance": max(total - paid, 0), "status": st, "notes": random.choice(["", "Customer requested slight colour adjustment.", "Deliver before Friday.", "Use attached reference image."]),
                       "attachments": [], "timeline": timeline, "created_at": iso(order_date), "demo": True})
        audits.append({"_id": ObjectId(), "organization_id": NAYARA_ORG, "actor_id": "system", "actor_name": assignee or "Nayara Admin",
                       "action": "order_created", "entity_type": "order", "entity_id": None,
                       "summary": f"Order {code} created for {cust['name']}", "city": None,
                       "created_at": iso(order_date), "demo": True})
    await db.orders.insert_many(orders)
    await db.audit_logs.insert_many(audits)
