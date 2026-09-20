import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Car, MapPin, User, Battery, Wrench, FileText, AlertTriangle, History,
  LogIn, LogOut, ArrowRightLeft, Zap, Edit2, Trash2
} from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { CITIES } from "../context/AppContext";
import { StatusChip, BatteryBar, Skeleton } from "../components/common/Primitives";
import { Field, TextInput, TextArea, PrimaryBtn, GhostBtn } from "../components/common/Page";
import { fmtDate, inr } from "../lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const ACCESSORY_KEYS = ["charger", "stepney", "jack", "tool_kit", "documents"];

export default function VehicleProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [v, setV] = useState(null);
  const [dialog, setDialog] = useState(null); // handover | return | transfer
  const [edit, setEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get(`/vehicles/${id}`);
    setV(data);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!v) return <div className="space-y-4"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;

  const canEdit = ["admin", "city_manager"].includes(user?.role);
  const info = [
    ["Model", v.model], ["Chassis", v.chassis_number], ["Odometer", `${(v.odometer || 0).toLocaleString()} km`],
    ["City", v.city], ["Parking", v.parking],
  ];

  return (
    <div>
      <button onClick={() => nav(-1)} className="flex items-center gap-1.5 text-sm text-mv-muted hover:text-mv-text mb-4"><ArrowLeft className="w-4 h-4" /> Back</button>

      {/* Header */}
      <div className="mv-card overflow-hidden mv-rise">
        <div className="h-32 bg-gradient-to-r from-blue-100 via-blue-50 to-white relative">
          <img src={v.image} alt="" className="w-full h-full object-cover opacity-25" />
          <div className="absolute inset-0 flex items-center px-6 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-mv-surface border border-mv-border flex items-center justify-center shrink-0"><Zap className="w-8 h-8 text-mv-primary" fill="currentColor" /></div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-display text-2xl font-bold">{v.vehicle_number}</h1>
                <StatusChip status={v.status} />
              </div>
              <div className="text-mv-muted font-mono text-sm mt-1">{v.registration_number} · {v.city}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 px-6 py-4 flex-wrap justify-between">
          <div className="flex items-center gap-6 text-sm">
            <span className="flex items-center gap-2"><User className="w-4 h-4 text-mv-dim" /> {v.current_driver_name || "No driver"}</span>
            <span className="flex items-center gap-2"><MapPin className="w-4 h-4 text-mv-dim" /> {v.parking || v.city}</span>
            {v.current_rental_code && <span className="flex items-center gap-2 text-mv-primary">{v.current_rental_code}</span>}
          </div>
          {canEdit && (
            <div className="flex items-center gap-2 flex-wrap">
              <GhostBtn onClick={() => setEdit(true)} data-testid="edit-btn"><Edit2 className="w-4 h-4" /> Edit</GhostBtn>
              <GhostBtn onClick={() => setDeleting(true)} data-testid="delete-btn" className="text-red-500 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /> Delete</GhostBtn>
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview" className="mt-6">
        <TabsList className="bg-mv-surface border border-mv-border flex-wrap h-auto">
          {["overview", "rental", "driver"].map((t) => (
            <TabsTrigger key={t} value={t} className="data-[state=active]:bg-mv-elevated capitalize" data-testid={`vtab-${t}`}>{t}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {info.map(([k, val]) => (
              <div key={k} className="mv-card p-4"><div className="mv-label">{k}</div><div className="text-sm font-medium mt-1 break-words">{val || "—"}</div></div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="rental" className="mt-4">
          {v.current_rental ? (
            <div className="mv-card p-5">
              <div className="flex items-center justify-between mb-4"><h3 className="font-display font-semibold">{v.current_rental.rental_code}</h3>
                <button onClick={() => nav(`/rentals/${v.current_rental.id}`)} className="text-sm text-mv-primary hover:underline">Open rental →</button></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div><div className="mv-label">Plan</div>{v.current_rental.plan_name}</div>
                <div><div className="mv-label">Start</div>{fmtDate(v.current_rental.start)}</div>
                <div><div className="mv-label">End</div>{fmtDate(v.current_rental.end)}</div>
                <div><div className="mv-label">Amount</div>{inr(v.current_rental.amount)}</div>
              </div>
            </div>
          ) : <div className="mv-card p-10 text-center text-mv-muted text-sm">No active rental for this vehicle.</div>}
        </TabsContent>

        <TabsContent value="driver" className="mt-4">
          {v.current_driver_id ? (
            <button onClick={() => nav(`/drivers/${v.current_driver_id}`)} className="mv-card mv-card-hover p-5 flex items-center gap-4 w-full text-left">
              <div className="w-12 h-12 rounded-full bg-mv-elevated flex items-center justify-center"><User className="w-6 h-6 text-mv-muted" /></div>
              <div><div className="font-semibold">{v.current_driver_name}</div><div className="text-sm text-mv-dim">View driver profile →</div></div>
            </button>
          ) : <div className="mv-card p-10 text-center text-mv-muted text-sm">No driver assigned.</div>}
        </TabsContent>
      </Tabs>

      <EditVehicleDialog open={edit} setOpen={setEdit} vehicle={v} onDone={() => { setEdit(false); load(); }} />
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="bg-mv-surface max-w-sm">
          <DialogHeader><DialogTitle>Delete Vehicle?</DialogTitle></DialogHeader>
          <p className="text-sm text-mv-muted">Are you sure you want to permanently delete vehicle <strong>{v?.vehicle_number}</strong>? This action cannot be undone and will unassign any active driver.</p>
          <div className="flex justify-end gap-3 mt-4">
            <GhostBtn onClick={() => setDeleting(false)}>Cancel</GhostBtn>
            <PrimaryBtn className="bg-red-600 hover:bg-red-700 text-white" onClick={async () => {
              try { await api.delete(`/vehicles/${v.id || v._id}`); toast.success("Vehicle deleted"); nav("/fleet"); }
              catch { toast.error("Failed to delete"); } finally { setDeleting(false); }
            }}>Delete</PrimaryBtn>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditVehicleDialog({ open, setOpen, vehicle, onDone }) {
  const [form, setForm] = useState(vehicle);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => { if (open) setForm(vehicle); }, [open, vehicle]);

  const save = async () => {
    setSaving(true);
    try { await api.put(`/vehicles/${vehicle.id || vehicle._id}`, form); toast.success("Vehicle updated ✓"); onDone(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed to update"); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">Edit Vehicle</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <Field label="Registration Number">
            <TextInput value={form.registration_number || ""} onChange={(e) => set("registration_number", e.target.value)} />
          </Field>
          <Field label="Model">
            <TextInput value={form.model || ""} onChange={(e) => set("model", e.target.value)} />
          </Field>
          <Field label="Odometer (km)">
            <TextInput type="number" value={form.odometer || ""} onChange={(e) => set("odometer", parseInt(e.target.value))} />
          </Field>
          <Field label="Chassis Number">
            <TextInput value={form.chassis_number || ""} onChange={(e) => set("chassis_number", e.target.value)} />
          </Field>
          <Field label="Parking Location">
            <TextInput value={form.parking || ""} onChange={(e) => set("parking", e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-4">
          <PrimaryBtn onClick={save} disabled={saving} className="w-full">
            {saving ? "Saving..." : "Save Changes"}
          </PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}


