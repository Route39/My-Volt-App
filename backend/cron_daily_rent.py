import asyncio
import os
from datetime import datetime
import calendar
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Load environment variables from .env file so the cron job knows where the DB is
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

MONGO_URL = os.getenv("MONGO_URL", os.getenv("MONGO_URI", "mongodb://localhost:27017"))
DB_NAME = os.getenv("DB_NAME", "myvolt")
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

async def run_daily_rent():
    print("Starting daily rent cron job...")
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    
    # Policy: The last 3 days of the month are FREE.
    is_free_day = now.day > (days_in_month - 3)
    
    if is_free_day:
        print(f"Today ({today}) is day {now.day} of {days_in_month}. It is a FREE day! No rent will be charged.")
        return
        
    # Find all active rentals (status not 'ended' or 'closed')
    active_rentals = db.rentals.find({"status": {"$ne": "closed"}})
    
    count = 0
    async for rental in active_rentals:
        daily_rate = rental.get("daily_rate", 0)
        if daily_rate <= 0:
            continue
            
        driver_id = rental.get("driver_id")
        org_id = rental.get("organization_id")
        
        # Charge the rent for the day
        await db.rental_accounts.update_one(
            {"driver_id": driver_id, "organization_id": org_id},
            {
                "$inc": {"outstanding_amount": daily_rate},
                "$addToSet": {"unpaid_dates": today}
            },
            upsert=True
        )
        print(f"Charged ₹{daily_rate} rent for driver {driver_id}")
        count += 1
        
    print(f"Finished daily rent cron job. Charged {count} drivers.")

if __name__ == "__main__":
    asyncio.run(run_daily_rent())
