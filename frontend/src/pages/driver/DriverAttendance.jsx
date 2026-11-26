import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, LogIn, LogOut, Camera, Loader2, CheckCircle2, X, AlertTriangle, UserCheck, Clock, ArrowRight, ChevronsRight } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Camera as CapCamera, CameraResultType, CameraSource, CameraDirection } from "@capacitor/camera";
import { Geolocation } from "@capacitor/geolocation";
import dapi from "../../lib/driverApi";
import { useDriver } from "../../context/DriverAuthContext";

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

// "Slide to ..." control. Dragging the knob to the end calls onDone (mouse, touch and pen; Enter / Space also work).
function SlideButton({ label, hint, onDone, testId }) {
  const trackRef = useRef(null);
  const startX = useRef(0);
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(false);
  const KNOB = 48, PAD = 4;
  const maxX = () => Math.max(1, (trackRef.current?.offsetWidth || 0) - KNOB - PAD * 2);
  const ratio = Math.min(1, x / maxX());
  const reset = () => { setDrag(false); setX(0); };

  const down = (e) => {
    startX.current = e.clientX - x;
    setDrag(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
  };
  const move = (e) => { if (drag) setX(Math.min(maxX(), Math.max(0, e.clientX - startX.current))); };
  const up = () => {
    if (!drag) return;
    if (x >= maxX() * 0.85) { setDrag(false); setX(maxX()); onDone(); setTimeout(reset, 350); }
    else reset();
  };

  return (
    // stop touches here so the app's swipe-between-tabs does not fire while sliding
    <div className="mt-5" onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
      <div ref={trackRef} className="relative h-14 overflow-hidden select-none"
        style={{ borderRadius: 9999, background: "linear-gradient(90deg, #b91c1c 0%, #7f1d1d 100%)", border: "1px solid #7f1d1d", boxShadow: "inset 0 1px 3px rgba(127,29,29,0.12)" }}>
        <div className="absolute inset-y-0 left-0"
          style={{ borderRadius: 9999, background: "linear-gradient(90deg, #b91c1c 0%, #7f1d1d 100%)", width: x > 0 ? x + KNOB + PAD * 2 : 0, transition: drag ? "none" : "width 0.25s ease" }} />
        <span className="absolute inset-0 flex items-center justify-center pl-12 text-sm font-bold pointer-events-none"
          style={{ color: "#ffffff", transition: "color 0.15s" }}>{ratio > 0.85 ? hint : label}</span>
        <ChevronsRight className="absolute right-4 w-6 h-6 pointer-events-none"
          style={{ top: "50%", transform: "translateY(-50%)", color: "#fca5a5", opacity: 1 - ratio }} />
        <div role="button" tabIndex={0} aria-label={label} data-testid={testId}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={reset}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDone(); } }}
          className="absolute top-1 w-12 h-12 flex items-center justify-center cursor-grab active:cursor-grabbing"
          style={{
            left: PAD + x, touchAction: "none", transition: drag ? "none" : "left 0.25s ease",
            borderRadius: 9999, color: "#7f1d1d", border: "2px solid #ffffff",
            background: "linear-gradient(135deg, #ffe4e4 0%, #f5b5b5 100%)",
            boxShadow: "0 4px 12px rgba(127,29,29,0.35)",
          }}>
          <ArrowRight className="w-6 h-6" strokeWidth={3} />
        </div>
      </div>
    </div>
  );
}

// Day (IST) on which the driver closed the check-in pop-up. Kept outside the component so it survives
// switching between the app's tabs; it resets when the app is closed, and a new day shows the pop-up again.
let lastDismissedCheckInDay = null;

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
      setAtt((a) => a || { geofence_enabled: true, record: null, failed: true });
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
  // Daily check-in lock: until today's check-in is done the check-in pop-up stays open and cannot be closed.
  // (Not enforced if today's status could not be loaded, or while the week-off / blocked lock screen is showing.)
  const { data: driverData, refresh: refreshDriver } = useDriver();
  const lockedElsewhere = !!driverData?.admin_block || !!driverData?.week_off?.locked;
  // Today's check-in status comes from /driver/me (the app re-reads it every 20 s and whenever it is reopened);
  // the attendance request is only the fallback if the server does not send it.
  const meSays = driverData?.checked_in_today;
  const [doneToday, setDoneToday] = useState(false);   // set right after a successful check-in
  useEffect(() => { setDoneToday(false); if (typeof meSays === "boolean") load(); }, [meSays, load]);   // new day -> reload the card too
  const mustCheckIn = !lockedElsewhere && !doneToday && !!driverData &&
    (typeof meSays === "boolean" ? !meSays : (!!att && !att.failed && !att.record));
  // The driver may close the check-in pop-up (X) and use the app without checking in.
  // It stays closed for the rest of today and shows again on a new day.
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [dismissedDay, setDismissedDay] = useState(lastDismissedCheckInDay);
  const autoOpen = mustCheckIn && dismissedDay !== todayKey;
  const popup = mode || (autoOpen ? "in" : null);
  const closePopup = () => {
    if (busy) return;
    lastDismissedCheckInDay = todayKey;
    setDismissedDay(todayKey);
    setMode(null); setFile(null); setErr("");
  };

  // ---- selfie (front camera) ----
  const pickSelfie = async () => {
    setErr("");
    if (Capacitor.isNativePlatform()) {
      try {
        const image = await CapCamera.getPhoto({
          quality: 70, width: 960, allowEditing: false, saveToGallery: false,
          resultType: CameraResultType.DataUrl, source: CameraSource.Prompt, direction: CameraDirection.Front,
          promptLabelHeader: "Upload Photo", promptLabelPicture: "Take Photo", promptLabelPhoto: "Upload Image", promptLabelCancel: "Cancel",
        });
        if (!image?.dataUrl) return;
        const [head, b64] = image.dataUrl.split(",");
        const mime = (head.match(/:(.*?);/) || [])[1] || "image/jpeg";
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const ext = image.format || "jpeg";
        setFile(new File([bytes], `selfie_${Date.now()}.${ext}`, { type: mime }));
      } catch (e) {
        if (!/cancel/i.test(e?.message || "")) setErr(`Could not open the camera. ${e?.message || "Allow Camera permission for this app and try again."}`);
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
      const { data: saved } = await dapi.post("/driver/attendance/checkin", fd);
      if (saved) setAtt((a) => ({ ...(a || { geofence_enabled: true }), record: saved, failed: false }));   // pop-up closes right away
      setMode(null); setFile(null); setDoneToday(true);
      await load();
      await refreshDriver();
    } catch (e) {
      if (e?.response?.data?.detail === "Already checked in") {
        setAtt((a) => ({ ...(a || { geofence_enabled: true }), record: (a && a.record) || { check_in: new Date().toISOString() }, failed: false }));
        setMode(null); setDoneToday(true); await load();
        await refreshDriver();
      }
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
      <div className="rounded-[1.5rem] bg-white border border-slate-100 shadow-md p-5"
        style={{
          borderRadius: "1.5rem",
          // ...(working ? { background: "linear-gradient(160deg, #d1fae5 0%, #ecfdf5 38%, #ffffff 75%)", borderColor: "#bbf7d0" } : {}),
        }}
        data-testid="driver-attendance-card">
        <div className="flex items-center gap-4"
          style={{
            flexDirection: "row-reverse",
            ...((working || done) ? { margin: "-20px -20px 0", padding: "20px 20px 12px", borderRadius: "1.5rem 1.5rem 0 0", background: "linear-gradient(180deg, #d1fae5 0%, #ecfdf5 65%, #ffffff 100%)" } : {}),
          }}>
          <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-emerald-100 text-emerald-600" : working ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"}`}>
            {done ? <CheckCircle2 className="w-7 h-7" /> : working ? <UserCheck className="w-7 h-7" /> : <MapPin className="w-7 h-7" />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-extrabold text-slate-900 text-base">Attendance</h3>
            {done ? (
              <p className="text-sm text-slate-500 mt-0.5">In {tm(rec.check_in)} · Out {tm(rec.check_out)}</p>
            ) : working ? (
              <p className="text-sm text-emerald-600 font-medium mt-0.5">Checked in at {tm(rec.check_in)}</p>
            ) : (
              <p className="text-sm text-slate-500 mt-0.5">You haven't checked in today</p>
            )}
          </div>
        </div>

        {/* location + working time */}
        {(working || done) && (
          <div className="mt-4 space-y-2.5">
            {rec.check_in_address && (
              <div className="flex items-start gap-2 text-sm text-slate-600">
                <MapPin className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span className="break-words">{rec.check_in_address}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-slate-800 font-semibold">
              <Clock className="w-4 h-4 text-emerald-600 shrink-0" />
              {working ? (
                <>
                  <span className="font-mono tabular-nums" data-testid="driver-working-timer">{clock(Date.now() - new Date(rec.check_in).getTime())}</span>
                  <span className="font-medium text-slate-500">working</span>
                </>
              ) : (
                <span>Worked today: {hm(rec.hours)}</span>
              )}
            </div>
          </div>
        )}

        {/* slide to check in / check out (opens the same selfie / confirm pop-ups as before) */}
        {!rec && <SlideButton label="Slide to Check In" hint="Release to check in" onDone={() => openPopup("in")} testId="driver-checkin-btn" />}
        {working && <SlideButton label="Slide to Check Out" hint="Release to check out" onDone={() => openPopup("out")} testId="driver-checkout-btn" />}
      </div>

      {/* hidden camera input used by the browser version (the native app uses the Camera plugin) */}
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) { setErr(""); setFile(f); } }} />

      {popup && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center overscroll-contain"
          role="dialog" aria-modal="true" data-testid="driver-checkin-popup"
          onClick={closePopup}
          onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
          <div className="w-full max-w-md bg-white rounded-t-[2rem] sm:rounded-[2rem] p-6 pb-8 relative max-h-[92dvh] overflow-y-auto"
            style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
            <button onClick={closePopup} disabled={busy} aria-label="Close" data-testid="driver-checkin-close"
              className="absolute right-4 top-4 p-1.5 text-slate-400 hover:text-slate-600 bg-slate-100 rounded-full disabled:opacity-40">
              <X className="w-5 h-5" />
            </button>

            {popup === "in" ? (
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
