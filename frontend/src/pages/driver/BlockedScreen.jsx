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

  const dailyRate = rental?.daily_rate || 0;
  const unpaidDates = account?.unpaid_dates || [];
  const outstanding = account?.outstanding_amount || 0;

  // Build detailed lines — each unpaid date could have extra KM. Show base rent + extra if any.
  const perDayAmount = unpaidDates.length > 0 ? Math.round(outstanding / unpaidDates.length) : dailyRate;

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-6 text-center" data-testid="blocked-screen">
      <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mb-5">
        <Lock className="w-10 h-10 text-red-600" />
      </div>
      <h1 className="text-2xl font-extrabold text-slate-900">Rental Account Blocked</h1>
      <p className="text-slate-500 text-sm mt-2 max-w-xs">
        Your rental account has {account?.overdue_days} days of outstanding rent. Your Driver App is blocked and <strong className="text-red-500">your vehicle will be repossessed/taken back immediately.</strong> Clear the full amount to reactivate.
      </p>

      <div className="mt-6 w-full max-w-sm rounded-3xl bg-white border border-slate-100 p-6 shadow-sm">
        <div className="text-slate-500 text-sm">Outstanding</div>
        <div className="text-4xl font-extrabold text-red-600 mt-1" data-testid="blocked-outstanding">{inr(outstanding)}</div>
        <div className="mt-4 space-y-2 text-sm">
          {unpaidDates.map((d) => {
            const extraCharge = perDayAmount - dailyRate;
            return (
              <div key={d} className="flex justify-between items-start text-slate-600 border-b border-slate-50 pb-1">
                <span className="text-left">
                  <div className="font-medium">{d}</div>
                  <div className="text-xs text-slate-400">Rent {inr(dailyRate)}{extraCharge > 0 ? ` + Extra KM ${inr(extraCharge)}` : ""}</div>
                </span>
                <span className="font-semibold text-slate-800">{inr(perDayAmount)}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex justify-between text-sm font-bold text-slate-800 border-t border-slate-100 pt-3">
          <span>Total ({account?.overdue_days || 0} day{(account?.overdue_days || 0) > 1 ? "s" : ""})</span>
          <span className="text-red-600">{inr(outstanding)}</span>
        </div>
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
          ...unpaidDates.map((d) => {
            const extraCharge = perDayAmount - dailyRate;
            return { label: `${d}${extraCharge > 0 ? ` (Rent + Extra KM)` : ""}`, value: inr(perDayAmount) };
          }),
          { label: `Total (${account?.overdue_days || 0} days)`, value: inr(outstanding), strong: true },
        ]}
        onClose={() => setOpen(false)} onDone={() => refresh()} />
    </div>
  );
}
