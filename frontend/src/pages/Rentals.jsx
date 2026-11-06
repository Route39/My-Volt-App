import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, Plus, KeyRound, Car, User } from "lucide-react";
import api from "../lib/api";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { StatusChip, Skeleton, EmptyState } from "../components/common/Primitives";
import { PageHeader, FilterChip, PrimaryBtn } from "../components/common/Page";
import { fmtDate, inr, relativeEnd } from "../lib/format";
import { DriverCode } from "../lib/driverCodes";

const TABS = [
  ["active", "Active"], ["suspended", "Suspended"], ["closed", "Completed"], ["all", "All Rentals"],
];

export default function Rentals() {
  const { city, lockedCity, cities } = useApp();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [shown, setShown] = useState(null);      // filter + count of the list that is on screen
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);
  const [tab, setTab] = useState(params.get("status") || "active");
  const [q, setQ] = useState("");
  const [pkgTab, setPkgTab] = useState("rental");        // "rental" | "commission" | "salary"
  const [cityTab, setCityTab] = useState(city);          // city tab filter (admin)
  useEffect(() => { setCityTab(city); }, [city]);        // stay in sync with the top-bar city

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);                       // keep the old list + status line on screen while loading
    const p = { status: tab };
    if (cityTab !== "all") p.city = cityTab;
    if (q) p.q = q;
    try {
      const { data } = await api.get("/rentals", { params: p });
      if (id !== reqId.current) return;     // a newer click already replaced this request
      const byPkg = data.filter((r) => (r.package_category || "rental") === pkgTab);
      setItems(byPkg);
      setShown({ tab, cityTab, count: byPkg.length });
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [tab, cityTab, q, pkgTab]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const canCreate = ["admin", "city_manager"].includes(user?.role);

  // line under the page subtitle: status (+ city for admins) and the number of rentals in this filter
  const isAdmin = ["admin", "company_admin"].includes(user?.role);
  const statusLabel = (TABS.find(([k]) => k === shown?.tab) || [])[1] || "";
  const cityLabel = shown?.cityTab === "all" ? "All Cities" : shown?.cityTab;
  const summary = shown
    ? `Status: ${statusLabel}${(isAdmin || lockedCity) ? ` in ${cityLabel}` : ""} · ${shown.count} ${shown.count === 1 ? "rental" : "rentals"}`
    : "";

  return (
    <div>
      <PageHeader title="Rentals" subtitle={<>Modern prepaid rental platform{summary && <span className="block mt-1 font-medium text-mv-text">{summary}</span>}</>}>
        {/* {canCreate && <PrimaryBtn onClick={() => nav("/rentals/new")} data-testid="create-rental-btn"><Plus className="w-4 h-4" /> Create Rental</PrimaryBtn>} */}
      </PageHeader>

      <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar">
        {[["rental", "Rental Packages"], ["commission", "Commission"], ["salary", "Salary"]].map(([k, l]) => (
          <FilterChip key={k} active={pkgTab === k} onClick={() => setPkgTab(k)} data-testid={`rental-pkg-tab-${k}`}>{l}</FilterChip>
        ))}
      </div>

      <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar">
        {TABS.map(([k, l]) => <FilterChip key={k} active={tab === k} onClick={() => { setTab(k); setParams({ status: k }); }} data-testid={`rental-tab-${k}`}>{l}</FilterChip>)}
      </div>

      {isAdmin && (
        <div className="mb-5">
          <div className="mv-label mb-2">City filter</div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {["all", ...cities].map((c) => (
              <FilterChip key={c} active={cityTab === c} onClick={() => setCityTab(c)} data-testid={`rental-city-tab-${c}`}>{c === "all" ? "All Cities" : c}</FilterChip>
            ))}
          </div>
        </div>
      )}

      <div className="relative flex-1 max-w-md mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mv-dim" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rental ID, driver, vehicle…" data-testid="rental-search"
               className="w-full h-10 pl-9 pr-3 rounded-xl bg-mv-surface border border-mv-border outline-none focus:border-mv-primary transition-colors text-sm" />
      </div>

      {!items && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>}
      {items && items.length === 0 && <EmptyState icon={KeyRound} title="No rentals here yet." subtitle="Create a rental to activate a vehicle for a driver." /* action={canCreate && <PrimaryBtn onClick={() => nav("/rentals/new")}><Plus className="w-4 h-4" /> Create Rental</PrimaryBtn>} */ />}

      {items && items.length > 0 && (
        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 transition-opacity duration-200 ${loading ? "opacity-60" : "opacity-100"}`}>
          {items.map((r, i) => (
            <button key={r.id} onClick={() => nav(`/rentals/${r.id}`)} data-testid={`rental-card-${r.id}`}
                    className="mv-card mv-card-hover p-5 text-left mv-rise" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
              <div className="flex items-center justify-between">
                <span className="font-display font-bold text-lg">{r.rental_code}</span>
                <StatusChip status={r.status === "suspended" ? "suspended" : r.display_status} />
              </div>
              <div className="mt-3 space-y-1.5 text-sm">
                <div className="flex items-center gap-2 text-mv-muted"><User className="w-4 h-4" /> {r.driver_name} <DriverCode id={r.driver_id} /></div>
                <div className="flex items-center gap-2 text-mv-muted"><Car className="w-4 h-4" /> {r.vehicle_number} · {r.city}</div>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-mv-border">
                <div>
                  <div className="mv-label">Plan</div>
                  <div className="text-sm font-medium">{r.plan_name}</div>
                  {r.package_category === "commission" && <div className="text-[11px] text-mv-muted">Commission · {r.commission_percent ?? "—"}%</div>}
                  {r.package_category === "salary" && <div className="text-[11px] text-mv-muted">Salary · ₹{r.salary_amount ?? "—"}</div>}
                </div>
                <div className="text-right"><div className="mv-label">Ends</div><div className="text-sm font-medium text-amber-400">{(r.end && r.end !== 'Ongoing') ? relativeEnd(r.end) : 'Ongoing'}</div></div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
