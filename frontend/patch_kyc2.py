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
if "KYC_DOC_TYPES" not in s:
    die("Run patch_kyc.py first.")
if "address: str = Form" in s:
    die("patch 2 already applied")

s = replace_once(s,
    '    pan: UploadFile = File(None),\n    lat: str = Form(""),\n    lng: str = Form(""),\n):',
    '    pan: UploadFile = File(None),\n    driver_photo: UploadFile = File(None),\n    vehicle_photo: UploadFile = File(None),\n    lat: str = Form(""),\n    lng: str = Form(""),\n    address: str = Form(""),\n):',
    "signature")
s = replace_once(s,
    '[("dl_front", dl_front), ("dl_back", dl_back), ("aadhaar", aadhaar), ("pan", pan)]:',
    '[("dl_front", dl_front), ("dl_back", dl_back), ("aadhaar", aadhaar), ("pan", pan),\n                       ("driver_photo", driver_photo), ("vehicle_photo", vehicle_photo)]:',
    "doc loop")
s = replace_once(s,
    '    await db.drivers.update_one({"_id": ObjectId(user["id"])}, {"$set": set_doc})',
    '    if address.strip():   # optional: only saved when the driver typed one\n        set_doc["location.address"] = address.strip()\n    await db.drivers.update_one({"_id": ObjectId(user["id"])}, {"$set": set_doc})',
    "address save")
SERVER.write_text(s, encoding="utf-8")
print("backend/server.py patched")

k = KYC.read_text(encoding="utf-8")
k = replace_once(k,
    '    dl_front: null, dl_back: null, aadhaar: null, pan: null,\n  });\n  const [error, setError] = useState("");',
    '    dl_front: null, dl_back: null, aadhaar: null, pan: null,\n    driver_photo: null, vehicle_photo: null,\n  });\n  const [error, setError] = useState("");\n  const [address, setAddress] = useState("");',
    "state")
k = replace_once(k, 'const optional = ["aadhaar", "pan"];',
                 'const optional = ["aadhaar", "pan", "driver_photo", "vehicle_photo"];', "optional list")
k = replace_once(k, '    fd.append("lat", lat);',
                 '    if (address.trim()) fd.append("address", address.trim());\n    fd.append("lat", lat);', "append address")
sections = '''        {/* Driver & Vehicle Section (optional) */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold">
            <span className="text-slate-900">Driver &</span> <span className="text-red-500">Vehicle</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadBtn label="Driver Photo (optional)" file={files.driver_photo} onChange={handleFile("driver_photo")} />
            <UploadBtn label="Driver + Vehicle (optional)" file={files.vehicle_photo} onChange={handleFile("vehicle_photo")} />
          </div>
        </div>

        {/* Address Section (optional) */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold">
            <span className="text-slate-900">Current</span> <span className="text-red-500">Address</span> <span className="text-xs font-medium text-slate-400">(optional)</span>
          </h2>
          <textarea
            placeholder="Type your full address here (optional)..."
            value={address}
            onChange={e => setAddress(e.target.value)}
            rows={3}
            className="w-full rounded-2xl border-2 border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:border-red-500 focus:bg-white transition-colors resize-none"
          ></textarea>
        </div>

'''
k = replace_once(k, '        <button type="submit"', sections + '        <button type="submit"', "sections")
KYC.write_text(k, encoding="utf-8")
print("frontend/src/pages/driver/DriverKYC.jsx patched")
print("\nPatch 2 done.")
