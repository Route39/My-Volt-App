import { useState, useEffect, useRef } from "react";
import { User, Bike, Package, Wallet, ShieldCheck, LogOut, Phone, MapPin, Camera, Loader2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useDriver } from "../../context/DriverAuthContext";
import { inr } from "../../lib/format";
import dapi from "../../lib/driverApi";
import imgUrl from "../../lib/imgUrl";
import { useNativeCamera } from "../../hooks/useNativeCamera";

const STATUS_UI = {
  active: "text-emerald-600", overdue: "text-amber-600", blocked: "text-red-600",
};

export default function DriverProfile() {
  const { data, logout } = useDriver();
  const nav = useNavigate();
  if (!data) return null;
  const { driver, rental, account, deposit } = data;

  const doLogout = async () => { await logout(); nav("/driver/login"); };

  return (
    <div className="px-5 pt-6 space-y-5" data-testid="driver-profile">
      <div className="flex flex-col items-center">
        <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
          <User className="w-10 h-10 text-emerald-600" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-900 mt-3">{driver.name}</h1>
        <div className="flex items-center gap-4 mt-1">
          <div className="flex items-center gap-1.5 text-slate-500 text-sm"><Phone className="w-3.5 h-3.5" /> {driver.phone}</div>
          {driver.city && <div className="flex items-center gap-1.5 text-slate-500 text-sm"><MapPin className="w-3.5 h-3.5" /> {driver.city}</div>}
        </div>
      </div>

      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3">
        <Row icon={Bike} label="Vehicle" value={rental?.vehicle_reg || driver.vehicle_reg || "—"} />
        <Row icon={Package} label="Package" value={rental ? ((rental.package_category === "commission" || rental.package_category === "salary") ? rental.package_name : `${rental.package_name} · ${inr(rental.daily_rate)}/day`) : "—"} />
        {rental?.package_category !== "commission" && rental?.package_category !== "salary" && (
          <Row icon={Wallet} label="Security Deposit" value={`${inr(deposit?.amount ?? 0)} · ${deposit?.status === "paid" ? "Paid" : deposit?.status === "partial" ? "Partially paid" : "Pending"}`} />
        )}
        <Row icon={ShieldCheck} label="Account Status"
          value={<span className={`font-bold uppercase ${STATUS_UI[account?.status || "active"]}`}>{account?.status || "active"}</span>} />
        <Row label="Outstanding" value={inr(account?.outstanding_amount || 0)} />
      </div>

      <OdometerImageUpload />

      <button onClick={doLogout} data-testid="driver-logout-btn"
        className="w-full h-12 rounded-2xl border border-slate-200 text-red-600 font-semibold flex items-center justify-center gap-2 hover:bg-red-50 transition-colors">
        <LogOut className="w-4 h-4" /> Log Out
      </button>
      <p className="text-center text-xs text-slate-400 pt-2">MyEVRental · powered by MyVolt</p>
    </div>
  );
}

// Driver can upload any number of odometer images, any time. Admin / city manager see them
// in the admin driver profile -> "Odometer Image" tab.
function OdometerImageUpload() {
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState([]); // [{ file, preview }] chosen but not submitted yet
  const inputRef = useRef(null);
  const { captureImage, loading: camLoading } = useNativeCamera();

  // same camera / gallery chooser as the KYC upload: the phone asks "Take photo" or "From gallery"
  const onTakeOrChoose = async () => {
    const f = await captureImage();
    if (f) setSelected((prev) => [...prev, { file: f, preview: URL.createObjectURL(f) }]);
  };

  const loadImages = async () => {
    try {
      const { data } = await dapi.get("/driver/odometer-images");
      setImages(data.images || []);
    } catch (e) { /* list is optional - ignore */ }
  };
  useEffect(() => { loadImages(); }, []);

  // Picking a photo only selects it (nothing is uploaded yet) - the driver must tap "Submit"
  const onPick = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allows picking the same photo again later
    if (!files.length) return;
    setSelected((prev) => [...prev, ...files.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))]);
  };

  const removeSelected = (idx) => {
    setSelected((prev) => {
      if (prev[idx]) URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  // Upload only happens here, when the driver taps "Submit"
  const onSubmit = async () => {
    if (!selected.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      selected.forEach((s) => fd.append("images", s.file));
      await dapi.post("/driver/odometer-images", fd);
      toast.success("Image uploaded successfully");
      selected.forEach((s) => URL.revokeObjectURL(s.preview));
      setSelected([]);
      loadImages();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  // Delete an already-submitted image
  const [deletingId, setDeletingId] = useState(null);
  const onDelete = async (id) => {
    if (!window.confirm("Delete this image?")) return;
    setDeletingId(id);
    try {
      await dapi.delete(`/driver/odometer-images/${id}`);
      setImages((prev) => prev.filter((x) => x.id !== id));
      toast.success("Image deleted");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not delete the image.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm" data-testid="driver-odometer-images">
      <div className="text-sm font-bold text-slate-900">Upload odometer image</div>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={onPick} />
      <button type="button" onClick={onTakeOrChoose} disabled={uploading || camLoading}
        className="mt-3 w-full h-12 rounded-2xl border-2 border-dashed border-slate-200 hover:border-emerald-400 bg-slate-50 text-slate-600 font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
        <Camera className="w-4 h-4" />
        Choose / take photo
      </button>
      {selected.length > 0 && (
        <div className="mt-4">
          <div className="grid grid-cols-3 gap-2">
            {selected.map((s, i) => (
              <div key={s.preview} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100">
                <img src={s.preview} alt="Selected" className="w-full h-full object-cover" />
                {!uploading && (
                  <button type="button" onClick={() => removeSelected(i)} aria-label="Remove photo"
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/70 text-white text-xs font-bold flex items-center justify-center">×</button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={onSubmit} disabled={uploading}
            className="mt-3 w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
            {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
            {uploading ? "Uploading..." : `Submit${selected.length > 1 ? ` (${selected.length})` : ""}`}
          </button>
        </div>
      )}
      {images.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {images.map((im) => (
            <div key={im.id} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100">
              <a href={imgUrl(im.url)} target="_blank" rel="noreferrer" className="block w-full h-full">
                <img src={imgUrl(im.url)} alt="Odometer" className="w-full h-full object-cover" />
              </a>
              <button type="button" onClick={() => onDelete(im.id)} disabled={deletingId === im.id}
                aria-label="Delete image" data-testid="driver-odometer-delete-btn"
                className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-red-300 border-2 border-white shadow-md text-white flex items-center justify-center disabled:opacity-60">
                {deletingId === im.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-2 h-2" strokeWidth={3} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-slate-500 text-sm">{Icon && <Icon className="w-4 h-4" />}{label}</span>
      <span className="font-semibold text-slate-800 text-sm text-right">{value}</span>
    </div>
  );
}
