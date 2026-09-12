import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Bike, Package, Wallet, ShieldCheck, AlertTriangle } from "lucide-react";
import api from "../lib/api";
import { Skeleton } from "../components/common/Primitives";
import { inr, fmtDate } from "../lib/format";

const STATUS_PILL = { active: "chip-green", overdue: "chip-amber", blocked: "bg-red-500/10 text-red-500 border border-red-500/20" };
const KIND_LABEL = { deposit: "Security Deposit", daily: "Daily Rent", outstanding: "Outstanding" };
const PAY_PILL = { paid: "chip-green", pending: "chip-amber", failed: "bg-red-500/10 text-red-500" };

export default function RentalDriverDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  useEffect(() => { api.get(`/rental-admin/drivers/${id}`).then((r) => setD(r.data)).catch(() => {}); }, [id]);

  if (!d) return <div className="space-y-4"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /></div>;
  const { rental, account, deposit, payments } = d;

  return (
    <div data-testid="rental-driver-detail">
      <button onClick={() => nav("/rental-drivers")} className="flex items-center gap-1.5 text-sm text-mv-muted hover:text-mv-text mb-4"><ArrowLeft className="w-4 h-4" /> Rental Drivers</button>

      <div className="mv-card p-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/12 flex items-center justify-center shrink-0"><Bike className="w-8 h-8 text-emerald-600" /></div>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-display text-2xl font-bold">{rental.driver_name}</h1>
            <span className={`chip ${STATUS_PILL[account.status]} capitalize`} data-testid="detail-status">{account.status}</span>
          </div>
          <div className="text-mv-muted text-sm mt-1">{rental.driver_phone} · {rental.vehicle_reg}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <Stat icon={Package} label="Package" value={`${rental.package_name}`} sub={`${inr(rental.daily_rate)}/day`} />
        <Stat icon={Wallet} label="Deposit" value={inr(deposit?.amount || 5000)} sub={deposit?.status === "paid" ? "Paid" : "Pending"} />
        <Stat icon={ShieldCheck} label="Today's Rent" value={account.today_paid ? "Paid ✓" : "Due"} sub={inr(rental.daily_rate)} />
        <Stat icon={AlertTriangle} label="Outstanding" value={inr(account.outstanding_amount)} sub={`${account.overdue_days} overdue day(s)`} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <Stat label="Rental Start" value={fmtDate(rental.start_date)} />
        <Stat label="Deposit Txn" value={deposit?.transaction_id || "—"} />
        <Stat label="Reactivated" value={account.reactivated_at ? fmtDate(account.reactivated_at, true) : "—"} />
        <Stat label="Organization" value={rental.organization_id} />
      </div>

      <div className="mv-card p-5 mt-4">
        <h3 className="font-display font-semibold mb-3">Payment History</h3>
        {payments.length === 0 ? <div className="text-mv-muted text-sm py-6 text-center">No payments yet.</div> : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-mv-surface2" data-testid={`detail-payment-${p.id}`}>
                <div>
                  <div className="text-sm font-medium">{KIND_LABEL[p.kind] || p.kind}</div>
                  <div className="text-[11px] text-mv-dim">{fmtDate(p.paid_at || p.created_at, true)}{p.transaction_id ? ` · ${p.transaction_id}` : ""}{p.payment_method ? ` · ${p.payment_method}` : ""}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">{inr(p.amount)}</div>
                  <span className={`chip ${PAY_PILL[p.payment_status] || "chip-neutral"} capitalize`}>{p.payment_status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="mv-card p-4">
      <div className="flex items-center gap-1.5 mv-label">{Icon && <Icon className="w-3.5 h-3.5" />}{label}</div>
      <div className="text-sm font-semibold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-mv-dim mt-0.5">{sub}</div>}
    </div>
  );
}
