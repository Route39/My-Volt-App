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
    # DEPRECATED: rent is now billed PER TRIP, not per calendar day.
    # It is charged in exactly two places instead of here:
    #   1) backend/server.py -> _apply_paid(): once, when the deposit is paid
    #      (covers the driver's very first trip).
    #   2) backend/server.py -> submit_odometer() / admin_submit_odometer(),
    #      END TRIP branch: every time a trip ends (covers the next trip).
    # This function is kept as a no-op (rather than deleted) so that if the
    # scheduler still calls it, it does nothing instead of double-charging
    # drivers on top of the per-trip charges above.
    print("daily rent cron is deprecated — rent is now charged per trip, not per calendar day. Nothing to do.")
    return

if __name__ == "__main__":
    asyncio.run(run_daily_rent())
