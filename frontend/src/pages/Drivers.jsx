import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, Plus, Users, Car, MapPin, Phone, KeyRound, LayoutGrid, List, Upload, Download } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useApp, CITIES } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { StatusChip, Skeleton, EmptyState, KycStatusChip } from "../components/common/Primitives";
import { PageHeader, FilterChip, PrimaryBtn, GhostBtn, Field, TextInput } from "../components/common/Page";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import DriverAssignFields, { validateAssign } from "../components/DriverAssignFields";

export default function Drivers() {
  const { city: gCity, lockedCity, cities } = useApp();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [city, setCity] = useState(gCity);
  const [view, setView] = useState("cards");
  const [showAdd, setShowAdd] = useState(params.get("new") === "1");
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    setItems(null);
    const p = {};
    if (status === "active" || status === "inactive") p.status = status;
    if (city !== "all") p.city = city;
    if (q) p.q = q;
    try {
      const { data } = await api.get("/drivers", { params: p });
      setItems(status === "temporary" || status === "permanent" ? data.filter((d) => d.admin_block === status) : data);
    } catch (e) {
      console.error(e);
      setItems([]);
    }
  }, [status, city, q]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => setCity(gCity), [gCity]);

  const canEdit = ["admin", "city_manager"].includes(user?.role);

  return (
    <div>
      <PageHeader title="Drivers" subtitle="Driver roster and assignments">
        {canEdit && (
          <div className="flex gap-2">
            <GhostBtn onClick={() => setShowImport(true)}><Upload className="w-4 h-4" /> Import</GhostBtn>
            <PrimaryBtn onClick={() => setShowAdd(true)} data-testid="add-driver-btn"><Plus className="w-4 h-4" /> Add Driver</PrimaryBtn>
          </div>
        )}
      </PageHeader>

      <div className="flex flex-col lg:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mv-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="driver-search" placeholder="Search name, ID, phone, vehicle…"
                 className="w-full h-10 pl-9 pr-3 rounded-xl bg-mv-surface border border-mv-border outline-none focus:border-mv-primary transition-colors text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-mv-border overflow-hidden">
            <button onClick={() => setView("cards")} className={`w-10 h-10 flex items-center justify-center ${view === "cards" ? "bg-mv-elevated text-mv-primary" : "text-mv-dim"}`}><LayoutGrid className="w-4 h-4" /></button>
            <button onClick={() => setView("list")} className={`w-10 h-10 flex items-center justify-center ${view === "list" ? "bg-mv-elevated text-mv-primary" : "text-mv-dim"}`}><List className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {/* City filter – admin only (city managers are locked to their own city) */}
      {!lockedCity && (
        <div className="mb-5" data-testid="driver-city-tabs">
          <div className="mv-label mb-2">City Filter</div>
          <div className="flex flex-wrap gap-2">
            {["all", ...cities].map((c) => (
              <FilterChip key={c} active={city === c} onClick={() => setCity(c)} data-testid={`driver-city-tab-${c}`}>{c === "all" ? "All Cities" : c}</FilterChip>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-5">
        {[["all", "All"], ["active", "Active"], ["inactive", "Inactive"], ["temporary", "Temporarily Blocked"], ["permanent", "Permanently Blocked"]].map(([s, label]) => <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>{label}</FilterChip>)}
      </div>

      {!items && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>}
      {items && items.length === 0 && (status !== "all" || q ? (
        <EmptyState icon={Users} title="Nothing found"
          subtitle={q ? `No drivers match "${q}"${status !== "all" ? " in this filter" : ""}.` : `No ${{ active: "active", inactive: "inactive", temporary: "temporarily blocked", permanent: "permanently blocked" }[status]} drivers right now.`} />
      ) : (
        <EmptyState icon={Users} title="No drivers found" subtitle="Add drivers to start assigning vehicles and rentals." action={canEdit && <PrimaryBtn onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Driver</PrimaryBtn>} />
      ))}

      {items && items.length > 0 && view === "cards" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((d, i) => (
            <button key={d.id} onClick={() => nav(`/drivers/${d.id}`)} data-testid={`driver-card-${d.id}`}
                    className="mv-card mv-card-hover p-5 text-left mv-rise" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
              <div className="flex items-center gap-3">
                <Avatar className="w-12 h-12"><AvatarImage src={d.avatar} /><AvatarFallback className="bg-mv-elevated text-sm">{d.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}</AvatarFallback></Avatar>
                <div className="min-w-0">
                  <div className="font-display font-semibold truncate">{d.name}</div>
                  {d.driver_code && <div className="text-[11px] font-mono font-semibold text-mv-primary">{d.driver_code}</div>}
                  <div className="flex gap-2 mt-1">
                    <StatusChip status={d.status} />
                    <KycStatusChip status={d.kyc_status || "pending"} />
                    
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-1.5 text-xs text-mv-muted">
                <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5" /> {d.phone}</div>
                <div className="flex items-center gap-2">
                  <Car className="w-3.5 h-3.5 opacity-70" /> 
                  {d.current_vehicle_number ? (
                    <span className="font-medium text-mv-text">{d.current_vehicle_number}{d.current_vehicle_reg ? ` - ${d.current_vehicle_reg}` : ""}</span>
                  ) : (
                    <span className="opacity-70">Vehicle Not Assigned</span>
                  )}
                </div>
                <div className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5" /> {d.city}</div>
                {d.package_name && <div className="flex items-center gap-2 text-mv-primary"><KeyRound className="w-3.5 h-3.5" /> {d.package_name} Plan</div>}
              </div>
              {d.admin_block && (
                <div className="mt-3">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold ${d.admin_block === "permanent" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"}`}>
                    {d.admin_block === "permanent" ? "Permanently Blocked" : "Temporarily Blocked"}
                  </span>
                </div>
              )}
              {d.rental_status === "active" && d.rental_block_status !== "blocked" && <div className="mt-3"><StatusChip status="active" label="Rental Active" /></div>}
              {/* {d.rental_block_status === "blocked" && (
                <div className="mt-3 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-100 text-red-600 text-[10px] font-bold">Blocked (Unpaid)</span>
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    if(window.confirm("Unblock this driver? They will have 24 hours to pay.")) {
                      try { await api.post(`/admin/drivers/${d.id}/unblock`); load(); } catch(err) { alert("Failed to unblock"); }
                    }
                  }} className="text-[10px] text-emerald-600 font-bold hover:underline px-2 py-1 bg-emerald-50 rounded-lg">Unblock Driver</button>
                </div>
              )} */}
            </button>
          ))}
        </div>
      )}

      {items && items.length > 0 && view === "list" && (
        <div className="mv-card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-mv-border text-left mv-label"><th className="px-4 py-3">Driver</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Package</th><th className="px-4 py-3">City</th><th className="px-4 py-3">KYC</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
            <tbody>{items.map((d) => (
              <tr key={d.id} onClick={() => nav(`/drivers/${d.id}`)} className="border-b border-mv-border/50 hover:bg-mv-elevated cursor-pointer transition-colors">
                <td className="px-4 py-3 font-medium flex items-center gap-2"><Avatar className="w-7 h-7"><AvatarImage src={d.avatar} /><AvatarFallback className="text-[10px] bg-mv-elevated">{d.name[0]}</AvatarFallback></Avatar><div>{d.name}{d.driver_code && <div className="text-[11px] font-mono text-mv-primary">{d.driver_code}</div>}</div></td>
                <td className="px-4 py-3 text-mv-muted">{d.phone}</td>
                <td className="px-4 py-3">
                  {d.current_vehicle_number ? (
                    <span className="font-medium">{d.current_vehicle_number}{d.current_vehicle_reg ? ` - ${d.current_vehicle_reg}` : ""}</span>
                  ) : (
                    <span className="text-mv-muted text-xs">Unassigned</span>
                  )}
                </td>
                <td className="px-4 py-3 text-mv-muted">{d.package_name || "N/A"}</td>
                <td className="px-4 py-3">{d.city}</td>
                <td className="px-4 py-3"><KycStatusChip status={d.kyc_status || "pending"} /></td>
                <td className="px-4 py-3">
                  <StatusChip status={d.status} />
                  {d.rental_block_status === "blocked" && (
                    <div className="mt-1">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-red-100 text-red-600 text-[9px] font-bold">Blocked (Unpaid)</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                  {d.rental_block_status === "blocked" && (
                    <button onClick={async () => {
                      if(window.confirm("Unblock this driver? They will have 24 hours to pay.")) {
                        try { await api.post(`/admin/drivers/${d.id}/unblock`); load(); } catch(err) { alert("Failed to unblock"); }
                      }
                    }} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded text-[10px] font-bold mr-2 transition-colors border border-emerald-200">
                      Unblock
                    </button>
                  )}
                  {/* Delete driver button removed (drivers can no longer be deleted from the list)
                  <button onClick={async () => {
                    if(window.confirm("Delete driver completely?")) {
                      await api.delete(`/drivers/${d.id}`);
                      load();
                    }
                  }} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  */}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <AddDriverDialog open={showAdd} setOpen={setShowAdd} onDone={() => { setShowAdd(false); load(); }} />
      <ImportDriversDialog open={showImport} setOpen={setShowImport} onDone={load} />
    </div>
  );
}

function ImportDriversDialog({ open, setOpen, onDone }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { if (open) { setFile(null); setResult(null); } }, [open]);

  const downloadTemplate = () => {
    const csv = "Name,Phone,City,Address,Emergency Contact,Licence No\nRavi Kumar,9876543210,Tiruppur,12 Main Road,9876500000,TN3920230001234\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "drivers_import_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async () => {
    if (!file) return toast.error("Choose an Excel or CSV file");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/drivers/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(data);
      if (data.created) { toast.success(`${data.created} driver(s) imported`); onDone(); }
      if (data.errors?.length) toast.error(`${data.errors.length} row(s) skipped`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Import failed");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">Import Drivers</DialogTitle></DialogHeader>
        <p className="text-sm text-mv-muted">Columns: <b>Name, Phone, City, Address, Emergency Contact, Licence No</b>. City must be Tiruppur, Coimbatore, Chennai or Bangalore.</p>
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

function AddDriverDialog({ open, setOpen, onDone }) {
  const { lockedCity, cities } = useApp(); // city managers: own city only; admins: all
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ 
    name: "", phone: "", city: lockedCity || "Chennai", address: "", 
    emergency_contact: "", license_number: "", status: "active",
    package_name: "", package_rate: 0
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Reset step and package when modal opens/closes or city changes
  useEffect(() => {
    if (!open) { 
      setStep(1); 
      setForm({
        name: "", phone: "", city: lockedCity || "Chennai", address: "", 
        emergency_contact: "", license_number: "", status: "active",
        package_name: "", package_rate: 0
      }); 
    }
  }, [open]);

  useEffect(() => {
    setForm(f => ({ ...f, package_name: "", package_rate: 0 }));
  }, [form.city]);



  const save = async () => {
    if (!/^\d{10}$/.test(form.phone) || !/^\d{10}$/.test(form.emergency_contact)) {
      toast.error("Phone and Emergency Contact must be exactly 10 digits");
      return;
    }
    if (!form.name || !form.phone || !form.city || !form.license_number || !form.address || !form.emergency_contact) { 
      toast.error("Please fill in all details (Name, Phone, City, Licence No, Address, Emergency Contact)"); 
      return; 
    }
    const aerr = validateAssign(form);
    if (aerr) { toast.error(aerr); return; }
    setSaving(true);
    try { await api.post("/drivers", form); toast.success("Driver added ✓"); onDone(); } 
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); } 
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">
            Add Driver Details
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 pt-2 animate-in fade-in slide-in-from-left-4 duration-300">
          <Field label="Name"><TextInput data-testid="driver-name" value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Phone"><TextInput data-testid="driver-phone" value={form.phone} inputMode="numeric" maxLength={10} onChange={(e) => set("phone", e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit mobile number" /></Field>
          <Field label="City">
            <Select value={form.city} onValueChange={(v) => set("city", v)}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text">
                {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Licence No."><TextInput value={form.license_number} onChange={(e) => set("license_number", e.target.value)} /></Field>
          <Field label="Address"><TextInput value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Emergency Contact"><TextInput value={form.emergency_contact} inputMode="numeric" maxLength={10} onChange={(e) => set("emergency_contact", e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit mobile number" /></Field>
          
          <DriverAssignFields city={form.city} form={form} set={set} assigned={null} />

          <div className="col-span-2 flex justify-end pt-4">
            <PrimaryBtn onClick={save} disabled={saving} data-testid="save-driver-btn">{saving ? "Saving..." : "Save Driver"}</PrimaryBtn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
