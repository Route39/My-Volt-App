import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

async def fix():
    client = AsyncIOMotorClient("mongodb+srv://startwithakash_db_user:SVA244XtvlCfU7s1@cluster0.w0qfwle.mongodb.net/?retryWrites=true&w=majority")
    db = client.route39
    res = await db.rental_accounts.update_many(
        {"today_paid": True},
        {"$set": {"today_paid": False}}
    )
    print(f"Updated {res.modified_count} accounts to today_paid=False")

asyncio.run(fix())
