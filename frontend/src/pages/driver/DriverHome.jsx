import { useState, useEffect, useRef } from "react";
import { Bike, Wallet, ArrowRight, ShieldCheck, AlertTriangle, Lock, FileBadge, XCircle, Camera, CheckCircle, Loader2, Ticket, Calendar } from "lucide-react";
import { useDriver } from "../../context/DriverAuthContext";
import { inr } from "../../lib/format";
import dapi from "../../lib/driverApi";
import PayModal from "./PayModal";
import BlockedScreen from "./BlockedScreen";
import CatchupScreen from "./CatchupScreen";
import { useNavigate } from "react-router-dom";
import { useNativeCamera } from "../../hooks/useNativeCamera";

const STATUS_UI = {
  active: { dot: "bg-emerald-500", label: "Active", text: "text-emerald-600" },
  overdue: { dot: "bg-amber-500", label: "Overdue", text: "text-amber-600" },
  blocked: { dot: "bg-red-500", label: "Blocked", text: "text-red-600" },
};

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
};

export default function DriverHome() {
  const { data, refresh } = useDriver();
  const { captureImage, loading: camLoading } = useNativeCamera();
  const nav = useNavigate();
  const [pay, setPay] = useState(null);
  const [hideApproved, setHideApproved] = useState(false);
  const isApprovedHidden = hideApproved || data?.driver?.kyc_approved_seen;
  const [showEndModal, setShowEndModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveDate, setLeaveDate] = useState("");
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveError, setLeaveError] = useState(null);
  
  // Odometer State
  const [odoReading, setOdoReading] = useState("");
  const [odoImage, setOdoImage] = useState(null);
  const [odoLoading, setOdoLoading] = useState(false);
  const [odoError, setOdoError] = useState("");
  // const [promptPayAfterTrip, setPromptPayAfterTrip] = useState(false);

  // // After a trip ends, auto-open the "pay daily rent" popup if rent is due
  // useEffect(() => {
  //   if (promptPayAfterTrip && data && !data.driver?.active_trip_id) {
  //     if ((data.account?.outstanding_amount || 0) > 0) setPay("daily");
  //     setPromptPayAfterTrip(false);
  //   }
  // }, [promptPayAfterTrip, data]);  
  // Safe extraction for initial hook state
  const kycStatus = data?.driver?.kyc_status;
  const [showKycModal, setShowKycModal] = useState(false);
  // After a trip ends (or whenever the driver is between trips with dues pending),
  // auto-open the payment popup. Extra KM charges from the completed trip must be
  // cleared first; only once those are settled does the daily rent popup for the
  // upcoming trip appear. Only after both are paid can the next trip be started.
  //
  // dismissedRef remembers which exact charge (kind + amounts) the driver has
  // already closed with "X", so this effect won't immediately reopen the same
  // popup. It only re-opens automatically again if the charge itself changes
  // (e.g. a new due amount, or a different kind becomes due).
  const dismissedRef = useRef({ kind: null, rentDue: null, extraKmDue: null });
  useEffect(() => {
    if (!data) return;
    if (data.driver?.active_trip_id) return;
    if (data.deposit && data.deposit.amount > 0 && data.deposit.status !== "paid") return;
    if (showKycModal) return;
    const extraKmDue = data.account?.extra_km_due || 0;
    const rentDue = data.account?.rent_due || 0;
    const kind = extraKmDue > 0 ? "extra_km" : rentDue > 0 ? "daily" : null;
    if (!kind) { dismissedRef.current = { kind: null, rentDue: null, extraKmDue: null }; return; }
    if (pay) return;
    const d = dismissedRef.current;
    const alreadyDismissedThisExactCharge = d.kind === kind && d.rentDue === rentDue && d.extraKmDue === extraKmDue;
    if (!alreadyDismissedThisExactCharge) setPay(kind);
  }, [data, pay, showKycModal]);

  // Wraps setPay so that closing a popup ("X") is remembered as a dismissal of
  // that exact charge, so the effect above won't instantly reopen it.
  const handleSetPay = (value) => {
    if (value === null && pay) {
      dismissedRef.current = {
        kind: pay,
        rentDue: data?.account?.rent_due || 0,
        extraKmDue: data?.account?.extra_km_due || 0,
      };
    }
    setPay(value);
  };

  // New day starts at midnight: re-read the account so today's rent popup appears
  // even if the app was left open overnight.
  useEffect(() => {
    // ms until the next IST midnight (IST = UTC+5:30, no DST)
    const IST_MS = 5.5 * 3600 * 1000;
    const DAY_MS = 24 * 3600 * 1000;
    const nowMs = Date.now();
    const msToMidnight = DAY_MS - ((nowMs + IST_MS) % DAY_MS) + 5000;
    const t = setTimeout(() => refresh(), msToMidnight);
    return () => clearTimeout(t);
  }, [data?.account?.today_date]);

  // Update modal visibility when data loads
  useEffect(() => {
    if (data && (!kycStatus || kycStatus === "pending" || kycStatus === "rejected")) {
      const hasPackage = !!(data.driver?.package_name || data.rental?.package_name);
      const snoozedUntil = data.driver?.kyc_snoozed_until;
      const isSnoozed = snoozedUntil && new Date(snoozedUntil).getTime() > Date.now();
      
      if (!isSnoozed || !hasPackage) {
        setShowKycModal(true);
      }
    }
    
    // Auto-hide approved banner after 10s
    let timer;
    if (kycStatus === "approved" && !isApprovedHidden) {
      timer = setTimeout(async () => {
        setHideApproved(true);
        try { await dapi.post("/driver/kyc/ack-approved"); } catch (e) {}
      }, 10000);
    }
    
    // Auto-show deposit popup if unpaid
    if (data && data.deposit && data.deposit.amount > 0 && data.deposit.status !== "paid") {
      setPay("deposit");
    }
    
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [data, kycStatus, hideApproved]);

  const handleCloseModal = async () => {
    setShowKycModal(false);
    try { await dapi.post("/driver/kyc/snooze"); } catch (e) {}
  };
  
  const handleApplyLeave = async () => {
    if (!leaveDate) return setLeaveError("Please select a date");
    setLeaveLoading(true);
    setLeaveError(null);
    try {
      await dapi.post("/driver/leave", { date: leaveDate });
      setShowLeaveModal(false);
      setLeaveDate("");
      refresh();
    } catch (e) {
      setLeaveError(e.response?.data?.detail || "Failed to apply leave");
    } finally {
      setLeaveLoading(false);
    }
  };
  
  const submitOdo = async (e) => {
    e.preventDefault();
    if (!data?.deposit || data.deposit.status !== "paid") return setOdoError("You must pay the Security Deposit before starting a trip.");
    if (!data?.driver?.active_trip_id && data?.account) {
      if ((data.account.extra_km_due || 0) > 0) return setOdoError("You must pay your Extra KM charges before starting a trip.");
      if ((data.account.rent_due || 0) > 0) return setOdoError("You must pay your Daily Rent before starting a trip.");
    }
    if (!odoReading) return setOdoError("Reading is required");
    if (!odoImage) return setOdoError("Image is required");
    setOdoLoading(true);
    setOdoError("");
    //const wasEndingTrip = !!data?.driver?.active_trip_id;
    try {
      const fd = new FormData();
      fd.append("reading", odoReading);
      fd.append("image", odoImage);
      await dapi.post("/driver/odometer", fd);
      setShowEndModal(false);
      setOdoReading("");
      setOdoImage(null);
      // Small delay to ensure DB write propagates before re-reading
      await new Promise(r => setTimeout(r, 400));
      await refresh();
      // if (wasEndingTrip) setPromptPayAfterTrip(true);
    } catch (err) {
      setOdoError(err.response?.data?.detail || "Failed to upload");
    } finally {
      setOdoLoading(false);
    }
  };
  
  if (!data) return null;
  const { driver, rental, account, deposit } = data;

  if (account?.pending_catchup) return <CatchupScreen />;
  if (account?.status === "blocked") return <BlockedScreen />;
  
  const pkgName = (driver?.package_name || rental?.package_name || "").toLowerCase();
  const limit_km = driver?.package_limit_km || 0;
  const current_month_kms = driver?.current_month_kms || 0;
  const km_percentage = Math.min(100, (current_month_kms / limit_km) * 100);

  const st = STATUS_UI[account?.status || "active"];
  const depositPaid = !deposit || deposit.amount === 0 || deposit.status === "paid";
  const kyc = driver.kyc_status;
  
  // Must match the backend, which stores last_odometer_date in IST
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  
  const isFullyAssigned = !!pkgName && !!driver?.vehicle_id;
  
  const activeTripId = driver?.active_trip_id;
  const needsStartTrip = isFullyAssigned && !activeTripId && driver?.last_odometer_date !== today;
  const needsEndTripForced = isFullyAssigned && activeTripId && driver?.last_odometer_date !== today;
  const isTripActiveToday = isFullyAssigned && activeTripId && driver?.last_odometer_date === today;
  const isTripCompletedToday = isFullyAssigned && !activeTripId && driver?.last_odometer_date === today;
  
  const showOdoModal = (needsStartTrip || needsEndTripForced || showEndModal) && isFullyAssigned && depositPaid;
  
  const modalTitle = activeTripId ? "End Trip Odometer" : "Start Trip Odometer";
  const modalDesc = activeTripId 
    ? "Please submit your ending vehicle odometer to finish your trip." 
    : "Please submit your starting vehicle odometer to begin today's trip.";

  return (
    <div className="px-5 pt-6 space-y-5 pb-20" data-testid="driver-home">
      
      {/* Floating Action Buttons - Constrained to Mobile Viewport */}
      {(isTripActiveToday || isTripCompletedToday) && (
        <div className="fixed inset-0 z-50 pointer-events-none flex justify-center">
          <div className="w-full max-w-md relative">
            
            {/* END TRIP BUTTON */}
            {isTripActiveToday && (
              <button 
                onClick={() => setShowEndModal(true)}
                className="absolute right-5 bottom-40 w-16 h-16 bg-gradient-to-b from-red-500 to-rose-700 rounded-full shadow-[0_8px_30px_rgb(225,29,72,0.6)] flex flex-col items-center justify-center text-white hover:scale-105 active:scale-95 transition-all border-4 border-white group pointer-events-auto"
              >
                <div className="absolute inset-0 rounded-full border-4 border-red-500/30 animate-ping" style={{ animationDuration: '3s' }}></div>
                <span className="text-[11px] font-black tracking-widest leading-none mt-1">END</span>
                <span className="text-[11px] font-black tracking-widest leading-none">TRIP</span>
              </button>
            )}

            {/* START NEW TRIP BUTTON */}
            {isTripCompletedToday && (
              <button 
                onClick={() => setShowEndModal(true)}
                className="absolute right-5 bottom-40 w-16 h-16 bg-gradient-to-b from-emerald-500 to-teal-700 rounded-full shadow-[0_8px_30px_rgb(16,185,129,0.6)] flex flex-col items-center justify-center text-white hover:scale-105 active:scale-95 transition-all border-4 border-white group pointer-events-auto"
              >
                <div className="absolute inset-0 rounded-full border-4 border-emerald-500/30 animate-ping" style={{ animationDuration: '3s' }}></div>
                <span className="text-[11px] font-black tracking-widest leading-none mt-1">START</span>
                <span className="text-[11px] font-black tracking-widest leading-none">TRIP</span>
              </button>
            )}

          </div>
        </div>
      )}

      {/* Odometer Modal Overlay */}
      {showOdoModal && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center p-5 bg-slate-900/60 backdrop-blur-sm transition-opacity"
          onTouchStart={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
        >
          <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl relative animate-in fade-in zoom-in duration-300">
            
            {showEndModal && !needsEndTripForced && (
              <button onClick={() => setShowEndModal(false)} className="absolute top-4 right-4 p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors">
                <XCircle className="w-5 h-5 text-slate-500" />
              </button>
            )}

            <div className="flex flex-col items-center text-center mt-2 mb-6">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${activeTripId ? 'bg-red-100 text-red-500' : 'bg-indigo-100 text-indigo-500'}`}>
                <Camera className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-extrabold text-slate-900 mb-2">{modalTitle}</h2>
              <p className="text-slate-500 text-sm">{modalDesc}</p>
            </div>
            
            {odoError && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl mb-4 text-center">
                <div className="text-red-600 text-sm font-semibold mb-2">{odoError}</div>
                {odoError.includes("Extra KM") && (
                  <button 
                    onClick={() => { setShowEndModal(false); setPay("extra_km"); }}
                    className="px-4 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 transition-colors shadow-sm"
                  >
                    Pay Extra KM Now
                  </button>
                )}
                {odoError.includes("Daily Rent") && (
                  <button 
                    onClick={() => { setShowEndModal(false); setPay("daily"); }}
                    className="px-4 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 transition-colors shadow-sm"
                  >
                    Pay Daily Rent Now
                  </button>
                )}
              </div>
            )}
            
            {(!activeTripId && ((account?.extra_km_due || 0) > 0 || (account?.rent_due || 0) > 0)) ? (
              <div className="flex flex-col items-center text-center mt-2">
                <div className="w-16 h-16 rounded-full bg-red-100 text-red-500 flex items-center justify-center mb-4">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                {(account?.extra_km_due || 0) > 0 ? (
                  <>
                    <h2 className="text-xl font-extrabold text-slate-900 mb-2">Extra KM Charges Due</h2>
                    <p className="text-slate-500 text-sm mb-6">
                      You have extra KM charges of {inr(account.extra_km_due)} from your last trip. Please pay this first before your daily rent.
                    </p>
                    <button 
                      onClick={() => { setShowEndModal(false); setPay("extra_km"); }}
                      className="w-full h-12 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold transition-colors"
                    >
                      Pay Extra KM Charges Now
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className="text-xl font-extrabold text-slate-900 mb-2">Daily Rent Due</h2>
                    <p className="text-slate-500 text-sm mb-6">
                      Please pay today's daily rent of {inr(account.rent_due)} to start your trip.
                      <br /><br />
                      <span className="block text-xs font-medium text-slate-400">Note: Daily rental amount must be paid whether you operate the vehicle or keep it idle.</span>
                      {Object.keys(account?.rent_by_date || {}).length > 0 && (
                        <span className="block mt-2 text-xs font-bold text-red-500">
                          Unpaid Dates: {Object.keys(account.rent_by_date).sort().join(", ")}
                        </span>
                      )}
                    </p>
                    <button 
                      onClick={() => { setShowEndModal(false); setPay("daily"); }}
                      className="w-full h-12 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold transition-colors"
                    >
                      Pay Daily Rent Now
                    </button>
                  </>
                )}
              </div>
            ) : (
              <form onSubmit={submitOdo} className="space-y-4">
                <button 
                  type="button" 
                  onClick={async () => {
                    const file = await captureImage();
                    if (file) setOdoImage(file);
                  }}
                  disabled={camLoading}
                  className={`relative h-32 w-full rounded-2xl border-2 flex flex-col items-center justify-center overflow-hidden transition-colors ${odoImage ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300 bg-slate-50'}`}>
                  {odoImage ? (
                    <div className="absolute inset-0 w-full h-full">
                      <img src={URL.createObjectURL(odoImage)} alt="Preview" className="w-full h-full object-cover opacity-80" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-indigo-900/30">
                        <CheckCircle className="w-8 h-8 text-white mb-1 shadow-sm" />
                        <span className="font-bold text-white text-sm drop-shadow-md">Captured</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      {camLoading ? (
                        <Loader2 className="w-6 h-6 text-indigo-500 animate-spin mb-1.5" />
                      ) : (
                        <Camera className="w-6 h-6 text-slate-400 mb-1.5" />
                      )}
                      <span className="font-medium text-slate-600 text-sm">{camLoading ? "Opening..." : "Tap to Capture"}</span>
                    </>
                  )}
                </button>

              <input 
                type="number" 
                placeholder="Enter exact meter reading"
                value={odoReading}
                onChange={e => setOdoReading(e.target.value)}
                className="w-full h-12 rounded-xl border-2 border-slate-200 bg-slate-50 px-4 font-medium outline-none focus:border-indigo-500 focus:bg-white transition-colors"
                required
              />
              
              <button 
                type="submit" 
                disabled={odoLoading}
                className={`w-full h-12 text-white rounded-xl font-bold flex items-center justify-center disabled:opacity-50 transition-colors ${activeTripId ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-500 hover:bg-indigo-600'}`}
              >
                {odoLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : "Submit Reading"}
              </button>
            </form>
            )}
          </div>
        </div>
      )}

      {/* KYC Modal Overlay */}
      {showKycModal && !showOdoModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-slate-900/40 backdrop-blur-sm transition-opacity"
          onTouchStart={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
        >
          <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl relative animate-in fade-in zoom-in duration-300">
            <button onClick={handleCloseModal} className="absolute top-4 right-4 p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors">
              <XCircle className="w-5 h-5 text-slate-500" />
            </button>
            
            <div className="flex flex-col items-center text-center mt-2">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${kyc === 'rejected' ? 'bg-red-100 text-red-500' : 'bg-amber-100 text-amber-500'}`}>
                {kyc === 'rejected' ? <AlertTriangle className="w-8 h-8" /> : <FileBadge className="w-8 h-8" />}
              </div>
              
              <h2 className="text-xl font-extrabold text-slate-900 mb-2">
                {kyc === 'rejected' ? 'KYC Rejected' : 'Action Required'}
              </h2>
              
              <p className="text-slate-500 text-sm mb-6">
                {kyc === 'rejected' 
                  ? 'Your previously submitted KYC documents were rejected. Please fill them out again with clear images.' 
                  : 'Please complete your KYC by uploading your Driving License, Aadhaar, and PAN card.'}
              </p>
              
              <button 
                onClick={() => { setShowKycModal(false); nav("/driver/kyc"); }}
                className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-bold transition-colors"
              >
                Complete KYC
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="text-slate-500 text-sm">{greeting()},</p>
        <h1 className="text-2xl font-extrabold text-slate-900">{driver.name} 👋</h1>
      </div>

      {!isApprovedHidden && kycStatus === "approved" && (
        <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-3xl flex items-start gap-3 mv-rise">
          <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 pt-0.5">
            <h3 className="font-bold text-emerald-900 text-sm">KYC Approved Successfully</h3>
            <p className="text-emerald-700 text-xs mt-0.5 font-medium">Your documents have been verified.</p>
          </div>
          <button onClick={async () => { setHideApproved(true); try { await dapi.post("/driver/kyc/ack-approved"); } catch (e) {} }} className="p-1 text-emerald-400 hover:text-emerald-600 bg-emerald-100/50 rounded-full">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      )}
      
      {kyc === "submitted" && (
        <div className="rounded-3xl bg-blue-50 border border-blue-200 p-4 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-blue-900 text-sm">Under Review</h3>
            <p className="text-blue-700 text-xs mt-0.5 font-medium">Your KYC is being verified</p>
          </div>
        </div>
      )}

      {/* Green Hero Card */}
      <div className="rounded-[1.5rem] bg-gradient-to-br from-emerald-700 to-emerald-950 text-white p-6 shadow-xl relative overflow-hidden">
        <div className="flex items-center gap-2 mb-2">
          <Ticket className="w-5 h-5 text-emerald-200" />
          <span className="text-sm font-medium text-emerald-100 tracking-wide">
            {rental?.vehicle_reg || "NO VEHICLE ASSIGNED"} 
            {driver?.vehicle_plate && driver.vehicle_plate !== rental?.vehicle_reg ? ` • ${driver.vehicle_plate}` : ""}
          </span>
        </div>
        
        <h2 className="text-4xl font-extrabold tracking-tight mb-1">{driver?.package_name || rental?.package_name || "N/A"}</h2>
        <p className="text-xs text-emerald-300 font-bold tracking-widest uppercase mb-6">
          {driver?.name || "UNKNOWN"} - {driver?.city || "LOCATION"}
        </p>

        <div className="grid grid-cols-2 gap-y-4 gap-x-8 text-sm">
          <div>
            <div className="text-emerald-300/80 mb-0.5 text-xs">Start Date</div>
            <div className="font-semibold">{rental?.start_date ? new Date(rental.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : "—"}</div>
          </div>
          <div>
            <div className="text-emerald-300/80 mb-0.5 text-xs">End Date</div>
            <div className="font-semibold">Ongoing</div>
          </div>
          <div>
            <div className="text-emerald-300/80 mb-0.5 text-xs">Package Pattern</div>
            <div className="font-semibold">Daily Rent</div>
          </div>
          <div>
            <div className="text-emerald-300/80 mb-0.5 text-xs">Value</div>
            <div className="font-semibold">{inr(rental?.daily_rate || driver?.package_rate || 0)}</div>
          </div>
          
          <div className="col-span-2 mt-2 pt-4 border-t border-emerald-600/30">
            <div className="grid grid-cols-1 gap-3">

              {/* Daily KM Limit */}
              <div className="bg-emerald-800/50 rounded-2xl p-3">
                <div className="text-[10px] text-emerald-300/70 font-semibold uppercase tracking-wider mb-2">Daily Limit</div>
                <div className="text-2xl font-extrabold leading-none">
                  {driver.daily_limit_km || 0}
                  <span className="text-xs font-normal text-emerald-300/80 ml-1">km</span>
                </div>
                <div className="mt-2">
                  <div className="flex justify-between text-[11px] text-emerald-300/80 mb-1">
                    <span>Today: <span className="font-bold text-white">{driver.today_km_used || 0} km</span></span>
                    <span>{Math.max(0, (driver.daily_limit_km || 0) - (driver.today_km_used || 0))} left</span>
                  </div>
                  <div className="w-full bg-emerald-900/60 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-emerald-400 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((driver.today_km_used || 0) / (driver.daily_limit_km || 1)) * 100)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-emerald-300/60 mt-1">
                    {(driver.today_extra_km || 0) > 0 ? `${driver.today_extra_km} km over today's limit` : "Resets every day at midnight"}
                  </div>
                </div>
              </div>

            </div>
            <div className="text-[10px] text-emerald-300/60 leading-tight mt-2 text-center">
              Overage ₹{driver.overage_per_km || 0}/km above the daily limit · Extra km billed separately
            </div>
            
            {/* Paid Leave Status */}
            {/* <div className="col-span-2 mt-4 pt-4 border-t border-emerald-600/30">
              <div className="bg-white/10 rounded-xl p-4 border border-white/5 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-emerald-200 font-semibold uppercase tracking-wider mb-1">Paid Leaves</div>
                  <div className="text-sm font-bold text-white">
                    {driver?.leaves_taken_this_month || 0} / {driver?.leave_quota || 0} Used
                  </div>
                  {driver?.paid_leaves?.includes(new Date().toLocaleDateString('en-CA')) && (
                    <div className="text-xs text-yellow-300 font-bold mt-1">✨ You are on Paid Leave today!</div>
                  )}
                </div>
                <button 
                  onClick={() => setShowLeaveModal(true)}
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-4 py-2 rounded-lg text-xs font-bold transition-colors"
                >
                  Apply Leave
                </button>
              </div>
            </div> */}
            
          </div>
        </div>
      </div>
      
      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3 mt-5">
        <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm" data-testid="home-outstanding">
          <div className="flex items-center gap-1.5 text-slate-500 text-xs"><AlertTriangle className="w-3.5 h-3.5" /> Outstanding</div>
          <div className={`text-xl font-extrabold mt-1 ${account?.outstanding_amount ? "text-amber-600" : "text-slate-900"}`}>{inr((account?.extra_km_due || 0) > 0 ? account.extra_km_due : (account?.outstanding_amount || 0))}</div>
          {account?.overdue_days > 0 && <div className="text-[11px] text-amber-600 mt-0.5">{account.overdue_days} day{account.overdue_days > 1 ? "s" : ""} unpaid</div>}
        </div>
        {!depositPaid && deposit?.amount > 0 && (
          <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm" data-testid="home-deposit">
            <div className="flex items-center gap-1.5 text-slate-500 text-xs"><Wallet className="w-3.5 h-3.5" /> Security Deposit</div>
            <div className="text-xl font-extrabold mt-1 text-slate-900">{inr(deposit.amount)}</div>
            <div className="text-[11px] mt-0.5 text-amber-600">Pending</div>
          </div>
        )}
      </div>
      
      {/* Account status */}
      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm flex items-center justify-between mt-5" data-testid="home-status">
        <span className="text-slate-500 text-sm">Rental Account Status</span>
        <span className={`inline-flex items-center gap-2 font-bold uppercase text-sm ${st.text}`}>
          <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} /> {st.label}
        </span>
      </div>

      {/* Deposit CTA */}
      {(!depositPaid && deposit?.amount > 0) && (
        <button onClick={() => setPay("deposit")} data-testid="home-pay-deposit-btn"
          className="w-full h-12 rounded-2xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors mt-5">
          Pay Security Deposit. {inr(deposit.amount)}
        </button>
      )}

      {/* Spacer to prevent content from hiding behind sticky bar */}
      <div className="h-24"></div>

      {/* Sticky Bottom Payment Bar - shown ONLY when there is rent or extra-km due */}
      {isFullyAssigned && ((account?.extra_km_due || 0) > 0 || (account?.rent_due || 0) > 0) && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 bg-white border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] p-4 flex items-center justify-between z-40 max-w-md w-full">
          <div>
            {/* Charges are paid one at a time: Extra KM first, then Rent.
                So show ONLY the charge that "Proceed to Payment" will actually pay. */}
            {(account?.extra_km_due || 0) > 0 ? (
              <>
                <div className="text-2xl font-bold text-red-500 leading-none mb-1">
                  {inr(account.extra_km_due)}
                </div>
                <div className="text-xs text-red-500 font-semibold">Extra KM charges</div>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold text-amber-600 leading-none mb-1">
                  {inr(account?.rent_due || 0)}
                </div>
                <div className="text-xs text-slate-700 font-medium">
  Daily Rent{Object.keys(account?.rent_by_date || {}).length > 1 ? ` · ${Object.keys(account.rent_by_date).length} days` : ""}
</div>
              </>
            )}
          </div>
          <button 
            onClick={() => setPay((account?.extra_km_due || 0) > 0 ? "extra_km" : "daily")}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 h-12 rounded-xl font-semibold transition-colors"
          >
            Proceed to Payment
          </button>
        </div>
      )}

      <PayModals pay={pay} setPay={handleSetPay} data={data} refresh={refresh} />
      {/* Leave Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-[100] flex flex-col justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowLeaveModal(false)} />
          <div className="relative bg-white rounded-t-3xl p-6 shadow-2xl animate-in slide-in-from-bottom flex flex-col max-h-[90vh]">
            <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6" />
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display text-xl font-bold text-slate-900">Apply Paid Leave</h3>
                <p className="text-sm text-slate-500">
                  {driver?.leaves_taken_this_month || 0} / {driver?.leave_quota || 0} leaves used this month
                </p>
              </div>
            </div>
            
            <p className="text-xs text-slate-500 mb-6 bg-slate-50 p-3 rounded-lg">
              When on Paid Leave, you will not be charged daily rent for that day. 
              However, Extra KM charges will still apply if you exceed your daily limit.
            </p>

            <label className="text-sm font-bold text-slate-700 mb-2">Select Date</label>
            <input 
              type="date" 
              min={new Date().toLocaleDateString('en-CA')} 
              value={leaveDate}
              onChange={(e) => setLeaveDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 font-bold focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none mb-4"
            />
            
            {leaveError && (
              <div className="text-xs text-red-600 bg-red-50 p-3 rounded-lg font-semibold mb-4">
                {leaveError}
              </div>
            )}

            <button 
              onClick={handleApplyLeave}
              disabled={leaveLoading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition-all text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2"
            >
              {leaveLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirm Leave"}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

// Shared modal launcher reused across pages
export function PayModals({ pay, setPay, data, refresh }) {
  const { rental, account, deposit, driver } = data;
  const common = { driverName: driver?.name, driverPhone: driver?.phone, onClose: () => setPay(null), onDone: () => refresh() };
  return (
    <>
      <PayModal open={pay === "daily"} kind="daily" title="Pay Daily Rent" amount={account?.rent_due || 0}
        lines={[
          ...(Object.keys(account?.rent_by_date || {}).length > 1
            ? Object.entries(account.rent_by_date).sort(([a], [b]) => a.localeCompare(b)).map(([d, amt]) => ({ label: `Rent · ${d}`, value: inr(amt) }))
            : [{ label: `Daily Rent · ${rental?.package_name}`, value: inr(account?.rent_due || 0) }]),
          { label: "Total Payable", value: inr(account?.rent_due || 0), strong: true },
        ]} {...common} />
      <PayModal open={pay === "extra_km"} kind="extra_km" title="Pay Extra KM Charges" amount={account?.extra_km_due || 0}
        lines={[
          { label: "Extra KM Overage", value: inr(account?.extra_km_due || 0) },
          { label: "Total Payable", value: inr(account?.extra_km_due || 0), strong: true },
        ]} {...common} />
      <PayModal open={pay === "deposit"} kind="deposit" title="Security Deposit" amount={deposit?.amount ?? 0}
        lines={[
          { label: "Refundable Security Deposit", value: inr(deposit?.amount ?? 0) },
          { label: "Total Payable", value: inr(deposit?.amount ?? 0), strong: true },
        ]} {...common} />
      <PayModal open={pay === "outstanding"} kind="outstanding" title="Outstanding Balance" amount={account?.outstanding_amount || 0}
        lines={[
          { label: `Daily Rent · ${rental?.package_name}`, value: inr(rental?.daily_rate || 0) },
          ...((account?.outstanding_amount || 0) > (rental?.daily_rate || 0) ? [
            { label: `Extra KM Overage`, value: inr((account?.outstanding_amount || 0) - (rental?.daily_rate || 0)) }
          ] : []),
          { label: "Total Payable", value: inr(account?.outstanding_amount || 0), strong: true },
        ]} {...common} />
    </>
  );
}
