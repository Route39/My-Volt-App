#!/usr/bin/env python3
import re
import sys
from pathlib import Path

ROOT = Path.cwd()
SERVER = ROOT / "backend" / "server.py"
FE = ROOT / "frontend" / "src"


def die(msg):
    print("ERROR:", msg)
    sys.exit(1)


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        die(f"{label}: expected exactly 1 match, found {text.count(old)} (already patched, or file differs?)")
    return text.replace(old, new)


for p in (SERVER, FE / "pages/driver/DriverKYC.jsx", FE / "pages/DriverProfile.jsx", FE / "pages/KycApprovals.jsx"):
    if not p.exists():
        die(f"{p} not found. Run this from the repo root.")

# ------------------------------------------------------------------ backend
s = SERVER.read_text(encoding="utf-8")
if "KYC_DOC_TYPES" in s:
    die("backend already patched")

s = replace_once(
    s,
    '''        update_doc["$unset"] = {"kyc_documents": "", "location": ""}''',
    '''        # only clear what the driver submits; admin-uploaded docs (photo, agreement ...) are kept
        update_doc["$unset"] = {"kyc_documents.dl_front": "", "kyc_documents.dl_back": "",
                                "kyc_documents.aadhaar": "", "kyc_documents.pan": "", "location": ""}''',
    "review_kyc",
)

start = s.index('@api.post("/driver/kyc")\nasync def submit_driver_kyc(')
end_marker = 'return {"ok": True, "message": "KYC Submitted successfully"}\n'
end = s.index(end_marker, start) + len(end_marker)

new_block = """@api.post("/driver/kyc")
async def submit_driver_kyc(
    request: Request,
    dl_front: UploadFile = File(...),
    dl_back: UploadFile = File(...),
    aadhaar: UploadFile = File(None),
    pan: UploadFile = File(None),
    lat: str = Form(""),
    lng: str = Form(""),
):
    user = await get_user(request)
    require_driver(user)

    docs = {}
    kyc_file_docs = []
    for name, file in [("dl_front", dl_front), ("dl_back", dl_back), ("aadhaar", aadhaar), ("pan", pan)]:
        if file is None:
            continue
        data = await file.read()
        if not data:
            continue
        if len(data) > 10 * 1024 * 1024:  # MongoDB documents are limited to 16 MB
            raise HTTPException(status_code=400, detail=f"{name} must be under 10 MB")
        token = uuid.uuid4().hex  # random, unguessable id used in the file URL
        kyc_file_docs.append({
            "organization_id": user.get("organization_id") or "route39-org",
            "driver_id": user["id"],
            "name": name,
            "token": token,
            "filename": file.filename,
            "content_type": file.content_type or "image/jpeg",
            "data": Binary(data),  # the document image itself is stored inside MongoDB
            "created_at": now_iso(),
        })
        docs[name] = f"/api/kyc-files/{token}"

    if kyc_file_docs:
        await db.driver_kyc_files.insert_many(kyc_file_docs)

    # touch only the submitted keys so documents uploaded by the admin (photo, agreement ...) survive
    set_doc = {"kyc_status": "submitted", "kyc_submitted_at": now_iso()}
    for k, v in docs.items():
        set_doc[f"kyc_documents.{k}"] = v
    if lat != "" and lng != "":
        set_doc["location.lat"] = lat
        set_doc["location.lng"] = lng
    await db.drivers.update_one({"_id": ObjectId(user["id"])}, {"$set": set_doc})

    # re-submission: drop only the previous files of the documents that were just replaced
    await db.driver_kyc_files.delete_many({
        "driver_id": user["id"],
        "name": {"$in": list(docs.keys())},
        "token": {"$nin": [f["token"] for f in kyc_file_docs]},
    })
    return {"ok": True, "message": "KYC Submitted successfully"}


# ---------- Admin: upload / replace / delete any KYC document of a driver ----------
KYC_DOC_TYPES = {"dl_front", "dl_back", "aadhaar", "pan", "driver_photo", "vehicle_photo", "agreement"}
KYC_ADMIN_ROLES = ["admin", "company_admin", "city_manager", "staff"]


def _kyc_token_from_url(url):
    if isinstance(url, str) and url.startswith("/api/kyc-files/"):
        return url.rsplit("/", 1)[-1]
    return None


@api.post("/admin/drivers/{driver_id}/kyc/{doc_type}")
async def admin_upload_kyc_doc(driver_id: str, doc_type: str, request: Request, file: UploadFile = File(...)):
    user = await get_user(request)
    require_role(user, KYC_ADMIN_ROLES)
    if doc_type not in KYC_DOC_TYPES:
        raise HTTPException(status_code=400, detail="Invalid document type")
    drv = await db.drivers.find_one(org_filter(user, {"_id": oid(driver_id)}))
    if not drv:
        raise HTTPException(status_code=404, detail="Driver not found")

    content_type = (file.content_type or "").lower()
    if not (content_type.startswith("image/") or content_type == "application/pdf"):
        raise HTTPException(status_code=400, detail="Only image or PDF files are allowed")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File must be under 10 MB")

    token = uuid.uuid4().hex
    await db.driver_kyc_files.insert_one({
        "organization_id": user.get("organization_id") or "route39-org",
        "driver_id": driver_id,
        "name": doc_type,
        "token": token,
        "filename": file.filename,
        "content_type": content_type,
        "data": Binary(data),
        "uploaded_by": user["id"],
        "created_at": now_iso(),
    })
    await db.drivers.update_one(
        {"_id": drv["_id"]},
        {"$set": {f"kyc_documents.{doc_type}": f"/api/kyc-files/{token}"}},
    )
    old_token = _kyc_token_from_url((drv.get("kyc_documents") or {}).get(doc_type))
    if old_token:
        await db.driver_kyc_files.delete_many({"token": old_token, "driver_id": driver_id})

    await log_audit(user, "kyc_doc_uploaded", "driver", driver_id, f"KYC document '{doc_type}' uploaded by admin")
    fresh = await db.drivers.find_one({"_id": drv["_id"]}, {"kyc_documents": 1})
    return {"ok": True, "kyc_documents": (fresh or {}).get("kyc_documents") or {}}


@api.delete("/admin/drivers/{driver_id}/kyc/{doc_type}")
async def admin_delete_kyc_doc(driver_id: str, doc_type: str, request: Request):
    user = await get_user(request)
    require_role(user, KYC_ADMIN_ROLES)
    if doc_type not in KYC_DOC_TYPES:
        raise HTTPException(status_code=400, detail="Invalid document type")
    drv = await db.drivers.find_one(org_filter(user, {"_id": oid(driver_id)}))
    if not drv:
        raise HTTPException(status_code=404, detail="Driver not found")

    old_token = _kyc_token_from_url((drv.get("kyc_documents") or {}).get(doc_type))
    await db.drivers.update_one({"_id": drv["_id"]}, {"$unset": {f"kyc_documents.{doc_type}": ""}})
    if old_token:
        await db.driver_kyc_files.delete_many({"token": old_token, "driver_id": driver_id})

    await log_audit(user, "kyc_doc_deleted", "driver", driver_id, f"KYC document '{doc_type}' deleted by admin")
    fresh = await db.drivers.find_one({"_id": drv["_id"]}, {"kyc_documents": 1})
    return {"ok": True, "kyc_documents": (fresh or {}).get("kyc_documents") or {}}
"""
s = s[:start] + new_block + s[end:]
SERVER.write_text(s, encoding="utf-8")
print("backend/server.py patched")

# ------------------------------------------------------------------ frontend: new files
(FE / "components" / "KycDocManager.jsx").write_text(r"""import { useRef, useState } from "react";
import { Upload, Trash2, Eye, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiErrorDetail } from "../lib/api";
import imgUrl from "../lib/imgUrl";

// Every KYC document type the admin can manage for a driver
export const KYC_DOC_TYPES = [
  { key: "dl_front", label: "Driving License (Front)" },
  { key: "dl_back", label: "Driving License (Back)" },
  { key: "aadhaar", label: "Aadhaar Card" },
  { key: "pan", label: "PAN Card" },
  { key: "driver_photo", label: "Driver Photo" },
  { key: "vehicle_photo", label: "Driver + Vehicle" },
  { key: "agreement", label: "Rental Agreement" },
];

const MAX_MB = 10;

export default function KycDocManager({ driverId, docs, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [broken, setBroken] = useState({});   // urls that are not images (e.g. PDF) -> show "Open file"
  const inputs = useRef({});
  const base = `/admin/drivers/${driverId}/kyc`;

  const upload = async (key, file) => {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) return toast.error(`File must be under ${MAX_MB} MB`);
    setBusy(key);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`${base}/${key}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Document uploaded");
      onChanged && onChanged(data.kyc_documents || {});
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setBusy(null);
      if (inputs.current[key]) inputs.current[key].value = "";
    }
  };

  const remove = async (key, label) => {
    if (!window.confirm(`Delete "${label}"?`)) return;
    setBusy(key);
    try {
      const { data } = await api.delete(`${base}/${key}`);
      toast.success("Document deleted");
      onChanged && onChanged(data.kyc_documents || {});
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6" data-testid="kyc-doc-manager">
      {KYC_DOC_TYPES.map(({ key, label }) => {
        const url = docs?.[key];
        const full = url ? imgUrl(url) : null;
        const isBusy = busy === key;
        return (
          <div key={key} className="space-y-2">
            <h4 className="font-semibold text-slate-700 text-sm">{label}</h4>
            <div className="aspect-video bg-slate-100 rounded-2xl overflow-hidden relative flex items-center justify-center">
              {full && !broken[full] ? (
                <img
                  src={full}
                  alt={label}
                  className="w-full h-full object-contain bg-black cursor-pointer"
                  onClick={() => window.open(full, "_blank")}
                  onError={() => setBroken((b) => ({ ...b, [full]: true }))}
                />
              ) : full ? (
                <a href={full} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 text-slate-600 text-sm">
                  <FileText className="w-8 h-8" /> Open file
                </a>
              ) : (
                <span className="text-slate-400 text-sm">Not Provided</span>
              )}
              {isBusy && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-red-500" />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                ref={(el) => { inputs.current[key] = el; }}
                onChange={(e) => upload(key, e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={isBusy}
                onClick={() => inputs.current[key]?.click()}
                className="flex-1 h-9 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" /> {url ? "Replace" : "Upload"}
              </button>
              {url && (
                <>
                  <a
                    href={full}
                    target="_blank"
                    rel="noreferrer"
                    className="h-9 px-3 inline-flex items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700"
                    title="View"
                  >
                    <Eye className="w-4 h-4" />
                  </a>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => remove(key, label)}
                    className="h-9 px-3 inline-flex items-center justify-center rounded-xl border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
""", encoding="utf-8")
print("frontend/src/components/KycDocManager.jsx created")

(FE / "pages/driver/DriverKYC.jsx").write_text(r"""import { useState } from "react";
import { Camera, MapPin, CheckCircle, Loader2, AlertTriangle } from "lucide-react";
import dapi from "../../lib/driverApi";
import { useDriver } from "../../context/DriverAuthContext";
import { useNavigate } from "react-router-dom";
import { useNativeCamera } from "../../hooks/useNativeCamera";

export default function DriverKYC() {
  const { data, refresh } = useDriver();
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState({
    dl_front: null, dl_back: null, aadhaar: null, pan: null,
  });
  const [error, setError] = useState("");

  const handleFile = (key) => (file) => {
    if (file) setFiles(f => ({ ...f, [key]: file }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const optional = ["aadhaar", "pan"];
    if (Object.entries(files).some(([k, f]) => !f && !optional.includes(k))) return setError("All required documents must be uploaded");
    
    setLoading(true);
    
    let lat = "", lng = "";
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch (e) {
      console.warn("Could not get location", e);
    }

    const fd = new FormData();
    Object.entries(files).forEach(([k, v]) => { if (v) fd.append(k, v); });
    fd.append("lat", lat);
    fd.append("lng", lng);
    
    try {
      await dapi.post("/driver/kyc", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await refresh();
      nav("/driver");
    } catch (err) {
      setError(err.response?.data?.detail || "KYC Submit Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-5 pt-6 pb-20 space-y-8">
      {data?.driver?.kyc_status === "rejected" ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl">
          <h1 className="text-xl font-extrabold text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" /> KYC Rejected
          </h1>
          <p className="text-sm text-red-600 mt-1 font-medium">Please re-upload clear photos of your original documents.</p>
        </div>
      ) : (
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Complete KYC</h1>
          <p className="text-sm text-slate-500 mt-1">Capture your original documents.</p>
        </div>
      )}

      {data?.driver?.kyc_status === "approved" ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-red-100 shadow-sm shadow-red-100/50">
          <CheckCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900">KYC Approved</h2>
          <p className="text-red-600 font-medium mt-1 px-4">Your documents have been successfully verified. You are all set!</p>
        </div>
      ) : data?.driver?.kyc_status === "submitted" ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-amber-100 shadow-sm shadow-amber-100/50">
          <Loader2 className="w-16 h-16 text-amber-500 mx-auto mb-4 animate-spin" />
          <h2 className="text-2xl font-bold text-slate-900">Under Review, Please Wait</h2>
          <p className="text-amber-600 font-medium mt-1 px-4">Your documents have been submitted and are pending verification by the admin.</p>
        </div>
      ) : (
        <>
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>}
          
          <form onSubmit={submit} className="space-y-8">
        
        {/* Driving License Section */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold">
            <span className="text-slate-900">Driving</span> <span className="text-red-500">License</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadBtn label="Front Side" file={files.dl_front} onChange={handleFile("dl_front")} />
            <UploadBtn label="Back Side" file={files.dl_back} onChange={handleFile("dl_back")} />
          </div>
        </div>

        {/* Identity Section */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold">
            <span className="text-slate-900">Aadhaar &</span> <span className="text-red-500">PAN</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadBtn label="Aadhaar (optional)" file={files.aadhaar} onChange={handleFile("aadhaar")} />
            <UploadBtn label="PAN Card (optional)" file={files.pan} onChange={handleFile("pan")} />
          </div>
        </div>

        <button type="submit" disabled={loading} className="w-full h-14 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-bold flex items-center justify-center disabled:opacity-50 transition-colors">
          {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : "Submit KYC Documents"}
        </button>
      </form>
        </>
      )}
    </div>
  );
}

function UploadBtn({ label, file, onChange }) {
  const { captureImage, loading } = useNativeCamera();

  return (
    <button 
      type="button"
      disabled={loading}
      onClick={async () => {
        const captured = await captureImage();
        if (captured) onChange(captured);
      }}
      className={`relative h-28 rounded-2xl border-2 overflow-hidden flex flex-col items-center justify-center transition-colors w-full ${file ? 'border-red-500 bg-red-50/50 border-solid' : 'border-slate-200 border-dashed hover:border-slate-300 bg-slate-50'}`}
    >
      {file ? (
        <div className="absolute inset-0 w-full h-full">
          <img src={URL.createObjectURL(file)} alt="Preview" className="w-full h-full object-cover opacity-80" />
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/30">
            <CheckCircle className="w-6 h-6 text-white mb-1 shadow-sm" />
            <span className="font-bold text-white text-xs drop-shadow-md">Captured</span>
          </div>
        </div>
      ) : (
        <>
          {loading ? (
            <Loader2 className="w-6 h-6 text-red-500 animate-spin mb-1.5" />
          ) : (
            <Camera className="w-6 h-6 text-slate-400 mb-1.5" />
          )}
          <span className="font-medium text-slate-600 text-xs">{loading ? "Opening..." : label}</span>
        </>
      )}
    </button>
  );
}
""", encoding="utf-8")
print("frontend/src/pages/driver/DriverKYC.jsx updated")

# ------------------------------------------------------------------ frontend: admin Driver Profile
dp_path = FE / "pages/DriverProfile.jsx"
dp = dp_path.read_text(encoding="utf-8")
dp = replace_once(dp, 'import imgUrl from "../lib/imgUrl";\n',
                  'import imgUrl from "../lib/imgUrl";\nimport KycDocManager from "../components/KycDocManager";\n', "DriverProfile import")
dp = replace_once(dp, 'Trash2, Search, Ban,', 'Trash2, Ban,', "DriverProfile lucide import")
dp = replace_once(dp, '{d.kyc_status === "pending" || d.kyc_status === "submitted" ? (',
                  '{d.kyc_status !== "approved" ? (', "DriverProfile approve condition")
grid_start = dp.index('          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">\n            <KycDocCard title="Driving License (Front)"')
grid_end = dp.index('        </TabsContent>', grid_start)
dp = dp[:grid_start] + '          <KycDocManager driverId={d.id} docs={d.kyc_documents} onChanged={() => load()} />\n' + dp[grid_end:]
fn_start = dp.index('function KycDocCard({ title, url }) {')
fn_end = dp.index('function RentPaidDialog', fn_start)
dp = dp[:fn_start] + dp[fn_end:]
dp_path.write_text(dp, encoding="utf-8")
print("frontend/src/pages/DriverProfile.jsx patched")

# ------------------------------------------------------------------ frontend: admin KYC Approvals popup
ka_path = FE / "pages/KycApprovals.jsx"
ka = ka_path.read_text(encoding="utf-8")
ka = replace_once(ka, 'import imgUrl from "../lib/imgUrl";\n', 'import KycDocManager from "../components/KycDocManager";\n', "KycApprovals import")
doc_start = ka.index('              <DocCard title="Driving License (Front)"')
doc_end = ka.index('              <div className="md:col-span-2 rounded-2xl border border-slate-100 p-4 bg-slate-50', doc_start)
manager = (
    '              <KycDocManager\n'
    '                driverId={selected.id}\n'
    '                docs={selected.kyc_documents}\n'
    '                onChanged={(docs) => {\n'
    '                  setSelected((s) => ({ ...s, kyc_documents: docs }));\n'
    '                  setDrivers((ds) => ds.map((x) => (x.id === selected.id ? { ...x, kyc_documents: docs } : x)));\n'
    '                }}\n'
    '              />\n\n'
)
ka = ka[:doc_start] + manager + ka[doc_end:]
ka = replace_once(ka, '              <div className="md:col-span-2 rounded-2xl border border-slate-100 p-4 bg-slate-50',
                  '              {(selected.location?.address || selected.location?.lat) && (\n              <div className="md:col-span-2 rounded-2xl border border-slate-100 p-4 bg-slate-50', "KycApprovals address open")
ka = replace_once(ka, '                )}\n              </div>\n            </div>\n\n            <div className="p-6 border-t',
                  '                )}\n              </div>\n              )}\n            </div>\n\n            <div className="p-6 border-t', "KycApprovals address close")
fn_start = ka.index('function DocCard({ title, url }) {')
ka = ka[:fn_start].rstrip() + "\n"
ka_path.write_text(ka, encoding="utf-8")
print("frontend/src/pages/KycApprovals.jsx patched")

print("\nPatch 1 done.")
