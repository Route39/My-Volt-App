"""Authentication utilities: bcrypt hashing + JWT tokens + role helpers."""
import os
import jwt
import bcrypt
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Request
from bson import ObjectId

JWT_ALGORITHM = "HS256"

ROLES = ["admin", "city_manager"]

# Which modules each role may access (used for frontend hints; backend enforces per-endpoint)
ROLE_ACCESS = {
    "admin": "all",
    "city_manager": ["dashboard", "fleet", "drivers", "rentals", "service", "locations", "incidents", "packages"],
}


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=3650), # 10 years
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=3650), # 10 years
        "type": "refresh",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])


def _extract_token(request: Request):
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    # Isolate driver cookies to avoid overriding admin cookies in local dev
    if request.url.path.startswith("/api/driver"):
        return request.cookies.get("driver_access_token") or request.cookies.get("access_token")
        
    return request.cookies.get("access_token")


async def current_user_from_request(request: Request, db) -> dict:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
    if not user:
        user = await db.drivers.find_one({"_id": ObjectId(payload["sub"])})
        if user:
            user["role"] = "driver"
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    user["id"] = str(user.pop("_id"))
    user.pop("password_hash", None)
    return user
