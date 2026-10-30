import { useState, useEffect, useRef } from "react";
import {
  User, Bike, Package, Wallet, ShieldCheck, LogOut, Phone, MapPin, Camera,
  Loader2, X, ChevronRight, Copy, Check, CheckCircle2, AlertCircle, Calendar,
  Zap, Gauge, LifeBuoy, FileText, Sparkles, ExternalLink, ShieldAlert
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useDriver } from "../../context/DriverAuthContext";
import { inr, fmtDate } from "../../lib/format";
import dapi from "../../lib/driverApi";
import imgUrl from "../../lib/imgUrl";
import { useNativeCamera } from "../../hooks/useNativeCamera";

const STATUS_CONFIG = {
  active: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
    label: "Active"
  },
  overdue: {
    bg: "bg-amber-500/10",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-500",
    label: "Overdue"
  },
  blocked: {
    bg: "bg-red-500/10",
    text: "text-red-700",
    border: "border-red-200",
    dot: "bg-red-500",
    label: "Blocked"
  },
};

const getPackageBadge = (packageName = "") => {
  const name = packageName.toLowerCase();
  if (name.includes("executive")) {
    return {
      gradient: "from-purple-600 to-indigo-700",
      pill: "bg-purple-100 text-purple-700 border-purple-200",
      tag: "Executive Tier"
    };
  }
  if (name.includes("premium") || name.includes("gold")) {
    return {
      gradient: "from-amber-500 to-yellow-600",
      pill: "bg-amber-100 text-amber-800 border-amber-200",
      tag: "Premium Tier"
    };
  }
  if (name.includes("economy") || name.includes("silver")) {
    return {
      gradient: "from-emerald-500 to-teal-600",
      pill: "bg-emerald-100 text-emerald-800 border-emerald-200",
      tag: "Economy Tier"
    };
  }
  return {
    gradient: "from-slate-700 to-slate-900",
    pill: "bg-slate-100 text-slate-800 border-slate-200",
    tag: "Standard Plan"
  };
};

export default function DriverProfile() {
  const { data, logout } = useDriver();
  const nav = useNavigate();
  const [copiedCode, setCopiedCode] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  if (!data) return null;
  const { driver, rental, account, deposit } = data;

  const doLogout = async () => {
    await logout();
    nav("/driver/login");
  };

  const copyDriverCode = () => {
    const code = driver.driver_code || driver.id || "";
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    toast.success("Driver code copied to clipboard");
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const accountStatus = account?.status || "active";
  const statusCfg = STATUS_CONFIG[accountStatus] || STATUS_CONFIG.active;
  const pkgName = rental?.package_name || driver.package_name || "Standard";
  const pkgCfg = getPackageBadge(pkgName);

  // Driver initials for the avatar fallback
  const initials = (driver.name || "D")
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const isKycApproved = driver.kyc_status === "approved";

  return (
    <div className="px-4 pt-4 pb-24 space-y-4 max-w-lg mx-auto" data-testid="driver-profile">
      {/* ─── LUXE HERO HEADER CARD ─────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 text-white p-6 shadow-xl shadow-emerald-950/20 border border-emerald-500/20">
        {/* Ambient blurred glow in corner */}
        <div className="absolute -top-12 -right-12 w-44 h-44 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-teal-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center text-center">
          {/* Avatar Ring */}
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 via-teal-500 to-emerald-600 p-1 shadow-lg shadow-emerald-900/40">
              <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center border-2 border-emerald-400/40">
                <span className="text-2xl font-black text-emerald-300 tracking-wider">
                  {initials}
                </span>
              </div>
            </div>
            {/* Status dot indicator */}
            <div
              className={`absolute bottom-1 right-1 w-5 h-5 rounded-full border-2 border-slate-900 ${statusCfg.dot} shadow-sm ring-2 ring-emerald-400/30`}
              title={statusCfg.label}
            />
          </div>

          {/* Driver Name & Verification */}
          <div className="mt-3.5">
            <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center justify-center gap-2">
              {driver.name}
            </h1>

            {/* KYC Badge */}
            <div className="mt-1 flex items-center justify-center gap-2 flex-wrap">
              {isKycApproved ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 backdrop-blur-md">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> KYC Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 backdrop-blur-md">
                  <AlertCircle className="w-3 h-3 text-amber-400" /> KYC {driver.kyc_status || "Pending"}
                </span>
              )}

              {driver.driver_code && (
                <button
                  type="button"
                  onClick={copyDriverCode}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-white/10 hover:bg-white/20 text-slate-200 border border-white/15 transition-all active:scale-95"
                  title="Click to copy driver code"
                >
                  {driver.driver_code}
                  {copiedCode ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-slate-400" />
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Contact & Location Strip */}
          <div className="mt-4 flex items-center justify-center gap-3 text-xs text-slate-300 flex-wrap">
            <a
              href={`tel:${driver.phone}`}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
            >
              <Phone className="w-3 h-3 text-emerald-400" /> {driver.phone}
            </a>
            {driver.city && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white/5 border border-white/10 text-slate-300">
                <MapPin className="w-3 h-3 text-teal-400" /> {driver.city}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ─── METRIC HIGHLIGHTS ROW (3 COLUMNS) ─────────────────────────── */}
      <div className="grid grid-cols-3 gap-2.5">
        {/* Status */}
        <div className="rounded-2xl bg-white border border-slate-100 p-3 shadow-sm text-center">
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Status</div>
          <div className="mt-1 flex items-center justify-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${statusCfg.dot}`} />
            <span className={`text-sm font-bold capitalize ${statusCfg.text}`}>
              {statusCfg.label}
            </span>
          </div>
        </div>

        {/* Monthly KMs */}
        <div className="rounded-2xl bg-white border border-slate-100 p-3 shadow-sm text-center">
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">This Month</div>
          <div className="mt-1 text-sm font-bold text-slate-900 flex items-center justify-center gap-1">
            <Zap className="w-3.5 h-3.5 text-emerald-600" />
            <span>{driver.current_month_kms || 0}</span>
            <span className="text-[11px] font-normal text-slate-400">km</span>
          </div>
        </div>

        {/* Leaves */}
        <div className="rounded-2xl bg-white border border-slate-100 p-3 shadow-sm text-center">
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Leaves Used</div>
          <div className="mt-1 text-sm font-bold text-slate-900 flex items-center justify-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-teal-600" />
            <span>{driver.leaves_taken_this_month || 0}</span>
            <span className="text-[11px] font-normal text-slate-400">/ {driver.leave_quota || 3}</span>
          </div>
        </div>
      </div>

      {/* ─── ASSIGNED EV & PACKAGE CARD ────────────────────────────────── */}
      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Bike className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Assigned Vehicle</div>
              <div className="text-sm font-extrabold text-slate-900">
                {rental?.vehicle_reg || driver.vehicle_reg || "No Vehicle Assigned"}
              </div>
            </div>
          </div>

          {/* Vehicle License Plate if different */}
          {driver.vehicle_plate && driver.vehicle_plate !== (rental?.vehicle_reg || driver.vehicle_reg) && (
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-mono font-semibold border border-slate-200">
              {driver.vehicle_plate}
            </span>
          )}
        </div>

        <div className="h-px bg-slate-100" />

        {/* Package Plan Detail */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400 tracking-wider">Current Package</div>
              <div className="text-sm font-extrabold text-slate-900">{pkgName}</div>
            </div>
          </div>

          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${pkgCfg.pill}`}>
            {pkgCfg.tag}
          </span>
        </div>

        {rental && (
          <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
            <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
              <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Daily Rate</span>
              <span className="text-slate-800 font-extrabold text-sm">{inr(rental.daily_rate || 0)} / day</span>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
              <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">Daily Limit</span>
              <span className="text-slate-800 font-extrabold text-sm">{rental.daily_limit_km ? `${rental.daily_limit_km} km` : "Unlimited"}</span>
            </div>
          </div>
        )}
      </div>

      {/* ─── FINANCIAL OVERVIEW & DEPOSIT ──────────────────────────────── */}
      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-slate-900">Financial Summary</span>
          </div>

          {/* Outstanding indicator */}
          {(account?.outstanding_amount || 0) > 0 ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200">
              Dues: {inr(account.outstanding_amount)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Check className="w-3 h-3 text-emerald-600" /> Dues Clear
            </span>
          )}
        </div>

        <div className="divide-y divide-slate-100 pt-1">
          {/* Security Deposit row */}
          {rental?.package_category !== "commission" && rental?.package_category !== "salary" && (
            <div className="py-2.5 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500 font-medium">Security Deposit</div>
                <div className="text-sm font-extrabold text-slate-900">{inr(deposit?.amount ?? 0)}</div>
              </div>
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-semibold capitalize ${
                  deposit?.status === "paid"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : deposit?.status === "partial"
                    ? "bg-amber-50 text-amber-700 border border-amber-200"
                    : "bg-slate-100 text-slate-600 border border-slate-200"
                }`}
              >
                {deposit?.status === "paid"
                  ? "✓ Fully Paid"
                  : deposit?.status === "partial"
                  ? `Partial · Due ${deposit.next_payment_date || "Soon"}`
                  : "Pending"}
              </span>
            </div>
          )}

          {/* Today's Rent Status */}
          <div className="py-2.5 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500 font-medium">Today's Rent</div>
              <div className="text-sm font-extrabold text-slate-900">
                {account?.today_paid ? "Settled" : inr(rental?.daily_rate || 0)}
              </div>
            </div>
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                account?.today_paid
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-amber-50 text-amber-700 border border-amber-200"
              }`}
            >
              {account?.today_paid ? "✓ Paid Today" : "Payment Pending"}
            </span>
          </div>
        </div>
      </div>

      {/* ─── QUICK NAVIGATION TILES ─────────────────────────────────────── */}
      <div className="rounded-3xl bg-white border border-slate-100 p-2 shadow-sm divide-y divide-slate-50">
        <button
          type="button"
          onClick={() => nav("/driver/payments")}
          className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 rounded-2xl transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-800">Payments & Receipts</div>
              <div className="text-xs text-slate-400">View transaction history and download receipts</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={() => nav("/driver/week-off")}
          className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 rounded-2xl transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-800">Week-off & Schedules</div>
              <div className="text-xs text-slate-400">Check weekly off days and leave status</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        <a
          href="tel:+919994499143"
          className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 rounded-2xl transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <LifeBuoy className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-800">Support & Helpline</div>
              <div className="text-xs text-slate-400">Call Route39 operations team for help</div>
            </div>
          </div>
          <ExternalLink className="w-4 h-4 text-slate-400" />
        </a>
      </div>

      {/* ─── ODOMETER IMAGE UPLOADS ────────────────────────────────────── */}
      <OdometerImageUpload />

      {/* ─── LOGOUT BUTTON ──────────────────────────────────────────────── */}
      <button
        onClick={() => setShowLogoutConfirm(true)}
        data-testid="driver-logout-btn"
        className="w-full h-12 rounded-2xl border border-red-200 bg-red-50/50 hover:bg-red-50 text-red-600 font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
      >
        <LogOut className="w-4 h-4" /> Log Out
      </button>

      {/* Logout Confirmation Dialog */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xs rounded-3xl bg-white p-6 shadow-2xl space-y-4 border border-slate-100 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900">Log out of MyVolt?</h3>
              <p className="text-xs text-slate-500 mt-1">
                You will need your registered mobile number and OTP to sign in again.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="h-11 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doLogout}
                className="h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm shadow-sm shadow-red-200"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── BRAND FOOTNOTE ────────────────────────────────────────────── */}
      <div className="text-center pt-2 pb-4">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          MyVolt EV Fleet Platform
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">Route39 Mobility Systems · v2.4</p>
      </div>
    </div>
  );
}

// ─── ODOMETER IMAGE UPLOAD COMPONENT ─────────────────────────────────────────
function OdometerImageUpload() {
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState([]); // [{ file, preview }] chosen but not submitted yet
  const [viewingImage, setViewingImage] = useState(null); // Lightbox popup
  const [deletingId, setDeletingId] = useState(null);
  const inputRef = useRef(null);
  const { captureImage, loading: camLoading } = useNativeCamera();

  const onTakeOrChoose = async () => {
    const f = await captureImage();
    if (f) setSelected((prev) => [...prev, { file: f, preview: URL.createObjectURL(f) }]);
  };

  const loadImages = async () => {
    try {
      const { data } = await dapi.get("/driver/odometer-images");
      setImages(data.images || []);
    } catch (e) {
      /* ignore */
    }
  };

  useEffect(() => {
    loadImages();
  }, []);

  const onPick = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setSelected((prev) => [...prev, ...files.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))]);
  };

  const removeSelected = (idx) => {
    setSelected((prev) => {
      if (prev[idx]) URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const onSubmit = async () => {
    if (!selected.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      selected.forEach((s) => fd.append("images", s.file));
      await dapi.post("/driver/odometer-images", fd);
      toast.success("Odometer photo submitted successfully");
      selected.forEach((s) => URL.revokeObjectURL(s.preview));
      setSelected([]);
      loadImages();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id) => {
    if (!window.confirm("Delete this odometer photo?")) return;
    setDeletingId(id);
    try {
      await dapi.delete(`/driver/odometer-images/${id}`);
      setImages((prev) => prev.filter((x) => x.id !== id));
      toast.success("Image deleted");
      if (viewingImage?.id === id) setViewingImage(null);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not delete the image.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3.5" data-testid="driver-odometer-images">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Camera className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">Odometer Submissions</div>
            <div className="text-xs text-slate-400">Daily verification photos</div>
          </div>
        </div>

        {images.length > 0 && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {images.length} {images.length === 1 ? "photo" : "photos"}
          </span>
        )}
      </div>

      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={onPick} />

      {/* Camera / Upload Action Button */}
      <button
        type="button"
        onClick={onTakeOrChoose}
        disabled={uploading || camLoading}
        className="w-full h-12 rounded-2xl border-2 border-dashed border-emerald-200 hover:border-emerald-500 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-700 font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.99] disabled:opacity-60"
      >
        <Camera className="w-4 h-4 text-emerald-600" />
        <span>Take Photo / Choose Image</span>
      </button>

      {/* Selected previews ready to submit */}
      {selected.length > 0 && (
        <div className="pt-2 space-y-3">
          <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Ready to Submit ({selected.length})
          </div>
          <div className="grid grid-cols-3 gap-2">
            {selected.map((s, i) => (
              <div key={s.preview} className="relative aspect-square rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shadow-sm">
                <img src={s.preview} alt="Selected preview" className="w-full h-full object-cover" />
                {!uploading && (
                  <button
                    type="button"
                    onClick={() => removeSelected(i)}
                    aria-label="Remove photo"
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/80 text-white text-xs font-bold flex items-center justify-center shadow-md active:scale-90"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={onSubmit}
            disabled={uploading}
            className="w-full h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-2 shadow-sm shadow-emerald-200 transition-all active:scale-[0.99] disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" /> Submit {selected.length} {selected.length === 1 ? "Photo" : "Photos"}
              </>
            )}
          </button>
        </div>
      )}

      {/* Uploaded Gallery Grid */}
      {images.length > 0 ? (
        <div className="pt-2">
          <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
            Submitted Photos
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {images.map((im) => (
              <div
                key={im.id}
                className="group relative aspect-square rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shadow-sm cursor-pointer"
                onClick={() => setViewingImage(im)}
              >
                <img
                  src={imgUrl(im.url)}
                  alt="Odometer"
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />

                {/* Date overlay */}
                {im.created_at && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/80 via-slate-900/40 to-transparent p-1.5 text-[9px] text-white font-medium truncate">
                    {fmtDate(im.created_at)}
                  </div>
                )}

                {/* Delete button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(im.id);
                  }}
                  disabled={deletingId === im.id}
                  aria-label="Delete image"
                  data-testid="driver-odometer-delete-btn"
                  className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full bg-slate-900/80 hover:bg-red-600 text-white flex items-center justify-center shadow-md transition-colors"
                >
                  {deletingId === im.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <X className="w-3 h-3" strokeWidth={2.5} />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="py-4 text-center text-xs text-slate-400 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
          No odometer photos uploaded yet. Tap above to take today's reading.
        </div>
      )}

      {/* Lightbox / Full-screen Photo Modal */}
      {viewingImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setViewingImage(null)}
        >
          <div
            className="relative max-w-sm w-full bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative aspect-square bg-black">
              <img
                src={imgUrl(viewingImage.url)}
                alt="Full Odometer"
                className="w-full h-full object-contain"
              />
              <button
                type="button"
                onClick={() => setViewingImage(null)}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex items-center justify-between text-white text-xs">
              <span className="text-slate-300">
                {viewingImage.created_at ? fmtDate(viewingImage.created_at) : "Submitted Photo"}
              </span>

              <button
                type="button"
                onClick={() => onDelete(viewingImage.id)}
                className="text-red-400 hover:text-red-300 font-semibold flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
