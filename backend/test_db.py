import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

async def test():
    client = AsyncIOMotorClient("mongodb+srv://startwithakash_db_user:SVA244XtvlCfU7s1@cluster0.w0qfwle.mongodb.net/?retryWrites=true&w=majority")
    print(await client.list_database_names())

asyncio.run(test())
