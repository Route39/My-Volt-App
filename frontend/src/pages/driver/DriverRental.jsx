import { useState } from "react";
import { Bike, Package } from "lucide-react";
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
        <Row icon={Package} label="Package" value={rental?.package_name || rental?.plan_name || "Standard"} />
        <Row icon={Bike} label="Vehicle" value={rental?.vehicle_reg || rental?.vehicle_number || "—"} />
        <Row label="Rental Start" value={(rental?.start_date || rental?.start) ? fmtDate(rental.start_date || rental.start) : "—"} />
        <Row label="Deposit" value={`${inr(deposit?.amount ?? 0)} · ${deposit?.status === "paid" ? "Paid" : "Pending"}`} />
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
