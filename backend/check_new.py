import asyncio, os
import sys
sys.path.insert(0, '.')
from dotenv import load_dotenv
load_dotenv()
from motor.motor_asyncio import AsyncIOMotorClient

async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "route39")]
    
    print("\n=== DRIVER RENTALS ===")
    rentals = await db.driver_rentals.find({}).to_list(100)
    for r in rentals:
        print(f"Driver ID: {r.get('driver_id')}, start_date: {r.get('start_date')}, daily_rate: {r.get('daily_rate')}")
        
    print("\n=== RENTAL ACCOUNTS ===")
    accts = await db.rental_accounts.find({}).to_list(100)
    for a in accts:
        print(f"Driver ID: {a.get('driver_id')}, outstanding: {a.get('outstanding_amount')}, unpaid: {a.get('unpaid_dates')}, today_paid: {a.get('today_paid')}")

asyncio.run(main())
