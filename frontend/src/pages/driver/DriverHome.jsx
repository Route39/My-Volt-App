import { useState, useEffect } from "react";
import { Bike, Wallet, ArrowRight, ShieldCheck, AlertTriangle, Lock, FileBadge, XCircle, Camera, CheckCircle, Loader2, Ticket } from "lucide-react";
import { useDriver } from "../../context/DriverAuthContext";
import { inr } from "../../lib/format";
import dapi from "../../lib/driverApi";
import PayModal from "./PayModal";
import BlockedScreen from "./BlockedScreen";
import { useNavigate } from "react-router-dom";

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
  const nav = useNavigate();
  const [pay, setPay] = useState(null);
  const [hideApproved, setHideApproved] = useState(false);
  const isApprovedHidden = hideApproved || data?.driver?.kyc_approved_seen;
  const [showEndModal, setShowEndModal] = useState(false);
  
  // Odometer State
  const [odoReading, setOdoReading] = useState("");
  const [odoImage, setOdoImage] = useState(null);
  const [odoLoading, setOdoLoading] = useState(false);
  const [odoError, setOdoError] = useState("");
  
  // Safe extraction for initial hook state
  const kycStatus = data?.driver?.kyc_status;
  const [showKycModal, setShowKycModal] = useState(false);

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
    if (kycStatus === "approved" && !isApprovedHidden) {
      const timer = setTimeout(async () => {
        setHideApproved(true);
        try { await dapi.post("/driver/kyc/ack-approved"); } catch (e) {}
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [data, kycStatus, hideApproved]);

  const handleCloseModal = async () => {
    setShowKycModal(false);
    try { await dapi.post("/driver/kyc/snooze"); } catch (e) {}
  };
  
  const submitOdo = async (e) => {
    e.preventDefault();
    if (!odoReading) return setOdoError("Reading is required");
    if (!odoImage) return setOdoError("Image is required");
    setOdoLoading(true);
    setOdoError("");
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
    } catch (err) {
      setOdoError(err.response?.data?.detail || "Failed to upload");
    } finally {
      setOdoLoading(false);
    }
  };
  
  if (!data) return null;
  const { driver, rental, account, deposit } = data;

  if (account?.status === "blocked") return <BlockedScreen />;
  
  const pkgName = (driver?.package_name || rental?.package_name || "").toLowerCase();
  const limit_km = driver?.package_limit_km || 0;
  const current_month_kms = driver?.current_month_kms || 0;
  const km_percentage = Math.min(100, (current_month_kms / limit_km) * 100);

  const st = STATUS_UI[account?.status || "active"];
  const depositPaid = deposit?.status === "paid";
  const kyc = driver.kyc_status;
  
  const today = new Date().toISOString().split("T")[0];
  
  const isFullyAssigned = !!pkgName && !!driver?.vehicle_id;
  
  const activeTripId = driver?.active_trip_id;
  const needsStartTrip = isFullyAssigned && !activeTripId && driver?.last_odometer_date !== today;
  const needsEndTripForced = isFullyAssigned && activeTripId && driver?.last_odometer_date !== today;
  const isTripActiveToday = isFullyAssigned && activeTripId && driver?.last_odometer_date === today;
  const isTripCompletedToday = isFullyAssigned && !activeTripId && driver?.last_odometer_date === today;
  
  const showOdoModal = (needsStartTrip || needsEndTripForced || showEndModal) && isFullyAssigned;
  
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
                {odoError.includes("outstanding") && (
                  <button 
                    onClick={() => { setShowEndModal(false); setPay("daily"); }}
                    className="px-4 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 transition-colors shadow-sm"
                  >
                    Pay Outstanding Now
                  </button>
                )}
              </div>
            )}
            
            {(!activeTripId && account?.outstanding_amount > 0) ? (
              <div className="flex flex-col items-center text-center mt-2">
                <div className="w-16 h-16 rounded-full bg-red-100 text-red-500 flex items-center justify-center mb-4">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-extrabold text-slate-900 mb-2">Payment Required</h2>
                <p className="text-slate-500 text-sm mb-6">
                  You have an outstanding balance of {inr(account.outstanding_amount)}. Please pay it to start today's trip.
                </p>
                <button 
                  onClick={() => { setShowEndModal(false); setPay("daily"); }}
                  className="w-full h-12 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold transition-colors"
                >
                  Pay Outstanding Now
                </button>
              </div>
            ) : (
              <form onSubmit={submitOdo} className="space-y-4">
                <label className={`relative h-32 w-full rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer overflow-hidden transition-colors ${odoImage ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300 bg-slate-50'}`}>
                  <input type="file" accept="image/*" onChange={(e) => setOdoImage(e.target.files?.[0])} className="hidden" />
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
                      <Camera className="w-6 h-6 text-slate-400 mb-1.5" />
                      <span className="font-medium text-slate-600 text-sm">Tap to Capture</span>
                    </>
                  )}
                </label>

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
            <div className="font-semibold">{inr(driver?.package_rate || rental?.daily_rate || 0)}</div>
          </div>
          
          <div className="col-span-2 mt-2 pt-4 border-t border-emerald-600/30">
            <div className="grid grid-cols-2 gap-3">
              
              {/* Left: Daily KM Limit */}
              <div className="bg-emerald-800/50 rounded-2xl p-3">
                <div className="text-[10px] text-emerald-300/70 font-semibold uppercase tracking-wider mb-2">Daily Limit</div>
                <div className="text-2xl font-extrabold leading-none">
                  {driver.daily_limit_km || 0}
                  <span className="text-xs font-normal text-emerald-300/80 ml-1">km / day</span>
                </div>
                {(driver.today_driven_km > 0) && (
                  <div className="mt-2 space-y-0.5">
                    <div className="text-[11px] text-emerald-300/80">
                      Today ridden: <span className="font-bold text-white">{driver.today_driven_km} km</span>
                    </div>
                    {(driver.today_overage_km > 0) && (
                      <div className="text-[11px] text-red-300 font-semibold">
                        Extra: +{driver.today_overage_km} km @ ₹{driver.overage_per_km || 0}/km
                      </div>
                    )}
                  </div>
                )}
                {!(driver.today_driven_km > 0) && (
                  <div className="text-[11px] text-emerald-300/60 mt-2">No trip today yet</div>
                )}
              </div>

              {/* Right: Monthly KM Limit */}
              <div className="bg-emerald-800/50 rounded-2xl p-3">
                <div className="text-[10px] text-emerald-300/70 font-semibold uppercase tracking-wider mb-2">Monthly Limit</div>
                <div className="text-2xl font-extrabold leading-none">
                  {driver.monthly_km_limit || 0}
                  <span className="text-xs font-normal text-emerald-300/80 ml-1">km</span>
                </div>
                <div className="mt-2">
                  <div className="flex justify-between text-[11px] text-emerald-300/80 mb-1">
                    <span>Used: <span className="font-bold text-white">{driver.current_month_kms || 0} km</span></span>
                    <span>{Math.max(0, (driver.monthly_km_limit || 0) - (driver.current_month_kms || 0))} left</span>
                  </div>
                  <div className="w-full bg-emerald-900/60 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-emerald-400 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((driver.current_month_kms || 0) / (driver.monthly_km_limit || 1)) * 100)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-emerald-300/60 mt-1">All KM incl. extra counted here</div>
                </div>
              </div>

            </div>
            <div className="text-[10px] text-emerald-300/60 leading-tight mt-2 text-center">
              Overage ₹{driver.overage_per_km || 0}/km above daily limit · Extra km billed separately
            </div>
          </div>
        </div>
      </div>
      
      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3 mt-5">
        <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm" data-testid="home-outstanding">
          <div className="flex items-center gap-1.5 text-slate-500 text-xs"><AlertTriangle className="w-3.5 h-3.5" /> Outstanding</div>
          <div className={`text-xl font-extrabold mt-1 ${account?.outstanding_amount ? "text-amber-600" : "text-slate-900"}`}>{inr(account?.outstanding_amount || 0)}</div>
          {account?.overdue_days > 0 && <div className="text-[11px] text-amber-600 mt-0.5">{account.overdue_days} day{account.overdue_days > 1 ? "s" : ""} unpaid</div>}
        </div>
        <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm" data-testid="home-deposit">
          <div className="flex items-center gap-1.5 text-slate-500 text-xs"><Wallet className="w-3.5 h-3.5" /> Security Deposit</div>
          <div className="text-xl font-extrabold mt-1 text-slate-900">{inr(deposit?.amount || 0)}</div>
          <div className={`text-[11px] mt-0.5 ${depositPaid ? "text-emerald-600" : "text-amber-600"}`}>{depositPaid ? "✓ Paid" : "Pending"}</div>
        </div>
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
          Pay Security Deposit {inr(deposit.amount)}
        </button>
      )}

      {/* Spacer to prevent content from hiding behind sticky bar */}
      <div className="h-24"></div>

      {/* Sticky Bottom Payment Bar - always shown when package assigned */}
      {isFullyAssigned && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 bg-white border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] p-4 flex items-center justify-between z-40 max-w-md w-full">
          <div>
            {(account?.outstanding_amount || 0) > 0 ? (
              <>
                {/* After trip ended - show exact rent + overage */}
                <div className="text-2xl font-bold text-amber-600 leading-none mb-1">
                  {inr(account.outstanding_amount)}
                </div>
                <div className="text-xs text-slate-500">
                  <span className="text-slate-700 font-medium">Rent {inr(rental?.daily_rate || 0)}</span>
                  {(account.outstanding_amount - (rental?.daily_rate || 0)) > 0 && (
                    <span className="text-red-500 font-semibold"> + Extra KM {inr(account.outstanding_amount - (rental?.daily_rate || 0))}</span>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* During trip or no outstanding - show daily rate */}
                <div className="text-2xl font-bold text-slate-900 leading-none mb-1">
                  {inr(rental?.daily_rate || 0)}
                </div>
                <div className="text-xs text-slate-500">Daily Rental Amount</div>
              </>
            )}
          </div>
          <button 
            onClick={() => setPay("daily")}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 h-12 rounded-xl font-semibold transition-colors"
          >
            Proceed to Payment
          </button>
        </div>
      )}

      <PayModals pay={pay} setPay={setPay} data={data} refresh={refresh} />
    </div>
  );
}

// Shared modal launcher reused across pages
export function PayModals({ pay, setPay, data, refresh }) {
  const { rental, account, deposit, driver } = data;
  const common = { driverName: driver?.name, driverPhone: driver?.phone, onClose: () => setPay(null), onDone: () => refresh() };
  return (
    <>
      <PayModal open={pay === "daily"} kind="daily" title="Pay Outstanding Balance" amount={account?.outstanding_amount || 0}
        lines={[
          { label: `Daily Rent · ${rental?.package_name}`, value: inr(rental?.daily_rate || 0) },
          ...((account?.outstanding_amount || 0) > (rental?.daily_rate || 0) ? [
            { label: `Extra KM Overage`, value: inr((account?.outstanding_amount || 0) - (rental?.daily_rate || 0)) }
          ] : []),
          { label: "Total Payable", value: inr(account?.outstanding_amount || 0), strong: true },
        ]} {...common} />
      <PayModal open={pay === "deposit"} kind="deposit" title="Security Deposit" amount={deposit?.amount || 5000}
        lines={[
          { label: "Refundable Security Deposit", value: inr(deposit?.amount || 5000) },
          { label: "Total Payable", value: inr(deposit?.amount || 5000), strong: true },
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
