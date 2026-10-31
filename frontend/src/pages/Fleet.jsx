import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, LayoutGrid, List, Plus, Car, MapPin, User, Battery, Loader2, Upload, Download, Sparkles, AlertCircle, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useApp, CITIES } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { StatusChip, BatteryBar, Skeleton, EmptyState } from "../components/common/Primitives";
import { PageHeader, FilterChip, PrimaryBtn, GhostBtn, Field, TextInput } from "../components/common/Page";
import { relativeEnd } from "../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { DriverCode } from "../lib/driverCodes";

const STATUSES = ["all", "rented", "available", "service", "idle", "inactive", "accident"];

export default function Fleet() {
  const { city: gCity, lockedCity, cities } = useApp();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [view, setView] = useState("list");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [status, setStatus] = useState(params.get("status") || "all");
  const [city, setCity] = useState(lockedCity || params.get("city") || gCity);
  const [showAdd, setShowAdd] = useState(params.get("new") === "1");
  const [showImport, setShowImport] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const s = params.get("status");
    if (s) setStatus(s);
    const c = lockedCity || params.get("city") || gCity;
    if (c) setCity(c);
  }, [params, lockedCity, gCity]);

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
        {canEdit && (
          <div className="flex gap-2">
            <GhostBtn onClick={() => setShowImport(true)}><Upload className="w-4 h-4" /> Import</GhostBtn>
            <PrimaryBtn onClick={() => setShowAdd(true)} data-testid="add-vehicle-btn"><Plus className="w-4 h-4" /> Add Vehicle</PrimaryBtn>
          </div>
        )}
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
          <div className="flex rounded-xl border border-mv-border overflow-hidden">
            <button onClick={() => setView("grid")} className={`w-10 h-10 flex items-center justify-center ${view === "grid" ? "bg-mv-elevated text-mv-primary" : "text-mv-dim"}`}><LayoutGrid className="w-4 h-4" /></button>
            <button onClick={() => setView("list")} data-testid="fleet-list-view" className={`w-10 h-10 flex items-center justify-center ${view === "list" ? "bg-mv-elevated text-mv-primary" : "text-mv-dim"}`}><List className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {/* City filter – admin only (city managers are locked to their own city) */}
      {!lockedCity && (
        <div className="mb-5" data-testid="fleet-city-tabs">
          <div className="mv-label mb-2">City Filter</div>
          <div className="flex flex-wrap gap-2">
            {["all", ...cities].map((c) => (
              <FilterChip key={c} active={city === c} onClick={() => setCity(c)} data-testid={`fleet-city-tab-${c}`}>{c === "all" ? "All Cities" : c}</FilterChip>
            ))}
          </div>
        </div>
      )}

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
                  {(v.current_driver_name && v.status !== "available") ? (
                    <span className="font-medium text-mv-text">{v.current_driver_name} <DriverCode id={v.current_driver_id} /></span>
                  ) : (
                    <span className="opacity-70">Driver Not Assigned</span>
                  )}
                </span>
                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {v.city}</span>
              </div>
              {v.vin_number && (
                <div className="mt-2 text-xs text-mv-muted"><span className="text-mv-dim">VIN </span><span className="font-mono font-medium text-mv-text">{v.vin_number}</span></div>
              )}
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
                <th className="px-4 py-3 font-semibold">VIN</th><th className="px-4 py-3 font-semibold">Rental Ends</th>
              </tr></thead>
              <tbody>
                {items.map((v) => (
                  <tr key={v.id} onClick={() => nav(`/fleet/${v.id}`)} className="border-b border-mv-border/50 hover:bg-mv-elevated cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-semibold">{v.vehicle_number}{v.registration_number ? ` - ${v.registration_number}` : ""}</td>
                    <td className="px-4 py-3"><StatusChip status={v.status} /></td>
                    <td className="px-4 py-3">
                      {(v.current_driver_name && v.status !== "available") ? (
                        <span className="font-medium">{v.current_driver_name} <DriverCode id={v.current_driver_id} /></span>
                      ) : (
                        <span className="text-mv-muted text-xs">Driver Not Assigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{v.city}</td>
                    <td className="px-4 py-3 font-mono text-xs text-mv-muted">{v.vin_number || "—"}</td>
                    <td className="px-4 py-3 text-amber-400">{(v.status === "rented" && v.rental_end) ? relativeEnd(v.rental_end) : <span className="text-mv-dim">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AddVehicleDialog open={showAdd} setOpen={setShowAdd} onDone={() => { setShowAdd(false); load(); }} />
      <ImportVehiclesDialog open={showImport} setOpen={setShowImport} onDone={load} />

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

function ImportVehiclesDialog({ open, setOpen, onDone }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { if (open) { setFile(null); setResult(null); } }, [open]);

  const downloadTemplate = () => {
    const csv = "City,Registration Number,VIN Number\nTiruppur,TN39 AB 1234,MD9ABCDE1F2345678\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "vehicles_import_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async () => {
    if (!file) return toast.error("Choose an Excel or CSV file");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/vehicles/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(data);
      if (data.created) { toast.success(`${data.created} vehicle(s) imported`); onDone(); }
      if (data.errors?.length) toast.error(`${data.errors.length} row(s) skipped`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Import failed");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">Import Vehicles</DialogTitle></DialogHeader>
        <p className="text-sm text-mv-muted">Columns: <b>City, Registration Number, VIN Number</b> (VIN = 17 letters/numbers). Vehicle code is auto-generated. City must be Tiruppur, Coimbatore, Chennai or Bangalore.</p>
        <button onClick={downloadTemplate} className="w-max text-sm text-mv-primary flex items-center gap-1.5 hover:underline"><Download className="w-4 h-4" /> Download template</button>
        <input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }}
          className="block w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-mv-elevated file:text-mv-text" />
        {result && (
          <div className="space-y-2">
            <p className="text-sm"><b className="text-emerald-600">{result.created} created</b>{result.errors?.length ? <>, <b className="text-red-500">{result.errors.length} skipped</b></> : null}</p>
            {result.errors?.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 max-h-48 overflow-y-auto text-xs space-y-1">
                {result.errors.map((er) => <div key={er.row}>Row {er.row}{er.name ? ` (${er.name})` : ""}: {er.error}</div>)}
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <GhostBtn onClick={() => setOpen(false)}>Close</GhostBtn>
          <PrimaryBtn onClick={upload} disabled={busy || !file}>{busy ? "Importing..." : "Import"}</PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddVehicleDialog({ open, setOpen, onDone }) {
  const { city: appCity, lockedCity, cities } = useApp();
  const defaultCity = lockedCity || (appCity === "all" ? "Bangalore" : appCity);

  const [form, setForm] = useState({
    vehicle_number: "",
    registration_number: "",
    vin_number: "",
    city: defaultCity
  });
  const [saving, setSaving] = useState(false);
  const [fetchingId, setFetchingId] = useState(false);
  const [suggestedCode, setSuggestedCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [checkingCode, setCheckingCode] = useState(false);
  const [isUnique, setIsUnique] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const resetForm = useCallback((targetCity) => {
    const c = targetCity || lockedCity || (appCity === "all" ? "Bangalore" : appCity);
    setForm({
      vehicle_number: "",
      registration_number: "",
      vin_number: "",
      city: c
    });
    setCodeError("");
    setIsUnique(false);
  }, [appCity, lockedCity]);

  const checkUniqueness = useCallback(async (code) => {
    const clean = (code || "").trim().toUpperCase();
    if (!clean) {
      setCodeError("Vehicle Code / ID is required");
      setIsUnique(false);
      return;
    }
    setCheckingCode(true);
    try {
      const { data } = await api.get("/vehicles/check-number", { params: { vehicle_number: clean } });
      if (!data.available) {
        setCodeError(`Vehicle Code "${clean}" is already in use. Please enter a unique code.`);
        setIsUnique(false);
      } else {
        setCodeError("");
        setIsUnique(true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCheckingCode(false);
    }
  }, []);

  const fetchNextNumber = useCallback(async (c) => {
    setFetchingId(true);
    try {
      const { data } = await api.get("/vehicles/next-number", { params: { city: c } });
      const nextCode = data.vehicle_number;
      setSuggestedCode(nextCode);
    } catch (e) {
      console.error(e);
    } finally {
      setFetchingId(false);
    }
  }, []);

  // When dialog opens or closes, reset all inputs completely to empty
  useEffect(() => {
    if (open) {
      resetForm();
      fetchNextNumber(defaultCity);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!form.vehicle_number) {
      setCodeError("");
      setIsUnique(false);
      return;
    }
    const timer = setTimeout(() => {
      checkUniqueness(form.vehicle_number);
    }, 350);
    return () => clearTimeout(timer);
  }, [form.vehicle_number, checkUniqueness]);

  const handleManualCodeChange = (e) => {
    const val = e.target.value.toUpperCase().replace(/\s+/g, "");
    set("vehicle_number", val);
  };

  const handleUseSuggestion = () => {
    if (suggestedCode) {
      set("vehicle_number", suggestedCode);
      checkUniqueness(suggestedCode);
    }
  };

  const save = async () => {
    const cleanVehNum = (form.vehicle_number || "").trim().toUpperCase();
    if (!cleanVehNum) { toast.error("Vehicle Code / ID is required"); return; }
    if (codeError || !isUnique) { toast.error(codeError || "Please enter a unique Vehicle Code"); return; }
    if (!form.registration_number.trim()) { toast.error("Registration Number required"); return; }
    if (!form.vin_number.trim()) { toast.error("VIN Number required"); return; }
    if (!/^[A-Z0-9]{17}$/.test(form.vin_number.trim())) { toast.error("VIN Number must be exactly 17 characters (letters A-Z and numbers 0-9 only)"); return; }
    setSaving(true);
    try {
      await api.post("/vehicles", { ...form, vehicle_number: cleanVehNum });
      toast.success("Vehicle added ✓");
      resetForm();
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to add");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-md">
        <DialogHeader><DialogTitle className="font-display">Add Vehicle</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <Field label="City">
            <Select value={form.city} onValueChange={(v) => set("city", v)}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Registration Number (e.g. TN39 XX 1234)">
            <TextInput data-testid="veh-reg-number" value={form.registration_number} onChange={(e) => set("registration_number", e.target.value)} className="bg-mv-surface text-mv-text uppercase" />
          </Field>
          <Field label="VIN Number">
            <TextInput data-testid="veh-vin-number" value={form.vin_number} onChange={(e) => set("vin_number", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17))} maxLength={17} className="bg-mv-surface text-mv-text uppercase" />
          </Field>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="mv-label">Vehicle Code / ID</label>
              {suggestedCode && (
                <button
                  type="button"
                  onClick={handleUseSuggestion}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors shadow-sm"
                  title="Auto-fill the next recommended code"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                  Suggest Next: <span className="font-mono font-bold">{suggestedCode}</span>
                </button>
              )}
            </div>
            <div className="relative">
              <TextInput
                data-testid="veh-number"
                value={form.vehicle_number}
                onChange={handleManualCodeChange}
                placeholder="e.g. BLR006"
                className={`bg-mv-surface text-mv-text uppercase font-mono font-bold tracking-wider pr-10 transition-colors ${
                  codeError
                    ? "border-red-500 focus:border-red-500 bg-red-50/10 text-red-600"
                    : isUnique && form.vehicle_number
                    ? "border-emerald-500 focus:border-emerald-500"
                    : ""
                }`}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
                {(fetchingId || checkingCode) && <Loader2 className="w-4 h-4 animate-spin text-mv-dim" />}
                {!fetchingId && !checkingCode && codeError && <AlertCircle className="w-4 h-4 text-red-500" />}
                {!fetchingId && !checkingCode && isUnique && form.vehicle_number && <CheckCircle className="w-4 h-4 text-emerald-500" />}
              </div>
            </div>
            {codeError ? (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {codeError}
              </p>
            ) : isUnique && form.vehicle_number ? (
              <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1 font-medium">
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                Vehicle Code is available
              </p>
            ) : (
              <p className="text-[11px] text-mv-muted mt-1">
                Enter any unique vehicle code manually or click the suggestion button.
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <PrimaryBtn
            onClick={save}
            disabled={saving || fetchingId || checkingCode || Boolean(codeError) || !isUnique || !form.vehicle_number.trim()}
            data-testid="save-vehicle-btn"
            className="w-full"
          >
            {saving ? "Adding..." : "Add Vehicle"}
          </PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}
