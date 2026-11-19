import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, LogIn, LogOut, Camera, Loader2, CheckCircle2, X, AlertTriangle, UserCheck, Clock } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Camera as CapCamera, CameraResultType, CameraSource, CameraDirection } from "@capacitor/camera";
import { Geolocation } from "@capacitor/geolocation";
import dapi from "../../lib/driverApi";

const tm = (iso) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "—";
const hm = (h) => {
  const m = Math.round((Number(h) || 0) * 60);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

const DENIED_MSG =
  "Location permission is blocked. Allow Location for this app (phone Settings > Apps > MyEVRental > Permissions) and turn GPS on, then try again.";
const isDenied = (e) => !!e && (e.code === 1 || /denied|permission/i.test(e.message || ""));

// Current GPS position (native app + browser). Throws an Error with a driver-friendly message.
async function getPosition(timeout = 20000) {
  if (!Capacitor.isNativePlatform() && typeof window !== "undefined" && window.isSecureContext === false) {
    throw new Error("Location needs a secure (https) connection. Please open the app using its https:// link.");
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const p = await Geolocation.checkPermissions();
      if (p.location !== "granted") await Geolocation.requestPermissions();
    } catch (_) { /* the request below reports the real problem */ }
  }
  try {
    return await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout, maximumAge: 10000 });
  } catch (e1) {
    if (isDenied(e1)) throw new Error(DENIED_MSG);
    try {
      // GPS slow / unavailable -> fall back to network (Wi-Fi / mobile) positioning
      return await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
    } catch (e2) {
      if (isDenied(e2)) throw new Error(DENIED_MSG);
      throw new Error("Unable to get your location. Turn on GPS / Location in your phone settings and try again.");
    }
  }
}

export default function DriverAttendance() {
  const [att, setAtt] = useState(null);          // { geofence_enabled, record }
  const [mode, setMode] = useState(null);        // null | "in" | "out"
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef(null);
  const [, setTick] = useState(0);
  const ticking = !!att?.record?.check_in && !att?.record?.check_out;
  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  const load = useCallback(async () => {
    try {
      const { data } = await dapi.get("/driver/attendance/today");
      setAtt(data);
    } catch (_) {
      setAtt((a) => a || { geofence_enabled: true, record: null });
    }
  }, []);

  useEffect(() => {
    load();
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(load, 5 * 60 * 1000);   // new day while the app stays open
    return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(t); };
  }, [load]);

  // selfie preview url (revoked when replaced / closed)
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const openPopup = (m) => { setErr(""); setFile(null); setStep(""); setMode(m); };
  const closePopup = () => { if (!busy) { setMode(null); setFile(null); setErr(""); } };

  // ---- selfie (front camera) ----
  const pickSelfie = async () => {
    setErr("");
    if (Capacitor.isNativePlatform()) {
      try {
        const image = await CapCamera.getPhoto({
          quality: 70, width: 960, allowEditing: false, saveToGallery: false,
          resultType: CameraResultType.Uri, source: CameraSource.Prompt, direction: CameraDirection.Front,
          promptLabelHeader: "Upload Photo", promptLabelPicture: "Take Photo", promptLabelPhoto: "Upload Image", promptLabelCancel: "Cancel",
        });
        if (!image?.webPath) return;
        const blob = await (await fetch(image.webPath)).blob();
        const ext = image.format || "jpeg";
        setFile(new File([blob], `selfie_${Date.now()}.${ext}`, { type: blob.type || `image/${ext}` }));
      } catch (e) {
        if (!/cancel/i.test(e?.message || "")) setErr("Could not open the camera. Allow Camera permission for this app and try again.");
      }
    } else if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();   // mobile browsers show their Take Photo / Photo Library chooser
    }
  };

  const msgOf = (e, fallback) => {
    const d = e?.response?.data?.detail;
    return typeof d === "string" ? d : (e?.message && !e?.response ? e.message : fallback);
  };

  // ---- check in ----
  const submitIn = async () => {
    if (!file) return setErr("Please take your selfie first.");
    setBusy(true); setErr("");
    try {
      const geoOn = true;   // GPS is always required for check-in
      let pos = null;
      setStep("Getting your location…");
      try { pos = await getPosition(); }
      catch (e) { if (geoOn) throw e; }   // geofence OFF -> location is optional
      setStep(geoOn ? "Verifying location…" : "Checking in…");
      const fd = new FormData();
      fd.append("selfie", file);
      if (pos) {
        fd.append("lat", pos.coords.latitude);
        fd.append("lng", pos.coords.longitude);
        if (pos.coords.accuracy != null) fd.append("accuracy", pos.coords.accuracy);
      }
      await dapi.post("/driver/attendance/checkin", fd);
      setMode(null); setFile(null);
      await load();
    } catch (e) {
      if (e?.response?.data?.detail === "Already checked in") { setMode(null); await load(); }
      else setErr(msgOf(e, "Check-in failed. Please try again."));
    } finally { setBusy(false); setStep(""); }
  };

  // ---- check out ----
  const submitOut = async () => {
    setBusy(true); setErr("");
    try {
      let body = {};
      try {
        setStep("Getting your location…");
        const pos = await getPosition(10000);
        body = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      } catch (_) { /* check-out works without GPS */ }
      setStep("Checking out…");
      await dapi.post("/driver/attendance/checkout", body);
      setMode(null);
      await load();
    } catch (e) {
      if (e?.response?.data?.detail === "Already checked out") { setMode(null); await load(); }
      else setErr(msgOf(e, "Check-out failed. Please try again."));
    } finally { setBusy(false); setStep(""); }
  };

  if (!att) return null;
  const rec = att.record;
  const working = !!rec?.check_in && !rec?.check_out;
  const done = !!rec?.check_in && !!rec?.check_out;

  return (
    <>
      <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-4" data-testid="driver-attendance-card">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-slate-100 text-slate-500" : working ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"}`}>
            {done ? <CheckCircle2 className="w-6 h-6" /> : working ? <UserCheck className="w-6 h-6" /> : <MapPin className="w-6 h-6" />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-slate-900 text-sm">Attendance</h3>
            {done ? (
              <>
                <p className="text-xs text-slate-500 mt-0.5">In {tm(rec.check_in)} · Out {tm(rec.check_out)}</p>
                <p className="text-xs text-slate-700 font-semibold mt-1">Worked today: {hm(rec.hours)}</p>
              </>
            ) : working ? (
              <>
                <p className="text-xs text-emerald-600 font-medium mt-0.5">Checked in at {tm(rec.check_in)}</p>
                {rec.check_in_address && <p className="text-xs text-slate-500 mt-0.5 break-words">{rec.check_in_address}</p>}
                <p className="text-xs text-slate-800 font-semibold mt-1 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="font-mono tabular-nums" data-testid="driver-working-timer">{clock(Date.now() - new Date(rec.check_in).getTime())}</span>
                  <span className="font-medium text-slate-500">working</span>
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-500 mt-0.5">You haven't checked in today</p>
            )}
          </div>
          {!rec && (
            <button onClick={() => openPopup("in")} data-testid="driver-checkin-btn"
              className="h-10 px-4 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition-all shrink-0">
              <LogIn className="w-4 h-4" /> Check In
            </button>
          )}
          {working && (
            <button onClick={() => openPopup("out")} data-testid="driver-checkout-btn"
              className="h-10 px-4 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition-all shrink-0">
              <LogOut className="w-4 h-4" /> Check Out
            </button>
          )}
        </div>
      </div>

      {/* hidden camera input used by the browser version (the native app uses the Camera plugin) */}
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) { setErr(""); setFile(f); } }} />

      {mode && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center" onClick={closePopup}>
          <div className="w-full max-w-md bg-white rounded-t-[2rem] sm:rounded-[2rem] p-6 pb-8 relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={closePopup} disabled={busy} className="absolute right-4 top-4 p-1.5 text-slate-400 hover:text-slate-600 bg-slate-100 rounded-full disabled:opacity-40">
              <X className="w-5 h-5" />
            </button>

            {mode === "in" ? (
              <>
                <h2 className="text-xl font-extrabold text-slate-900 text-center">Check In</h2>
                <p className="text-slate-500 text-sm text-center mt-1">Take a selfie with your assigned vehicle, ensuring that your face is clearly visible.</p>

                <div className="mt-5 flex flex-col items-center">
                  <button type="button" onClick={pickSelfie} disabled={busy}
                    className="w-44 h-44 rounded-full overflow-hidden bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 active:scale-95 transition-all">
                    {preview ? <img src={preview} alt="Selfie" className="w-full h-full object-cover" /> : <Camera className="w-12 h-12" />}
                  </button>
                  <button type="button" onClick={pickSelfie} disabled={busy}
                    className="mt-3 text-sm font-bold text-red-600 hover:text-red-700 disabled:opacity-50">
                    {file ? "Change photo" : "Tap to upload photo"}
                  </button>
                </div>

                {/* <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-500">
                  <MapPin className="w-3.5 h-3.5" /> 
                </div> */}

                {err && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-left">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-amber-800 text-xs font-medium leading-relaxed">{err}</p>
                  </div>
                )}

                <button onClick={submitIn} disabled={busy || !file} data-testid="driver-checkin-submit"
                  className="mt-5 w-full h-12 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors">
                  {busy ? (<><Loader2 className="w-5 h-5 animate-spin" /> {step || "Please wait…"}</>) : (<><LogIn className="w-5 h-5" /> Check In</>)}
                </button>
              </>
            ) : (
              <>
                <h2 className="text-xl font-extrabold text-slate-900 text-center">Check Out</h2>
                <p className="text-slate-500 text-sm text-center mt-1">
                  You checked in at {tm(rec?.check_in)}. Do you want to end your day now?
                </p>

                {err && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-left">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-amber-800 text-xs font-medium leading-relaxed">{err}</p>
                  </div>
                )}

                <div className="mt-6 flex gap-3">
                  <button onClick={closePopup} disabled={busy}
                    className="flex-1 h-12 rounded-2xl border border-slate-200 text-slate-600 font-bold disabled:opacity-50">Cancel</button>
                  <button onClick={submitOut} disabled={busy} data-testid="driver-checkout-submit"
                    className="flex-1 h-12 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors">
                    {busy ? (<><Loader2 className="w-5 h-5 animate-spin" /> {step || "Please wait…"}</>) : (<><LogOut className="w-5 h-5" /> Check Out</>)}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
