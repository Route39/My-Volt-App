import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, User, Phone, MapPin, Car, KeyRound, History, FileText, AlertTriangle, ArrowRightLeft, Edit, Trash2, Search, Ban, Clock, ShieldCheck, CalendarDays, Check } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { StatusChip, Skeleton, KycStatusChip } from "../components/common/Primitives";
import { Field, PrimaryBtn, GhostBtn, TextInput } from "../components/common/Page";
import { fmtDate } from "../lib/format";
import imgUrl from "../lib/imgUrl";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Calendar } from "../components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ReferralList } from "./Referrals";

export default function DriverProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [assign, setAssign] = useState(false);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [blockType, setBlockType] = useState(null);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const load = useCallback(async () => { const { data } = await api.get(`/drivers/${id}`); setD(data); }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!d) return <div className="space-y-4"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  const canEdit = ["admin", "city_manager"].includes(user?.role);
  const current = d.assignments?.find((a) => !a.end);
  const activeRental = d.rentals?.find((r) => r.status === "active");

  return (
    <div>
      <button onClick={() => nav(-1)} className="flex items-center gap-1.5 text-sm text-mv-muted hover:text-mv-text mb-4"><ArrowLeft className="w-4 h-4" /> Back</button>

      <div className="mv-card p-6 flex flex-col sm:flex-row sm:items-center gap-4 mv-rise">
        <Avatar className="w-20 h-20"><AvatarImage src={d.avatar} /><AvatarFallback className="bg-mv-elevated text-xl">{d.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}</AvatarFallback></Avatar>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap"><h1 className="font-display text-2xl font-bold">{d.name}</h1>{d.driver_code && <span className="px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold bg-blue-50 text-mv-primary border border-blue-100">{d.driver_code}</span>}<StatusChip status={d.status} />{d.admin_block && <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">{d.admin_block === "permanent" ? "Permanently Blocked" : "Temporarily Blocked"}</span>}{d.rental_status === "active" && <StatusChip status="active" label="Rental Active" />}</div>
          <div className="flex items-center gap-5 mt-2 text-sm text-mv-muted flex-wrap">
            <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" /> {d.phone}</span>
            <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {d.city}</span>
            <span className="flex items-center gap-1.5"><Car className="w-4 h-4" /> {d.current_vehicle_number || "No vehicle"}</span>
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <GhostBtn onClick={() => setAssign(true)} data-testid="assign-vehicle-btn"><ArrowRightLeft className="w-4 h-4" /> Change Vehicle</GhostBtn>
            <GhostBtn onClick={() => setEdit(true)}><Edit className="w-4 h-4" /> Edit</GhostBtn>
            {d.deposit_status !== "paid" && (
              <GhostBtn onClick={async () => {
                if(window.confirm("Mark deposit as paid manually via QR?")) {
                  try {
                    await api.post(`/admin/drivers/${d.id}/deposit-paid`);
                    toast.success("Deposit marked as paid");
                    load();
                  } catch (e) {
                    toast.error(e.response?.data?.detail || "Failed to mark deposit as paid");
                  }
                }
              }} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50">
                <Check className="w-4 h-4" /> Mark Deposit Paid (QR)
              </GhostBtn>
            )}
            {d.admin_block ? (
              <GhostBtn onClick={() => setBlockType("unblock")} className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"><ShieldCheck className="w-4 h-4" /> Unblock</GhostBtn>
            ) : (
              <>
                <GhostBtn onClick={() => setLeaveOpen(true)} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"><CalendarDays className="w-4 h-4" /> Paid Leave</GhostBtn>
                <GhostBtn onClick={() => setBlockType("temporary")} className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"><Clock className="w-4 h-4" /> Temporary Block</GhostBtn>
                <GhostBtn onClick={() => setBlockType("permanent")} className="text-red-500 hover:text-red-600 hover:bg-red-50"><Ban className="w-4 h-4" /> Permanent Block</GhostBtn>
              </>
            )}
            {/* <GhostBtn onClick={() => setDel(true)} data-testid="delete-driver-btn" className="text-red-500 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /> Delete</GhostBtn> */}
          </div>
        )}
      </div>

      <Tabs defaultValue="personal" className="mt-6">
        <TabsList className="bg-mv-surface border border-mv-border flex-wrap h-auto">
          {["personal", "kyc", "documents", "vehicle", "rental", "history", "incidents", "referral"].map((t) => <TabsTrigger key={t} value={t} className="data-[state=active]:bg-mv-elevated capitalize">{t}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="personal" className="mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[["Driver ID", d.driver_code], ["Name", d.name], ["Phone", d.phone], ["Address", d.address], ["Emergency Contact", d.emergency_contact], ["Licence No.", d.license_number], ["City", d.city]].map(([k, v]) => (
              <div key={k} className="mv-card p-4"><div className="mv-label">{k}</div><div className="text-sm font-medium mt-1">{v || "—"}</div></div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="kyc" className="mt-4">
          <div className="mv-card p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">KYC Status</h3>
                <p className="text-sm text-slate-500">Current verification state of the driver's documents.</p>
              </div>
              <KycStatusChip status={d.kyc_status || "pending"} />
            </div>
            {d.kyc_status === "pending" || d.kyc_status === "submitted" ? (
              <div className="flex gap-3">
                <button onClick={async () => { await api.post(`/admin/kyc/${d.id}/approve`); toast.success("KYC Approved"); load(); }} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold transition-colors">Approve KYC</button>
                <button onClick={async () => { await api.post(`/admin/kyc/${d.id}/reject`); toast.success("KYC Rejected"); load(); }} className="px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-xl text-sm font-bold transition-colors">Reject KYC</button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <KycDocCard title="Driving License (Front)" url={d.kyc_documents?.dl_front} />
            <KycDocCard title="Driving License (Back)" url={d.kyc_documents?.dl_back} />
            <KycDocCard title="Aadhaar Card" url={d.kyc_documents?.aadhaar} />
            <KycDocCard title="PAN Card" url={d.kyc_documents?.pan} />
            <KycDocCard title="Driver Photo" url={d.kyc_documents?.driver_photo} />
            <KycDocCard title="Driver + Vehicle" url={d.kyc_documents?.vehicle_photo} />
            <KycDocCard title="Rental Agreement" url={d.kyc_documents?.agreement} />
          </div>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          {(d.documents || []).length === 0 ? <div className="mv-card p-10 text-center text-mv-muted text-sm">No documents.</div> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{d.documents.map((doc) => (
              <div key={doc.id} className="mv-card p-4 flex items-center justify-between"><div><div className="font-medium flex items-center gap-2"><FileText className="w-4 h-4 text-mv-dim" /> {doc.doc_type}</div><div className="text-xs text-mv-dim mt-1">Expires {fmtDate(doc.expiry_date)}</div></div><StatusChip status={doc.doc_status || "valid"} /></div>
            ))}</div>
          )}
        </TabsContent>

        <TabsContent value="vehicle" className="mt-4">
          {current ? (
            <button onClick={() => nav(`/fleet/${current.vehicle_id}`)} className="mv-card mv-card-hover p-5 w-full text-left">
              <div className="font-semibold flex items-center gap-2"><Car className="w-5 h-5 text-mv-primary" /> {current.vehicle_number}</div>
              <div className="text-sm text-mv-dim mt-1">Assigned {fmtDate(current.start, true)} · {current.city}</div>
            </button>
          ) : <div className="mv-card p-10 text-center text-mv-muted text-sm">No vehicle currently assigned.</div>}
        </TabsContent>

        <TabsContent value="rental" className="mt-4">
          {activeRental ? (
            <button onClick={() => nav(`/rentals/${activeRental.id}`)} className="mv-card mv-card-hover p-5 w-full text-left">
              <div className="flex items-center justify-between"><span className="font-semibold flex items-center gap-2"><KeyRound className="w-5 h-5 text-mv-primary" /> {activeRental.rental_code}</span><StatusChip status="active" /></div>
              <div className="text-sm text-mv-dim mt-2">{activeRental.plan_name} · {fmtDate(activeRental.start)} → {fmtDate(activeRental.end)}</div>
            </button>
          ) : <div className="mv-card p-10 text-center text-mv-muted text-sm">No active rental.</div>}
          {(d.rentals || []).length > 0 && <div className="mt-4"><div className="mv-label mb-2">Rental History</div><div className="mv-card divide-y divide-mv-border">{d.rentals.map((r) => (
            <button key={r.id} onClick={() => nav(`/rentals/${r.id}`)} className="w-full p-4 flex items-center justify-between hover:bg-mv-elevated transition-colors text-left"><div><div className="font-medium">{r.rental_code}</div><div className="text-xs text-mv-dim">{fmtDate(r.start)} → {fmtDate(r.end)}</div></div><StatusChip status={r.status} /></button>
          ))}</div></div>}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {(d.assignments || []).length === 0 ? <div className="mv-card p-10 text-center text-mv-muted text-sm">No assignment history.</div> : (
            <div className="mv-card divide-y divide-mv-border">{d.assignments.map((a) => (
              <div key={a.id} className="p-4 flex items-center justify-between"><div className="flex items-center gap-3"><History className="w-4 h-4 text-mv-dim" /><div><div className="font-medium">{a.vehicle_number}</div><div className="text-xs text-mv-dim">{fmtDate(a.start, true)} → {a.end ? fmtDate(a.end, true) : "Present"}</div></div></div>{!a.end && <StatusChip status="active" label="Current" />}</div>
            ))}</div>
          )}
        </TabsContent>

        <TabsContent value="incidents" className="mt-4">
          {(d.incidents || []).length === 0 ? <div className="mv-card p-10 text-center text-mv-muted text-sm">No incidents ✓</div> : (
            <div className="space-y-2">{d.incidents.map((i) => (<div key={i.id} className="mv-card p-4 flex items-center justify-between"><div><div className="font-medium">{i.code} · {i.incident_type}</div><div className="text-xs text-mv-dim">{fmtDate(i.created_at)}</div></div><StatusChip status={i.status} /></div>))}</div>
          )}
        </TabsContent>
        <TabsContent value="referral" className="mt-4">
          <ReferralList referrerId={d.id} referrerName={d.name} referrerCode={d.driver_code} showReferrer={false} />
        </TabsContent>
      </Tabs>

      <AssignVehicleDialog open={assign} setOpen={setAssign} driver={d} onDone={() => { setAssign(false); load(); }} />
      <EditDriverDialog open={edit} setOpen={setEdit} driver={d} onDone={() => { setEdit(false); load(); }} />
      <BlockDriverDialog type={blockType} setType={setBlockType} driver={d} onDone={() => { setBlockType(null); load(); }} />
      <PaidLeaveDialog open={leaveOpen} setOpen={setLeaveOpen} driver={d} onDone={() => { setLeaveOpen(false); load(); }} />
      <DeleteDriverDialog open={del} setOpen={setDel} driver={d} onDone={() => { setDel(false); nav("/drivers"); }} />
    </div>
  );
}

function AssignVehicleDialog({ open, setOpen, driver, onDone }) {
  const [vehicles, setVehicles] = useState([]);
  const [vid, setVid] = useState("");
  useEffect(() => { if (open) api.get("/vehicles", { params: { status: "available", page_size: 100 } }).then((r) => setVehicles(r.data.items)); }, [open]);
  const save = async () => {
    if (!vid) { toast.error("Select a vehicle"); return; }
    try { await api.post(`/drivers/${driver.id}/assign-vehicle`, { vehicle_id: vid }); toast.success("Driver assigned ✓"); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Assign Vehicle</DialogTitle></DialogHeader>
        <Field label="Available Vehicle">
          <Select value={vid} onValueChange={setVid}>
            <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border" data-testid="assign-vehicle-select"><SelectValue placeholder="Select vehicle" /></SelectTrigger>
            <SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-64">{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.vehicle_number} · {v.city}{v.registration_number ? ` · ${v.registration_number}` : ''}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-assign-btn">Assign</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

import { CITIES } from "../context/AppContext";

function EditDriverDialog({ open, setOpen, driver, onDone }) {
  const [form, setForm] = useState({ name: "", phone: "", city: "", address: "", emergency_contact: "", license_number: "", status: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && driver) setForm({ name: driver.name, phone: driver.phone, city: driver.city, address: driver.address || "", emergency_contact: driver.emergency_contact || "", license_number: driver.license_number || "", status: driver.status });
  }, [open, driver]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name || !form.phone) { toast.error("Name & phone required"); return; }
    setSaving(true);
    try { await api.put(`/drivers/${driver.id}`, form); toast.success("Driver updated ✓"); onDone(); } catch (e) { toast.error(e.response?.data?.detail || "Failed to update"); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Edit Driver</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-2">
          <Field label="Name"><TextInput value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Phone"><TextInput value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 9…" /></Field>
          <Field label="City">
            <Select value={form.city} onValueChange={(v) => set("city", v)}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text"><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Licence No."><TextInput value={form.license_number} onChange={(e) => set("license_number", e.target.value)} /></Field>
          <Field label="Emergency Contact"><TextInput value={form.emergency_contact} onChange={(e) => set("emergency_contact", e.target.value)} /></Field>
          <div className="col-span-2"><Field label="Address"><TextInput value={form.address} onChange={(e) => set("address", e.target.value)} /></Field></div>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} disabled={saving}>Save Changes</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDriverDialog({ open, setOpen, driver, onDone }) {
  const [deleting, setDeleting] = useState(false);
  const [unpaidError, setUnpaidError] = useState(null);

  const doDelete = async (force = false) => {
    setDeleting(true);
    setUnpaidError(null);
    try {
      await api.delete(`/drivers/${driver.id}?force=${force}`);
      toast.success("Driver deleted successfully");
      onDone();
    } catch (e) {
      const status = e.response?.status;
      const detail = e.response?.data?.detail || "Failed to delete";
      if (status === 409) {
        // Unpaid balance warning — show force delete option
        setUnpaidError(detail);
      } else {
        toast.error(detail);
        setOpen(false);
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleClose = () => { setUnpaidError(null); setOpen(false); };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-red-500">
            <AlertTriangle className="w-5 h-5" /> Delete Driver
          </DialogTitle>
        </DialogHeader>

        {!unpaidError ? (
          <>
            <p className="text-sm text-mv-muted">
              Are you sure you want to permanently delete driver <strong>{driver?.name}</strong>? 
              All their rentals, payments and records will be deleted. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <GhostBtn onClick={handleClose}>Cancel</GhostBtn>
              <PrimaryBtn onClick={() => doDelete(false)} disabled={deleting} className="bg-red-500 hover:bg-red-600 text-white">
                {deleting ? "Deleting..." : "Delete"}
              </PrimaryBtn>
            </div>
          </>
        ) : (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> Unpaid Balance Found
              </p>
              <p className="text-sm text-amber-700 mt-1">{unpaidError}</p>
            </div>
            <p className="text-sm text-mv-muted mt-1">
              You can still force delete this driver. All their data including unpaid dues will be permanently removed.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <GhostBtn onClick={handleClose}>Cancel</GhostBtn>
              <PrimaryBtn onClick={() => doDelete(true)} disabled={deleting} className="bg-red-500 hover:bg-red-600 text-white">
                {deleting ? "Deleting..." : "Force Delete Anyway"}
              </PrimaryBtn>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}


function KycDocCard({ title, url }) {
  if (!url) return <div className="aspect-video bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 text-sm">Not Provided</div>;
  const fullUrl = imgUrl(url);
  return (
    <div className="space-y-2">
      <h4 className="font-semibold text-slate-700 text-sm">{title}</h4>
      <div className="aspect-video bg-black rounded-2xl overflow-hidden shadow-sm relative group cursor-pointer" onClick={() => window.open(fullUrl, '_blank')}>
        <img src={fullUrl} alt={title} className="w-full h-full object-contain" />
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Search className="w-8 h-8 text-white" />
        </div>
      </div>
    </div>
  );
}
function PaidLeaveDialog({ open, setOpen, driver, onDone }) {
  const [info, setInfo] = useState(null);
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const toKey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const toDate = (s) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };

  useEffect(() => {
    if (!open || !driver?.id) return;
    setInfo(null);
    api.get(`/drivers/${driver.id}/paid-leave`)
      .then(({ data }) => { setInfo(data); setSel(data.dates.filter((x) => x >= data.today).map(toDate)); })
      .catch((e) => { toast.error(e.response?.data?.detail || "Failed to load paid leave"); setOpen(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, driver?.id]);

  const todayStr = info?.today;
  const pastUsed = info ? info.dates.filter((x) => x < todayStr) : [];
  const maxPick = info ? Math.max(0, info.max_days - pastUsed.length) : 0;
  const savedToday = info ? info.dates.includes(todayStr) : false;

  // Only today / future days of the current month; today only if its rent is not paid yet.
  const isDisabled = (day) => {
    if (!info || maxPick === 0) return true;
    const k = toKey(day);
    if (k < todayStr || k.slice(0, 7) !== todayStr.slice(0, 7)) return true;
    if (k === todayStr && info.today_rent_paid && !savedToday) return true;
    return false;
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/drivers/${driver.id}/paid-leave`, { dates: sel.map(toKey).sort() });
      toast.success(sel.length ? "Paid leave saved" : "Paid leave cleared");
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save paid leave");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Paid Leave (Rent-free days)</DialogTitle></DialogHeader>
        {!info ? (
          <p className="text-sm text-mv-muted">Loading...</p>
        ) : (
          <>
            <p className="text-sm text-mv-muted">
              Select up to {maxPick} day{maxPick === 1 ? "" : "s"} from today to the end of this month. No daily rent will be asked from {driver?.name} on these days.
              {info.today_rent_paid ? " Today's rent is already paid, so today cannot be selected." : ""}
            </p>
            <div className="flex justify-center">
              <Calendar
                mode="multiple"
                selected={sel}
                onSelect={(v) => setSel(v || [])}
                max={maxPick || undefined}
                disabled={isDisabled}
                defaultMonth={toDate(todayStr)}
                fromMonth={toDate(todayStr)}
                toMonth={toDate(todayStr)}
                showOutsideDays={false}
                modifiers={{ used: pastUsed.map(toDate) }}
                modifiersClassNames={{ used: "bg-emerald-100 text-emerald-700 rounded-md" }}
              />
            </div>
            {pastUsed.length > 0 && <p className="text-xs text-mv-muted">Already used this month: {pastUsed.join(", ")}</p>}
            <div className="flex justify-end gap-2 mt-2">
              <GhostBtn onClick={() => setOpen(false)}>Cancel</GhostBtn>
              <PrimaryBtn onClick={save} disabled={busy}>{busy ? "Please wait..." : "Save Paid Leave"}</PrimaryBtn>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BlockDriverDialog({ type, setType, driver, onDone }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => { setReason(""); }, [type]);
  const cfg = {
    temporary: { title: "Temporary Block", msg: `${driver?.name} will be temporarily blocked and cannot use the driver app until you unblock.`, btn: "Temporarily Block", cls: "bg-amber-500 hover:bg-amber-600 text-white" },
    permanent: { title: "Permanent Block", msg: `${driver?.name} will be permanently blocked from the driver app.`, btn: "Permanently Block", cls: "bg-red-500 hover:bg-red-600 text-white" },
    unblock: { title: "Unblock Driver", msg: `${driver?.name} will be able to use the driver app again.`, btn: "Unblock", cls: "bg-emerald-500 hover:bg-emerald-600 text-white" },
  }[type];

  const go = async () => {
    setBusy(true);
    try {
      if (type === "unblock") await api.post(`/drivers/${driver.id}/admin-unblock`);
      else {
        if (!reason.trim()) { toast.error("Please enter a reason"); setBusy(false); return; }
        await api.post(`/drivers/${driver.id}/admin-block`, { type, reason: reason.trim() });
      }
      toast.success(type === "unblock" ? "Driver unblocked" : "Driver blocked");
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!type} onOpenChange={(o) => !o && setType(null)}>
      <DialogContent className="max-w-md">
        {cfg && (
          <>
            <DialogHeader><DialogTitle>{cfg.title}</DialogTitle></DialogHeader>
            <p className="text-sm text-mv-muted">{cfg.msg}</p>
            {type !== "unblock" && (
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
                placeholder="Reason for blocking (shown to driver)"
                className="w-full mt-3 p-3 rounded-xl border border-mv-border bg-mv-surface2 text-sm outline-none focus:ring-2 focus:ring-mv-primary/30" />
            )}
            <div className="flex justify-end gap-2 mt-4">
              <GhostBtn onClick={() => setType(null)}>Cancel</GhostBtn>
              <PrimaryBtn onClick={go} disabled={busy} className={cfg.cls}>{busy ? "Please wait..." : cfg.btn}</PrimaryBtn>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}