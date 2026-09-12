import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bike, IndianRupee, AlertTriangle, Lock, Wallet, TrendingUp } from "lucide-react";
import api from "../lib/api";
import { PageHeader, FilterChip } from "../components/common/Page";
import { AnimatedCounter, Skeleton } from "../components/common/Primitives";
import { inr } from "../lib/format";

const STATUS_PILL = {
  active: "chip-green", overdue: "chip-amber", blocked: "bg-red-500/10 text-red-500 border border-red-500/20",
};

export default function RentalDrivers() {
  const nav = useNavigate();
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState("all");

  useEffect(() => { api.get("/rental-admin/summary").then((r) => setSummary(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    setRows(null);
    api.get("/rental-admin/drivers", { params: { status } }).then((r) => setRows(r.data)).catch(() => setRows([]));
  }, [status]);

  const kpis = summary ? [
    { label: "Active Rentals", value: summary.active_rentals, icon: TrendingUp, color: "text-green-500", bg: "bg-green-500/12" },
    { label: "Overdue", value: summary.overdue_rentals, icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/12" },
    { label: "Blocked", value: summary.blocked_rentals, icon: Lock, color: "text-red-500", bg: "bg-red-500/12" },
    { label: "Today Expected", value: summary.today_expected, icon: IndianRupee, color: "text-mv-primary", bg: "bg-blue-500/12", money: true },
    { label: "Today Collected", value: summary.today_collected, icon: IndianRupee, color: "text-green-500", bg: "bg-green-500/12", money: true },
    { label: "Outstanding", value: summary.outstanding_total, icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/12", money: true },
    { label: "Deposits Collected", value: summary.deposits_collected, icon: Wallet, color: "text-mv-primary", bg: "bg-blue-500/12", money: true },
  ] : [];

  return (
    <div data-testid="rental-drivers-page">
      <PageHeader title="Rental Drivers" subtitle="MyEVRental daily rental accounts — live from the driver app" />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {!summary && Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="mv-card p-4" data-testid={`rental-kpi-${k.label.toLowerCase().replace(/ /g, "-")}`}>
              <div className={`w-8 h-8 rounded-lg ${k.bg} flex items-center justify-center mb-2`}><Icon className={`w-4 h-4 ${k.color}`} /></div>
              <div className="font-display text-2xl font-bold">{k.money ? inr(k.value) : <AnimatedCounter value={k.value} />}</div>
              <div className="mv-label mt-0.5">{k.label}</div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {["all", "active", "overdue", "blocked"].map((s) => (
          <FilterChip key={s} active={status === s} onClick={() => setStatus(s)} data-testid={`rental-filter-${s}`}>
            {s === "all" ? "All Drivers" : s.charAt(0).toUpperCase() + s.slice(1)}
          </FilterChip>
        ))}
      </div>

      {rows === null ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : rows.length === 0 ? (
        <div className="mv-card p-12 text-center text-mv-muted">No rental drivers for this filter.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((d) => (
            <button key={d.driver_id} onClick={() => nav(`/rental-drivers/${d.driver_id}`)} data-testid={`rental-driver-${d.driver_id}`}
              className="w-full mv-card mv-card-hover p-4 flex items-center gap-4 text-left">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/12 flex items-center justify-center shrink-0"><Bike className="w-5 h-5 text-emerald-600" /></div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{d.driver_name}</div>
                <div className="text-xs text-mv-muted truncate">{d.vehicle_reg} · {d.package_name} · {inr(d.daily_rate)}/day</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold">{d.outstanding ? <span className="text-amber-600">{inr(d.outstanding)}</span> : inr(0)}</div>
                <span className={`chip ${STATUS_PILL[d.status]} capitalize mt-1`}>{d.status}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
