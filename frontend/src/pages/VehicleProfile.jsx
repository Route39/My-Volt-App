import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Car, MapPin, User, Battery, Wrench, FileText, AlertTriangle, History,
  LogIn, LogOut, ArrowRightLeft, Zap,
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

  const load = useCallback(async () => {
    const { data } = await api.get(`/vehicles/${id}`);
    setV(data);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!v) return <div className="space-y-4"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;

  const canEdit = ["admin", "city_manager"].includes(user?.role);
  const info = [
    ["Model", v.model], ["Mfg Year", v.manufacturing_year], ["Chassis", v.chassis_number],
    ["Battery", v.battery_capacity], ["Charger", v.charger], ["Odometer", `${(v.odometer || 0).toLocaleString()} km`],
    ["City", v.city], ["Parking", v.parking], ["Next Service", fmtDate(v.next_service_date)],
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
              <GhostBtn onClick={() => setDialog("handover")} data-testid="handover-btn"><LogIn className="w-4 h-4" /> Handover</GhostBtn>
              <GhostBtn onClick={() => setDialog("return")} data-testid="return-btn"><LogOut className="w-4 h-4" /> Return</GhostBtn>
              <GhostBtn onClick={() => setDialog("transfer")} data-testid="transfer-btn"><ArrowRightLeft className="w-4 h-4" /> Transfer</GhostBtn>
              <StatusSelect v={v} onDone={load} />
            </div>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview" className="mt-6">
        <TabsList className="bg-mv-surface border border-mv-border flex-wrap h-auto">
          {["overview", "rental", "driver", "service", "documents", "incidents", "history"].map((t) => (
            <TabsTrigger key={t} value={t} className="data-[state=active]:bg-mv-elevated capitalize" data-testid={`vtab-${t}`}>{t}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {info.map(([k, val]) => (
              <div key={k} className="mv-card p-4"><div className="mv-label">{k}</div><div className="text-sm font-medium mt-1 break-words">{val || "—"}</div></div>
            ))}
          </div>
          <div className="mv-card p-5 mt-3">
            <div className="flex items-center justify-between mb-2"><span className="mv-label">Battery</span><span className="font-display text-xl font-bold">{v.battery_percent}%</span></div>
            <BatteryBar percent={v.battery_percent} />
            <div className="mt-2 text-xs text-mv-muted">Health: <StatusChip status={v.battery_health} className="ml-1" /></div>
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

        <TabsContent value="service" className="mt-4">
          <ServiceTimeline services={v.services} requests={v.service_requests} />
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <DocsList docs={v.documents} />
        </TabsContent>

        <TabsContent value="incidents" className="mt-4">
          {(v.incidents || []).length === 0 ? <div className="mv-card p-10 text-center text-mv-muted text-sm">No incidents recorded ✓</div> : (
            <div className="space-y-2">{v.incidents.map((i) => (
              <div key={i.id} className="mv-card p-4 flex items-center justify-between"><div><div className="font-medium">{i.code} · {i.incident_type}</div><div className="text-xs text-mv-dim">{fmtDate(i.created_at)} · {i.location}</div></div><StatusChip status={i.status} /></div>
            ))}</div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <AssignmentHistory assignments={v.assignments} />
        </TabsContent>
      </Tabs>

      <HandoverDialog kind={dialog === "return" ? "return" : "handover"} open={dialog === "handover" || dialog === "return"} setOpen={() => setDialog(null)} vehicle={v} onDone={() => { setDialog(null); load(); }} />
      <TransferDialog open={dialog === "transfer"} setOpen={() => setDialog(null)} vehicle={v} onDone={() => { setDialog(null); load(); }} />
    </div>
  );
}

function StatusSelect({ v, onDone }) {
  const change = async (status) => {
    try { await api.put(`/vehicles/${v.id}`, { status }); toast.success(`Status → ${status}`); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Select value={v.status} onValueChange={change}>
      <SelectTrigger className="w-32 h-9 bg-mv-surface border-mv-border" data-testid="veh-status-select"><SelectValue /></SelectTrigger>
      <SelectContent className="bg-mv-surface border-mv-border text-mv-text">
        {["available", "rented", "idle", "service", "accident", "inactive"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function ServiceTimeline({ services, requests }) {
  const total = (services || []).reduce((s, x) => s + Number(x.cost || 0), 0);
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="mv-card p-4"><div className="mv-label">Service Count</div><div className="font-display text-2xl font-bold">{(services || []).length}</div></div>
        <div className="mv-card p-4"><div className="mv-label">Total Cost</div><div className="font-display text-2xl font-bold">{inr(total)}</div></div>
        <div className="mv-card p-4"><div className="mv-label">Open Requests</div><div className="font-display text-2xl font-bold">{(requests || []).filter((r) => r.status !== "closed").length}</div></div>
        <div className="mv-card p-4"><div className="mv-label">Last Service</div><div className="text-sm font-medium mt-1">{services?.[0] ? fmtDate(services[0].start_date) : "—"}</div></div>
      </div>
      {(services || []).length === 0 ? <div className="mv-card p-10 text-center text-mv-muted text-sm">No service history yet ✓</div> : (
        <div className="relative pl-6 space-y-4">
          <div className="absolute left-[9px] top-1 bottom-1 w-px bg-mv-border" />
          {services.map((s) => (
            <div key={s.id} className="relative flex gap-3">
              <div className="absolute -left-6 w-4 h-4 rounded-full bg-mv-surface border-2 border-amber-500" />
              <div className="mv-card p-4 flex-1 flex items-center justify-between">
                <div><div className="font-medium flex items-center gap-2"><Wrench className="w-4 h-4 text-amber-400" /> {s.issue}</div><div className="text-xs text-mv-dim mt-0.5">{fmtDate(s.start_date)} · {s.service_centre}</div></div>
                <div className="font-display font-bold">{inr(s.cost)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocsList({ docs }) {
  if (!docs || docs.length === 0) return <div className="mv-card p-10 text-center text-mv-muted text-sm">No documents uploaded.</div>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {docs.map((d) => (
        <div key={d.id} className="mv-card p-4 flex items-center justify-between">
          <div><div className="font-medium flex items-center gap-2"><FileText className="w-4 h-4 text-mv-dim" /> {d.doc_type}</div><div className="text-xs text-mv-dim mt-1">Expires {fmtDate(d.expiry_date)}</div></div>
          <StatusChip status={d.doc_status || "valid"} />
        </div>
      ))}
    </div>
  );
}

function AssignmentHistory({ assignments }) {
  if (!assignments || assignments.length === 0) return <div className="mv-card p-10 text-center text-mv-muted text-sm">No assignment history.</div>;
  return (
    <div className="mv-card divide-y divide-mv-border">
      {assignments.map((a) => (
        <div key={a.id} className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3"><History className="w-4 h-4 text-mv-dim" /><div><div className="font-medium">{a.driver_name}</div><div className="text-xs text-mv-dim">{fmtDate(a.start, true)} → {a.end ? fmtDate(a.end, true) : "Present"}</div></div></div>
          {!a.end && <StatusChip status="active" label="Current" />}
        </div>
      ))}
    </div>
  );
}

function HandoverDialog({ kind, open, setOpen, vehicle, onDone }) {
  const [form, setForm] = useState({ odometer: vehicle.odometer, battery_percent: vehicle.battery_percent, condition: "Good", charger: true, stepney: true, jack: true, tool_kit: true, notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k, val) => setForm((f) => ({ ...f, [k]: val }));
  const save = async () => {
    setSaving(true);
    const body = { ...form, vehicle_id: vehicle.id, vehicle_number: vehicle.vehicle_number, driver_id: vehicle.current_driver_id, driver_name: vehicle.current_driver_name, city: vehicle.city, rental_id: vehicle.current_rental_id };
    try { await api.post(kind === "return" ? "/returns" : "/handovers", body); toast.success(kind === "return" ? "Vehicle return recorded ✓" : "Vehicle handover recorded ✓"); onDone(); }
    catch { toast.error("Failed"); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-lg">
        <DialogHeader><DialogTitle className="font-display capitalize">Vehicle {kind}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-2">
          <Field label="Odometer (km)"><TextInput type="number" value={form.odometer} onChange={(e) => set("odometer", e.target.value)} /></Field>
          <Field label="Battery %"><TextInput type="number" value={form.battery_percent} onChange={(e) => set("battery_percent", e.target.value)} /></Field>
          <Field label="Condition">
            <Select value={form.condition} onValueChange={(v) => set("condition", v)}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["Excellent", "Good", "Fair", "Damaged"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {ACCESSORY_KEYS.map((a) => (
            <button key={a} onClick={() => set(a, !form[a])} className={`h-8 px-3 rounded-full text-xs capitalize transition-colors ${form[a] ? "bg-green-500/15 text-green-400" : "border border-mv-border text-mv-dim"}`}>
              {a.replace("_", " ")} {form[a] ? "✓" : "✗"}
            </button>
          ))}
        </div>
        <Field label="Notes / Existing damage"><TextArea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} disabled={saving} data-testid="save-handover-btn">Record {kind}</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ open, setOpen, vehicle, onDone }) {
  const [toCity, setToCity] = useState(CITIES.find((c) => c !== vehicle.city));
  const [reason, setReason] = useState("");
  const save = async () => {
    try { await api.post(`/vehicles/${vehicle.id}/transfer`, { to_city: toCity, reason }); toast.success("Vehicle transferred ✓"); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Transfer Vehicle</DialogTitle></DialogHeader>
        <div className="text-sm text-mv-muted">From <span className="text-mv-text font-medium">{vehicle.city}</span></div>
        <Field label="To City">
          <Select value={toCity} onValueChange={setToCity}>
            <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Reason"><TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Demand balancing" /></Field>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-transfer-btn">Transfer</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}
