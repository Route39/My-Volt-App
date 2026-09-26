import { User, Bike, Package, Wallet, ShieldCheck, LogOut, Phone, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDriver } from "../../context/DriverAuthContext";
import { inr } from "../../lib/format";

const STATUS_UI = {
  active: "text-emerald-600", overdue: "text-amber-600", blocked: "text-red-600",
};

export default function DriverProfile() {
  const { data, logout } = useDriver();
  const nav = useNavigate();
  if (!data) return null;
  const { driver, rental, account, deposit } = data;

  const doLogout = async () => { await logout(); nav("/driver/login"); };

  return (
    <div className="px-5 pt-6 space-y-5" data-testid="driver-profile">
      <div className="flex flex-col items-center">
        <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
          <User className="w-10 h-10 text-emerald-600" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-900 mt-3">{driver.name}</h1>
        <div className="flex items-center gap-4 mt-1">
          <div className="flex items-center gap-1.5 text-slate-500 text-sm"><Phone className="w-3.5 h-3.5" /> {driver.phone}</div>
          {driver.city && <div className="flex items-center gap-1.5 text-slate-500 text-sm"><MapPin className="w-3.5 h-3.5" /> {driver.city}</div>}
        </div>
      </div>

      <div className="rounded-3xl bg-white border border-slate-100 p-5 shadow-sm space-y-3">
        <Row icon={Bike} label="Vehicle" value={rental?.vehicle_reg || driver.vehicle_reg || "—"} />
        <Row icon={Package} label="Package" value={rental ? `${rental.package_name} · ${inr(rental.daily_rate)}/day` : "—"} />
        <Row icon={Wallet} label="Security Deposit" value={`${inr(deposit?.amount ?? 0)} · ${deposit?.status === "paid" ? "Paid" : "Pending"}`} />
        <Row icon={ShieldCheck} label="Account Status"
          value={<span className={`font-bold uppercase ${STATUS_UI[account?.status || "active"]}`}>{account?.status || "active"}</span>} />
        <Row label="Outstanding" value={inr(account?.outstanding_amount || 0)} />
      </div>

      <button onClick={doLogout} data-testid="driver-logout-btn"
        className="w-full h-12 rounded-2xl border border-slate-200 text-red-600 font-semibold flex items-center justify-center gap-2 hover:bg-red-50 transition-colors">
        <LogOut className="w-4 h-4" /> Log Out
      </button>
      <p className="text-center text-xs text-slate-400 pt-2">MyEVRental · powered by MyVolt</p>
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
