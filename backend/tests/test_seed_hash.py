"""Direct DB checks: bcrypt hash format, no plaintext passwords, org isolation field."""
import os
import pytest
from dotenv import dotenv_values
from pymongo import MongoClient

env = dotenv_values("/app/backend/.env")
MONGO_URL = os.environ.get("MONGO_URL") or env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or env.get("DB_NAME")


@pytest.fixture(scope="module")
def db():
    if not MONGO_URL or not DB_NAME:
        pytest.skip("MONGO_URL/DB_NAME missing")
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


def test_bcrypt_hash_format(db):
    users = list(db.users.find({}))
    assert len(users) >= 5
    for u in users:
        assert u["password_hash"].startswith("$2b$"), f"{u['email']}: {u['password_hash'][:7]}"
        assert "password" not in u


def test_users_have_org(db):
    for u in db.users.find({}):
        assert u.get("organization_id"), u["email"]


def test_no_orphan_collections_missing_org(db):
    for coll in ["vehicles", "drivers", "rentals", "service_requests", "documents", "locations"]:
        missing = db[coll].count_documents({"organization_id": {"$exists": False}})
        assert missing == 0, f"{coll} has {missing} docs without organization_id"
