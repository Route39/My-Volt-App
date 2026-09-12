import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import {
  Car, KeyRound, CheckCircle2, Wrench, PowerOff, AlertTriangle, ArrowRight,
  Activity, ChevronRight, TrendingUp,
} from "lucide-react";
import api from "../lib/api";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { AnimatedCounter, Skeleton } from "../components/common/Primitives";
import { timeAgo } from "../lib/format";

const STATUS_COLORS = { rented: "#3b82f6", available: "#22c55e", service: "#f59e0b", inactive: "#71717a", idle: "#a78bfa" };

const ACTION_ICONS = {
  rental_activated: KeyRound, rental_created: KeyRound, rental_renewed: KeyRound, payment_recorded: KeyRound,
  vehicle_assigned: Car, driver_assigned: Car, vehicle_transferred: Car, vehicle_created: Car,
  service_request_created: Wrench, service_completed: Wrench, service_request_updated: Wrench,
  document_updated: CheckCircle2, incident_reported: AlertTriangle,
};

export default function Dashboard() {
  const { city } = useApp();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [recent, setRecent] = useState([]);
  const nav = useNavigate();

  useEffect(() => {
    let alive = true;
    setData(null);
    api.get("/dashboard/summary", { params: { city } }).then((r) => alive && setData(r.data)).catch(() => {});
    api.get("/dashboard/recent", { params: { limit: 12 } }).then((r) => alive && setRecent(r.data)).catch(() => {});
    return () => { alive = false; };
  }, [city]);

  const f = data?.fleet;
  const donut = f ? [
    { name: "Rented", value: f.rented, key: "rented" },
    { name: "Available", value: f.available, key: "available" },
    { name: "Service", value: f.service, key: "service" },
    { name: "Inactive", value: f.inactive + f.idle, key: "inactive" },
  ].filter((d) => d.value > 0) : [];

  const kpis = f ? [
    { label: "Total Fleet", value: f.total, icon: Car, color: "text-mv-primary", bg: "bg-blue-500/15", to: "/fleet" },
    { label: "Rented", value: f.rented, icon: KeyRound, color: "text-blue-400", bg: "bg-blue-500/15", to: "/fleet?status=rented" },
    { label: "Available", value: f.available, icon: CheckCircle2, color: "text-green-400", bg: "bg-green-500/15", to: "/fleet?status=available" },
    { label: "Service", value: f.service, icon: Wrench, color: "text-amber-400", bg: "bg-amber-500/15", to: "/fleet?status=service" },
    { label: "Inactive", value: f.inactive + f.idle, icon: PowerOff, color: "text-zinc-400", bg: "bg-zinc-500/15", to: "/fleet?status=inactive" },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mv-rise">
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight flex items-center gap-3">
          {user?.org_name || "MyVolt"} <span className="chip chip-blue text-[10px] font-bold">COMMAND CENTER</span>
        </h1>
        <p className="text-mv-muted mt-1">Fleet Operations · {city === "all" ? "All Cities" : city} · Welcome, {user?.name}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {!f && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {kpis.map((k, i) => {
          const Icon = k.icon;
          return (
            <button key={k.label} onClick={() => nav(k.to)} data-testid={`kpi-${k.label.toLowerCase().replace(/ /g, "-")}`}
                    className="mv-card mv-card-hover p-4 sm:p-5 text-left mv-rise" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-center justify-between">
                <div className={`w-9 h-9 rounded-xl ${k.bg} flex items-center justify-center`}><Icon className={`w-4.5 h-4.5 ${k.color}`} /></div>
                <ArrowRight className="w-4 h-4 text-mv-dim" />
              </div>
              <div className="font-display text-3xl sm:text-4xl font-bold mt-3"><AnimatedCounter value={k.value} /></div>
              <div className="mv-label mt-1">{k.label}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Fleet status donut */}
        <div className="lg:col-span-5 mv-card p-5 sm:p-6 mv-rise">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display text-lg font-semibold">Fleet Status</h3>
            <span className="mv-label">Live</span>
          </div>
          {!f ? <Skeleton className="h-56 rounded-xl" /> : (
            <div className="flex items-center gap-4">
              <div className="relative w-40 h-40 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donut} dataKey="value" innerRadius={52} outerRadius={72} paddingAngle={3} startAngle={90} endAngle={-270} stroke="none">
                      {donut.map((d) => <Cell key={d.key} fill={STATUS_COLORS[d.key]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="font-display text-3xl font-bold"><AnimatedCounter value={f.total} /></div>
                  <div className="text-[10px] text-mv-dim uppercase tracking-wider">Vehicles</div>
                </div>
              </div>
              <div className="flex-1 space-y-2.5">
                {donut.map((d) => (
                  <div key={d.key} className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS[d.key] }} />
                    <span className="text-sm text-mv-muted flex-1">{d.name}</span>
                    <span className="text-sm font-semibold">{d.value}</span>
                    <span className="text-xs text-mv-dim w-10 text-right">{Math.round((d.value / f.total) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Rental snapshot */}
        <div className="lg:col-span-7 mv-card p-5 sm:p-6 mv-rise">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg font-semibold">Rental Snapshot</h3>
            <button onClick={() => nav("/rentals")} className="text-sm text-mv-primary hover:underline flex items-center gap-1">
              View all <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {!data ? <Skeleton className="h-40 rounded-xl" /> : (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { l: "Active", v: data.rentals.active, c: "text-green-400", to: "/rentals?status=active" },
                { l: "Expiring Today", v: data.rentals.expiring_today, c: "text-amber-400", to: "/rentals?status=expiring" },
                { l: "Expiring Soon", v: data.rentals.expiring_soon, c: "text-amber-400", to: "/rentals?status=expiring" },
                { l: "Payment Pending", v: data.rentals.payment_pending, c: "text-red-400", to: "/rentals?status=pending_payment" },
                { l: "Suspended", v: data.rentals.suspended, c: "text-red-400", to: "/rentals?status=suspended" },
              ].map((r) => (
                <button key={r.l} onClick={() => nav(r.to)} className="mv-card-hover mv-card bg-mv-surface2 p-4 text-left">
                  <div className={`font-display text-2xl sm:text-3xl font-bold ${r.c}`}><AnimatedCounter value={r.v} /></div>
                  <div className="text-[11px] text-mv-muted mt-1 leading-tight">{r.l}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* City overview */}
      <div className="mv-rise">
        <h3 className="font-display text-lg font-semibold mb-3">City Overview</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {!data && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
          {data?.cities.map((c) => {
            const pct = c.total ? (c.rented / c.total) * 100 : 0;
            return (
              <button key={c.city} onClick={() => nav(`/fleet?city=${c.city}`)} data-testid={`city-card-${c.city}`}
                      className="mv-card mv-card-hover p-5 text-left">
                <div className="flex items-center justify-between">
                  <span className="font-display font-semibold uppercase tracking-wide">{c.city}</span>
                  <span className="text-xs text-mv-dim">{c.total} vehicles</span>
                </div>
                <div className="font-display text-3xl font-bold mt-2"><AnimatedCounter value={c.rented} /> <span className="text-base text-mv-dim font-normal">rented</span></div>
                <div className="mt-3 h-2 rounded-full bg-mv-elevated overflow-hidden">
                  <div className="h-full rounded-full bg-mv-primary transition-[width] duration-700" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between mt-3 text-xs">
                  <span className="text-green-400">{c.available} available</span>
                  <span className="text-amber-400">{c.service} service</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Needs attention */}
        <div className="lg:col-span-6 mv-card p-5 sm:p-6 mv-rise">
          <h3 className="font-display text-lg font-semibold flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-400" /> Needs Attention
          </h3>
          {!data ? <Skeleton className="h-40 rounded-xl" /> : data.attention.length === 0 ? (
            <div className="py-10 text-center text-mv-muted text-sm">All clear. Nothing needs attention right now ✓</div>
          ) : (
            <div className="space-y-2">
              {data.attention.map((a, i) => (
                <button key={i} onClick={() => nav(a.link)} data-testid={`attention-${i}`}
                        className="w-full flex items-center gap-3 p-3 rounded-xl bg-mv-surface2 hover:bg-mv-elevated transition-colors text-left">
                  <span className={`w-2 h-2 rounded-full ${a.level === "red" ? "bg-red-500" : "bg-amber-500"}`} />
                  <span className="text-sm flex-1">{a.label}</span>
                  <ChevronRight className="w-4 h-4 text-mv-dim" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Recent operations */}
        <div className="lg:col-span-6 mv-card p-5 sm:p-6 mv-rise">
          <h3 className="font-display text-lg font-semibold flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-mv-primary" /> Recent Operations
          </h3>
          {recent.length === 0 ? <div className="py-10 text-center text-mv-dim text-sm">No recent activity yet.</div> : (
            <div className="relative pl-5 space-y-4 max-h-80 overflow-y-auto no-scrollbar">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-mv-border" />
              {recent.map((r, i) => {
                const Icon = ACTION_ICONS[r.action] || Activity;
                return (
                  <div key={r.id} className="relative flex gap-3 mv-fade" style={{ animationDelay: `${i * 40}ms` }}>
                    <div className="absolute -left-5 w-4 h-4 rounded-full bg-mv-surface border-2 border-mv-primary" />
                    <Icon className="w-4 h-4 text-mv-muted mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm text-mv-text">{r.summary}</div>
                      <div className="text-[11px] text-mv-dim">{r.city ? `${r.city} · ` : ""}{timeAgo(r.created_at)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
