import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, LayoutGrid, List, Plus, Car, MapPin, User, Battery, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useApp, CITIES } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { StatusChip, BatteryBar, Skeleton, EmptyState } from "../components/common/Primitives";
import { PageHeader, FilterChip, PrimaryBtn, GhostBtn, Field, TextInput } from "../components/common/Page";
import { relativeEnd } from "../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const STATUSES = ["all", "rented", "available", "service", "idle", "inactive", "accident"];

export default function Fleet() {
  const { city: gCity } = useApp();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [view, setView] = useState("grid");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [status, setStatus] = useState(params.get("status") || "all");
  const [city, setCity] = useState(params.get("city") || gCity);
  const [showAdd, setShowAdd] = useState(params.get("new") === "1");

  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setCity(params.get("city") || gCity); }, [gCity]);

  const fetchPage = useCallback(async (pg, replace) => {
    const p = { page_size: 60, page: pg };
    if (status !== "all") p.status = status;
    if (city && city !== "all") p.city = city;
    if (dq) p.q = dq;
    const { data } = await api.get("/vehicles", { params: p });
    setTotal(data.total);
    setItems((prev) => (replace ? data.items : [...(prev || []), ...data.items]));
    setPage(pg);
  }, [status, city, dq]);

  useEffect(() => { setItems(null); fetchPage(1, true); }, [fetchPage]);

  const loadMore = async () => { setLoadingMore(true); await fetchPage(page + 1, false); setLoadingMore(false); };
  const load = () => fetchPage(1, true);

  const canEdit = ["admin", "city_manager"].includes(user?.role);

  return (
    <div>
      <PageHeader title="Vehicles" subtitle="Vehicle control system for your fleet">
        {canEdit && <PrimaryBtn onClick={() => setShowAdd(true)} data-testid="add-vehicle-btn"><Plus className="w-4 h-4" /> Add Vehicle</PrimaryBtn>}
      </PageHeader>

      {/* Controls */}
      <div className="flex flex-col lg:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mv-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="fleet-search"
                 placeholder="Search vehicle, registration, driver, city…"
                 className="w-full h-10 pl-9 pr-3 rounded-xl bg-mv-surface border border-mv-border outline-none focus:border-mv-primary transition-colors text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="w-40 h-10 bg-mv-surface border-mv-border" data-testid="fleet-city-filter"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-mv-surface border-mv-border text-mv-text">
              <SelectItem value="all">All Cities</SelectItem>
              {CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex rounded-xl border border-mv-border overflow-hidden">
            <button onClick={() => setView("grid")} className={`w-10 h-10 flex items-center justify-center ${view === "grid" ? "bg-mv-elevated text-mv-primary" : "text-mv-dim"}`}><LayoutGrid className="w-4 h-4" /></button>
            <button onClick={() => setView("list")} data-testid="fleet-list-view" className={`w-10 h-10 flex items-center justify-center ${view === "list" ? "bg-mv-elevated text-mv-primary" : "text-mv-dim"}`}><List className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar">
        {STATUSES.map((s) => (
          <FilterChip key={s} active={status === s} onClick={() => setStatus(s)} data-testid={`fleet-filter-${s}`}>
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </FilterChip>
        ))}
      </div>

      {!items && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
        </div>
      )}

      {items && items.length === 0 && (
        <EmptyState icon={Car} title="No vehicles yet. 🚘" subtitle="Add vehicles to start assigning drivers and rentals."
          action={canEdit && <PrimaryBtn onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Vehicle</PrimaryBtn>} />
      )}

      {items && items.length > 0 && view === "grid" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((v, i) => (
            <button key={v.id} onClick={() => nav(`/fleet/${v.id}`)} data-testid={`vehicle-card-${v.id}`}
                    className="mv-card mv-card-hover p-5 text-left mv-rise" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-mv-surface2 border border-mv-border flex items-center justify-center"><Car className="w-4.5 h-4.5 text-mv-primary" /></div>
                  <span className="font-display font-bold text-lg">{v.vehicle_number}{v.registration_number ? ` - ${v.registration_number}` : ""}</span>
                </div>
                <StatusChip status={v.status} />
              </div>
              
              <div className="flex items-center gap-4 mt-3 text-xs text-mv-muted">
                <span className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5 opacity-70" /> 
                  {v.current_driver_name ? (
                    <span className="font-medium text-mv-text">{v.current_driver_name}</span>
                  ) : (
                    <span className="opacity-70">Driver Not Assigned</span>
                  )}
                </span>
                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {v.city}</span>
              </div>
              {v.status === "rented" && v.rental_end && (
                <div className="mt-2 text-xs"><span className="text-mv-dim">Rental ends </span><span className="text-amber-400 font-medium">{relativeEnd(v.rental_end)}</span></div>
              )}

            </button>
          ))}
        </div>
      )}

      {items && items.length > 0 && view === "list" && (
        <div className="mv-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-mv-border text-left mv-label">
                <th className="px-4 py-3 font-semibold">Vehicle</th>
                <th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Driver</th>
                <th className="px-4 py-3 font-semibold">City</th>
              </tr></thead>
              <tbody>
                {items.map((v) => (
                  <tr key={v.id} onClick={() => nav(`/fleet/${v.id}`)} className="border-b border-mv-border/50 hover:bg-mv-elevated cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-semibold">{v.vehicle_number}{v.registration_number ? ` - ${v.registration_number}` : ""}</td>
                    <td className="px-4 py-3"><StatusChip status={v.status} /></td>
                    <td className="px-4 py-3">
                      {v.current_driver_name ? (
                        <span className="font-medium">{v.current_driver_name}</span>
                      ) : (
                        <span className="text-mv-muted text-xs">Driver Not Assigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{v.city}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AddVehicleDialog open={showAdd} setOpen={setShowAdd} onDone={() => { setShowAdd(false); load(); }} />

      {items && items.length > 0 && items.length < total && (
        <div className="flex justify-center mt-6">
          <GhostBtn onClick={loadMore} disabled={loadingMore} data-testid="fleet-load-more">
            {loadingMore ? "Loading…" : `Load more (${items.length} / ${total})`}
          </GhostBtn>
        </div>
      )}
    </div>
  );
}

function AddVehicleDialog({ open, setOpen, onDone }) {
  const { city: appCity } = useApp();
  const [form, setForm] = useState({ vehicle_number: "", registration_number: "", city: appCity === "all" ? "Bangalore" : appCity });
  const [saving, setSaving] = useState(false);
  const [fetchingId, setFetchingId] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const fetchNextNumber = useCallback(async (c) => {
    setFetchingId(true);
    try {
      const { data } = await api.get("/vehicles/next-number", { params: { city: c } });
      set("vehicle_number", data.vehicle_number);
    } catch (e) {
      console.error(e);
    } finally {
      setFetchingId(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchNextNumber(form.city);
    }
  }, [open, form.city, fetchNextNumber]);

  const save = async () => {
    if (!form.vehicle_number || !form.registration_number) { toast.error("Vehicle Code and Registration Number required"); return; }
    setSaving(true);
    try { await api.post("/vehicles", form); toast.success("Vehicle added ✓"); onDone(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed to add"); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-md">
        <DialogHeader><DialogTitle className="font-display">Add Vehicle</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <Field label="City">
            <Select value={form.city} onValueChange={(v) => set("city", v)}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Registration Number (e.g. TN39 XX 1234)">
            <TextInput data-testid="veh-reg-number" value={form.registration_number} onChange={(e) => set("registration_number", e.target.value)} className="bg-mv-surface text-mv-text uppercase" />
          </Field>
          <Field label="Vehicle Code / ID (Auto Generated)">
            <div className="relative cursor-not-allowed opacity-80">
              <TextInput data-testid="veh-number" value={form.vehicle_number} readOnly disabled className="bg-mv-surface2 text-mv-dim font-bold tracking-wider cursor-not-allowed" />
              {fetchingId && <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-mv-dim" />}
            </div>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <PrimaryBtn onClick={save} disabled={saving || fetchingId} data-testid="save-vehicle-btn" className="w-full">
            {saving ? "Adding..." : "Add Vehicle"}
          </PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}
