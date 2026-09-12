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
            <div className="flex items-center gap-3 flex-wrap"><h1 className="font-display text-2xl font-bold">{r.rental_code}</h1><StatusChip status={r.status === "suspended" ? "suspended" : r.display_status} /><StatusChip status={r.payment_status === "paid" ? "paid" : r.payment_status === "partial" ? "partial" : "pending"} label={r.payment_status === "paid" ? "Paid" : r.payment_status === "partial" ? "Partial" : "Due"} /></div>
            <div className="flex items-center gap-5 mt-2 text-sm text-mv-muted flex-wrap">
              <button onClick={() => nav(`/drivers/${r.driver_id}`)} className="flex items-center gap-1.5 hover:text-mv-text"><User className="w-4 h-4" /> {r.driver_name}</button>
              <button onClick={() => nav(`/fleet/${r.vehicle_id}`)} className="flex items-center gap-1.5 hover:text-mv-text"><Car className="w-4 h-4" /> {r.vehicle_number}</button>
              <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {fmtDate(r.start)} → {fmtDate(r.end)}</span>
            </div>
          </div>
          {canManage && (
            <div className="flex gap-2 flex-wrap">
              {r.status === "pending_payment" && <PrimaryBtn onClick={() => action("activate", "Rental activated ✓")} disabled={busy} data-testid="activate-rental-btn"><Zap className="w-4 h-4" /> Activate</PrimaryBtn>}
              <GhostBtn onClick={() => setDialog("pay")} data-testid="add-payment-btn"><Plus className="w-4 h-4" /> Payment</GhostBtn>
              {["active", "expiring_soon", "expired", "suspended"].includes(r.display_status) || r.status === "active" ? <GhostBtn onClick={() => setDialog("renew")} data-testid="renew-rental-btn"><RefreshCw className="w-4 h-4" /> Renew</GhostBtn> : null}
              {r.status === "active" && <GhostBtn onClick={() => action("suspend", "Rental suspended")} disabled={busy}><Ban className="w-4 h-4" /> Suspend</GhostBtn>}
              {r.status !== "closed" && <GhostBtn onClick={() => action("close", "Rental closed")} disabled={busy} data-testid="close-rental-btn"><CheckCircle2 className="w-4 h-4" /> Close</GhostBtn>}
              <GhostBtn onClick={() => setDialog("edit")}><Edit className="w-4 h-4" /> Edit</GhostBtn>
              <GhostBtn onClick={() => setDialog("delete")} className="text-red-500 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /> Delete</GhostBtn>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Payment ledger */}
          <div className="mv-card p-5">
            <div className="flex items-center justify-between mb-4"><h3 className="font-display font-semibold">Payment Ledger</h3><span className="mv-label">Rental payments only</span></div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="mv-card bg-mv-surface2 p-3"><div className="mv-label">Total Due</div><div className="font-display text-xl font-bold">{inr(totalDue)}</div></div>
              <div className="mv-card bg-mv-surface2 p-3"><div className="mv-label">Paid</div><div className="font-display text-xl font-bold text-green-400">{inr(r.paid)}</div></div>
              <div className="mv-card bg-mv-surface2 p-3"><div className="mv-label">Outstanding</div><div className={`font-display text-xl font-bold ${r.outstanding > 0 ? "text-red-400" : "text-green-400"}`}>{inr(r.outstanding)}</div></div>
            </div>
            {(r.payments || []).length === 0 ? <div className="py-8 text-center text-mv-dim text-sm">No payments recorded yet.</div> : (
              <div className="divide-y divide-mv-border">
                {r.payments.map((p) => (
                  <div key={p.id} className="py-3 flex items-center justify-between">
                    <div><div className="text-sm font-medium capitalize">{p.type} · {inr(p.amount)}</div><div className="text-xs text-mv-dim">{fmtDate(p.payment_date, true)} · {p.method?.toUpperCase()} {p.reference}</div></div>
                    <StatusChip status={p.type === "refund" ? "amber" : "paid"} label={p.type === "refund" ? "Refund" : "Received"} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {(r.renewal_history || []).length > 0 && (
            <div className="mv-card p-5">
              <h3 className="font-display font-semibold mb-3">Renewal History</h3>
              <div className="relative pl-6 space-y-3">
                <div className="absolute left-[9px] top-1 bottom-1 w-px bg-mv-border" />
                {r.renewal_history.map((h, i) => (
                  <div key={i} className="relative"><div className="absolute -left-6 w-4 h-4 rounded-full bg-mv-surface border-2 border-mv-primary" /><div className="text-sm">Renewed {fmtDate(h.renewed_at)} · was ending {fmtDate(h.previous_end)}</div></div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="mv-card p-5 space-y-3 text-sm">
            <h3 className="font-display font-semibold">Details</h3>
            {[["Plan", r.plan_name], ["City", r.city], ["Amount", inr(r.amount)], ["Deposit", inr(r.deposit)], ["Start", fmtDate(r.start, true)], ["End", fmtDate(r.end, true)]].map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="text-mv-muted">{k}</span><span className="font-medium">{v}</span></div>
            ))}
          </div>
        </div>
      </div>

      <PaymentDialog open={dialog === "pay"} setOpen={() => setDialog(null)} rental={r} onDone={() => { setDialog(null); load(); }} />
      <RenewDialog open={dialog === "renew"} setOpen={() => setDialog(null)} rental={r} onDone={() => { setDialog(null); load(); }} />
      <EditRentalDialog open={dialog === "edit"} setOpen={() => setDialog(null)} rental={r} onDone={() => { setDialog(null); load(); }} />
      <DeleteRentalDialog open={dialog === "delete"} setOpen={() => setDialog(null)} rental={r} onDone={() => { setDialog(null); nav("/rentals"); }} />
    </div>
  );
}

function PaymentDialog({ open, setOpen, rental, onDone }) {
  const [form, setForm] = useState({ amount: rental.outstanding || 0, type: "payment", method: "upi", reference: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    try { await api.post(`/rentals/${rental.id}/payments`, { ...form, amount: Number(form.amount) }); toast.success("Payment recorded ✓"); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Record Payment</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-2">
          <Field label="Amount (₹)"><TextInput type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} data-testid="payment-amount" /></Field>
          <Field label="Type"><Select value={form.type} onValueChange={(v) => set("type", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["payment", "deposit", "refund"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Method"><Select value={form.method} onValueChange={(v) => set("method", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["upi", "cash", "card", "bank"].map((m) => <SelectItem key={m} value={m} className="uppercase">{m}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Reference"><TextInput value={form.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-payment-btn">Record</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function RenewDialog({ open, setOpen, rental, onDone }) {
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState({ plan_id: rental.plan_id, end: rental.end?.slice(0, 10), amount: rental.amount });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => { if (open) api.get("/rental-plans").then((r) => setPlans(r.data.filter((p) => p.active))); }, [open]);
  const pickPlan = (id) => { const p = plans.find((x) => x.id === id); const end = new Date(Date.now() + (p?.duration_days || 1) * 86400000); set("plan_id", id); set("amount", p?.amount || 0); set("end", end.toISOString().slice(0, 10)); };
  const save = async () => {
    try { await api.post(`/rentals/${rental.id}/renew`, { plan_id: form.plan_id, end: new Date(form.end).toISOString(), amount: Number(form.amount) }); toast.success("Rental renewed ✓"); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Renew Rental</DialogTitle></DialogHeader>
        <div className="grid gap-4 pt-2">
          <Field label="Plan">
            <Select value={form.plan_id} onValueChange={pickPlan}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder="Select plan" /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-64">{plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} - {inr(p.amount)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="New End Date"><TextInput type="date" value={form.end} onChange={(e) => set("end", e.target.value)} /></Field>
            <Field label="Amount to Charge"><TextInput type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
          </div>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-renew-btn">Confirm Renewal</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
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
