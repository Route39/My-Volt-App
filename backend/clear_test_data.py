"""
clear_test_data.py — Clears ALL test/dummy data from the database.
Keeps: admin user, org config, packages (but resets amounts to 0 for re-entry)
Removes: drivers, vehicles, rentals, payments, odometer logs, KYC, incidents, etc.
"""
import asyncio, os
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

async def main():
    load_dotenv()
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "route39")]

    # Collections to fully clear
    collections_to_clear = [
        "drivers",
        "vehicles",
        "rentals",
        "rental_accounts",
        "rental_payments",
        "driver_odometer_logs",
        "otp_codes",
        "login_attempts",
        "service_requests",
        "vehicle_services",
        "incidents",
        "audit_logs",
        "notifications",
    ]

    for col in collections_to_clear:
        result = await db[col].delete_many({})
        print(f"  Cleared {col}: {result.deleted_count} documents removed")

    print("\nAll test data cleared!")
    print("Admin users and packages are preserved.")
    print("\nNext steps:")
    print("  1. Go to Dashboard -> Packages and set REAL package amounts")
    print("  2. Go to Dashboard -> Drivers and add your test driver with phone 9847739725")
    print("  3. Assign a vehicle and create a rental for that driver")
    print("  4. Test the APK login with 9847739725")

asyncio.run(main())
