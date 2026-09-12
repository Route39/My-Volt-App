import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, Plus, ShieldCheck, ShieldAlert, ShieldX, Edit, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useApp, CITIES } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { Skeleton, EmptyState, StatusChip } from "../components/common/Primitives";
import { PageHeader, PrimaryBtn, GhostBtn, FilterChip, Field, TextInput } from "../components/common/Page";
import { fmtDate } from "../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

export default function Documents() {
  const { city } = useApp();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [items, setItems] = useState(null);
  const [status, setStatus] = useState(params.get("status") || "all");
  const [showNew, setShowNew] = useState(false);
  const [editDoc, setEditDoc] = useState(null);
  const [delDoc, setDelDoc] = useState(null);

  const load = useCallback(async () => {
    const p = {}; if (city !== "all") p.city = city; if (status !== "all") p.status = status;
    const { data } = await api.get("/documents", { params: p }); setItems(data);
  }, [city, status]);
  useEffect(() => { load(); }, [load]);

  const counts = { valid: 0, expiring_soon: 0, expired: 0 };
  (items || []).forEach((d) => { counts[d.doc_status] = (counts[d.doc_status] || 0) + 1; });

  const canEdit = ["admin", "city_manager"].includes(user?.role);

  return (
    <div>
      <PageHeader title="Documents" subtitle="Vehicle & driver compliance documents">
        {canEdit && <PrimaryBtn onClick={() => setShowNew(true)} data-testid="add-document-btn"><Plus className="w-4 h-4" /> Add Document</PrimaryBtn>}
      </PageHeader>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {[["Valid", counts.valid, ShieldCheck, "text-green-400"], ["Expiring Soon", counts.expiring_soon, ShieldAlert, "text-amber-400"], ["Expired", counts.expired, ShieldX, "text-red-400"]].map(([l, v, Icon, c]) => (
          <div key={l} className="mv-card p-4"><div className="flex items-center gap-2 mv-label"><Icon className={`w-4 h-4 ${c}`} /> {l}</div><div className={`font-display text-2xl font-bold mt-1 ${c}`}>{v}</div></div>
        ))}
      </div>

      <div className="flex gap-2 mb-5">
        {[["all", "All"], ["valid", "Valid"], ["expiring_soon", "Expiring"], ["expired", "Expired"]].map(([k, l]) => <FilterChip key={k} active={status === k} onClick={() => setStatus(k)} data-testid={`doc-filter-${k}`}>{l}</FilterChip>)}
      </div>

      {!items && <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>}
      {items && items.length === 0 && <EmptyState icon={FileText} title="No documents here." subtitle="Add RC, insurance, permits and licences to track expiry." />}
      {items && items.length > 0 && (
        <div className="mv-card divide-y divide-mv-border">
          {items.map((d) => (
            <div key={d.id} className="p-4 flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-mv-surface2 border border-mv-border flex items-center justify-center"><FileText className="w-4 h-4 text-mv-dim" /></div>
                <div><div className="font-medium">{d.doc_type} · <span className="text-mv-muted">{d.owner_label}</span></div><div className="text-xs text-mv-dim capitalize">{d.owner_type} · {d.city} · Expires {fmtDate(d.expiry_date)}</div></div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setEditDoc(d)} className="text-mv-muted hover:text-mv-primary p-1.5 rounded-md hover:bg-mv-surface2"><Edit className="w-4 h-4" /></button>
                  <button onClick={() => setDelDoc(d)} className="text-mv-muted hover:text-red-500 p-1.5 rounded-md hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                </div>
                <StatusChip status={d.doc_status} />
              </div>
            </div>
          ))}
        </div>
      )}

      <NewDocDialog open={showNew} setOpen={setShowNew} onDone={() => { setShowNew(false); load(); }} />
      <EditDocDialog open={!!editDoc} setOpen={(o) => { if (!o) setEditDoc(null); }} doc={editDoc} onDone={() => { setEditDoc(null); load(); }} />
      <DeleteDocDialog open={!!delDoc} setOpen={(o) => { if (!o) setDelDoc(null); }} doc={delDoc} onDone={() => { setDelDoc(null); load(); }} />
    </div>
  );
}

function NewDocDialog({ open, setOpen, onDone }) {
  const [owners, setOwners] = useState([]);
  const [form, setForm] = useState({ owner_type: "vehicle", owner_id: "", doc_type: "Insurance", number: "", expiry_date: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    if (!open) return;
    if (form.owner_type === "vehicle") api.get("/vehicles", { params: { page_size: 300 } }).then((r) => setOwners(r.data.items.map((v) => ({ id: v.id, label: v.vehicle_number, city: v.city }))));
    else api.get("/drivers").then((r) => setOwners(r.data.map((d) => ({ id: d.id, label: d.name, city: d.city }))));
  }, [open, form.owner_type]);
  const types = form.owner_type === "vehicle" ? ["RC", "Insurance", "Permit", "Fitness", "Pollution", "Tax", "Other"] : ["Driving Licence", "ID Proof", "Other"];
  const save = async () => {
    const o = owners.find((x) => x.id === form.owner_id);
    if (!o) { toast.error("Select owner"); return; }
    try { await api.post("/documents", { ...form, owner_label: o.label, city: o.city }); toast.success("Document added ✓"); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Add Document</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <Field label="Owner Type"><Select value={form.owner_type} onValueChange={(v) => { set("owner_type", v); set("owner_id", ""); }}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text"><SelectItem value="vehicle">Vehicle</SelectItem><SelectItem value="driver">Driver</SelectItem></SelectContent></Select></Field>
          <Field label="Owner"><Select value={form.owner_id} onValueChange={(v) => set("owner_id", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-56">{owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Document Type"><Select value={form.doc_type} onValueChange={(v) => set("doc_type", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Number"><TextInput value={form.number} onChange={(e) => set("number", e.target.value)} /></Field>
          <Field label="Expiry Date"><TextInput type="date" value={form.expiry_date} onChange={(e) => set("expiry_date", e.target.value)} /></Field>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save}>Add Document</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function EditDocDialog({ open, setOpen, doc, onDone }) {
  const [form, setForm] = useState({ number: "", expiry_date: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && doc) setForm({ number: doc.number || "", expiry_date: doc.expiry_date ? doc.expiry_date.slice(0, 10) : "" });
  }, [open, doc]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setSaving(true);
    try { await api.put(`/documents/${doc.id}`, { ...form }); toast.success("Document updated ✓"); onDone(); } catch { toast.error("Failed"); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Edit Document</DialogTitle></DialogHeader>
        <div className="text-sm mb-2 text-mv-muted">{doc?.doc_type} for {doc?.owner_label}</div>
        <div className="grid gap-4 pt-1">
          <Field label="Number"><TextInput value={form.number} onChange={(e) => set("number", e.target.value)} /></Field>
          <Field label="Expiry Date"><TextInput type="date" value={form.expiry_date} onChange={(e) => set("expiry_date", e.target.value)} /></Field>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} disabled={saving}>Save Changes</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDocDialog({ open, setOpen, doc, onDone }) {
  const [deleting, setDeleting] = useState(false);
  const del = async () => {
    setDeleting(true);
    try { await api.delete(`/documents/${doc.id}`); toast.success("Document deleted"); onDone(); } catch { toast.error("Failed to delete"); } finally { setDeleting(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display flex items-center gap-2 text-red-500"><AlertTriangle className="w-5 h-5" /> Delete Document</DialogTitle></DialogHeader>
        <p className="text-sm text-mv-muted">Are you sure you want to permanently delete <strong>{doc?.doc_type}</strong> for {doc?.owner_label}?</p>
        <div className="flex justify-end gap-2 pt-2"><GhostBtn onClick={() => setOpen(false)}>Cancel</GhostBtn><PrimaryBtn onClick={del} disabled={deleting} className="bg-red-500 hover:bg-red-600 text-white">Delete</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}
