import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import dapi from "../../lib/driverApi";
import { inr, fmtDate } from "../../lib/format";

const KIND_LABEL = { deposit: "Security Deposit", daily: "Daily Rent", outstanding: "Outstanding" };
const STATUS_UI = {
  paid: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
};

export default function DriverPayments() {
  const [items, setItems] = useState(null);
  useEffect(() => { dapi.get("/driver/payments").then((r) => setItems(r.data)).catch(() => setItems([])); }, []);

  return (
    <div className="px-5 pt-6 space-y-4" data-testid="driver-payments">
      <h1 className="text-2xl font-extrabold text-slate-900">Payments</h1>
      {items === null ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-3xl bg-slate-100 animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <Receipt className="w-10 h-10 mx-auto mb-3 opacity-50" />
          No payments yet.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((p) => (
            <div key={p.id} className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm" data-testid={`payment-row-${p.id}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-900">{KIND_LABEL[p.kind] || p.kind}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{fmtDate(p.paid_at || p.created_at, true)}</div>
                </div>
                <div className="text-right">
                  <div className="font-extrabold text-slate-900">{inr(p.amount)}</div>
                  {p.extra_charge > 0 && (
                    <div className="text-[10px] text-red-500 font-semibold mb-1">
                      Rent {inr(p.base_rent)} + Extra KM {inr(p.extra_charge)}
                    </div>
                  )}
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold capitalize ${STATUS_UI[p.payment_status] || "bg-slate-100 text-slate-600"}`}>{p.payment_status}</span>
                </div>
              </div>
              {p.transaction_id && (
                <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-[11px] text-slate-400">
                  <span>{(p.payment_method || "—")}</span>
                  <span>TXN {p.transaction_id}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
