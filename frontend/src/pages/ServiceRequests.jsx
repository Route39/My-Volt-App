import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Plus, Wrench, Car, User, Clock, GripVertical, Edit, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useApp } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { StatusChip, Skeleton } from "../components/common/Primitives";
import { PageHeader, PrimaryBtn, GhostBtn, Field, TextInput, TextArea } from "../components/common/Page";
import { timeAgo } from "../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const STAGES = [
  ["new", "New"], ["assigned", "Assigned"], ["inspection", "Inspection"],
  ["repair", "Repair"], ["ready", "Ready"], ["closed", "Closed"],
];
const PRIO_DOT = { critical: "bg-red-500", high: "bg-amber-500", medium: "bg-blue-500", low: "bg-zinc-500" };

export default function ServiceRequests() {
  const { city } = useApp();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [detail, setDetail] = useState(null);
  const [editSr, setEditSr] = useState(null);
  const [delSr, setDelSr] = useState(null);
  const [dragId, setDragId] = useState(null);
  const priorityFilter = params.get("priority");

  const load = useCallback(async () => {
    const p = {};
    if (city !== "all") p.city = city;
    if (priorityFilter) p.priority = priorityFilter;
    const { data } = await api.get("/service-requests", { params: p });
    setItems(data);
  }, [city, priorityFilter]);
  useEffect(() => { load(); }, [load]);

  const move = async (sr, status) => {
    if (sr.status === status) return;
    setItems((its) => its.map((x) => x.id === sr.id ? { ...x, status } : x));
    try { await api.put(`/service-requests/${sr.id}`, { status }); toast.success(`${sr.code} → ${status}`); load(); }
    catch { toast.error("Failed to move"); load(); }
  };

  const canEdit = ["admin", "city_manager"].includes(user?.role);

  return (
    <div>
      <PageHeader title="Service Requests" subtitle="Visual maintenance workflow · drag cards across stages">
        {canEdit && <PrimaryBtn onClick={() => setShowNew(true)} data-testid="create-sr-btn"><Plus className="w-4 h-4" /> New Request</PrimaryBtn>}
      </PageHeader>

      {!items && <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>}

      {items && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {STAGES.map(([key, label]) => {
            const col = items.filter((s) => s.status === key);
            return (
              <div key={key} onDragOver={(e) => e.preventDefault()} onDrop={() => { const sr = items.find((x) => x.id === dragId); if (sr) move(sr, key); setDragId(null); }}
                   className="mv-card bg-mv-surface2/50 p-2.5 min-h-[200px]">
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-mv-muted">{label}</span>
                  <span className="text-xs bg-mv-elevated rounded-full px-2 py-0.5 text-mv-dim">{col.length}</span>
                </div>
                <div className="space-y-2">
                  {col.map((s) => (
                    <div key={s.id} draggable onDragStart={() => setDragId(s.id)} onClick={() => setDetail(s)}
                         data-testid={`sr-card-${s.id}`}
                         className={`mv-card p-3 cursor-grab active:cursor-grabbing hover:border-mv-primary/50 transition-colors ${dragId === s.id ? "opacity-50" : "mv-rise"}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-mv-dim">{s.code}</span>
                        <span className={`w-2 h-2 rounded-full ${PRIO_DOT[s.priority]}`} title={s.priority} />
                      </div>
                      <div className="text-sm font-medium mt-1.5 flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5 text-amber-400" /> {s.issue_type}</div>
                      <div className="mt-2 space-y-1 text-[11px] text-mv-muted">
                        <div className="flex items-center gap-1"><Car className="w-3 h-3" /> {s.vehicle_number}</div>
                        <div className="flex items-center gap-1"><User className="w-3 h-3" /> {s.driver_name || "—"} · {s.city}</div>
                        <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> {timeAgo(s.created_at)}</div>
                      </div>
                      <div className="mt-2"><StatusChip status={s.priority} /></div>
                    </div>
                  ))}
                  {col.length === 0 && <div className="text-[11px] text-mv-dim text-center py-6">Drop here</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewSRDialog open={showNew} setOpen={setShowNew} onDone={() => { setShowNew(false); load(); }} />
      <SRDetail sr={detail} setSr={setDetail} onEdit={() => { setEditSr(detail); setDetail(null); }} onDelete={() => { setDelSr(detail); setDetail(null); }} onChange={load} />
      <EditSRDialog open={!!editSr} setOpen={(o) => { if (!o) setEditSr(null); }} sr={editSr} onDone={() => { setEditSr(null); load(); }} />
      <DeleteSRDialog open={!!delSr} setOpen={(o) => { if (!o) setDelSr(null); }} sr={delSr} onDone={() => { setDelSr(null); load(); }} />
    </div>
  );
}

function NewSRDialog({ open, setOpen, onDone }) {
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState({ vehicle_id: "", issue_type: "Breakdown", priority: "high", source: "Operations", description: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => { if (open) api.get("/vehicles", { params: { page_size: 200 } }).then((r) => setVehicles(r.data.items)); }, [open]);
  const save = async () => {
    const v = vehicles.find((x) => x.id === form.vehicle_id);
    if (!v) { toast.error("Select a vehicle"); return; }
    try { await api.post("/service-requests", { ...form, vehicle_number: v.vehicle_number, city: v.city, driver_id: v.current_driver_id, driver_name: v.current_driver_name }); toast.success("Service request created ✓"); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">New Service Request</DialogTitle></DialogHeader>
        <Field label="Vehicle"><Select value={form.vehicle_id} onValueChange={(v) => set("vehicle_id", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border" data-testid="sr-vehicle-select"><SelectValue placeholder="Select vehicle" /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-64">{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.vehicle_number} · {v.city}</SelectItem>)}</SelectContent></Select></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Issue Type"><Select value={form.issue_type} onValueChange={(v) => set("issue_type", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["Breakdown", "Battery", "Tyre", "Brake", "Electrical", "Charger", "Accident", "General", "Other"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Priority"><Select value={form.priority} onValueChange={(v) => set("priority", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["critical", "high", "medium", "low"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent></Select></Field>
        </div>
        <Field label="Description"><TextArea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-sr-btn">Create Request</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function SRDetail({ sr, setSr, onEdit, onDelete, onChange }) {
  const [assigned, setAssigned] = useState("");
  useEffect(() => { setAssigned(sr?.assigned_to || ""); }, [sr]);
  if (!sr) return null;
  const saveAssign = async () => { try { await api.put(`/service-requests/${sr.id}`, { assigned_to: assigned }); toast.success("Updated ✓"); onChange(); setSr(null); } catch { toast.error("Failed"); } };
  return (
    <Dialog open={!!sr} onOpenChange={() => setSr(null)}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-lg">
        <DialogHeader><DialogTitle className="font-display flex items-center gap-2">{sr.code} <StatusChip status={sr.priority} /></DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            {[["Vehicle", sr.vehicle_number], ["Driver", sr.driver_name || "—"], ["Issue", sr.issue_type], ["City", sr.city], ["Source", sr.source], ["Status", sr.status]].map(([k, v]) => (
              <div key={k}><div className="mv-label">{k}</div><div className="font-medium capitalize">{v}</div></div>
            ))}
          </div>
          {sr.description && <div><div className="mv-label">Description</div><p className="text-mv-muted mt-1">{sr.description}</p></div>}
          <Field label="Assigned To"><TextInput value={assigned} onChange={(e) => setAssigned(e.target.value)} placeholder="Technician / workshop" /></Field>
          <div><div className="mv-label mb-2">Timeline</div>
            <div className="relative pl-5 space-y-2">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-mv-border" />
              {(sr.timeline || []).map((t, i) => (<div key={i} className="relative flex items-center gap-2"><div className="absolute -left-5 w-3 h-3 rounded-full bg-mv-surface border-2 border-mv-primary" /><span className="capitalize text-mv-text">{t.stage}</span><span className="text-xs text-mv-dim">{timeAgo(t.at)}</span></div>))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <GhostBtn onClick={onDelete} className="text-red-500 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /> Delete</GhostBtn>
          <GhostBtn onClick={onEdit}><Edit className="w-4 h-4" /> Edit</GhostBtn>
          <PrimaryBtn onClick={saveAssign}>Save Assignment</PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditSRDialog({ open, setOpen, sr, onDone }) {
  const [form, setForm] = useState({ issue_type: "", priority: "", description: "", status: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && sr) setForm({ issue_type: sr.issue_type, priority: sr.priority, description: sr.description || "", status: sr.status });
  }, [open, sr]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setSaving(true);
    try { await api.put(`/service-requests/${sr.id}`, form); toast.success("Request updated ✓"); onDone(); } catch { toast.error("Failed"); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Edit Service Request</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-2">
          <Field label="Issue Type"><Select value={form.issue_type} onValueChange={(v) => set("issue_type", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["Breakdown", "Battery", "Tyre", "Brake", "Electrical", "Charger", "Accident", "General", "Other"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Priority"><Select value={form.priority} onValueChange={(v) => set("priority", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["critical", "high", "medium", "low"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent></Select></Field>
          <div className="col-span-2"><Field label="Status"><Select value={form.status} onValueChange={(v) => set("status", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{STAGES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field></div>
          <div className="col-span-2"><Field label="Description"><TextArea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field></div>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} disabled={saving}>Save Changes</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSRDialog({ open, setOpen, sr, onDone }) {
  const [deleting, setDeleting] = useState(false);
  const del = async () => {
    setDeleting(true);
    try { await api.delete(`/service-requests/${sr.id}`); toast.success("Request deleted"); onDone(); } catch { toast.error("Failed to delete"); } finally { setDeleting(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display flex items-center gap-2 text-red-500"><AlertTriangle className="w-5 h-5" /> Delete Request</DialogTitle></DialogHeader>
        <p className="text-sm text-mv-muted">Are you sure you want to permanently delete service request <strong>{sr?.code}</strong>?</p>
        <div className="flex justify-end gap-2 pt-2"><GhostBtn onClick={() => setOpen(false)}>Cancel</GhostBtn><PrimaryBtn onClick={del} disabled={deleting} className="bg-red-500 hover:bg-red-600 text-white">Delete</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}
