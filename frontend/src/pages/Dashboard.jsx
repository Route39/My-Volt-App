import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import {
  Car, KeyRound, CheckCircle2, Wrench, PowerOff, AlertTriangle, ArrowRight,
  ChevronRight, TrendingUp, Users, UserCheck, UserX,
} from "lucide-react";
import api from "../lib/api";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { AnimatedCounter, Skeleton } from "../components/common/Primitives";
import { timeAgo } from "../lib/format";

const STATUS_COLORS = { rented: "#ef4444", available: "#22c55e", service: "#f59e0b", inactive: "#71717a", idle: "#a78bfa" };

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
  const [rentToday, setRentToday] = useState(null);
  const [dcRows, setDcRows] = useState([]);
  const [drvList, setDrvList] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    let alive = true;
    setData(null);
    api.get("/dashboard/summary", { params: { city } }).then((r) => alive && setData(r.data)).catch(() => {});
    api.get("/dashboard/recent", { params: { limit: 12 } }).then((r) => alive && setRecent(r.data)).catch(() => {});
    const today = new Date().toLocaleDateString("en-CA");
    setRentToday(null);
    api.get("/drivers", { params: city && city !== "all" ? { city } : {} }).then((r) => alive && setDrvList(Array.isArray(r.data) ? r.data : [])).catch(() => alive && setDrvList([]));
    api.get("/admin/daily-collection", { params: { from_date: today, to_date: today, ...(city && city !== "all" ? { city } : {}) } })
      .then((r) => {
        if (!alive) return;
        const rows = (Array.isArray(r.data) ? r.data : []).filter((x) => !x.is_paid_leave);
        const count = (fn) => new Set(rows.filter(fn).map((x) => x.driver_id)).size;
        setRentToday({ paid: count((x) => x.rent_status === "paid"), unpaid: count((x) => x.rent_status !== "paid") });
        setDcRows(rows);
      })
      .catch(() => alive && setRentToday({ paid: 0, unpaid: 0 }));
    return () => { alive = false; };
  }, [city]);

  const f = data?.fleet;
  const drv = data?.drivers;
  const donut = f ? [
    { name: "Rented", value: f.rented, key: "rented" },
    { name: "Available", value: f.available, key: "available" },
    { name: "Service", value: f.service, key: "service" },
    { name: "Inactive", value: f.inactive + f.idle, key: "inactive" },
  ].filter((d) => d.value > 0) : [];

  const cityQuery = city && city !== "all" ? `city=${encodeURIComponent(city)}` : "";
  const toUrl = (basePath, extraParam) => {
    const parts = [extraParam, cityQuery].filter(Boolean);
    return parts.length > 0 ? `${basePath}?${parts.join("&")}` : basePath;
  };

  const kpis = f ? [
    {
      label: "Total Vehicles",
      value: f.total,
      icon: Car,
      color: "text-red-400",
      bg: "bg-red-500/15",
      to: toUrl("/fleet")
    },
    {
      label: "Online Drivers",
      value: drv?.online ?? 0,
      icon: UserCheck,
      color: "text-red-400",
      bg: "bg-red-500/15",
      to: toUrl("/drivers", "status=online")
    },
    {
      label: "Offline Drivers",
      value: drv?.offline ?? 0,
      icon: UserX,
      color: "text-slate-400",
      bg: "bg-slate-500/15",
      to: toUrl("/drivers", "status=offline")
    },
    {
      label: "Inactive Vehicles",
      value: f.inactive + f.idle,
      icon: PowerOff,
      color: "text-zinc-400",
      bg: "bg-zinc-500/15",
      to: toUrl("/fleet", "status=inactive")
    },
    {
      label: "Vehicles Under Maintenance",
      value: f.service,
      icon: Wrench,
      color: "text-amber-400",
      bg: "bg-amber-500/15",
      to: toUrl("/fleet", "status=service")
    },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mv-rise">
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight flex items-center gap-3">
          {user?.org_name || "Route39 EV Rental"} <span className="chip chip-blue text-[10px] font-bold">COMMAND CENTER</span>
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
            <div className="flex flex-col xl:flex-row items-center gap-4">
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
              <div className="w-full xl:w-auto xl:flex-1 min-w-0 space-y-2.5">
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
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {!data && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
          {data?.cities.map((c) => {
            const pct = c.total ? (c.rented / c.total) * 100 : 0;
            return (
              <button key={c.city} onClick={() => nav(`/fleet?city=${c.city}`)} data-testid={`city-card-${c.city}`}
                      className="mv-card mv-card-hover p-5 text-left">
                <div className="flex items-center justify-between">
                  <span className="font-display font-semibold uppercase tracking-wide">{c.city}</span>
                  <span className="text-xs text-mv-dim whitespace-nowrap shrink-0 ml-2">{c.total} vehicles</span>
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

      <div>
        <h2 className="font-display text-xl font-semibold mb-4">Drivers &amp; Rent Today</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: "Drivers Onboarded", value: drv?.total, icon: Users, color: "text-red-500", bg: "bg-red-500/15", sub: "Total drivers so far" },
            { label: "Rent Paid", value: rentToday?.paid, icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/15", sub: "Today" },
            { label: "Rent Unpaid", value: rentToday?.unpaid, icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/15", sub: "Today" },
          ].map((k) => (
            <div key={k.label} className="mv-card p-5">
              <div className={`w-10 h-10 rounded-xl ${k.bg} flex items-center justify-center`}><k.icon className={`w-5 h-5 ${k.color}`} /></div>
              <div className="font-display text-3xl font-bold mt-4">{k.value == null ? <Skeleton className="h-8 w-12" /> : <AnimatedCounter value={k.value} />}</div>
              <div className="text-xs tracking-widest uppercase text-mv-dim mt-1">{k.label}</div>
              <div className="text-xs text-mv-muted mt-1">{k.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-display text-xl font-semibold mb-4">City-wise Drivers &amp; Rent Today</h2>
        {(() => {
          const order = ["Tiruppur", "Coimbatore", "Chennai", "Bangalore"];
          const names = Array.from(new Set([...order, ...(drvList || []).map((d) => d.city).filter(Boolean)]))
            .filter((c) => (drvList || []).some((d) => d.city === c));
          if (!drvList) return <Skeleton className="h-32 rounded-2xl" />;
          if (!names.length) return <div className="mv-card p-6 text-sm text-mv-muted text-center">No drivers yet.</div>;
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {names.map((c) => {
                const total = drvList.filter((d) => d.city === c).length;
                const cr = dcRows.filter((x) => x.city === c);
                const cnt = (fn) => new Set(cr.filter(fn).map((x) => x.driver_id)).size;
                const paid = cnt((x) => x.rent_status === "paid"), unpaid = cnt((x) => x.rent_status !== "paid");
                return (
                  <div key={c} className="mv-card p-5">
                    <div className="font-display font-bold uppercase tracking-wide mb-4">{c}</div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div><div className="font-display text-2xl font-bold">{total}</div><div className="text-[10px] uppercase tracking-widest text-mv-dim mt-1">Onboarded</div></div>
                      <div><div className="font-display text-2xl font-bold text-green-600">{paid}</div><div className="text-[10px] uppercase tracking-widest text-mv-dim mt-1">Rent Paid</div></div>
                      <div><div className="font-display text-2xl font-bold text-amber-500">{unpaid}</div><div className="text-[10px] uppercase tracking-widest text-mv-dim mt-1">Unpaid</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
