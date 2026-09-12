import asyncio, os, sys
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import dotenv_values

env = dotenv_values("/app/backend/.env")
CODES = sys.argv[1].split(",") if len(sys.argv) > 1 else []
EMAILS = sys.argv[2].split(",") if len(sys.argv) > 2 else []


async def main():
    c = AsyncIOMotorClient(env["MONGO_URL"])
    db = c[env["DB_NAME"]]
    for code in [x for x in CODES if x]:
        r = await db.organizations.delete_many({"org_id": code})
        u = await db.users.delete_many({"organization_id": code})
        print("org", code, r.deleted_count, "users", u.deleted_count)
    for e in [x for x in EMAILS if x]:
        r = await db.users.delete_many({"email": e})
        print("user", e, r.deleted_count)
    print("remaining orgs:", [o["org_id"] for o in await db.organizations.find({}, {"org_id": 1}).to_list(100)])
    print("route39 vehicles:", await db.vehicles.count_documents({"organization_id": "route39-org"}))
    nay = await db.organizations.find_one({"industry": "fabric_order_management"})
    print("nayara org:", nay and nay["org_id"], "orders:", await db.orders.count_documents({"organization_id": nay["org_id"]}) if nay else 0)
    print("users total:", await db.users.count_documents({}))
    c.close()

asyncio.run(main())
