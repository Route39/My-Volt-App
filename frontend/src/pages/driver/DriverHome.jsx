import { useState } from "react";
import { Bike, Wallet, ArrowRight, ShieldCheck, AlertTriangle, Lock } from "lucide-react";
import { useDriver } from "../../context/DriverAuthContext";
import { inr } from "../../lib/format";
import PayModal from "./PayModal";
import BlockedScreen from "./BlockedScreen";

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
  const [pay, setPay] = useState(null);
  if (!data) return null;
  const { driver, rental, account, deposit } = data;

  if (account?.status === "blocked") return <BlockedScreen />;

  const st = STATUS_UI[account?.status || "active"];
  const depositPaid = deposit?.status === "paid";

  return (
    <div className="px-5 pt-6 space-y-5" data-testid="driver-home">
      <div>
        <p className="text-slate-500 text-sm">{greeting()},</p>
        <h1 className="text-2xl font-extrabold text-slate-900">{driver.name} 👋</h1>
      </div>

      {/* Rental hero card */}
      <div className="rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-5 text-white shadow-lg shadow-emerald-200">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-emerald-50/90">Your Rental</span>
          <span className="text-[11px] bg-white/20 rounded-full px-2.5 py-1 font-semibold">{rental?.package_name || "—"} Package</span>
        </div>
        <div className="mt-3 flex items-end gap-1">
          <span className="text-4xl font-extrabold" data-testid="home-daily-rate">{inr(rental?.daily_rate || 0)}</span>
          <span className="text-emerald-50/90 mb-1">/ day</span>
        </div>
        <div className="mt-4 flex items-center gap-2 text-sm text-emerald-50">
          <Bike className="w-4 h-4" /> {rental?.vehicle_reg || driver.vehicle_reg || "No vehicle assigned"}
        </div>
      </div>

      {/* Today's rent */}
      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-slate-500 text-sm">Today's Rent</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-0.5" data-testid="home-today-rent">{inr(rental?.daily_rate || 0)}</div>
          </div>
          {account?.today_paid ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-600 font-semibold text-sm" data-testid="home-today-paid"><ShieldCheck className="w-4 h-4" /> Paid</span>
          ) : (
            <button onClick={() => setPay("daily")} data-testid="home-pay-rent-btn"
              className="inline-flex items-center gap-1.5 h-11 px-5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition-colors">
              Pay Rent <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm" data-testid="home-outstanding">
          <div className="flex items-center gap-1.5 text-slate-500 text-xs"><AlertTriangle className="w-3.5 h-3.5" /> Outstanding</div>
          <div className={`text-xl font-extrabold mt-1 ${account?.outstanding_amount ? "text-amber-600" : "text-slate-900"}`}>{inr(account?.outstanding_amount || 0)}</div>
          {account?.overdue_days > 0 && <div className="text-[11px] text-amber-600 mt-0.5">{account.overdue_days} day{account.overdue_days > 1 ? "s" : ""} unpaid</div>}
        </div>
        <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm" data-testid="home-deposit">
          <div className="flex items-center gap-1.5 text-slate-500 text-xs"><Wallet className="w-3.5 h-3.5" /> Security Deposit</div>
          <div className="text-xl font-extrabold mt-1 text-slate-900">{inr(deposit?.amount || 5000)}</div>
          <div className={`text-[11px] mt-0.5 ${depositPaid ? "text-emerald-600" : "text-amber-600"}`}>{depositPaid ? "✓ Paid" : "Pending"}</div>
        </div>
      </div>

      {/* Deposit CTA */}
      {!depositPaid && (
        <button onClick={() => setPay("deposit")} data-testid="home-pay-deposit-btn"
          className="w-full h-12 rounded-2xl border border-emerald-500 text-emerald-600 font-semibold hover:bg-emerald-50 transition-colors">
          Pay Security Deposit {inr(deposit?.amount || 5000)}
        </button>
      )}

      {/* Outstanding CTA */}
      {account?.overdue_days > 0 && (
        <button onClick={() => setPay("outstanding")} data-testid="home-pay-outstanding-btn"
          className="w-full h-12 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-colors">
          Pay Outstanding {inr(account.outstanding_amount)}
        </button>
      )}

      {/* Account status */}
      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm flex items-center justify-between" data-testid="home-status">
        <span className="text-slate-500 text-sm">Rental Account Status</span>
        <span className={`inline-flex items-center gap-2 font-bold uppercase text-sm ${st.text}`}>
          <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} /> {st.label}
        </span>
      </div>

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
      <PayModal open={pay === "daily"} kind="daily" title="Today's Rent" amount={rental?.daily_rate || 0}
        lines={[
          { label: `${rental?.package_name} · ${account?.today_date || "Today"}`, value: inr(rental?.daily_rate || 0) },
          { label: "Previous Outstanding", value: inr(account?.outstanding_amount || 0) },
          { label: "Total Payable", value: inr(rental?.daily_rate || 0), strong: true },
        ]} {...common} />
      <PayModal open={pay === "deposit"} kind="deposit" title="Security Deposit" amount={deposit?.amount || 5000}
        lines={[
          { label: "Refundable Security Deposit", value: inr(deposit?.amount || 5000) },
          { label: "Total Payable", value: inr(deposit?.amount || 5000), strong: true },
        ]} {...common} />
      <PayModal open={pay === "outstanding"} kind="outstanding" title="Outstanding Rent" amount={account?.outstanding_amount || 0}
        lines={[
          ...(account?.unpaid_dates || []).map((d) => ({ label: d, value: inr(rental?.daily_rate || 0) })),
          { label: `Total (${account?.overdue_days || 0} days)`, value: inr(account?.outstanding_amount || 0), strong: true },
        ]} {...common} />
    </>
  );
}
