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

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-6 text-center" data-testid="blocked-screen">
      <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mb-5">
        <Lock className="w-10 h-10 text-red-600" />
      </div>
      <h1 className="text-2xl font-extrabold text-slate-900">Rental Account Blocked</h1>
      <p className="text-slate-500 text-sm mt-2 max-w-xs">
        Your rental account has {account?.overdue_days} days of outstanding rent. Clear the full amount to reactivate.
      </p>

      <div className="mt-6 w-full max-w-sm rounded-3xl bg-white border border-slate-100 p-6 shadow-sm">
        <div className="text-slate-500 text-sm">Outstanding</div>
        <div className="text-4xl font-extrabold text-red-600 mt-1" data-testid="blocked-outstanding">{inr(account?.outstanding_amount || 0)}</div>
        <div className="mt-4 space-y-2 text-sm">
          {(account?.unpaid_dates || []).map((d) => (
            <div key={d} className="flex justify-between text-slate-600"><span>{d}</span><span>{inr(rental?.daily_rate || 0)}</span></div>
          ))}
        </div>
        <button onClick={() => setOpen(true)} data-testid="blocked-pay-btn"
          className="mt-5 w-full h-12 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-semibold transition-colors">
          Pay Full Outstanding {inr(account?.outstanding_amount || 0)}
        </button>
        <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <CheckCircle2 className="w-3.5 h-3.5" /> Account activates only after full payment
        </div>
      </div>

      <PayModal open={open} kind="outstanding" title="Clear Outstanding Rent" amount={account?.outstanding_amount || 0}
        driverName={driver?.name} driverPhone={driver?.phone}
        lines={[
          ...(account?.unpaid_dates || []).map((d) => ({ label: d, value: inr(rental?.daily_rate || 0) })),
          { label: `Total (${account?.overdue_days || 0} days)`, value: inr(account?.outstanding_amount || 0), strong: true },
        ]}
        onClose={() => setOpen(false)} onDone={() => refresh()} />
    </div>
  );
}
