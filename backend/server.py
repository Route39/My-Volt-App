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
from bson import ObjectId, Binary

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
    _su = getattr(request.state, "service_user", None)
    if _su:
        return _su
    _k = os.environ.get("CONNECT_API_KEY")
    if _k and request.method == "GET" and request.url.path.startswith("/api/connect/") and secrets.compare_digest(request.headers.get("X-API-Key", ""), _k):
        return {"id": "connect-integration", "role": "admin", "organization_id": os.environ.get("CONNECT_ORG_ID", "route39-org"), "name": "TheConnect"}
    user = await authlib.current_user_from_request(request, db)
    if not user.get("organization_id"):
        user["organization_id"] = "route39-org"
    return user


def org_filter(user: dict, extra: dict = None):
    f = {"organization_id": user.get("organization_id") or "route39-org"}
    if extra:
        f.update(extra)
    # City managers are restricted to their assigned city (applied last so a
    # client-supplied ?city=<other> can never override it)
    if user.get("role") == "city_manager" and user.get("city"):
        f["city"] = user["city"]
    return f


def require_role(user, allowed):
    if user.get("role") in ("admin", "company_admin"):
        return
    if user.get("role") not in allowed:
        raise HTTPException(status_code=403, detail="You do not have permission for this action")


async def log_audit(user, action, entity_type, entity_id=None, summary=""):
    await db.audit_logs.insert_one({
        "organization_id": user.get("organization_id"),
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
    users = await db.users.find({"organization_id": user.get("organization_id")}).to_list(500)
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
        "organization_id": user.get("organization_id"),
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
    org = await db.organizations.find_one({"org_id": user.get("organization_id")})
    return {"has_password": bool(org and org.get("package_password"))}

@api.post("/settings/package-password")
async def set_package_password(body: PackagePasswordBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin"])
    await db.organizations.update_one(
        {"org_id": user.get("organization_id")},
        {"$set": {"package_password": body.password}},
        upsert=True
    )
    return {"ok": True}

@api.post("/settings/package-password/verify")
async def verify_package_password(body: PackagePasswordBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    org = await db.organizations.find_one({"org_id": user.get("organization_id")})
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
    vin_number: Optional[str] = None
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
    doc["vin_number"] = (doc.get("vin_number") or "").strip().upper()
    if not doc["vin_number"]:
        raise HTTPException(status_code=400, detail="VIN Number is required")
    if not re.fullmatch(r"[A-Z0-9]{17}", doc["vin_number"]):
        raise HTTPException(status_code=400, detail="VIN Number must be exactly 17 characters (letters A-Z and numbers 0-9 only)")
    doc["organization_id"] = user.get("organization_id")
    if user.get("role") == "city_manager" and user.get("city"):
        doc["city"] = user["city"]  # city managers can only add vehicles in their own city
    doc["created_at"] = now_iso()
    res = await db.vehicles.insert_one(doc)
    await log_audit(user, "vehicle_created", "vehicle", str(res.inserted_id), f"Vehicle {body.vehicle_number} added")
    return ser(await db.vehicles.find_one({"_id": res.inserted_id}))

VEH_IMPORT_COLS = {"city": "city", "registrationnumber": "registration_number", "registrationno": "registration_number",
                   "regno": "registration_number", "regnumber": "registration_number", "registration": "registration_number",
                   "vinnumber": "vin_number", "vinno": "vin_number", "vin": "vin_number",
                   "chassisnumber": "chassis_number", "chassisno": "chassis_number", "model": "model"}
VEH_PREFIX = {"Coimbatore": "CBE", "Tiruppur": "TUP", "Chennai": "CHN", "Bangalore": "BAN"}


@api.post("/vehicles/import")
async def import_vehicles(request: Request, file: UploadFile = File(...)):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    import io
    raw = await file.read()
    fname = (file.filename or "").lower()
    if fname.endswith(".csv"):
        import csv
        rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig", errors="ignore"))))
    elif fname.endswith(".xlsx"):
        from openpyxl import load_workbook
        ws = load_workbook(io.BytesIO(raw), read_only=True, data_only=True).active
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
    else:
        raise HTTPException(status_code=400, detail="Upload an Excel (.xlsx) or CSV file")
    if len(rows) < 2:
        raise HTTPException(status_code=400, detail="File has no vehicle rows")
    header = [VEH_IMPORT_COLS.get(re.sub(r"[^a-z]", "", str(h or "").lower())) for h in rows[0]]
    required = ["city", "registration_number", "vin_number"]
    missing = [c for c in required if c not in header]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")
    org = user.get("organization_id")
    is_cm = user.get("role") == "city_manager" and user.get("city")
    created, errors, seen_reg, seen_vin = [], [], set(), set()
    for row_no, r in enumerate(rows[1:], start=2):
        rec = {}
        for idx, key in enumerate(header):
            if key and idx < len(r):
                rec[key] = _import_cell(r[idx])
        if not any(rec.values()):
            continue
        reg = re.sub(r"\s+", " ", (rec.get("registration_number") or "").upper()).strip()
        vin = re.sub(r"\s+", "", (rec.get("vin_number") or "").upper())
        city = user["city"] if is_cm else IMPORT_CITY_NAMES.get((rec.get("city") or "").strip().lower())
        err = None
        empty = [c for c in required if not rec.get(c)]
        if empty:
            err = f"Missing: {', '.join(empty)}"
        elif not city:
            err = f"Invalid city: {rec.get('city')}"
        elif not re.fullmatch(r"[A-Z0-9]{17}", vin):
            err = "VIN must be exactly 17 letters/numbers"
        elif reg in seen_reg:
            err = "Registration number repeated in file"
        elif vin in seen_vin:
            err = "VIN repeated in file"
        elif await db.vehicles.find_one({"organization_id": org, "registration_number": {"$regex": f"^{re.escape(reg)}$", "$options": "i"}}):
            err = "Registration number already exists"
        elif await db.vehicles.find_one({"organization_id": org, "vin_number": vin}):
            err = "VIN already exists"
        if err:
            errors.append({"row": row_no, "name": reg, "error": err})
            continue
        seen_reg.add(reg)
        seen_vin.add(vin)
        prefix = VEH_PREFIX.get(city, city[:3].upper())
        n = await db.vehicles.count_documents({"organization_id": org, "vehicle_number": {"$regex": f"^{prefix}"}}) + 1
        while await db.vehicles.find_one({"organization_id": org, "vehicle_number": f"{prefix}{n:03d}"}):
            n += 1
        doc = VehicleBody(vehicle_number=f"{prefix}{n:03d}", registration_number=reg, vin_number=vin, city=city,
                          chassis_number=rec.get("chassis_number") or None,
                          model=rec.get("model") or "Route39 EV").model_dump()
        doc["organization_id"] = org
        doc["created_at"] = now_iso()
        res = await db.vehicles.insert_one(doc)
        created.append({"id": str(res.inserted_id), "vehicle_number": doc["vehicle_number"]})
    if created:
        await log_audit(user, "vehicles_imported", "vehicle", "", f"{len(created)} vehicles imported from {file.filename}")
    return {"created": len(created), "vehicles": created, "errors": errors}

@api.put("/vehicles/{vid}")
async def update_vehicle(vid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    for k in ("id", "_id", "assignments", "services", "documents", "incidents", "service_requests", "current_rental"):
        body.pop(k, None)
    if "vin_number" in body:
        body["vin_number"] = (body.get("vin_number") or "").strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{17}", body["vin_number"]):
            raise HTTPException(status_code=400, detail="VIN Number must be exactly 17 characters (letters A-Z and numbers 0-9 only)")
    await db.vehicles.update_one(org_filter(user, {"_id": oid(vid)}), {"$set": body})
    await log_audit(user, "vehicle_updated", "vehicle", vid, "Vehicle updated")
    return ser(await db.vehicles.find_one({"_id": oid(vid)}))

@api.delete("/vehicles/{vid}")
async def delete_vehicle(vid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    org = user.get("organization_id")
    
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
        "organization_id": user.get("organization_id"), "vehicle_id": vid, "vehicle_number": v["vehicle_number"],
        "from_city": from_city, "to_city": to_city, "reason": body.get("reason", ""),
        "notes": body.get("notes", ""), "status": "completed", "created_at": now_iso()})
    await db.audit_logs.insert_one({
        "organization_id": user.get("organization_id"), "actor_id": user["id"], "actor_name": user.get("name"),
        "action": "vehicle_transferred", "entity_type": "vehicle", "entity_id": vid,
        "summary": f"Vehicle {v['vehicle_number']} moved {from_city} to {to_city}",
        "city": to_city, "created_at": now_iso(),
    })
    await add_notification(user.get("organization_id"), "blue", "Vehicle transferred",
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
    # --- optional: assign vehicle + package + supervisor while adding the driver ---
    vehicle_id: Optional[str] = None
    package_id: Optional[str] = None
    rental_start: Optional[str] = None
    rental_end: Optional[str] = None
    supervisor_id: Optional[str] = None
    rental_state: Optional[str] = None   # active | suspended | pending_payment | closed
    package_category: Optional[str] = None   # rental | commission | salary


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
    drv_filter = {"organization_id": user.get("organization_id")}
    if city and city != "all":
        drv_filter["city"] = city
    if user.get("role") == "city_manager" and user.get("city"):
        drv_filter["city"] = user["city"]
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
    
    # Total KM per driver per day (all trips of that day) for the daily-limit display
    day_totals = {}
    for _lg in logs:
        if _lg.get("type") == "catchup_rent":
            continue
        _k = (_lg["driver_id"], _lg.get("date"))
        day_totals[_k] = day_totals.get(_k, 0) + (_lg.get("driven_today", 0) or 0)

    out = []
    for log in logs:
        log["_id"] = str(log["_id"])
        drv = driver_map.get(log["driver_id"])
        log["driver_name"] = drv.get("name") if drv else "Unknown"
        log["driver_city"] = drv.get("city") if drv else ""
        log["driver_avatar"] = drv.get("avatar") if drv else None
        # Use snapshot progressive KMS if available (so each log shows the exact total at that time), fallback to current
        log["monthly_kms"] = log.get("snapshot_monthly_kms_used", drv.get("current_month_kms", 0) if drv else 0)
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
            
            # Freeze the snapshot into the DB so old logs don't drift on package updates.
            # Only do this once the trip has actually finished. A log that's still
            # "active" (ongoing) predates the start-time snapshot fix and must NOT be
            # frozen with today's live package values here — that would let a mid-trip
            # admin edit leak into a trip that's still running. It gets its real,
            # correct snapshot the moment the trip ends (see submit_odometer /
            # admin_submit_odometer), so for now this is just a live display estimate.
            if log.get("status") != "active":
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
        daily_limit = _effective_daily_limit(daily_limit, log.get("limit_kms", 0))
        day_total = day_totals.get((log["driver_id"], log.get("date")), driven_today)
        if "extra_km_charge" in log:
            # Trip already ended: show exactly what was billed for it
            extra_km = log.get("extra_km", 0)
            extra_km_charge = log.get("extra_km_charge", 0.0)
        else:
            extra_km = _daily_overage(day_total - driven_today, driven_today, daily_limit)
            extra_km_charge = round(extra_km * overage_per_km, 2)        
        log["daily_limit_km"] = daily_limit
        log["day_total_km"] = day_total
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
            {"driver_code": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.drivers.find(filt).sort("created_at", 1).to_list(None)
    for d in docs:
        cv_id = d.get("current_vehicle_id")
        if cv_id:
            try:
                v = await db.vehicles.find_one({"_id": oid(cv_id)})
                if v:
                    d["current_vehicle_reg"] = v.get("registration_number")
            except Exception:
                pass
                
        # Inject real-time rental block status
        rent_acct = await db.rental_accounts.find_one({"driver_id": str(d["_id"])})
        if rent_acct:
            today_str = _today_ist().isoformat()
            status = rent_acct.get("status", "active")
            grace = rent_acct.get("grace_period_until")
            if status == "blocked" and grace and grace >= today_str:
                status = "active"
            d["rental_block_status"] = status
        else:
            d["rental_block_status"] = "active"
            
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
    
    sec_dep = await db.security_deposits.find_one({"driver_id": did, "organization_id": user.get("organization_id") or "route39-org"})
    out["deposit_status"] = sec_dep.get("status", "pending") if sec_dep else "pending"
    _dep_amt = await _deposit_amount_for(user.get("organization_id") or "route39-org", did, sec_dep)
    _dep_src = dict(sec_dep) if sec_dep else {}
    _dep_src["amount"] = _dep_amt
    _dep_view = _deposit_decorate(_dep_src) if (sec_dep or _dep_amt) else {}
    out["deposit_amount"] = _dep_view.get("amount", 0)
    out["deposit_paid_amount"] = _dep_view.get("paid_amount", 0)
    out["deposit_remaining_amount"] = _dep_view.get("remaining_amount", 0)
    out["deposit_next_payment_date"] = (sec_dep or {}).get("next_payment_date")
    out["deposit_partial_enabled"] = bool((sec_dep or {}).get("partial_enabled"))
    out["deposit_partial_first_amount"] = (sec_dep or {}).get("partial_first_amount")
    out["deposit_partial_next_date"] = (sec_dep or {}).get("partial_next_date")
    out["deposit_first_paid_at"] = (sec_dep or {}).get("first_paid_at")
    out["deposit_second_paid_at"] = (sec_dep or {}).get("second_paid_at") if (sec_dep or {}).get("status") == "paid" else None
    out["deposit_first_amount"] = (sec_dep or {}).get("first_amount")
    out["deposit_first_txn"] = (sec_dep or {}).get("first_transaction_id")
    out["deposit_second_txn"] = (sec_dep or {}).get("transaction_id") if ((sec_dep or {}).get("status") == "paid" and (sec_dep or {}).get("second_paid_at")) else None
    
    cur_month = _today_ist().strftime("%Y-%m")
    joined_date = d.get("created_at") or _today_ist().isoformat()
    joined_month = joined_date[:7]
    out["leave_quota"] = 3  # max 3 paid leave days per month for every driver
    out["paid_leaves"] = d.get("paid_leaves", [])
    # The card counts only the days chosen in the admin "Paid Leave" calendar (paid_leave_dates)
    _all_leaves = set(d.get("paid_leave_dates") or [])
    out["leave_dates_this_month"] = sorted(dl for dl in _all_leaves if dl.startswith(cur_month))
    out["leaves_taken_this_month"] = len(out["leave_dates_this_month"])
    out["week_off_requests"] = [
        {"id": str(r["_id"]), "dates": r.get("dates", []), "status": r.get("status", "pending")}
        for r in await db.week_off_requests.find({"driver_id": did, "month": cur_month}).sort("created_at", -1).to_list(None)
    ]
    
    return out


@api.post("/admin/drivers/{did}/leave")
async def admin_grant_leave(did: str, request: Request, body: dict):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    
    target_date = body.get("date")
    if not target_date:
        raise HTTPException(status_code=400, detail="Date required")
        
    org = user.get("organization_id") or "route39-org"
    drv_doc = await db.drivers.find_one({"_id": oid(did), "organization_id": org})
    if not drv_doc:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    paid_leaves = drv_doc.get("paid_leaves", [])
    if target_date in paid_leaves:
        raise HTTPException(status_code=400, detail="Leave already applied for this date")
        
    await db.drivers.update_one({"_id": oid(did)}, {"$addToSet": {"paid_leaves": target_date}})
    
    # If the date is <= today, attempt to refund/reverse any already-accrued rent
    today_str = _today_ist().isoformat()
    if target_date <= today_str:
        acct = await db.rental_accounts.find_one({"driver_id": did})
        if acct and acct.get("rent_by_date", {}).get(target_date, 0) > 0:
            amt = acct["rent_by_date"][target_date]
            await db.rental_accounts.update_one(
                {"driver_id": did},
                {
                    "$unset": {f"rent_by_date.{target_date}": ""},
                    "$inc": {"rent_due": -amt, "outstanding_amount": -amt}
                }
            )
            
    return {"ok": True, "message": "Leave applied"}


@api.delete("/drivers/{did}")
async def delete_driver(did: str, request: Request, force: bool = False):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    
    # Find driver by org only (not city-restricted) so any city manager in the org can delete
    org = user.get("organization_id") or "route39-org"
    drv = await db.drivers.find_one({"_id": oid(did), "organization_id": org})
    if not drv:
        raise HTTPException(status_code=404, detail="Driver not found")
    
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
    await _sync_driver_code_counter()
    
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
    # the referral record of this driver (as the referred driver), so the same person can be referred again
    await db.referrals.delete_many({"$or": [{"referred_driver_id": did}, {"referred_phone": drv.get("phone")}]})
    
    # 5. Delete driver documents
    await db.documents.delete_many({"organization_id": org, "owner_type": "driver", "owner_id": did})
    
    await log_audit(user, "driver_deleted", "driver", did, f"Driver {drv.get('name')} and all associated data completely deleted")
    return {"ok": True}

async def _sync_driver_code_counter():
    # Reset only when no drivers remain; never reuse a deleted driver's code
    if await db.drivers.count_documents({"driver_code": {"$regex": "^R39D"}}) == 0:
        await db.counters.update_one({"_id": "driver_code"}, {"$set": {"seq": 0}}, upsert=True)




CITY_CODES = {
    "bangalore": "BAN", "bengaluru": "BAN",
    "chennai": "CHN",
    "coimbatore": "CBE",
    "tiruppur": "TUP", "tirupur": "TUP",
}


def _city_code(city):
    return CITY_CODES.get((city or "").strip().lower())


async def _next_driver_code(city: Optional[str] = None):
    code = _city_code(city)
    if not code:
        c = await db.counters.find_one_and_update(
            {"_id": "driver_code"}, {"$inc": {"seq": 1}},
            upsert=True, return_document=True
        )
        return f"R39D{c['seq']:05d}"
    c = await db.counters.find_one_and_update(
        {"_id": f"driver_code_{code}"}, {"$inc": {"seq": 1}},
        upsert=True, return_document=True
    )
    return f"R39D-{code}{c['seq']:03d}"


_ASSIGN_KEYS = ("vehicle_id", "package_id", "rental_start", "rental_end", "supervisor_id", "rental_state")
RENTAL_STATES = ("active", "suspended", "pending_payment", "closed")


def _plan_kind(plan):
    t = (plan or {}).get("package_type")
    return "commission" if t == "Commission" else "salary" if t == "Salary" else "rental"


def _plan_extra(plan):
    """Extra fields stored with the driver/rental for the package category."""
    kind = _plan_kind(plan)
    out = {"package_category": kind}
    if kind == "commission":
        out["commission_percent"] = plan.get("commission_percent")
    elif kind == "salary":
        out["salary_amount"] = plan.get("salary_amount")
    return out


async def _create_driver_rental(user, org, driver_id, driver, vehicle, plan, start, end, state):
    """Creates the rental for a driver with the chosen status.
    active / suspended -> vehicle is handed over (same as Rentals -> create + activate).
    pending_payment / closed -> only the rental record is created (same as Rentals -> create)."""
    state = state or "active"
    if state in ("active", "suspended"):
        rid = await _create_active_rental(user, org, driver_id, driver, vehicle, plan, start, end)
        if state == "suspended":
            await db.rentals.update_one({"_id": oid(rid)}, {"$set": {"status": "suspended", "suspend_reason": ""}})
            await db.drivers.update_one({"_id": oid(driver_id)}, {"$set": {"rental_status": "suspended"}})
        return
    code = await _next_rental_code(org)
    rate = plan.get("amount", 0)
    deposit = plan.get("deposit", 5000) if _plan_kind(plan) == "rental" else 0   # no security deposit for commission / salary packages
    doc = {
        "organization_id": org, "rental_code": code,
        "driver_id": driver_id, "driver_name": driver["name"],
        "vehicle_id": str(vehicle["_id"]), "vehicle_number": vehicle["vehicle_number"],
        "plan_id": str(plan["_id"]), "plan_name": plan["name"],
        "package_name": plan["name"], "daily_rate": rate,
        "city": vehicle["city"], "start": start, "end": f"{end}T23:59:59+00:00" if end else "Ongoing",
        "amount": rate, "deposit": deposit,
        "paid": 0.0, "outstanding": rate + deposit,
        "payment_status": "pending", "status": state,
        "notes": "", "renewal_history": [], "created_at": now_iso(),
        **_plan_extra(plan),
    }
    if state == "closed":
        doc["closed_at"] = now_iso()
    res = await db.rentals.insert_one(doc)
    await log_audit(user, "rental_created", "rental", str(res.inserted_id), f"Rental {code} created for {driver['name']} ({state})")


async def _set_rental_state(user, rental, state):
    """Changes an existing rental's status with the same side effects as the
    Activate / Suspend / Close buttons on the Rentals page."""
    rid = str(rental["_id"])
    did = rental["driver_id"]
    if state == "active":
        await db.rentals.update_one({"_id": rental["_id"]}, {"$set": {"status": "active"}})
        await db.vehicles.update_one({"_id": oid(rental["vehicle_id"])}, {"$set": {
            "status": "rented", "current_driver_id": did, "current_driver_name": rental.get("driver_name"),
            "current_rental_id": rid, "current_rental_code": rental.get("rental_code"), "rental_end": rental.get("end")}})
        await db.drivers.update_one({"_id": oid(did)}, {"$set": {
            "current_vehicle_id": rental["vehicle_id"], "current_vehicle_number": rental.get("vehicle_number"),
            "package_name": rental.get("package_name"), "package_rate": rental.get("daily_rate"),
            "rental_status": "active"}})
        if not await db.driver_vehicle_assignments.find_one({"driver_id": did, "vehicle_id": rental["vehicle_id"], "end": None}):
            await db.driver_vehicle_assignments.update_many({"driver_id": did, "end": None}, {"$set": {"end": now_iso()}})
            await db.driver_vehicle_assignments.insert_one({
                "organization_id": rental.get("organization_id"), "driver_id": did, "driver_name": rental.get("driver_name"),
                "vehicle_id": rental["vehicle_id"], "vehicle_number": rental.get("vehicle_number"), "city": rental.get("city"),
                "start": now_iso(), "end": None, "notes": f"Via rental {rental.get('rental_code')}", "created_at": now_iso()})
    elif state == "suspended":
        await db.rentals.update_one({"_id": rental["_id"]}, {"$set": {"status": "suspended", "suspend_reason": ""}})
        await db.drivers.update_one({"_id": oid(did)}, {"$set": {"rental_status": "suspended"}})
    elif state == "closed":
        await db.rentals.update_one({"_id": rental["_id"]}, {"$set": {"status": "closed", "closed_at": now_iso()}})
        await db.vehicles.update_one({"_id": oid(rental["vehicle_id"])}, {"$set": {
            "status": "available", "current_driver_id": None, "current_driver_name": None,
            "current_rental_id": None, "current_rental_code": None, "rental_end": None}})
        await db.drivers.update_one({"_id": oid(did)}, {"$set": {"rental_status": "none"}})
    else:  # pending_payment
        await db.rentals.update_one({"_id": rental["_id"]}, {"$set": {"status": "pending_payment"}})
        await db.drivers.update_one({"_id": oid(did)}, {"$set": {"rental_status": "pending_payment"}})
    await log_audit(user, "rental_status_changed", "rental", rid, f"Rental {rental.get('rental_code')} set to {state}")


async def _validate_driver_assignment(org, city, vehicle_id, package_id, start, end):
    """Checks vehicle + package + dates. Returns (vehicle, plan). Nothing is saved here."""
    if not vehicle_id:
        return None, None
    vehicle = await db.vehicles.find_one({"_id": oid(vehicle_id), "organization_id": org})
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if vehicle.get("city") != city:
        raise HTTPException(status_code=400, detail="Vehicle does not belong to the driver's city")
    if vehicle.get("status") != "available":
        raise HTTPException(status_code=400, detail="Selected vehicle is not available")
    if not package_id:
        raise HTTPException(status_code=400, detail="Select a package for the assigned vehicle")
    plan = await db.rental_plans.find_one({"_id": oid(package_id), "organization_id": org})
    if not plan or plan.get("city") != city:
        raise HTTPException(status_code=400, detail="Selected package does not belong to the driver's city")
    # "In-Build / In-Built Vehicles" package is not allowed for Bangalore
    if city == "Bangalore" and re.fullmatch(r"in[\s\-_]*buil[dt][\s\-_]*vehicles?", (plan.get("name") or "").strip(), re.I):
        raise HTTPException(status_code=400, detail="This package is not available for Bangalore")
    if not start:
        raise HTTPException(status_code=400, detail="Rental start date is required")
    try:
        s = date.fromisoformat(start)
        if end and date.fromisoformat(end) < s:
            raise HTTPException(status_code=400, detail="End date cannot be before start date")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid rental date")
    return vehicle, plan


async def _validate_supervisor(org, city, supervisor_id):
    if not supervisor_id:
        return None
    sup = await db.users.find_one({"_id": oid(supervisor_id), "organization_id": org, "role": "city_manager"})
    if not sup or sup.get("city") != city:
        raise HTTPException(status_code=400, detail="Supervisor must be a city manager of the driver's city")
    return sup


async def _create_active_rental(user, org, driver_id, driver, vehicle, plan, start, end):
    """Same result as Rentals -> create rental + activate, done in one step."""
    code = await _next_rental_code(org)
    rate = plan.get("amount", 0)
    deposit = plan.get("deposit", 5000) if _plan_kind(plan) == "rental" else 0   # no security deposit for commission / salary packages
    vid = str(vehicle["_id"])
    end_val = f"{end}T23:59:59+00:00" if end else "Ongoing"
    doc = {
        "organization_id": org, "rental_code": code,
        "driver_id": driver_id, "driver_name": driver["name"],
        "vehicle_id": vid, "vehicle_number": vehicle["vehicle_number"],
        "plan_id": str(plan["_id"]), "plan_name": plan["name"],
        "package_name": plan["name"], "daily_rate": rate,
        "city": vehicle["city"], "start": start, "end": end_val,
        "amount": rate, "deposit": deposit,
        "paid": 0.0, "outstanding": rate + deposit,
        "payment_status": "pending", "status": "active",
        "notes": "", "renewal_history": [], "created_at": now_iso(),
        **_plan_extra(plan),
    }
    res = await db.rentals.insert_one(doc)
    rid = str(res.inserted_id)
    await db.vehicles.update_one({"_id": vehicle["_id"]}, {"$set": {
        "status": "rented", "current_driver_id": driver_id, "current_driver_name": driver["name"],
        "current_rental_id": rid, "current_rental_code": code, "rental_end": end_val}})
    await db.drivers.update_one({"_id": oid(driver_id)}, {"$set": {
        "current_vehicle_id": vid, "current_vehicle_number": vehicle["vehicle_number"],
        "package_name": plan["name"], "package_rate": rate, "rental_status": "active", **_plan_extra(plan)}})
    await db.driver_vehicle_assignments.update_many({"driver_id": driver_id, "end": None}, {"$set": {"end": now_iso()}})
    await db.driver_vehicle_assignments.insert_one({
        "organization_id": org, "driver_id": driver_id, "driver_name": driver["name"],
        "vehicle_id": vid, "vehicle_number": vehicle["vehicle_number"], "city": vehicle["city"],
        "start": now_iso(), "end": None, "notes": f"Via rental {code}", "created_at": now_iso()})
    await log_audit(user, "rental_created", "rental", rid, f"Rental {code} created for {driver['name']}")
    await log_audit(user, "rental_activated", "rental", rid, f"Rental {code} activated")
    await add_notification(org, "green", "Rental activated", f"{code} activated for {driver['name']}",
                           link=f"/rentals/{rid}", city=vehicle["city"])
    return rid


@api.post("/drivers")
async def create_driver(body: DriverBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    doc = body.model_dump()
    doc["organization_id"] = user.get("organization_id") or "route39-org"
    if user.get("role") == "city_manager" and user.get("city"):
        doc["city"] = user["city"]  # city managers can only add drivers in their own city
    doc["created_at"] = now_iso()
    # Normalize the phone the same way driver login does (strip spaces) and block duplicates
    phone = re.sub(r"\s+", "", body.phone or "")
    if not phone:
        raise HTTPException(status_code=400, detail="Mobile number is required")
    if await db.drivers.find_one({"phone": phone}):
        raise HTTPException(status_code=400, detail="Mobile number already exists")
    doc["phone"] = phone
    if not re.fullmatch(r"\d{10}", phone):
        raise HTTPException(status_code=400, detail="Mobile number must be exactly 10 digits")
    emergency = re.sub(r"\s+", "", body.emergency_contact or "")
    if not re.fullmatch(r"\d{10}", emergency):
        raise HTTPException(status_code=400, detail="Emergency contact must be exactly 10 digits")
    doc["emergency_contact"] = emergency
    # new optional assignment fields: never stored raw on the driver document
    extra = {k: (doc.pop(k, None) or None) for k in _ASSIGN_KEYS}
    pkg_category = doc.pop("package_category", None) or None
    org_ = doc["organization_id"]
    vehicle, plan = await _validate_driver_assignment(
        org_, doc.get("city"), extra["vehicle_id"], extra["package_id"], extra["rental_start"], extra["rental_end"])
    if extra["rental_state"] and extra["rental_state"] not in RENTAL_STATES:
        raise HTTPException(status_code=400, detail="Invalid rental status")
    if extra["vehicle_id"] and not extra["rental_state"]:
        raise HTTPException(status_code=400, detail="Select the rental status")
    if extra["rental_state"] and not extra["vehicle_id"]:
        raise HTTPException(status_code=400, detail="Select a vehicle to set the rental status")
    if plan:
        if pkg_category and pkg_category != _plan_kind(plan):
            raise HTTPException(status_code=400, detail="Selected package does not match the package type")
        doc["package_category"] = _plan_kind(plan)
    sup = await _validate_supervisor(org_, doc.get("city"), extra["supervisor_id"])
    if sup:
        doc["supervisor_id"] = str(sup["_id"])
        doc["supervisor_name"] = sup.get("name")
    doc["driver_code"] = await _next_driver_code(doc.get("city"))
    res = await db.drivers.insert_one(doc)
    await log_audit(user, "driver_created", "driver", str(res.inserted_id), f"Driver {body.name} added")
    if vehicle and plan:
        await _create_driver_rental(user, org_, str(res.inserted_id), doc, vehicle, plan,
                                    extra["rental_start"], extra["rental_end"], extra["rental_state"])
    return ser(await db.drivers.find_one({"_id": res.inserted_id}))

IMPORT_CITY_NAMES = {"tiruppur": "Tiruppur", "tirupur": "Tiruppur", "coimbatore": "Coimbatore",
                     "chennai": "Chennai", "bangalore": "Bangalore", "bengaluru": "Bangalore"}
IMPORT_COLS = {"name": "name", "drivername": "name", "phone": "phone", "mobile": "phone",
               "mobileno": "phone", "mobilenumber": "phone", "phonenumber": "phone", "phoneno": "phone",
               "city": "city", "address": "address", "emergencycontact": "emergency_contact",
               "emergencyno": "emergency_contact", "emergency": "emergency_contact",
               "licenceno": "license_number", "licenseno": "license_number", "licencenumber": "license_number",
               "licensenumber": "license_number", "licence": "license_number", "license": "license_number",
               "dlno": "license_number", "dlnumber": "license_number"}


def _import_cell(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def _import_phone(v):
    digits = re.sub(r"\D", "", v or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    return digits


@api.post("/drivers/import")
async def import_drivers(request: Request, file: UploadFile = File(...)):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    import io
    raw = await file.read()
    fname = (file.filename or "").lower()
    if fname.endswith(".csv"):
        import csv
        rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig", errors="ignore"))))
    elif fname.endswith(".xlsx"):
        from openpyxl import load_workbook
        ws = load_workbook(io.BytesIO(raw), read_only=True, data_only=True).active
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
    else:
        raise HTTPException(status_code=400, detail="Upload an Excel (.xlsx) or CSV file")
    if len(rows) < 2:
        raise HTTPException(status_code=400, detail="File has no driver rows")
    header = [IMPORT_COLS.get(re.sub(r"[^a-z]", "", str(h or "").lower())) for h in rows[0]]
    required = ["name", "phone", "city", "address", "emergency_contact", "license_number"]
    missing = [c for c in required if c not in header]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")
    org = user.get("organization_id") or "route39-org"
    is_cm = user.get("role") == "city_manager" and user.get("city")
    created, errors, seen = [], [], set()
    for row_no, r in enumerate(rows[1:], start=2):
        rec = {}
        for idx, key in enumerate(header):
            if key and idx < len(r):
                rec[key] = _import_cell(r[idx])
        if not any(rec.values()):
            continue
        rec["phone"] = _import_phone(rec.get("phone"))
        rec["emergency_contact"] = _import_phone(rec.get("emergency_contact"))
        city = user["city"] if is_cm else IMPORT_CITY_NAMES.get((rec.get("city") or "").strip().lower())
        err = None
        empty = [c for c in required if not rec.get(c)]
        if empty:
            err = f"Missing: {', '.join(empty)}"
        elif not re.fullmatch(r"\d{10}", rec["phone"]):
            err = "Phone must be 10 digits"
        elif not re.fullmatch(r"\d{10}", rec["emergency_contact"]):
            err = "Emergency contact must be 10 digits"
        elif not city:
            err = f"Invalid city: {rec.get('city')}"
        elif rec["phone"] in seen:
            err = "Phone repeated in file"
        elif await db.drivers.find_one({"phone": rec["phone"]}):
            err = "Mobile number already exists"
        if err:
            errors.append({"row": row_no, "name": rec.get("name", ""), "phone": rec.get("phone", ""), "error": err})
            continue
        seen.add(rec["phone"])
        doc = {
            "name": rec["name"], "phone": rec["phone"], "address": rec["address"],
            "emergency_contact": rec["emergency_contact"], "city": city, "status": "active",
            "avatar": None, "license_number": rec["license_number"], "package_name": None, "package_rate": None,
            "organization_id": org, "created_at": now_iso(),
            "driver_code": await _next_driver_code(city),
        }
        res = await db.drivers.insert_one(doc)
        created.append({"id": str(res.inserted_id), "name": doc["name"], "driver_code": doc["driver_code"]})
    if created:
        await log_audit(user, "drivers_imported", "driver", "", f"{len(created)} drivers imported from {file.filename}")
    return {"created": len(created), "drivers": created, "errors": errors}


async def _swap_driver_vehicle(user, org, did, driver, open_rental, new_vehicle):
    """Moves a driver who already has a rental onto another available vehicle.
    Package, dates and payments stay as they are; only the vehicle changes."""
    nvid = str(new_vehicle["_id"])
    old_vid = (open_rental or {}).get("vehicle_id") or driver.get("current_vehicle_id")
    state = (open_rental or {}).get("status") or driver.get("rental_status")
    holds_vehicle = state in ("active", "suspended")   # same rule as when a rental is created
    if holds_vehicle and old_vid:
        # free the old vehicle (only if it was held by this driver)
        await db.vehicles.update_one(
            {"_id": oid(old_vid), "current_driver_id": {"$in": [did, None, ""]}},
            {"$set": {"status": "available", "current_driver_id": None, "current_driver_name": None,
                      "current_rental_id": None, "current_rental_code": None, "rental_end": None}})
    if open_rental:
        await db.rentals.update_one({"_id": open_rental["_id"]}, {"$set": {
            "vehicle_id": nvid, "vehicle_number": new_vehicle["vehicle_number"]}})
    if holds_vehicle:
        await db.vehicles.update_one({"_id": new_vehicle["_id"]}, {"$set": {
            "status": "rented", "current_driver_id": did, "current_driver_name": driver.get("name"),
            "current_rental_id": str(open_rental["_id"]) if open_rental else None,
            "current_rental_code": (open_rental or {}).get("rental_code"),
            "rental_end": (open_rental or {}).get("end")}})
    await db.drivers.update_one({"_id": oid(did)}, {"$set": {
        "current_vehicle_id": nvid, "current_vehicle_number": new_vehicle["vehicle_number"]}})
    await db.driver_vehicle_assignments.update_many({"driver_id": did, "end": None}, {"$set": {"end": now_iso()}})
    await db.driver_vehicle_assignments.insert_one({
        "organization_id": org, "driver_id": did, "driver_name": driver.get("name"),
        "vehicle_id": nvid, "vehicle_number": new_vehicle["vehicle_number"], "city": new_vehicle.get("city"),
        "start": now_iso(), "end": None, "notes": "Vehicle changed from Edit Driver", "created_at": now_iso()})
    await log_audit(user, "driver_vehicle_changed", "driver", did,
                    f"{driver.get('name')} moved to {new_vehicle['vehicle_number']}")


@api.put("/drivers/{did}")
async def update_driver(did: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    for k in ("id", "_id", "assignments", "rentals", "incidents", "documents"):
        body.pop(k, None)
    # new assignment fields are handled separately below, never $set raw
    extra = {k: body.pop(k, None) for k in _ASSIGN_KEYS}
    if "phone" in body:
        phone = re.sub(r"\s+", "", body.get("phone") or "")
        if not phone:
            raise HTTPException(status_code=400, detail="Mobile number is required")
        if await db.drivers.find_one({"phone": phone, "_id": {"$ne": oid(did)}}):
            raise HTTPException(status_code=400, detail="Mobile number already exists")
        if not re.fullmatch(r"\d{10}", phone):
            raise HTTPException(status_code=400, detail="Mobile number must be exactly 10 digits")
        body["phone"] = phone
    cur = await db.drivers.find_one({"_id": oid(did), "organization_id": user.get("organization_id")})
    if not cur:
        raise HTTPException(status_code=404, detail="Driver not found")
    org_ = cur.get("organization_id")
    city_ = body.get("city") or cur.get("city")
    # a driver who already has an active rental keeps it: use Change Vehicle / Rentals page for that
    open_rental = await _active_rental(org_, did)   # any rental that is not closed
    has_active = bool(open_rental) or (cur.get("rental_status") == "active" and bool(cur.get("current_vehicle_id")))
    new_state = extra["rental_state"] or None
    if new_state and new_state not in RENTAL_STATES:
        raise HTTPException(status_code=400, detail="Invalid rental status")
    if extra["vehicle_id"] and not has_active and not new_state:
        raise HTTPException(status_code=400, detail="Select the rental status")
    # driver already has a rental and a different vehicle was picked -> validate it before saving anything
    new_vehicle = None
    if extra["vehicle_id"] and has_active and extra["vehicle_id"] != ((open_rental or {}).get("vehicle_id") or cur.get("current_vehicle_id")):
        new_vehicle = await db.vehicles.find_one({"_id": oid(extra["vehicle_id"]), "organization_id": org_})
        if not new_vehicle:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        if new_vehicle.get("city") != city_:
            raise HTTPException(status_code=400, detail="Vehicle does not belong to the driver's city")
        if new_vehicle.get("status") != "available":
            raise HTTPException(status_code=400, detail="Selected vehicle is not available")
    vehicle = plan = None
    if extra["vehicle_id"] and not has_active:
        vehicle, plan = await _validate_driver_assignment(
            org_, city_, extra["vehicle_id"], extra["package_id"], extra["rental_start"], extra["rental_end"])
    upd = {}
    if body:
        upd["$set"] = dict(body)
    if extra["supervisor_id"] is not None:   # "" = clear supervisor, key absent = leave unchanged
        sup = await _validate_supervisor(org_, city_, extra["supervisor_id"] or None)
        if sup:
            upd.setdefault("$set", {}).update({"supervisor_id": str(sup["_id"]), "supervisor_name": sup.get("name")})
        else:
            upd["$unset"] = {"supervisor_id": "", "supervisor_name": ""}
    if upd:
        await db.drivers.update_one({"_id": oid(did)}, upd)
    if new_vehicle:
        await _swap_driver_vehicle(user, org_, did, cur, open_rental, new_vehicle)
        if open_rental:   # reload so a status change in the same save acts on the new vehicle
            open_rental = await db.rentals.find_one({"_id": open_rental["_id"]})
    if vehicle and plan:
        await _create_driver_rental(user, org_, did, {**cur, **body}, vehicle, plan,
                                    extra["rental_start"], extra["rental_end"], new_state)
    elif open_rental and new_state and new_state != open_rental.get("status"):
        await _set_rental_state(user, open_rental, new_state)
    return ser(await db.drivers.find_one({"_id": oid(did)}))


@api.post("/admin/drivers/{did}/unblock")
async def unblock_driver(did: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    tomorrow = (_today_ist() + timedelta(days=1)).isoformat()
    res = await db.rental_accounts.update_one(
        org_filter(user, {"driver_id": did}),
        {"$set": {"grace_period_until": tomorrow}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Rental account not found")
    await log_audit(user, "driver_unblocked", "driver", did, "Driver manually unblocked for 24h grace period")
    return {"ok": True}

@api.post("/admin/drivers/{did}/deposit-paid")
async def override_deposit_paid(did: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    org = user.get("organization_id")
    
    rental = await _active_rental(org, did)
    sec_dep = await db.security_deposits.find_one({"driver_id": did, "organization_id": org})
    if sec_dep and sec_dep.get("status") == "paid":
        return {"ok": True, "message": "Already paid"}
        
    amount = 5000.0
    if (not sec_dep) or sec_dep.get("status", "pending") == "pending":
        # nothing paid yet (or no deposit record yet) -> use the current package deposit
        _live = await _deposit_amount_for(org, did, sec_dep)
        amount = _live if _live > 0 else float((sec_dep or {}).get("amount") or 5000)
    elif sec_dep and "amount" in sec_dep:
        amount = float(sec_dep["amount"])
    elif rental and "deposit" in rental:
        amount = float(rental["deposit"])
    rec = {
        "organization_id": org,
        "driver_id": did,
        "amount": amount,
        "kind": "deposit",
        "payment_status": "pending",
        "gateway_order_id": f"MANUAL_{uuid.uuid4().hex[:10]}",
        "gateway": "manual_qr",
        "created_at": now_iso()
    }
    if sec_dep and sec_dep.get("status") == "partial":
        # First half already paid -> this marks only the REMAINING half as paid
        rec["deposit_part"] = "second"
        rec["deposit_total"] = float(sec_dep.get("amount") or amount)
        rec["amount"] = round(rec["deposit_total"] - float(sec_dep.get("paid_amount") or 0), 2)
    insert_res = await db.rental_payments.insert_one(rec)
    rec["_id"] = insert_res.inserted_id
    
    await _apply_paid(rec, f"QR_{uuid.uuid4().hex[:8]}", "manual_qr", gateway_ref="MANUAL_OVERRIDE")
    return {"ok": True}

@api.post("/admin/drivers/{did}/rent-paid")
async def admin_mark_rent_paid(did: str, request: Request, body: dict):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    org = user.get("organization_id")
    dates = sorted(set(body.get("dates") or []))
    try:
        amount = round(float(body.get("amount") or 0), 2)
    except (TypeError, ValueError):
        amount = 0
    if not dates:
        raise HTTPException(status_code=400, detail="Select at least one date")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Enter a valid amount")
    for d_ in dates:
        try:
            datetime.strptime(d_, "%Y-%m-%d")
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid date: {d_}")
    rental = await _active_rental(org, did)
    if not rental:
        raise HTTPException(status_code=400, detail="No active rental for this driver")
    already = await db.rental_payments.find({
        "organization_id": org, "driver_id": did, "payment_status": "paid",
        "kind": {"$in": ["daily", "outstanding", "catchup"]}, "covers_dates": {"$in": dates},
    }).to_list(100)
    dup = sorted({x for p in already for x in (p.get("covers_dates") or []) if x in dates})
    if dup:
        raise HTTPException(status_code=400, detail=f"Rent already paid for: {', '.join(dup)}")
    for d_ in dates:
        await db.rental_payments.insert_one({
            "organization_id": org, "driver_id": did, "rental_id": str(rental["_id"]),
            "kind": "daily", "amount": amount, "covers_dates": [d_], "covers_amounts": {d_: amount},
            "payment_status": "paid", "payment_method": body.get("method") or "cash",
                        "transaction_id": str((body.get("txn_ids") or {}).get(d_) or "").strip() or f"MANUAL_RENT_{uuid.uuid4().hex[:8].upper()}",
            "gateway": "manual_admin", "gateway_ref": "ADMIN_RENT_PAID",
            "paid_at": now_iso(), "created_at": now_iso(), "marked_by": user.get("id"),
        })
    acct = await db.rental_accounts.find_one({"organization_id": org, "driver_id": did})
    if acct:
        rbd = dict(acct.get("rent_by_date") or {})
        owed = round(sum(float(rbd.pop(d_, 0) or 0) for d_ in dates), 2)
        if owed > 0:
            await db.rental_accounts.update_one({"_id": acct["_id"]}, {"$set": {
                "rent_by_date": rbd,
                "rent_due": max(0.0, round(float(acct.get("rent_due", 0) or 0) - owed, 2)),
                "outstanding_amount": max(0.0, round(float(acct.get("outstanding_amount", 0) or 0) - owed, 2)),
                "unpaid_dates": [x for x in (acct.get("unpaid_dates") or []) if x not in dates],
            }})
    await log_audit(user, "rent_marked_paid", "driver", did, f"Rent {amount} marked paid for {', '.join(dates)}")
    return {"ok": True, "count": len(dates), "total": round(amount * len(dates), 2)}

@api.get("/admin/drivers/{did}/rent-paid")
async def admin_get_rent_paid(did: str, request: Request):
    """Rent days the office already marked as paid (Rent Paid button) - used to pre-fill the form."""
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    org = user.get("organization_id")
    drv = await db.drivers.find_one(org_filter(user, {"_id": oid(did)}))
    if not drv:
        raise HTTPException(status_code=404, detail="Driver not found")
    recs = await db.rental_payments.find({
        "organization_id": org, "driver_id": did, "kind": "daily",
        "payment_status": "paid", "gateway_ref": "ADMIN_RENT_PAID"}).to_list(500)
    items = []
    for p in recs:
        for d_ in (p.get("covers_dates") or []):
            items.append({"id": str(p["_id"]), "date": d_,
                          "amount": float((p.get("covers_amounts") or {}).get(d_, p.get("amount", 0)) or 0),
                          "txn_id": p.get("transaction_id") or ""})
    items.sort(key=lambda x: x["date"])
    return {"items": items}


@api.put("/admin/drivers/{did}/rent-paid")
async def admin_edit_rent_paid(did: str, request: Request, body: dict):
    """Saves the full list of office-marked rent days: edits existing ones (amount / transaction id),
    adds new ones and removes the ones that were un-selected."""
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    org = user.get("organization_id")
    drv = await db.drivers.find_one(org_filter(user, {"_id": oid(did)}))
    if not drv:
        raise HTTPException(status_code=404, detail="Driver not found")
    today_iso = _today_ist().isoformat()

    entries = {}
    for e in (body.get("entries") or []):
        d_ = str(e.get("date") or "")[:10]
        try:
            datetime.strptime(d_, "%Y-%m-%d")
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid date: {d_}")
        if d_ > today_iso:
            raise HTTPException(status_code=400, detail="Rent paid date cannot be in the future")
        try:
            amt = round(float(e.get("amount") or 0), 2)
        except (TypeError, ValueError):
            amt = 0
        if amt <= 0:
            raise HTTPException(status_code=400, detail=f"Enter a valid amount for {d_}")
        entries[d_] = {"amount": amt, "txn": str(e.get("txn_id") or "").strip()}

    existing = {}
    for p in await db.rental_payments.find({
            "organization_id": org, "driver_id": did, "kind": "daily",
            "payment_status": "paid", "gateway_ref": "ADMIN_RENT_PAID"}).to_list(500):
        for d_ in (p.get("covers_dates") or []):
            existing[d_] = p
    new_dates = sorted(d for d in entries if d not in existing)
    removed = sorted(d for d in existing if d not in entries)

    rental = None
    if new_dates:
        rental = await _active_rental(org, did)
        if not rental:
            raise HTTPException(status_code=400, detail="No active rental for this driver")
        already = await db.rental_payments.find({
            "organization_id": org, "driver_id": did, "payment_status": "paid",
            "kind": {"$in": ["daily", "outstanding", "catchup"]}, "covers_dates": {"$in": new_dates},
        }).to_list(100)
        dup = sorted({x for p in already for x in (p.get("covers_dates") or []) if x in new_dates})
        if dup:
            raise HTTPException(status_code=400, detail=f"Rent already paid for: {', '.join(dup)}")

    # 1) edit existing entries (amount / transaction id)
    for d_, p in existing.items():
        if d_ not in entries:
            continue
        e = entries[d_]
        upd = {}
        if abs(float((p.get("covers_amounts") or {}).get(d_, p.get("amount", 0)) or 0) - e["amount"]) > 0.005:
            upd["amount"] = e["amount"]
            upd["covers_amounts"] = {d_: e["amount"]}
        if e["txn"] and e["txn"] != (p.get("transaction_id") or ""):
            upd["transaction_id"] = e["txn"]
        if upd:
            await db.rental_payments.update_one({"_id": p["_id"]}, {"$set": upd})

    # 2) add new entries (same as the original "Rent Paid" save)
    for d_ in new_dates:
        e = entries[d_]
        await db.rental_payments.insert_one({
            "organization_id": org, "driver_id": did, "rental_id": str(rental["_id"]),
            "kind": "daily", "amount": e["amount"], "covers_dates": [d_], "covers_amounts": {d_: e["amount"]},
            "payment_status": "paid", "payment_method": "cash",
            "transaction_id": e["txn"] or f"MANUAL_RENT_{uuid.uuid4().hex[:8].upper()}",
            "gateway": "manual_admin", "gateway_ref": "ADMIN_RENT_PAID",
            "paid_at": now_iso(), "created_at": now_iso(), "marked_by": user.get("id"),
        })
    if new_dates:
        acct = await db.rental_accounts.find_one({"organization_id": org, "driver_id": did})
        if acct:
            rbd = dict(acct.get("rent_by_date") or {})
            owed = round(sum(float(rbd.pop(d_, 0) or 0) for d_ in new_dates), 2)
            if owed > 0:
                await db.rental_accounts.update_one({"_id": acct["_id"]}, {"$set": {
                    "rent_by_date": rbd,
                    "rent_due": max(0.0, round(float(acct.get("rent_due", 0) or 0) - owed, 2)),
                    "outstanding_amount": max(0.0, round(float(acct.get("outstanding_amount", 0) or 0) - owed, 2)),
                    "unpaid_dates": [x for x in (acct.get("unpaid_dates") or []) if x not in new_dates],
                }})

    # 3) un-selected days: delete the payment and put the (past) day's rent back as unpaid
    reinstate = {}
    for d_ in removed:
        p = existing[d_]
        await db.rental_payments.delete_one({"_id": p["_id"]})
        if d_ < today_iso:
            reinstate[d_] = float((p.get("covers_amounts") or {}).get(d_, p.get("amount", 0)) or 0)
    if reinstate:
        acct = await db.rental_accounts.find_one({"organization_id": org, "driver_id": did})
        if acct:
            add_total = round(sum(reinstate.values()), 2)
            await db.rental_accounts.update_one({"_id": acct["_id"]}, {
                "$set": {f"rent_by_date.{k}": v for k, v in reinstate.items()},
                "$inc": {"rent_due": add_total, "outstanding_amount": add_total},
                "$addToSet": {"unpaid_dates": {"$each": list(reinstate.keys())}}})

    await log_audit(user, "rent_paid_edited", "driver", did,
                    f"Rent paid updated: {len(new_dates)} added, {len(removed)} removed")
    return {"ok": True, "added": len(new_dates), "removed": len(removed)}


@api.post("/admin/drivers/{did}/deposit-partial-toggle")
async def toggle_deposit_partial(did: str, request: Request, body: dict):
    """Enable / disable the 'pay half now, half later' option for ONE driver.
    The driver then pays the half from the driver app (no QR / admin payment)."""
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    org = user.get("organization_id")
    enabled = bool(body.get("enabled"))
    dep = await db.security_deposits.find_one({"driver_id": did, "organization_id": org})
    if not dep or dep.get("status", "pending") == "pending" or float(dep.get("amount") or 0) <= 0:
        amt = await _deposit_amount_for(org, did, dep)
        if amt <= 0:
            raise HTTPException(status_code=404, detail="Deposit amount not found for this driver's package.")
        if dep:
            await db.security_deposits.update_one({"_id": dep["_id"]}, {"$set": {"amount": amt}})
            dep["amount"] = amt
        else:
            dep = {"organization_id": org, "driver_id": did, "amount": amt, "status": "pending",
                   "transaction_id": None, "paid_at": None, "created_at": now_iso()}
            await db.security_deposits.insert_one(dep)
    if dep.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Deposit is already fully paid.")
    if dep.get("status") == "partial":
        if enabled:
            return {"ok": True}
        # switching it off after the first half was paid: reset to unpaid, full amount is asked again
        await db.security_deposits.update_one(
            {"_id": dep["_id"]},
            {"$set": {"status": "pending", "partial_enabled": False, "transaction_id": None, "paid_at": None},
             "$unset": {"paid_amount": "", "next_payment_date": "", "first_paid_at": "",
                        "second_paid_at": "", "first_transaction_id": "", "first_amount": "",
                        "partial_first_amount": "", "partial_next_date": ""}})
    else:
        upd = {"$set": {"partial_enabled": enabled}}
        if enabled:
            # admin decides: amount the driver pays now + the date the remaining amount is due
            total = float(dep.get("amount") or 0)
            try:
                first_amt = round(float(body.get("first_amount")), 2)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Enter the amount the driver has to pay now.")
            if first_amt <= 0 or first_amt >= total:
                raise HTTPException(status_code=400, detail=f"Amount must be more than 0 and less than the total deposit ({total:g}).")
            # Either the next payment date OR "remaining amount already paid" (with its paid date) – never both.
            second_paid_flag = bool(body.get("second_paid"))
            nd_raw = (body.get("next_payment_date") or "").strip()
            if nd_raw and second_paid_flag:
                raise HTTPException(status_code=400, detail="Select either the next payment date or the remaining-amount paid date, not both.")
            nd_date = None
            if nd_raw or not second_paid_flag:
                try:
                    nd_date = date.fromisoformat(nd_raw)
                except ValueError:
                    raise HTTPException(status_code=400, detail="Select the date for the next payment.")
                if nd_date <= _today_ist():
                    raise HTTPException(status_code=400, detail="Next payment date must be from tomorrow onwards.")
            upd["$set"]["partial_first_amount"] = first_amt
            if nd_date:
                upd["$set"]["partial_next_date"] = nd_date.isoformat()
            # optional: admin already collected the partial / remaining amount (QR) outside the app
            first_paid = bool(body.get("first_paid"))
            second_paid = bool(body.get("second_paid"))
            first_txn = str(body.get("first_txn_id") or "").strip()
            second_txn = str(body.get("second_txn_id") or "").strip()
            if first_paid and not first_txn:
                raise HTTPException(status_code=400, detail="Enter the transaction ID for the partial amount.")
            if second_paid and not second_txn:
                raise HTTPException(status_code=400, detail="Enter the transaction ID for the remaining amount.")
            paid_on = None
            if second_paid and not first_paid:
                raise HTTPException(status_code=400, detail="Mark the partial deposit amount as paid first.")
            if first_paid:
                try:
                    paid_on = date.fromisoformat((body.get("first_paid_date") or "").strip())
                except ValueError:
                    raise HTTPException(status_code=400, detail="Select the date when the partial amount was paid.")
                if paid_on > _today_ist():
                    raise HTTPException(status_code=400, detail="Paid date cannot be in the future.")
            second_on = None
            if second_paid:
                second_on = _paid_date_or_400(body.get("second_paid_date"), "remaining")
                if second_on < paid_on:
                    raise HTTPException(status_code=400, detail="Remaining paid date cannot be before the partial paid date.")
        else:
            upd["$unset"] = {"partial_first_amount": "", "partial_next_date": ""}
        await db.security_deposits.update_one({"_id": dep["_id"]}, upd)
        if enabled and first_paid:
            # 1) partial amount paid -> deposit becomes "partial"; the driver app popup stays hidden
            #    until next_payment_date (remaining_due only turns true on/after that date)
            rec1 = {"organization_id": org, "driver_id": did, "amount": first_amt, "kind": "deposit",
                    "payment_status": "pending", "gateway_order_id": f"MANUAL_{uuid.uuid4().hex[:10]}",
                    "gateway": "manual_admin", "created_at": now_iso(),
                    "deposit_part": "first", "deposit_total": total, "next_payment_date": nd_date.isoformat() if nd_date else None}
            rec1["_id"] = (await db.rental_payments.insert_one(rec1)).inserted_id
            await _apply_paid(rec1, first_txn, "manual_qr", gateway_ref="MANUAL_OVERRIDE")
            await db.rental_payments.update_one({"_id": rec1["_id"]}, {"$set": {"paid_at": _paid_at_iso(paid_on)}})
            # Daily Collection shows the "PARTIALLY PAID" cell from this date onwards
            await db.security_deposits.update_one(
                {"_id": dep["_id"]}, {"$set": {"first_paid_at": f"{paid_on.isoformat()}T00:00:00+00:00"}})
            # 2) remaining amount also paid -> deposit fully paid, no popup in the driver app
            if second_paid:
                rec2 = {"organization_id": org, "driver_id": did, "amount": round(total - first_amt, 2), "kind": "deposit",
                        "payment_status": "pending", "gateway_order_id": f"MANUAL_{uuid.uuid4().hex[:10]}",
                        "gateway": "manual_admin", "created_at": now_iso(),
                        "deposit_part": "second", "deposit_total": total}
                rec2["_id"] = (await db.rental_payments.insert_one(rec2)).inserted_id
                await _apply_paid(rec2, second_txn, "manual_qr", gateway_ref="MANUAL_OVERRIDE")
                await db.rental_payments.update_one({"_id": rec2["_id"]}, {"$set": {"paid_at": _paid_at_iso(second_on)}})
                await db.security_deposits.update_one(
                    {"_id": dep["_id"]}, {"$set": {"second_paid_at": _paid_at_iso(second_on), "paid_at": _paid_at_iso(second_on)}})
    await log_audit(user, "deposit_partial_enabled" if enabled else "deposit_partial_disabled", "driver", did,
                    "Partial deposit " + ("enabled" if enabled else "disabled"))
    return {"ok": True, "total": float(dep.get("amount") or 0)}


def _paid_date_or_400(value, label):
    """Parses a 'date paid' sent by the admin (today or a past day)."""
    try:
        d = date.fromisoformat((value or "").strip())
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail=f"Select the date when the {label} amount was paid.")
    if d > _today_ist():
        raise HTTPException(status_code=400, detail="Paid date cannot be in the future.")
    return d


def _paid_at_iso(d):
    return f"{d.isoformat()}T00:00:00+00:00"


async def _record_qr_deposit_part(org, did, part, amount, total, next_date=None, txn=None, paid_on=None):
    """Records one part (first / second) of a split deposit as paid by QR (admin entered).
    With an admin-typed transaction id the payment is also visible on the driver's Payments page."""
    rec = {"organization_id": org, "driver_id": did, "amount": amount, "kind": "deposit",
           "payment_status": "pending", "gateway_order_id": f"MANUAL_{uuid.uuid4().hex[:10]}",
           "gateway": "manual_admin" if txn else "manual_qr", "created_at": now_iso(),
           "deposit_part": part, "deposit_total": total}
    if next_date:
        rec["next_payment_date"] = next_date
    rec["_id"] = (await db.rental_payments.insert_one(rec)).inserted_id
    await _apply_paid(rec, txn or f"QR_{uuid.uuid4().hex[:8]}", "manual_qr", gateway_ref="MANUAL_OVERRIDE")
    if txn and paid_on:
        await db.rental_payments.update_one({"_id": rec["_id"]}, {"$set": {"paid_at": _paid_at_iso(paid_on)}})


async def _set_deposit_part_txn(org, did, part, new_txn):
    """Admin changed the transaction id of an already-paid deposit part: update the payment record
    (and make a QR-recorded one visible on the driver's Payments page)."""
    rec = await db.rental_payments.find_one(
        {"organization_id": org, "driver_id": did, "kind": "deposit", "deposit_part": part, "payment_status": "paid"},
        sort=[("created_at", -1)])
    if not rec:
        return
    upd = {"transaction_id": new_txn}
    if rec.get("gateway") == "manual_qr":
        upd["gateway"] = "manual_admin"
    await db.rental_payments.update_one({"_id": rec["_id"]}, {"$set": upd})


@api.post("/admin/drivers/{did}/deposit-partial-payments")
async def update_deposit_partial_payments(did: str, request: Request, body: dict):
    """'Enable Partial Deposit' form for a driver who already has it enabled: mark the partial /
    remaining amount as paid (with the date it was paid) or unpaid again.
    Amount and next payment date stay exactly as saved."""
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    org = user.get("organization_id")
    dep = await db.security_deposits.find_one({"driver_id": did, "organization_id": org})
    if not dep or not (dep.get("partial_enabled") or dep.get("first_paid_at")):
        raise HTTPException(status_code=400, detail="Partial deposit is not enabled for this driver.")
    status = dep.get("status") or "pending"
    if status == "paid" and not dep.get("first_paid_at"):
        raise HTTPException(status_code=400, detail="Deposit was paid in full. Mark it unpaid first.")
    total = float(dep.get("amount") or 0)
    first_amt = float(dep.get("first_amount") or dep.get("partial_first_amount") or 0)
    if not (0 < first_amt < total):
        first_amt = round(total / 2, 2)
    first_paid, second_paid = bool(body.get("first_paid")), bool(body.get("second_paid"))
    if second_paid and not first_paid:
        raise HTTPException(status_code=400, detail="Mark the partial deposit amount as paid first.")
    first_on = _paid_date_or_400(body.get("first_paid_date"), "partial") if first_paid else None
    second_on = _paid_date_or_400(body.get("second_paid_date"), "remaining") if second_paid else None
    if second_on and second_on < first_on:
        raise HTTPException(status_code=400, detail="Remaining paid date cannot be before the partial paid date.")

    cur_first = status in ("partial", "paid")
    cur_second = status == "paid"
    nxt = dep.get("next_payment_date") or dep.get("partial_next_date") or (_today_ist() + timedelta(days=1)).isoformat()
    q = {"_id": dep["_id"]}
    first_txn = str(body.get("first_txn_id") or "").strip()
    second_txn = str(body.get("second_txn_id") or "").strip()
    if first_paid and not cur_first and not first_txn:
        raise HTTPException(status_code=400, detail="Enter the transaction ID for the partial amount.")
    if second_paid and not cur_second and not second_txn:
        raise HTTPException(status_code=400, detail="Enter the transaction ID for the remaining amount.")

    # undo "remaining amount paid" -> back to "partial amount paid"
    if cur_second and not second_paid:
        await db.security_deposits.update_one(q, {
            "$set": {"status": "partial", "paid_amount": first_amt,
                     "transaction_id": dep.get("first_transaction_id"), "paid_at": None},
            "$unset": {"second_paid_at": ""}})
        cur_second = False
    # undo "partial amount paid" -> back to nothing paid (saved amount / next date are kept)
    if cur_first and not first_paid:
        await db.security_deposits.update_one(q, {
            "$set": {"status": "pending", "transaction_id": None, "paid_at": None},
            "$unset": {"paid_amount": "", "next_payment_date": "", "first_paid_at": "",
                       "second_paid_at": "", "first_transaction_id": "", "first_amount": ""}})
        cur_first = False
    # mark partial amount paid (or just change its date / transaction id)
    if first_paid:
        if not cur_first:
            await _record_qr_deposit_part(org, did, "first", first_amt, total, nxt, txn=first_txn, paid_on=first_on)
        elif first_txn and first_txn != (dep.get("first_transaction_id") or ""):
            await db.security_deposits.update_one(q, {"$set": {"first_transaction_id": first_txn, **({"transaction_id": first_txn} if not cur_second else {})}})
            await _set_deposit_part_txn(org, did, "first", first_txn)
        await db.security_deposits.update_one(q, {"$set": {"first_paid_at": _paid_at_iso(first_on)}})
    # mark remaining amount paid (or just change its date / transaction id)
    if second_paid:
        if not cur_second:
            await _record_qr_deposit_part(org, did, "second", round(total - first_amt, 2), total, txn=second_txn, paid_on=second_on)
        elif second_txn and second_txn != (dep.get("transaction_id") or ""):
            await db.security_deposits.update_one(q, {"$set": {"transaction_id": second_txn}})
            await _set_deposit_part_txn(org, did, "second", second_txn)
        await db.security_deposits.update_one(
            q, {"$set": {"second_paid_at": _paid_at_iso(second_on), "paid_at": _paid_at_iso(second_on)}})
    await log_audit(user, "deposit_partial_payments_updated", "driver", did,
                    f"Partial deposit payments updated: partial {'paid' if first_paid else 'unpaid'}, "
                    f"remaining {'paid' if second_paid else 'unpaid'}")
    return {"ok": True}


@api.post("/admin/drivers/{did}/deposit-full-unpaid")
async def override_deposit_full_unpaid(did: str, request: Request):
    """Fully paid -> half paid: the remaining half becomes due immediately (popup in driver app)."""
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    org = user.get("organization_id")
    dep = await db.security_deposits.find_one({"driver_id": did, "organization_id": org})
    if not dep or dep.get("status") != "paid":
        raise HTTPException(status_code=400, detail="Deposit is not fully paid.")
    total = float(dep.get("amount") or 0)
    if dep.get("partial_enabled") or dep.get("first_paid_at"):
        # paid through the partial flow: step back to "first half paid", remaining half due now
        await db.security_deposits.update_one(
            {"_id": dep["_id"]},
            {"$set": {"status": "partial", "paid_amount": float(dep.get("first_amount") or round(total / 2, 2)),
                      "next_payment_date": _today_ist().isoformat(), "paid_at": None},
             "$unset": {"second_paid_at": ""}})
    else:
        # paid in full (partial deposit never enabled): back to plain unpaid, partial stays OFF
        await db.security_deposits.update_one(
            {"_id": dep["_id"]},
            {"$set": {"status": "pending", "transaction_id": None, "paid_at": None},
             "$unset": {"paid_amount": "", "next_payment_date": "", "first_paid_at": "",
                        "second_paid_at": "", "first_transaction_id": ""}})
    await log_audit(user, "deposit_full_marked_unpaid", "driver", did, "Full deposit marked unpaid; remaining half due")
    return {"ok": True}


@api.post("/admin/drivers/{did}/deposit-unpaid")
async def override_deposit_unpaid(did: str, request: Request):
    """Reset the security deposit back to 'pending' (driver is asked to pay again)."""
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    org = user.get("organization_id")
    cur = await db.security_deposits.find_one({"driver_id": did, "organization_id": org})
    if cur and cur.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Mark the full deposit unpaid first.")
    res = await db.security_deposits.update_one(
        {"driver_id": did, "organization_id": org},
        {"$set": {"status": "pending", "transaction_id": None, "paid_at": None},
         "$unset": {"paid_amount": "", "next_payment_date": "", "first_paid_at": "",
                    "second_paid_at": "", "first_transaction_id": ""}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Deposit record not found")
    await log_audit(user, "deposit_marked_unpaid", "driver", did, "Security deposit reset to unpaid")
    return {"ok": True}

# ===== PAID LEAVE (rent-free days) =====
PAID_LEAVE_MAX_PER_MONTH = 3


async def _paid_leave_bounds(drv, did):
    """Earliest day a paid leave can be set (driver joined / first rental start) and the
    past days whose rent is already paid (those cannot become paid-leave days)."""
    today_iso = _today_ist().isoformat()
    cands = [str(drv.get("created_at") or "")[:10]]
    for r_ in await db.rentals.find({"driver_id": did}, {"start": 1}).to_list(50):
        cands.append(str(r_.get("start") or "")[:10])
    min_date = min([c for c in cands if c] or [today_iso])
    paid = set()
    async for p in db.rental_payments.find(
            {"driver_id": did, "payment_status": "paid", "kind": {"$in": ["daily", "outstanding", "catchup"]}},
            {"covers_dates": 1}):
        paid.update(p.get("covers_dates") or [])
    async for l in db.driver_odometer_logs.find(
            {"driver_id": did, "snapshot_rent_txn_id": {"$nin": [None, ""]}}, {"date": 1}):
        if l.get("date"):
            paid.add(l["date"])
    return min_date, sorted(x for x in paid if x < today_iso)


async def _rent_paid_for_date(did, d_str):
    """True if the daily rent for this date is already paid (or a trip was already started on it with paid rent)."""
    pay = await db.rental_payments.find_one({
        "driver_id": did, "payment_status": "paid",
        "kind": {"$in": ["daily", "outstanding", "catchup"]},
        "covers_dates": d_str,
    })
    if pay:
        return True
    trip = await db.driver_odometer_logs.find_one({
        "driver_id": did, "date": d_str,
        "snapshot_rent_txn_id": {"$nin": [None, ""]},
    })
    return bool(trip)


@api.get("/drivers/{did}/paid-leave")
async def get_paid_leave(did: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    drv = await db.drivers.find_one(org_filter(user, {"_id": oid(did)}))
    if not drv:
        raise HTTPException(status_code=404, detail="Driver not found")
    today_iso = _today_ist().isoformat()
    month_prefix = today_iso[:7]
    min_date, paid_dates = await _paid_leave_bounds(drv, did)
    return {
        "dates": sorted(drv.get("paid_leave_dates") or []),
        "min_date": min_date,
        "paid_dates": paid_dates,
        "today": today_iso,
        "today_rent_paid": await _rent_paid_for_date(did, today_iso),
        "max_days": PAID_LEAVE_MAX_PER_MONTH,
    }


@api.post("/drivers/{did}/paid-leave")
async def set_paid_leave(did: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    body = await request.json()
    picked = sorted({str(x)[:10] for x in (body.get("dates") or [])})
    drv = await db.drivers.find_one(org_filter(user, {"_id": oid(did)}))
    if not drv:
        raise HTTPException(status_code=404, detail="Driver not found")

    today = _today_ist()
    today_iso = today.isoformat()
    month_prefix = today_iso[:7]
    old = drv.get("paid_leave_dates") or []

    min_date, _paid_past = await _paid_leave_bounds(drv, did)
    for x in picked:
        try:
            date.fromisoformat(x)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date")
        if x < today_iso and x not in old:
            # a past day newly marked as paid leave
            if x < min_date:
                raise HTTPException(status_code=400, detail=f"Paid leave cannot be set before {min_date}")
            if x in _paid_past:
                raise HTTPException(status_code=400, detail=f"Rent for {x} is already paid, so it cannot be a paid leave day")

    # Leave days that already passed stay on record. No limit on the number of future leave days.
    keep = [x for x in old if x < today_iso]

    # Today can be newly added only if today's rent has NOT been paid.
    if today_iso in picked and today_iso not in old:
        if await _rent_paid_for_date(did, today_iso):
            raise HTTPException(status_code=400, detail="Today's rent is already paid, so today cannot be a paid leave day")

    new_list = sorted(set(keep) | set(picked))
    await db.drivers.update_one({"_id": oid(did)}, {"$set": {"paid_leave_dates": new_list}})

    # Leave for TODAY was cancelled: let today's rent be charged again.
    if today_iso in old and today_iso not in new_list:
        await db.rental_accounts.update_one(
            {"driver_id": did},
            {"$set": {"rent_charged_through": (today - timedelta(days=1)).isoformat()}}
        )

    # Re-run the account roll-forward now so any rent already accrued for a leave day is removed immediately.
    rental = await _active_rental(drv.get("organization_id"), did)
    if rental:
        await _rental_account(rental)

    await log_audit(user, "driver_paid_leave_set", "driver", did, f"Paid leave days: {', '.join(picked) if picked else 'none'}")
    return {"ok": True, "dates": [x for x in new_list if x.startswith(month_prefix)]}


# ===== WEEK-OFF (driver requests, admin approves) =====
WEEK_OFF_MAX_PER_MONTH = 3  # driver week-off days per month (separate from Paid Leave)


async def _rent_pending_before_today(org, did):
    """True if the driver still has unpaid rent for any fully elapsed day (up to yesterday, IST).
    Uses the same account calculation as the driver home screen (blocked_dates = elapsed unpaid days)."""
    rental = await _active_rental(org, did)
    if not rental:
        return False
    acct = await _rental_account(rental)
    return bool((acct or {}).get("blocked_dates"))


async def _week_off_state(did):
    """Week-off info sent to the driver app: the app is locked ONLY when today is an
    approved week-off day. On every other day it works as usual."""
    today_iso = _today_ist().isoformat()
    drv = await db.drivers.find_one({"_id": oid(did)}, {"week_off_dates": 1}) or {}
    locked = today_iso in set(drv.get("week_off_dates") or [])
    return {"locked": locked, "date": today_iso if locked else None, "notice": None}


@api.get("/driver/week-off")
async def driver_week_off_info(request: Request):
    user = await get_user(request)
    require_driver(user)
    did = user["id"]
    today_iso = _today_ist().isoformat()
    month = today_iso[:7]
    drv = await db.drivers.find_one({"_id": oid(did)}) or {}
    reqs = await db.week_off_requests.find({"driver_id": did, "month": month}).sort("created_at", -1).to_list(None)
    return {
        "today": today_iso,
        "today_rent_paid": await _rent_paid_for_date(did, today_iso),
        "rent_pending": await _rent_pending_before_today(user.get("organization_id"), did),
        "max_days": WEEK_OFF_MAX_PER_MONTH,
        "taken_dates": sorted(x for x in (drv.get("week_off_dates") or []) if x.startswith(month)),
        "leave_dates": sorted(x for x in (drv.get("paid_leave_dates") or []) if x.startswith(month)),
        "pending_dates": sorted({x for r in reqs if r.get("status") == "pending" for x in r.get("dates", [])}),
        "requests": [{"id": str(r["_id"]), "dates": r.get("dates", []), "status": r.get("status", "pending")} for r in reqs],
    }


@api.post("/driver/week-off")
async def driver_apply_week_off(request: Request, body: dict):
    user = await get_user(request)
    require_driver(user)
    did = user["id"]
    today_iso = _today_ist().isoformat()
    month = today_iso[:7]
    if await _rent_pending_before_today(user.get("organization_id"), did):
        raise HTTPException(status_code=400, detail="Please pay your pending rent (up to yesterday) before applying for a week-off")
    picked = sorted({str(x)[:10] for x in (body.get("dates") or [])})
    if not picked:
        raise HTTPException(status_code=400, detail="Select at least one date")
    for x in picked:
        try:
            date.fromisoformat(x)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date")
        if x < today_iso or not x.startswith(month):
            raise HTTPException(status_code=400, detail="Week-off can only be applied for today or later days of the current month")
    drv = await db.drivers.find_one({"_id": oid(did)}) or {}
    taken = {x for x in (drv.get("week_off_dates") or []) if x.startswith(month)}
    pending = {x for r in await db.week_off_requests.find({"driver_id": did, "month": month, "status": "pending"}).to_list(None)
               for x in r.get("dates", [])}
    if any(x in set(drv.get("paid_leave_dates") or []) for x in picked):
        raise HTTPException(status_code=400, detail="A selected date is already a paid leave day")
    if any(x in taken or x in pending for x in picked):
        raise HTTPException(status_code=400, detail="A selected date already has a week-off or a pending request")
    if len(taken | pending) + len(picked) > WEEK_OFF_MAX_PER_MONTH:
        raise HTTPException(status_code=400, detail=f"Maximum {WEEK_OFF_MAX_PER_MONTH} week-off days per month")
    if today_iso in picked and await _rent_paid_for_date(did, today_iso):
        raise HTTPException(status_code=400, detail="Today's rent is already paid, so today cannot be a week-off day")
    await db.week_off_requests.insert_one({
        "organization_id": user.get("organization_id"), "driver_id": did, "month": month,
        "dates": picked, "status": "pending", "created_at": now_iso(),
    })
    return {"ok": True}

@api.put("/driver/week-off/{rid}")
async def driver_edit_week_off(rid: str, request: Request, body: dict):
    """Driver changes the dates of a request that the admin has not approved/rejected yet."""
    user = await get_user(request)
    require_driver(user)
    did = user["id"]
    today_iso = _today_ist().isoformat()
    month = today_iso[:7]
    req = await db.week_off_requests.find_one({"_id": oid(rid), "driver_id": did})
    if not req or req.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Only a pending request can be edited")
    if await _rent_pending_before_today(user.get("organization_id"), did):
        raise HTTPException(status_code=400, detail="Please pay your pending rent (up to yesterday) before applying for a week-off")
    picked = sorted({str(x)[:10] for x in (body.get("dates") or [])})
    if not picked:
        raise HTTPException(status_code=400, detail="Select at least one date")
    for x in picked:
        try:
            date.fromisoformat(x)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date")
        if x < today_iso or not x.startswith(month):
            raise HTTPException(status_code=400, detail="Week-off can only be applied for today or later days of the current month")
    drv = await db.drivers.find_one({"_id": oid(did)}) or {}
    taken = {x for x in (drv.get("week_off_dates") or []) if x.startswith(month)}
    # other pending requests only (this request's own dates are being replaced)
    pending = {x for r in await db.week_off_requests.find(
                   {"driver_id": did, "month": month, "status": "pending", "_id": {"$ne": req["_id"]}}).to_list(None)
               for x in r.get("dates", [])}
    if any(x in set(drv.get("paid_leave_dates") or []) for x in picked):
        raise HTTPException(status_code=400, detail="A selected date is already a paid leave day")
    if any(x in taken or x in pending for x in picked):
        raise HTTPException(status_code=400, detail="A selected date already has a week-off or a pending request")
    if len(taken | pending) + len(picked) > WEEK_OFF_MAX_PER_MONTH:
        raise HTTPException(status_code=400, detail=f"Maximum {WEEK_OFF_MAX_PER_MONTH} week-off days per month")
    if today_iso in picked and await _rent_paid_for_date(did, today_iso):
        raise HTTPException(status_code=400, detail="Today's rent is already paid, so today cannot be a week-off day")
    # status filter guards against the admin approving at the same moment
    res = await db.week_off_requests.update_one(
        {"_id": req["_id"], "status": "pending"},
        {"$set": {"dates": picked, "updated_at": now_iso()}})
    if not res.matched_count:
        raise HTTPException(status_code=400, detail="This request was just decided by the admin and can no longer be edited")
    return {"ok": True}

@api.post("/driver/week-off/ack")
async def driver_week_off_ack(request: Request):
    user = await get_user(request)
    require_driver(user)
    await db.week_off_requests.update_many(
        {"driver_id": user["id"], "status": "approved"}, {"$set": {"acknowledged": True}})
    return {"ok": True}


@api.post("/admin/drivers/{did}/week-off/{rid}/approve")
async def admin_approve_week_off(did: str, rid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    drv = await db.drivers.find_one(org_filter(user, {"_id": oid(did)}))
    if not drv:
        raise HTTPException(status_code=404, detail="Driver not found")
    req = await db.week_off_requests.find_one({"_id": oid(rid), "driver_id": did})
    if not req or req.get("status") != "pending":
        raise HTTPException(status_code=400, detail="This request is no longer pending")
    today_iso = _today_ist().isoformat()
    dates = [x for x in req.get("dates", []) if x >= today_iso]
    if not dates:
        raise HTTPException(status_code=400, detail="All requested dates have already passed. Reject this request.")
    if today_iso in dates:
        if await _rent_paid_for_date(did, today_iso):
            raise HTTPException(status_code=400, detail="Today's rent is already paid, so today cannot be a week-off day")
        if drv.get("active_trip_id"):
            raise HTTPException(status_code=400, detail="Driver has a trip in progress. The driver must end it first.")
    # approved week-off days are rent-free, but stay separate from Paid Leave
    await db.drivers.update_one({"_id": oid(did)}, {"$set": {
        "week_off_dates": sorted(set(drv.get("week_off_dates") or []) | set(dates)),
    }})
    await db.week_off_requests.update_one({"_id": req["_id"]}, {"$set": {
        "status": "approved", "dates": dates, "decided_at": now_iso(), "acknowledged": False}})
    # remove any rent already accrued for these days
    rental = await _active_rental(drv.get("organization_id"), did)
    if rental:
        await _rental_account(rental)
    await log_audit(user, "driver_week_off_approved", "driver", did, f"Week-off approved: {', '.join(dates)}")
    return {"ok": True}


@api.post("/admin/drivers/{did}/week-off/{rid}/reject")
async def admin_reject_week_off(did: str, rid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    drv = await db.drivers.find_one(org_filter(user, {"_id": oid(did)}))
    if not drv:
        raise HTTPException(status_code=404, detail="Driver not found")
    req = await db.week_off_requests.find_one({"_id": oid(rid), "driver_id": did})
    if not req or req.get("status") != "pending":
        raise HTTPException(status_code=400, detail="This request is no longer pending")
    await db.week_off_requests.update_one({"_id": req["_id"]}, {"$set": {"status": "rejected", "decided_at": now_iso()}})
    await log_audit(user, "driver_week_off_rejected", "driver", did, f"Week-off rejected: {', '.join(req.get('dates', []))}")
    return {"ok": True}


# ===== ADMIN BLOCK =====
@api.post("/drivers/{did}/admin-block")
async def admin_block_driver(did: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    body = await request.json()
    btype = body.get("type")
    reason = (body.get("reason") or "").strip()
    if btype not in ("temporary", "permanent"):
        raise HTTPException(status_code=400, detail="Invalid block type")
    if not reason:
        raise HTTPException(status_code=400, detail="Reason is required")
    res = await db.drivers.update_one(
        org_filter(user, {"_id": oid(did)}),
        {"$set": {"admin_block": btype, "admin_block_reason": reason, "admin_blocked_at": datetime.now().isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    await log_audit(user, "driver_admin_blocked", "driver", did, f"Driver {btype} blocked: {reason}")
    if btype == "permanent":
        # Permanently blocked: release the vehicle held by this driver so it can be assigned to another driver
        await db.vehicles.update_many(
            {"current_driver_id": did, "status": "rented"},
            {"$set": {"status": "available", "current_driver_id": None, "current_driver_name": None,
                      "current_rental_id": None, "current_rental_code": None, "rental_end": None}})
        await db.driver_vehicle_assignments.update_many({"driver_id": did, "end": None}, {"$set": {"end": now_iso()}})
    return {"ok": True}


@api.post("/drivers/{did}/admin-unblock")
async def admin_unblock_driver(did: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    res = await db.drivers.update_one(
        org_filter(user, {"_id": oid(did)}),
        {"$unset": {"admin_block": "", "admin_block_reason": "", "admin_blocked_at": ""}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    await log_audit(user, "driver_admin_unblocked", "driver", did, "Driver unblocked by admin")
    return {"ok": True}


# ===== REFERRALS =====
REFERRAL_MILESTONES = [(30, 1000), (60, 1500)]  # default (days driven, reward) used until admin saves "Referral amount"


async def _referral_config(org):
    """Batch days/amounts set by admin / city manager (falls back to 30 days/1000 and 30 days/1500)."""
    d = await db.referral_settings.find_one({"organization_id": org}) or {}
    b1d = int(d.get("batch1_days") or 30)
    b1a = float(d.get("batch1_amount", 1000) or 0)
    b2d = int(d.get("batch2_days") or 30)
    b2a = float(d.get("batch2_amount", 1500) or 0)
    return {"batch1_days": b1d, "batch1_amount": b1a, "batch2_days": b2d, "batch2_amount": b2a}


def _referral_milestones(cfg):
    # Both batches count from the same start day, each with its own number of days and reward.
    return [(cfg["batch1_days"], cfg["batch1_amount"]), (cfg["batch2_days"], cfg["batch2_amount"])]


@api.get("/referral-settings")
async def get_referral_settings(request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    return await _referral_config(user.get("organization_id"))


@api.put("/referral-settings")
async def set_referral_settings(request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    b = await request.json()
    try:
        b1d, b2d = int(b.get("batch1_days")), int(b.get("batch2_days"))
        b1a, b2a = float(b.get("batch1_amount")), float(b.get("batch2_amount"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Enter valid days and amounts for both batches")
    if b1d < 1 or b2d < 1:
        raise HTTPException(status_code=400, detail="Number of days must be at least 1")
    if b1a < 0 or b2a < 0:
        raise HTTPException(status_code=400, detail="Amount cannot be negative")
    org = user.get("organization_id")
    await db.referral_settings.update_one(
        {"organization_id": org},
        {"$set": {"batch1_days": b1d, "batch1_amount": b1a, "batch2_days": b2d, "batch2_amount": b2a, "updated_at": now_iso()}},
        upsert=True,
    )
    await log_audit(user, "referral_settings_updated", "organization", org, f"Referral batches: {b1d} days/{b1a}, {b2d} days/{b2a}")
    return await _referral_config(org)


def _batch_progress(days, milestones):
    """Split total counted days into 1st-batch and 2nd-batch progress (2nd batch = the next N days)."""
    b1 = milestones[0][0]
    b2 = milestones[1][0]
    return [{"done": min(days, b1), "total": b1},
            {"done": min(days, b2), "total": b2}]


async def _referral_progress(did, milestones=None, joined_at=None):
    milestones = milestones or REFERRAL_MILESTONES
    total = sum(a for _, a in milestones)
    res = {"rental_start": None, "days_driven": 0, "reward_earned": 0, "reward_pending": total,
           "batches": [{"target": d, "amount": a} for d, a in milestones], "total_days": max(d for d, _ in milestones),
           "count_from": None, "batch_progress": _batch_progress(0, milestones),
           "week_off_days": [], "paid_leave_days": [], "batches_completed": False}
    if not did:
        return res
    first = await db.rentals.find({"driver_id": did}).sort("start", 1).to_list(1)
    if not first:
        return res
    start = str(first[0].get("start") or first[0].get("start_date") or "")[:10]
    res["rental_start"] = start
    # Days are counted only from the day the driver paid the deposit (partial first amount or full).
    sec = await db.security_deposits.find_one({"driver_id": did}) or {}
    dep_iso = (sec.get("first_paid_at") or sec.get("paid_at")) if sec.get("status") in ("partial", "paid") else None
    count_from = None
    if dep_iso:
        try:
            count_from = datetime.fromisoformat(str(dep_iso).replace("Z", "+00:00")).astimezone(IST).date().isoformat()
        except Exception:
            count_from = str(dep_iso)[:10]
    # Commission / Salary package drivers pay no deposit: their days count from the rental start date
    if first[0].get("package_category") in ("commission", "salary") and start:
        _st = str(first[0].get("start") or first[0].get("start_date") or "")
        try:
            count_from = _st if len(_st) <= 10 else datetime.fromisoformat(_st.replace("Z", "+00:00")).astimezone(IST).date().isoformat()
        except Exception:
            count_from = _st[:10]
    # If the driver joined after the deposit date, counting starts from the joined date
    if count_from and joined_at and str(joined_at)[:10] > count_from:
        count_from = str(joined_at)[:10]
    # A "driven day" = any day the driver submitted an odometer log (not required to be continuous)
    days = 0
    if count_from:
        _s = date.fromisoformat(count_from)
        dates = [(_s + timedelta(days=i)).isoformat() for i in range((_today_ist() - _s).days)]
        # Paid-leave and week-off days are not counted
        _drv_off = await db.drivers.find_one({"_id": oid(did)}, {"paid_leave_dates": 1, "paid_leaves": 1, "week_off_dates": 1}) or {}
        _off_days = set(_drv_off.get("paid_leave_dates") or []) | set(_drv_off.get("paid_leaves") or []) | set(_drv_off.get("week_off_dates") or [])
        days = len([x for x in dates if x not in _off_days])
        # Dates (from the deposit day) that are not counted - shown in the Edit Referral form
        res["week_off_days"] = sorted(str(x) for x in set(_drv_off.get("week_off_dates") or []) if str(x) >= count_from)
        res["paid_leave_days"] = sorted(str(x) for x in (set(_drv_off.get("paid_leave_dates") or []) | set(_drv_off.get("paid_leaves") or [])) if str(x) >= count_from)
    earned = sum(a for d, a in milestones if days >= d)
    res.update(days_driven=days, reward_earned=earned, reward_pending=total - earned,
               count_from=count_from, batch_progress=_batch_progress(days, milestones),
               batches_completed=bool(count_from) and days >= max(d for d, _ in milestones))
    return res


@api.get("/referrals")
async def list_referrals(request: Request, referrer_id: str = None, city: str = None):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    q = {"referrer_driver_id": referrer_id} if referrer_id else {}
    if city and city != "all":
        q["city"] = city
    items = await db.referrals.find(org_filter(user, q)).sort("referred_at", -1).to_list(None)
    out = []
    current_cfg = await _referral_config(user.get("organization_id"))
    snap_keys = ("batch1_days", "batch1_amount", "batch2_days", "batch2_amount")
    for i in items:
        # Older referrals (created before this change) have no snapshot yet:
        # lock them once to the settings currently active, so they never change again.
        if not all(k in i for k in snap_keys):
            snap = {k: i.get(k, current_cfg[k]) for k in snap_keys}
            await db.referrals.update_one({"_id": i["_id"]}, {"$set": snap})
            i.update(snap)
        row_cfg = {k: i[k] for k in snap_keys}
        milestones = _referral_milestones(row_cfg)
        r = ser(i)
        r.update(await _referral_progress(i.get("referred_driver_id"), milestones, i.get("joined_at")))
        out.append(r)
    return out


@api.post("/referrals")
async def create_referral(request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    b = await request.json()
    if not b.get("referrer_driver_id") or not (b.get("referred_name") or "").strip():
        raise HTTPException(status_code=400, detail="Referrer and referred driver name required")
    ref = await db.drivers.find_one({"_id": oid(b["referrer_driver_id"])})
    if not ref:
        raise HTTPException(status_code=404, detail="Referrer driver not found")
    phone = re.sub(r"\s+", "", b.get("referred_phone") or "")
    if not phone:
        raise HTTPException(status_code=400, detail="Referred driver phone is required")
    if phone == ref.get("phone"):
        raise HTTPException(status_code=400, detail="Driver cannot refer themselves")
    existing_ref = await db.referrals.find_one({"referred_phone": phone})
    if existing_ref:
        raise HTTPException(status_code=400, detail=f"Already referred by {existing_ref.get('referrer_name')} ({existing_ref.get('referrer_code') or '-'}) on {existing_ref.get('referred_at')}")
    new_drv = await db.drivers.find_one({"phone": phone})
    if not new_drv:
        nd = {
            "name": b["referred_name"].strip(), "phone": phone,
            "city": ref.get("city"), "status": "active",
            "organization_id": user.get("organization_id") or ref.get("organization_id"),
            "driver_code": await _next_driver_code(ref.get("city")),
            "referred_by_id": b["referrer_driver_id"],
            "referred_by_code": ref.get("driver_code"),
            "created_at": now_iso(),
        }
        r2 = await db.drivers.insert_one(nd)
        new_drv = {**nd, "_id": r2.inserted_id}
        await log_audit(user, "driver_created", "driver", str(r2.inserted_id), f"Driver {nd['name']} added via referral")
        doc = {
        "organization_id": user.get("organization_id"),
        "city": ref.get("city"),
        "referrer_driver_id": b["referrer_driver_id"],
                "referrer_name": ref.get("name"),
        "referrer_code": ref.get("driver_code"),
        "referred_name": b["referred_name"].strip(),
        "referred_phone": phone,
        "referred_driver_id": str(new_drv["_id"]),
        "referred_code": new_drv.get("driver_code"),
        "referred_at": b.get("referred_at") or _today_ist().isoformat(),
        "joined_at": b.get("joined_at") or None,
        "created_at": datetime.now().isoformat(),
        # Lock the Referral Amount settings that are active right now for this referral
        **(await _referral_config(user.get("organization_id"))),
    }
    res = await db.referrals.insert_one(doc)
    await log_audit(user, "referral_added", "driver", b["referrer_driver_id"], f"Referred {doc['referred_name']}")
    return ser(await db.referrals.find_one({"_id": res.inserted_id}))


@api.put("/referrals/{rid}")
async def update_referral(rid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    b = await request.json()
    upd = {k: b[k] for k in ("referred_name", "referred_phone", "referred_at", "joined_at") if k in b}
    await db.referrals.update_one(org_filter(user, {"_id": oid(rid)}), {"$set": upd})
    return ser(await db.referrals.find_one({"_id": oid(rid)}))


@api.delete("/referrals/{rid}")
async def delete_referral(rid: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    await db.referrals.delete_one(org_filter(user, {"_id": oid(rid)}))
    return {"ok": True}

@api.post("/drivers/{did}/admin-block")
async def admin_block_driver(did: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    body = await request.json()
    btype = body.get("type")
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Reason is required")
    if btype not in ("temporary", "permanent"):
        raise HTTPException(status_code=400, detail="Invalid block type")
    res = await db.drivers.update_one(
        org_filter(user, {"_id": oid(did)}),
        {"$set": {"admin_block": btype, "admin_block_reason": reason, "admin_blocked_at": datetime.now().isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    await log_audit(user, "driver_admin_blocked", "driver", did, f"Driver {btype} blocked by admin")
    return {"ok": True}


@api.post("/drivers/{did}/admin-unblock")
async def admin_unblock_driver(did: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager"])
    res = await db.drivers.update_one(
        org_filter(user, {"_id": oid(did)}),
        {"$unset": {"admin_block": "", "admin_block_reason": "", "admin_blocked_at": ""}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Driver not found")
    await log_audit(user, "driver_admin_unblocked", "driver", did, "Driver unblocked by admin")
    return {"ok": True}


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
        "organization_id": user.get("organization_id"),
        "driver_id": did, "driver_name": driver["name"],
        "vehicle_id": body["vehicle_id"], "vehicle_number": vehicle["vehicle_number"],
        "city": vehicle["city"], "start": now_iso(), "end": None,
        "notes": body.get("notes", ""), "created_at": now_iso(),
    }
    await db.driver_vehicle_assignments.insert_one(assignment)
    await db.drivers.update_one({"_id": oid(did)}, {"$set": {
        "current_vehicle_id": body["vehicle_id"], "current_vehicle_number": vehicle["vehicle_number"]}})
    _open_r = await _active_rental(user.get("organization_id"), did)
    if _open_r:   # keep the rental on the new vehicle so the Driver App shows it
        await db.rentals.update_one({"_id": _open_r["_id"]}, {"$set": {
            "vehicle_id": body["vehicle_id"], "vehicle_number": vehicle["vehicle_number"]}})
    # A driver with an active / suspended rental holds the vehicle: the previous one becomes available, the new one rented
    _state = (_open_r or {}).get("status") or driver.get("rental_status")
    _holds = _state in ("active", "suspended")
    _old_vid = (_open_r or {}).get("vehicle_id") or driver.get("current_vehicle_id")
    if _holds and _old_vid and _old_vid != body["vehicle_id"]:
        await db.vehicles.update_one(
            {"_id": oid(_old_vid), "current_driver_id": {"$in": [did, None, ""]}},   # only if this driver was holding it
            {"$set": {"status": "available", "current_driver_id": None, "current_driver_name": None,
                      "current_rental_id": None, "current_rental_code": None, "rental_end": None}})
    _veh_set = {"current_driver_id": did, "current_driver_name": driver["name"]}
    if _holds:
        _veh_set.update({"status": "rented",
                         "current_rental_id": str(_open_r["_id"]) if _open_r else None,
                         "current_rental_code": (_open_r or {}).get("rental_code"),
                         "rental_end": (_open_r or {}).get("end")})
    await db.vehicles.update_one({"_id": oid(body["vehicle_id"])}, {"$set": _veh_set})
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
    # --- Commission / Salary packages (optional; unused by Silver/Gold/Platinum/In-Build) ---
    commission_percent: Optional[float] = None
    salary_amount: Optional[float] = None


@api.get("/rental-plans")
async def list_plans(request: Request):
    user = await get_user(request)
    flt = {"organization_id": user.get("organization_id")}
    if user.get("role") == "city_manager" and user.get("city"):
        flt["city"] = user["city"]
    docs = await db.rental_plans.find(flt).to_list(200)
    return [ser(d) for d in docs]


@api.post("/rental-plans")
async def create_plan(body: PlanBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    doc = body.model_dump(exclude_none=True)  # existing packages don't get the new null fields
    if doc.get("package_type") in ("Commission", "Salary"):
        doc["deposit"] = 0   # commission / salary packages carry no security deposit
    doc["organization_id"] = user.get("organization_id")
    doc["created_at"] = now_iso()
    res = await db.rental_plans.insert_one(doc)
    return ser(await db.rental_plans.find_one({"_id": res.inserted_id}))


@api.put("/rental-plans/{pid}")
async def update_plan(pid: str, body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    body.pop("id", None); body.pop("_id", None)
    if body.get("package_type") in ("Commission", "Salary"):
        body["deposit"] = 0   # commission / salary packages carry no security deposit
    old_plan = await db.rental_plans.find_one(org_filter(user, {"_id": oid(pid)}))
    await db.rental_plans.update_one(org_filter(user, {"_id": oid(pid)}), {"$set": body})
    
# Sync new amount to every driver NOT currently on an active trip. Owing rent for
    # a trip that hasn't started yet does NOT protect a driver from a rate change —
    # only a trip actually in progress does (its snapshot must stay frozen). See the
    # rent_due reprice loop below for how a pending, unpaid "next trip" rent charge
    # gets updated to the new rate.
    plan = await db.rental_plans.find_one({"_id": oid(pid)})
    if plan and "amount" in body:
        new_rate = float(body["amount"])
        
        # Find drivers currently mid-trip (active_trip_id set) — these are the ONLY
        # drivers excluded from the sync.
        locked_user_ids = set()
        async for u in db.users.find({"organization_id": user.get("organization_id"), "active_trip_id": {"$exists": True, "$ne": "", "$ne": None}}):
            locked_user_ids.add(str(u["_id"]))
        async for d in db.drivers.find({"organization_id": user.get("organization_id"), "active_trip_id": {"$exists": True, "$ne": "", "$ne": None}}):
            locked_user_ids.add(str(d["_id"]))
            
        # 2. Find drivers with unpaid dues (outstanding_amount > 0)
        # async for acct in db.rental_accounts.find({"organization_id": user.get("organization_id"), "outstanding_amount": {"$gt": 0}}):
        #     locked_user_ids.add(str(acct["driver_id"]))
        
        # Rentals still carry the OLD package name/city until they are synced, so match on those
        old_name = (old_plan or {}).get("name") or plan["name"]
        old_city = (old_plan or {}).get("city", plan.get("city", ""))
        new_name = plan["name"]
        pkg_filter = {"organization_id": user.get("organization_id"), "package_name": {"$regex": f"^{old_name}$", "$options": "i"}, "status": {"$ne": "ended"}}
        city_filter = {"organization_id": user.get("organization_id"), "package_name": {"$regex": f"^{old_name}$", "$options": "i"}, "city": {"$regex": f"^{old_city}$", "$options": "i"}, "status": {"$ne": "ended"}}

        # Link every matching rental to this plan by id (locked drivers included) so later
        # syncs can still find the plan after a rename. Changes neither rate nor name.
        await db.rentals.update_many(dict(city_filter), {"$set": {"plan_id": pid}})
        
        if locked_user_ids:
            pkg_filter["driver_id"] = {"$nin": list(locked_user_ids)}
            city_filter["driver_id"] = {"$nin": list(locked_user_ids)}
        
        # Collect the drivers being updated BEFORE renaming (the filters match on the OLD name)
        drivers_to_update = []
        async for r in db.driver_rentals.find(pkg_filter): drivers_to_update.append(r["driver_id"])
        async for r in db.rentals.find(city_filter): drivers_to_update.append(r["driver_id"])

        # (drivers_to_update was already collected above, before the rename)
        # Update driver_rentals (skip locked drivers): new rate + new package name
        await db.driver_rentals.update_many(pkg_filter, {"$set": {"daily_rate": new_rate, "package_name": new_name}})
        # Update rentals B2B (skip locked drivers): new rate + new package name
        await db.rentals.update_many(city_filter, {"$set": {"daily_rate": new_rate, "package_name": new_name, "plan_name": new_name}})        
        # Find all drivers that match this package (and are not locked) to update their accounts & profiles
        # drivers_to_update = []
        # async for r in db.driver_rentals.find(pkg_filter): drivers_to_update.append(r["driver_id"])
        # async for r in db.rentals.find(city_filter): drivers_to_update.append(r["driver_id"])
        
                # (drivers_to_update was already collected above, before the rename)
        if drivers_to_update:
            # Update rental_accounts
            acct_filter = {"organization_id": user.get("organization_id"), "driver_id": {"$in": drivers_to_update}}
                        # Unpaid rent is kept per day. Before the new rate applies: (1) close out
            # every unpaid day up to YESTERDAY at the OLD rate so it is frozen, and
            # (2) move only TODAY's charge to the new rate. Extra-km is never touched.
            today_ist = _today_ist()
            today_iso = today_ist.isoformat()
            yday = today_ist - timedelta(days=1)
            async for a in db.rental_accounts.find(acct_filter):
                rent_due = float(a.get("rent_due", 0) or 0)
                if rent_due <= 0:
                    continue
                old_rate = float(a.get("daily_rate", 0) or 0)
                rbd = {k: float(v) for k, v in (a.get("rent_by_date") or {}).items()}
                if not rbd:  # legacy account
                    rbd = {(max(a["unpaid_dates"]) if a.get("unpaid_dates") else today_iso): rent_due}
                d_ = date.fromisoformat(max(rbd)) + timedelta(days=1)
                while d_ <= yday and old_rate > 0:
                    rbd.setdefault(d_.isoformat(), old_rate)
                    d_ += timedelta(days=1)
                if today_iso in rbd:
                    rbd[today_iso] = new_rate
                new_total = round(sum(rbd.values()), 2)
                delta = round(new_total - rent_due, 2)
                await db.rental_accounts.update_one(
                    {"_id": a["_id"]},
                    {"$set": {"rent_by_date": rbd, "rent_due": new_total},
                     "$inc": {"outstanding_amount": delta},
                     "$addToSet": {"unpaid_dates": {"$each": list(rbd.keys())}}}
                )
            await db.rental_accounts.update_many(acct_filter, {"$set": {"daily_rate": new_rate}})
            # Update users (for package_rate in driver app)
            for d_id in drivers_to_update:
                await db.users.update_one({"_id": ObjectId(d_id)}, {"$set": {"package_rate": new_rate, "package_name": new_name}})
                await db.drivers.update_one({"_id": ObjectId(d_id)}, {"$set": {"package_rate": new_rate, "package_name": new_name}})
    return ser(plan)


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
    plan_id: Optional[str] = None
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
            dates_to_check.append(_today_ist())
    elif from_date:
        try:
            dates_to_check.append(datetime.strptime(from_date, "%Y-%m-%d").date())
        except:
            dates_to_check.append(_today_ist())
    else:
        dates_to_check.append(_today_ist())
    
    out = []
    for r in rentals:
        rid = str(r["_id"])
        
        sec_dep = await db.security_deposits.find_one({"driver_id": r["driver_id"], "organization_id": user.get("organization_id")})
        if sec_dep:
            deposit = sec_dep.get("amount", 5000)
            if sec_dep.get("status", "pending") == "pending":
                # nothing paid yet -> follow the current package deposit
                deposit = await _deposit_amount_for(user.get("organization_id"), r["driver_id"], sec_dep) or deposit
            deposit_paid = deposit if sec_dep.get("status") == "paid" else float(sec_dep.get("paid_amount") or 0)
            deposit_status = sec_dep.get("status", "pending")
            deposit_txn_id = sec_dep.get("transaction_id", "")
            # paid_at is stored as a UTC ISO string; the first 10 chars are the same
            # UTC date format the rows use for `date`
            deposit_paid_date = (sec_dep.get("paid_at") or "")[:10] if sec_dep.get("status") == "paid" else ""
        else:
            deposit = await _deposit_amount_for(user.get("organization_id"), r["driver_id"], None) or r.get("deposit", 5000)
            deposit_paid = 0
            deposit_status = "pending"
            deposit_txn_id = ""
            deposit_paid_date = ""
        
        # Commission / Salary package: no deposit; their paid collections (trip screenshots) are shown per day
        _pkg_cat = r.get("package_category") or "rental"
        _coll_by_date = {}
        if _pkg_cat != "rental":
            deposit = 0
            deposit_paid = 0
            async for _c in db.package_collections.find({"organization_id": user.get("organization_id"), "driver_id": r["driver_id"], "status": "paid"}):
                _coll_by_date[_c.get("for_date")] = _c

        # Dates on which a split-deposit part was paid (partial amount / remaining amount):
        # each of these dates must have a Daily Collection row so the Deposit column shows it.
        dep_event_dates = set()
        if sec_dep and sec_dep.get("status") in ("partial", "paid") and sec_dep.get("first_paid_at"):
            dep_event_dates.add(str(sec_dep["first_paid_at"])[:10])
            if sec_dep.get("status") == "paid" and sec_dep.get("second_paid_at"):
                dep_event_dates.add(str(sec_dep["second_paid_at"])[:10])

        # Deposit parts recorded by the office (QR / admin) -> shown as "Paid by QR" in Daily Collection
        _dep_manual = await db.rental_payments.find({
            "organization_id": user.get("organization_id"), "driver_id": r["driver_id"], "kind": "deposit",
            "payment_status": "paid", "gateway": {"$in": ["manual_qr", "manual_admin"]}}).to_list(20)
        deposit_first_manual = any(p.get("deposit_part") == "first" for p in _dep_manual)
        deposit_main_manual = any(p.get("deposit_part") != "first" for p in _dep_manual)

        drv_doc = await db.drivers.find_one({"_id": ObjectId(r["driver_id"])}) if r.get("driver_id") else None
        driver_avatar = drv_doc.get("avatar") if drv_doc else None
        week_off_set = set((drv_doc or {}).get("week_off_dates") or [])
        paid_leave_set = set((drv_doc or {}).get("paid_leave_dates") or []) | week_off_set  # week-off days carry no rent either

        # Rental start date (IST, YYYY-MM-DD): the Settled / Unsettled button of Commission / Salary rows is not shown on this day
        _st_raw = str(r.get("start") or r.get("created_at") or "")
        try:
            if len(_st_raw) <= 10:
                _rental_start_str = _st_raw
            else:
                _rental_start_str = datetime.fromisoformat(_st_raw.replace("Z", "+00:00")).astimezone(IST).strftime("%Y-%m-%d")
        except Exception:
            _rental_start_str = _st_raw[:10]
        
        acct = await _rental_account(r)
        outstanding_amount = float(acct["outstanding_amount"]) if acct else 0
        rbd_map = (acct or {}).get("rent_by_date") or {}

        # Each started trip remembers the payment that paid for it (snapshot_rent_txn_id).
        # Use that instead of guessing by date. If two trips point at the same payment
        # (stale value after an "outstanding" payment), the earliest trip owns it.
        claim_owner = {}
        claim_owner_date = {}   # txn -> date of the trip that owns it
        async for cl in db.driver_odometer_logs.find(
            {"driver_id": r["driver_id"], "snapshot_rent_txn_id": {"$nin": [None, ""]}}
        ).sort("created_at", 1):
            claim_owner.setdefault(cl["snapshot_rent_txn_id"], str(cl["_id"]))
            claim_owner_date.setdefault(cl["snapshot_rent_txn_id"], cl.get("date"))
        claimed_pay = {}
        if claim_owner:
            async for cp in db.rental_payments.find({
                "driver_id": r["driver_id"], "payment_status": "paid",
                "transaction_id": {"$in": list(claim_owner.keys())}
            }):
                claimed_pay[cp["transaction_id"]] = cp
        
        
        vehicle_reg_number = None
        if r.get("vehicle_id"):
            veh_doc = await db.vehicles.find_one({"_id": oid(r["vehicle_id"])})
            if veh_doc:
                vehicle_reg_number = veh_doc.get("registration_number")
                
        # Vehicle history of this driver (oldest -> newest), so past rows keep the vehicle
        # the driver actually had on that day instead of the vehicle assigned today.
        _veh_hist = []
        async for _a in db.driver_vehicle_assignments.find({"driver_id": r["driver_id"]}).sort("start", 1):
            try:
                _a_day = datetime.fromisoformat(str(_a.get("start")).replace("Z", "+00:00")).astimezone(IST).date()
            except Exception:
                continue
            _veh_hist.append((_a_day, _a.get("vehicle_id"), _a.get("vehicle_number")))
        _veh_reg_cache = {}

        for d in dates_to_check:
            d_str = d.strftime("%Y-%m-%d")
            # default = current vehicle of the rental (unchanged behaviour)
            row_vehicle_code = r.get("vehicle_number", r.get("vehicle_reg", "N/A"))
            row_vehicle_reg = vehicle_reg_number
            if len(_veh_hist) > 1:
                _pick_i = 0   # dates before the first recorded assignment -> oldest vehicle
                for _i, _h in enumerate(_veh_hist):
                    if _h[0] <= d:
                        _pick_i = _i
                # the latest assignment is the current vehicle -> keep the default above;
                # only older days (an earlier vehicle) are switched to that vehicle
                if _pick_i < len(_veh_hist) - 1 and _veh_hist[_pick_i][2]:
                    _pv_id = _veh_hist[_pick_i][1]
                    row_vehicle_code = _veh_hist[_pick_i][2]
                    if _pv_id not in _veh_reg_cache:
                        _pv_doc = None
                        try:
                            _pv_doc = await db.vehicles.find_one({"_id": oid(_pv_id)}) if _pv_id else None
                        except Exception:
                            _pv_doc = None
                        _veh_reg_cache[_pv_id] = (_pv_doc or {}).get("registration_number")
                    row_vehicle_reg = _veh_reg_cache[_pv_id]
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
                        # Payments already claimed by a started trip are shown on that trip's row only.
            # EXCEPTION: a multi-day payment (e.g. yesterday + today paid together) is owned
            # by the trip of ONE of its days. The other covered days must still show their
            # own share (covers_amounts[day]) and the same transaction id.
            day_payments = [
                p for p in day_payments
                if p.get("transaction_id") not in claim_owner
                or (
                    len(p.get("covers_amounts") or {}) > 1
                    and d_str in (p.get("covers_amounts") or {})
                    and d_str != claim_owner_date.get(p.get("transaction_id"))
                )
            ]
            
            # Security-deposit payments are stored in the same collection but must NOT count
            # towards daily rent / extra-KM settlement (or supply its transaction id).
            valid_payments = [
                p for p in day_payments
                if p.get("payment_status") == "paid"
                and p.get("type") != "refund"
                and p.get("kind") != "deposit"
            ]
            
            today_paid = sum(p.get("amount", 0) for p in valid_payments)
                        # Rent and extra-KM are billed and paid as two separate charges, so also
            # split the day's payments by kind for the "Daily Rent" / "Extra KM Charges"
            # columns: "daily" pays rent only, "extra_km" pays extra-km only. A legacy
            # "outstanding" payment (from before the two were split) covered both at
            # once, so for display purposes it's counted toward rent first.
            rent_payments = []
            extra_km_payments = []
            for p in day_payments:
                if p.get("payment_status") != "paid" or p.get("type") == "refund":
                    continue
                _k = p.get("kind")
                _amt = float(p.get("amount", 0) or 0)
                if _k == "daily":
                    rent_payments.append(p)
                elif _k == "extra_km":
                    extra_km_payments.append(p)
                elif _k == "catchup":
                    rent_payments.append(p)
                    extra_km_payments.append(p)
                elif _k == "outstanding":
                    # Combined payment (rent + extra KM): split it so each column
                    # shows only its own part. covers_amounts holds the rent days.
                    _cov = p.get("covers_amounts") or {}
                    _rent_part = float(_cov.get(d_str, sum(_cov.values()) if _cov else _amt) or 0)
                    _rent_part = min(_rent_part, _amt)
                    _extra_part = round(_amt - _rent_part, 2)
                    if _rent_part > 0:
                        rent_payments.append({**p, "amount": _rent_part})
                    if _extra_part > 0:
                        extra_km_payments.append({**p, "amount": _extra_part})
            
            odo_logs = await db.driver_odometer_logs.find({
                "driver_id": r["driver_id"],
                "date": d_str
            }).to_list(100)

            is_today = (d == _today_ist())
            # Key the pending-rent injection off the date the charge actually belongs
            # to (the day the previous trip ended, which is what a later payment's
            # covers_dates will also be) — NOT off "today". Using "today" here meant
            # a driver who delayed paying by even a day would have the pending row
            # keep drifting onto a fresh date each day, so a payment finally made
            # (with covers_dates fixed to the original charge date) would never
            # match it and the row would show "NOT PAID" forever, even after payment.
            pending_rent_here = d_str in rbd_map and (acct or {}).get("rent_due", 0) > 0
            # Rent that has ALREADY been paid for the next trip (but that trip hasn't
            # started yet) is removed from unpaid_dates the instant it's paid, so
            # pending_rent_here alone goes blind to it the moment payment clears.
            # pending_rent_covers_dates remembers exactly which date that payment
            # was for — set when the payment clears, unset only once the trip it
            # paid for actually starts — so the row keeps showing PAID on the
            # correct date instead of disappearing right after payment.
            pending_rent_paid_here = (
                (acct or {}).get("pending_rent_paid")
                and d_str in (acct or {}).get("pending_rent_covers_dates", [])
            )
            if not odo_logs:
                odo_logs = [None]
            elif False:  # rent is now billed at trip end and shown on that trip's own row
                # A trip already happened on this date AND rent is now due (or has
                # just been paid) for the NEXT trip (charged the moment that trip
                # ended). Give it its own row instead of folding it into the
                # already-completed trip's row — every trip (started, paid-but-not-
                # yet-started, or still unpaid) gets its own row.
                odo_logs = list(odo_logs) + [None]
                
            for idx, odo_log in enumerate(odo_logs):
                                # This trip's own rent payment (independent of covers_dates).
                if odo_log:
                    _txn = odo_log.get("snapshot_rent_txn_id")
                    _own = claimed_pay.get(_txn) if _txn else None
                    if _own and claim_owner.get(_txn) == str(odo_log["_id"]):
                        valid_payments.insert(0, _own)
                        rent_payments.insert(0, _own)
                        today_paid += float(_own.get("amount", 0) or 0)
                base_daily_rate = float(r.get("daily_rate", 0))
                if odo_log and "snapshot_daily_rent" in odo_log:
                    # Trip already started: the rate frozen onto it at START is
                    # authoritative for its rent, forever — an admin rate change
                    # afterward must never alter it.
                    base_daily_rate = float(odo_log["snapshot_daily_rent"])
                elif not odo_log and rent_payments:
                    # Rent already PAID for this day: use this day's own amount
                    # (a multi-day payment stores the split in covers_amounts).
                    _p0 = rent_payments[0]
                    base_daily_rate = float((_p0.get("covers_amounts") or {}).get(d_str, _p0.get("amount", 0)) or 0)
                elif not odo_log and pending_rent_here:
                    # Rent charged for THIS day but not yet paid — frozen at the
                    # rate that applied on this day.
                    base_daily_rate = float(rbd_map.get(d_str, 0))
                else:
                    # Nothing charged yet — show today's live rate for reference only.
                    base_daily_rate = float(r.get("daily_rate", 0))
                
                daily_rate = base_daily_rate
                # Rent is paid once per day: 2nd+ trips on the same date carry no rent of their own.
                second_trip_same_day = bool(odo_log) and idx > 0
                if second_trip_same_day:
                    daily_rate = 0.0
                # Paid leave date: no daily rent for this day.
                is_paid_leave = d_str in paid_leave_set
                if is_paid_leave:
                    daily_rate = 0.0
                
                # Extract extra KM data from the odometer log snapshot
                extra_km = odo_log.get("extra_km", 0) if odo_log else 0
                extra_km_charge = odo_log.get("extra_km_charge", 0.0) if odo_log else 0.0
                overage_per_km = odo_log.get("snapshot_overage_per_km", 0.0) if odo_log else 0.0
                total_charge = daily_rate + extra_km_charge
                
                # Distribute the today_paid across rows roughly (if there are multiple)
                row_paid = min(today_paid, total_charge)
                today_paid = max(0, today_paid - row_paid)
                daily_status = "paid" if row_paid >= total_charge else ("partial" if row_paid > 0 else "pending")
                
                # Assign exact transaction ID(s) for this row. A day can now be
                # settled by two separate payments (daily rent + extra KM), so
                # consume as many payments as needed to cover this row's charge
                # and combine their transaction ids.
                row_txn_id = None
                row_pay_method = None
                row_paid_on = None
                consumed_txns = []
                remaining_for_row = row_paid
                while remaining_for_row > 0.005 and valid_payments:
                    p = valid_payments.pop(0)
                    consumed_txns.append(p.get("transaction_id"))
                    row_pay_method = row_pay_method or p.get("payment_method")
                    created = p.get("created_at")
                    if created and not row_paid_on:
                        row_paid_on = created.split("T")[0]
                    remaining_for_row -= p.get("amount", 0)
                if consumed_txns:
                    row_txn_id = ", ".join([t for t in consumed_txns if t])
                
                # Consume rent payments for this row until the daily rate is covered.
                rent_paid_amt = 0.0
                rent_txn_id = None
                rent_manual = False
                remaining_rent = daily_rate
                consumed_rent_txns = []
                while remaining_rent > 0.005 and rent_payments:
                    p = rent_payments.pop(0)
                    if p.get("gateway") in ("manual_qr", "manual_admin"):
                        rent_manual = True
                    consumed_rent_txns.append(p.get("transaction_id"))
                    rent_paid_amt += p.get("amount", 0)
                    remaining_rent -= p.get("amount", 0)
                if consumed_rent_txns:
                    rent_txn_id = ", ".join([t for t in consumed_rent_txns if t])
                rent_status = "paid" if daily_rate > 0 and rent_paid_amt >= daily_rate - 0.01 else ("paid" if second_trip_same_day else "not_paid")
                if is_paid_leave:
                    rent_status = "paid_leave"
                if d_str in week_off_set:
                    rent_status = "week_off"
                
                # Consume extra-KM payments for this row until the extra-km charge is covered.
                extra_km_paid_amt = 0.0
                extra_km_txn_id = None
                remaining_extra = extra_km_charge
                consumed_extra_txns = []
                while remaining_extra > 0.005 and extra_km_payments:
                    p = extra_km_payments.pop(0)
                    consumed_extra_txns.append(p.get("transaction_id"))
                    extra_km_paid_amt += p.get("amount", 0)
                    remaining_extra -= p.get("amount", 0)
                if consumed_extra_txns:
                    extra_km_txn_id = ", ".join([t for t in consumed_extra_txns if t])
                extra_km_status = "paid" if extra_km_charge > 0 and extra_km_paid_amt >= extra_km_charge - 0.01 else "not_paid"
                
                start_meter = odo_log.get("start_reading", 0) if odo_log else 0
                end_meter = odo_log.get("end_reading", 0) if odo_log else 0
                total_km = odo_log.get("driven_today", 0) if odo_log else 0
                # A week-off day always gets a row (Daily Rent column shows "Week-off"), even with no trip / payment.
                # (pending_rent_here is only used by the row-creation condition below, after the rent was already worked out.)
                # only for today / past week-off days; future week-off days must not create rows yet
                if d_str in week_off_set and idx == 0 and not odo_log and d <= _today_ist():
                    pending_rent_here = True
                
                # A date on which a split-deposit part was paid always gets its own row, even when
                # there was no trip / rent that day. Such a row carries no rent charge (only the
                # Deposit column has details), so revenue and pending-rent totals are unaffected.
                deposit_only_row = (
                    idx == 0 and not odo_log and d_str in dep_event_dates
                    and not (d == _today_ist() or row_paid > 0 or pending_rent_here or d_str in (acct or {}).get("unpaid_dates", []))
                )
                if deposit_only_row:
                    daily_rate = 0.0
                    total_charge = 0.0
                    daily_status = "paid"
                    rent_status = "paid"  # shows "_" in the Daily Rent status column

                # TODAY's row: rent is not asked on the same day, so the Daily Rent column shows the
                # PREVIOUS day's rent (amount + date + paid / not paid). Nothing is shown when that
                # day was a week-off / paid-leave day, or when no rent exists for it (e.g. the driver
                # was onboarded today) -> the column shows "-".
                prev_rent = None
                if idx == 0 and not deposit_only_row and rent_status not in ("week_off", "paid_leave"):
                    _y_str = (d - timedelta(days=1)).strftime("%Y-%m-%d")
                    if _y_str not in paid_leave_set:
                        if float(rbd_map.get(_y_str, 0) or 0) > 0 and float((acct or {}).get("rent_due", 0) or 0) > 0:
                            prev_rent = {"date": _y_str, "amount": float(rbd_map[_y_str]), "status": "not_paid", "transaction_id": None}
                        else:
                            _yp = await db.rental_payments.find_one({
                                "rental_id": rid, "payment_status": "paid",
                                "kind": {"$in": ["daily", "outstanding", "catchup"]},
                                "covers_dates": _y_str,
                            }, sort=[("created_at", -1)])
                            if _yp:
                                prev_rent = {
                                    "date": _y_str,
                                    "amount": float((_yp.get("covers_amounts") or {}).get(_y_str, _yp.get("amount", 0)) or 0),
                                    "status": "paid",
                                    "transaction_id": _yp.get("transaction_id"),
                                    "manual": _yp.get("gateway") in ("manual_qr", "manual_admin"),
                                }
                if d == _today_ist() or odo_log or row_paid > 0 or pending_rent_here or d_str in (acct or {}).get("unpaid_dates", []) or deposit_only_row or (idx == 0 and d_str in _coll_by_date) or (idx == 0 and (d - timedelta(days=1)).strftime("%Y-%m-%d") in _coll_by_date) or (idx == 0 and _pkg_cat != "rental" and _rental_start_str and _rental_start_str <= d_str and d <= _today_ist()):
                    out.append({
                        "id": f"{rid}_{d_str}_{idx}",
                        "driver_name": r.get("driver_name", "Unknown"),
                        "driver_avatar": driver_avatar,
                        "vehicle_code": row_vehicle_code,
                        "vehicle_reg": row_vehicle_reg,
                        "city": r.get("city", "Unknown"),
                        "status": r.get("status", "pending_payment"),
                        "daily_rate": daily_rate,
                        "extra_km": extra_km,
                        "extra_km_charge": extra_km_charge,
                        "overage_per_km": overage_per_km,
                        "total_charge": total_charge,
                        "today_paid": row_paid,
                        "outstanding_amount": outstanding_amount if (d == _today_ist() and idx == 0) else max(0, total_charge - row_paid),
                        "daily_status": daily_status,
                        "paid_on": row_paid_on,
                        "payment_method": row_pay_method,
                        "transaction_id": row_txn_id,
                        "is_paid_leave": d_str in (drv_doc.get("paid_leaves", []) if drv_doc else []),
                        "rent_status": rent_status,
                        "rent_amount": daily_rate,
                        "rent_transaction_id": rent_txn_id,
                        "rent_manual": rent_manual,
                        "is_today_row": bool(is_today and idx == 0),
                        "prev_rent_row": bool(idx == 0 and not deposit_only_row),
                        "prev_rent": prev_rent,
                        # date shown under PAID / NOT PAID in the Rent column: the previous day (rent is paid a day later),
                        # hidden when that previous day was a paid-leave / week-off day
                        "rent_for_date": (None if (d - timedelta(days=1)).strftime("%Y-%m-%d") in paid_leave_set
                                          else (d - timedelta(days=1)).strftime("%Y-%m-%d")),
                        "extra_km_status": extra_km_status,
                        "extra_km_amount": extra_km_charge,
                        "extra_km_transaction_id": extra_km_txn_id,
                        "deposit": deposit,
                        "deposit_paid": deposit_paid,
                        "deposit_status": deposit_status,
                        "deposit_transaction_id": deposit_txn_id,
                        "deposit_first_manual": deposit_first_manual,
                        "deposit_main_manual": deposit_main_manual,
                        "deposit_paid_date": deposit_paid_date,
                        # split (half + half) deposit info
                        "deposit_split": bool((sec_dep or {}).get("first_paid_at")),
                        "deposit_first_paid_date": ((sec_dep or {}).get("first_paid_at") or "")[:10],
                        "deposit_second_paid_date": ((sec_dep or {}).get("second_paid_at") or "")[:10] if (sec_dep or {}).get("status") == "paid" else "",
                        "deposit_first_txn": (sec_dep or {}).get("first_transaction_id") or "",
                        "deposit_first_amount": float((sec_dep or {}).get("first_amount") or round(float(deposit) / 2, 2)),
                        "deposit_second_amount": round(float(deposit) - float((sec_dep or {}).get("first_amount") or round(float(deposit) / 2, 2)), 2),
                        "deposit_next_payment_date": (sec_dep or {}).get("next_payment_date") or "",
                        "driver_id": r.get("driver_id"),
                        "package_category": _pkg_cat,
                        "rental_start": _rental_start_str,
                        # yesterday's date + whether it was a week-off / paid-leave day (shown on this row's Settled / Unsettled cell)
                        "prev_date": (d - timedelta(days=1)).strftime("%Y-%m-%d"),
                        "prev_day_status": ("week_off" if (d - timedelta(days=1)).strftime("%Y-%m-%d") in week_off_set
                                            else "paid_leave" if (d - timedelta(days=1)).strftime("%Y-%m-%d") in paid_leave_set
                                            else None),
                        "commission_percent": r.get("commission_percent"),
                        "salary_amount": r.get("salary_amount"),
                        "collection": _coll_view(_coll_by_date.get(d_str)) if idx == 0 else None,
                        # yesterday's collection payment (settled on this day's row)
                        "prev_collection": _coll_view(_coll_by_date.get((d - timedelta(days=1)).strftime("%Y-%m-%d"))) if idx == 0 else None,
                        "start_meter": start_meter if start_meter else None,
                        "end_meter": end_meter if end_meter else None,
                        "total_km": total_km if total_km else None,
                        "date": d_str,
                    })

        
    # settled / unsettled flag of every row (set with the button on the Daily Collection page)
    if out:
        _settled_ids = {s_["row_id"] async for s_ in db.collection_settlements.find(
            {"organization_id": user.get("organization_id"), "row_id": {"$in": [x["id"] for x in out]}, "settled": True},
            {"row_id": 1})}
        for x in out:
            x["settled"] = x["id"] in _settled_ids

    out.sort(key=lambda x: x["date"], reverse=True)
    return out


class SettleBody(BaseModel):
    row_id: str
    settled: bool


@api.post("/admin/daily-collection/settle")
async def settle_daily_collection_row(body: SettleBody, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    await db.collection_settlements.update_one(
        {"organization_id": user.get("organization_id"), "row_id": body.row_id},
        {"$set": {"settled": body.settled, "updated_by": user.get("name") or user.get("email"), "updated_at": now_iso()}},
        upsert=True)
    return {"ok": True, "row_id": body.row_id, "settled": body.settled}


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
        
    plan = None
    if body.plan_id:
        plan = await db.rental_plans.find_one({"_id": oid(body.plan_id), "organization_id": user.get("organization_id")})

    pkg_name = (plan.get("name") if plan else None) or body.package_name or driver.get("package_name", "Standard")
    pkg_rate = (plan.get("amount") if plan else None) or body.package_rate or driver.get("package_rate", 0)
    if pkg_rate == 0 and not plan:
        plan = await db.rental_plans.find_one({"name": {"$regex": f"^{pkg_name}$", "$options": "i"}, "organization_id": user.get("organization_id")})
        if plan:
            pkg_rate = plan.get("amount", 0)

    code = await _next_rental_code(user.get("organization_id"))
    doc = {
        "organization_id": user.get("organization_id"),
        "rental_code": code,
        "driver_id": body.driver_id, "driver_name": driver["name"],
        "vehicle_id": body.vehicle_id, "vehicle_number": vehicle["vehicle_number"],
        "plan_id": (str(plan["_id"]) if plan else body.plan_id), "plan_name": pkg_name,        "package_name": pkg_name, "daily_rate": pkg_rate,
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
        "organization_id": user.get("organization_id"),
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
        acct_doc = await db.rental_accounts.find_one({"organization_id": user.get("organization_id"), "driver_id": r["driver_id"]})
        # Manual/cash payments don't specify whether they're for rent or extra-km,
        # so settle extra-km first (it must clear before rent in the pay-before-trip
        # flow), then whatever's left goes toward rent — keeping both balances
        # consistent with the split payment flow in the driver app.
        remaining = amount
        extra_km_due = float((acct_doc or {}).get("extra_km_due", 0) or 0)
        rent_due = float((acct_doc or {}).get("rent_due", 0) or 0)
        extra_km_reduction = min(remaining, extra_km_due)
        remaining -= extra_km_reduction
        rent_reduction = min(remaining, rent_due)
        await db.rental_accounts.update_one(
            {"organization_id": user.get("organization_id"), "driver_id": r["driver_id"]},
            {
                "$inc": {
                    "outstanding_amount": -amount,
                    "extra_km_due": -extra_km_reduction,
                    "rent_due": -rent_reduction,
                },
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
        "organization_id": user.get("organization_id"), "driver_id": r["driver_id"], "driver_name": r["driver_name"],
        "vehicle_id": r["vehicle_id"], "vehicle_number": r["vehicle_number"], "city": r["city"],
        "start": now_iso(), "end": None, "notes": f"Via rental {r['rental_code']}", "created_at": now_iso()})
    await log_audit(user, "rental_activated", "rental", rid, f"Rental {r['rental_code']} activated")
    await add_notification(user.get("organization_id"), "green", "Rental activated",
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
    await add_notification(user.get("organization_id"), "green", "Rental renewed",
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
    body["organization_id"] = user.get("organization_id")
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
    body["organization_id"] = user.get("organization_id")
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
    items = await _find("service_requests", user, extra, sort=("created_at", -1))
    rows = items if isinstance(items, list) else items.get("items", [])
    vids = list({r.get("vehicle_id") for r in rows if r.get("vehicle_id") and not r.get("registration_number")})
    if vids:
        vdocs = await db.vehicles.find({"_id": {"$in": [oid(v) for v in vids]}}).to_list(len(vids))
        vmap = {str(v["_id"]): v for v in vdocs}
        for r in rows:
            v = vmap.get(r.get("vehicle_id"))
            if v and not r.get("registration_number"):
                r["registration_number"] = v.get("registration_number")
            if v and not r.get("driver_name"):
                r["driver_name"] = v.get("current_driver_name")
    return items


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
    count = await db.service_requests.count_documents({"organization_id": user.get("organization_id")})
    body["organization_id"] = user.get("organization_id")
    body["code"] = f"SR-{2000 + count + 1}"
    body["status"] = body.get("status", "new")
    body["created_at"] = now_iso()
    body.setdefault("timeline", [{"stage": "new", "at": now_iso(), "by": user.get("name")}])
    res = await db.service_requests.insert_one(body)
    await log_audit(user, "service_request_created", "service_request", str(res.inserted_id),
                    f"Service request {body['code']} created")
    lvl = "red" if body.get("priority") == "critical" else "amber"
    await add_notification(user.get("organization_id"), lvl, "Service request created",
                           f"{body['code']} - {body.get('issue_type','')} - {body.get('vehicle_number','')}",
                           link="/service-requests", city=body.get("city"))
    return ser(await db.service_requests.find_one({"_id": res.inserted_id}))

async def _restore_vehicle_status(vehicle_id):
    """Set vehicle to 'rented' if it has an active rental, else 'available'."""
    active = await db.rentals.find_one({"vehicle_id": vehicle_id, "status": "active"})
    await db.vehicles.update_one(
        {"_id": oid(vehicle_id)},
        {"$set": {"status": "rented" if active else "available"}},
    )

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
            await _restore_vehicle_status(sr["vehicle_id"])
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
    items = await _find("vehicle_services", user, extra, sort=("start_date", -1))
    rows = items if isinstance(items, list) else items.get("items", [])
    vids = list({r.get("vehicle_id") for r in rows if r.get("vehicle_id")})
    if vids:
        vdocs = await db.vehicles.find({"_id": {"$in": [oid(v) for v in vids]}}).to_list(len(vids))
        vmap = {str(v["_id"]): v for v in vdocs}
        for r in rows:
            v = vmap.get(r.get("vehicle_id"))
            if v:
                r["registration_number"] = v.get("registration_number")
    return items


@api.post("/vehicle-services")
async def create_service(body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    body["organization_id"] = user.get("organization_id")
    body["created_at"] = now_iso()
    res = await db.vehicle_services.insert_one(body)
    await log_audit(user, "service_completed", "vehicle_service", str(res.inserted_id),
                    f"Service recorded for {body.get('vehicle_number','')}")
    if body.get("service_request_id"):
        await db.service_requests.update_one({"_id": oid(body["service_request_id"])}, {"$set": {"status": "closed"}})
    if body.get("completion_date"):
        if body.get("next_service_date"):
            await db.vehicles.update_one({"_id": oid(body["vehicle_id"])}, {"$set": {"next_service_date": body["next_service_date"]}})
        await _restore_vehicle_status(body["vehicle_id"])
        await add_notification(user.get("organization_id"), "green", "Service completed",
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
            {"organization_id": user.get("organization_id"), "parking": l["name"]})
    return locs


@api.post("/locations")
async def create_location(body: dict, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    body["organization_id"] = user.get("organization_id")
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
    body["organization_id"] = user.get("organization_id")
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
    items = await _find("incidents", user, extra, sort=("created_at", -1))
    rows = items if isinstance(items, list) else items.get("items", [])
    vids = list({r.get("vehicle_id") for r in rows if r.get("vehicle_id")})
    if vids:
        vdocs = await db.vehicles.find({"_id": {"$in": [oid(v) for v in vids]}}).to_list(len(vids))
        vmap = {str(v["_id"]): v for v in vdocs}
        for r in rows:
            v = vmap.get(r.get("vehicle_id"))
            if v:
                r["registration_number"] = v.get("registration_number")
    return items


@api.post("/incidents")
async def create_incident(body: dict, request: Request):
    user = await get_user(request)
    count = await db.incidents.count_documents({"organization_id": user.get("organization_id")})
    body["organization_id"] = user.get("organization_id")
    body["code"] = f"INC-{3000 + count + 1}"
    body["status"] = body.get("status", "reported")
    body["created_at"] = now_iso()
    res = await db.incidents.insert_one(body)
    await log_audit(user, "incident_reported", "incident", str(res.inserted_id), f"Incident {body['code']} reported")
    await add_notification(user.get("organization_id"), "red", "Incident reported",
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
    filt = {"organization_id": user.get("organization_id")}
    if q:
        filt["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"phone": {"$regex": q, "$options": "i"}},
                       {"company": {"$regex": q, "$options": "i"}}]
    docs = await db.customers.find(filt).sort("name", 1).to_list(1000)
    out = []
    for c in docs:
        s = ser(c)
        s["order_count"] = await db.orders.count_documents({"organization_id": user.get("organization_id"), "customer_id": s["id"]})
        out.append(s)
    return out


@api.get("/customers/{cid}")
async def get_customer(cid: str, request: Request):
    user = await get_user(request)
    c = await db.customers.find_one(org_filter(user, {"_id": oid(cid)}))
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    out = ser(c)
    orders = await db.orders.find({"organization_id": user.get("organization_id"), "customer_id": cid}).sort("created_at", -1).to_list(500)
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
    doc["organization_id"] = user.get("organization_id")
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
    count = await db.orders.count_documents({"organization_id": user.get("organization_id")})
    code = body.order_number or f"ORD-{1000 + count + 1}"
    total = float(body.total_amount or 0); paid = float(body.paid_amount or 0)
    doc = body.model_dump()
    doc.update({
        "organization_id": user.get("organization_id"), "order_number": code,
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
    await add_notification(user.get("organization_id"), "blue", "New order received", f"{code} · {cust['name']} · {body.product or ''}", link="/orders")
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
            await add_notification(user.get("organization_id"), "green", "Order completed", f"{o['order_number']} · {o.get('customer_name','')}", link="/orders")
    return _order_ser(await db.orders.find_one({"_id": oid(oid_)}))


@api.post("/orders/{oid_}/attachments")
async def add_attachment(oid_: str, body: dict, request: Request):
    user = await get_user(request)
    o = await db.orders.find_one(org_filter(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    max_mb = 10
    org = await db.organizations.find_one({"org_id": user.get("organization_id")})
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
    base = {"organization_id": user.get("organization_id")}
    orders = await db.orders.find(base).to_list(5000)
    kpis = {"total": len(orders)}
    for st in ORDER_STAGES:
        kpis[st] = sum(1 for o in orders if o.get("status") == st)
    kpis["overdue"] = sum(1 for o in orders if order_due_status(o) == "overdue")
    today = _today_ist()
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
    orders = await db.orders.find({"organization_id": user.get("organization_id")}).to_list(5000)
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
    base = {"organization_id": user.get("organization_id")}
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
def _trim_rent_by_date(rbd, target):
    """Drop rent from the OLDEST days until the per-day total equals `target`.
    Used when rent_due is lowered by a manual/partial payment."""
    rbd = {k: float(v) for k, v in (rbd or {}).items()}
    excess = round(sum(rbd.values()) - float(target), 2)
    for d in sorted(rbd):
        if excess <= 0.005:
            break
        cut = min(rbd[d], excess)
        rbd[d] = round(rbd[d] - cut, 2)
        excess = round(excess - cut, 2)
        if rbd[d] <= 0.005:
            del rbd[d]
    return rbd




def require_driver(user):
    if user.get("role") != "driver":
        raise HTTPException(status_code=403, detail="Drivers only")


async def _require_rental_admin(user):
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    org = await db.organizations.find_one({"org_id": user.get("organization_id")})
    if (org or {}).get("industry", "fleet") != "fleet":
        raise HTTPException(status_code=403, detail="Rental management is not enabled for this organization")


async def _active_rental(org, did):
    return await db.rentals.find_one({"organization_id": org, "driver_id": did, "status": {"$ne": "closed"}})


async def _get_package_snapshot(org, did):
    """Resolve a driver's package (rate + KM limits) LIVE from rental_plans.

    IMPORTANT: only call this when STARTING a new trip, to freeze it onto that
    trip's odometer log. Never call this mid-trip or at trip-end for billing/limits
    — that is exactly what let an admin's package edit leak into an already-running
    trip. Once frozen (snapshot_* fields on the log), those values are what must be
    used for that trip's entire lifetime, no matter what the package looks like now.
    """
    rental = await _active_rental(org, did)
    if not rental:
        return None
    plan = None
    if rental.get("plan_id"):
        plan = await db.rental_plans.find_one({"_id": oid(rental["plan_id"])})
    elif rental.get("package_name"):
        plan = await db.rental_plans.find_one({
            "name": {"$regex": f"^{rental['package_name']}$", "$options": "i"},
            "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"},
            "organization_id": org
        })
    monthly_km_limit = plan.get("monthly_km_limit", 0) if plan else 0
    daily_limit_km = _effective_daily_limit(plan.get("daily_limit_km", 0) if plan else 0, monthly_km_limit)
    return {
        "daily_rate": float(plan["amount"]) if plan and plan.get("amount") else rental.get("daily_rate", 0),
        "package_name": (plan.get("name") if plan else rental.get("package_name", "")) or "",
        "monthly_km_limit": monthly_km_limit,
        "daily_limit_km": daily_limit_km,
        "overage_per_km": plan.get("overage_per_km", 0.0) if plan else 0.0,
    }


def _effective_daily_limit(daily_limit, monthly_limit=0):
    """Daily KM limit actually enforced. Uses the package's daily limit; packages
    created before the daily-limit change (daily = 0) fall back to monthly / 30 so
    they keep being charged. 0 means 'no limit'."""
    daily_limit = int(daily_limit or 0)
    if daily_limit > 0:
        return daily_limit
    monthly_limit = int(monthly_limit or 0)
    return round(monthly_limit / 30) if monthly_limit > 0 else 0


async def _day_km_before(driver_id, date_str, exclude_log_id=None):
    """KM already driven by this driver on `date_str` in OTHER completed trips.
    A driver may do several trips in one day; the daily limit applies to their sum."""
    q = {"driver_id": driver_id, "date": date_str, "status": "completed",
         "type": {"$ne": "catchup_rent"}}
    if exclude_log_id:
        q["_id"] = {"$ne": ObjectId(str(exclude_log_id))}
    total = 0
    async for l in db.driver_odometer_logs.find(q, {"driven_today": 1}):
        total += l.get("driven_today", 0) or 0
    return total


def _daily_overage(km_before_today, driven, daily_limit):
    """Extra KM added by this trip = (day total after trip over limit) - (day total before trip over limit)."""
    if not daily_limit or daily_limit <= 0:
        return 0
    return max(0, (km_before_today + driven) - daily_limit) - max(0, km_before_today - daily_limit)


async def _catchup_overage(org, did, rental, baseline_reading, reading):
    """Extra-KM overage for a catch-up reading vs. the last known reading. There's
    no active trip to freeze a snapshot from, so this uses the driver's CURRENT
    live package — same as starting a fresh trip would."""
    if reading < baseline_reading:
        raise HTTPException(400, f"Current KM ({reading}) cannot be less than your last recorded reading ({baseline_reading}).")
    diff_km = reading - baseline_reading
    snap = await _get_package_snapshot(org, did)
    daily_limit = snap["daily_limit_km"] if snap else 0
    overage_per_km = snap["overage_per_km"] if snap else 0.0
    drv = await db.drivers.find_one({"_id": ObjectId(did)})
    # The catch-up reading covers every day since the driver's last reading, so the
    # allowance is daily_limit x number of days in that gap (minimum 1 day).
    gap_days = 1
    try:
        last_d = date.fromisoformat((drv or {}).get("last_odometer_date") or "")
        gap_days = max(1, (_today_ist() - last_d).days)
    except ValueError:
        pass
    allowed_km = daily_limit * gap_days
    overage_km = max(0, diff_km - allowed_km) if daily_limit > 0 else 0
    overage_charge = round(overage_km * overage_per_km, 2)
    return diff_km, overage_km, overage_charge


async def _end_trip_rent_charge(org, did, rate):
    """Daily rent is billed when the day's FIRST trip ends (once per day).
    Returns 0 if today's rent was already billed/paid, today is a paid-leave day, or no rate is set."""
    today_iso = _today_ist().isoformat()
    acct = await db.rental_accounts.find_one({"driver_id": did, "organization_id": org})
    if ((acct or {}).get("rent_charged_through") or "") >= today_iso:
        return 0.0
    if today_iso in ((acct or {}).get("rent_by_date") or {}):
        return 0.0
    drv = await db.drivers.find_one({"_id": ObjectId(did)}, {"paid_leaves": 1, "paid_leave_dates": 1, "week_off_dates": 1})
    leave = set((drv or {}).get("paid_leave_dates") or []) | set((drv or {}).get("paid_leaves") or []) | set((drv or {}).get("week_off_dates") or [])
    if today_iso in leave:
        return 0.0
    return round(float(rate or 0), 2)


# ─── DAILY RENT POPUP / BLOCK SCHEDULE (all times IST) ───────────────────────
# Rent for day D is first asked on D+1 ("yesterday's rent"). Counting D+1 as
# popup-day 1, the driver app is temporarily blocked at 12:00 noon on popup-day
# RENT_BLOCK_DAY (3 => D+3), if the oldest unpaid day is still unpaid.
RENT_BLOCK_DAY = 3
RENT_NOON_HOUR = 12


async def _rental_account(rental):
    """Fetch a driver's rental account server-side. Single source of truth for post-paid odometer billing."""
    org = rental["organization_id"]
    did = rental["driver_id"]
    rate = rental.get("daily_rate", 0)
    today = _today_ist()
    
    existing = await db.rental_accounts.find_one({"organization_id": org, "driver_id": did})
    
    outstanding = existing.get("outstanding_amount", 0) if existing else 0
    unpaid = existing.get("unpaid_dates", []) if existing else []
    
    rent_due = existing.get("rent_due", 0) if existing else 0
    extra_km_due = existing.get("extra_km_due", 0) if existing else 0
    # Legacy fallback: accounts that accrued dues before rent/extra-km were tracked
    # separately only have the combined outstanding_amount. Treat the whole balance
    # as rent due in that case so the pay-before-trip gate still works correctly.
    if rent_due <= 0 and extra_km_due <= 0 and outstanding > 0:
        rent_due = outstanding
    
    # ─── PER-DAY RENT LEDGER (rent_by_date) ─────────────────────────────────
    # Every unpaid day of rent is stored with the amount that applied ON THAT DAY,
    # so a later package edit can never change a past day. rent_due == sum of it.
    today_iso = today.isoformat()
    rent_by_date = {k: float(v) for k, v in ((existing or {}).get("rent_by_date") or {}).items()}
    rbd_changed = False

    # Self-heal: rent can never exist for a day that hasn't started. Drop any
    # future-dated rent and take the same amount off rent_due / outstanding.
    # Covers leftovers from clock changes or timezone slips.
    _future = [k for k in rent_by_date if k > today_iso]
    _future_unpaid = [k for k in unpaid if k > today_iso]
    if _future or _future_unpaid:
        _removed = round(sum(rent_by_date.pop(k) for k in _future), 2)
        rent_due = max(0.0, round(float(rent_due) - _removed, 2))
        outstanding = max(0.0, round(float(outstanding) - _removed, 2))
        unpaid = [k for k in unpaid if k <= today_iso]
        _upd = {"$pull": {"unpaid_dates": {"$in": list(set(_future + _future_unpaid))}}}
        if _future:
            _upd["$unset"] = {f"rent_by_date.{k}": "" for k in _future}
            _upd["$inc"] = {"outstanding_amount": -_removed, "rent_due": -_removed}
        await db.rental_accounts.update_one({"organization_id": org, "driver_id": did}, _upd)
    # If the "rent charged through" marker is ahead of today (clock moved back), pull it back.
    if existing and (existing.get("rent_charged_through") or "") > today_iso:
        await db.rental_accounts.update_one(
            {"organization_id": org, "driver_id": did},
            {"$set": {"rent_charged_through": today_iso}}
        )

    # ─── PAID LEAVE (rent-free days) ────────────────────────────────────────
    # Dates the admin / city manager marked as paid leave never carry daily rent.
    # If rent was already accrued for such a date (e.g. leave granted for today),
    # take it off rent_due / outstanding / unpaid_dates right here.
    _drv_leave = await db.drivers.find_one({"_id": ObjectId(did)}, {"paid_leave_dates": 1, "week_off_dates": 1})
    paid_leave = set((_drv_leave or {}).get("paid_leave_dates") or []) | set((_drv_leave or {}).get("week_off_dates") or [])
    _leave_hit = [k for k in rent_by_date if k in paid_leave]
    _leave_unpaid = [k for k in unpaid if k in paid_leave]
    if _leave_hit or _leave_unpaid:
        _lv_removed = round(sum(rent_by_date.pop(k) for k in _leave_hit), 2)
        rent_due = max(0.0, round(float(rent_due) - _lv_removed, 2))
        outstanding = max(0.0, round(float(outstanding) - _lv_removed, 2))
        unpaid = [k for k in unpaid if k not in paid_leave]
        _lv_upd = {"$pull": {"unpaid_dates": {"$in": list(set(_leave_hit + _leave_unpaid))}}}
        if _leave_hit:
            _lv_upd["$unset"] = {f"rent_by_date.{k}": "" for k in _leave_hit}
            _lv_upd["$inc"] = {"outstanding_amount": -_lv_removed, "rent_due": -_lv_removed}
        await db.rental_accounts.update_one({"organization_id": org, "driver_id": did}, _lv_upd)

    # Legacy accounts: rent is owed but was never broken down per day.
    if rent_due > 0 and not rent_by_date:
        rent_by_date = {(max(unpaid) if unpaid else today_iso): round(float(rent_due), 2)}
        rbd_changed = True

    # Manual/partial payments lower rent_due: remove the same amount from the OLDEST days.
    if rent_by_date and round(sum(rent_by_date.values()), 2) > round(float(rent_due), 2) + 0.01:
        rent_by_date = _trim_rent_by_date(rent_by_date, float(rent_due))
        rbd_changed = True

    # Driver owes rent and is NOT mid-trip: (a) today's charge follows the live plan
    # rate, (b) every day since the last recorded one is added at the rate that was
    # in force, so unpaid days pile up until the driver pays them all.
    # ─── DAILY RENT ACCRUAL ─────────────────────────────────────────────────
    # One rent per calendar day (IST). `rent_charged_through` = last day already
    # charged. Each new day adds that day's rent (today at the live plan rate,
    # skipped days at the rate in force). Nothing is ever charged for a future day.
    if existing:
        marker = existing.get("rent_charged_through")
        if not marker:
            dep_doc = await db.security_deposits.find_one({"organization_id": org, "driver_id": did})
            deposit_ok = (not dep_doc) or dep_doc.get("status") in ("paid", "partial") or (dep_doc.get("amount", 0) or 0) <= 0
            if deposit_ok:
                marker = (today - timedelta(days=1)).isoformat()
            if rent_by_date:
                marker = max([marker or ""] + list(rent_by_date.keys())) or None
            # Remember the starting point. Without this the marker was re-computed as "yesterday"
            # on every call, so no day was ever accrued now that trips are gone from the driver app.
            if marker:
                await db.rental_accounts.update_one(
                    {"organization_id": org, "driver_id": did},
                    {"$set": {"rent_charged_through": marker}}
                )
        # Rent for day D is added on D+1 (today's rent is never asked today); only fully elapsed days accrue here.
        yesterday_iso = (today - timedelta(days=1)).isoformat()
        need_accrue = bool(marker) and marker < yesterday_iso
        if need_accrue or rent_by_date:
            drv_doc = await db.drivers.find_one({"_id": ObjectId(did)})
            mid_trip = bool(drv_doc and drv_doc.get("active_trip_id"))
            live_plan = None
            if rental.get("plan_id"):
                live_plan = await db.rental_plans.find_one({"_id": oid(rental["plan_id"])})
            elif rental.get("package_name"):
                live_plan = await db.rental_plans.find_one({
                    "name": {"$regex": f"^{rental['package_name']}$", "$options": "i"},
                    "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"},
                    "organization_id": org
                })
            live_rate = float(live_plan["amount"]) if live_plan and live_plan.get("amount") else float(rate or 0)
            past_rate = float(rate or 0) or live_rate
            today_rate = past_rate if mid_trip else live_rate   # mid-trip: rate stays frozen
            if need_accrue:
                d_, guard = date.fromisoformat(marker) + timedelta(days=1), 0
                while d_ < today and guard < 90:
                    k = d_.isoformat()
                    amt = today_rate if d_ == today else past_rate
                    if amt > 0 and k not in rent_by_date and k not in paid_leave:
                        rent_by_date[k] = amt
                        rbd_changed = True
                    d_ += timedelta(days=1)
                    guard += 1
                await db.rental_accounts.update_one(
                    {"organization_id": org, "driver_id": did},
                    {"$set": {"rent_charged_through": yesterday_iso}}
                )
            # An unpaid entry for today follows the live plan rate (past days stay frozen).
            paid_leaves = (drv_doc or {}).get("paid_leaves", []) if need_accrue or rent_by_date else []
            if not mid_trip and today_iso in rent_by_date and live_rate > 0 and abs(rent_by_date[today_iso] - live_rate) > 0.005:
                if today_iso not in paid_leaves:
                    rent_by_date[today_iso] = live_rate
                    rbd_changed = True
            if not mid_trip and live_rate > 0 and round(live_rate, 2) != round(float(rate or 0), 2):
                rate = live_rate
                await db.rentals.update_one({"_id": rental["_id"]}, {"$set": {"daily_rate": live_rate}})

    if False:  # disabled: replaced by the daily accrual above (safe to delete this block)
        driver_doc = await db.drivers.find_one({"_id": ObjectId(did)})
        if driver_doc and not driver_doc.get("active_trip_id"):
            live_plan = None
            if rental.get("plan_id"):
                live_plan = await db.rental_plans.find_one({"_id": oid(rental["plan_id"])})
            elif rental.get("package_name"):
                live_plan = await db.rental_plans.find_one({
                    "name": {"$regex": f"^{rental['package_name']}$", "$options": "i"},
                    "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"},
                    "organization_id": org
                })
            live_rate = float(live_plan["amount"]) if live_plan and live_plan.get("amount") else float(rate or 0)
            gap_rate = float(rate or 0) or live_rate   # cached rate = rate in force for skipped days

            if today_iso in rent_by_date and live_rate > 0 and abs(rent_by_date[today_iso] - live_rate) > 0.005:
                rent_by_date[today_iso] = live_rate
                rbd_changed = True

            d_ = date.fromisoformat(max(rent_by_date)) + timedelta(days=1)
            guard = 0
            while d_ <= today and guard < 90:
                amt = live_rate if d_ == today else gap_rate
                if amt > 0:
                    rent_by_date[d_.isoformat()] = amt
                    rbd_changed = True
                d_ += timedelta(days=1)
                guard += 1

            if live_rate > 0 and round(live_rate, 2) != round(float(rate or 0), 2):
                rate = live_rate
                await db.rentals.update_one({"_id": rental["_id"]}, {"$set": {"daily_rate": live_rate}})

    if existing and (rbd_changed or any(d not in unpaid for d in rent_by_date)):
        new_total = round(sum(rent_by_date.values()), 2)
        delta = round(new_total - float(rent_due), 2)
        upd = {"$set": {"rent_by_date": rent_by_date, "rent_due": new_total}}
        if delta:
            upd["$inc"] = {"outstanding_amount": delta}
        if rent_by_date:
            upd["$addToSet"] = {"unpaid_dates": {"$each": list(rent_by_date.keys())}}
        await db.rental_accounts.update_one({"organization_id": org, "driver_id": did}, upd)
        outstanding = max(0.0, round(outstanding + delta, 2))
        rent_due = new_total
        unpaid = sorted(set(unpaid) | set(rent_by_date))
    
    # ─── PAID-BUT-IDLE DAYS ─────────────────────────────────────────────────
    # Rent was already paid for the next trip, but no trip has started. Every new
    # calendar day needs its own rent before a trip can start. A payment dated D
    # covers D+1, so charging starts from D+2 (skipped days at the cached rate,
    # today at the live plan rate).
    if False:  # disabled: no more prepaid / next-trip rent (safe to delete this block)
        cov = existing.get("pending_rent_covers_dates") or []
        if cov:
            first_needed = date.fromisoformat(max(cov)) + timedelta(days=2)
            if first_needed <= today:
                drv2 = await db.drivers.find_one({"_id": ObjectId(did)})
                if drv2 and not drv2.get("active_trip_id"):
                    plan2 = None
                    if rental.get("plan_id"):
                        plan2 = await db.rental_plans.find_one({"_id": oid(rental["plan_id"])})
                    elif rental.get("package_name"):
                        plan2 = await db.rental_plans.find_one({
                            "name": {"$regex": f"^{rental['package_name']}$", "$options": "i"},
                            "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"},
                            "organization_id": org
                        })
                    live2 = float(plan2["amount"]) if plan2 and plan2.get("amount") else float(rate or 0)
                    gap2 = float(rate or 0) or live2
                    added, d_, guard = {}, first_needed, 0
                    while d_ <= today and guard < 90:
                        amt = live2 if d_ == today else gap2
                        if amt > 0:
                            added[d_.isoformat()] = amt
                        d_ += timedelta(days=1)
                        guard += 1
                    if added:
                        add_total = round(sum(added.values()), 2)
                        await db.rental_accounts.update_one(
                            {"organization_id": org, "driver_id": did},
                            {"$set": {"rent_by_date": added, "rent_due": add_total},
                             "$inc": {"outstanding_amount": add_total},
                             "$addToSet": {"unpaid_dates": {"$each": list(added.keys())}}}
                        )
                        rent_by_date = added
                        rent_due = add_total
                        outstanding = round(outstanding + add_total, 2)
                        unpaid = sorted(set(unpaid) | set(added))
                        if live2 > 0 and round(live2, 2) != round(float(rate or 0), 2):
                            rate = live2
                            await db.rentals.update_one({"_id": rental["_id"]}, {"$set": {"daily_rate": live2}})

    # Days that count toward the BLOCK threshold = fully elapsed unpaid days only
    # (strictly before today, IST). Today's rent is charged the instant the day
    # starts so it can gate today's first trip — but it must NEVER count as one of
    # the "unpaid days" on its own, or the driver gets blocked the same moment the
    # charge is added, a full day too early. A day only becomes "overdue" once the
    # whole day has passed without payment. So: unpaid for 2 full days -> blocked
    # from the START of the 4th day, exactly as intended.
    past_unpaid_days = {d for d in rent_by_date if d < today_iso}
    if extra_km_due > 0 and not past_unpaid_days:
        past_days_from_unpaid = {d for d in unpaid if d < today_iso}
        if past_days_from_unpaid:
            past_unpaid_days.add(max(past_days_from_unpaid))
    overdue = len(past_unpaid_days)
    
    grace_period_until = existing.get("grace_period_until") if existing else None

    # Block rule: rent for day D is asked from D+1 (popup-day 1). The app is blocked at
    # 12:00 noon (IST) on popup-day RENT_BLOCK_DAY (D+3), or at any time after that day.
    _oldest_unpaid = min(past_unpaid_days) if past_unpaid_days else None
    try:
        rent_day_no = (today - date.fromisoformat(_oldest_unpaid)).days if _oldest_unpaid else 0
    except ValueError:
        rent_day_no = 0
    _after_noon = datetime.now(IST).hour >= RENT_NOON_HOUR
    if rate > 0 and (rent_day_no > RENT_BLOCK_DAY or (rent_day_no == RENT_BLOCK_DAY and _after_noon)):
        status = "blocked"
    elif overdue >= 1 and rate > 0:
        status = "overdue"
    else:
        status = "active"
    
    # Fields for the Blocked screen: ONLY the fully-elapsed unpaid days (never
    # today's or a future day's rent), plus any extra-KM due, so the breakdown the
    # driver sees never lists today's/tomorrow's date.
    blocked_dates = sorted(past_unpaid_days)
    blocked_rent_amount = round(sum(rent_by_date.get(d, 0) for d in blocked_dates), 2)
    blocked_total_amount = round(blocked_rent_amount + float(extra_km_due or 0), 2)

    # ─── AUTO TEMPORARY BLOCK + CATCH-UP REQUIREMENT (2+ full unpaid days) ──
    # The very first time the account becomes blocked, automatically apply a
    # "temporary" admin block (unless already PERMANENTLY blocked) AND flag
    # pending_catchup, so once an admin/city manager unblocks the driver, they
    # must go through odometer reconciliation + payment before resuming trips —
    # not just pay and go. This fires once per block episode: pending_catchup,
    # once set, is left untouched here on every later call (it's cleared only
    # once the driver completes the catch-up photo step), so refreshing never
    # re-arms or re-triggers it.
    pending_catchup = bool((existing or {}).get("pending_catchup"))
    catchup_baseline_reading = (existing or {}).get("catchup_baseline_reading")
    catchup_paid = bool((existing or {}).get("catchup_paid"))
    if status == "blocked" and not pending_catchup:
        drv_for_block = await db.drivers.find_one({"_id": ObjectId(did)})
        if drv_for_block and drv_for_block.get("admin_block") != "permanent":
            if not drv_for_block.get("admin_block"):
                await db.drivers.update_one(
                    {"_id": ObjectId(did)},
                    {"$set": {
                        "admin_block": "temporary",
                        "admin_block_reason": f"Auto-blocked: {overdue} consecutive day(s) of unpaid rent.",
                        "admin_blocked_at": datetime.now().isoformat(),
                        "admin_block_auto": True,
                    }}
                )
            baseline_reading = drv_for_block.get("last_odometer_reading", 0) or 0
            await db.rental_accounts.update_one(
                {"organization_id": org, "driver_id": did},
                {"$set": {"pending_catchup": True, "catchup_baseline_reading": baseline_reading}}
            )
            pending_catchup = True
            catchup_baseline_reading = baseline_reading

    # Admin manual unblock logic
    if status == "blocked" and grace_period_until and grace_period_until >= today.isoformat():
        status = "active"
        
    # today_paid logic — the ONLY correct rule:
    # 1. If the stored today_date in DB matches today AND stored today_paid is True → keep it True (payment was already made today)
    # 2. Otherwise → False (new day, new rental, or never paid today)
    # We NEVER auto-assume paid based on 0 outstanding — that causes brand new rentals to show "Paid" incorrectly.
    stored_today_date = existing.get("today_date") if existing else None
    if stored_today_date == today.isoformat() and existing.get("today_paid", False):
        today_paid = True
    else:
        today_paid = False
        
    reactivated_at = (existing or {}).get("reactivated_at")
    if existing and existing.get("status") == "blocked" and status == "active":
        reactivated_at = now_iso()
        
    acct = {
        "organization_id": org, "driver_id": did, "rental_id": str(rental["_id"]),
        "outstanding_amount": outstanding, "overdue_days": overdue, "status": status,
        "unpaid_dates": unpaid, "today_date": today.isoformat(), "today_paid": today_paid,
        "daily_rate": rate, "reactivated_at": reactivated_at, "updated_at": now_iso(),
        "rent_due": round(float(rent_due), 2), "extra_km_due": round(float(extra_km_due), 2),
        "rent_by_date": rent_by_date,
        # Blocked screen should show ONLY fully-elapsed unpaid days (+ extra KM) —
        # never today's or a future day's rent. Use these, not rent_by_date/unpaid_dates,
        # for the "3 days unpaid" breakdown and total on that screen.
        "blocked_dates": blocked_dates,
        # From 12:00 noon (IST) the unpaid-rent popup in the driver app cannot be closed.
        "rent_popup_locked": bool(_after_noon and float(rent_due) > 0 and status != "blocked" and any(k < today_iso for k in rent_by_date)),
        "rent_day_no": rent_day_no,
        "blocked_rent_amount": blocked_rent_amount,
        "blocked_total_amount": blocked_total_amount,
        # Catch-up (odometer/KM reconciliation) required after an admin unblocks
        # a driver who was auto-blocked. See CatchupScreen.jsx on the frontend.
        "pending_catchup": pending_catchup,
        "catchup_baseline_reading": catchup_baseline_reading,
        "catchup_paid": catchup_paid,
        "catchup_reading": (existing or {}).get("catchup_reading"),
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
                "rent_due": 0,
                "extra_km_due": 0,
            }
        }, 
        upsert=True
    )
    return acct


async def _deposit_amount_for(org, did, dep=None):
    """Deposit amount for a driver: the stored record's amount if it has one,
    otherwise the deposit set on the driver's rental package."""
    stored = float((dep or {}).get("amount") or 0)
    if stored > 0 and (dep or {}).get("status") in ("partial", "paid"):
        return stored  # something already paid -> amount is locked
    rental = await _active_rental(org, did)
    if not rental:
        return stored
    if rental.get("package_category") in ("commission", "salary"):
        return 0.0   # commission / salary packages have no security deposit
    plan = None
    if rental.get("plan_id"):
        plan = await db.rental_plans.find_one({"_id": oid(rental["plan_id"])})
    elif rental.get("package_name"):
        plan = await db.rental_plans.find_one({
            "name": {"$regex": f"^{re.escape(rental['package_name'])}$", "$options": "i"},
            "city": {"$regex": f"^{re.escape(rental.get('city', '') or '')}$", "$options": "i"},
            "organization_id": org})
    live = float((plan or {}).get("deposit") or rental.get("deposit") or 0)
    return live if live > 0 else stored


def _deposit_decorate(dep):
    """Adds computed split-deposit fields (half now / half later) to a deposit dict.
    status: pending -> partial (first half paid) -> paid (fully paid)."""
    total = float(dep.get("amount") or 0)
    status = dep.get("status") or "pending"
    paid_amt = float(dep.get("paid_amount") or 0)
    if status == "paid" and paid_amt <= 0:
        paid_amt = total  # old records that were paid in one go
    if status == "pending":
        paid_amt = 0.0
    nxt = dep.get("next_payment_date")
    due = status == "partial" and bool(nxt) and nxt <= _today_ist().isoformat()
    dep["paid_amount"] = paid_amt
    dep["half_amount"] = round(total / 2, 2)
    dep["remaining_amount"] = round(max(0.0, total - paid_amt), 2)
    dep["remaining_due"] = due
    dep["action_required"] = total > 0 and (status == "pending" or due)
    partial_on = bool(dep.get("partial_enabled")) or status == "partial"
    dep["partial_enabled"] = partial_on
    # pending: HALF only if admin enabled partial deposit for this driver, otherwise the FULL amount
    # admin-configured split: amount to pay now, remaining amount and the fixed next payment date
    first_cfg = float(dep.get("partial_first_amount") or 0)
    if not (0 < first_cfg < total):
        first_cfg = dep["half_amount"]  # old records enabled before the admin form existed
    dep["partial_first_amount"] = first_cfg
    dep["partial_remaining_amount"] = round(total - first_cfg, 2)
    dep["pay_now"] = (first_cfg if partial_on else total) if status == "pending" else dep["remaining_amount"]
    return dep


def _deposit_set_fields(rec, txn):
    """Fields to store on the security_deposits doc when a deposit payment clears."""
    now = now_iso()
    part = rec.get("deposit_part")
    total = float(rec.get("deposit_total") or rec["amount"])
    if part == "first":
        return {"status": "partial", "amount": total, "paid_amount": float(rec["amount"]),
                "transaction_id": txn, "first_transaction_id": txn, "first_paid_at": now,
                "first_amount": float(rec["amount"]),
                "next_payment_date": rec.get("next_payment_date")}
    fields = {"status": "paid", "amount": total, "paid_amount": total,
              "transaction_id": txn, "paid_at": now}
    if part == "second":
        fields["second_paid_at"] = now
    return fields


async def _driver_payload(user):
    org = user.get("organization_id")
    did = user["id"]
    rental = await _active_rental(org, did)
    dep = await db.security_deposits.find_one({"organization_id": org, "driver_id": did})

    # Monthly KM resets on the 1st (IST): if the stored month isn't the current
    # month, the driver has used 0 km this month.
    cur_month = _today_ist().strftime("%Y-%m")
    month_kms = user.get("current_month_kms", 0) if user.get("current_month") == cur_month else 0
    
    joined_date = user.get("created_at") or _today_ist().isoformat()
    joined_month = joined_date[:7]
    leave_quota = 3
    paid_leaves = user.get("paid_leaves", [])
    leaves_taken_this_month = sum(1 for d in paid_leaves if d.startswith(cur_month))

    out = {
        "driver": {"id": did, "name": user.get("name"), "phone": user.get("phone"), "city": user.get("city"),
                   "kyc_status": user.get("kyc_status"),
                   "kyc_approved_seen": user.get("kyc_approved_seen", False),
                   "kyc_snoozed_until": user.get("kyc_snoozed_until"),
                   "last_odometer_date": user.get("last_odometer_date"),
                   "active_trip_id": user.get("active_trip_id"),
                   "current_month_kms": month_kms,
                   "current_month": cur_month,
                   "leave_quota": leave_quota,
                   "leaves_taken_this_month": leaves_taken_this_month,
                   "paid_leaves": paid_leaves,
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
            
        if plan and not dep and rental.get("package_category") not in ("commission", "salary"):
            dep = {
                "organization_id": org, 
                "driver_id": did, 
                "amount": plan.get("deposit", 5000),
                "status": "pending", 
                "transaction_id": None, 
                "paid_at": None, 
                "created_at": now_iso()
            }
            res = await db.security_deposits.insert_one(dep)
            dep["_id"] = res.inserted_id
            out["deposit"] = ser(dep)
        
        # While a trip is running, show whatever KM limit / overage rate was frozen
        # onto it at START — not whatever the admin has the package set to right
        # now. Only a driver with no active trip sees the live/current package,
        # since that's what their NEXT (fresh) trip will actually use.
        active_log = None
        if user.get("active_trip_id"):
            active_log = await db.driver_odometer_logs.find_one({"_id": ObjectId(user["active_trip_id"])})
        
        if active_log and "snapshot_daily_rent" in active_log:
            monthly_km_limit = active_log.get("snapshot_monthly_limit", 0)
            daily_limit_km = _effective_daily_limit(active_log.get("snapshot_daily_limit", 0), monthly_km_limit)
            overage_per_km = active_log.get("snapshot_overage_per_km", 0.0)
        else:
            # Driver still owes money (e.g. rent from the trip that just ended): keep showing
            # the limits frozen on their last completed trip. The new package details are shown
            # only once dues are paid, i.e. from the next trip.
            last_log = None
            if (acct.get("outstanding_amount", 0) or 0) > 0:
                _logs = await db.driver_odometer_logs.find(
                    {"driver_id": did, "status": "completed", "snapshot_monthly_limit": {"$exists": True}}
                ).sort("created_at", -1).limit(1).to_list(1)
                last_log = _logs[0] if _logs else None
            if last_log:
                monthly_km_limit = last_log.get("snapshot_monthly_limit", 0)
                daily_limit_km = _effective_daily_limit(last_log.get("snapshot_daily_limit", 0), monthly_km_limit)
                overage_per_km = last_log.get("snapshot_overage_per_km", 0.0)
            else:
                monthly_km_limit = plan.get("monthly_km_limit", 0) if plan else 0
                overage_per_km = plan.get("overage_per_km", 0.0) if plan else 0.0
                daily_limit_km = _effective_daily_limit(plan.get("daily_limit_km", 0) if plan else 0, monthly_km_limit)
        
        out["driver"]["package_limit_km"] = monthly_km_limit
        out["driver"]["monthly_km_limit"] = monthly_km_limit
        out["driver"]["daily_limit_km"] = daily_limit_km
        out["driver"]["overage_per_km"] = overage_per_km
        # KM already driven today (all completed trips today) vs the daily limit
        today_km_used = await _day_km_before(did, _today_ist().isoformat())
        out["driver"]["today_km_used"] = today_km_used
        out["driver"]["today_extra_km"] = _daily_overage(0, today_km_used, daily_limit_km)
        
        if plan and rental.get("package_category") not in ("commission", "salary"):
            if out["deposit"] and out["deposit"].get("status", "pending") == "pending":
                out["deposit"]["amount"] = plan.get("deposit", out["deposit"]["amount"])
            elif not out["deposit"]:
                out["deposit"] = {"status": "pending", "amount": plan.get("deposit", 5000)}
            
        start_str = rental.get("start", rental.get("start_date", ""))
        
        out["rental"] = {"id": str(rental["_id"]), "package_id": rental.get("package_id"),
                         "package_name": rental["package_name"], "daily_rate": rental["daily_rate"],
"start_date": start_str, "vehicle_reg": user.get("current_vehicle_number") or rental.get("vehicle_number", "")}
        out["rental"]["package_category"] = rental.get("package_category") or "rental"
        # live value from the package (admin can change it any time); falls back to the value saved on the rental
        out["rental"]["commission_percent"] = (plan or {}).get("commission_percent") if (plan or {}).get("commission_percent") is not None else rental.get("commission_percent")

        # Show the CURRENT package name only when the driver is free (no trip running, no dues);
        # otherwise keep the name they had, so a rename applies from their next trip.
        if plan and plan.get("name") and not user.get("active_trip_id") and (acct.get("outstanding_amount", 0) or 0) <= 0:
            out["driver"]["package_name"] = plan["name"]
            out["rental"]["package_name"] = plan["name"]
                         
        if (user.get("current_vehicle_id") or rental.get("vehicle_id")) and not out["driver"].get("vehicle_plate"):
            try:
                v_doc = await db.vehicles.find_one({"_id": oid(user.get("current_vehicle_id") or rental["vehicle_id"])})
                if v_doc:
                    out["driver"]["vehicle_plate"] = v_doc.get("registration_number")
            except:
                pass
                
        out["account"] = acct
    if rental and rental.get("package_category") in ("commission", "salary"):
        out["deposit"] = {"status": "pending", "amount": 0}   # no security deposit for commission / salary packages
    if out.get("deposit"):
        _deposit_decorate(out["deposit"])
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
        # Not every driver has a security_deposits document up front (only drivers onboarded
        # via rental-admin/drivers get one pre-created). Without upsert=True, update_one() on a
        # missing doc matches nothing and silently does NOTHING — the payment succeeds in
        # rental_payments but is never recorded as paid here, so the deposit keeps showing as
        # "pending" forever: the popup re-appears on every login (Bug 1) and Daily Collection
        # keeps showing "NOT PAID" with the wrong fallback amount (Bug 2).
        await db.security_deposits.update_one(
            {"organization_id": org, "driver_id": did},
            {
                "$set": _deposit_set_fields(rec, txn),
                "$setOnInsert": {"organization_id": org, "driver_id": did, "created_at": now_iso()},
            },
            upsert=True,
        )
        # Rent is owed PER TRIP, not per calendar day. Every later trip's rent is charged
        # when the PREVIOUS trip ends (see submit_odometer / admin_submit_odometer, END TRIP
        # branch). The driver's very FIRST trip has no previous trip to charge it, so charge
        # it here, once, the moment the deposit clears — guarded by "nothing owed yet" so it
        # can never double-charge, no matter how many times a deposit payment is retried.
        rental = await _active_rental(org, did)
        if False and rental and rec.get("deposit_part") != "second":  # disabled: daily rent is now billed when the trip ends
            daily_rate = float(rental.get("daily_rate", 0) or 0)
            acct = await db.rental_accounts.find_one({"organization_id": org, "driver_id": did})
            nothing_owed_yet = (
                float((acct or {}).get("rent_due", 0) or 0) <= 0
                and float((acct or {}).get("extra_km_due", 0) or 0) <= 0
                and float((acct or {}).get("outstanding_amount", 0) or 0) <= 0
            )
            if daily_rate > 0 and nothing_owed_yet:
                await db.rental_accounts.update_one(
                    {"organization_id": org, "driver_id": did},
                    {"$inc": {"outstanding_amount": daily_rate, "rent_due": daily_rate},
                     "$set": {f"rent_by_date.{_today_ist().isoformat()}": daily_rate,
                              "rent_charged_through": _today_ist().isoformat()}},
                    upsert=True,
                )
    elif rec["kind"] in ("package_commission", "package_salary"):
        await db.package_collections.update_one({"payment_id": str(rec["_id"])}, {"$set": {
            "status": "paid", "transaction_id": txn, "paid_at": now_iso()}})
    elif rec["kind"] in ["daily", "outstanding", "extra_km", "catchup"]:
        existing_acct = await db.rental_accounts.find_one({"organization_id": org, "driver_id": did})
        if existing_acct:
            amount_paid = float(rec["amount"])
            new_outstanding = max(0.0, round(float(existing_acct.get("outstanding_amount", 0)) - amount_paid, 2))
            if rec["kind"] == "outstanding":
                # Full combined balance cleared in one go (admin unblock / manual
                # clear-everything payment).
                new_rent_due = 0.0
                new_extra_km_due = 0.0
            elif rec["kind"] == "catchup":
                # A catch-up settles the past BLOCKED days' rent + all extra-km due
                # (including any new overage found during reconciliation) — but NOT
                # today's rent. covers_amounts holds only the blocked (past) days,
                # so subtract exactly that from rent_due; today's entry, if any,
                # is left untouched and stays owed for the normal daily-rent flow.
                blocked_paid = round(sum((rec.get("covers_amounts") or {}).values()), 2)
                new_rent_due = max(0.0, round(float(existing_acct.get("rent_due", 0) or 0) - blocked_paid, 2))
                new_extra_km_due = 0.0
            elif rec["kind"] == "extra_km":
                new_rent_due = float(existing_acct.get("rent_due", 0) or 0)
                new_extra_km_due = max(0.0, round(float(existing_acct.get("extra_km_due", 0) or 0) - amount_paid, 2))
            else:  # daily
                new_rent_due = max(0.0, round(float(existing_acct.get("rent_due", 0) or 0) - amount_paid, 2))
                new_extra_km_due = float(existing_acct.get("extra_km_due", 0) or 0)
            remaining_dates = [d for d in existing_acct.get("unpaid_dates", []) if d not in rec.get("covers_dates", [])]
            today_ist = _today_ist().isoformat()
            set_fields = {
                "outstanding_amount": new_outstanding,
                "rent_due": new_rent_due,
                "extra_km_due": new_extra_km_due,
                "unpaid_dates": remaining_dates if new_outstanding > 0 else [],
                "today_paid": True,
                "today_date": today_ist,
            }
            # Per-day rent ledger: remove the days this payment settled.
            rbd = dict(existing_acct.get("rent_by_date") or {})
            paid_amounts = rec.get("covers_amounts") or {}
            if rec["kind"] in ("daily", "outstanding", "catchup"):
                if paid_amounts:
                    for d_ in paid_amounts:
                        rbd.pop(d_, None)
                elif new_rent_due <= 0:
                    rbd = {}
            set_fields["rent_by_date"] = rbd
            # A trip bills exactly ONE day of rent, so the next trip is priced at the
            # latest paid day — not the multi-day total.
            one_day_rent = float(paid_amounts[max(paid_amounts)]) if paid_amounts else amount_paid
            if rec["kind"] == "daily":
                # Freeze exactly what was paid for the UPCOMING trip's rent. The
                # trip that's about to start reads THIS (not the live package
                # rate) so an admin rate change between "rent paid" and "trip
                # started" can never make an already-paid trip show up wrong or
                # unpaid in Daily Collection.
                set_fields["last_rent_paid_amount"] = one_day_rent
                set_fields["last_rent_paid_txn"] = txn
                set_fields["last_rent_paid_at"] = now_iso()
                # Marks this payment as "paid but not yet attached to a started
                # trip" — Daily Collection uses this to still give it its own
                # visible row even after rent_due has already dropped to 0.
                # Cleared the moment the trip it paid for actually starts (see
                # submit_odometer / admin_submit_odometer, START TRIP branch).
                set_fields["pending_rent_paid"] = True
                # Paying removes this date from unpaid_dates immediately (a few
                # lines above), so Daily Collection would lose track of which day
                # this payment belongs to. Remember it explicitly here.
                set_fields["pending_rent_covers_dates"] = rec.get("covers_dates", [])
            if rec["kind"] == "catchup":
                # Payment settled — the driver still needs to submit the odometer
                # photo (see /driver/catchup/photo) before pending_catchup clears.
                # catchup_settled_dates remembers exactly which past days (and at
                # what frozen rate) this payment cleared, so the photo step can
                # create one permanent, rate-immune Daily Collection row per day.
                set_fields["catchup_paid"] = True
                set_fields["catchup_settled_dates"] = paid_amounts
            await db.rental_accounts.update_one(
                {"organization_id": org, "driver_id": did},
                {"$set": set_fields}
            )
            
            # ─── POST-PAYMENT RATE SYNC ─────────────────────────────────────────
            # If the driver has paid off their dues completely, they are "free".
            # If the admin changed the package amount while they were locked,
            # apply the NEW rate NOW to all records (only if no active trip).
            if new_outstanding <= 0:
                user_doc = await db.users.find_one({"_id": ObjectId(did)})
                active_trip_id = user_doc.get("active_trip_id") if user_doc else None
                
                if not active_trip_id:
                    rental_doc = await db.rentals.find_one({"organization_id": org, "driver_id": did, "status": {"$ne": "ended"}})
                    if rental_doc:
                        sync_plan = None
                        if rental_doc.get("plan_id"):
                            sync_plan = await db.rental_plans.find_one({"_id": oid(rental_doc["plan_id"])})
                        elif rental_doc.get("package_name"):
                            sync_plan = await db.rental_plans.find_one({
                                "name": {"$regex": f"^{rental_doc['package_name']}$", "$options": "i"},
                                "city": {"$regex": f"^{rental_doc.get('city', '')}$", "$options": "i"},
                                "organization_id": org
                            })
                        if sync_plan:
                            new_rate = float(sync_plan.get("amount", 0))
                            current_rate = float(rental_doc.get("daily_rate", 0))
                            if new_rate > 0 and new_rate != current_rate:
                                # Sync to driver_rentals
                                await db.driver_rentals.update_many(
                                    {"driver_id": did, "organization_id": org, "status": {"$ne": "ended"}},
                                    {"$set": {"daily_rate": new_rate}}
                                )
                                # Sync to rentals (B2B)
                                await db.rentals.update_many(
                                    {"driver_id": did, "organization_id": org, "status": {"$ne": "ended"}},
                                    {"$set": {"daily_rate": new_rate}}
                                )
                                # Sync to rental_accounts
                                await db.rental_accounts.update_many(
                                    {"driver_id": did, "organization_id": org},
                                    {"$set": {"daily_rate": new_rate}}
                                )
                                # Sync to users record
                                await db.users.update_one(
                                    {"_id": ObjectId(did)},
                                    {"$set": {"package_rate": new_rate}}
                                )
                                await db.drivers.update_one(
                                    {"_id": ObjectId(did)},
                                    {"$set": {"package_rate": new_rate}}
                                )
            # ─────────────────────────────────────────────────────────────────────
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
    
    if phone == "9999999999":
        return {"message": "OTP sent successfully", "test_otp": "123456"}
        
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
    
    # Auto-create dummy account for Google Reviewers if it doesn't exist yet
    if phone == "9999999999" and not u:
        admin_org = await db.users.find_one({"role": "admin"})
        org_id = admin_org["organization_id"] if admin_org else "test-org"
        res = await db.drivers.insert_one({
            "name": "Google Reviewer",
            "phone": "9999999999",
            "organization_id": org_id,
            "kyc_status": "approved",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        u = {"_id": res.inserted_id, "organization_id": org_id, "name": "Google Reviewer"}
        
    if not u:
        raise HTTPException(status_code=401, detail="Invalid phone or OTP")
        
    # Google Reviewer bypass
    is_google_reviewer = (phone == "9999999999" and body.otp == "123456")
        
    if not is_google_reviewer:
        otp_record = await db.otp_codes.find_one({"phone": phone, "otp": body.otp})
        if not otp_record:
            # Increment lockout
            await db.login_attempts.update_one(
                {"identifier": "driver:" + phone},
                {"$inc": {"count": 1}, "$set": {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}},
                upsert=True)
            raise HTTPException(status_code=401, detail="Invalid phone or OTP")
        
    if not is_google_reviewer:
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


# ---------- Commission / Salary packages: driver pays the collected amount (with trip screenshot) ----------
PKG_NOON_HOUR = 12


def _coll_view(c):
    if not c:
        return None
    return {"screenshot_url": c.get("screenshot_url"), "total_collected": c.get("total_collected"),
            "pay_amount": c.get("pay_amount"), "transaction_id": c.get("transaction_id"), "for_date": c.get("for_date")}


async def _package_due_state(user):
    """Commission / Salary drivers pay for each working day on the NEXT day, before 12:00 noon (IST).
    Returns the oldest unpaid day (or None). locked=True once the noon deadline has passed
    (the popup then has no close button)."""
    org = user.get("organization_id")
    did = user["id"]
    rental = await _active_rental(org, did)
    if not rental or rental.get("status") != "active":
        return None
    cat = rental.get("package_category")
    if cat not in ("commission", "salary"):
        return None
    today = _today_ist()
    try:
        start = date.fromisoformat(str(rental.get("start") or rental.get("created_at"))[:10])
    except ValueError:
        start = today
    plan = None
    if rental.get("plan_id"):
        try:
            plan = await db.rental_plans.find_one({"_id": oid(rental["plan_id"])})
        except Exception:
            plan = None
    percent = float((plan or {}).get("commission_percent") or rental.get("commission_percent") or 0)
    drv = await db.drivers.find_one({"_id": ObjectId(did)}, {"week_off_dates": 1, "paid_leave_dates": 1, "paid_leaves": 1})
    skip = set((drv or {}).get("week_off_dates") or []) | set((drv or {}).get("paid_leave_dates") or []) | set((drv or {}).get("paid_leaves") or [])
    paid = {c.get("for_date") async for c in db.package_collections.find(
        {"organization_id": org, "driver_id": did, "status": "paid"}, {"for_date": 1})}
    d = max(start, today - timedelta(days=30))
    due_date = None
    while d < today:                       # day D is payable from D+1
        iso = d.isoformat()
        if iso not in paid and iso not in skip:
            due_date = d
            break
        d += timedelta(days=1)
    if not due_date:
        return None
    after_noon = datetime.now(IST).hour >= PKG_NOON_HOUR
    return {
        "category": cat, "plan_name": rental.get("package_name"),
        "commission_percent": percent if cat == "commission" else None,
        "date": due_date.isoformat(),
        "locked": bool(after_noon or due_date < today - timedelta(days=1)),
    }


@api.post("/driver/package-collection/create-order")
async def package_collection_create_order(
    request: Request,
    total_collected: float = Form(...),
    for_date: str = Form(...),
    image: UploadFile = File(...),
):
    user = await get_user(request)
    require_driver(user)
    org = user.get("organization_id")
    did = user["id"]
    state = await _package_due_state(user)
    if not state:
        raise HTTPException(status_code=400, detail="Nothing is due right now")
    if for_date != state["date"]:
        raise HTTPException(status_code=400, detail="This date is not due for payment")
    if not total_collected or total_collected <= 0:
        raise HTTPException(status_code=400, detail="Enter the total amount collected")
    if not image or not image.filename or not (image.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload the trip screenshot")
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="Upload the trip screenshot")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 10 MB")
    if state["category"] == "commission":
        pct = float(state.get("commission_percent") or 0)
        if pct <= 0:
            raise HTTPException(status_code=400, detail="Commission percentage is not set for this package")
        pay_amount = round(total_collected * pct / 100, 2)
    else:
        pct = None
        pay_amount = round(total_collected, 2)
    if pay_amount <= 0:
        raise HTTPException(status_code=400, detail="Amount to pay must be more than 0")

    # the screenshot itself is stored inside MongoDB (same as the KYC documents)
    shot_token = uuid.uuid4().hex  # random, unguessable id used in the image URL
    await db.package_screenshots.insert_one({
        "organization_id": org, "driver_id": did, "token": shot_token,
        "filename": image.filename, "content_type": image.content_type or "image/jpeg",
        "data": Binary(data), "created_at": now_iso(),
    })

    rental = await _active_rental(org, did)
    # rental_id is left empty on purpose: this payment must never be mixed into the daily-rent / deposit
    # calculations of the Daily Collection page (the package_collections record below is used instead).
    rec = {"organization_id": org, "driver_id": did, "rental_id": None,
           "kind": "package_" + state["category"], "amount": pay_amount, "covers_dates": [], "covers_amounts": {},
           "payment_status": "pending", "payment_method": None, "transaction_id": None,
           "gateway_order_id": None, "gateway_ref": None, "paid_at": None,
           "gateway": "razorpay" if rzp_client else "sandbox", "created_at": now_iso()}
    res = await db.rental_payments.insert_one(rec)
    pid = str(res.inserted_id)
    await db.package_collections.insert_one({
        "organization_id": org, "driver_id": did, "driver_name": user.get("name"),
        "rental_id": str(rental["_id"]) if rental else None, "city": (rental or {}).get("city"),
        "category": state["category"], "plan_name": state.get("plan_name"),
        "for_date": for_date, "total_collected": round(total_collected, 2),
        "commission_percent": pct, "pay_amount": pay_amount,
        "screenshot_url": f"/api/package-screenshots/{shot_token}", "payment_id": pid,
        "status": "pending", "transaction_id": None, "paid_at": None, "created_at": now_iso()})

    amount_paise = int(round(pay_amount * 100))
    resp = {"payment_id": pid, "amount": pay_amount, "amount_paise": amount_paise, "kind": rec["kind"], "gateway": rec["gateway"]}
    if rzp_client:
        order = rzp_client.order.create({"amount": amount_paise, "currency": "INR", "receipt": pid[:40]})
        await db.rental_payments.update_one({"_id": res.inserted_id}, {"$set": {"gateway_order_id": order["id"]}})
        resp["order_id"] = order["id"]
        resp["key_id"] = RZP_KEY
    else:
        tok = secrets.token_hex(16)
        await db.rental_payments.update_one({"_id": res.inserted_id}, {"$set": {"sandbox_token": tok}})
        resp["sandbox_token"] = tok
    return resp


# Serves a trip screenshot stored in MongoDB. No login on purpose: the admin panel shows these in <img> tags
# and the 32-character random token in the URL cannot be guessed (same as the KYC files).
@api.get("/package-screenshots/{token}")
async def serve_package_screenshot(token: str):
    doc = await db.package_screenshots.find_one({"token": token}, {"data": 1, "content_type": 1})
    if not doc or not doc.get("data"):
        raise HTTPException(status_code=404, detail="File not found")
    return Response(
        content=bytes(doc["data"]),
        media_type=doc.get("content_type") or "image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@api.get("/driver/me")
async def driver_me(request: Request):
    user = await get_user(request)
    require_driver(user)
    payload = await _driver_payload(user)
    blocked = await db.drivers.find_one(
        {"phone": user.get("phone"), "admin_block": {"$in": ["temporary", "permanent"]}},
        {"admin_block": 1, "admin_block_reason": 1}
    )
    payload["admin_block"] = (blocked or {}).get("admin_block")
    payload["admin_block_reason"] = (blocked or {}).get("admin_block_reason")
    payload["week_off"] = await _week_off_state(user["id"])
    payload["package_due"] = await _package_due_state(user)
    return payload

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

@api.post("/driver/leave")
async def apply_leave(request: Request, body: dict):
    user = await get_user(request)
    require_driver(user)
    # Paid leave is now granted only by admin / city manager from the admin panel.
    raise HTTPException(status_code=403, detail="Paid leave can only be granted by admin")
    did = user["id"]
    
    target_date = body.get("date")
    if not target_date:
        raise HTTPException(status_code=400, detail="Date required")
        
    today_str = _today_ist().isoformat()
    if target_date < today_str:
        raise HTTPException(status_code=400, detail="Cannot apply leave for a past date")
        
    drv_doc = await db.drivers.find_one({"_id": oid(did)})
    if not drv_doc:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    joined_date = drv_doc.get("created_at") or today_str
    joined_month = joined_date[:7]
    target_month = target_date[:7]
    
    quota = 3
    paid_leaves = drv_doc.get("paid_leaves", [])
    
    if target_date in paid_leaves:
        raise HTTPException(status_code=400, detail="Leave already applied for this date")
        
    leaves_in_month = sum(1 for d in paid_leaves if d.startswith(target_month))
    if leaves_in_month >= quota:
        raise HTTPException(status_code=400, detail=f"Monthly limit of {quota} paid leaves reached")
        
    await db.drivers.update_one({"_id": oid(did)}, {"$addToSet": {"paid_leaves": target_date}})
    
    if target_date == today_str:
        acct = await db.rental_accounts.find_one({"driver_id": did})
        if acct and acct.get("rent_by_date", {}).get(target_date, 0) > 0:
            amt = acct["rent_by_date"][target_date]
            await db.rental_accounts.update_one(
                {"driver_id": did},
                {
                    "$unset": {f"rent_by_date.{target_date}": ""},
                    "$inc": {"rent_due": -amt, "outstanding_amount": -amt}
                }
            )
            
    return {"ok": True, "message": "Leave applied"}

@api.post("/driver/kyc/ack-approved")
async def ack_kyc_approved(request: Request):
    user = await get_user(request)
    require_driver(user)
    await db.drivers.update_one({"_id": oid(user["id"])}, {"$set": {"kyc_approved_seen": True}})
    return {"ok": True}
# Serves a KYC document stored in MongoDB. No login on purpose: the admin panel shows these in <img> tags
# and "open in new tab" links; the 32-character random token in the URL cannot be guessed
# (same openness the old /uploads files had).
@api.get("/kyc-files/{token}")
async def serve_kyc_file(token: str):
    doc = await db.driver_kyc_files.find_one({"token": token}, {"data": 1, "content_type": 1})
    if not doc or not doc.get("data"):
        raise HTTPException(status_code=404, detail="File not found")
    return Response(
        content=bytes(doc["data"]),
        media_type=doc.get("content_type") or "image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@api.post("/driver/kyc")
async def submit_driver_kyc(
    request: Request,
    dl_front: UploadFile = File(...),
    dl_back: UploadFile = File(...),
    aadhaar: UploadFile = File(None),
    pan: UploadFile = File(None),
    driver_photo: UploadFile = File(None),
    vehicle_photo: UploadFile = File(None),
    agreement: UploadFile = File(None),
    lat: str = Form(""),
    lng: str = Form(""),
    address: str = Form("")
):
    user = await get_user(request)
    require_driver(user)
    
    docs = {}
    kyc_file_docs = []
    for name, file in [("dl_front", dl_front), ("dl_back", dl_back), ("aadhaar", aadhaar), ("pan", pan),
                       ("driver_photo", driver_photo), ("vehicle_photo", vehicle_photo), ("agreement", agreement)]:
        if file is None:
            continue
        data = await file.read()
        if not data:
            continue
        if len(data) > 10 * 1024 * 1024:  # MongoDB documents are limited to 16 MB
            raise HTTPException(status_code=400, detail=f"{name} must be under 10 MB")
        token = uuid.uuid4().hex  # random, unguessable id used in the file URL
        kyc_file_docs.append({
            "organization_id": user.get("organization_id") or "route39-org",
            "driver_id": user["id"],
            "name": name,
            "token": token,
            "filename": file.filename,
            "content_type": file.content_type or "image/jpeg",
            "data": Binary(data),  # the document image itself is stored inside MongoDB
            "created_at": now_iso(),
        })
        docs[name] = f"/api/kyc-files/{token}"
        
    if kyc_file_docs:
        await db.driver_kyc_files.insert_many(kyc_file_docs)

    await db.drivers.update_one(
        {"_id": ObjectId(user["id"])},
        {"$set": {
            "kyc_status": "submitted",
            "kyc_documents": docs,
            "location": {"lat": lat, "lng": lng, "address": address},
            "kyc_submitted_at": now_iso()
        }}
    )
    # re-submission after a rejection: drop this driver's previous KYC files so they don't pile up
    await db.driver_kyc_files.delete_many({
        "driver_id": user["id"],
        "token": {"$nin": [f["token"] for f in kyc_file_docs]},
    })
    return {"ok": True, "message": "KYC Submitted successfully"}


# ---------- Driver-uploaded odometer images (profile page; any number, any time) ----------
@api.post("/driver/odometer-images")
async def driver_upload_odometer_images(request: Request, images: List[UploadFile] = File(...)):
    user = await get_user(request)
    require_driver(user)

    saved = []
    for img in images:
        if not img or not img.filename:
            continue
        if not (img.content_type or "").startswith("image/"):
            raise HTTPException(status_code=400, detail="Only image files are allowed")
        data = await img.read()
        if not data:
            continue
        if len(data) > 10 * 1024 * 1024:  # MongoDB documents are limited to 16 MB
            raise HTTPException(status_code=400, detail="Each image must be under 10 MB")
        saved.append({
            "organization_id": user.get("organization_id") or "route39-org",
            "driver_id": user["id"],
            "token": uuid.uuid4().hex,  # random, unguessable id used in the image URL
            "filename": img.filename,
            "content_type": img.content_type,
            "data": Binary(data),  # the image itself is stored inside MongoDB
            "created_at": now_iso(),
        })
    if not saved:
        raise HTTPException(status_code=400, detail="No image selected")
    await db.driver_odometer_images.insert_many(saved)
    return {"ok": True, "count": len(saved)}


@api.get("/driver/odometer-images")
async def driver_list_odometer_images(request: Request):
    user = await get_user(request)
    require_driver(user)
    docs = await db.driver_odometer_images.find({"driver_id": user["id"], "driver_deleted": {"$ne": True}}, {"data": 0}).sort("created_at", -1).to_list(200)
    return {"images": [{"id": str(x["_id"]), "url": x.get("url") or f"/api/odometer-images/{x['token']}", "created_at": x.get("created_at")} for x in docs]}


# Serves an image stored in MongoDB. No login on purpose: <img> tags cannot send the Bearer token,
# and the 32-character random token in the URL cannot be guessed (same openness as /uploads files).
@api.get("/odometer-images/{token}")
async def serve_odometer_image(token: str, download: int = 0):
    doc = await db.driver_odometer_images.find_one({"token": token}, {"data": 1, "content_type": 1, "filename": 1})
    if not doc or not doc.get("data"):
        raise HTTPException(status_code=404, detail="Image not found")
    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    if download:
        # ?download=1 makes the browser save the file instead of showing it
        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", doc.get("filename") or "odometer.jpg")
        headers["Content-Disposition"] = f'attachment; filename="{safe_name}"'
    return Response(
        content=bytes(doc["data"]),
        media_type=doc.get("content_type") or "image/jpeg",
        headers=headers,
    )


# Driver deletes one of their own odometer images (works for already-submitted images too)
@api.delete("/driver/odometer-images/{image_id}")
async def driver_delete_odometer_image(image_id: str, request: Request):
    user = await get_user(request)
    require_driver(user)
    # Only hides it from the driver's own list; the admin panel still shows it.
    res = await db.driver_odometer_images.update_one(
        {"_id": oid(image_id), "driver_id": user["id"], "driver_deleted": {"$ne": True}},
        {"$set": {"driver_deleted": True}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Image not found")
    # Remove the record for good only when the admin side has also deleted it
    await db.driver_odometer_images.delete_one({"_id": oid(image_id), "driver_deleted": True, "admin_deleted": True})
    return {"ok": True}


@api.get("/admin/drivers/{driver_id}/odometer-images")
async def admin_list_driver_odometer_images(driver_id: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    # org_filter also limits a city manager to drivers of their own city
    driver = await db.drivers.find_one(org_filter(user, {"_id": oid(driver_id)}))
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    docs = await db.driver_odometer_images.find({"driver_id": driver_id, "admin_deleted": {"$ne": True}}, {"data": 0}).sort("created_at", -1).to_list(500)
    return {"images": [{"id": str(x["_id"]), "url": x.get("url") or f"/api/odometer-images/{x['token']}", "created_at": x.get("created_at")} for x in docs]}


@api.delete("/admin/drivers/{driver_id}/odometer-images/{image_id}")
async def admin_delete_driver_odometer_image(driver_id: str, image_id: str, request: Request):
    user = await get_user(request)
    require_role(user, ["admin", "company_admin", "city_manager", "staff"])
    # org_filter also limits a city manager to drivers of their own city
    driver = await db.drivers.find_one(org_filter(user, {"_id": oid(driver_id)}))
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    # Only hides it from the admin panel; the driver app still shows it.
    res = await db.driver_odometer_images.update_one(
        {"_id": oid(image_id), "driver_id": driver_id, "admin_deleted": {"$ne": True}},
        {"$set": {"admin_deleted": True}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Image not found")
    # Remove the record for good only when the driver has also deleted it
    await db.driver_odometer_images.delete_one({"_id": oid(image_id), "driver_deleted": True, "admin_deleted": True})
    return {"ok": True}

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
    today = _today_ist().strftime("%Y-%m-%d")
    current_month_str = _today_ist().strftime("%Y-%m")
    url = ""  # No image for admin override
    
    active_trip_id = driver.get("active_trip_id")
    
    if not active_trip_id:
        # START TRIP
        acct = await db.rental_accounts.find_one({"driver_id": driver_id})
        
        # Freeze whatever package is active RIGHT NOW onto this trip. Any admin edit
        # to the package after this point must not affect this trip — only a fresh
        # trip started after the edit should see the new rate/limit/overage.
        snap = await _get_package_snapshot(driver.get("organization_id"), driver_id)
        # Rent for THIS trip is priced at whatever was actually PAID for it (see
        # last_rent_paid_amount, set in _apply_paid) — never today's live package
        # rate. Otherwise an admin rate change between "rent paid" and "trip
        # started" silently reprices an already-paid trip. Falls back to the live
        # rate only when no rent payment has ever been recorded for this driver.
        trip_daily_rent = (
            float(acct["last_rent_paid_amount"])
            if acct and acct.get("last_rent_paid_amount") is not None
            else (snap["daily_rate"] if snap else 0)
        )
        rent_txn_for_trip = None  # rent is billed at trip end and matched by covers_dates, never claimed by a later trip
        
        # (Removed daily rent addition at start; it will be added at end trip)
        res = await db.driver_odometer_logs.insert_one({
            "driver_id": driver_id,
            "organization_id": driver.get("organization_id"),
            "date": today,
            "start_reading": reading,
            "start_image_url": url,
            "status": "active",
            "created_at": now_iso(),
            "snapshot_daily_rent": (snap["daily_rate"] if snap else trip_daily_rent),
            "snapshot_rent_txn_id": rent_txn_for_trip,
            "snapshot_package_name": snap["package_name"] if snap else "",
            "snapshot_daily_limit": snap["daily_limit_km"] if snap else 0,
            "snapshot_overage_per_km": snap["overage_per_km"] if snap else 0.0,
            "snapshot_monthly_limit": snap["monthly_km_limit"] if snap else 0
        })
        
        await db.drivers.update_one(
            {"_id": ObjectId(driver_id)},
            {"$set": {
                "active_trip_id": str(res.inserted_id),
                "last_odometer_date": today
            }}
        )
        # The rent payment that priced this trip is now attached to it — clear the
        # "paid but not yet used by a trip" flag so Daily Collection stops showing
        # a separate placeholder row for it (it now shows as this trip's own row).
        await db.rental_accounts.update_one(
            {"organization_id": driver.get("organization_id"), "driver_id": driver_id},
            {"$unset": {"pending_rent_paid": "", "pending_rent_covers_dates": ""}}
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
        
        # Calculate Billing and Overages — use the package that was FROZEN onto this
        # trip when it started (see the "START TRIP" branch above), never whatever
        # the package looks like right now. This is what stops a mid-trip admin edit
        # from changing the bill/limits of a trip that's already running.
        rental = await _active_rental(driver.get("organization_id"), driver_id)
        if "snapshot_daily_rent" in log:
            daily_rate = log.get("snapshot_daily_rent", 0)
            daily_limit_km = log.get("snapshot_daily_limit", 0)
            overage_per_km = log.get("snapshot_overage_per_km", 0.0)
            monthly_limit_km = log.get("snapshot_monthly_limit", 0)
            plan_name = log.get("snapshot_package_name", "")
        else:
            # Legacy trip: started before this fix existed, so it has no frozen
            # snapshot. Fall back to a live lookup just this once so it doesn't
            # crash — every trip started from now on always has a snapshot.
            daily_rate = rental.get("daily_rate", 0) if rental else 0
            plan = None
            if rental:
                if rental.get("package_id"):
                    plan = await db.rental_plans.find_one({"_id": oid(rental["package_id"])})
                elif rental.get("package_name"):
                    plan = await db.rental_plans.find_one({
                        "name": {"$regex": f"^{rental['package_name']}$", "$options": "i"},
                        "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"},
                        "organization_id": driver.get("organization_id")
                    })
            monthly_limit_km = plan.get("monthly_km_limit", 0) if plan else 0
            overage_per_km = plan.get("overage_per_km", 0.0) if plan else 0.0
            daily_limit_km = 0
            plan_name = (plan.get("name") if plan else (rental.get("package_name", "") if rental else "")) or ""
                
        # Extra KM is charged against the DAILY limit (all trips of the same day added together)
        daily_limit_km = _effective_daily_limit(daily_limit_km, monthly_limit_km)
        day_km_before = await _day_km_before(driver_id, log.get("date") or today, active_trip_id)
        overage_km = _daily_overage(day_km_before, driven, daily_limit_km)
        overage_charge = round(overage_km * overage_per_km, 2)
        
        # UPDATED: today's rent is billed here, once per day, together with any extra KM.
        rent_charge = await _end_trip_rent_charge(driver.get("organization_id"), driver_id, daily_rate)
        total_charge = rent_charge + overage_charge
        
        if total_charge > 0:
            await db.rental_accounts.update_one(
                {"driver_id": driver_id},
                {
                    "$inc": {
                        "outstanding_amount": total_charge,
                        "rent_due": round(float(rent_charge), 2),
                        "extra_km_due": round(float(overage_charge), 2),
                    },
                    "$addToSet": {"unpaid_dates": today},
                    **({"$set": {f"rent_by_date.{_today_ist().isoformat()}": round(float(rent_charge), 2)}}
                       if rent_charge > 0 else {}),
                },
                upsert=True
            )
        
        # Rent for TODAY was already paid BEFORE this trip started — trip-end must
        # never leave (or let something later recreate) a due amount for today,
        # which is what makes the "Pay Daily Rent" popup reappear right after
        # ending a trip. Finalize it explicitly here.
        _today_str_fin = _today_ist().isoformat()
        _acct_fin = await db.rental_accounts.find_one({"driver_id": driver_id})
        _leftover = float((_acct_fin or {}).get("rent_by_date", {}).get(_today_str_fin, 0) or 0)
        # Only wipe today's rent if THIS trip started today (rent was paid before it began).
        # A trip started on an earlier day and ended today must leave today's rent due.
        if False and _leftover > 0 and (log.get("date") or _today_str_fin) == _today_str_fin:  # disabled: rent is now billed at trip end
            await db.rental_accounts.update_one(
                {"driver_id": driver_id},
                {"$unset": {f"rent_by_date.{_today_str_fin}": ""},
                 "$inc": {"rent_due": -_leftover, "outstanding_amount": -_leftover},
                 "$pull": {"unpaid_dates": _today_str_fin}}
            )
        await db.rental_accounts.update_one(
            {"driver_id": driver_id},
            {"$set": {"rent_charged_through": _today_str_fin}},
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
        
        # ─── POST-TRIP RATE SYNC ───────────────────────────────────────────────
        acct_check = await db.rental_accounts.find_one({"driver_id": driver_id, "organization_id": user.get("organization_id")})
        is_free_to_sync = not acct_check or acct_check.get("outstanding_amount", 0) <= 0
        
        if rental and is_free_to_sync:
            sync_plan = None
            if rental.get("plan_id"):
                sync_plan = await db.rental_plans.find_one({"_id": oid(rental["plan_id"])})
            elif rental.get("package_name"):
                sync_plan = await db.rental_plans.find_one({
                    "name": {"$regex": f"^{rental['package_name']}$", "$options": "i"},
                    "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"},
                    "organization_id": user.get("organization_id")
                })
            if sync_plan:
                new_rate = float(sync_plan.get("amount", 0))
                if new_rate > 0 and new_rate != daily_rate:
                    # Sync to driver_rentals
                    await db.driver_rentals.update_many(
                        {"driver_id": driver_id, "organization_id": user.get("organization_id"), "status": {"$ne": "ended"}},
                        {"$set": {"daily_rate": new_rate}}
                    )
                    # Sync to rentals (B2B)
                    await db.rentals.update_many(
                        {"driver_id": driver_id, "organization_id": user.get("organization_id"), "status": {"$ne": "ended"}},
                        {"$set": {"daily_rate": new_rate}}
                    )
                    # Sync to rental_accounts
                    await db.rental_accounts.update_many(
                        {"driver_id": driver_id, "organization_id": user.get("organization_id")},
                        {"$set": {"daily_rate": new_rate}}
                    )
                    # Sync to users record
                    await db.users.update_one(
                        {"_id": ObjectId(driver_id)},
                        {"$set": {"package_rate": new_rate}}
                    )
                    await db.drivers.update_one(
                        {"_id": ObjectId(driver_id)},
                        {"$set": {"package_rate": new_rate}}
                    )
        # ─────────────────────────────────────────────────────────────────────
        
        await db.driver_odometer_logs.update_one(
            {"_id": ObjectId(active_trip_id)},
            {"$set": {
                "snapshot_daily_rent": daily_rate,
                "snapshot_package_name": plan_name,
                "snapshot_daily_limit": daily_limit_km,
                "snapshot_overage_per_km": overage_per_km,
                "snapshot_monthly_limit": monthly_limit_km,
                "extra_km": overage_km,
                "extra_km_charge": overage_charge,
                "snapshot_monthly_kms_used": current_month_kms
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
    image: UploadFile = File(...)  # odometer image is required
):
    user = await get_user(request)
    require_driver(user)
    
    today = _today_ist().strftime("%Y-%m-%d")
    current_month_str = _today_ist().strftime("%Y-%m")

    # ext = image.filename.split(".")[-1] if "." in image.filename else "jpg"
    # filename = f"{user['id']}_odo_{uuid.uuid4().hex[:8]}.{ext}"
    # path = f"uploads/{filename}"
    # with open(path, "wb") as buffer:
    #     shutil.copyfileobj(image.file, buffer)
    # url = f"/uploads/{filename}"
    url = None
    if image is not None and image.filename:
        ext = image.filename.split(".")[-1] if "." in image.filename else "jpg"
        filename = f"{user['id']}_odo_{uuid.uuid4().hex[:8]}.{ext}"
        path = f"uploads/{filename}"
        with open(path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
        url = f"/uploads/{filename}"
    
    active_trip_id = user.get("active_trip_id")
    
    if not active_trip_id:
        # START TRIP
        deposit = await db.security_deposits.find_one({"driver_id": user["id"]})
        _r_dep = await _active_rental(user.get("organization_id"), user["id"])
        if deposit and not (_r_dep and _r_dep.get("package_category") in ("commission", "salary")) and _deposit_decorate(dict(deposit)).get("action_required"):
            raise HTTPException(400, "You must pay your Security Deposit before starting a trip.")
            
            
        _r_now = await _active_rental(user.get("organization_id"), user["id"])
        if _r_now:
            await _rental_account(_r_now)  # roll forward today's rent before checking dues
        acct = await db.rental_accounts.find_one({"driver_id": user["id"]})
        if acct:
            rent_due = float(acct.get("rent_due", 0) or 0)
            extra_km_due = float(acct.get("extra_km_due", 0) or 0)
            outstanding = float(acct.get("outstanding_amount", 0) or 0)
            # Legacy fallback for accounts predating the rent/extra-km split.
            if rent_due <= 0 and extra_km_due <= 0 and outstanding > 0:
                rent_due = outstanding
            if extra_km_due > 0:
                raise HTTPException(400, f"You must pay your Extra KM charges (₹{extra_km_due}) before starting a trip.")
            if rent_due > 0:
                raise HTTPException(400, f"You must pay your Daily Rent (₹{rent_due}) before starting today's trip.")
           
            
        # Freeze whatever package is active RIGHT NOW onto this trip. Any admin edit
        # to the package after this point must not affect this trip — only a fresh
        # trip started after the edit should see the new rate/limit/overage.
        snap = await _get_package_snapshot(user.get("organization_id"), user["id"])
        # Rent for THIS trip is priced at whatever was actually PAID for it (see
        # last_rent_paid_amount, set in _apply_paid) — never today's live package
        # rate. Otherwise an admin rate change between "rent paid" and "trip
        # started" silently reprices an already-paid trip. Falls back to the live
        # rate only when no rent payment has ever been recorded for this driver.
        trip_daily_rent = (
            float(acct["last_rent_paid_amount"])
            if acct and acct.get("last_rent_paid_amount") is not None
            else (snap["daily_rate"] if snap else 0)
        )
        rent_txn_for_trip = None  # rent is billed at trip end and matched by covers_dates, never claimed by a later trip
        
        
        # (Removed daily rent addition at start; it will be added at end trip)
        res = await db.driver_odometer_logs.insert_one({
            "driver_id": user["id"],
            "organization_id": user.get("organization_id"),
            "date": today,
            "start_reading": reading,
            "start_image_url": url,
            "status": "active",
            "created_at": now_iso(),
            "snapshot_daily_rent": (snap["daily_rate"] if snap else trip_daily_rent),
            "snapshot_rent_txn_id": rent_txn_for_trip,
            "snapshot_package_name": snap["package_name"] if snap else "",
            "snapshot_daily_limit": snap["daily_limit_km"] if snap else 0,
            "snapshot_overage_per_km": snap["overage_per_km"] if snap else 0.0,
            "snapshot_monthly_limit": snap["monthly_km_limit"] if snap else 0
        })
        
        await db.drivers.update_one(
            {"_id": ObjectId(user["id"])},
            {"$set": {
                "active_trip_id": str(res.inserted_id),
                "last_odometer_date": today
            }}
        )
        # The rent payment that priced this trip is now attached to it — clear the
        # "paid but not yet used by a trip" flag so Daily Collection stops showing
        # a separate placeholder row for it (it now shows as this trip's own row).
        await db.rental_accounts.update_one(
            {"organization_id": user.get("organization_id"), "driver_id": user["id"]},
            {"$unset": {"pending_rent_paid": "", "pending_rent_covers_dates": ""}}
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
        
        # Calculate Billing and Overages — use the package that was FROZEN onto this
        # trip when it started (see the "START TRIP" branch above), never whatever
        # the package looks like right now. This is what stops a mid-trip admin edit
        # from changing the bill/limits of a trip that's already running.
        rental = await _active_rental(user.get("organization_id"), user["id"])
        if "snapshot_daily_rent" in log:
            daily_rate = log.get("snapshot_daily_rent", 0)
            daily_limit_km = log.get("snapshot_daily_limit", 0)
            overage_per_km = log.get("snapshot_overage_per_km", 0.0)
            monthly_limit_km = log.get("snapshot_monthly_limit", 0)
            plan_name = log.get("snapshot_package_name", "")
        else:
            # Legacy trip: started before this fix existed, so it has no frozen
            # snapshot. Fall back to a live lookup just this once so it doesn't
            # crash — every trip started from now on always has a snapshot.
            daily_rate = rental.get("daily_rate", 0) if rental else 0
            plan = None
            if rental:
                if rental.get("package_id"):
                    plan = await db.rental_plans.find_one({"_id": oid(rental["package_id"])})
                elif rental.get("package_name"):
                    plan = await db.rental_plans.find_one({
                        "name": {"$regex": f"^{rental['package_name']}$", "$options": "i"},
                        "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"},
                        "organization_id": user.get("organization_id")
                    })
            monthly_limit_km = plan.get("monthly_km_limit", 0) if plan else 0
            overage_per_km = plan.get("overage_per_km", 0.0) if plan else 0.0
            daily_limit_km = 0
            plan_name = (plan.get("name") if plan else (rental.get("package_name", "") if rental else "")) or ""
                
        # Extra KM is charged against the DAILY limit (all trips of the same day added together)
        daily_limit_km = _effective_daily_limit(daily_limit_km, monthly_limit_km)
        day_km_before = await _day_km_before(user["id"], log.get("date") or today, active_trip_id)
        overage_km = _daily_overage(day_km_before, driven, daily_limit_km)
        overage_charge = round(overage_km * overage_per_km, 2)
        
        # ALL driven KMs (including extra/overage) reduce the monthly total
        # Extra KM also billed separately as overage charge
        current_month_kms += driven
        
                # Rent is now charged once per calendar day (see daily accrual in
        # _rental_account), NOT at trip end. Trip end bills extra-km only.
        # UPDATED: today's rent is billed here, once per day, together with any extra KM.
        rent_charge = await _end_trip_rent_charge(user.get("organization_id"), user["id"], daily_rate)
        total_charge = rent_charge + overage_charge        
        if total_charge > 0:
            total_charge = round(float(total_charge), 2)
            await db.rental_accounts.update_one(
                {"driver_id": user["id"], "organization_id": user.get("organization_id")},                {
                    "$inc": {
                        "outstanding_amount": total_charge,
                        "rent_due": round(float(rent_charge), 2),
                        "extra_km_due": round(float(overage_charge), 2),
                    },
                    "$addToSet": {"unpaid_dates": today},
                    **({"$set": {f"rent_by_date.{_today_ist().isoformat()}": round(float(rent_charge), 2)}}
                       if rent_charge > 0 else {}),
                },
                upsert=True
            )
        
        # Rent for TODAY was already paid BEFORE this trip started — the driver can
        # only ever start a trip once today's rent is settled. So trip-end must
        # never leave (or let something later recreate) a due amount for today,
        # which is what makes the "Pay Daily Rent" popup reappear right after
        # ending a trip. Finalize it explicitly here rather than relying on the
        # accrual logic elsewhere to simply not touch it.
        _today_str_fin = _today_ist().isoformat()
        _acct_fin = await db.rental_accounts.find_one({"driver_id": user["id"], "organization_id": user.get("organization_id")})
        _leftover = float((_acct_fin or {}).get("rent_by_date", {}).get(_today_str_fin, 0) or 0)
        # Only wipe today's rent if THIS trip started today (rent was paid before it began).
        # A trip started on an earlier day and ended today must leave today's rent due.
        if False and _leftover > 0 and (log.get("date") or _today_str_fin) == _today_str_fin:  # disabled: rent is now billed at trip end
            await db.rental_accounts.update_one(
                {"driver_id": user["id"], "organization_id": user.get("organization_id")},
                {"$unset": {f"rent_by_date.{_today_str_fin}": ""},
                 "$inc": {"rent_due": -_leftover, "outstanding_amount": -_leftover},
                 "$pull": {"unpaid_dates": _today_str_fin}}
            )
        await db.rental_accounts.update_one(
            {"driver_id": user["id"], "organization_id": user.get("organization_id")},
            {"$set": {"rent_charged_through": _today_str_fin}},
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
        
        # ─── POST-TRIP RATE SYNC ───────────────────────────────────────────────
        # After the trip ends, if the admin changed the package amount while the
        # driver was protected (mid-trip), apply the NEW rate NOW to all records,
        # BUT ONLY IF THEY OWE NO MONEY! If they owe money, they keep the old rate until paid.
        acct_check = await db.rental_accounts.find_one({"driver_id": user["id"], "organization_id": user.get("organization_id")})
        is_free_to_sync = not acct_check or acct_check.get("outstanding_amount", 0) <= 0
        
        if rental and is_free_to_sync:
            sync_plan = None
            if rental.get("plan_id"):
                sync_plan = await db.rental_plans.find_one({"_id": oid(rental["plan_id"])})
            elif rental.get("package_name"):
                sync_plan = await db.rental_plans.find_one({
                    "name": {"$regex": f"^{rental['package_name']}$", "$options": "i"},
                    "city": {"$regex": f"^{rental.get('city', '')}$", "$options": "i"},
                    "organization_id": user.get("organization_id")
                })
            if sync_plan:
                new_rate = float(sync_plan.get("amount", 0))
                if new_rate > 0 and new_rate != daily_rate:
                    # Sync to driver_rentals
                    await db.driver_rentals.update_many(
                        {"driver_id": user["id"], "organization_id": user.get("organization_id"), "status": {"$ne": "ended"}},
                        {"$set": {"daily_rate": new_rate}}
                    )
                    # Sync to rentals (B2B)
                    await db.rentals.update_many(
                        {"driver_id": user["id"], "organization_id": user.get("organization_id"), "status": {"$ne": "ended"}},
                        {"$set": {"daily_rate": new_rate}}
                    )
                    # Sync to rental_accounts
                    await db.rental_accounts.update_many(
                        {"driver_id": user["id"], "organization_id": user.get("organization_id")},
                        {"$set": {"daily_rate": new_rate}}
                    )
                    # Sync to users record (package_rate shown in driver app)
                    await db.users.update_one(
                        {"_id": ObjectId(user["id"])},
                        {"$set": {"package_rate": new_rate}}
                    )
                    await db.drivers.update_one(
                        {"_id": ObjectId(user["id"])},
                        {"$set": {"package_rate": new_rate}}
                    )
        # ─────────────────────────────────────────────────────────────────────
        
        await db.driver_odometer_logs.update_one(
            {"_id": ObjectId(active_trip_id)},
            {"$set": {
                "snapshot_daily_rent": daily_rate,
                "snapshot_package_name": plan_name,
                "snapshot_daily_limit": daily_limit_km,
                "snapshot_overage_per_km": overage_per_km,
                "snapshot_monthly_limit": monthly_limit_km,
                "extra_km": overage_km,
                "extra_km_charge": overage_charge,
                "snapshot_monthly_kms_used": current_month_kms
            }}
        )
        
        msg = f"Trip ended! Driven: {driven} km."
        if overage_km > 0:
            msg += f" (Overage: {overage_km} km / ₹{overage_charge})"
        return {"ok": True, "message": msg}


@api.get("/driver/catchup/quote")
async def driver_catchup_quote(reading: int, request: Request):
    user = await get_user(request)
    require_driver(user)
    org = user.get("organization_id")
    did = user["id"]
    rental = await _active_rental(org, did)
    if not rental:
        raise HTTPException(400, "No active rental")
    acct = await _rental_account(rental)
    if not acct.get("pending_catchup"):
        raise HTTPException(400, "No catch-up required.")
    baseline = acct.get("catchup_baseline_reading") or 0
    diff_km, overage_km, overage_charge = await _catchup_overage(org, did, rental, baseline, reading)
    # Only the past BLOCKED days' rent is due here — never today's, which stays
    # owed and gets paid separately afterward via the normal daily-rent popup.
    rent_amount = acct.get("blocked_rent_amount", 0)
    extra_km_existing = acct.get("extra_km_due", 0)
    total = round(rent_amount + extra_km_existing + overage_charge, 2)
    return {
        "baseline_reading": baseline, "reading": reading, "diff_km": diff_km,
        "rent_amount": rent_amount, "extra_km_existing": extra_km_existing,
        "overage_km": overage_km, "overage_charge": overage_charge, "total": total,
    }


@api.post("/driver/catchup/photo")
async def driver_catchup_photo(request: Request, image: UploadFile = File(None)):  # photo is optional now
    user = await get_user(request)
    require_driver(user)
    org = user.get("organization_id")
    did = user["id"]
    acct = await db.rental_accounts.find_one({"organization_id": org, "driver_id": did})
    if not acct or not acct.get("pending_catchup"):
        raise HTTPException(400, "No catch-up required.")
    if not acct.get("catchup_paid"):
        raise HTTPException(400, "Please complete the catch-up payment first.")
    reading = acct.get("catchup_reading")
    if reading is None:
        raise HTTPException(400, "Missing catch-up reading. Please contact support.")
    baseline = acct.get("catchup_baseline_reading") or 0

    # ext = image.filename.split(".")[-1] if "." in image.filename else "jpg"
    # filename = f"{did}_catchup_{uuid.uuid4().hex[:8]}.{ext}"
    # path = f"uploads/{filename}"
    # with open(path, "wb") as buffer:
    #     shutil.copyfileobj(image.file, buffer)
    # url = f"/uploads/{filename}"
    url = None
    if image is not None and image.filename:
        ext = image.filename.split(".")[-1] if "." in image.filename else "jpg"
        filename = f"{did}_catchup_{uuid.uuid4().hex[:8]}.{ext}"
        path = f"uploads/{filename}"
        with open(path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
        url = f"/uploads/{filename}"

    diff_km = max(0, reading - baseline)
    today = _today_ist().strftime("%Y-%m-%d")
    current_month_str = _today_ist().strftime("%Y-%m")
    driver = await db.drivers.find_one({"_id": ObjectId(did)})
    current_month_kms = (driver or {}).get("current_month_kms", 0) or 0
    if (driver or {}).get("current_month") != current_month_str:
        current_month_kms = 0
    current_month_kms += diff_km

    # One permanent Daily Collection row per settled blocked day, each frozen at
    # the RATE THAT APPLIED that day (never today's live package rate) — this is
    # what stops a later admin rate change from leaking into these rows. The
    # odometer confirmation (start/end KM, photo, any idle-period overage) is
    # attached only to the LAST (most recent) blocked day, since that's the day
    # the vehicle's position was actually confirmed.
    settled = acct.get("catchup_settled_dates") or {}
    sorted_dates = sorted(settled.keys())
    overage_km = acct.get("catchup_overage_km") or 0
    overage_charge = acct.get("catchup_overage_charge") or 0
    if sorted_dates:
        for i, dstr in enumerate(sorted_dates):
            log_doc = {
                "driver_id": did, "organization_id": org, "date": dstr,
                "snapshot_daily_rent": float(settled[dstr]),
                "status": "completed", "type": "catchup_rent",
                "created_at": now_iso(), "completed_at": now_iso(),
            }
            if i == len(sorted_dates) - 1:
                log_doc.update({
                    "start_reading": baseline, "end_reading": reading,
                    "driven_today": diff_km, "end_image_url": url,
                })
                if overage_charge > 0:
                    log_doc["extra_km"] = overage_km
                    log_doc["extra_km_charge"] = overage_charge
            await db.driver_odometer_logs.insert_one(log_doc)
    else:
        # No rent days were owed (e.g. block was extra-km-only) — still record
        # the odometer confirmation itself so it isn't lost.
        await db.driver_odometer_logs.insert_one({
            "driver_id": did, "organization_id": org, "date": today,
            "start_reading": baseline, "end_reading": reading, "driven_today": diff_km,
            "end_image_url": url, "status": "completed", "type": "catchup_rent",
            "extra_km": overage_km, "extra_km_charge": overage_charge,
            "created_at": now_iso(), "completed_at": now_iso(),
        })

    await db.drivers.update_one(
        {"_id": ObjectId(did)},
        {"$set": {
            "last_odometer_reading": reading,
            "current_month_kms": current_month_kms,
            "current_month": current_month_str,
            "last_odometer_date": today,
        }}
    )
    await db.rental_accounts.update_one(
        {"organization_id": org, "driver_id": did},
        {"$set": {"pending_catchup": False, "catchup_paid": False},
         "$unset": {
             "catchup_baseline_reading": "", "catchup_reading": "",
             "catchup_overage_applied_reading": "", "catchup_overage_km": "",
             "catchup_overage_charge": "", "catchup_settled_dates": "",
         }}
    )
    return {"ok": True, "message": "Catch-up completed. You can now start your trip once today's rent is paid."}


@api.get("/driver/packages")
async def driver_packages(request: Request):
    user = await get_user(request)
    require_driver(user)
    pk = await db.rental_packages.find({"organization_id": user.get("organization_id"), "status": "active"}).sort("daily_rate", 1).to_list(100)
    return [ser(p) for p in pk]


@api.get("/driver/payments")
async def driver_payment_history(request: Request):
    user = await get_user(request)
    require_driver(user)
    # Security-deposit amounts the admin recorded by QR (partial or full) are not driver-app payments,
    # so they are not listed on the driver's Payments page. Rent / extra-KM payments (including the
    # ones the admin marks via "Rent Paid") are still listed. Nothing is deleted; only this list is filtered.
    recs = await db.rental_payments.find({
        "organization_id": user.get("organization_id"),
        "driver_id": user["id"],
        "payment_status": {"$ne": "pending"},
        "$nor": [
            {"kind": "deposit", "gateway": "manual_qr"},
            {"kind": "deposit", "transaction_id": {"$regex": "^QR_"}},
        ],
    }).sort("created_at", -1).to_list(500)
    
    rental = await _active_rental(user.get("organization_id"), user["id"])
    daily_rate = rental.get("daily_rate", 0) if rental else 0

    results = []
    for r in recs:
        out = ser(r)
        if out.get("kind") == "extra_km":
            # Extra-KM payments are billed on their own now — no rent portion.
            out["base_rent"] = 0
            out["extra_charge"] = out["amount"]
            out["daily_rate"] = daily_rate
        elif out.get("kind") == "daily":
            # Daily-rent payments now cover rent only (extra KM is a separate payment).
            out["base_rent"] = out["amount"]
            out["extra_charge"] = 0
            out["daily_rate"] = daily_rate
        elif out.get("kind") == "outstanding" and out.get("covers_dates"):
            days = len(out["covers_dates"])
            base_rent = daily_rate * days
            extra_charge = max(0, out["amount"] - base_rent)
            out["base_rent"] = base_rent
            out["extra_charge"] = extra_charge
            out["daily_rate"] = daily_rate
        results.append(out)

    return results


class CreateOrderBody(BaseModel):
    kind: str  # deposit | daily | extra_km | outstanding | catchup
    reading: Optional[int] = None
    next_payment_date: Optional[str] = None  # deposit 1st half: date chosen for the 2nd half


@api.post("/driver/payments/create-order")
async def driver_create_order(body: CreateOrderBody, request: Request):
    user = await get_user(request)
    require_driver(user)
    org = user.get("organization_id")
    did = user["id"]
    kind = body.kind
    rental = await _active_rental(org, did)
    if kind != "deposit" and not rental:
        raise HTTPException(status_code=400, detail="No active rental")
    covers = []
    covers_amounts = {}
    deposit_extra = {}
    if kind == "deposit":
        if rental and rental.get("package_category") in ("commission", "salary"):
            raise HTTPException(status_code=400, detail="No security deposit for this package")
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
        # ---- split deposit: half now, remaining half on the date the driver picks ----
        total = float(amount)
        if total > 0:
            if dep and dep.get("status") == "partial":
                total = float(dep.get("amount") or total)  # total locked at first payment
                amount = round(total - float(dep.get("paid_amount") or 0), 2)
                deposit_extra = {"deposit_part": "second", "deposit_total": total}
            elif dep and dep.get("partial_enabled"):
                # amount + next payment date are fixed by the admin; the driver can only pay
                first_cfg = float(dep.get("partial_first_amount") or 0)
                if not (0 < first_cfg < total):
                    first_cfg = round(total / 2, 2)
                nd = dep.get("partial_next_date") or (_today_ist() + timedelta(days=1)).isoformat()
                amount = round(first_cfg, 2)
                deposit_extra = {"deposit_part": "first", "deposit_total": total, "next_payment_date": nd}
    elif kind == "daily":
        acct = await _rental_account(rental)
        if acct["status"] == "blocked":
            raise HTTPException(status_code=400, detail="Account blocked. Clear outstanding first.")
        if acct.get("rent_due", 0) <= 0:
            raise HTTPException(status_code=400, detail="No daily rent due right now.")
        amount = acct["rent_due"]
        covers = acct.get("unpaid_dates", [])
        covers_amounts = dict(acct.get("rent_by_date") or {})
    elif kind == "extra_km":
        acct = await _rental_account(rental)
        if acct["status"] == "blocked":
            raise HTTPException(status_code=400, detail="Account blocked. Clear outstanding first.")
        if acct.get("extra_km_due", 0) <= 0:
            raise HTTPException(status_code=400, detail="No extra KM charges due.")
        amount = acct["extra_km_due"]
        covers = acct.get("unpaid_dates", [])
    elif kind == "outstanding":
        acct = await _rental_account(rental)
        if acct["outstanding_amount"] <= 0:
            raise HTTPException(status_code=400, detail="No outstanding amount")
        amount = acct["outstanding_amount"]
        covers = acct.get("unpaid_dates", [])
        covers_amounts = dict(acct.get("rent_by_date") or {})
    elif kind == "catchup":
        acct = await _rental_account(rental)
        if not acct.get("pending_catchup"):
            raise HTTPException(status_code=400, detail="No catch-up required.")
        if body.reading is None:
            raise HTTPException(status_code=400, detail="Current odometer reading is required.")
        baseline = acct.get("catchup_baseline_reading") or 0
        diff_km, overage_km, overage_charge = await _catchup_overage(org, did, rental, baseline, body.reading)
        # Lock the overage onto the account exactly once per reading (idempotent) —
        # reopening the pay sheet with the same reading must not re-add the charge.
        acct_doc = await db.rental_accounts.find_one({"organization_id": org, "driver_id": did})
        already_applied = (acct_doc or {}).get("catchup_overage_applied_reading") == body.reading
        upd = {"$set": {
            "catchup_overage_applied_reading": body.reading, "catchup_reading": body.reading,
            "catchup_overage_km": overage_km, "catchup_overage_charge": overage_charge,
        }}
        if overage_charge > 0 and not already_applied:
            upd["$inc"] = {"outstanding_amount": overage_charge, "extra_km_due": overage_charge}
        await db.rental_accounts.update_one({"organization_id": org, "driver_id": did}, upd)
        # Re-derive via _rental_account (not a raw find_one) so blocked_dates /
        # blocked_rent_amount are freshly computed. A catch-up settles ONLY the
        # past blocked days' rent + all extra-km due — never today's rent, which
        # stays owed and gets its own normal daily-rent payment afterward.
        fresh_acct = await _rental_account(rental)
        covers = fresh_acct.get("blocked_dates", [])
        covers_amounts = {d: fresh_acct["rent_by_date"][d] for d in covers if d in fresh_acct.get("rent_by_date", {})}
        amount = round(float(fresh_acct.get("blocked_rent_amount", 0) or 0) + float(fresh_acct.get("extra_km_due", 0) or 0), 2)
    else:
        raise HTTPException(status_code=400, detail="Invalid payment kind")
    rec = {"organization_id": org, "driver_id": did, "rental_id": str(rental["_id"]) if rental else None,
           "kind": kind, "amount": amount, "covers_dates": covers, "covers_amounts": covers_amounts,
           "payment_status": "pending", "payment_method": None, "transaction_id": None,
           "gateway_order_id": None, "gateway_ref": None, "paid_at": None,
           "gateway": "razorpay" if rzp_client else "sandbox", "created_at": now_iso()}
    rec.update(deposit_extra)
    res = await db.rental_payments.insert_one(rec)
    pid = str(res.inserted_id)
    if amount <= 0:
        # Nothing to charge (e.g. a catch-up with no rent/extra-km/overage due) —
        # skip the payment gateway entirely and mark it paid immediately.
        rec["_id"] = res.inserted_id
        await _apply_paid(rec, "NIL-0", "system")
        return {"payment_id": pid, "amount": 0, "amount_paise": 0, "kind": kind,
                "gateway": rec["gateway"], "already_paid": True, "transaction_id": "NIL-0"}
    amount_paise = int(round(amount * 100))
    resp = {"payment_id": pid, "amount": amount, "amount_paise": amount_paise, "kind": kind, "gateway": rec["gateway"]}
    if rzp_client:
        order = rzp_client.order.create({"amount": amount_paise, "currency": "INR", "receipt": pid[:40]})
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
                                             "organization_id": user.get("organization_id"), "driver_id": user["id"]})
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
    rental = await _active_rental(user.get("organization_id"), user["id"])
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
    org = user.get("organization_id")
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
    org = user.get("organization_id")
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
    org = user.get("organization_id")
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
    pk = await db.rental_packages.find({"organization_id": user.get("organization_id")}).sort("daily_rate", 1).to_list(100)
    return [ser(p) for p in pk]


class PackageBody(BaseModel):
    name: str
    daily_rate: int
    status: str = "active"


@api.post("/rental-admin/packages")
async def rental_admin_create_package(body: PackageBody, request: Request):
    user = await get_user(request)
    await _require_rental_admin(user)
    doc = {"organization_id": user.get("organization_id"), "name": body.name, "daily_rate": int(body.daily_rate),
           "status": body.status, "created_at": now_iso()}
    res = await db.rental_packages.insert_one(doc)
    return ser(await db.rental_packages.find_one({"_id": res.inserted_id}))


@api.put("/rental-admin/packages/{pid}")
async def rental_admin_update_package(pid: str, body: dict, request: Request):
    user = await get_user(request)
    await _require_rental_admin(user)
    body.pop("_id", None); body.pop("id", None)
    await db.rental_packages.update_one({"_id": oid(pid), "organization_id": user.get("organization_id")}, {"$set": body})
    pkg = await db.rental_packages.find_one({"_id": oid(pid)})
    if pkg and "daily_rate" in body:
        new_rate = float(body["daily_rate"])
        # Find drivers currently mid-trip — they are protected from rate changes
        mid_trip_user_ids = set()
        async for u in db.users.find({"organization_id": user.get("organization_id"), "active_trip_id": {"$exists": True, "$ne": "", "$ne": None}}):
            mid_trip_user_ids.add(str(u["_id"]))
        
        drental_filter = {"organization_id": user.get("organization_id"), "package_id": pid, "status": {"$ne": "ended"}}
        if mid_trip_user_ids:
            drental_filter["driver_id"] = {"$nin": list(mid_trip_user_ids)}
        
        # Update driver_rentals only for drivers NOT on an active trip
        await db.driver_rentals.update_many(drental_filter, {"$set": {"daily_rate": new_rate, "package_name": pkg["name"]}})
        
        # Update rental accounts — also skip mid-trip drivers
        drivers_to_update = []
        async for r in db.driver_rentals.find(drental_filter):
            drivers_to_update.append(r["driver_id"])
        if drivers_to_update:
            acct_filter = {"organization_id": user.get("organization_id"), "driver_id": {"$in": drivers_to_update}}
            # Reprice any already-charged-but-unpaid rent for these drivers' UPCOMING
            # trip to the new live rate BEFORE overwriting daily_rate (need each
            # driver's OLD rate to scale correctly). Extra-km dues are left untouched.
            async for a in db.rental_accounts.find(acct_filter):
                old_rate_for_driver = float(a.get("daily_rate", 0) or 0)
                rent_due = float(a.get("rent_due", 0) or 0)
                if rent_due > 0 and old_rate_for_driver > 0:
                    new_rent_due = round((rent_due / old_rate_for_driver) * new_rate, 2)
                    delta = round(new_rent_due - rent_due, 2)
                    if delta != 0:
                        await db.rental_accounts.update_one(
                            {"_id": a["_id"]},
                            {"$inc": {"outstanding_amount": delta, "rent_due": delta}}
                        )
            await db.rental_accounts.update_many(acct_filter, {"$set": {"daily_rate": new_rate}})
    return ser(pkg)

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
    org = user.get("organization_id")
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
    # A status change is applied together with its vehicle / driver updates
    # (same as the Activate / Suspend / Close buttons and the Edit Driver form).
    existing = await db.rentals.find_one(org_filter(user, {"_id": oid(rid)}))
    new_state = body.get("status")
    change_state = bool(existing) and new_state in RENTAL_STATES and new_state != existing.get("status")
    if change_state:
        body.pop("status")
    if body:
        await db.rentals.update_one(org_filter(user, {"_id": oid(rid)}), {"$set": body})
    if change_state:
        fresh = await db.rentals.find_one({"_id": oid(rid)})
        await _set_rental_state(user, fresh, new_state)
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


async def _connect_safe(coro):
    try:
        return await coro
    except HTTPException:
        return []


@api.get("/connect/export")
async def connect_export(request: Request, from_date: Optional[str] = None, to_date: Optional[str] = None):
    import time as _t
    async def timed(name, coro):
        t0 = _t.time()
        try:
            return await coro
        finally:
            logger.info(f"connect_export {name}: {_t.time() - t0:.1f}s")
    summary, drivers, vehicles, rentals, packages, daily, odo = await asyncio.gather(
        timed("summary", dashboard_summary(request, city=None)),
        timed("drivers", list_drivers(request, city=None, status=None, unassigned=None, q=None)),
        timed("vehicles", list_vehicles(request, status=None, city=None, q=None, page=1, page_size=1000)),
        timed("rentals", list_rentals(request, status=None, city=None, q=None)),
        timed("packages", _connect_safe(rental_admin_packages(request))),
        timed("daily_collection", get_daily_collection(request, city=None, from_date=from_date, to_date=to_date, driver_name=None)),
        timed("odometer", get_odometer_logs(request, city=None, from_date=None, to_date=None, driver_name=None)),
    )
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "summary": summary, "drivers": drivers,
            "vehicles": vehicles, "rentals": rentals, "packages": packages, "daily_collection": daily, "odometer": odo}


# ---------- external API for TheConnect ----------
@api.get("/external/vehicles")
async def external_vehicles(request: Request):
    key = os.environ.get("CONNECT_API_KEY") or ""
    if not key or not secrets.compare_digest(request.headers.get("X-API-Key", ""), key):
        raise HTTPException(status_code=401, detail="Invalid API key")
    vehicles = await db.vehicles.find({"organization_id": os.environ.get("CONNECT_ORG_ID", "route39-org")}).sort("vehicle_number", 1).to_list(5000)
    drv_ids = [oid(v["current_driver_id"]) for v in vehicles if v.get("current_driver_id")]
    drivers = {str(d["_id"]): d for d in await db.drivers.find({"_id": {"$in": drv_ids}}).to_list(5000)}
    accts = {a["driver_id"]: a for a in await db.rental_accounts.find({"driver_id": {"$in": list(drivers.keys())}}).to_list(5000)}
    items = []
    for v in vehicles:
        d = drivers.get(v.get("current_driver_id") or "")
        a = accts.get(str(d["_id"])) if d else None
        items.append({
            "id": str(v["_id"]), "vehicle_number": v.get("vehicle_number"),
            "registration_number": v.get("registration_number"), "vin_number": v.get("vin_number"),
            "model": v.get("model"), "city": v.get("city"), "status": v.get("status"),
            "odometer": (d.get("last_odometer_reading") if d and d.get("last_odometer_reading") else v.get("odometer", 0)),
            "odometer_date": d.get("last_odometer_date") if d else None,
            "driver_id": str(d["_id"]) if d else None, "driver_code": d.get("driver_code") if d else None,
            "driver_name": d.get("name") if d else v.get("current_driver_name"),
            "driver_phone": d.get("phone") if d else None,
            "outstanding_amount": float((a or {}).get("outstanding_amount", 0) or 0),
        })
    return {"total": len(items), "items": items}


# ---------- external odometer API for TheConnect ----------
@api.get("/external/odometer")
async def external_odometer(request: Request, days: int = 30):
    key = os.environ.get("CONNECT_API_KEY") or ""
    if not key or not secrets.compare_digest(request.headers.get("X-API-Key", ""), key):
        raise HTTPException(status_code=401, detail="Invalid API key")
    org = os.environ.get("CONNECT_ORG_ID", "route39-org")
    drivers = {str(d["_id"]): d for d in await db.drivers.find({"organization_id": org}, {"name": 1, "city": 1, "driver_code": 1}).to_list(10000)}
    since = (_today_ist() - timedelta(days=days)).strftime("%Y-%m-%d")
    logs = await db.driver_odometer_logs.find({"driver_id": {"$in": list(drivers.keys())}, "date": {"$gte": since}}).sort("created_at", -1).to_list(3000)
    totals = {}
    for l in logs:
        k = (l.get("driver_id"), l.get("date"))
        totals[k] = totals.get(k, 0) + (l.get("driven_today") or 0)
    items = []
    for l in logs:
        d = drivers.get(l.get("driver_id")) or {}
        items.append({
            "id": str(l["_id"]), "date": l.get("date"), "driver_id": l.get("driver_id"),
            "driver_name": d.get("name"), "driver_code": d.get("driver_code"), "driver_city": d.get("city"),
            "package_name": l.get("snapshot_package_name"), "daily_limit_km": l.get("snapshot_daily_limit"),
            "start_reading": l.get("start_reading"), "end_reading": l.get("end_reading"),
            "driven_today": l.get("driven_today"), "day_total_km": totals.get((l.get("driver_id"), l.get("date")), 0),
            "extra_km": l.get("extra_km", 0), "extra_km_charge": l.get("extra_km_charge", 0),
            "status": l.get("status"), "type": l.get("type"),
            "start_image_url": l.get("start_image_url"), "end_image_url": l.get("end_image_url"),
        })
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "total": len(items), "odometer": items}


# ---------- external drivers API for TheConnect ----------
@api.get("/external/drivers")
async def external_drivers(request: Request):
    key = os.environ.get("CONNECT_API_KEY") or ""
    if not key or not secrets.compare_digest(request.headers.get("X-API-Key", ""), key):
        raise HTTPException(status_code=401, detail="Invalid API key")
    org = os.environ.get("CONNECT_ORG_ID", "route39-org")
    drivers = await db.drivers.find({"organization_id": org}, {"password_hash": 0}).sort("name", 1).to_list(10000)
    vehs = {v.get("current_driver_id"): v for v in await db.vehicles.find({"organization_id": org, "current_driver_id": {"$nin": [None, ""]}}, {"vehicle_number": 1, "registration_number": 1, "current_driver_id": 1}).to_list(10000)}
    rents = {}
    for r in await db.rentals.find({"organization_id": org, "status": {"$nin": ["closed", "ended"]}}).to_list(10000):
        rents.setdefault(r.get("driver_id"), r)
    accts = {a.get("driver_id"): a for a in await db.rental_accounts.find({"organization_id": org}, {"driver_id": 1, "outstanding_amount": 1, "extra_km_due": 1}).to_list(10000)}
    odo = {x["_id"]: x async for x in db.driver_odometer_logs.aggregate([
        {"$match": {"driver_id": {"$in": [str(d["_id"]) for d in drivers]}}}, {"$sort": {"date": -1}},
        {"$group": {"_id": "$driver_id", "date": {"$first": "$date"}, "end": {"$first": "$end_reading"}, "start": {"$first": "$start_reading"}, "km": {"$first": "$day_total_km"}}}])}
    items = []
    for d in drivers:
        did = str(d["_id"])
        v, r = vehs.get(did) or {}, rents.get(did) or {}
        items.append({
            "id": did, "name": d.get("name"), "driver_code": d.get("driver_code"), "phone": d.get("phone"),
            "city": d.get("city"), "status": d.get("status"), "kyc_status": d.get("kyc_status"),
            "license_number": d.get("license_number"), "address": d.get("address"),
            "emergency_contact": d.get("emergency_contact"), "rental_block_status": d.get("rental_block_status"),
            "package_name": r.get("package_name") or r.get("plan_name"), "package_rate": r.get("daily_rate"),
            "current_vehicle_number": v.get("vehicle_number"), "current_vehicle_reg": v.get("registration_number"),
            "rental_status": r.get("status"),
            "outstanding_amount": (accts.get(did) or {}).get("outstanding_amount", r.get("outstanding")),
            "extra_km_due": (accts.get(did) or {}).get("extra_km_due"),
            "last_odo_date": (odo.get(did) or {}).get("date"),
            "last_odo_reading": (odo.get(did) or {}).get("end") or (odo.get(did) or {}).get("start"),
            "last_day_km": (odo.get(did) or {}).get("km"),
        })
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "total": len(items), "items": items, "drivers": items}


# ---------- external earnings API for TheConnect ----------
@api.get("/external/earnings")
async def external_earnings(request: Request, month: str):
    key = os.environ.get("CONNECT_API_KEY") or ""
    if not key or not secrets.compare_digest(request.headers.get("X-API-Key", ""), key):
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    org = os.environ.get("CONNECT_ORG_ID", "route39-org")
    vehs = await db.vehicles.find({"organization_id": org}, {"vehicle_number": 1, "registration_number": 1, "city": 1}).to_list(10000)
    rmap = {str(r["_id"]): r.get("vehicle_id") for r in await db.rentals.find({"organization_id": org}, {"vehicle_id": 1}).to_list(100000)}
    dmap = {str(r["_id"]): r.get("vehicle_id") for r in await db.driver_rentals.find({"organization_id": org}, {"vehicle_id": 1}).to_list(100000)}
    agg = {}
    def add(vid, amt, days):
        if not vid:
            return
        e = agg.setdefault(str(vid), {"rent_collected": 0.0, "days_paid": 0, "payments": 0})
        e["rent_collected"] += amt; e["days_paid"] += days; e["payments"] += 1
    # A: admin manual payments (rentals) - payment minus refund
    async for p in db.rental_payments.find({"organization_id": org, "kind": {"$exists": False},
                                            "type": {"$in": ["payment", "refund"]}, "payment_date": {"$regex": f"^{month}"}}):
        amt = float(p.get("amount") or 0)
        add(rmap.get(p.get("rental_id")), -amt if p.get("type") == "refund" else amt, 0)
    # B: driver app rent payments (no deposit / extra_km)
    async for p in db.rental_payments.find({"organization_id": org, "kind": {"$in": ["daily", "outstanding", "catchup"]},
                                            "$or": [{"payment_status": "paid"}, {"status": "paid"}],
                                            "paid_at": {"$regex": f"^{month}"}}):
        ca = p.get("covers_amounts") or {}
        amt = sum(float(x or 0) for x in ca.values()) if ca else float(p.get("amount") or 0)
        rid = p.get("rental_id")
        add(dmap.get(rid) or rmap.get(rid), amt, len(ca))
    items = []
    for v in vehs:
        e = agg.get(str(v["_id"]), {"rent_collected": 0.0, "days_paid": 0, "payments": 0})
        items.append({"vehicle_id": str(v["_id"]), "vehicle_number": v.get("vehicle_number"),
                      "registration_number": v.get("registration_number"), "city": v.get("city"),
                      "rent_collected": round(e["rent_collected"], 2), "days_paid": e["days_paid"], "payments": e["payments"]})
    return {"month": month, "generated_at": datetime.now(timezone.utc).isoformat(), "total": len(items), "items": items}


# ---------- external summary API for TheConnect ----------
@api.get("/external/summary")
async def external_summary(request: Request):
    key = os.environ.get("CONNECT_API_KEY") or ""
    if not key or not secrets.compare_digest(request.headers.get("X-API-Key", ""), key):
        raise HTTPException(status_code=401, detail="Invalid API key")
    _org = os.environ.get("CONNECT_ORG_ID") or "org_myklick"
    _svc = await db.users.find_one({"organization_id": _org, "role": {"$in": ["admin", "company_admin"]}}, {"_id": 0})
    if not _svc:
        raise HTTPException(status_code=500, detail="No admin user for CONNECT_ORG_ID")
    request.state.service_user = _svc
    org = os.environ.get("CONNECT_ORG_ID", "route39-org")
    summary, pkgs, drs, rts = await asyncio.gather(
        dashboard_summary(request, city=None),
        db.rental_packages.find({"organization_id": org}).sort("daily_rate", 1).to_list(200),
        db.driver_rentals.find({"organization_id": org, "status": "active"}).to_list(10000),
        db.rentals.find({"organization_id": org, "status": {"$nin": ["closed", "ended", "cancelled"]}}).to_list(10000))
    users = {str(u["_id"]): u for u in await db.users.find({"_id": {"$in": [oid(x["driver_id"]) for x in drs if x.get("driver_id")]}}, {"name": 1, "phone": 1}).to_list(10000)}
    vnum = {str(v["_id"]): v.get("vehicle_number") for v in await db.vehicles.find({"organization_id": org}, {"vehicle_number": 1}).to_list(10000)}
    assigned = {}
    for x in drs:
        u = users.get(str(x.get("driver_id"))) or {}
        assigned.setdefault(x.get("package_id") or x.get("package_name"), []).append({
            "driver_name": x.get("driver_name") or u.get("name"), "driver_phone": x.get("driver_phone") or u.get("phone"),
            "vehicle_number": vnum.get(str(x.get("vehicle_id"))), "vehicle_reg": x.get("vehicle_reg"),
            "daily_rate": x.get("daily_rate"), "start_date": x.get("start_date")})
    for x in rts:
        assigned.setdefault(x.get("package_name") or x.get("plan_name"), []).append({
            "driver_name": x.get("driver_name"), "driver_phone": None, "vehicle_number": x.get("vehicle_number"),
            "vehicle_reg": None, "daily_rate": x.get("daily_rate"), "start_date": x.get("start")})
    plans = await db.rental_plans.find({"organization_id": org}).to_list(200)
    packages, used = [], set()
    for pk in pkgs + plans:
        d = ser(pk)
        keys = [k for k in (str(pk["_id"]), pk.get("name")) if k and k not in used]
        d["drivers"] = [x for k in keys for x in assigned.get(k, [])]
        used.update(keys)
        d["drivers_count"] = len(d["drivers"])
        packages.append(d)
    for k, lst in assigned.items():
        if k not in used:
            packages.append({"id": None, "name": k or "No package", "daily_rate": lst[0].get("daily_rate") if lst else None,
                             "status": "active", "drivers": lst, "drivers_count": len(lst)})
    packages.sort(key=lambda x: -x["drivers_count"])
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "summary": summary, "packages": packages}


# ---------- Team Documents (admin / city-manager uploads, city based) ----------
TEAM_DOC_ROLES = ["admin", "company_admin", "city_manager"]
TEAM_DOC_MAX_BYTES = 10 * 1024 * 1024  # file itself is stored in MongoDB (16 MB doc limit)


def _team_doc_scope(user: dict) -> dict:
    """Admin sees every city of the org; a city manager only sees his/her own city."""
    f = {"organization_id": user.get("organization_id") or "route39-org"}
    if user.get("role") == "city_manager":
        f["city"] = user.get("city")
    return f


@api.get("/team-documents")
async def list_team_documents(request: Request):
    user = await get_user(request)
    require_role(user, TEAM_DOC_ROLES)
    rows = await db.org_documents.find(_team_doc_scope(user), {"data": 0}).sort("created_at", -1).to_list(1000)
    return [ser(r) for r in rows]


@api.post("/team-documents")
async def create_team_document(
    request: Request,
    name: str = Form(...),
    city: str = Form(...),
    file: UploadFile = File(...),
):
    user = await get_user(request)
    require_role(user, TEAM_DOC_ROLES)
    name = (name or "").strip()
    city = (city or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Document name is required")
    if not city:
        raise HTTPException(status_code=400, detail="City is required")
    if user.get("role") == "city_manager":
        if city != user.get("city"):
            raise HTTPException(status_code=403, detail="You can only upload documents for your own city")
    elif city not in CITIES:
        raise HTTPException(status_code=400, detail="Invalid city")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Document attachment is required")
    if len(data) > TEAM_DOC_MAX_BYTES:
        raise HTTPException(status_code=400, detail="File must be under 10 MB")
    doc = {
        "organization_id": user.get("organization_id") or "route39-org",
        "name": name,
        "city": city,
        "filename": file.filename or "document",
        "content_type": file.content_type or "application/octet-stream",
        "size": len(data),
        "data": Binary(data),
        "uploaded_by": user.get("id"),
        "uploaded_by_name": user.get("name", ""),
        "created_at": now_iso(),
    }
    res = await db.org_documents.insert_one(doc)
    await log_audit(user, "team_document_uploaded", "team_document", str(res.inserted_id), f"Document '{name}' uploaded for {city}")
    return ser(await db.org_documents.find_one({"_id": res.inserted_id}, {"data": 0}))


@api.get("/team-documents/{doc_id}/file")
async def download_team_document(doc_id: str, request: Request):
    user = await get_user(request)
    require_role(user, TEAM_DOC_ROLES)
    doc = await db.org_documents.find_one({"_id": oid(doc_id), **_team_doc_scope(user)})
    if not doc or not doc.get("data"):
        raise HTTPException(status_code=404, detail="Document not found")
    return Response(
        content=bytes(doc["data"]),
        media_type=doc.get("content_type") or "application/octet-stream",
    )


@api.delete("/team-documents/{doc_id}")
async def delete_team_document(doc_id: str, request: Request):
    user = await get_user(request)
    require_role(user, TEAM_DOC_ROLES)
    doc = await db.org_documents.find_one({"_id": oid(doc_id), **_team_doc_scope(user)}, {"data": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await db.org_documents.delete_one({"_id": doc["_id"]})
    await log_audit(user, "team_document_deleted", "team_document", doc_id, f"Document '{doc.get('name')}' deleted")
    return {"ok": True}


# ---------- Pending Payments (every driver: pending daily rent + pending deposit) ----------
PENDING_PAY_ROLES = ["admin", "company_admin", "city_manager", "staff"]


@api.get("/pending-payments")
async def list_pending_payments(request: Request, city: Optional[str] = None):
    user = await get_user(request)
    require_role(user, PENDING_PAY_ROLES)
    org = user.get("organization_id") or "route39-org"
    extra = {}
    if city and city != "all":
        extra["city"] = city
    # org_filter also limits a city manager to drivers of their own city
    drivers = await db.drivers.find(org_filter(user, extra)).sort("created_at", 1).to_list(None)
    ids = [str(d["_id"]) for d in drivers]

    rentals = {}
    for r in await db.rentals.find({"organization_id": org, "driver_id": {"$in": ids}, "status": {"$ne": "closed"}}).sort("created_at", 1).to_list(None):
        rentals[r["driver_id"]] = r  # latest open rental wins
    deps = {x["driver_id"]: x for x in await db.security_deposits.find({"organization_id": org, "driver_id": {"$in": ids}}).to_list(None)}

    veh_ids = []
    for d in drivers:
        try:
            if d.get("current_vehicle_id"):
                veh_ids.append(ObjectId(d["current_vehicle_id"]))
        except Exception:
            pass
    vehs = {str(v["_id"]): v for v in await db.vehicles.find({"_id": {"$in": veh_ids}}, {"registration_number": 1, "vehicle_number": 1}).to_list(None)} if veh_ids else {}

    rows = []
    for d in drivers:
        did = str(d["_id"])
        r = rentals.get(did)

        # total daily rent still unpaid (same account used by Daily Collection / driver app)
        rent_pending = 0.0
        if r:
            acct = await _rental_account(r)
            rent_pending = round(float(acct.get("rent_due", 0) or 0), 2)

        # deposit still unpaid: full / first part if nothing paid yet, remaining part once its
        # next payment date is today or has passed, nothing while the next date is still ahead
        dep = dict(deps.get(did) or {})
        if dep.get("status", "pending") == "pending":
            dep["amount"] = await _deposit_amount_for(org, did, dep or None) or float(dep.get("amount") or 0)
        dep = _deposit_decorate(dep)
        deposit_pending = round(float(dep["pay_now"]), 2) if dep.get("action_required") else 0.0

        # Commission / Salary package drivers pay no daily rent and no security deposit
        _cat = (r or {}).get("package_category") or "rental"
        if _cat != "rental":
            rent_pending = 0.0
            deposit_pending = 0.0

        v = vehs.get(d.get("current_vehicle_id") or "") or {}
        rows.append({
            "id": did,
            "driver_name": d.get("name"),
            "driver_code": d.get("driver_code"),
            "phone": d.get("phone"),
            "city": d.get("city"),
            "vehicle_reg": v.get("registration_number"),
            "vehicle_number": v.get("vehicle_number") or d.get("current_vehicle_number"),
            "package_name": (r or {}).get("package_name") or d.get("package_name"),
            "package_category": _cat,
            "rent_pending": rent_pending,
            "deposit_pending": deposit_pending,
            "supervisor_name": d.get("supervisor_name"),
        })
    return rows


@api.get("/pending-payments/signature")
async def pending_payments_signature(request: Request):
    """Cheap change-detector for the Pending Payments page: a fingerprint of the stored rent /
    deposit totals. It changes whenever any payment, mark-paid or mark-unpaid happens, so the
    page only reloads the full (expensive) list when something actually changed."""
    import hashlib
    user = await get_user(request)
    require_role(user, PENDING_PAY_ROLES)
    org = user.get("organization_id") or "route39-org"
    acc = await db.rental_accounts.aggregate([
        {"$match": {"organization_id": org}},
        {"$group": {"_id": None, "n": {"$sum": 1},
                    "rent": {"$sum": "$rent_due"}, "out": {"$sum": "$outstanding_amount"},
                    "km": {"$sum": "$extra_km_due"}}},
    ]).to_list(1)
    dep = await db.security_deposits.aggregate([
        {"$match": {"organization_id": org}},
        {"$group": {"_id": {"s": "$status", "p": "$next_payment_date"}, "n": {"$sum": 1},
                    "amt": {"$sum": "$amount"}, "paid": {"$sum": "$paid_amount"}}},
        {"$sort": {"_id.s": 1, "_id.p": 1}},
    ]).to_list(None)
    rent = await db.rentals.aggregate([
        {"$match": {"organization_id": org, "status": {"$ne": "closed"}}},
        {"$group": {"_id": "$status", "n": {"$sum": 1}, "rate": {"$sum": "$daily_rate"}}},
        {"$sort": {"_id": 1}},
    ]).to_list(None)
    raw = json.dumps([acc, dep, rent, _today_ist().isoformat()], default=str, sort_keys=True)
    return {"sig": hashlib.md5(raw.encode()).hexdigest()}


app.include_router(api)

@app.on_event("startup")
async def startup():
    indexes = [
        (db.users, "email", {"unique": True}),
        (db.vehicles, [("organization_id", 1), ("status", 1), ("city", 1)], {}),
        (db.vehicles, "registration_number", {}),
        (db.drivers, [("organization_id", 1), ("city", 1)], {}),
        (db.drivers, "phone", {}),
        (db.rentals, [("organization_id", 1), ("status", 1)], {}),
        (db.service_requests, [("organization_id", 1), ("status", 1)], {}),
        (db.audit_logs, [("organization_id", 1), ("created_at", -1)], {}),
        (db.orders, [("organization_id", 1), ("status", 1)], {}),
        (db.customers, [("organization_id", 1)], {}),
        (db.users, "phone", {}),
        (db.rental_packages, [("organization_id", 1)], {}),
        (db.driver_rentals, [("organization_id", 1), ("driver_id", 1)], {}),
        (db.rental_payments, [("organization_id", 1), ("driver_id", 1)], {}),
        (db.security_deposits, [("organization_id", 1), ("driver_id", 1)], {}),
        (db.rental_accounts, [("organization_id", 1), ("driver_id", 1)], {}),
        (db.referrals, "referred_phone", {}),
        (db.referrals, [("organization_id", 1), ("referrer_driver_id", 1)], {}),
        (db.driver_odometer_images, "token", {}),
        (db.driver_odometer_images, "driver_id", {}),
        (db.driver_kyc_files, "token", {}),
        (db.driver_kyc_files, "driver_id", {}),
    ]
    for coll, keys, opts in indexes:
        try:
            await coll.create_index(keys, **opts)
        except Exception as e:
            logger.warning(f"Index skipped {coll.name} {keys}: {str(e)[:120]}")
        # Assign driver_code to existing drivers (once, in join order)
    try:
        last = await db.drivers.find_one({"driver_code": {"$regex": r"^R39D\d"}}, sort=[("driver_code", -1)])
        start = int(last["driver_code"][4:]) if last else 0
        cur = await db.counters.find_one({"_id": "driver_code"})
        if not cur or cur.get("seq", 0) < start or start == 0:
            await db.counters.update_one({"_id": "driver_code"}, {"$set": {"seq": start}}, upsert=True)
        missing = await db.drivers.find({"driver_code": {"$exists": False}}).sort([("created_at", 1), ("_id", 1)]).to_list(None)
        for d in missing:
            await db.drivers.update_one({"_id": d["_id"]}, {"$set": {"driver_code": await _next_driver_code(d.get("city"))}})
        if missing:
            logger.info(f"Assigned driver_code to {len(missing)} drivers")
        await db.drivers.create_index("driver_code", unique=True, sparse=True)
    except Exception as e:
        logger.warning(f"driver_code backfill failed: {e}")
    # await seedlib.seed(db, authlib)  # disabled - do not reseed


@app.on_event("shutdown")
async def shutdown():
    client.close()
