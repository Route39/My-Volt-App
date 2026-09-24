from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import asyncio
import logging
import re
import json
import secrets
import razorpay
from datetime import datetime, timezone, timedelta, date
from typing import Optional, List
import requests
import random

from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends, Query, File, UploadFile, Form
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from bson import ObjectId

import auth as authlib
import seed as seedlib

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="MyVolt API")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[
        "http://localhost",
        "capacitor://localhost",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://0.0.0.0:3000",
        "https://localhost:3000",
        "https://myvolt.attendy.in",
        "http://myvolt.attendy.in",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

if not os.path.exists("uploads"):
    os.makedirs("uploads")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/api/uploads", StaticFiles(directory="uploads"), name="api_uploads")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("myvolt")

CITIES = ["Tiruppur", "Coimbatore", "Chennai", "Bangalore"]


# ---------- helpers ----------
def now_iso():
    return datetime.now(timezone.utc).isoformat()


def ser(doc):
    """Serialize a mongo doc: _id -> id (str)."""
    if doc is None:
        return None
    doc = dict(doc)
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    doc.pop("password_hash", None)
    return doc


def oid(id_str):
    try:
        return ObjectId(id_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id")


async def get_user(request: Request):
    return await authlib.current_user_from_request(request, db)


def org_filter(user: dict, extra: dict = None):
    f = {"organization_id": user.get("organization_id")}
    # City managers are restricted to their assigned city
    if user.get("role") == "city_manager" and user.get("city"):
        f["city"] = user["city"]
    if extra:
        f.update(extra)
    return f


def require_role(user, allowed):
    if user.get("role") in ("admin", "company_admin"):
        return
    if user.get("role") not in allowed:
        raise HTTPException(status_code=403, detail="You do not have permission for this action")


async def log_audit(user, action, entity_type, entity_id=None, summary=""):
    await db.audit_logs.insert_one({
        "organization_id": user["organization_id"],
        "actor_id": user["id"],
        "actor_name": user.get("name", ""),
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "summary": summary,
        "city": user.get("city"),
        "created_at": now_iso(),
    })


async def add_notification(org_id, level, title, message, link=None, city=None):
    await db.notifications.insert_one({
        "organization_id": org_id,
        "level": level,  # red/amber/green/blue
        "title": title,
        "message": message,
        "link": link,
        "city": city,
        "read": False,
        "created_at": now_iso(),
    })


# ---------- auth models ----------
class LoginBody(BaseModel):
    email: str
    password: str


class RegisterBody(BaseModel):
    email: str
    password: str
    name: str
    phone: str
    role: str = "staff"
    city: Optional[str] = None

class UpdateUserBody(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    city: Optional[str] = None
    password: Optional[str] = None


IS_PROD = os.getenv("ENV", "development") == "production"

def set_auth_cookies(response: Response, uid, email):
    at = authlib.create_access_token(uid, email)
    rt = authlib.create_refresh_token(uid)
    response.set_cookie("access_token", at, httponly=True, secure=IS_PROD, samesite="lax" if not IS_PROD else "none", max_age=315360000, path="/")
    response.set_cookie("refresh_token", rt, httponly=True, secure=IS_PROD, samesite="lax" if not IS_PROD else "none", max_age=315360000, path="/")
    return at

def set_driver_auth_cookies(response: Response, uid, phone):
    at = authlib.create_access_token(uid, phone)
    rt = authlib.create_refresh_token(uid)
    response.set_cookie("driver_access_token", at, httponly=True, secure=IS_PROD, samesite="lax" if not IS_PROD else "none", max_age=315360000, path="/")
    response.set_cookie("driver_refresh_token", rt, httponly=True, secure=IS_PROD, samesite="lax" if not IS_PROD else "none", max_age=315360000, path="/")
    return at


async def _check_lockout(identifier):
    rec = await db.login_attempts.find_one({"identifier": identifier})
    if rec and rec.get("count", 0) >= 5 and rec.get("locked_until"):
        try:
            if datetime.fromisoformat(rec["locked_until"]) > datetime.now(timezone.utc):
                raise HTTPException(status_code=429, detail="Too many failed attempts. Please try again in a few minutes.")
        except HTTPException:
            raise
        except Exception:
            pass


@api.post("/auth/login")
async def login(body: LoginBody, response: Response):
    raw_id = body.email.strip()
    email = f"{raw_id}@myvolt.local" if raw_id.isdigit() else raw_id.lower()
    identifier = email
    await _check_lockout(email)
    user = await db.users.find_one({"email": email})
    if not user or not authlib.verify_password(body.password, user["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1}, "$set": {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}},
            upsert=True)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    await db.login_attempts.delete_one({"identifier": identifier})
    org_id = user.get("organization_id")
    if org_id:
        org = await db.organizations.find_one({"org_id": org_id})
        if org and org.get("archived"):
            raise HTTPException(status_code=403, detail="This workspace is no longer active. Please contact your administrator.")
    token = set_auth_cookies(response, str(user["_id"]), identifier)
    out = ser(user)
    out = await attach_org(out)
    out["token"] = token
    return out


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


async def attach_org(user):
    org_id = user.get("organization_id")
    org = await db.organizations.find_one({"org_id": org_id}) if org_id else None
    user["industry"] = (org or {}).get("industry", "fleet")
    user["org_name"] = (org or {}).get("name", "Route39")
    user["modules"] = (org or {}).get("modules", [])
    user["max_file_mb"] = (org or {}).get("max_file_mb", 10)
    return user


@api.get("/auth/me")
async def me(request: Request):
    user = await get_user(request)
    return await attach_org(user)


@api.post("/auth/refresh")
async def refresh(request: Request, response: Response):
    rt = request.cookies.get("refresh_token")
    if not rt:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = authlib.decode_token(rt)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    set_auth_cookies(response, str(user["_id"]), user["email"])
    return {"ok": True}


@api.get("/users")
async def list_users(request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    users = await db.users.find({"organization_id": user["organization_id"]}).to_list(500)
    return [ser(u) for u in users]


@api.post("/users")
async def create_user(body: RegisterBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin"])
    
    raw_email = body.email.strip()
    email = f"{raw_email}@myvolt.local" if raw_email.isdigit() else raw_email.lower()
    
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Username/Email already exists")
    doc = {
        "email": email,
        "phone": body.phone,
        "password_hash": authlib.hash_password(body.password),
        "name": body.name,
        "role": body.role if body.role in authlib.ROLES else "staff",
        "city": body.city,
        "organization_id": user["organization_id"],
        "created_at": now_iso(),
    }
    res = await db.users.insert_one(doc)
    await log_audit(user, "user_created", "user", str(res.inserted_id), f"User {body.name} created")
    return ser(await db.users.find_one({"_id": res.inserted_id}))


@api.put("/users/{uid}")
async def update_user(uid: str, body: UpdateUserBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin"])
    
    update_data = {}
    if body.name is not None: update_data["name"] = body.name
    if body.phone is not None: update_data["phone"] = body.phone
    if body.email is not None: 
        raw_email = body.email.strip()
        email = f"{raw_email}@myvolt.local" if raw_email.isdigit() else raw_email.lower()
        existing = await db.users.find_one({"email": email, "_id": {"$ne": oid(uid)}})
        if existing: raise HTTPException(status_code=400, detail="Email already exists")
        update_data["email"] = email
    if body.role is not None: update_data["role"] = body.role if body.role in authlib.ROLES else "staff"
    
    if body.city is not None:
        update_data["city"] = body.city

    if body.password:
        update_data["password_hash"] = authlib.hash_password(body.password)
        
    if update_data:
        res = await db.users.update_one(org_filter(user, {"_id": oid(uid)}), {"$set": update_data})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
        await log_audit(user, "user_updated", "user", uid, f"User {uid} updated")
    return {"ok": True}


@api.delete("/users/{uid}")
async def delete_user(uid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin"])
    if str(user["id"]) == uid:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    res = await db.users.delete_one(org_filter(user, {"_id": oid(uid)}))
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await log_audit(user, "user_deleted", "user", uid, f"User {uid} deleted")
    return {"ok": True}


# ---------- package password ----------
class PackagePasswordBody(BaseModel):
    password: str

@api.get("/settings/package-password")
async def get_package_password_status(request: Request):
    user = await get_user(request)
    require_role(user, ["admin"])
    org = await db.organizations.find_one({"org_id": user["organization_id"]})
    return {"has_password": bool(org and org.get("package_password"))}

@api.post("/settings/package-password")
async def set_package_password(body: PackagePasswordBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin"])
    await db.organizations.update_one(
        {"org_id": user["organization_id"]},
        {"$set": {"package_password": body.password}},
        upsert=True
    )
    return {"ok": True}

@api.post("/settings/package-password/verify")
async def verify_package_password(body: PackagePasswordBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    org = await db.organizations.find_one({"org_id": user["organization_id"]})
    stored = org.get("package_password") if org else None
    if not stored:
        return {"ok": True}  # No password set, allow access
    if stored != body.password:
        raise HTTPException(status_code=401, detail="Wrong password")
    return {"ok": True}


# ---------- cities ----------
@api.get("/cities")
async def get_cities(request: Request):
    user = await get_user(request)
    return CITIES


# ---------- generic helper ----------
async def _find(collection, user, extra=None, sort=None, limit=1000):
    cur = db[collection].find(org_filter(user, extra))
    if sort:
        cur = cur.sort(sort[0], sort[1])
    docs = await cur.to_list(limit)
    return [ser(d) for d in docs]


# ---------- vehicles ----------
class VehicleBody(BaseModel):
    vehicle_number: str
    registration_number: Optional[str] = None
    model: str = "Route39 EV"
    manufacturing_year: Optional[int] = None
    chassis_number: Optional[str] = None
    battery_capacity: Optional[str] = None
    charger: Optional[str] = None
    city: str
    parking: Optional[str] = None
    status: str = "available"
    battery_percent: int = 100
    battery_health: str = "Healthy"
    odometer: int = 0
    image: Optional[str] = None
    next_service_date: Optional[str] = None


@api.get("/vehicles")
async def list_vehicles(request: Request, status: Optional[str] = None, city: Optional[str] = None,
                        q: Optional[str] = None, page: int = 1, page_size: int = 60):
    user = await get_user(request)
    extra = {}
    if status:
        extra["status"] = status
    if city and city != "all":
        extra["city"] = city
    filt = org_filter(user, extra)
    if q:
        filt["$or"] = [
            {"vehicle_number": {"$regex": q, "$options": "i"}},
            {"registration_number": {"$regex": q, "$options": "i"}},
            {"current_driver_name": {"$regex": q, "$options": "i"}},
            {"city": {"$regex": q, "$options": "i"}},
        ]
    total = await db.vehicles.count_documents(filt)
    cur = db.vehicles.find(filt).sort("vehicle_number", 1).skip((page - 1) * page_size).limit(page_size)
    docs = await cur.to_list(page_size)
    return {"items": [ser(d) for d in docs], "total": total, "page": page, "page_size": page_size}


@api.get("/vehicles/next-number")
async def get_next_vehicle_number(request: Request, city: str):
    user = await get_user(request)
    prefix_map = {
        "Coimbatore": "CBE",
        "Tiruppur": "TUP",
        "Chennai": "CHN",
        "Bangalore": "BAN"
    }
    prefix = prefix_map.get(city, city[:3].upper())
    
    # Count how many vehicles start with this prefix in this org
    count = await db.vehicles.count_documents(org_filter(user, {"vehicle_number": {"$regex": f"^{prefix}"}}))
    next_num = count + 1
    return {"vehicle_number": f"{prefix}{next_num:03d}"}


@api.get("/vehicles/{vid}")
async def get_vehicle(vid: str, request: Request):
    user = await get_user(request)
    v = await db.vehicles.find_one(org_filter(user, {"_id": oid(vid)}))
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    out = ser(v)
    out["assignments"] = [ser(a) for a in await db.driver_vehicle_assignments.find({"vehicle_id": vid}).sort("start", -1).to_list(100)]
    out["services"] = [ser(s) for s in await db.vehicle_services.find({"vehicle_id": vid}).sort("start_date", -1).to_list(100)]
    out["documents"] = [ser(x) for x in await db.documents.find({"owner_type": "vehicle", "owner_id": vid}).to_list(100)]
    out["incidents"] = [ser(i) for i in await db.incidents.find({"vehicle_id": vid}).sort("created_at", -1).to_list(100)]
    out["service_requests"] = [ser(x) for x in await db.service_requests.find({"vehicle_id": vid}).sort("created_at", -1).to_list(100)]
    if out.get("current_rental_id"):
        out["current_rental"] = ser(await db.rentals.find_one({"_id": oid(out["current_rental_id"])}))
    return out



@api.post("/vehicles")
async def create_vehicle(body: VehicleBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    doc = body.model_dump()
    doc["organization_id"] = user["organization_id"]
    doc["created_at"] = now_iso()
    res = await db.vehicles.insert_one(doc)
    await log_audit(user, "vehicle_created", "vehicle", str(res.inserted_id), f"Vehicle {body.vehicle_number} added")
    return ser(await db.vehicles.find_one({"_id": res.inserted_id}))


@api.put("/vehicles/{vid}")
async def update_vehicle(vid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    for k in ("id", "_id", "assignments", "services", "documents", "incidents", "service_requests", "current_rental"):
        body.pop(k, None)
    await db.vehicles.update_one(org_filter(user, {"_id": oid(vid)}), {"$set": body})
    await log_audit(user, "vehicle_updated", "vehicle", vid, "Vehicle updated")
    return ser(await db.vehicles.find_one({"_id": oid(vid)}))

@api.delete("/vehicles/{vid}")
async def delete_vehicle(vid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    org = user["organization_id"]
    
    veh = await db.vehicles.find_one(org_filter(user, {"_id": oid(vid)}))
    if not veh: raise HTTPException(404, "Vehicle not found")
    
    if veh.get("current_driver_id"):
        await db.drivers.update_one(
            {"_id": oid(veh["current_driver_id"])},
            {"$set": {"current_vehicle_id": None, "current_vehicle_number": None, "rental_status": "inactive"}}
        )
    
    await db.vehicles.delete_one({"_id": oid(vid)})
    await db.rentals.delete_many({"organization_id": org, "vehicle_id": vid})
    await db.driver_vehicle_assignments.delete_many({"organization_id": org, "vehicle_id": vid})
    await db.vehicle_incidents.delete_many({"organization_id": org, "vehicle_id": vid})
    await db.vehicle_services.delete_many({"organization_id": org, "vehicle_id": vid})
    
    await log_audit(user, "vehicle_deleted", "vehicle", vid, "Vehicle deleted")
    return {"ok": True}


@api.post("/vehicles/{vid}/transfer")
async def transfer_vehicle(vid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    v = await db.vehicles.find_one(org_filter(user, {"_id": oid(vid)}))
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    to_city = body.get("to_city")
    from_city = v["city"]
    await db.vehicles.update_one({"_id": oid(vid)}, {"$set": {"city": to_city, "parking": body.get("parking")}})
    await db.vehicle_transfers.insert_one({
        "organization_id": user["organization_id"], "vehicle_id": vid, "vehicle_number": v["vehicle_number"],
        "from_city": from_city, "to_city": to_city, "reason": body.get("reason", ""),
        "notes": body.get("notes", ""), "status": "completed", "created_at": now_iso()})
    await db.audit_logs.insert_one({
        "organization_id": user["organization_id"], "actor_id": user["id"], "actor_name": user.get("name"),
        "action": "vehicle_transferred", "entity_type": "vehicle", "entity_id": vid,
        "summary": f"Vehicle {v['vehicle_number']} moved {from_city} to {to_city}",
        "city": to_city, "created_at": now_iso(),
    })
    await add_notification(user["organization_id"], "blue", "Vehicle transferred",
                           f"{v['vehicle_number']} moved to {to_city}", link=f"/fleet/{vid}", city=to_city)
    return ser(await db.vehicles.find_one({"_id": oid(vid)}))


# ---------- drivers ----------
class DriverBody(BaseModel):
    name: str
    phone: str
    address: str
    emergency_contact: str
    city: str
    status: str = "active"
    avatar: Optional[str] = None
    license_number: str
    package_name: Optional[str] = None
    package_rate: Optional[int] = None


@api.get("/admin/kyc/pending")
async def pending_kyc(request: Request, city: Optional[str] = None, driver_name: Optional[str] = None):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    
    drv_filter = {"kyc_status": "submitted"}
    if city and city != "all":
        drv_filter["city"] = city
    if driver_name:
        drv_filter["name"] = {"$regex": driver_name, "$options": "i"}
        
    return await _find("drivers", user, extra=drv_filter)


@api.get("/admin/odometer")
async def get_odometer_logs(request: Request, city: Optional[str] = None, from_date: Optional[str] = None, to_date: Optional[str] = None, driver_name: Optional[str] = None):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    
    # Get all drivers for this org first
    drv_filter = {"organization_id": user["organization_id"]}
    if city and city != "all":
        drv_filter["city"] = city
    if driver_name:
        drv_filter["name"] = {"$regex": driver_name, "$options": "i"}
        
    org_drivers = await db.drivers.find(drv_filter).to_list(1000)
    driver_ids = [str(d["_id"]) for d in org_drivers]
    driver_map = {str(d["_id"]): d for d in org_drivers}
    
    # Fetch logs for those drivers
    log_filter = {"driver_id": {"$in": driver_ids}}
    
    if from_date or to_date:
        date_query = {}
        if from_date:
            date_query["$gte"] = from_date
        if to_date:
            date_query["$lte"] = to_date
        if date_query:
            log_filter["date"] = date_query
            
    logs = await db.driver_odometer_logs.find(log_filter).sort("created_at", -1).limit(500).to_list(500)
    
    # Fetch all rental plans to map limits
    plans = await db.rental_plans.find({}).to_list(100)
    plan_limits = {f"{p.get('city', '')}_{p['name']}".lower(): p.get("monthly_km_limit", 0) for p in plans}
    
    out = []
    for log in logs:
        log["_id"] = str(log["_id"])
        drv = driver_map.get(log["driver_id"])
        log["driver_name"] = drv.get("name") if drv else "Unknown"
        log["driver_city"] = drv.get("city") if drv else ""
        log["driver_avatar"] = drv.get("avatar") if drv else None
        log["monthly_kms"] = drv.get("current_month_kms", 0) if drv else 0
        pkg_name = (drv.get("package_name") or "") if drv else ""
        drv_city = (drv.get("city") or "").lower() if drv else ""
        log["limit_kms"] = plan_limits.get(f"{drv_city}_{pkg_name.lower()}", 0) if drv else 0
        log["package_name"] = pkg_name
        
        # Look up full plan details for this driver
        plan = None
        for p in plans:
            if (p.get("name", "").lower() == pkg_name.lower() and 
                p.get("city", "").lower() == drv_city):
                plan = p
                break
        
        import calendar
        now_dt = datetime.now()
        days_in_month = calendar.monthrange(now_dt.year, now_dt.month)[1]
        
        if "snapshot_daily_rent" in log:
            pkg_name = log.get("snapshot_package_name", pkg_name)
            log["package_name"] = pkg_name
            log["limit_kms"] = log.get("snapshot_monthly_limit", log["limit_kms"])
            daily_limit = log.get("snapshot_daily_limit", 0)
            overage_per_km = log.get("snapshot_overage_per_km", 0.0)
            daily_rent = log.get("snapshot_daily_rent", 0)
        else:
            if plan:
                monthly_limit = plan.get("monthly_km_limit", 0)
                daily_limit = round(monthly_limit / days_in_month) if days_in_month else 0
                overage_per_km = plan.get("overage_per_km", 0.0)
                daily_rent = plan.get("amount", drv.get("package_rate", 0) if drv else 0)
            else:
                monthly_limit = 0
                daily_limit = 0
                overage_per_km = 0.0
                daily_rent = drv.get("package_rate", 0) if drv else 0
            
            # Freeze the snapshot into the DB so old logs don't drift on package updates
            await db.driver_odometer_logs.update_one(
                {"_id": ObjectId(log["_id"])},
                {"$set": {
                    "snapshot_daily_rent": daily_rent,
                    "snapshot_package_name": pkg_name,
                    "snapshot_daily_limit": daily_limit,
                    "snapshot_overage_per_km": overage_per_km,
                    "snapshot_monthly_limit": monthly_limit
                }}
            )
        
        driven_today = log.get("driven_today", 0) or 0
        extra_km = max(0, driven_today - daily_limit) if daily_limit > 0 else 0
        extra_km_charge = round(extra_km * overage_per_km, 2)
        
        log["daily_limit_km"] = daily_limit
        log["daily_rent"] = daily_rent
        log["overage_per_km"] = overage_per_km
        log["extra_km"] = extra_km
        log["extra_km_charge"] = extra_km_charge
        out.append(log)
    return {"logs": out}


@api.post("/admin/kyc/{driver_id}/{action}")
async def review_kyc(driver_id: str, action: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    
    if action not in ["approve", "reject"]:
        raise HTTPException(status_code=400, detail="Invalid action")
        
    update_doc = {"$set": {"kyc_status": "approved" if action == "approve" else "rejected", "kyc_reviewed_at": now_iso()}}
    if action == "reject":
        update_doc["$unset"] = {"kyc_documents": "", "location": ""}

    res = await db.drivers.update_one(
        org_filter(user, {"_id": oid(driver_id)}),
        update_doc
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    await log_audit(user, f"kyc_{action}d", "driver", driver_id, f"KYC {action}d")
    return {"ok": True}


@api.get("/drivers")
async def list_drivers(request: Request, city: Optional[str] = None, status: Optional[str] = None, unassigned: Optional[bool] = None, q: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if city and city != "all":
        extra["city"] = city
    if status:
        extra["status"] = status
    if unassigned:
        extra["rental_status"] = {"$ne": "active"}
    filt = org_filter(user, extra)
    if q:
        filt["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
            {"current_vehicle_number": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.drivers.find(filt).sort("name", 1).to_list(1000)
    for d in docs:
        cv_id = d.get("current_vehicle_id")
        if cv_id:
            try:
                v = await db.vehicles.find_one({"_id": oid(cv_id)})
                if v:
                    d["current_vehicle_reg"] = v.get("registration_number")
            except Exception:
                pass
    return [ser(d) for d in docs]


@api.get("/drivers/{did}")
async def get_driver(did: str, request: Request):
    user = await get_user(request)
    d = await db.drivers.find_one(org_filter(user, {"_id": oid(did)}))
    if not d:
        raise HTTPException(status_code=404, detail="Driver not found")
    out = ser(d)
    out["assignments"] = [ser(a) for a in await db.driver_vehicle_assignments.find(
        {"driver_id": did}).sort("start", -1).to_list(100)]
    out["rentals"] = [ser(r) for r in await db.rentals.find({"driver_id": did}).sort("created_at", -1).to_list(100)]
    out["incidents"] = [ser(i) for i in await db.incidents.find({"driver_id": did}).sort("created_at", -1).to_list(100)]
    out["documents"] = [ser(x) for x in await db.documents.find({"owner_type": "driver", "owner_id": did}).to_list(100)]
    return out


@api.delete("/drivers/{did}")
async def delete_driver(did: str, request: Request, force: bool = False):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    
    # Find driver by org only (not city-restricted) so any city manager in the org can delete
    drv = await db.drivers.find_one({"_id": oid(did), "organization_id": user["organization_id"]})
    if not drv:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    org = user["organization_id"]
    
    # Check for unpaid balance unless force delete
    if not force:
        account = await db.rental_accounts.find_one({"organization_id": org, "driver_id": did})
        if account and account.get("balance", 0) > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Driver has unpaid balance of ₹{account.get('balance', 0)}. Use force delete to proceed."
            )
    
    # 1. Delete driver document
    await db.drivers.delete_one({"_id": oid(did)})
    
    # 2. Delete driver from users if exists
    await db.users.delete_many({"phone": drv.get("phone"), "role": "driver"})
    
    # 3. Unassign any vehicles currently assigned to this driver
    await db.vehicles.update_many(
        {"organization_id": org, "current_driver_id": did},
        {"$set": {"status": "available", "current_driver_id": None, "current_rental_id": None}}
    )
    
    # 4. Delete all rentals, payments, accounts, deposits, assignments, logs, incidents
    await db.rentals.delete_many({"organization_id": org, "driver_id": did})
    await db.driver_rentals.delete_many({"driver_id": did})
    await db.rental_payments.delete_many({"organization_id": org, "driver_id": did})
    await db.rental_accounts.delete_many({"organization_id": org, "driver_id": did})
    await db.security_deposits.delete_many({"organization_id": org, "driver_id": did})
    await db.driver_vehicle_assignments.delete_many({"organization_id": org, "driver_id": did})
    await db.driver_odometer_logs.delete_many({"organization_id": org, "driver_id": did})
    await db.incidents.delete_many({"organization_id": org, "driver_id": did})
    
    # 5. Delete driver documents
    await db.documents.delete_many({"organization_id": org, "owner_type": "driver", "owner_id": did})
    
    await log_audit(user, "driver_deleted", "driver", did, f"Driver {drv.get('name')} and all associated data completely deleted")
    return {"ok": True}


@api.post("/drivers")
async def create_driver(body: DriverBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    doc = body.model_dump()
    doc["organization_id"] = user.get("organization_id", "route39-org")
    doc["created_at"] = now_iso()
    res = await db.drivers.insert_one(doc)
    await log_audit(user, "driver_created", "driver", str(res.inserted_id), f"Driver {body.name} added")
    return ser(await db.drivers.find_one({"_id": res.inserted_id}))


@api.put("/drivers/{did}")
async def update_driver(did: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    for k in ("id", "_id", "assignments", "rentals", "incidents", "documents"):
        body.pop(k, None)
    res = await db.drivers.update_one({"_id": oid(did), "organization_id": user["organization_id"]}, {"$set": body})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    return ser(await db.drivers.find_one({"_id": oid(did)}))


@api.post("/drivers/{did}/assign-vehicle")
async def assign_vehicle(did: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    driver = await db.drivers.find_one(org_filter(user, {"_id": oid(did)}))
    vehicle = await db.vehicles.find_one(org_filter(user, {"_id": oid(body["vehicle_id"])}))
    if not driver or not vehicle:
        raise HTTPException(status_code=404, detail="Driver or vehicle not found")
    await db.driver_vehicle_assignments.update_many(
        {"driver_id": did, "end": None}, {"$set": {"end": now_iso()}})
    assignment = {
        "organization_id": user["organization_id"],
        "driver_id": did, "driver_name": driver["name"],
        "vehicle_id": body["vehicle_id"], "vehicle_number": vehicle["vehicle_number"],
        "city": vehicle["city"], "start": now_iso(), "end": None,
        "notes": body.get("notes", ""), "created_at": now_iso(),
    }
    await db.driver_vehicle_assignments.insert_one(assignment)
    await db.drivers.update_one({"_id": oid(did)}, {"$set": {
        "current_vehicle_id": body["vehicle_id"], "current_vehicle_number": vehicle["vehicle_number"]}})
    await db.vehicles.update_one({"_id": oid(body["vehicle_id"])}, {"$set": {
        "current_driver_id": did, "current_driver_name": driver["name"]}})
    await log_audit(user, "driver_assigned", "driver", did, f"{driver['name']} assigned to {vehicle['vehicle_number']}")
    return {"ok": True}


# ---------- rental plans ----------
class PlanBody(BaseModel):
    name: str
    package_type: str
    city: str
    amount: float = 0.0
    deposit: float = 5000.0
    daily_limit_km: int = 0
    monthly_km_limit: int = 0
    overage_per_km: float = 0.0
    active: bool = True


@api.get("/rental-plans")
async def list_plans(request: Request):
    user = await get_user(request)
    docs = await db.rental_plans.find({"organization_id": user["organization_id"]}).to_list(200)
    return [ser(d) for d in docs]


@api.post("/rental-plans")
async def create_plan(body: PlanBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    doc = body.model_dump()
    doc["organization_id"] = user["organization_id"]
    doc["created_at"] = now_iso()
    res = await db.rental_plans.insert_one(doc)
    return ser(await db.rental_plans.find_one({"_id": res.inserted_id}))


@api.put("/rental-plans/{pid}")
async def update_plan(pid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    body.pop("id", None); body.pop("_id", None)
    await db.rental_plans.update_one(org_filter(user, {"_id": oid(pid)}), {"$set": body})
    return ser(await db.rental_plans.find_one({"_id": oid(pid)}))


# ---------- rentals ----------
class RentalBody(BaseModel):
    driver_id: str
    vehicle_id: str
    start: str
    end: Optional[str] = None
    amount: Optional[float] = None
    deposit: float = 5000
    package_name: Optional[str] = None
    package_rate: Optional[int] = None
    notes: Optional[str] = None


def rental_computed_status(r):
    if r.get("status") in ("closed", "suspended", "draft", "pending_payment"):
        return r["status"]
    try:
        end = datetime.fromisoformat(r["end"].replace("Z", "+00:00"))
    except Exception:
        return r.get("status", "active")
    now = datetime.now(timezone.utc)
    if end < now:
        return "expired"
    if end < now + timedelta(hours=36):
        return "expiring_soon"
    return "active"


@api.get("/rentals")
async def list_rentals(request: Request, status: Optional[str] = None, city: Optional[str] = None, q: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if city and city != "all":
        extra["city"] = city
    filt = org_filter(user, extra)
    if q:
        filt["$or"] = [
            {"driver_name": {"$regex": q, "$options": "i"}},
            {"vehicle_number": {"$regex": q, "$options": "i"}},
            {"rental_code": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.rentals.find(filt).sort("created_at", -1).to_list(2000)
    out = []
    for d in docs:
        s = ser(d)
        s["display_status"] = rental_computed_status(s)
        if status and status != "all":
            if status == "expiring":
                if s["display_status"] not in ("expiring_soon", "expired"):
                    continue
            elif status == "pending_payment":
                if not (s.get("payment_status") in ("pending", "partial") and s.get("status") != "closed"):
                    continue
            elif s["display_status"] != status and s.get("status") != status:
                continue
        out.append(s)
    return out


@api.get("/admin/daily-collection")
async def get_daily_collection(request: Request, city: Optional[str] = None, from_date: Optional[str] = None, to_date: Optional[str] = None, driver_name: Optional[str] = None):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    
    extra = {"status": {"$nin": ["closed"]}}
    if city and city != "all":
        extra["city"] = city
    if driver_name:
        extra["driver_name"] = {"$regex": driver_name, "$options": "i"}
        
    rentals = await db.rentals.find(org_filter(user, extra)).to_list(1000)
    
    from datetime import datetime, timezone, time, timedelta
    
    dates_to_check = []
    if from_date and to_date:
        try:
            start_dt = datetime.strptime(from_date, "%Y-%m-%d").date()
            end_dt = datetime.strptime(to_date, "%Y-%m-%d").date()
            delta = end_dt - start_dt
            for i in range(min(delta.days + 1, 31)): # Cap at 31 days to prevent massive payloads
                dates_to_check.append(start_dt + timedelta(days=i))
        except:
            dates_to_check.append(datetime.now(timezone.utc).date())
    elif from_date:
        try:
            dates_to_check.append(datetime.strptime(from_date, "%Y-%m-%d").date())
        except:
            dates_to_check.append(datetime.now(timezone.utc).date())
    else:
        dates_to_check.append(datetime.now(timezone.utc).date())
    
    out = []
    for r in rentals:
        rid = str(r["_id"])
        
        deposit = r.get("deposit", 5000)
        total_paid = r.get("paid", 0)
        deposit_paid = min(total_paid, deposit)
        deposit_status = "paid" if deposit_paid >= deposit else "pending"
        
        drv_doc = await db.drivers.find_one({"_id": ObjectId(r["driver_id"])}) if r.get("driver_id") else None
        driver_avatar = drv_doc.get("avatar") if drv_doc else None
        
        acct = await db.rental_accounts.find_one({"driver_id": r["driver_id"]})
        outstanding_amount = float(acct["outstanding_amount"]) if acct else 0
        
        vehicle_reg_number = None
        if r.get("vehicle_id"):
            veh_doc = await db.vehicles.find_one({"_id": oid(r["vehicle_id"])})
            if veh_doc:
                vehicle_reg_number = veh_doc.get("registration_number")
                
        for d in dates_to_check:
            d_str = d.strftime("%Y-%m-%d")
            d_start = datetime.combine(d, time.min).replace(tzinfo=timezone.utc)
            d_end = datetime.combine(d, time.max).replace(tzinfo=timezone.utc)
            
            # Payments that specifically cover this date (due date), or fallback to exact timestamp matching if no covers_dates exists.
            day_payments = await db.rental_payments.find({
                "rental_id": rid,
                "$or": [
                    {"covers_dates": d_str},
                    {"covers_dates": {"$exists": False}, "created_at": {"$gte": d_start.isoformat(), "$lte": d_end.isoformat()}},
                    {"covers_dates": {"$size": 0}, "created_at": {"$gte": d_start.isoformat(), "$lte": d_end.isoformat()}}
                ]
            }).to_list(100)
            
            # Find the actual date this payment was physically processed (useful for late retroactive payments)
            paid_on_date = None
            payment_method = None
            transaction_id = None
            for p in day_payments:
                if p.get("payment_status") == "paid" and p.get("type") != "refund":
                    created = p.get("created_at")
                    if created:
                        paid_on_date = created.split("T")[0]
                        payment_method = p.get("payment_method")
                        transaction_id = p.get("transaction_id")
                        break
            
            today_paid = sum(p.get("amount", 0) for p in day_payments if p.get("type") != "refund" and p.get("payment_status") == "paid")
            
            odo_logs = await db.driver_odometer_logs.find({
                "driver_id": r["driver_id"],
                "date": d_str
            }).to_list(100)
            
            if not odo_logs:
                odo_logs = [None]
                
            for idx, odo_log in enumerate(odo_logs):
                base_daily_rate = float(r.get("daily_rate", 0))
                if odo_log and "snapshot_daily_rent" in odo_log:
                    base_daily_rate = float(odo_log["snapshot_daily_rent"])
                
                daily_rate = base_daily_rate
                
                # Distribute the today_paid across rows roughly (if there are multiple)
                row_paid = min(today_paid, daily_rate)
                today_paid = max(0, today_paid - row_paid)
                daily_status = "paid" if row_paid >= daily_rate else ("partial" if row_paid > 0 else "pending")
                
                start_meter = odo_log.get("start_reading", 0) if odo_log else 0
                end_meter = odo_log.get("end_reading", 0) if odo_log else 0
                total_km = odo_log.get("driven_today", 0) if odo_log else 0
                
                if d == datetime.now(timezone.utc).date() or odo_log or row_paid > 0 or d_str in acct.get("unpaid_dates", []):
                    out.append({
                        "id": f"{rid}_{d_str}_{idx}",
                        "driver_name": r.get("driver_name", "Unknown"),
                        "driver_avatar": driver_avatar,
                        "vehicle_code": r.get("vehicle_number", r.get("vehicle_reg", "N/A")),
                        "vehicle_reg": vehicle_reg_number,
                        "city": r.get("city", "Unknown"),
                        "status": r.get("status", "pending_payment"),
                        "daily_rate": daily_rate,
                        "today_paid": row_paid,
                        "outstanding_amount": outstanding_amount if (d == datetime.now(timezone.utc).date() and idx == 0) else max(0, daily_rate - row_paid),
                        "daily_status": daily_status,
                        "paid_on": paid_on_date,
                        "payment_method": payment_method,
                        "transaction_id": transaction_id,
                        "deposit": deposit,
                        "deposit_paid": deposit_paid,
                        "deposit_status": deposit_status,
                        "start_meter": start_meter if start_meter else None,
                        "end_meter": end_meter if end_meter else None,
                        "total_km": total_km if total_km else None,
                        "date": d_str,
                    })

        
    return out


@api.get("/rentals/{rid}")
async def get_rental(rid: str, request: Request):
    user = await get_user(request)
    r = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    if not r:
        raise HTTPException(status_code=404, detail="Rental not found")
    out = ser(r)
    out["display_status"] = rental_computed_status(out)
    out["payments"] = [ser(p) for p in await db.rental_payments.find({"rental_id": rid}).sort("payment_date", 1).to_list(200)]
    out["renewals"] = out.get("renewal_history", [])
    return out


async def _next_rental_code(org_id):
    count = await db.rentals.count_documents({"organization_id": org_id})
    return f"RNT-{1000 + count + 1}"


@api.post("/rentals")
async def create_rental(body: RentalBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    driver = await db.drivers.find_one(org_filter(user, {"_id": oid(body.driver_id)}))
    vehicle = await db.vehicles.find_one(org_filter(user, {"_id": oid(body.vehicle_id)}))
    if not (driver and vehicle):
        raise HTTPException(status_code=404, detail="Driver or vehicle not found")
        
    pkg_name = body.package_name or driver.get("package_name", "Standard")
    pkg_rate = body.package_rate or driver.get("package_rate", 0)
    if pkg_rate == 0:
        plan = await db.rental_plans.find_one({"name": {"$regex": f"^{pkg_name}$", "$options": "i"}, "organization_id": user["organization_id"]})
        if plan:
            pkg_rate = plan.get("amount", 0)
            
    code = await _next_rental_code(user["organization_id"])
    doc = {
        "organization_id": user["organization_id"],
        "rental_code": code,
        "driver_id": body.driver_id, "driver_name": driver["name"],
        "vehicle_id": body.vehicle_id, "vehicle_number": vehicle["vehicle_number"],
        "plan_id": None, "plan_name": pkg_name,
        "package_name": pkg_name, "daily_rate": pkg_rate,
        "city": vehicle["city"],
        "start": body.start, "end": "Ongoing",
        "amount": pkg_rate, "deposit": body.deposit or 0,
        "paid": 0.0, "outstanding": pkg_rate + (body.deposit or 0),
        "payment_status": "pending",
        "status": "pending_payment",
        "notes": body.notes or "",
        "renewal_history": [],
        "created_at": now_iso(),
    }
    res = await db.rentals.insert_one(doc)
    await log_audit(user, "rental_created", "rental", str(res.inserted_id), f"Rental {code} created for {driver['name']}")
    out = ser(await db.rentals.find_one({"_id": res.inserted_id}))
    out["display_status"] = rental_computed_status(out)
    return out


@api.post("/rentals/{rid}/payments")
async def add_payment(rid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    r = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    if not r:
        raise HTTPException(status_code=404, detail="Rental not found")
    amount = float(body.get("amount", 0))
    payment = {
        "organization_id": user["organization_id"],
        "rental_id": rid, "rental_code": r["rental_code"], "city": r["city"],
        "type": body.get("type", "payment"),
        "amount": amount,
        "method": body.get("method", "cash"),
        "reference": body.get("reference", ""),
        "payment_date": body.get("payment_date", now_iso()),
        "created_at": now_iso(),
    }
    await db.rental_payments.insert_one(payment)
    paid = r.get("paid", 0) + (amount if payment["type"] != "refund" else -amount)
    total_due = r.get("amount", 0) + r.get("deposit", 0)
    outstanding = max(total_due - paid, 0)
    pstatus = "paid" if outstanding <= 0 else ("partial" if paid > 0 else "pending")
    update = {"paid": paid, "outstanding": outstanding, "payment_status": pstatus}
    await db.rentals.update_one({"_id": oid(rid)}, {"$set": update})
    
    if payment["type"] != "refund":
        await db.rental_accounts.update_one(
            {"organization_id": user["organization_id"], "driver_id": r["driver_id"]},
            {
                "$inc": {"outstanding_amount": -amount},
                "$pullAll": {"unpaid_dates": body.get("covers_dates", [])}
            }
        )
        
    await log_audit(user, "payment_recorded", "rental", rid, f"Rs {amount} recorded for {r['rental_code']}")
    return {"ok": True, **update}


@api.post("/rentals/{rid}/activate")
async def activate_rental(rid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    r = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    if not r:
        raise HTTPException(status_code=404, detail="Rental not found")
    await db.rentals.update_one({"_id": oid(rid)}, {"$set": {"status": "active"}})
    await db.vehicles.update_one({"_id": oid(r["vehicle_id"])}, {"$set": {
        "status": "rented", "current_driver_id": r["driver_id"], "current_driver_name": r["driver_name"],
        "current_rental_id": rid, "current_rental_code": r["rental_code"], "rental_end": r["end"]}})
    await db.drivers.update_one({"_id": oid(r["driver_id"])}, {"$set": {
        "current_vehicle_id": r["vehicle_id"], "current_vehicle_number": r["vehicle_number"],
        "package_name": r["package_name"], "package_rate": r["daily_rate"],
        "rental_status": "active"}})
    await db.driver_vehicle_assignments.update_many({"driver_id": r["driver_id"], "end": None}, {"$set": {"end": now_iso()}})
    await db.driver_vehicle_assignments.insert_one({
        "organization_id": user["organization_id"], "driver_id": r["driver_id"], "driver_name": r["driver_name"],
        "vehicle_id": r["vehicle_id"], "vehicle_number": r["vehicle_number"], "city": r["city"],
        "start": now_iso(), "end": None, "notes": f"Via rental {r['rental_code']}", "created_at": now_iso()})
    await log_audit(user, "rental_activated", "rental", rid, f"Rental {r['rental_code']} activated")
    await add_notification(user["organization_id"], "green", "Rental activated",
                           f"{r['rental_code']} activated for {r['driver_name']}", link=f"/rentals/{rid}", city=r["city"])
    return {"ok": True}


@api.post("/rentals/{rid}/renew")
async def renew_rental(rid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    r = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    if not r:
        raise HTTPException(status_code=404, detail="Rental not found")
    history = r.get("renewal_history", [])
    history.append({"previous_end": r["end"], "previous_plan": r["plan_name"], "renewed_at": now_iso(),
                    "amount": body.get("amount", r["amount"])})
    update = {"end": body.get("end", r["end"]), "renewal_history": history, "status": "active"}
    if body.get("plan_id"):
        plan = await db.rental_plans.find_one(org_filter(user, {"_id": oid(body["plan_id"])}))
        if plan:
            update["plan_id"] = body["plan_id"]; update["plan_name"] = plan["name"]
    if body.get("amount"):
        update["amount"] = float(body["amount"])
        update["outstanding"] = float(body["amount"]) + r.get("deposit", 0) - r.get("paid", 0)
        update["payment_status"] = "paid" if update["outstanding"] <= 0 else "partial"
    if body.get("vehicle_id") and body["vehicle_id"] != r["vehicle_id"]:
        nv = await db.vehicles.find_one(org_filter(user, {"_id": oid(body["vehicle_id"])}))
        if nv:
            update["vehicle_id"] = body["vehicle_id"]; update["vehicle_number"] = nv["vehicle_number"]
    await db.rentals.update_one({"_id": oid(rid)}, {"$set": update})
    await db.vehicles.update_one({"_id": oid(update.get("vehicle_id", r["vehicle_id"]))}, {"$set": {"rental_end": update["end"]}})
    await log_audit(user, "rental_renewed", "rental", rid, f"Rental {r['rental_code']} renewed")
    await add_notification(user["organization_id"], "green", "Rental renewed",
                           f"{r['rental_code']} renewed for {r['driver_name']}", link=f"/rentals/{rid}", city=r["city"])
    return {"ok": True}


@api.post("/rentals/{rid}/suspend")
async def suspend_rental(rid: str, request: Request, body: dict = None):
    user = await get_user(request)
    body = body or {}
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    r = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    if not r:
        raise HTTPException(status_code=404, detail="Rental not found")
    await db.rentals.update_one({"_id": oid(rid)}, {"$set": {"status": "suspended", "suspend_reason": body.get("reason", "")}})
    await db.drivers.update_one({"_id": oid(r["driver_id"])}, {"$set": {"rental_status": "suspended"}})
    await log_audit(user, "rental_suspended", "rental", rid, f"Rental {r['rental_code']} suspended")
    return {"ok": True}


@api.post("/rentals/{rid}/close")
async def close_rental(rid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    r = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    if not r:
        raise HTTPException(status_code=404, detail="Rental not found")
    await db.rentals.update_one({"_id": oid(rid)}, {"$set": {"status": "closed", "closed_at": now_iso()}})
    await db.vehicles.update_one({"_id": oid(r["vehicle_id"])}, {"$set": {
        "status": "available", "current_driver_id": None, "current_driver_name": None,
        "current_rental_id": None, "current_rental_code": None, "rental_end": None}})
    await db.drivers.update_one({"_id": oid(r["driver_id"])}, {"$set": {"rental_status": "none"}})
    await log_audit(user, "rental_closed", "rental", rid, f"Rental {r['rental_code']} closed")
    return {"ok": True}


# ---------- handovers & returns ----------
@api.get("/handovers")
async def list_handovers(request: Request, vehicle_id: Optional[str] = None, rental_id: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if vehicle_id: extra["vehicle_id"] = vehicle_id
    if rental_id: extra["rental_id"] = rental_id
    return await _find("vehicle_handovers", user, extra, sort=("created_at", -1))


@api.post("/handovers")
async def create_handover(body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    body["organization_id"] = user["organization_id"]
    body["created_at"] = now_iso()
    body["type"] = "handover"
    res = await db.vehicle_handovers.insert_one(body)
    await log_audit(user, "vehicle_handed_over", "vehicle", body.get("vehicle_id"), "Handover recorded")
    return ser(await db.vehicle_handovers.find_one({"_id": res.inserted_id}))


@api.get("/returns")
async def list_returns(request: Request, vehicle_id: Optional[str] = None, rental_id: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if vehicle_id: extra["vehicle_id"] = vehicle_id
    if rental_id: extra["rental_id"] = rental_id
    return await _find("vehicle_returns", user, extra, sort=("created_at", -1))


@api.post("/returns")
async def create_return(body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    body["organization_id"] = user["organization_id"]
    body["created_at"] = now_iso()
    body["type"] = "return"
    res = await db.vehicle_returns.insert_one(body)
    await log_audit(user, "vehicle_returned", "vehicle", body.get("vehicle_id"), "Return recorded")
    return ser(await db.vehicle_returns.find_one({"_id": res.inserted_id}))


# ---------- service requests ----------
@api.get("/service-requests")
async def list_srs(request: Request, city: Optional[str] = None, status: Optional[str] = None, priority: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if city and city != "all": extra["city"] = city
    if status: extra["status"] = status
    if priority: extra["priority"] = priority
    return await _find("service_requests", user, extra, sort=("created_at", -1))


@api.get("/service-requests/{sid}")
async def get_sr(sid: str, request: Request):
    user = await get_user(request)
    sr = await db.service_requests.find_one(org_filter(user, {"_id": oid(sid)}))
    if not sr:
        raise HTTPException(status_code=404, detail="Not found")
    out = ser(sr)
    out["service_record"] = ser(await db.vehicle_services.find_one({"service_request_id": sid}))
    return out


@api.post("/service-requests")
async def create_sr(body: dict, request: Request):
    user = await get_user(request)
    count = await db.service_requests.count_documents({"organization_id": user["organization_id"]})
    body["organization_id"] = user["organization_id"]
    body["code"] = f"SR-{2000 + count + 1}"
    body["status"] = body.get("status", "new")
    body["created_at"] = now_iso()
    body.setdefault("timeline", [{"stage": "new", "at": now_iso(), "by": user.get("name")}])
    res = await db.service_requests.insert_one(body)
    await log_audit(user, "service_request_created", "service_request", str(res.inserted_id),
                    f"Service request {body['code']} created")
    lvl = "red" if body.get("priority") == "critical" else "amber"
    await add_notification(user["organization_id"], lvl, "Service request created",
                           f"{body['code']} - {body.get('issue_type','')} - {body.get('vehicle_number','')}",
                           link="/service-requests", city=body.get("city"))
    return ser(await db.service_requests.find_one({"_id": res.inserted_id}))


@api.put("/service-requests/{sid}")
async def update_sr(sid: str, body: dict, request: Request):
    user = await get_user(request)
    body.pop("id", None); body.pop("_id", None); body.pop("service_record", None)
    sr = await db.service_requests.find_one(org_filter(user, {"_id": oid(sid)}))
    if not sr:
        raise HTTPException(status_code=404, detail="Not found")
    if body.get("status") and body["status"] != sr.get("status"):
        timeline = sr.get("timeline", [])
        timeline.append({"stage": body["status"], "at": now_iso(), "by": user.get("name")})
        body["timeline"] = timeline
        if body["status"] in ("inspection", "repair", "assigned"):
            await db.vehicles.update_one({"_id": oid(sr["vehicle_id"])}, {"$set": {"status": "service"}})
        elif body["status"] == "closed":
            await db.vehicles.update_one({"_id": oid(sr["vehicle_id"])}, {"$set": {"status": "available"}})
        await log_audit(user, "service_request_updated", "service_request", sid, f"{sr['code']} to {body['status']}")
    await db.service_requests.update_one({"_id": oid(sid)}, {"$set": body})
    return ser(await db.service_requests.find_one({"_id": oid(sid)}))


# ---------- vehicle services ----------
@api.get("/vehicle-services")
async def list_services(request: Request, vehicle_id: Optional[str] = None, city: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if vehicle_id: extra["vehicle_id"] = vehicle_id
    if city and city != "all": extra["city"] = city
    return await _find("vehicle_services", user, extra, sort=("start_date", -1))


@api.post("/vehicle-services")
async def create_service(body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    body["organization_id"] = user["organization_id"]
    body["created_at"] = now_iso()
    res = await db.vehicle_services.insert_one(body)
    await log_audit(user, "service_completed", "vehicle_service", str(res.inserted_id),
                    f"Service recorded for {body.get('vehicle_number','')}")
    if body.get("service_request_id"):
        await db.service_requests.update_one({"_id": oid(body["service_request_id"])}, {"$set": {"status": "closed"}})
    if body.get("completion_date"):
        upd = {"status": "available"}
        if body.get("next_service_date"):
            upd["next_service_date"] = body["next_service_date"]
        await db.vehicles.update_one({"_id": oid(body["vehicle_id"])}, {"$set": upd})
        await add_notification(user["organization_id"], "green", "Service completed",
                               f"{body.get('vehicle_number','')} - {body.get('issue','service')}",
                               link=f"/fleet/{body['vehicle_id']}", city=body.get("city"))
    return ser(await db.vehicle_services.find_one({"_id": res.inserted_id}))


# ---------- locations ----------
@api.get("/locations")
async def list_locations(request: Request, city: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if city and city != "all": extra["city"] = city
    locs = await _find("locations", user, extra)
    for l in locs:
        l["current_vehicles"] = await db.vehicles.count_documents(
            {"organization_id": user["organization_id"], "parking": l["name"]})
    return locs


@api.post("/locations")
async def create_location(body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    body["organization_id"] = user["organization_id"]
    body["created_at"] = now_iso()
    res = await db.locations.insert_one(body)
    return ser(await db.locations.find_one({"_id": res.inserted_id}))


# ---------- documents ----------
def doc_status(expiry):
    if not expiry:
        return "valid"
    try:
        e = datetime.fromisoformat(expiry.replace("Z", "+00:00")) if "T" in expiry else datetime.fromisoformat(expiry + "T00:00:00+00:00")
    except Exception:
        return "valid"
    now = datetime.now(timezone.utc)
    if e < now:
        return "expired"
    if e < now + timedelta(days=30):
        return "expiring_soon"
    return "valid"


@api.get("/documents")
async def list_documents(request: Request, owner_type: Optional[str] = None, owner_id: Optional[str] = None,
                         city: Optional[str] = None, status: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if owner_type: extra["owner_type"] = owner_type
    if owner_id: extra["owner_id"] = owner_id
    if city and city != "all": extra["city"] = city
    docs = await _find("documents", user, extra)
    for d in docs:
        d["doc_status"] = doc_status(d.get("expiry_date"))
    if status:
        docs = [d for d in docs if d["doc_status"] == status]
    return docs


@api.post("/documents")
async def create_document(body: dict, request: Request):
    user = await get_user(request)
    body["organization_id"] = user["organization_id"]
    body["created_at"] = now_iso()
    res = await db.documents.insert_one(body)
    await log_audit(user, "document_updated", "document", str(res.inserted_id),
                    f"{body.get('doc_type','Document')} added")
    return ser(await db.documents.find_one({"_id": res.inserted_id}))


# ---------- incidents ----------
@api.get("/incidents")
async def list_incidents(request: Request, city: Optional[str] = None, status: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if city and city != "all": extra["city"] = city
    if status: extra["status"] = status
    return await _find("incidents", user, extra, sort=("created_at", -1))


@api.post("/incidents")
async def create_incident(body: dict, request: Request):
    user = await get_user(request)
    count = await db.incidents.count_documents({"organization_id": user["organization_id"]})
    body["organization_id"] = user["organization_id"]
    body["code"] = f"INC-{3000 + count + 1}"
    body["status"] = body.get("status", "reported")
    body["created_at"] = now_iso()
    res = await db.incidents.insert_one(body)
    await log_audit(user, "incident_reported", "incident", str(res.inserted_id), f"Incident {body['code']} reported")
    await add_notification(user["organization_id"], "red", "Incident reported",
                           f"{body['code']} - {body.get('incident_type','')}", link="/incidents", city=body.get("city"))
    return ser(await db.incidents.find_one({"_id": res.inserted_id}))


@api.put("/incidents/{iid}")
async def update_incident(iid: str, body: dict, request: Request):
    user = await get_user(request)
    body.pop("id", None); body.pop("_id", None)
    await db.incidents.update_one(org_filter(user, {"_id": oid(iid)}), {"$set": body})
    return ser(await db.incidents.find_one({"_id": oid(iid)}))


# ---------- notifications ----------
@api.get("/notifications")
async def list_notifications(request: Request):
    user = await get_user(request)
    f = {"organization_id": user.get("organization_id")}
    if user.get("role") == "city_manager" and user.get("city"):
        f["$or"] = [{"city": user["city"]}, {"city": None}]
    docs = await db.notifications.find(f).sort("created_at", -1).to_list(50)
    return [ser(d) for d in docs]


@api.post("/notifications/read-all")
async def read_all(request: Request):
    user = await get_user(request)
    await db.notifications.update_many({"organization_id": user.get("organization_id")}, {"$set": {"read": True}})
    return {"ok": True}


# ---------- audit logs ----------
@api.get("/audit-logs")
async def list_audit(request: Request, limit: int = 30):
    user = await get_user(request)
    docs = await db.audit_logs.find(org_filter(user)).sort("created_at", -1).to_list(limit)
    return [ser(d) for d in docs]


# ---------- global search ----------
@api.get("/search")
async def global_search(request: Request, q: str = Query(...)):
    user = await get_user(request)
    if not q:
        return {"vehicles": [], "drivers": [], "rentals": [], "service_requests": []}
    rx = {"$regex": q, "$options": "i"}
    base = org_filter(user)
    vehicles = await db.vehicles.find({**base, "$or": [{"vehicle_number": rx}, {"registration_number": rx}]}).limit(6).to_list(6)
    drivers = await db.drivers.find({**base, "$or": [{"name": rx}, {"phone": rx}]}).limit(6).to_list(6)
    rentals = await db.rentals.find({**base, "$or": [{"rental_code": rx}, {"driver_name": rx}]}).limit(6).to_list(6)
    srs = await db.service_requests.find({**base, "$or": [{"code": rx}, {"vehicle_number": rx}]}).limit(6).to_list(6)
    return {
        "vehicles": [ser(v) for v in vehicles],
        "drivers": [ser(d) for d in drivers],
        "rentals": [ser(r) for r in rentals],
        "service_requests": [ser(s) for s in srs],
    }


# ---------- dashboard ----------
@api.get("/dashboard/summary")
async def dashboard_summary(request: Request, city: Optional[str] = None):
    user = await get_user(request)
    base = org_filter(user)
    if city and city != "all":
        base = {**base, "city": city}

    async def count_v(status=None):
        f = dict(base)
        if status:
            f["status"] = status
        return await db.vehicles.count_documents(f)

    total = await count_v()
    fleet = {
        "total": total,
        "rented": await count_v("rented"),
        "available": await count_v("available"),
        "service": await count_v("service"),
        "inactive": await count_v("inactive"),
        "idle": await count_v("idle"),
        "accident": await count_v("accident"),
    }

    city_list = [user["city"]] if user.get("role") == "city_manager" and user.get("city") else CITIES
    cities = []
    for c in city_list:
        cf = {**org_filter(user), "city": c}
        cities.append({
            "city": c,
            "total": await db.vehicles.count_documents(cf),
            "rented": await db.vehicles.count_documents({**cf, "status": "rented"}),
            "available": await db.vehicles.count_documents({**cf, "status": "available"}),
            "service": await db.vehicles.count_documents({**cf, "status": "service"}),
        })

    all_rentals = await db.rentals.find(base).to_list(5000)
    active = expiring_today = expiring_soon = payment_pending = suspended = 0
    now = datetime.now(timezone.utc)
    for r in all_rentals:
        st = rental_computed_status(r)
        if r.get("status") == "suspended":
            suspended += 1
            continue
        if r.get("payment_status") in ("pending", "partial") and r.get("status") not in ("closed",):
            payment_pending += 1
        if st == "active":
            active += 1
        elif st in ("expiring_soon", "expired"):
            try:
                end = datetime.fromisoformat(r["end"].replace("Z", "+00:00"))
                if end.date() == now.date():
                    expiring_today += 1
                else:
                    expiring_soon += 1
            except Exception:
                expiring_soon += 1
            if st != "expired":
                active += 1
    rentals = {
        "active": active, "expiring_today": expiring_today, "expiring_soon": expiring_soon,
        "payment_pending": payment_pending, "suspended": suspended,
    }

    attention = []
    crit = await db.service_requests.count_documents({**base, "priority": "critical", "status": {"$ne": "closed"}})
    if crit:
        attention.append({"level": "red", "label": f"{crit} critical service request(s)", "link": "/service-requests?priority=critical"})
    if expiring_today:
        attention.append({"level": "amber", "label": f"{expiring_today} rental(s) expiring today", "link": "/rentals?status=expiring"})
    if payment_pending:
        attention.append({"level": "amber", "label": f"{payment_pending} pending rental payment(s)", "link": "/rentals?status=pending_payment"})
    all_docs = await db.documents.find(base).to_list(5000)
    exp_driver = exp_vehicle = 0
    for d in all_docs:
        if doc_status(d.get("expiry_date")) == "expired":
            if d.get("owner_type") == "driver":
                exp_driver += 1
            else:
                exp_vehicle += 1
    if exp_driver:
        attention.append({"level": "red", "label": f"{exp_driver} expired driver document(s)", "link": "/documents?status=expired"})
    if exp_vehicle:
        attention.append({"level": "red", "label": f"{exp_vehicle} expired vehicle document(s)", "link": "/documents?status=expired"})
    waiting = await db.service_requests.count_documents({**base, "status": "new"})
    if waiting:
        attention.append({"level": "amber", "label": f"{waiting} vehicle(s) waiting for service assignment", "link": "/service-requests"})

    return {"fleet": fleet, "cities": cities, "rentals": rentals, "attention": attention, "cities_list": CITIES}


@api.get("/dashboard/recent")
async def dashboard_recent(request: Request, limit: int = 12):
    user = await get_user(request)
    docs = await db.audit_logs.find(org_filter(user)).sort("created_at", -1).to_list(limit)
    return [ser(d) for d in docs]


# ---------- reports ----------
@api.get("/reports")
async def reports(request: Request, city: Optional[str] = None):
    user = await get_user(request)
    base = org_filter(user)
    if city and city != "all":
        base = {**base, "city": city}
    total = await db.vehicles.count_documents(base)
    services = await db.vehicle_services.find(base).to_list(5000)
    total_cost = sum(float(s.get("cost", 0) or 0) for s in services)
    payments = await db.rental_payments.find(base).to_list(10000)
    collected = sum(float(p.get("amount", 0)) for p in payments if p.get("type") != "refund")
    rentals = await db.rentals.find(base).to_list(5000)
    outstanding = sum(float(r.get("outstanding", 0)) for r in rentals if r.get("status") != "closed")
    docs = await db.documents.find(base).to_list(5000)
    expiring = sum(1 for d in docs if doc_status(d.get("expiry_date")) == "expiring_soon")
    expired = sum(1 for d in docs if doc_status(d.get("expiry_date")) == "expired")
    by_city = []
    for c in CITIES:
        cf = {**org_filter(user), "city": c}
        by_city.append({
            "city": c,
            "total": await db.vehicles.count_documents(cf),
            "rented": await db.vehicles.count_documents({**cf, "status": "rented"}),
            "available": await db.vehicles.count_documents({**cf, "status": "available"}),
            "service": await db.vehicles.count_documents({**cf, "status": "service"}),
        })
    return {
        "fleet": {"total": total, "by_city": by_city},
        "rentals": {"active": sum(1 for r in rentals if rental_computed_status(r) == "active"),
                    "total": len(rentals), "collected": collected, "outstanding": outstanding},
        "service": {"records": len(services), "total_cost": total_cost,
                    "open_requests": await db.service_requests.count_documents({**base, "status": {"$ne": "closed"}})},
        "compliance": {"expiring": expiring, "expired": expired},
        "drivers": {"total": await db.drivers.count_documents(base),
                    "active": await db.drivers.count_documents({**base, "status": "active"})},
    }


# ======================= NAYARA STUDIO — ORDER MANAGEMENT =======================
ORDER_STAGES = ["received", "processing", "on_hold", "completed"]


def order_due_status(o):
    if o.get("status") == "completed":
        return "completed"
    dd = o.get("due_date")
    if not dd:
        return "on_track"
    try:
        d = datetime.fromisoformat(dd.replace("Z", "+00:00")) if "T" in dd else datetime.fromisoformat(dd + "T23:59:59+00:00")
    except Exception:
        return "on_track"
    now = datetime.now(timezone.utc)
    if d < now:
        return "overdue"
    if d < now + timedelta(days=3):
        return "due_soon"
    return "on_track"


class CustomerBody(BaseModel):
    name: str
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    company: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


@api.get("/customers")
async def list_customers(request: Request, q: Optional[str] = None):
    user = await get_user(request)
    filt = {"organization_id": user["organization_id"]}
    if q:
        filt["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"phone": {"$regex": q, "$options": "i"}},
                       {"company": {"$regex": q, "$options": "i"}}]
    docs = await db.customers.find(filt).sort("name", 1).to_list(1000)
    out = []
    for c in docs:
        s = ser(c)
        s["order_count"] = await db.orders.count_documents({"organization_id": user["organization_id"], "customer_id": s["id"]})
        out.append(s)
    return out


@api.get("/customers/{cid}")
async def get_customer(cid: str, request: Request):
    user = await get_user(request)
    c = await db.customers.find_one(org_filter(user, {"_id": oid(cid)}))
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    out = ser(c)
    orders = await db.orders.find({"organization_id": user["organization_id"], "customer_id": cid}).sort("created_at", -1).to_list(500)
    out["orders"] = [ser(o) for o in orders]
    counts = {"total": len(out["orders"])}
    for st in ORDER_STAGES:
        counts[st] = sum(1 for o in out["orders"] if o.get("status") == st)
    out["counts"] = counts
    return out


@api.post("/customers")
async def create_customer(body: CustomerBody, request: Request):
    user = await get_user(request)
    doc = body.model_dump()
    doc["organization_id"] = user["organization_id"]
    doc["created_at"] = now_iso()
    res = await db.customers.insert_one(doc)
    await log_audit(user, "customer_created", "customer", str(res.inserted_id), f"Customer {body.name} added")
    return ser(await db.customers.find_one({"_id": res.inserted_id}))


@api.put("/customers/{cid}")
async def update_customer(cid: str, body: dict, request: Request):
    user = await get_user(request)
    for k in ("id", "_id", "orders", "counts", "order_count"):
        body.pop(k, None)
    await db.customers.update_one(org_filter(user, {"_id": oid(cid)}), {"$set": body})
    return ser(await db.customers.find_one({"_id": oid(cid)}))


class OrderBody(BaseModel):
    order_number: Optional[str] = None
    customer_id: str
    order_date: Optional[str] = None
    due_date: Optional[str] = None
    product: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = "metres"
    priority: str = "medium"
    assigned_to: Optional[str] = None
    payment_status: str = "pending"
    total_amount: float = 0
    paid_amount: float = 0
    notes: Optional[str] = None


def _order_ser(o):
    s = ser(o)
    s["due_status"] = order_due_status(s)
    return s


@api.get("/orders")
async def list_orders(request: Request, status: Optional[str] = None, priority: Optional[str] = None,
                      assigned_to: Optional[str] = None, payment_status: Optional[str] = None,
                      due: Optional[str] = None, scope: Optional[str] = None, q: Optional[str] = None):
    user = await get_user(request)
    extra = {}
    if status and status != "all": extra["status"] = status
    if priority: extra["priority"] = priority
    if assigned_to: extra["assigned_to"] = assigned_to
    if payment_status: extra["payment_status"] = payment_status
    filt = org_filter(user, extra)
    if scope == "active":
        filt["status"] = {"$ne": "completed"}
    elif scope == "completed":
        filt["status"] = "completed"
    if q:
        filt["$or"] = [{"order_number": {"$regex": q, "$options": "i"}}, {"customer_name": {"$regex": q, "$options": "i"}},
                       {"product": {"$regex": q, "$options": "i"}}, {"customer_phone": {"$regex": q, "$options": "i"}}]
    docs = await db.orders.find(filt).sort("created_at", -1).to_list(2000)
    out = [_order_ser(o) for o in docs]
    if due:
        out = [o for o in out if o["due_status"] == due]
    return out


@api.get("/orders/{oid_}")
async def get_order(oid_: str, request: Request):
    user = await get_user(request)
    o = await db.orders.find_one(org_filter(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    return _order_ser(o)


async def _order_timeline(user, oid_, text):
    await db.orders.update_one({"_id": oid(oid_)}, {"$push": {"timeline": {"at": now_iso(), "by": user.get("name"), "text": text}}})


@api.post("/orders")
async def create_order(body: OrderBody, request: Request):
    user = await get_user(request)
    cust = await db.customers.find_one(org_filter(user, {"_id": oid(body.customer_id)}))
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    count = await db.orders.count_documents({"organization_id": user["organization_id"]})
    code = body.order_number or f"ORD-{1000 + count + 1}"
    total = float(body.total_amount or 0); paid = float(body.paid_amount or 0)
    doc = body.model_dump()
    doc.update({
        "organization_id": user["organization_id"], "order_number": code,
        "customer_name": cust["name"], "customer_phone": cust.get("phone", ""),
        "status": "received", "total_amount": total, "paid_amount": paid,
        "balance": max(total - paid, 0),
        "attachments": [], "created_at": now_iso(),
        "order_date": body.order_date or now_iso(),
        "timeline": [{"at": now_iso(), "by": user.get("name"), "text": "Order created"}],
    })
    if body.assigned_to:
        doc["timeline"].append({"at": now_iso(), "by": user.get("name"), "text": f"Assigned to {body.assigned_to}"})
    res = await db.orders.insert_one(doc)
    await log_audit(user, "order_created", "order", str(res.inserted_id), f"Order {code} created for {cust['name']}")
    await add_notification(user["organization_id"], "blue", "New order received", f"{code} · {cust['name']} · {body.product or ''}", link="/orders")
    return _order_ser(await db.orders.find_one({"_id": res.inserted_id}))


@api.put("/orders/{oid_}")
async def update_order(oid_: str, body: dict, request: Request):
    user = await get_user(request)
    for k in ("id", "_id", "due_status", "customer_name", "customer_phone", "timeline", "attachments", "order_number"):
        body.pop(k, None)
    o = await db.orders.find_one(org_filter(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    events = []
    if body.get("status") and body["status"] != o.get("status"):
        events.append("Order completed" if body["status"] == "completed" else f"Moved to {body['status'].replace('_', ' ').title()}")
    if body.get("assigned_to") and body["assigned_to"] != o.get("assigned_to"):
        events.append(f"Assigned to {body['assigned_to']}")
    if body.get("due_date") and body["due_date"] != o.get("due_date"):
        events.append("Due date changed")
    if "notes" in body and body.get("notes") != o.get("notes"):
        events.append("Notes updated")
    if "total_amount" in body or "paid_amount" in body:
        total = float(body.get("total_amount", o.get("total_amount", 0)) or 0)
        paid = float(body.get("paid_amount", o.get("paid_amount", 0)) or 0)
        body["balance"] = max(total - paid, 0)
        body["total_amount"] = total; body["paid_amount"] = paid
    await db.orders.update_one({"_id": oid(oid_)}, {"$set": body})
    for e in events:
        await _order_timeline(user, oid_, e)
    if body.get("status") and body["status"] != o.get("status"):
        await log_audit(user, "order_status_changed", "order", oid_, f"{o['order_number']} → {body['status']}")
        if body["status"] == "completed":
            await add_notification(user["organization_id"], "green", "Order completed", f"{o['order_number']} · {o.get('customer_name','')}", link="/orders")
    return _order_ser(await db.orders.find_one({"_id": oid(oid_)}))


@api.post("/orders/{oid_}/attachments")
async def add_attachment(oid_: str, body: dict, request: Request):
    user = await get_user(request)
    o = await db.orders.find_one(org_filter(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    max_mb = 10
    org = await db.organizations.find_one({"org_id": user["organization_id"]})
    if org:
        max_mb = org.get("max_file_mb", 10)
    data = body.get("data", "")
    if len(data) > max_mb * 1.4 * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {max_mb} MB limit")
    att = {"id": str(ObjectId()), "name": body.get("name", "file"), "type": body.get("type", ""),
           "size": body.get("size", 0), "data": data, "uploaded_at": now_iso(), "uploaded_by": user.get("name")}
    await db.orders.update_one({"_id": oid(oid_)}, {"$push": {"attachments": att}})
    await _order_timeline(user, oid_, f"Attachment uploaded: {att['name']}")
    await log_audit(user, "attachment_uploaded", "order", oid_, f"Attachment added to {o['order_number']}")
    return _order_ser(await db.orders.find_one({"_id": oid(oid_)}))


@api.delete("/orders/{oid_}/attachments/{aid}")
async def delete_attachment(oid_: str, aid: str, request: Request):
    user = await get_user(request)
    o = await db.orders.find_one(org_filter(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    await db.orders.update_one({"_id": oid(oid_)}, {"$pull": {"attachments": {"id": aid}}})
    return _order_ser(await db.orders.find_one({"_id": oid(oid_)}))


@api.get("/order-dashboard")
async def order_dashboard(request: Request):
    user = await get_user(request)
    base = {"organization_id": user["organization_id"]}
    orders = await db.orders.find(base).to_list(5000)
    kpis = {"total": len(orders)}
    for st in ORDER_STAGES:
        kpis[st] = sum(1 for o in orders if o.get("status") == st)
    kpis["overdue"] = sum(1 for o in orders if order_due_status(o) == "overdue")
    today = datetime.now(timezone.utc).date()
    todays = []
    due_soon = []
    recent_completed = []
    attention = []
    for o in orders:
        s = _order_ser(o)
        try:
            od = datetime.fromisoformat((o.get("order_date") or o.get("created_at")).replace("Z", "+00:00")).date()
            if od == today:
                todays.append(s)
        except Exception:
            pass
        if s["due_status"] == "due_soon":
            due_soon.append(s)
        if s["due_status"] == "overdue":
            attention.append({"level": "red", "label": f"{o['order_number']} overdue · {o.get('customer_name','')}", "link": "/orders"})
        if o.get("status") == "completed":
            recent_completed.append(s)
    recent_completed.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    for o in orders:
        if o.get("status") == "on_hold":
            attention.append({"level": "amber", "label": f"{o['order_number']} on hold · {o.get('customer_name','')}", "link": "/orders"})
    return {
        "kpis": kpis,
        "pipeline": {"received": kpis["received"], "processing": kpis["processing"], "completed": kpis["completed"]},
        "todays": todays[:8], "due_soon": sorted(due_soon, key=lambda x: x.get("due_date", ""))[:8],
        "recent_completed": recent_completed[:8], "attention": attention[:8],
    }


@api.get("/order-reports")
async def order_reports(request: Request):
    user = await get_user(request)
    orders = await db.orders.find({"organization_id": user["organization_id"]}).to_list(5000)
    by_status = {st: sum(1 for o in orders if o.get("status") == st) for st in ORDER_STAGES}
    overdue = sum(1 for o in orders if order_due_status(o) == "overdue")
    by_assignee = {}
    by_customer = {}
    by_month = {}
    for o in orders:
        by_assignee[o.get("assigned_to") or "Unassigned"] = by_assignee.get(o.get("assigned_to") or "Unassigned", 0) + 1
        by_customer[o.get("customer_name") or "—"] = by_customer.get(o.get("customer_name") or "—", 0) + 1
        try:
            m = datetime.fromisoformat((o.get("order_date") or o.get("created_at")).replace("Z", "+00:00")).strftime("%b %Y")
            by_month[m] = by_month.get(m, 0) + 1
        except Exception:
            pass
    top = lambda d: [{"name": k, "count": v} for k, v in sorted(d.items(), key=lambda x: x[1], reverse=True)[:8]]
    return {"total": len(orders), "by_status": by_status, "overdue": overdue,
            "by_assignee": top(by_assignee), "by_customer": top(by_customer),
            "by_month": [{"name": k, "count": v} for k, v in by_month.items()]}


@api.get("/order-search")
async def order_search(request: Request, q: str = Query(...)):
    user = await get_user(request)
    if not q:
        return {"orders": [], "customers": []}
    rx = {"$regex": q, "$options": "i"}
    base = {"organization_id": user["organization_id"]}
    orders = await db.orders.find({**base, "$or": [{"order_number": rx}, {"customer_name": rx}, {"product": rx}]}).limit(6).to_list(6)
    customers = await db.customers.find({**base, "$or": [{"name": rx}, {"phone": rx}, {"company": rx}]}).limit(6).to_list(6)
    return {"orders": [ser(o) for o in orders], "customers": [ser(c) for c in customers]}


# ================= PLATFORM ADMIN =================
INDUSTRY_LABELS = {"fleet": "Fleet & Rental", "fabric_order_management": "Fabric Order Management"}
DEFAULT_MODULES = {
    "fleet": ["dashboard", "fleet", "drivers", "rentals", "service", "locations", "documents", "incidents", "health", "reports", "settings"],
    "fabric_order_management": ["dashboard", "orders", "customers", "reports", "settings"],
}


def require_platform(user):
    if user.get("role") != "platform_admin":
        raise HTTPException(status_code=403, detail="Platform administrators only")


async def _company_row(o):
    uc = await db.users.count_documents({"organization_id": o["org_id"]})
    return {"org_id": o["org_id"], "name": o.get("name"), "industry": o.get("industry"),
            "industry_label": INDUSTRY_LABELS.get(o.get("industry"), o.get("industry")),
            "plan": o.get("plan", "Trial"), "status": o.get("status", "trial"), "users": uc,
            "created_at": o.get("created_at"), "modules": o.get("modules", []),
            "contact_name": o.get("contact_name"), "email": o.get("email"), "phone": o.get("phone"),
            "code": o.get("code"), "logo": o.get("logo")}


@api.get("/platform/summary")
async def platform_summary(request: Request):
    user = await get_user(request); require_platform(user)
    orgs = await db.organizations.find({"industry": {"$ne": "platform"}}).to_list(500)
    ids = [o["org_id"] for o in orgs]
    return {"total_companies": len(orgs),
            "active_companies": sum(1 for o in orgs if o.get("status") == "active"),
            "trial_companies": sum(1 for o in orgs if o.get("status") == "trial"),
            "total_users": await db.users.count_documents({"organization_id": {"$in": ids}}),
            "active_subscriptions": sum(1 for o in orgs if o.get("status") == "active")}


@api.get("/platform/companies")
async def platform_companies(request: Request, q: Optional[str] = None, industry: Optional[str] = None, status: Optional[str] = None):
    user = await get_user(request); require_platform(user)
    filt = {"industry": {"$ne": "platform"}}
    if industry and industry != "all": filt["industry"] = industry
    if status and status != "all": filt["status"] = status
    orgs = await db.organizations.find(filt).sort("created_at", 1).to_list(500)
    rows = [await _company_row(o) for o in orgs]
    if q:
        rows = [r for r in rows if q.lower() in (r["name"] or "").lower() or q.lower() in (r.get("code") or "").lower()]
    return rows


@api.get("/platform/companies/{org_id}")
async def platform_company(org_id: str, request: Request):
    user = await get_user(request); require_platform(user)
    o = await db.organizations.find_one({"org_id": org_id})
    if not o:
        raise HTTPException(status_code=404, detail="Company not found")
    row = await _company_row(o)
    last = await db.audit_logs.find({"organization_id": org_id}).sort("created_at", -1).limit(1).to_list(1)
    row["last_activity"] = last[0]["created_at"] if last else None
    return row


@api.post("/platform/companies")
async def platform_add_company(body: dict, request: Request):
    user = await get_user(request); require_platform(user)
    industry = body.get("industry", "fleet")
    if industry == "fabric_order_management":
        raise HTTPException(status_code=400, detail="This industry is no longer available")
    raw_code = (body.get("code") or body.get("name", "")).strip().lower()
    code = re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", raw_code)).strip("-")
    if not body.get("name") or not code:
        raise HTTPException(status_code=400, detail="Company name and code are required")
    if await db.organizations.find_one({"org_id": code}):
        raise HTTPException(status_code=400, detail="Company code already exists")
    admin = body.get("admin") or {}
    admin_email = (admin.get("email") or "").lower().strip()
    if admin_email and await db.users.find_one({"email": admin_email}):
        raise HTTPException(status_code=400, detail="Admin email already exists")
    doc = {"org_id": code, "name": body.get("name"), "industry": industry,
           "modules": DEFAULT_MODULES.get(industry, []), "max_file_mb": 10,
           "plan": body.get("plan", "Trial"), "status": body.get("status", "trial"),
           "contact_name": admin.get("name") or body.get("contact_name"), "email": admin_email or body.get("email"),
           "phone": admin.get("phone") or body.get("phone"), "code": code, "logo": body.get("logo"), "created_at": now_iso()}
    await db.organizations.insert_one(doc)
    admin_out = None
    if admin_email and admin.get("password"):
        udoc = {"email": admin_email, "password_hash": authlib.hash_password(admin["password"]),
                "name": admin.get("name") or "Company Admin", "role": "company_admin",
                "phone": admin.get("phone"), "city": None, "organization_id": code, "created_at": now_iso()}
        await db.users.insert_one(udoc)
        admin_out = {"name": udoc["name"], "email": admin_email}
    row = await _company_row(doc)
    return {"company": row, "admin": admin_out}


# ==================== MyEVRental — daily EV auto rental ====================
IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT_DEPOSIT = 5000

RZP_KEY = os.environ.get("RAZORPAY_KEY_ID") or ""
RZP_SECRET = os.environ.get("RAZORPAY_KEY_SECRET") or ""
RZP_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET") or ""
rzp_client = razorpay.Client(auth=(RZP_KEY, RZP_SECRET)) if (RZP_KEY and RZP_SECRET) else None


def _today_ist():
    return datetime.now(IST).date()




def require_driver(user):
    if user.get("role") != "driver":
        raise HTTPException(status_code=403, detail="Drivers only")


async def _require_rental_admin(user):
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    org = await db.organizations.find_one({"org_id": user["organization_id"]})
    if (org or {}).get("industry", "fleet") != "fleet":
        raise HTTPException(status_code=403, detail="Rental management is not enabled for this organization")


async def _active_rental(org, did):
    return await db.rentals.find_one({"organization_id": org, "driver_id": did, "status": {"$ne": "closed"}})


async def _rental_account(rental):
    """Fetch a driver's rental account server-side. Single source of truth for post-paid odometer billing."""
    org = rental["organization_id"]
    did = rental["driver_id"]
    rate = rental.get("daily_rate", 0)
    today = _today_ist()
    
    existing = await db.rental_accounts.find_one({"organization_id": org, "driver_id": did})
    
    outstanding = existing.get("outstanding_amount", 0) if existing else 0
    unpaid = existing.get("unpaid_dates", []) if existing else []
    
    overdue = len(unpaid)
    
    if outstanding >= (rate * 2) and rate > 0:
        status = "blocked"
    elif outstanding >= rate and rate > 0:
        status = "overdue"
    else:
        status = "active"
        
    today_paid = existing.get("today_paid", False) if existing else False
    if today.isoformat() not in unpaid and outstanding == 0:
        today_paid = True # Assume paid if not unpaid and no outstanding
        
    reactivated_at = (existing or {}).get("reactivated_at")
    if existing and existing.get("status") == "blocked" and status == "active":
        reactivated_at = now_iso()
        
    acct = {
        "organization_id": org, "driver_id": did, "rental_id": str(rental["_id"]),
        "outstanding_amount": outstanding, "overdue_days": overdue, "status": status,
        "unpaid_dates": unpaid, "today_date": today.isoformat(), "today_paid": today_paid,
        "daily_rate": rate, "reactivated_at": reactivated_at, "updated_at": now_iso(),
    }
    # IMPORTANT: Never overwrite outstanding_amount via $set — it is managed only by $inc
    # Only update metadata fields, not the balance
    await db.rental_accounts.update_one(
        {"organization_id": org, "driver_id": did},
        {
            "$set": {
                "rental_id": str(rental["_id"]),
                "status": status,
                "overdue_days": overdue,
                "today_date": today.isoformat(),
                "today_paid": today_paid,
                "daily_rate": rate,
                "reactivated_at": reactivated_at,
                "updated_at": now_iso(),
            },
            "$setOnInsert": {
                "created_at": now_iso(),
                "outstanding_amount": 0,
                "unpaid_dates": [],
            }
        }, 
        upsert=True
    )
    return acct


async def _driver_payload(user):
    org = user["organization_id"]
    did = user["id"]
    rental = await _active_rental(org, did)
    dep = await db.security_deposits.find_one({"organization_id": org, "driver_id": did})
    out = {
        "driver": {"id": did, "name": user.get("name"), "phone": user.get("phone"), "city": user.get("city"),
                   "kyc_status": user.get("kyc_status"),
                   "kyc_approved_seen": user.get("kyc_approved_seen", False),
                   "kyc_snoozed_until": user.get("kyc_snoozed_until"),
                   "last_odometer_date": user.get("last_odometer_date"),
                   "active_trip_id": user.get("active_trip_id"),
                   "current_month_kms": user.get("current_month_kms", 0),
                   "current_month": user.get("current_month"),
                   "today_driven_km": user.get("today_driven_km", 0),
                   "today_overage_km": user.get("today_overage_km", 0),
                   "package_name": user.get("package_name"),
                   "package_rate": user.get("package_rate"),
                   "vehicle_id": user.get("current_vehicle_id") or user.get("vehicle_id"), 
                   "vehicle_reg": user.get("current_vehicle_number") or user.get("vehicle_number"),
                   "vehicle_plate": user.get("current_vehicle_reg") or user.get("vehicle_reg")},
        "deposit": ser(dep) if dep else None,
        "rental": None, "account": None,
    }
    if rental:
        acct = await _rental_account(rental)
        
        # Get dynamic limit from the plan
        plan = None
        if rental.get("plan_id"):
            plan = await db.rental_plans.find_one({"_id": oid(rental["plan_id"])})
        elif rental.get("package_name"):
            plan = await db.rental_plans.find_one({
                "name": {"$regex": f"^{rental['package_name']}$", "$options": "i"},
                "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"},
                "organization_id": org
            })
            
        out["driver"]["package_limit_km"] = plan.get("monthly_km_limit", 0) if plan else 0
        out["driver"]["monthly_km_limit"] = plan.get("monthly_km_limit", 0) if plan else 0
        
        if plan:
            import calendar
            from datetime import datetime
            now = datetime.now()
            days_in_month = calendar.monthrange(now.year, now.month)[1]
            out["driver"]["daily_limit_km"] = round(plan.get("monthly_km_limit", 0) / days_in_month) if days_in_month else 0
            out["driver"]["overage_per_km"] = plan.get("overage_per_km", 0.0)
            
            if out["deposit"] and out["deposit"].get("status") != "paid":
                out["deposit"]["amount"] = plan.get("deposit", out["deposit"]["amount"])
            elif not out["deposit"]:
                out["deposit"] = {"status": "pending", "amount": plan.get("deposit", 5000)}
            
            rental["daily_rate"] = plan.get("amount", rental["daily_rate"])
        else:
            out["driver"]["daily_limit_km"] = 0
            out["driver"]["overage_per_km"] = 0.0
            
        start_str = rental.get("start", rental.get("start_date", ""))
        
        # Override with today's snapshot rate if they already took a trip today
        today_str = _today_ist().strftime("%Y-%m-%d")
        today_log = await db.driver_odometer_logs.find_one({"driver_id": did, "date": today_str})
        if today_log and "snapshot_daily_rent" in today_log:
            rental["daily_rate"] = float(today_log["snapshot_daily_rent"])
            
        out["rental"] = {"id": str(rental["_id"]), "package_id": rental.get("package_id"),
                         "package_name": rental["package_name"], "daily_rate": rental["daily_rate"],
                         "start_date": start_str, "vehicle_reg": rental.get("vehicle_number", "")}
                         
        if rental.get("vehicle_id") and not out["driver"].get("vehicle_plate"):
            try:
                v_doc = await db.vehicles.find_one({"_id": oid(rental["vehicle_id"])})
                if v_doc:
                    out["driver"]["vehicle_plate"] = v_doc.get("registration_number")
            except:
                pass
                
        out["account"] = acct
    return out


async def _apply_paid(rec, txn, method, gateway_ref=None):
    if rec.get("payment_status") == "paid":
        return
    await db.rental_payments.update_one({"_id": rec["_id"]}, {"$set": {
        "payment_status": "paid", "transaction_id": txn, "payment_method": method,
        "gateway_ref": gateway_ref, "paid_at": now_iso()}})
    org = rec["organization_id"]
    did = rec["driver_id"]
    if rec["kind"] == "deposit":
        await db.security_deposits.update_one({"organization_id": org, "driver_id": did},
            {"$set": {"status": "paid", "transaction_id": txn, "paid_at": now_iso()}})
    elif rec["kind"] in ["daily", "outstanding"]:
        existing_acct = await db.rental_accounts.find_one({"organization_id": org, "driver_id": did})
        if existing_acct:
            new_outstanding = max(0.0, round(float(existing_acct.get("outstanding_amount", 0)) - float(rec["amount"]), 2))
            remaining_dates = [d for d in existing_acct.get("unpaid_dates", []) if d not in rec.get("covers_dates", [])]
            await db.rental_accounts.update_one(
                {"organization_id": org, "driver_id": did},
                {"$set": {
                    "outstanding_amount": new_outstanding,
                    "unpaid_dates": remaining_dates if new_outstanding > 0 else [],
                    "today_paid": new_outstanding == 0,
                }}
            )
    rental = await _active_rental(org, did)
    if rental:
        acct = await _rental_account(rental)
        await add_notification(org, "green", "Rental payment received",
                               f"{rental.get('driver_name')} paid ₹{rec['amount']} ({rec['kind']}).",
                               link=f"/rental-drivers/{did}")


class DriverOTPRequest(BaseModel):
    phone: str

@api.post("/driver/auth/request-otp")
async def driver_request_otp(body: DriverOTPRequest):
    phone = re.sub(r"\s+", "", body.phone or "")
    await _check_lockout("driver:" + phone)
    u = await db.drivers.find_one({"phone": phone})
    if not u:
        raise HTTPException(status_code=400, detail="Driver not found with this mobile number")
    
    otp = str(secrets.randbelow(900000) + 100000)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    print(f"\n--- DEBUG OTP for {phone} ---: {otp}\n")
    await db.otp_codes.update_one(
        {"phone": phone},
        {"$set": {"otp": otp, "expires_at": expires_at.isoformat()}},
        upsert=True
    )
    
    api_id = os.environ.get("BULKSMSPLANS_API_ID")
    if api_id:
        url = "https://bulksmsplans.com/api/send_sms"
        params = {
            "api_id": api_id,
            "api_password": os.environ.get("BULKSMSPLANS_API_PASSWORD"),
            "sms_type": "Transactional",
            "sms_encoding": "text",
            "sender": os.environ.get("BULKSMSPLANS_SENDER_ID", "ROUTEX"),
            "number": phone[-10:] if len(phone) >= 10 else phone,
            "message": f"Your Route39 app verification OTP is {otp}. Keep it confidential for your security.",
            "template_id": os.environ.get("BULKSMSPLANS_TEMPLATE_ID", "")
        }
        try:
            res = requests.post(url, params=params, timeout=5)
            logging.info(f"BulkSMSPlans response: {res.text}")
        except Exception as e:
            logging.warning(f"Failed to send SMS: {e}")
    else:
        logging.info(f"BulkSMSPlans not configured. Generated OTP for {phone}: {otp}")
        
    return {"message": "OTP sent successfully", "test_otp": otp}


class DriverLogin(BaseModel):
    phone: str
    otp: str


@api.post("/driver/auth/login")
async def driver_login(body: DriverLogin, response: Response):
    phone = re.sub(r"\s+", "", body.phone or "")
    await _check_lockout("driver:" + phone)
    
    u = await db.drivers.find_one({"phone": phone})
    if not u:
        raise HTTPException(status_code=401, detail="Invalid phone or OTP")
        
    otp_record = await db.otp_codes.find_one({"phone": phone, "otp": body.otp})
    if not otp_record:
        # Increment lockout
        await db.login_attempts.update_one(
            {"identifier": "driver:" + phone},
            {"$inc": {"count": 1}, "$set": {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}},
            upsert=True)
        raise HTTPException(status_code=401, detail="Invalid phone or OTP")
        
    expires_at = datetime.fromisoformat(otp_record["expires_at"])
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=401, detail="OTP has expired")
        
    await db.otp_codes.delete_one({"phone": phone})
    await db.login_attempts.delete_one({"identifier": "driver:" + phone})
    token = set_driver_auth_cookies(response, str(u["_id"]), u.get("phone", ""))
    return {"token": token, "driver": ser(u)}

@api.post("/driver/auth/logout")
async def driver_logout(response: Response):
    response.delete_cookie("driver_access_token", path="/")
    response.delete_cookie("driver_refresh_token", path="/")
    return {"ok": True}


@api.get("/driver/me")
async def driver_me(request: Request):
    user = await get_user(request)
    require_driver(user)
    return await _driver_payload(user)

import shutil
import uuid
from datetime import timedelta

@api.post("/driver/kyc/snooze")
async def snooze_kyc(request: Request):
    user = await get_user(request)
    require_driver(user)
    # Snooze for 6 hours
    snooze_time = (datetime.now() + timedelta(hours=6)).isoformat()
    await db.drivers.update_one({"_id": oid(user["id"])}, {"$set": {"kyc_snoozed_until": snooze_time}})
    return {"ok": True}

@api.post("/driver/kyc/ack-approved")
async def ack_kyc_approved(request: Request):
    user = await get_user(request)
    require_driver(user)
    await db.drivers.update_one({"_id": oid(user["id"])}, {"$set": {"kyc_approved_seen": True}})
    return {"ok": True}
@api.post("/driver/kyc")
async def submit_driver_kyc(
    request: Request,
    dl_front: UploadFile = File(...),
    dl_back: UploadFile = File(...),
    aadhaar: UploadFile = File(...),
    pan: UploadFile = File(...),
    lat: str = Form(""),
    lng: str = Form(""),
    address: str = Form("")
):
    user = await get_user(request)
    require_driver(user)
    
    docs = {}
    for name, file in [("dl_front", dl_front), ("dl_back", dl_back), ("aadhaar", aadhaar), ("pan", pan)]:
        ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
        filename = f"{user['id']}_{name}_{uuid.uuid4().hex[:8]}.{ext}"
        path = f"uploads/{filename}"
        with open(path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        docs[name] = f"/uploads/{filename}"
        
    await db.drivers.update_one(
        {"_id": ObjectId(user["id"])},
        {"$set": {
            "kyc_status": "submitted",
            "kyc_documents": docs,
            "location": {"lat": lat, "lng": lng, "address": address},
            "kyc_submitted_at": now_iso()
        }}
    )
    return {"ok": True, "message": "KYC Submitted successfully"}

from datetime import datetime


class AdminOdometerBody(BaseModel):
    reading: int

@api.post("/admin/drivers/{driver_id}/odometer")
async def admin_submit_odometer(driver_id: str, body: AdminOdometerBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    
    driver = await db.drivers.find_one(org_filter(user, {"_id": oid(driver_id)}))
    if not driver:
        raise HTTPException(404, "Driver not found")
        
    reading = body.reading
    today = datetime.utcnow().strftime("%Y-%m-%d")
    current_month_str = datetime.utcnow().strftime("%Y-%m")
    url = ""  # No image for admin override
    
    active_trip_id = driver.get("active_trip_id")
    
    if not active_trip_id:
        # START TRIP
        acct = await db.rental_accounts.find_one({"driver_id": driver_id})
        
        # (Removed daily rent addition at start; it will be added at end trip)
        res = await db.driver_odometer_logs.insert_one({
            "driver_id": driver_id,
            "organization_id": driver.get("organization_id"),
            "date": today,
            "start_reading": reading,
            "start_image_url": url,
            "status": "active",
            "created_at": now_iso()
        })
        
        await db.drivers.update_one(
            {"_id": ObjectId(driver_id)},
            {"$set": {
                "active_trip_id": str(res.inserted_id),
                "last_odometer_date": today
            }}
        )
        return {"ok": True, "message": "Trip started successfully by admin"}
    else:
        # END TRIP
        log = await db.driver_odometer_logs.find_one({"_id": ObjectId(active_trip_id)})
        if not log:
            await db.drivers.update_one({"_id": ObjectId(driver_id)}, {"$unset": {"active_trip_id": ""}})
            raise HTTPException(400, "Active trip not found. Please start a new trip.")
            
        start_reading = log.get("start_reading", reading)
        if reading < start_reading:
            raise HTTPException(400, f"Ending reading ({reading}) cannot be less than starting reading ({start_reading}).")
            
        driven = reading - start_reading
        
        current_month_kms = driver.get("current_month_kms", 0)
        if driver.get("current_month") != current_month_str:
            current_month_kms = 0
            
        current_month_kms += driven
        
        await db.driver_odometer_logs.update_one(
            {"_id": ObjectId(active_trip_id)},
            {"$set": {
                "end_reading": reading,
                "end_image_url": url,
                "driven_today": driven,
                "status": "completed",
                "completed_at": now_iso()
            }}
        )
        
        # Calculate Billing and Overages
        rental = await _active_rental(driver.get("organization_id"), driver_id)
        daily_rate = rental.get("daily_rate", 0) if rental else 0
        
        limit_km = 0
        overage_per_km = 0.0
        
        if rental:
            plan = None
            if rental.get("package_id"):
                plan = await db.rental_plans.find_one({"_id": oid(rental["package_id"])})
            elif rental.get("package_name"):
                plan = await db.rental_plans.find_one({
                    "name": {"$regex": f"^{rental['package_name']}$", "$options": "i"}, 
                    "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"},
                    "organization_id": driver.get("organization_id")
                })
                
            daily_limit_km = 0
            overage_per_km = 0.0
            if plan:
                monthly_limit_km = plan.get("monthly_km_limit", 0)
                overage_per_km = plan.get("overage_per_km", 0.0)
                
                import calendar
                now = datetime.now()
                days_in_month = calendar.monthrange(now.year, now.month)[1]
                
                daily_limit_km = round(monthly_limit_km / days_in_month) if days_in_month else 0
                
        overage_km = max(0, driven - daily_limit_km)
        overage_charge = overage_km * overage_per_km
        
        total_charge = daily_rate + overage_charge
        
        if total_charge > 0:
            await db.rental_accounts.update_one(
                {"driver_id": driver_id},
                {
                    "$inc": {"outstanding_amount": total_charge},
                    "$addToSet": {"unpaid_dates": today}
                },
                upsert=True
            )
            
        await db.drivers.update_one(
            {"_id": ObjectId(driver_id)},
            {
                "$set": {
                    "last_odometer_reading": reading,
                    "current_month_kms": current_month_kms,
                    "current_month": current_month_str
                },
                "$unset": {
                    "active_trip_id": ""
                }
            }
        )
        
        await db.driver_odometer_logs.update_one(
            {"_id": ObjectId(active_trip_id)},
            {"$set": {
                "snapshot_daily_rent": daily_rate,
                "snapshot_package_name": plan['name'] if plan else (rental.get('package_name', '') if rental else ''),
                "snapshot_daily_limit": daily_limit_km,
                "snapshot_overage_per_km": overage_per_km,
                "snapshot_monthly_limit": monthly_limit_km if plan else 0
            }}
        )

        msg = f"Trip ended by admin! Driven: {driven} km."
        if overage_km > 0:
            msg += f" (Overage: {overage_km} km / ₹{overage_charge})"
        return {"ok": True, "message": msg}


@api.post("/driver/odometer")
async def submit_odometer(
    request: Request,
    reading: int = Form(...),
    image: UploadFile = File(...)
):
    user = await get_user(request)
    require_driver(user)
    
    today = datetime.utcnow().strftime("%Y-%m-%d")
    current_month_str = datetime.utcnow().strftime("%Y-%m")
    
    ext = image.filename.split(".")[-1] if "." in image.filename else "jpg"
    filename = f"{user['id']}_odo_{uuid.uuid4().hex[:8]}.{ext}"
    path = f"uploads/{filename}"
    with open(path, "wb") as buffer:
        shutil.copyfileobj(image.file, buffer)
    url = f"/uploads/{filename}"
    
    active_trip_id = user.get("active_trip_id")
    
    if not active_trip_id:
        # START TRIP
        acct = await db.rental_accounts.find_one({"driver_id": user["id"]})
        if acct and acct.get("outstanding_amount", 0) > 0:
            raise HTTPException(400, f"You must pay your outstanding rent (₹{acct['outstanding_amount']}) before starting today's trip.")
            
        # (Removed daily rent addition at start; it will be added at end trip)
        res = await db.driver_odometer_logs.insert_one({
            "driver_id": user["id"],
            "organization_id": user.get("organization_id"),
            "date": today,
            "start_reading": reading,
            "start_image_url": url,
            "status": "active",
            "created_at": now_iso()
        })
        
        await db.drivers.update_one(
            {"_id": ObjectId(user["id"])},
            {"$set": {
                "active_trip_id": str(res.inserted_id),
                "last_odometer_date": today
            }}
        )
        return {"ok": True, "message": "Trip started successfully"}
    else:
        # END TRIP
        log = await db.driver_odometer_logs.find_one({"_id": ObjectId(active_trip_id)})
        if not log:
            # Fallback if log was deleted manually
            await db.drivers.update_one({"_id": ObjectId(user["id"])}, {"$unset": {"active_trip_id": ""}})
            raise HTTPException(400, "Active trip not found. Please start a new trip.")
            
        start_reading = log.get("start_reading", reading)
        if reading < start_reading:
            raise HTTPException(400, f"Ending reading ({reading}) cannot be less than starting reading ({start_reading}).")
            
        driven = reading - start_reading
        
        current_month_kms = user.get("current_month_kms", 0)
        if user.get("current_month") != current_month_str:
            current_month_kms = 0
        
        # NOTE: Only KMs up to the daily limit count toward the monthly total.
        # Overage KMs are billed separately and do NOT reduce the monthly limit.
        # We need the daily_limit_km to clamp this - fetch plan first.
        
        await db.driver_odometer_logs.update_one(
            {"_id": ObjectId(active_trip_id)},
            {"$set": {
                "end_reading": reading,
                "end_image_url": url,
                "driven_today": driven,
                "status": "completed",
                "completed_at": now_iso()
            }}
        )
        
        # Calculate Billing and Overages
        rental = await _active_rental(user.get("organization_id"), user["id"])
        daily_rate = rental.get("daily_rate", 0) if rental else 0
        
        limit_km = 0
        overage_per_km = 0.0
        
        if rental:
            plan = None
            if rental.get("package_id"):
                plan = await db.rental_plans.find_one({"_id": oid(rental["package_id"])})
            elif rental.get("package_name"):
                plan = await db.rental_plans.find_one({
                    "name": {"$regex": f"^{rental['package_name']}$", "$options": "i"}, 
                    "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"},
                    "organization_id": user.get("organization_id")
                })
                
            daily_limit_km = 0
            overage_per_km = 0.0
            if plan:
                monthly_limit_km = plan.get("monthly_km_limit", 0)
                overage_per_km = plan.get("overage_per_km", 0.0)
                
                # New logic: Calculate daily overage
                import calendar
                now = datetime.now()
                days_in_month = calendar.monthrange(now.year, now.month)[1]
                
                daily_limit_km = round(monthly_limit_km / days_in_month) if days_in_month else 0
                
        # Overage calculated ONLY for today's driven km
        overage_km = max(0, driven - daily_limit_km)
        overage_charge = overage_km * overage_per_km
        
        # ALL driven KMs (including extra/overage) reduce the monthly total
        # Extra KM also billed separately as overage charge
        current_month_kms += driven
        
        total_charge = daily_rate + overage_charge
        
        if total_charge > 0:
            total_charge = round(float(total_charge), 2)
            await db.rental_accounts.update_one(
                {"driver_id": user["id"], "organization_id": user.get("organization_id")},
                {
                    "$inc": {"outstanding_amount": total_charge},
                    "$addToSet": {"unpaid_dates": today}
                },
                upsert=True
            )
            
        # Update driver record - store today's driven km + monthly total (clamped)
        await db.drivers.update_one(
            {"_id": ObjectId(user["id"])},
            {
                "$set": {
                    "last_odometer_reading": reading,
                    "current_month_kms": current_month_kms,
                    "current_month": current_month_str,
                    "today_driven_km": driven,
                    "today_overage_km": overage_km,
                    "last_odometer_date": today
                },
                "$unset": {
                    "active_trip_id": ""
                }
            }
        )
        
        
        await db.driver_odometer_logs.update_one(
            {"_id": ObjectId(active_trip_id)},
            {"$set": {
                "snapshot_daily_rent": daily_rate,
                "snapshot_package_name": plan['name'] if plan else (rental.get('package_name', '') if rental else ''),
                "snapshot_daily_limit": daily_limit_km,
                "snapshot_overage_per_km": overage_per_km,
                "snapshot_monthly_limit": monthly_limit_km if plan else 0
            }}
        )
        
        msg = f"Trip ended! Driven: {driven} km."
        if overage_km > 0:
            msg += f" (Overage: {overage_km} km / ₹{overage_charge})"
        return {"ok": True, "message": msg}


@api.get("/driver/packages")
async def driver_packages(request: Request):
    user = await get_user(request)
    require_driver(user)
    pk = await db.rental_packages.find({"organization_id": user["organization_id"], "status": "active"}).sort("daily_rate", 1).to_list(100)
    return [ser(p) for p in pk]


@api.get("/driver/payments")
async def driver_payment_history(request: Request):
    user = await get_user(request)
    require_driver(user)
    recs = await db.rental_payments.find({
        "organization_id": user["organization_id"], 
        "driver_id": user["id"],
        "payment_status": {"$ne": "pending"}
    }).sort("created_at", -1).to_list(500)
    return [ser(r) for r in recs]


class CreateOrderBody(BaseModel):
    kind: str  # deposit | daily | outstanding


@api.post("/driver/payments/create-order")
async def driver_create_order(body: CreateOrderBody, request: Request):
    user = await get_user(request)
    require_driver(user)
    org = user["organization_id"]
    did = user["id"]
    kind = body.kind
    rental = await _active_rental(org, did)
    if kind != "deposit" and not rental:
        raise HTTPException(status_code=400, detail="No active rental")
    covers = []
    if kind == "deposit":
        dep = await db.security_deposits.find_one({"organization_id": org, "driver_id": did})
        if dep and dep.get("status") == "paid":
            raise HTTPException(status_code=400, detail="Deposit already paid")
        amount = 5000
        if rental:
            plan = None
            if rental.get("plan_id"): plan = await db.rental_plans.find_one({"_id": oid(rental["plan_id"])})
            elif rental.get("package_name"): plan = await db.rental_plans.find_one({"name": {"$regex": f"^{rental['package_name']}$", "$options": "i"}, "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"}, "organization_id": org})
            if plan: amount = plan.get("deposit", 5000)
        elif dep:
            amount = dep.get("amount", 5000)
    elif kind == "daily":
        acct = await _rental_account(rental)
        if acct["status"] == "blocked":
            raise HTTPException(status_code=400, detail="Account blocked. Clear outstanding first.")
        if acct["outstanding_amount"] <= 0:
            raise HTTPException(status_code=400, detail="No outstanding balance. Complete a trip first.")
        amount = acct["outstanding_amount"]
        covers = acct.get("unpaid_dates", [])
    elif kind == "outstanding":
        acct = await _rental_account(rental)
        if acct["outstanding_amount"] <= 0:
            raise HTTPException(status_code=400, detail="No outstanding amount")
        amount = acct["outstanding_amount"]
        covers = acct.get("unpaid_dates", [])
    else:
        raise HTTPException(status_code=400, detail="Invalid payment kind")
    rec = {"organization_id": org, "driver_id": did, "rental_id": str(rental["_id"]) if rental else None,
           "kind": kind, "amount": amount, "covers_dates": covers,
           "payment_status": "pending", "payment_method": None, "transaction_id": None,
           "gateway_order_id": None, "gateway_ref": None, "paid_at": None,
           "gateway": "razorpay" if rzp_client else "sandbox", "created_at": now_iso()}
    res = await db.rental_payments.insert_one(rec)
    pid = str(res.inserted_id)
    resp = {"payment_id": pid, "amount": amount, "amount_paise": amount * 100, "kind": kind, "gateway": rec["gateway"]}
    if rzp_client:
        order = rzp_client.order.create({"amount": amount * 100, "currency": "INR", "receipt": pid[:40], "payment_capture": 1})
        await db.rental_payments.update_one({"_id": res.inserted_id}, {"$set": {"gateway_order_id": order["id"]}})
        resp["order_id"] = order["id"]
        resp["key_id"] = RZP_KEY
    else:
        tok = secrets.token_hex(16)
        await db.rental_payments.update_one({"_id": res.inserted_id}, {"$set": {"sandbox_token": tok}})
        resp["sandbox_token"] = tok
    return resp


class VerifyBody(BaseModel):
    payment_id: str
    razorpay_order_id: Optional[str] = None
    razorpay_payment_id: Optional[str] = None
    razorpay_signature: Optional[str] = None
    sandbox_token: Optional[str] = None


@api.post("/driver/payments/verify")
async def driver_verify(body: VerifyBody, request: Request):
    user = await get_user(request)
    require_driver(user)
    rec = await db.rental_payments.find_one({"_id": oid(body.payment_id),
                                             "organization_id": user["organization_id"], "driver_id": user["id"]})
    if not rec:
        raise HTTPException(status_code=404, detail="Payment not found")
    if rec.get("payment_status") == "paid":
        return {"ok": True, "already": True, "transaction_id": rec.get("transaction_id")}
    if rec.get("gateway") == "razorpay":
        if not (body.razorpay_order_id and body.razorpay_payment_id and body.razorpay_signature):
            raise HTTPException(status_code=400, detail="Missing gateway parameters")
        try:
            rzp_client.utility.verify_payment_signature({
                "razorpay_order_id": body.razorpay_order_id,
                "razorpay_payment_id": body.razorpay_payment_id,
                "razorpay_signature": body.razorpay_signature})
        except Exception:
            await db.rental_payments.update_one({"_id": rec["_id"]}, {"$set": {"payment_status": "failed"}})
            raise HTTPException(status_code=400, detail="Payment signature verification failed")
        txn = body.razorpay_payment_id
        method = "razorpay"
    else:
        if not body.sandbox_token or body.sandbox_token != rec.get("sandbox_token"):
            raise HTTPException(status_code=403, detail="Invalid confirmation token")
        txn = "SBX-" + secrets.token_hex(6).upper()
        method = "sandbox"
    await _apply_paid(rec, txn, method)
    acct = None
    rental = await _active_rental(user["organization_id"], user["id"])
    if rental:
        acct = await _rental_account(rental)
    return {"ok": True, "transaction_id": txn, "paid_at": now_iso(), "kind": rec["kind"], "amount": rec["amount"], "account": acct}


@api.post("/driver/payments/webhook")
async def driver_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("X-Razorpay-Signature", "")
    if rzp_client and RZP_WEBHOOK_SECRET:
        try:
            rzp_client.utility.verify_webhook_signature(payload.decode(), sig, RZP_WEBHOOK_SECRET)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid webhook signature")
    try:
        data = json.loads(payload.decode() or "{}")
    except Exception:
        data = {}
    entity = (((data.get("payload") or {}).get("payment") or {}).get("entity") or {})
    order_id = entity.get("order_id")
    pay_id = entity.get("id")
    if order_id:
        rec = await db.rental_payments.find_one({"gateway_order_id": order_id})
        if rec and rec.get("payment_status") != "paid":
            await _apply_paid(rec, pay_id or "WEBHOOK", "razorpay", gateway_ref=order_id)
    return {"status": "ok"}


# ---------- MyVolt admin: Rental Drivers ----------
@api.get("/rental-admin/summary")
async def rental_admin_summary(request: Request):
    user = await get_user(request)
    await _require_rental_admin(user)
    org = user["organization_id"]
    rentals = await db.driver_rentals.find({"organization_id": org, "status": {"$ne": "ended"}}).to_list(2000)
    active = overdue = blocked = 0
    today_expected = today_collected = outstanding_total = 0
    for r in rentals:
        acct = await _rental_account(r)
        if acct["status"] == "blocked":
            blocked += 1
        elif acct["status"] == "overdue":
            overdue += 1
        else:
            active += 1
        today_expected += r["daily_rate"]
        if acct["today_paid"]:
            today_collected += r["daily_rate"]
        outstanding_total += acct["outstanding_amount"]
    deps = await db.security_deposits.find({"organization_id": org, "status": "paid"}).to_list(2000)
    deposits_collected = sum(d.get("amount", 0) for d in deps)
    return {"total_drivers": len(rentals), "active_rentals": active, "overdue_rentals": overdue,
            "blocked_rentals": blocked, "today_expected": today_expected, "today_collected": today_collected,
            "outstanding_total": outstanding_total, "deposits_collected": deposits_collected}


@api.get("/rental-admin/drivers")
async def rental_admin_drivers(request: Request, status: Optional[str] = None):
    user = await get_user(request)
    await _require_rental_admin(user)
    org = user["organization_id"]
    rentals = await db.driver_rentals.find({"organization_id": org, "status": {"$ne": "ended"}}).sort("created_at", -1).to_list(2000)
    rows = []
    for r in rentals:
        acct = await _rental_account(r)
        if status and status != "all" and acct["status"] != status:
            continue
        dep = await db.security_deposits.find_one({"organization_id": org, "driver_id": r["driver_id"]})
        rows.append({"driver_id": r["driver_id"], "driver_name": r["driver_name"], "phone": r.get("driver_phone"),
                     "vehicle_reg": r.get("vehicle_reg"), "package_name": r["package_name"], "daily_rate": r["daily_rate"],
                     "deposit_status": (dep or {}).get("status", "pending"), "deposit_amount": (dep or {}).get("amount", DEFAULT_DEPOSIT),
                     "outstanding": acct["outstanding_amount"], "overdue_days": acct["overdue_days"],
                     "status": acct["status"], "today_paid": acct["today_paid"], "start_date": r["start_date"]})
    return rows


@api.get("/rental-admin/drivers/{driver_id}")
async def rental_admin_driver(driver_id: str, request: Request):
    user = await get_user(request)
    await _require_rental_admin(user)
    org = user["organization_id"]
    r = await db.driver_rentals.find_one({"organization_id": org, "driver_id": driver_id})
    if not r:
        raise HTTPException(status_code=404, detail="Rental driver not found")
    acct = await _rental_account(r)
    dep = await db.security_deposits.find_one({"organization_id": org, "driver_id": driver_id})
    pays = await db.rental_payments.find({"organization_id": org, "driver_id": driver_id}).sort("created_at", -1).to_list(500)
    return {"rental": ser(r), "account": acct, "deposit": ser(dep) if dep else None, "payments": [ser(p) for p in pays]}


@api.get("/rental-admin/packages")
async def rental_admin_packages(request: Request):
    user = await get_user(request)
    await _require_rental_admin(user)
    pk = await db.rental_packages.find({"organization_id": user["organization_id"]}).sort("daily_rate", 1).to_list(100)
    return [ser(p) for p in pk]


class PackageBody(BaseModel):
    name: str
    daily_rate: int
    status: str = "active"


@api.post("/rental-admin/packages")
async def rental_admin_create_package(body: PackageBody, request: Request):
    user = await get_user(request)
    await _require_rental_admin(user)
    doc = {"organization_id": user["organization_id"], "name": body.name, "daily_rate": int(body.daily_rate),
           "status": body.status, "created_at": now_iso()}
    res = await db.rental_packages.insert_one(doc)
    return ser(await db.rental_packages.find_one({"_id": res.inserted_id}))


class NewRentalDriver(BaseModel):
    name: str
    phone: str
    password: str
    vehicle_reg: str
    package_id: str
    vehicle_id: Optional[str] = None


@api.post("/rental-admin/drivers")
async def create_rental_driver(body: NewRentalDriver, request: Request):
    user = await get_user(request)
    await _require_rental_admin(user)
    org = user["organization_id"]
    phone = re.sub(r"\s+", "", body.phone or "")
    if await db.users.find_one({"phone": phone, "role": "driver"}):
        raise HTTPException(status_code=400, detail="Driver phone already exists")
    pkg = await db.rental_packages.find_one({"_id": oid(body.package_id), "organization_id": org})
    if not pkg:
        raise HTTPException(status_code=400, detail="Invalid package")
    email = f"drv{re.sub(r'[^0-9]', '', phone)[-10:]}@ev.local"
    udoc = {"name": body.name, "phone": phone, "email": email, "role": "driver",
            "password_hash": authlib.hash_password(body.password), "organization_id": org,
            "vehicle_id": body.vehicle_id, "vehicle_reg": body.vehicle_reg, "created_at": now_iso()}
    res = await db.users.insert_one(udoc)
    did = str(res.inserted_id)
    rental = {"organization_id": org, "driver_id": did, "driver_name": body.name, "driver_phone": phone,
              "vehicle_id": body.vehicle_id, "vehicle_reg": body.vehicle_reg,
              "package_id": str(pkg["_id"]), "package_name": pkg["name"], "daily_rate": pkg["daily_rate"],
              "start_date": _today_ist().isoformat(), "status": "active", "created_at": now_iso()}
    rr = await db.driver_rentals.insert_one(rental)
    rental["_id"] = rr.inserted_id
    await db.security_deposits.insert_one({"organization_id": org, "driver_id": did, "amount": pkg.get("deposit", 5000),
                                           "status": "pending", "transaction_id": None, "paid_at": None, "created_at": now_iso()})
    await _rental_account(rental)
    await log_audit(user, "rental_driver_created", "rental_driver", did, f"Rental driver {body.name} onboarded")
    return {"driver_id": did}
# ---------- Universal CRUD Updates (Added) ----------


@api.put("/rentals/{rid}")
async def update_rental(rid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    body.pop("_id", None); body.pop("id", None)
    await db.rentals.update_one(org_filter(user, {"_id": oid(rid)}), {"$set": body})
    return {"ok": True}

@api.delete("/rentals/{rid}")
async def delete_rental(rid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    res = await db.rentals.delete_one(org_filter(user, {"_id": oid(rid)}))
    if res.deleted_count == 0: raise HTTPException(404)
    return {"ok": True}

@api.delete("/service-requests/{sid}")
async def delete_service_request(sid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    res = await db.service_requests.delete_one(org_filter(user, {"_id": oid(sid)}))
    if res.deleted_count == 0: raise HTTPException(404)
    return {"ok": True}

@api.put("/vehicle-services/{vsid}")
async def update_vehicle_service(vsid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    body.pop("_id", None); body.pop("id", None)
    await db.vehicle_services.update_one(org_filter(user, {"_id": oid(vsid)}), {"$set": body})
    return {"ok": True}

@api.delete("/vehicle-services/{vsid}")
async def delete_vehicle_service(vsid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    res = await db.vehicle_services.delete_one(org_filter(user, {"_id": oid(vsid)}))
    if res.deleted_count == 0: raise HTTPException(404)
    return {"ok": True}

@api.put("/locations/{lid}")
async def update_location(lid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    body.pop("_id", None); body.pop("id", None)
    await db.locations.update_one(org_filter(user, {"_id": oid(lid)}), {"$set": body})
    return {"ok": True}

@api.delete("/locations/{lid}")
async def delete_location(lid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    res = await db.locations.delete_one(org_filter(user, {"_id": oid(lid)}))
    if res.deleted_count == 0: raise HTTPException(404)
    return {"ok": True}

@api.put("/documents/{did}")
async def update_document(did: str, body: dict, request: Request):
    user = await get_user(request)
    body.pop("_id", None); body.pop("id", None)
    await db.documents.update_one(org_filter(user, {"_id": oid(did)}), {"$set": body})
    return {"ok": True}

@api.delete("/documents/{did}")
async def delete_document(did: str, request: Request):
    user = await get_user(request)
    res = await db.documents.delete_one(org_filter(user, {"_id": oid(did)}))
    if res.deleted_count == 0: raise HTTPException(404)
    return {"ok": True}


app.include_router(api)

@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True, sparse=True)
        await db.vehicles.create_index([("organization_id", 1), ("status", 1), ("city", 1)])
        await db.vehicles.create_index("registration_number")
        await db.drivers.create_index([("organization_id", 1), ("city", 1)])
        await db.drivers.create_index("phone")
        await db.rentals.create_index([("organization_id", 1), ("status", 1)])
        await db.service_requests.create_index([("organization_id", 1), ("status", 1)])
        await db.audit_logs.create_index([("organization_id", 1), ("created_at", -1)])
        await db.orders.create_index([("organization_id", 1), ("status", 1)])
        await db.customers.create_index([("organization_id", 1)])
        await db.users.create_index("phone")
        await db.rental_packages.create_index([("organization_id", 1)])
        await db.driver_rentals.create_index([("organization_id", 1), ("driver_id", 1)])
        await db.rental_payments.create_index([("organization_id", 1), ("driver_id", 1)])
        await db.security_deposits.create_index([("organization_id", 1), ("driver_id", 1)])
        await db.rental_accounts.create_index([("organization_id", 1), ("driver_id", 1)])
    except Exception as e:
        logger.warning(f"Failed to create indexes: {e}")
    # await seedlib.seed(db, authlib)  # disabled - do not reseed


@app.on_event("shutdown")
async def shutdown():
    client.close()
