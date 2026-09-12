import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, Plus, KeyRound, Car, User } from "lucide-react";
import api from "../lib/api";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { StatusChip, Skeleton, EmptyState } from "../components/common/Primitives";
import { PageHeader, FilterChip, PrimaryBtn } from "../components/common/Page";
import { fmtDate, inr, relativeEnd } from "../lib/format";

const TABS = [
  ["active", "Active"], ["expiring", "Expiring"], ["pending_payment", "Pending Payment"],
  ["suspended", "Suspended"], ["closed", "Completed"], ["all", "All Rentals"],
];

export default function Rentals() {
  const { city } = useApp();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [tab, setTab] = useState(params.get("status") || "active");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setItems(null);
    const p = { status: tab };
    if (city !== "all") p.city = city;
    if (q) p.q = q;
    const { data } = await api.get("/rentals", { params: p });
    setItems(data);
  }, [tab, city, q]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const canCreate = ["admin", "city_manager"].includes(user?.role);

  return (
    <div>
      <PageHeader title="Rentals" subtitle="Modern prepaid rental platform">
        {canCreate && <PrimaryBtn onClick={() => nav("/rentals/new")} data-testid="create-rental-btn"><Plus className="w-4 h-4" /> Create Rental</PrimaryBtn>}
      </PageHeader>

      <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar">
        {TABS.map(([k, l]) => <FilterChip key={k} active={tab === k} onClick={() => { setTab(k); setParams({ status: k }); }} data-testid={`rental-tab-${k}`}>{l}</FilterChip>)}
      </div>

      <div className="relative flex-1 max-w-md mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mv-dim" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rental ID, driver, vehicle…" data-testid="rental-search"
               className="w-full h-10 pl-9 pr-3 rounded-xl bg-mv-surface border border-mv-border outline-none focus:border-mv-primary transition-colors text-sm" />
      </div>

      {!items && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>}
      {items && items.length === 0 && <EmptyState icon={KeyRound} title="No rentals here yet." subtitle="Create a rental to activate a vehicle for a driver." action={canCreate && <PrimaryBtn onClick={() => nav("/rentals/new")}><Plus className="w-4 h-4" /> Create Rental</PrimaryBtn>} />}

      {items && items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((r, i) => (
            <button key={r.id} onClick={() => nav(`/rentals/${r.id}`)} data-testid={`rental-card-${r.id}`}
                    className="mv-card mv-card-hover p-5 text-left mv-rise" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
              <div className="flex items-center justify-between">
                <span className="font-display font-bold text-lg">{r.rental_code}</span>
                <StatusChip status={r.status === "suspended" ? "suspended" : r.display_status} />
              </div>
              <div className="mt-3 space-y-1.5 text-sm">
                <div className="flex items-center gap-2 text-mv-muted"><User className="w-4 h-4" /> {r.driver_name}</div>
                <div className="flex items-center gap-2 text-mv-muted"><Car className="w-4 h-4" /> {r.vehicle_number} · {r.city}</div>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-mv-border">
                <div><div className="mv-label">Plan</div><div className="text-sm font-medium">{r.plan_name}</div></div>
                <div className="text-right"><div className="mv-label">Ends</div><div className="text-sm font-medium text-amber-400">{relativeEnd(r.end)}</div></div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <StatusChip status={r.payment_status === "paid" ? "paid" : r.payment_status === "partial" ? "partial" : "pending"} label={r.payment_status === "paid" ? "Paid" : r.payment_status === "partial" ? "Partial" : "Due"} />
                {r.outstanding > 0 && <span className="text-xs text-red-400">Outstanding {inr(r.outstanding)}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
