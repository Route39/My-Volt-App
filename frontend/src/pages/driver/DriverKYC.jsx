import { useState } from "react";
import { Camera, MapPin, CheckCircle, Loader2, AlertTriangle } from "lucide-react";
import dapi from "../../lib/driverApi";
import { useDriver } from "../../context/DriverAuthContext";
import { useNavigate } from "react-router-dom";

export default function DriverKYC() {
  const { data, refresh } = useDriver();
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState({ dl_front: null, dl_back: null, aadhaar: null, pan: null });
  const [error, setError] = useState("");
  const [address, setAddress] = useState("");

  const handleFile = (key) => (e) => {
    if (e.target.files?.[0]) setFiles(f => ({ ...f, [key]: e.target.files[0] }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!address.trim()) return setError("Permanent address is required");
    if (!files.dl_front || !files.dl_back || !files.aadhaar || !files.pan) return setError("All documents required");
    
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
    Object.entries(files).forEach(([k, v]) => fd.append(k, v));
    fd.append("address", address);
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
        <div className="text-center py-20 bg-white rounded-3xl border border-emerald-100 shadow-sm shadow-emerald-100/50">
          <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900">KYC Approved</h2>
          <p className="text-emerald-600 font-medium mt-1 px-4">Your documents have been successfully verified. You are all set!</p>
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
            <span className="text-slate-900">Driving</span> <span className="text-emerald-500">License</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadBtn label="Front Side" file={files.dl_front} onChange={handleFile("dl_front")} />
            <UploadBtn label="Back Side" file={files.dl_back} onChange={handleFile("dl_back")} />
          </div>
        </div>

        {/* Identity Section */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold">
            <span className="text-slate-900">Aadhaar &</span> <span className="text-emerald-500">PAN</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadBtn label="Aadhaar" file={files.aadhaar} onChange={handleFile("aadhaar")} />
            <UploadBtn label="PAN Card" file={files.pan} onChange={handleFile("pan")} />
          </div>
        </div>

        {/* Address Section */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold">
            <span className="text-slate-900">Current</span> <span className="text-emerald-500">Address</span>
          </h2>
          
          <textarea 
            placeholder="Type your exact full address here..."
            value={address}
            onChange={e => setAddress(e.target.value)}
            rows={3}
            className="w-full rounded-2xl border-2 border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:border-emerald-500 focus:bg-white transition-colors resize-none"
          ></textarea>
        </div>
        
        <button type="submit" disabled={loading} className="w-full h-14 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-bold flex items-center justify-center disabled:opacity-50 transition-colors">
          {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : "Submit KYC Documents"}
        </button>
      </form>
        </>
      )}
    </div>
  );
}

function UploadBtn({ label, file, onChange }) {
  return (
    <label className={`relative h-28 rounded-2xl border-2 overflow-hidden flex flex-col items-center justify-center cursor-pointer transition-colors ${file ? 'border-emerald-500 bg-emerald-50/50 border-solid' : 'border-slate-200 border-dashed hover:border-slate-300 bg-slate-50'}`}>
      <input type="file" accept="image/*" onChange={onChange} className="hidden" />
      {file ? (
        <div className="absolute inset-0 w-full h-full">
          <img src={URL.createObjectURL(file)} alt="Preview" className="w-full h-full object-cover opacity-80" />
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-emerald-900/30">
            <CheckCircle className="w-6 h-6 text-white mb-1 shadow-sm" />
            <span className="font-bold text-white text-xs drop-shadow-md">Captured</span>
          </div>
        </div>
      ) : (
        <>
          <Camera className="w-6 h-6 text-slate-400 mb-1.5" />
          <span className="font-medium text-slate-600 text-xs">{label}</span>
        </>
      )}
    </label>
  );
}
