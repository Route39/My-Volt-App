import asyncio, os
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

async def main():
    load_dotenv()
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "route39")]

    collections_to_clear = [
        "drivers",
        "vehicles",
        "rentals",
        "driver_rentals",
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
asyncio.run(main())
