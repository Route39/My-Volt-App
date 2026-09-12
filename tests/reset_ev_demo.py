"""Reset EV demo state for UI testing after backend test mutations."""
import asyncio, os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import dotenv_values

env = dotenv_values("/app/backend/.env")
MONGO_URL = env["MONGO_URL"]; DB = env["DB_NAME"]

async def main():
    db = AsyncIOMotorClient(MONGO_URL)[DB]
    # find drivers by phone
    plat = await db.users.find_one({"phone": "+919000000003", "role": "driver"})
    dep = await db.users.find_one({"phone": "+919000000004", "role": "driver"})
    if plat:
        pid = str(plat["_id"])
        # delete non-seed rental_payments (i.e. paid via sandbox verify) so unpaid dates come back
        r = await db.rental_payments.delete_many({"driver_id": pid, "gateway": {"$ne": "seed"}})
        # reset rental_account
        await db.rental_accounts.delete_one({"driver_id": pid})
        print("platinum removed", r.deleted_count, "non-seed payments")
    if dep:
        did = str(dep["_id"])
        r1 = await db.rental_payments.delete_many({"driver_id": did, "gateway": {"$ne": "seed"}})
        await db.security_deposits.update_one({"driver_id": did},
            {"$set": {"status": "pending", "transaction_id": None, "paid_at": None}})
        print("deposit-pending reset", r1.deleted_count, "payments removed")

asyncio.run(main())
