import { useState } from "react";
import { X, Loader2, CheckCircle2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import dapi from "../../lib/driverApi";
import { inr, fmtDate } from "../../lib/format";

function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

// Reusable payment sheet. kind: deposit | daily | outstanding
export default function PayModal({ open, onClose, kind, title, amount, lines = [], driverName, driverPhone, onDone }) {
  const [phase, setPhase] = useState("confirm"); // confirm | processing | success
  const [result, setResult] = useState(null);

  if (!open) return null;

  const close = () => { setPhase("confirm"); setResult(null); onClose(); };

  const pay = async () => {
    setPhase("processing");
    try {
      const { data: order } = await dapi.post("/driver/payments/create-order", { kind });
      let verifyRes;
      if (order.gateway === "razorpay") {
        const ok = await loadRazorpay();
        if (!ok) throw new Error("Could not load payment gateway");
        verifyRes = await new Promise((resolve, reject) => {
          const rz = new window.Razorpay({
            key: order.key_id, amount: order.amount_paise, currency: "INR",
            name: "MyEVRental", description: title, order_id: order.order_id,
            prefill: { name: driverName, contact: driverPhone },
            theme: { color: "#10b981" },
            handler: async (res) => {
              try {
                const { data } = await dapi.post("/driver/payments/verify", {
                  payment_id: order.payment_id,
                  razorpay_order_id: res.razorpay_order_id,
                  razorpay_payment_id: res.razorpay_payment_id,
                  razorpay_signature: res.razorpay_signature,
                });
                resolve(data);
              } catch (e) { reject(e); }
            },
            modal: { ondismiss: () => reject(new Error("cancelled")) },
          });
          rz.open();
        });
      } else {
        // Sandbox: gateway not yet configured. Confirmation is still server-verified via a
        // server-issued token (never a frontend success flag). Plug in Razorpay keys to go live.
        const { data } = await dapi.post("/driver/payments/verify", {
          payment_id: order.payment_id, sandbox_token: order.sandbox_token,
        });
        verifyRes = data;
      }
      setResult(verifyRes);
      setPhase("success");
      toast.success("Payment successful ✓");
      onDone && onDone(verifyRes);
    } catch (e) {
      setPhase("confirm");
      if (e.message !== "cancelled") toast.error(e.response?.data?.detail || "Payment failed. Please try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" data-testid="pay-modal">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={phase !== "processing" ? close : undefined} />
      <div className="relative w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl animate-[rise_.25s_ease]">
        {phase !== "processing" && (
          <button onClick={close} data-testid="pay-close" className="absolute top-4 right-4 text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        )}

        {phase === "success" ? (
          <div className="text-center py-2" data-testid="pay-success">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-9 h-9 text-emerald-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">Payment Confirmed</h3>
            <div className="text-3xl font-extrabold text-slate-900 mt-2">{inr(result?.amount || amount)}</div>
            <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-left space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Transaction ID</span><span className="font-semibold text-slate-800" data-testid="pay-txn">{result?.transaction_id}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Date &amp; Time</span><span className="font-medium text-slate-800">{fmtDate(result?.paid_at, true)}</span></div>
              {result?.account && <div className="flex justify-between"><span className="text-slate-500">Rental Status</span><span className="font-semibold text-emerald-600 uppercase">{result.account.status}</span></div>}
            </div>
            {kind === "outstanding" && result?.account?.status === "active" && (
              <div className="mt-4 text-sm text-emerald-600 font-semibold space-y-1" data-testid="pay-reactivated">
                <div>✓ Outstanding Cleared</div>
                <div>✓ Payment Confirmed</div>
                <div>✓ Rental Account Activated</div>
              </div>
            )}
            <button onClick={close} data-testid="pay-continue" className="mt-5 w-full h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition-colors">Continue</button>
          </div>
        ) : (
          <>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            <div className="mt-4 rounded-2xl bg-slate-50 p-4 space-y-2.5 text-sm">
              {lines.map((l, i) => (
                <div key={i} className={`flex justify-between ${l.strong ? "text-slate-900 font-bold text-base pt-2 border-t border-slate-200" : "text-slate-600"}`}>
                  <span>{l.label}</span><span>{l.value}</span>
                </div>
              ))}
            </div>
            <button onClick={pay} disabled={phase === "processing"} data-testid="pay-now-btn"
              className="mt-5 w-full h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-70">
              {phase === "processing" ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</> : <>Pay {inr(amount)}</>}
            </button>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5" /> Secured payment · confirmed by server
            </div>
          </>
        )}
      </div>
    </div>
  );
}
