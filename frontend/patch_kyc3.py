#!/usr/bin/env python3
import sys
from pathlib import Path

ROOT = Path.cwd()
SERVER = ROOT / "backend" / "server.py"
KYC = ROOT / "frontend" / "src" / "pages" / "driver" / "DriverKYC.jsx"


def die(msg):
    print("ERROR:", msg)
    sys.exit(1)


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        die(f"{label}: expected exactly 1 match, found {text.count(old)}")
    return text.replace(old, new)


for p in (SERVER, KYC):
    if not p.exists():
        die(f"{p} not found. Run from the repo root.")

s = SERVER.read_text(encoding="utf-8")
if "address: str = Form" not in s:
    die("Run patch_kyc.py and patch_kyc2.py first.")
s = replace_once(s, "    aadhaar: UploadFile = File(None),", "    aadhaar: UploadFile = File(...),", "aadhaar required")
s = replace_once(s, "    pan: UploadFile = File(None),", "    pan: UploadFile = File(...),", "pan required")
SERVER.write_text(s, encoding="utf-8")
print("backend/server.py patched")

k = KYC.read_text(encoding="utf-8")
k = replace_once(k, 'const optional = ["aadhaar", "pan", "driver_photo", "vehicle_photo"];',
                 'const optional = ["driver_photo", "vehicle_photo"];', "optional list")
k = replace_once(k, 'label="Aadhaar (optional)"', 'label="Aadhaar Card"', "aadhaar label")
k = replace_once(k, 'label="PAN Card (optional)"', 'label="PAN Card"', "pan label")
KYC.write_text(k, encoding="utf-8")
print("frontend/src/pages/driver/DriverKYC.jsx patched")
print("\nPatch 3 done.")
