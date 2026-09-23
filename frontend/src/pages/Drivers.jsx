import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, Plus, Users, Car, MapPin, Phone, KeyRound, LayoutGrid, List, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useApp, CITIES } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { StatusChip, Skeleton, EmptyState, KycStatusChip } from "../components/common/Primitives";
import { PageHeader, FilterChip, PrimaryBtn, Field, TextInput } from "../components/common/Page";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

export default function Drivers() {
  const { city: gCity } = useApp();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [city, setCity] = useState(gCity);
  const [view, setView] = useState("cards");
  const [showAdd, setShowAdd] = useState(params.get("new") === "1");

  const load = useCallback(async () => {
    setItems(null);
    const p = {};
    if (status !== "all") p.status = status;
    if (city !== "all") p.city = city;
    if (q) p.q = q;
    try {
      const { data } = await api.get("/drivers", { params: p });
      setItems(data);
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
        {canEdit && <PrimaryBtn onClick={() => setShowAdd(true)} data-testid="add-driver-btn"><Plus className="w-4 h-4" /> Add Driver</PrimaryBtn>}
      </PageHeader>

      <div className="flex flex-col lg:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mv-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} data-testid="driver-search" placeholder="Search name, phone, vehicle…"
                 className="w-full h-10 pl-9 pr-3 rounded-xl bg-mv-surface border border-mv-border outline-none focus:border-mv-primary transition-colors text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="w-40 h-10 bg-mv-surface border-mv-border"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-mv-surface border-mv-border text-mv-text"><SelectItem value="all">All Cities</SelectItem>{CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex rounded-xl border border-mv-border overflow-hidden">
            <button onClick={() => setView("cards")} className={`w-10 h-10 flex items-center justify-center ${view === "cards" ? "bg-mv-elevated text-mv-primary" : "text-mv-dim"}`}><LayoutGrid className="w-4 h-4" /></button>
            <button onClick={() => setView("list")} className={`w-10 h-10 flex items-center justify-center ${view === "list" ? "bg-mv-elevated text-mv-primary" : "text-mv-dim"}`}><List className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        {["all", "active", "inactive"].map((s) => <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>{s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}</FilterChip>)}
      </div>

      {!items && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>}
      {items && items.length === 0 && <EmptyState icon={Users} title="No drivers found" subtitle="Add drivers to start assigning vehicles and rentals." action={canEdit && <PrimaryBtn onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Add Driver</PrimaryBtn>} />}

      {items && items.length > 0 && view === "cards" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((d, i) => (
            <button key={d.id} onClick={() => nav(`/drivers/${d.id}`)} data-testid={`driver-card-${d.id}`}
                    className="mv-card mv-card-hover p-5 text-left mv-rise" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
              <div className="flex items-center gap-3">
                <Avatar className="w-12 h-12"><AvatarImage src={d.avatar} /><AvatarFallback className="bg-mv-elevated text-sm">{d.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}</AvatarFallback></Avatar>
                <div className="min-w-0">
                  <div className="font-display font-semibold truncate">{d.name}</div>
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
              {d.rental_status === "active" && <div className="mt-3"><StatusChip status="active" label="Rental Active" /></div>}
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
                <td className="px-4 py-3 font-medium flex items-center gap-2"><Avatar className="w-7 h-7"><AvatarImage src={d.avatar} /><AvatarFallback className="text-[10px] bg-mv-elevated">{d.name[0]}</AvatarFallback></Avatar>{d.name}</td>
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
                <td className="px-4 py-3"><StatusChip status={d.status} /></td>
                <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                  <button onClick={async () => {
                    if(window.confirm("Delete driver completely?")) {
                      await api.delete(`/drivers/${d.id}`);
                      load();
                    }
                  }} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <AddDriverDialog open={showAdd} setOpen={setShowAdd} onDone={() => { setShowAdd(false); load(); }} />
    </div>
  );
}

function AddDriverDialog({ open, setOpen, onDone }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ 
    name: "", phone: "", city: "Chennai", address: "", 
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
        name: "", phone: "", city: "Chennai", address: "", 
        emergency_contact: "", license_number: "", status: "active",
        package_name: "", package_rate: 0
      }); 
    }
  }, [open]);

  useEffect(() => {
    setForm(f => ({ ...f, package_name: "", package_rate: 0 }));
  }, [form.city]);



  const save = async () => {
    if (!form.name || !form.phone || !form.city || !form.license_number || !form.address || !form.emergency_contact) { 
      toast.error("Please fill in all details (Name, Phone, City, Licence No, Address, Emergency Contact)"); 
      return; 
    }
    setSaving(true);
    try { await api.post("/drivers", form); toast.success("Driver added ✓"); onDone(); } 
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); } 
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            Add Driver Details
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 pt-2 animate-in fade-in slide-in-from-left-4 duration-300">
          <Field label="Name"><TextInput data-testid="driver-name" value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Phone"><TextInput data-testid="driver-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 9…" /></Field>
          <Field label="City">
            <Select value={form.city} onValueChange={(v) => set("city", v)}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text">
                {CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Licence No."><TextInput value={form.license_number} onChange={(e) => set("license_number", e.target.value)} /></Field>
          <Field label="Address"><TextInput value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Emergency Contact"><TextInput value={form.emergency_contact} onChange={(e) => set("emergency_contact", e.target.value)} /></Field>
          
          <div className="col-span-2 flex justify-end pt-4">
            <PrimaryBtn onClick={save} disabled={saving} data-testid="save-driver-btn">{saving ? "Saving..." : "Save Driver"}</PrimaryBtn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
