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

const fmtD = (d) => d.toLocaleDateString("en-CA");
const presetRange = (k) => {
  const t = new Date();
  const add = (n) => { const x = new Date(t); x.setDate(x.getDate() + n); return x; };
  if (k === "yesterday") return { from: fmtD(add(-1)), to: fmtD(add(-1)) };
  if (k === "week") return { from: fmtD(add(-((t.getDay() + 6) % 7))), to: fmtD(t) };
  if (k === "month") return { from: fmtD(new Date(t.getFullYear(), t.getMonth(), 1)), to: fmtD(t) };
  if (k === "lastmonth") return { from: fmtD(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: fmtD(new Date(t.getFullYear(), t.getMonth(), 0)) };
  return { from: fmtD(t), to: fmtD(t) };
};
const PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["week", "This Week"], ["month", "This Month"], ["lastmonth", "Last Month"]];

export default function Dashboard() {
  const { city, setCity } = useApp();
  const [preset, setPreset] = useState("today");
  const [range, setRange] = useState(presetRange("today"));
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [recent, setRecent] = useState([]);
  const [rentToday, setRentToday] = useState(null);
  const [dcRows, setDcRows] = useState([]);
  const [drvList, setDrvList] = useState(null);
  const [mgrs, setMgrs] = useState([]);
  const [freeVeh, setFreeVeh] = useState(null);
  const [pendOpen, setPendOpen] = useState(null);
  const nav = useNavigate();
  const rangeLabel = preset === "custom" ? `${range.from} → ${range.to}` : (PRESETS.find((p) => p[0] === preset) || [])[1];

  useEffect(() => {
    let alive = true;
    setData(null);
    api.get("/dashboard/summary", { params: { city } }).then((r) => alive && setData(r.data)).catch(() => {});
    api.get("/dashboard/recent", { params: { limit: 12 } }).then((r) => alive && setRecent(r.data)).catch(() => {});
    setRentToday(null);
    setFreeVeh(null);
    api.get("/vehicles", { params: { status: "available", page_size: 500, ...(city && city !== "all" ? { city } : {}) } }).then((r) => alive && setFreeVeh(r.data?.items || (Array.isArray(r.data) ? r.data : []))).catch(() => alive && setFreeVeh([]));
    api.get("/users").then((r) => alive && setMgrs((r.data || []).filter((u) => u.role === "city_manager"))).catch(() => {});
    api.get("/drivers", { params: city && city !== "all" ? { city } : {} }).then((r) => alive && setDrvList(Array.isArray(r.data) ? r.data : [])).catch(() => alive && setDrvList([]));
    api.get("/admin/daily-collection", { params: { from_date: range.from, to_date: range.to, ...(city && city !== "all" ? { city } : {}) } })
      .then((r) => {
        if (!alive) return;
        const rows = (Array.isArray(r.data) ? r.data : []).filter((x) => !x.is_paid_leave);
        const count = (fn) => new Set(rows.filter(fn).map((x) => x.driver_id)).size;
        setRentToday({ paid: count((x) => x.rent_status === "paid"), unpaid: count((x) => x.rent_status !== "paid") });
        setDcRows(rows);
      })
      .catch(() => alive && setRentToday({ paid: 0, unpaid: 0 }));
    return () => { alive = false; };
  }, [city, range.from, range.to]);

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
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            {["all", "Tiruppur", "Coimbatore", "Chennai", "Bangalore"].map((c) => (<button key={c} onClick={() => setCity(c)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${city === c ? "bg-mv-primary text-white border-mv-primary" : "bg-white text-mv-muted border-mv-border hover:border-mv-primary"}`}>{c === "all" ? "All Cities" : c}</button>))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map(([k, l]) => (<button key={k} onClick={() => { setPreset(k); if (k !== "custom") setRange(presetRange(k)); }} className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${preset === k ? "bg-mv-primary text-white border-mv-primary" : "bg-white text-mv-muted border-mv-border hover:border-mv-primary"}`}>{l}</button>))}
            {(<><input type="date" value={range.from} max={range.to} onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, from: e.target.value })); }} className="h-8 px-2 text-xs rounded-lg border border-mv-border" /><span className="text-xs text-mv-muted">to</span><input type="date" value={range.to} min={range.from} onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, to: e.target.value })); }} className="h-8 px-2 text-xs rounded-lg border border-mv-border" /></>)}
          </div>
        </div>
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
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 200, height: 200 }}>
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

        {/* City-wise drivers & rent today */}
        <div className="lg:col-span-7 mv-card p-5 sm:p-6 mv-rise">
          <h3 className="font-display text-lg font-semibold mb-4">City-wise Drivers &amp; Rent Today</h3>
          {(() => {
          const order = ["Tiruppur", "Coimbatore", "Chennai", "Bangalore"];
          const names = Array.from(new Set([...order, ...(drvList || []).map((d) => d.city).filter(Boolean)]))
            .filter((c) => (drvList || []).some((d) => d.city === c));
          if (!drvList) return <Skeleton className="h-32 rounded-2xl" />;
          if (!names.length) return <div className="mv-card p-6 text-sm text-mv-muted text-center">No drivers yet.</div>;
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {names.map((c) => {
                const total = drvList.filter((d) => d.city === c).length;
                const mgr = mgrs.filter((u) => (u.city || "").toLowerCase() === c.toLowerCase()).map((u) => u.name || u.full_name || u.email).join(", ");
                const veh = (data?.cities || []).find((x) => (x.city || "").toLowerCase() === c.toLowerCase())?.total ?? 0;
                const cr = dcRows.filter((x) => x.city === c);
                const cnt = (fn) => new Set(cr.filter(fn).map((x) => x.driver_id)).size;
                const paid = cnt((x) => x.rent_status === "paid"), unpaid = cnt((x) => x.rent_status !== "paid");
                return (
                  <div key={c} className="mv-card bg-mv-surface2 p-4">
                    <div className="font-display font-bold uppercase tracking-wide mb-1">{c}</div><div className="text-xs text-mv-muted mb-3 truncate">👤 Manager: <span className="font-semibold text-mv-text">{mgr || "Not assigned"}</span></div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div onClick={() => nav(`/fleet?city=${c}`)} className="cursor-pointer rounded-lg hover:bg-black/5 transition py-1"><div className="font-display text-2xl font-bold text-mv-primary">{veh}</div><div className="text-[10px] uppercase tracking-wider text-mv-dim mt-1">Vehicles</div></div>
                      <div onClick={() => nav(`/drivers?city=${c}`)} className="cursor-pointer rounded-lg hover:bg-black/5 transition py-1"><div className="font-display text-2xl font-bold">{total}</div><div className="text-[10px] uppercase tracking-widest text-mv-dim mt-1">Onboarded</div></div>
                      <div onClick={() => nav(`/daily-collection?city=${c}&status=paid`)} className="cursor-pointer rounded-lg hover:bg-black/5 transition py-1"><div className="font-display text-2xl font-bold text-green-600">{paid}</div><div className="text-[10px] uppercase tracking-widest text-mv-dim mt-1">Rent Paid</div></div>
                      <div onClick={() => nav(`/daily-collection?city=${c}&status=unpaid`)} className="cursor-pointer rounded-lg hover:bg-black/5 transition py-1"><div className="font-display text-2xl font-bold text-amber-500">{unpaid}</div><div className="text-[10px] uppercase tracking-widest text-mv-dim mt-1">Unpaid</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
        </div>
      </div>

      {/* Pending assignment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {[
          { title: "Drivers without vehicle", list: (drvList || []).filter((d) => !d.current_vehicle_number), loading: !drvList, main: (d) => d.name, sub: (d) => d.driver_code || "", to: (d) => `/drivers/${d.id}` },
          { title: "Vehicles without driver", list: freeVeh || [], loading: !freeVeh, main: (v) => `${v.vehicle_number}${v.registration_number ? " - " + v.registration_number : ""}`, sub: () => "", to: (v) => `/fleet/${v.id}` },
        ].map((b) => (
          <div key={b.title} className="mv-card p-5 sm:p-6 mv-rise">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-lg font-semibold">{b.title}</h3>
              <span className="text-xs font-bold bg-amber-500/15 text-amber-600 px-2.5 py-1 rounded-full">{b.loading ? "…" : b.list.length} pending</span>
            </div>
            {b.loading ? <Skeleton className="h-24 rounded-xl" /> : !b.list.length ? <div className="text-sm text-mv-muted py-6 text-center">All assigned ✅</div> : (() => {
              const ORDER = ["Tiruppur", "Coimbatore", "Chennai", "Bangalore"];
              const groups = {};
              b.list.forEach((x) => { const c = x.city || "Other"; (groups[c] = groups[c] || []).push(x); });
              const cities = Object.keys(groups).sort((x, y) => (ORDER.indexOf(x) + 1 || 99) - (ORDER.indexOf(y) + 1 || 99));
              return (
                <div className="space-y-2">
                  {cities.map((c) => {
                    const k = b.title + "|" + c, open = pendOpen === k;
                    return (
                      <div key={c} className="rounded-xl border border-mv-border overflow-hidden">
                        <button onClick={() => setPendOpen(open ? null : k)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-black/5 transition">
                          <span className="font-semibold uppercase tracking-wide text-sm">{c}</span>
                          <span className="flex items-center gap-2"><span className="font-display text-xl font-bold text-amber-600">{groups[c].length}</span><ChevronRight className={`w-4 h-4 text-mv-muted transition-transform ${open ? "rotate-90" : ""}`} /></span>
                        </button>
                        {open && (
                          <div className="border-t border-mv-border divide-y divide-mv-border bg-mv-surface2">
                            {groups[c].map((x) => (
                              <button key={x.id} onClick={() => nav(b.to(x))} className="w-full flex items-center justify-between gap-3 py-2.5 px-4 text-left hover:bg-black/5">
                                <span className="font-medium text-sm truncate">{b.main(x)}</span>
                                <span className="text-xs text-mv-muted whitespace-nowrap">{b.sub(x)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        ))}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Drivers Onboarded", value: drv?.total, icon: Users, color: "text-red-500", bg: "bg-red-500/15", sub: "Total drivers so far", to: "/drivers" },
            { label: "Total Vehicles", value: data ? (data.cities || []).reduce((n, c) => n + (c.total || 0), 0) : null, icon: Car, color: "text-blue-500", bg: "bg-blue-500/15", sub: "All cities", to: "/fleet" },
            { label: "Rent Paid", value: rentToday?.paid, icon: CheckCircle2, color: "text-green-500", bg: "bg-green-500/15", sub: rangeLabel, to: `/daily-collection?status=paid&from=${range.from}&to=${range.to}${city && city !== "all" ? `&city=${city}` : ""}` },
            { label: "Rent Unpaid", value: rentToday?.unpaid, icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/15", sub: rangeLabel, to: `/daily-collection?status=unpaid&from=${range.from}&to=${range.to}${city && city !== "all" ? `&city=${city}` : ""}` },
          ].map((k) => (
            <div key={k.label} onClick={() => k.to && nav(k.to)} className={`mv-card p-5 ${k.to ? "mv-card-hover cursor-pointer" : ""}`}>
              <div className={`w-10 h-10 rounded-xl ${k.bg} flex items-center justify-center`}><k.icon className={`w-5 h-5 ${k.color}`} /></div>
              <div className="font-display text-3xl font-bold mt-4">{k.value == null ? <Skeleton className="h-8 w-12" /> : <AnimatedCounter value={k.value} />}</div>
              <div className="text-xs tracking-widest uppercase text-mv-dim mt-1">{k.label}</div>
              <div className="text-xs text-mv-muted mt-1">{k.sub}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
