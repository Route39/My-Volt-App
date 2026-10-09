import { useState } from "react";
import { Camera, CheckCircle, Loader2, Lock } from "lucide-react";
import { useDriver } from "../../context/DriverAuthContext";
import { inr } from "../../lib/format";
import dapi from "../../lib/driverApi";
import PayModal from "./PayModal";
import { useNativeCamera } from "../../hooks/useNativeCamera";

export default function CatchupScreen() {
  const { data, refresh } = useDriver();
  const { captureImage, loading: camLoading } = useNativeCamera();
  const account = data?.account || {};
  const alreadyPaid = !!account.catchup_paid;

  const [reading, setReading] = useState(alreadyPaid ? String(account.catchup_reading ?? "") : "");
  const [image, setImage] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const baseline = account.catchup_baseline_reading || 0;

  const capture = async () => { const f = await captureImage(); if (f) setImage(f); };

  const getQuote = async () => {
    setQuoteError("");
    const n = Number(reading);
    if (!reading || Number.isNaN(n)) return setQuoteError("Enter your current odometer reading.");
    if (n < baseline) return setQuoteError(`Current KM cannot be less than your last recorded reading (${baseline} km).`);
    setQuoteLoading(true);
    try {
      const { data: q } = await dapi.get("/driver/catchup/quote", { params: { reading: n } });
      setQuote(q);
      setPayOpen(true);
    } catch (err) {
      setQuoteError(err.response?.data?.detail || "Could not calculate the amount due.");
    } finally {
      setQuoteLoading(false);
    }
  };

  const submitPhoto = async () => {
    if (!image) return setSubmitError("Please capture your current odometer photo.");
    setSubmitting(true);
    setSubmitError("");
    try {
      const fd = new FormData();
      fd.append("image", image);
      await dapi.post("/driver/catchup/photo", fd);
      await refresh();
    } catch (err) {
      setSubmitError(err.response?.data?.detail || "Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const CameraBox = () => (
    <button type="button" onClick={capture} disabled={camLoading}
      className={`relative h-32 w-full rounded-2xl border-2 flex flex-col items-center justify-center overflow-hidden transition-colors ${image ? 'border-amber-500 bg-amber-50/50' : 'border-slate-200 hover:border-slate-300 bg-slate-50'}`}>
      {image ? (
        <div className="absolute inset-0 w-full h-full">
          <img src={URL.createObjectURL(image)} alt="Preview" className="w-full h-full object-cover opacity-80" />
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-amber-900/30">
            <CheckCircle className="w-8 h-8 text-white mb-1 shadow-sm" />
            <span className="font-bold text-white text-sm drop-shadow-md">Captured</span>
          </div>
        </div>
      ) : (
        <>
          {camLoading ? <Loader2 className="w-6 h-6 text-amber-500 animate-spin mb-1.5" /> : <Camera className="w-6 h-6 text-slate-400 mb-1.5" />}
          <span className="font-medium text-slate-600 text-sm">{camLoading ? "Opening..." : "Tap to Capture Current Odometer"}</span>
        </>
      )}
    </button>
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-6 text-center" data-testid="catchup-screen">
      <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mb-5">
        <Lock className="w-10 h-10 text-amber-600" />
      </div>
      <h1 className="text-2xl font-extrabold text-slate-900">Account Reactivation Required</h1>
      <p className="text-slate-500 text-sm mt-2 max-w-xs">
        Before you can start a new trip, please clear your unpaid rent and confirm your vehicle's current odometer reading.
      </p>

      <div className="mt-6 w-full max-w-sm rounded-3xl bg-white border border-slate-100 p-6 shadow-sm text-left">
        {(account.blocked_rent_amount > 0 || account.extra_km_due > 0) && (
          <div className="mb-5 space-y-2 text-sm">
            {(account.blocked_dates || []).map((d) => (
              <div key={d} className="flex justify-between text-slate-600 border-b border-slate-50 pb-1">
                <span>{d}</span>
                <span className="font-semibold text-slate-800">{inr((account.rent_by_date || {})[d] || 0)}</span>
              </div>
            ))}
            {account.extra_km_due > 0 && (
              <div className="flex justify-between text-slate-600 border-b border-slate-50 pb-1">
                <span>Extra KM charges</span>
                <span className="font-semibold text-slate-800">{inr(account.extra_km_due)}</span>
              </div>
            )}
          </div>
        )}

        {!alreadyPaid ? (
          <>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Current Odometer Reading</label>
            <input type="number" placeholder={`Must be ${baseline} km or more`} value={reading}
              onChange={(e) => setReading(e.target.value)}
              className="w-full h-12 mt-1.5 rounded-xl border-2 border-slate-200 bg-slate-50 px-4 font-medium outline-none focus:border-amber-500 focus:bg-white transition-colors" />
            <div className="text-[11px] text-slate-400 mt-1">Last recorded reading: {baseline} km</div>

            <div className="mt-4"><CameraBox /></div>

            {quoteError && <div className="text-red-600 text-xs font-semibold mt-3 text-center">{quoteError}</div>}

            <button onClick={getQuote} disabled={quoteLoading || !reading || !image}
              className="mt-5 w-full h-12 rounded-2xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold transition-colors flex items-center justify-center gap-2">
              {quoteLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue to Payment"}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-semibold mb-4">
              <CheckCircle className="w-4 h-4" /> Payment completed
            </div>
            <div className="text-xs text-slate-500 mb-1">Confirmed odometer reading</div>
            <div className="text-lg font-bold text-slate-800 mb-4">{account.catchup_reading} km</div>

            <CameraBox />

            {submitError && <div className="text-red-600 text-xs font-semibold mt-3 text-center">{submitError}</div>}

            <button onClick={submitPhoto} disabled={submitting || !image}
              className="mt-5 w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold transition-colors flex items-center justify-center gap-2">
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Submit & Continue"}
            </button>
          </>
        )}
      </div>

      {quote && (
        <PayModal open={payOpen} kind="catchup" title="Clear Rent & Confirm Odometer" amount={quote.total}
          extraParams={{ reading: Number(reading) }}
          driverName={data?.driver?.name} driverPhone={data?.driver?.phone}
          lines={[
            ...(account.blocked_dates || []).map((d) => ({ label: d, value: inr((account.rent_by_date || {})[d] || 0) })),
            ...(quote.extra_km_existing > 0 ? [{ label: "Extra KM (previous trip)", value: inr(quote.extra_km_existing) }] : []),
            ...(quote.overage_charge > 0 ? [{ label: `Extra KM now (+${quote.overage_km} km)`, value: inr(quote.overage_charge) }] : []),
            { label: "Total Payable", value: inr(quote.total), strong: true },
          ]}
          onClose={() => setPayOpen(false)}
          onDone={() => { setPayOpen(false); refresh(); }} />
      )}
    </div>
  );
}