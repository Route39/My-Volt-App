import { useEffect, useState, useCallback, useMemo } from "react";
import { Wallet, Search } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { CITIES } from "../context/AppContext";
import { Skeleton, EmptyState } from "../components/common/Primitives";
import { PageHeader, FilterChip, TextInput } from "../components/common/Page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { inr } from "../lib/format";

export default function PendingPayments() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "company_admin";
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [pkgType, setPkgType] = useState("all");   // all | rental | commission | salary
  const [pkg, setPkg] = useState("all");
  const [supervisor, setSupervisor] = useState("all");
  const [cityTab, setCityTab] = useState("all");
  const [sortBy, setSortBy] = useState("pending");   // az | za | pending

  const load = useCallback(async (silent = false) => {
    try {
      const { data } = await api.get("/pending-payments");
      setRows(data);
    } catch (e) {
      if (!silent) {
        setRows([]);
        toast.error(formatApiErrorDetail(e?.response?.data?.detail));
      }
    }
  }, []);
  // load once, then every 5 s ask the cheap "signature" endpoint whether any payment changed
  // (driver paid in the app, admin marked paid / unpaid ...). Only then reload the full table,
  // which re-applies the current sort and filters. A full reload also runs at least every 60 s
  // and whenever the tab becomes visible again, as a safety net.
  useEffect(() => {
    load();
    let lastSig = null, lastFull = Date.now(), busy = false;
    const tick = async (force = false) => {
      if (document.hidden || busy) return;       // skip while hidden or while a check is still running
      busy = true;
      try {
        const { data } = await api.get("/pending-payments/signature");
        const changed = lastSig !== null && data.sig !== lastSig;
        if (force === true || changed || Date.now() - lastFull > 60000) {
          await load(true);
          lastFull = Date.now();
        }
        lastSig = data.sig;
      } catch { /* silent: try again on the next tick */ }
      finally { busy = false; }
    };
    const timer = setInterval(() => tick(), 5000);
    const onVisible = () => tick(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const packages = useMemo(
    () => [...new Set((rows || []).filter((r) => pkgType === "all" || (r.package_category || "rental") === pkgType).map((r) => r.package_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows, pkgType]
  );

  const supervisors = useMemo(
    () => [...new Set((rows || []).map((r) => r.supervisor_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const byName = (a, b) => (a.driver_name || "").localeCompare(b.driver_name || "", undefined, { sensitivity: "base" });
    const total = (r) => (r.rent_pending || 0) + (r.deposit_pending || 0);
    const list = (rows || []).filter((r) =>
      (!term ||
        (r.driver_name || "").toLowerCase().includes(term) ||
        (r.phone || "").toLowerCase().includes(term) ||
        (r.driver_code || "").toLowerCase().includes(term)) &&
      (pkgType === "all" || (r.package_category || "rental") === pkgType) &&
      (pkg === "all" || r.package_name === pkg) &&
      (supervisor === "all" || r.supervisor_name === supervisor) &&
      (!isAdmin || cityTab === "all" || r.city === cityTab)
    );
    if (sortBy === "za") list.sort((a, b) => byName(b, a));
    else if (sortBy === "pending") list.sort((a, b) => total(b) - total(a) || byName(a, b));  // highest -> lowest -> no pending
    else list.sort(byName);
    return list;
  }, [rows, q, pkgType, pkg, supervisor, cityTab, sortBy, isAdmin]);

  // card totals follow the filters currently applied
  const totals = useMemo(() => {
    const rent = filtered.reduce((s, r) => s + (r.rent_pending || 0), 0);
    const deposit = filtered.reduce((s, r) => s + (r.deposit_pending || 0), 0);
    return { rent, deposit, total: rent + deposit };
  }, [filtered]);

  // Commission / Salary tabs: the rent column becomes "Commission Pending" / "Collection Pending" and Deposit Pending is hidden
  const isPkgOnly = pkgType === "commission" || pkgType === "salary";
  const rentHeader = pkgType === "commission" ? "Commission Pending" : pkgType === "salary" ? "Collection Pending" : pkgType === "all" ? "Pending Payment" : "Daily Rent Pending";

  return (
    <div>
      <PageHeader
        title={!isAdmin && user?.city ? `Pending Payments for ${user.city}` : "Pending Payments"}
        subtitle="Daily rent and security deposit still to be paid by each driver" />

      {/* Summary cards */}
      <div className="grid sm:grid-cols-3 gap-4 mb-5" data-testid="pp-cards">
        {[
          ["Total Pending Amount (daily Rent and Deposit Amount)", totals.total],
          ["Pending Rent Amount", totals.rent],
          ["Pending Deposit Amount", totals.deposit],
        ].map(([label, value]) => (
          <div key={label} className="mv-card p-4">
            <div className="mv-label">{label}</div>
            <div className={`font-display text-2xl font-bold mt-1.5 ${value > 0 ? "text-red-500" : "text-mv-text"}`}>{inr(value)}</div>
          </div>
        ))}
      </div>

      {/* Package tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="pp-package-tabs">
        {[["all", "All Packages"], ["rental", "Rental Package"], ["commission", "Commission Package"], ["salary", "Salary Package"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setPkgType(k); setPkg("all"); }} data-testid={`pp-tab-${k}`}
            className={`h-9 px-4 rounded-full text-sm font-medium transition-colors ${pkgType === k ? "bg-mv-primary text-white" : "border border-mv-border text-mv-muted hover:bg-mv-elevated"}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-mv-dim absolute left-3 top-1/2 -translate-y-1/2" />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone no. or driver ID…" className="pl-9" data-testid="pp-search" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* <Select value={pkgType} onValueChange={(v) => { setPkgType(v); setPkg("all"); }}>
            <SelectTrigger className="w-48 h-10 rounded-xl bg-mv-surface border-mv-border" data-testid="pp-package-type">
              <SelectValue placeholder="Select package type" />
            </SelectTrigger>
            <SelectContent className="bg-mv-surface rounded-xl border-mv-border text-mv-text">
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="rental">Rental Package</SelectItem>
              <SelectItem value="commission">Commission Package</SelectItem>
              <SelectItem value="salary">Salary Package</SelectItem>
            </SelectContent>
          </Select> */}
          <Select value={pkg} onValueChange={setPkg} disabled={pkgType === "all"}>
            <SelectTrigger className="w-48 h-10 rounded-xl bg-mv-surface border-mv-border" data-testid="pp-package">
              <SelectValue placeholder="Select package" />
            </SelectTrigger>
            <SelectContent className="bg-mv-surface rounded-xl border-mv-border text-mv-text">
              <SelectItem value="all">All Packages</SelectItem>
              {packages.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={supervisor} onValueChange={setSupervisor}>
            <SelectTrigger className="w-48 h-10 rounded-xl bg-mv-surface border-mv-border" data-testid="pp-supervisor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-mv-surface rounded-xl border-mv-border text-mv-text">
              <SelectItem value="all">All Supervisors</SelectItem>
              {supervisors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-48 h-10 rounded-xl bg-mv-surface border-mv-border" data-testid="pp-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-mv-surface rounded-xl border-mv-border text-mv-text">
              <SelectItem value="az">A - Z</SelectItem>
              <SelectItem value="za">Z - A</SelectItem>
              <SelectItem value="pending">Highest Pending Amount</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* City tabs - admin only */}
      {isAdmin && (
        <div className="flex flex-wrap gap-2 mb-5" data-testid="pp-city-tabs">
          {["all", ...CITIES].map((c) => (
            <FilterChip key={c} active={cityTab === c} onClick={() => setCityTab(c)}>{c === "all" ? "All Cities" : c}</FilterChip>
          ))}
        </div>
      )}

      {!rows && <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>}
      {rows && rows.length === 0 && <EmptyState icon={Wallet} title="No drivers found" subtitle="Drivers will appear here once they are added." />}
      {rows && rows.length > 0 && filtered.length === 0 && <EmptyState icon={Wallet} title="No drivers match" subtitle="Try changing the search or filters." />}
      {rows && filtered.length > 0 && (
        <div className="mv-card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm" data-testid="pending-payments-table">
            <thead>
              <tr className="border-b border-mv-border text-left mv-label">
                <th className="px-4 py-3">S.No</th>
                <th className="px-4 py-3">Driver Name</th>
                <th className="px-4 py-3">Vehicle No.</th>
                <th className="px-4 py-3">Rental Package</th>
                <th className="px-4 py-3">{rentHeader}</th>
                {!isPkgOnly && <th className="px-4 py-3">Deposit Pending</th>}
                <th className="px-4 py-3">Supervisor</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id} className="border-b border-mv-border/50 hover:bg-mv-elevated transition-colors">
                  <td className="px-4 py-3 text-mv-muted">{i + 1}</td>
                  <td className="px-4 py-3 font-medium">
                    {r.driver_name}
                    {r.driver_code && <div className="text-[11px] font-mono text-mv-primary">{r.driver_code}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {r.vehicle_reg || r.vehicle_number || <span className="text-mv-dim">—</span>}
                    {r.vehicle_reg && r.vehicle_number && <div className="text-[11px] text-mv-dim">{r.vehicle_number}</div>}
                  </td>
                  <td className="px-4 py-3 text-mv-muted">
                    {r.package_name ? (
                      <>
                        <div className="font-medium text-mv-text">{r.package_category === "commission" ? "Commission Package" : r.package_category === "salary" ? "Salary Package" : "Rental Package"}</div>
                        {r.package_name.trim().toLowerCase() !== (r.package_category === "commission" ? "commission package" : r.package_category === "salary" ? "salary package" : "rental package") && (
                          <div className="text-[11px] text-mv-dim">{r.package_name}</div>
                        )}
                      </>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {r.rent_pending > 0 ? (
                      <div>
                        <span className="font-semibold text-red-500">{inr(r.rent_pending)}</span>
                        <div className="text-[11px] text-mv-dim">Pending Rent</div>
                      </div>
                    )
                      : (r.pkg_pending_dates || []).length > 0 ? (
                        <div>
                          <span className="font-semibold text-red-500">{r.package_category === "commission" ? "Pending Commission" : "Pending Collection"}</span>
                          {r.pkg_pending_dates.map((dt) => <div key={dt} className="text-[11px] text-mv-dim">{dt}</div>)}
                        </div>
                      ) : <span className="text-mv-dim">—</span>}
                  </td>
                  {!isPkgOnly && (
                    <td className="px-4 py-3">
                      {r.deposit_pending > 0 ? <span className="font-semibold text-red-500">{inr(r.deposit_pending)} pending</span> : <span className="text-mv-dim">—</span>}
                    </td>
                  )}
                  <td className="px-4 py-3 text-mv-muted">{r.supervisor_name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
