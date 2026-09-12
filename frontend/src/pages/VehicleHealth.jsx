import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Battery, HeartPulse, Zap, Wrench, CheckCircle2, Search } from "lucide-react";
import api from "../lib/api";
import { useApp } from "../context/AppContext";
import { Skeleton, BatteryBar, StatusChip } from "../components/common/Primitives";
import { PageHeader } from "../components/common/Page";
import { fmtDate } from "../lib/format";

function daysUntil(iso) {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
}

export default function VehicleHealth() {
  const { city } = useApp();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const p = { page_size: 200 }; if (city !== "all") p.city = city; if (q) p.q = q;
    const { data } = await api.get("/vehicles", { params: p }); setItems(data.items);
  }, [city, q]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const avgBattery = items && items.length ? Math.round(items.reduce((s, v) => s + (v.battery_percent || 0), 0) / items.length) : 0;
  const dueSoon = (items || []).filter((v) => { const d = daysUntil(v.next_service_date); return d !== null && d <= 14; }).length;

  return (
    <div>
      <PageHeader title="Vehicle Health" subtitle="Battery, charger and service readiness across the fleet" />

      {items && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="mv-card p-4"><div className="mv-label flex items-center gap-1.5"><Battery className="w-4 h-4 text-green-400" /> Avg Battery</div><div className="font-display text-2xl font-bold mt-1">{avgBattery}%</div></div>
          <div className="mv-card p-4"><div className="mv-label flex items-center gap-1.5"><HeartPulse className="w-4 h-4 text-mv-primary" /> Monitored</div><div className="font-display text-2xl font-bold mt-1">{items.length}</div></div>
          <div className="mv-card p-4"><div className="mv-label flex items-center gap-1.5"><Wrench className="w-4 h-4 text-amber-400" /> Service ≤14d</div><div className="font-display text-2xl font-bold mt-1 text-amber-400">{dueSoon}</div></div>
          <div className="mv-card p-4"><div className="mv-label flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-400" /> Healthy</div><div className="font-display text-2xl font-bold mt-1 text-green-400">{items.filter((v) => v.battery_health === "Healthy").length}</div></div>
        </div>
      )}

      <div className="relative flex-1 max-w-md mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mv-dim" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vehicle…" className="w-full h-10 pl-9 pr-3 rounded-xl bg-mv-surface border border-mv-border outline-none focus:border-mv-primary transition-colors text-sm" />
      </div>

      {!items && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>}
      {items && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((v) => {
            const d = daysUntil(v.next_service_date);
            const svcLabel = d === null ? "—" : d < 0 ? "Overdue" : `in ${d} day${d === 1 ? "" : "s"}`;
            return (
              <button key={v.id} onClick={() => nav(`/fleet/${v.id}`)} className="mv-card mv-card-hover p-5 text-left">
                <div className="flex items-center justify-between"><span className="font-display font-bold flex items-center gap-2"><Zap className="w-4 h-4 text-mv-primary" fill="currentColor" /> {v.vehicle_number}</span><StatusChip status={v.status} /></div>
                <div className="mt-4">
                  <div className="flex justify-between text-xs mb-1.5"><span className="text-mv-dim">Battery</span><span className="font-semibold">{v.battery_percent}%</span></div>
                  <BatteryBar percent={v.battery_percent} />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                  <div><div className="mv-label">Health</div><StatusChip status={v.battery_health} className="mt-1" /></div>
                  <div><div className="mv-label">Charger</div><div className="mt-1 text-mv-muted">{v.charger || "—"}</div></div>
                  <div><div className="mv-label">Next Service</div><div className={`mt-1 ${d !== null && d <= 7 ? "text-amber-400" : "text-mv-muted"}`}>{svcLabel}</div></div>
                  <div><div className="mv-label">Odometer</div><div className="mt-1 text-mv-muted">{(v.odometer || 0).toLocaleString()} km</div></div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
