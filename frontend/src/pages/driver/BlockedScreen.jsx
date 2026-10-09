import { useState } from "react";
import { Lock, CheckCircle2 } from "lucide-react";
import { useDriver } from "../../context/DriverAuthContext";
import { inr } from "../../lib/format";
import PayModal from "./PayModal";

export default function BlockedScreen() {
  const { data, refresh } = useDriver();
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const { account, rental, driver } = data;

  const outstanding = account?.outstanding_amount || 0;
  const extraKmDue = account?.extra_km_due || 0;

  // The block is based ONLY on fully-elapsed unpaid days (never today's or a
  // future day's rent — see blocked_dates/blocked_rent_amount/blocked_total_amount
  // from the backend). Falls back to the legacy fields for accounts that predate
  // this split, so old/edge-case data still renders something sensible.
  const blockedDates = account?.blocked_dates
    ?? Object.keys(account?.rent_by_date || {}).filter((d) => d !== account?.today_date);
  const blockedRentAmount = account?.blocked_rent_amount
    ?? blockedDates.reduce((sum, d) => sum + (account?.rent_by_date?.[d] || 0), 0);
  const blockedTotalAmount = account?.blocked_total_amount ?? (blockedRentAmount + extraKmDue);

  const rentByDate = account?.rent_by_date || {};
  const rows = [
    ...blockedDates.slice().sort().map((d) => ({ date: d, amount: rentByDate[d] || 0, note: `Rent ${inr(rentByDate[d] || 0)}` })),
    ...(extraKmDue > 0 ? [{ date: "Extra KM charges", amount: extraKmDue, note: "From your last trip" }] : []),
  ];
  const dayCount = blockedDates.length;

  // Paying "outstanding" clears the account fully in one payment, so the button
  // still requests exactly what the backend expects (outstanding_amount) — this
  // can be slightly more than blockedTotalAmount if today's rent has already
  // accrued while blocked; that difference is called out below, not hidden.
  const todaysAlreadyAccrued = Math.max(0, outstanding - blockedTotalAmount);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-6 text-center" data-testid="blocked-screen">
      <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mb-5">
        <Lock className="w-10 h-10 text-red-600" />
      </div>
      <h1 className="text-2xl font-extrabold text-slate-900">Rental Account Blocked</h1>
      <p className="text-slate-500 text-sm mt-2 max-w-xs">
        Your rental account has {dayCount} day{dayCount > 1 ? "s" : ""} of unpaid rent. Your Driver App is blocked and <strong className="text-red-500">your vehicle will be repossessed/taken back immediately.</strong> 
        <br /><br /><span className="text-xs">Note: Daily rental amount must be paid whether you operate the vehicle or keep it idle.</span>
      </p>

      <div className="mt-6 w-full max-w-sm rounded-3xl bg-white border border-slate-100 p-6 shadow-sm">
        <div className="text-slate-500 text-sm">Overdue Amount</div>
        <div className="text-4xl font-extrabold text-red-600 mt-1" data-testid="blocked-outstanding">{inr(blockedTotalAmount)}</div>
        <div className="mt-4 space-y-2 text-sm">
          {rows.map((r) => (
            <div key={r.date} className="flex justify-between items-start text-slate-600 border-b border-slate-50 pb-1">
              <span className="text-left">
                <div className="font-medium">{r.date}</div>
                <div className="text-xs text-slate-400">{r.note}</div>
              </span>
              <span className="font-semibold text-slate-800">{inr(r.amount)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between text-sm font-bold text-slate-800 border-t border-slate-100 pt-3">
          <span>Total ({dayCount} day{dayCount > 1 ? "s" : ""})</span>
          <span className="text-red-600">{inr(blockedTotalAmount)}</span>
        </div>
        {todaysAlreadyAccrued > 0 && (
          <div className="mt-2 text-xs text-slate-400 text-center">
            + {inr(todaysAlreadyAccrued)} today's rent, already charged
          </div>
        )}
        <button onClick={() => setOpen(true)} data-testid="blocked-pay-btn"
          className="mt-5 w-full h-12 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-semibold transition-colors">
          Pay Full Outstanding {inr(outstanding)}
        </button>
        <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <CheckCircle2 className="w-3.5 h-3.5" /> Account activates only after full payment
        </div>
      </div>

      <PayModal open={open} kind="outstanding" title="Clear Outstanding Rent" amount={outstanding}
        driverName={driver?.name} driverPhone={driver?.phone}
        lines={[
          ...rows.map((r) => ({ label: r.date, value: inr(r.amount) })),
          ...(todaysAlreadyAccrued > 0 ? [{ label: "Today's rent (already charged)", value: inr(todaysAlreadyAccrued) }] : []),
          { label: "Total Payable", value: inr(outstanding), strong: true },
        ]}
        onClose={() => setOpen(false)} onDone={() => refresh()} />
    </div>
  );
}
