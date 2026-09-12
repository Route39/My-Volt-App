import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, AlertTriangle, Car } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { Skeleton, EmptyState, StatusChip } from "../components/common/Primitives";
import { PageHeader, PrimaryBtn, Field, TextInput, TextArea } from "../components/common/Page";
import { fmtDate, inr } from "../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const FLOW = ["reported", "investigation", "action", "resolved", "closed"];

export default function Incidents() {
  const { city } = useApp();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [items, setItems] = useState(null);
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [detail, setDetail] = useState(null);
  const canEdit = ["admin", "city_manager"].includes(user?.role);

  const load = useCallback(async () => {
    const p = {}; if (city !== "all") p.city = city;
    const { data } = await api.get("/incidents", { params: p }); setItems(data);
  }, [city]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="Incidents" subtitle="Accidents, damages, and safety reports">
        {canEdit && <PrimaryBtn onClick={() => setShowNew(true)} data-testid="report-incident-btn"><Plus className="w-4 h-4" /> Report Incident</PrimaryBtn>}
      </PageHeader>

      {!items && <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>}
      {items && items.length === 0 && <EmptyState icon={AlertTriangle} title="No incidents reported ✓" subtitle="A clean record. Report an incident if something happens." />}
      {items && items.length > 0 && (
        <div className="mv-card divide-y divide-mv-border">
          {items.map((i) => (
            <button key={i.id} onClick={() => setDetail(i)} className="w-full p-4 flex items-center justify-between hover:bg-mv-elevated transition-colors text-left">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-red-400" /></div>
                <div><div className="font-medium">{i.code} · {i.incident_type}</div><div className="text-xs text-mv-dim">{i.vehicle_number} · {i.city} · {fmtDate(i.created_at)}</div></div>
              </div>
              <div className="flex items-center gap-3">{i.estimated_damage > 0 && <span className="text-xs text-mv-muted">{inr(i.estimated_damage)}</span>}<StatusChip status={i.status} /></div>
            </button>
          ))}
        </div>
      )}

      <NewIncidentDialog open={showNew} setOpen={setShowNew} onDone={() => { setShowNew(false); load(); }} />
      <IncidentDetail inc={detail} setInc={setDetail} onChange={load} />
    </div>
  );
}

function NewIncidentDialog({ open, setOpen, onDone }) {
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState({ vehicle_id: "", incident_type: "Accident", location: "", description: "", estimated_damage: 0 });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => { if (open) api.get("/vehicles", { params: { page_size: 300 } }).then((r) => setVehicles(r.data.items)); }, [open]);
  const save = async () => {
    const v = vehicles.find((x) => x.id === form.vehicle_id);
    if (!v) { toast.error("Select a vehicle"); return; }
    try { await api.post("/incidents", { ...form, estimated_damage: Number(form.estimated_damage), vehicle_number: v.vehicle_number, city: v.city, driver_id: v.current_driver_id, driver_name: v.current_driver_name }); toast.success("Incident reported ✓"); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Report Incident</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <Field label="Vehicle"><Select value={form.vehicle_id} onValueChange={(v) => set("vehicle_id", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border" data-testid="inc-vehicle"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-56">{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.vehicle_number} · {v.city}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Type"><Select value={form.incident_type} onValueChange={(v) => set("incident_type", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["Accident", "Vehicle Damage", "Driver Incident", "Theft", "Lost Equipment", "Other"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Location"><TextInput value={form.location} onChange={(e) => set("location", e.target.value)} /></Field>
          <Field label="Est. Damage (₹)"><TextInput type="number" value={form.estimated_damage} onChange={(e) => set("estimated_damage", e.target.value)} /></Field>
        </div>
        <Field label="Description"><TextArea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-incident-btn">Report</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function IncidentDetail({ inc, setInc, onChange }) {
  if (!inc) return null;
  const setStatus = async (status) => { try { await api.put(`/incidents/${inc.id}`, { status }); toast.success(`Status → ${status}`); onChange(); setInc({ ...inc, status }); } catch { toast.error("Failed"); } };
  return (
    <Dialog open={!!inc} onOpenChange={() => setInc(null)}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-lg">
        <DialogHeader><DialogTitle className="font-display flex items-center gap-2">{inc.code} <StatusChip status={inc.status} /></DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[["Type", inc.incident_type], ["Vehicle", inc.vehicle_number], ["Driver", inc.driver_name || "—"], ["City", inc.city], ["Location", inc.location], ["Est. Damage", inr(inc.estimated_damage)]].map(([k, v]) => (
            <div key={k}><div className="mv-label">{k}</div><div className="font-medium">{v}</div></div>
          ))}
        </div>
        {inc.description && <p className="text-sm text-mv-muted">{inc.description}</p>}
        <div>
          <div className="mv-label mb-2">Workflow</div>
          <div className="flex flex-wrap gap-2">
            {FLOW.map((s) => <button key={s} onClick={() => setStatus(s)} className={`h-8 px-3 rounded-full text-xs capitalize transition-colors ${inc.status === s ? "bg-mv-primary text-white" : "border border-mv-border text-mv-muted hover:bg-mv-elevated"}`}>{s}</button>)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
