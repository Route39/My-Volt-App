import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, RefreshCw, Ban, CheckCircle2, Plus, User, Car, Calendar, Loader2, Edit, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { StatusChip, Skeleton } from "../components/common/Primitives";
import { Field, TextInput, TextArea, PrimaryBtn, GhostBtn } from "../components/common/Page";
import { fmtDate, inr } from "../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

export default function RentalProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [r, setR] = useState(null);
  const [dialog, setDialog] = useState(null); // pay | renew | edit | delete
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { const { data } = await api.get(`/rentals/${id}`); setR(data); }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!r) return <div className="space-y-4"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  const canManage = ["admin", "city_manager"].includes(user?.role);

  const action = async (path, ok) => {
    setBusy(true);
    try { await api.post(`/rentals/${id}/${path}`); toast.success(ok); load(); } catch (e) { toast.error(e.response?.data?.detail || "Failed"); } finally { setBusy(false); }
  };

  const totalDue = (r.amount || 0) + (r.deposit || 0);

  return (
    <div>
      <button onClick={() => nav("/rentals")} className="flex items-center gap-1.5 text-sm text-mv-muted hover:text-mv-text mb-4"><ArrowLeft className="w-4 h-4" /> Rentals</button>

      <div className="mv-card p-6 mv-rise">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap"><h1 className="font-display text-2xl font-bold">{r.rental_code}</h1><StatusChip status={r.status === "suspended" ? "suspended" : r.display_status} /></div>
            <div className="flex items-center gap-5 mt-2 text-sm text-mv-muted flex-wrap">
              <button onClick={() => nav(`/drivers/${r.driver_id}`)} className="flex items-center gap-1.5 hover:text-mv-text"><User className="w-4 h-4" /> {r.driver_name}</button>
              <button onClick={() => nav(`/fleet/${r.vehicle_id}`)} className="flex items-center gap-1.5 hover:text-mv-text"><Car className="w-4 h-4" /> {r.vehicle_number}</button>
              <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {fmtDate(r.start)} → {(r.end && r.end !== 'Ongoing') ? fmtDate(r.end) : 'Ongoing'}</span>
            </div>
          </div>
          {canManage && (
            <div className="flex gap-2 flex-wrap">
              {r.status === "pending_payment" && <PrimaryBtn onClick={() => action("activate", "Rental activated ✓")} disabled={busy} data-testid="activate-rental-btn"><Zap className="w-4 h-4" /> Activate</PrimaryBtn>}
              {r.status === "active" && <GhostBtn onClick={() => action("suspend", "Rental suspended")} disabled={busy}><Ban className="w-4 h-4" /> Suspend</GhostBtn>}
              {r.status !== "closed" && <GhostBtn onClick={() => action("close", "Rental closed")} disabled={busy} data-testid="close-rental-btn"><CheckCircle2 className="w-4 h-4" /> Close</GhostBtn>}
              <GhostBtn onClick={() => setDialog("edit")}><Edit className="w-4 h-4" /> Edit</GhostBtn>
              <GhostBtn onClick={() => setDialog("delete")} className="text-red-500 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /> Delete</GhostBtn>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mt-4">
        <div className="space-y-4">
          <div className="mv-card p-5 space-y-3 text-sm">
            <h3 className="font-display font-semibold">Details</h3>
            {[["Plan", r.plan_name], ["City", r.city], ["Start", fmtDate(r.start, true)], ["End", (r.end && r.end !== 'Ongoing') ? fmtDate(r.end, true) : 'Ongoing']].map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="text-mv-muted">{k}</span><span className="font-medium">{v}</span></div>
            ))}
          </div>
        </div>
      </div>

      <EditRentalDialog open={dialog === "edit"} setOpen={() => setDialog(null)} rental={r} onDone={() => { setDialog(null); load(); }} />
      <DeleteRentalDialog open={dialog === "delete"} setOpen={() => setDialog(null)} rental={r} onDone={() => { setDialog(null); nav("/rentals"); }} />
    </div>
  );
}

function EditRentalDialog({ open, setOpen, rental, onDone }) {
  const [form, setForm] = useState({ start: "", end: "", amount: 0, deposit: 0, status: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && rental) setForm({ start: rental.start?.slice(0, 16), end: rental.end?.slice(0, 16), amount: rental.amount, deposit: rental.deposit, status: rental.status });
  }, [open, rental]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setSaving(true);
    try { await api.put(`/rentals/${rental.id}`, { ...form, start: new Date(form.start).toISOString(), end: form.end ? new Date(form.end).toISOString() : null, amount: Number(form.amount), deposit: Number(form.deposit) }); toast.success("Rental updated ✓"); onDone(); } catch (e) { toast.error("Failed to update"); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Edit Rental</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-2">
          <Field label="Start Time"><TextInput type="datetime-local" value={form.start} onChange={(e) => set("start", e.target.value)} /></Field>
          <Field label="End Time"><TextInput type="datetime-local" value={form.end} onChange={(e) => set("end", e.target.value)} /></Field>
          <Field label="Amount"><TextInput type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
          <Field label="Deposit"><TextInput type="number" value={form.deposit} onChange={(e) => set("deposit", e.target.value)} /></Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text"><SelectItem value="pending_payment">Pending Payment</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} disabled={saving}>Save Changes</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRentalDialog({ open, setOpen, rental, onDone }) {
  const [deleting, setDeleting] = useState(false);
  const del = async () => {
    setDeleting(true);
    try { await api.delete(`/rentals/${rental.id}`); toast.success("Rental deleted"); onDone(); } catch { toast.error("Failed to delete"); } finally { setDeleting(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display flex items-center gap-2 text-red-500"><AlertTriangle className="w-5 h-5" /> Delete Rental</DialogTitle></DialogHeader>
        <p className="text-sm text-mv-muted">Are you sure you want to permanently delete rental <strong>{rental?.rental_code}</strong>? This action cannot be undone.</p>
        <div className="flex justify-end gap-2 pt-2"><GhostBtn onClick={() => setOpen(false)}>Cancel</GhostBtn><PrimaryBtn onClick={del} disabled={deleting} className="bg-red-500 hover:bg-red-600 text-white">Delete</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}
