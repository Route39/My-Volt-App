import { useState } from "react";
import { Bike, Package, AlertTriangle, ShieldCheck } from "lucide-react";
import { useDriver } from "../../context/DriverAuthContext";
import { inr, fmtDate } from "../../lib/format";
import { PayModals } from "./DriverHome";
import BlockedScreen from "./BlockedScreen";

export default function DriverRental() {
  const { data, refresh } = useDriver();
  const [pay, setPay] = useState(null);
  if (!data) return null;
  const { rental, account, deposit, driver } = data;

  if (account?.status === "blocked") return <BlockedScreen />;

  return (
    <div className="px-5 pt-6 space-y-5" data-testid="driver-rental">
      <h1 className="text-2xl font-extrabold text-slate-900">My Rental</h1>

      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3">
        <Row icon={Package} label="Package" value={`${rental?.package_name} · ${inr(rental?.daily_rate || 0)}/day`} />
        <Row icon={Bike} label="Vehicle" value={rental?.vehicle_reg || "—"} />
        <Row label="Rental Start" value={rental?.start_date ? fmtDate(rental.start_date) : "—"} />
        <Row label="Deposit" value={`${inr(deposit?.amount || 5000)} · ${deposit?.status === "paid" ? "Paid" : "Pending"}`} />
      </div>

      {/* Today */}
      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm">
        <div className="text-slate-500 text-sm">Today's Rent</div>
        <div className="flex items-center justify-between mt-1">
          <div className="text-2xl font-extrabold text-slate-900">{inr(rental?.daily_rate || 0)}</div>
          {account?.today_paid
            ? <span className="inline-flex items-center gap-1.5 text-emerald-600 font-semibold text-sm"><ShieldCheck className="w-4 h-4" /> Paid</span>
            : <button onClick={() => setPay("daily")} data-testid="rental-pay-rent-btn" className="h-11 px-5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition-colors">Pay Now</button>}
        </div>
      </div>

      {/* Outstanding */}
      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm" data-testid="rental-outstanding">
        <div className="flex items-center gap-1.5 text-slate-500 text-sm"><AlertTriangle className="w-4 h-4" /> Outstanding Rent</div>
        {account?.overdue_days > 0 ? (
          <>
            <div className="text-3xl font-extrabold text-amber-600 mt-1">{account.overdue_days} Day{account.overdue_days > 1 ? "s" : ""}</div>
            <div className="text-lg font-bold text-slate-900">{inr(account.outstanding_amount)}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {account.unpaid_dates.map((d) => (
                <span key={d} className="px-2 py-1 bg-slate-100 text-slate-600 rounded font-medium">{fmtDate(d)}</span>
              ))}
            </div>
            <button onClick={() => setPay("outstanding")} data-testid="rental-pay-outstanding-btn"
              className="mt-4 w-full h-12 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-colors">
              Pay {inr(account.outstanding_amount)}
            </button>
          </>
        ) : (
          <div className="text-slate-900 font-bold text-lg mt-1">₹0 · All clear ✓</div>
        )}
      </div>

      {deposit?.status !== "paid" && (
        <button onClick={() => setPay("deposit")} data-testid="rental-pay-deposit-btn"
          className="w-full h-12 rounded-2xl border border-emerald-500 text-emerald-600 font-semibold hover:bg-emerald-50 transition-colors">
          Pay Security Deposit. {inr(deposit?.amount)}
        </button>
      )}

      <PayModals pay={pay} setPay={setPay} data={data} refresh={refresh} />
    </div>
  );
}

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-slate-500 text-sm">{Icon && <Icon className="w-4 h-4" />}{label}</span>
      <span className="font-semibold text-slate-800 text-sm text-right">{value}</span>
    </div>
  );
}
