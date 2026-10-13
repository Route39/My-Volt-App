import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Plus, Wrench, Car, User, Clock, GripVertical, Edit, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useApp, CITIES } from "../context/AppContext";
import { useAuth } from "../context/AuthContext";
import { StatusChip, Skeleton } from "../components/common/Primitives";
import { PageHeader, PrimaryBtn, GhostBtn, Field, TextInput, TextArea } from "../components/common/Page";
import { timeAgo, inr } from "../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { DriverCode } from "../lib/driverCodes";

const STAGES = [
  ["new", "New"], ["assigned", "Assigned"], ["inspection", "Inspection"],
  ["repair", "Repair"], ["ready", "Ready"], ["closed", "Closed"],
];
const PRIO_DOT = { critical: "bg-red-500", high: "bg-amber-500", medium: "bg-blue-500", low: "bg-zinc-500" };

export default function ServiceRequests() {
  const { city: gCity, lockedCity, cities } = useApp();
  const [city, setCity] = useState(lockedCity || gCity);
  useEffect(() => { setCity(gCity); }, [gCity]);
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
        {canEdit && <PrimaryBtn onClick={() => setShowNew(true)} data-testid="create-sr-btn"><Plus className="w-4 h-4" /> New Job Card</PrimaryBtn>}
      </PageHeader>

      <div className="mb-4">
        <Select value={city} onValueChange={setCity}>
          <SelectTrigger className="w-40 h-10 bg-mv-surface border-mv-border" data-testid="sr-city-filter"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-mv-surface border-mv-border text-mv-text">
            {!lockedCity && <SelectItem value="all">All Cities</SelectItem>}
            {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

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
                        <div className="flex items-center gap-1"><Car className="w-3 h-3" /> {s.registration_number || s.vehicle_number}</div>
                        <div className="flex items-center gap-1"><User className="w-3 h-3" /> {s.driver_name || "—"} <DriverCode id={s.driver_id} /> · {s.city}</div>
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

const ISSUE_TYPES = ["Breakdown", "Battery", "Tyre", "Brake", "Electrical", "Charger", "Accident", "General", "Other"];

const SHEET_FIELDS = [
  ["vehicle_id", "Vehicle", ""],
  ["priority", "Priority", ""],
  ["issue", "Issue", "Describe the issue"],
  ["approved_manager", "Approved Manager", "Manager name"],
  ["estimated_cost", "Estimated Total Cost ₹", "0"],
  ["vehicle_model", "Vehicle Model", "e.g. Nexon EV 2024"],
  ["odometer", "Odometer (km)", "km"],
  ["vin_number", "VIN", "17-character VIN"],
];

function NewSRDialog({ open, setOpen, onDone }) {
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState({ vehicle_id: "", issue_type: "Breakdown", priority: "high", source: "Operations", description: "", issues: [{ issue_type: "", text: "" }], approved_manager: "", estimated_cost: "", vehicle_model: "", odometer: "", vin_number: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => { if (open) api.get("/vehicles", { params: { page_size: 200 } }).then((r) => setVehicles(r.data.items)); }, [open]);
  const [active, setActive] = useState("vehicle_id");
  const [justAdded, setJustAdded] = useState(-1);
  const rows = SHEET_FIELDS.flatMap(([k, label, ph]) => k === "issue" ? form.issues.map((_, n) => [`iss-${n}`, `Issue ${n + 1}`, ph]) : [[k, label, ph]]);
  const anyCost = form.issues.some((i) => i.cost !== "" && i.cost != null);
  const totalCost = anyCost
    ? form.issues.reduce((s, i) => s + (Number(i.cost) || 0), 0)
    : (form.estimated_cost === "" || form.estimated_cost == null ? null : Number(form.estimated_cost));
  const activeIdx = Math.max(0, rows.findIndex(([k]) => k === (active.startsWith("cst-") ? `iss-${active.slice(4)}` : active)));
  const activeVal = active === "vehicle_id"
    ? (vehicles.find((x) => x.id === form.vehicle_id)?.registration_number || "")
    : (active.startsWith("iss-") || active.startsWith("cst-")) ? (form.issues[Number(active.slice(4))]?.[active.startsWith("cst-") ? "cost" : "text"] ?? "") : String(active === "estimated_cost" ? (totalCost ?? 0) : (form[active] ?? ""));
  const lastFilled = !!(form.issues[form.issues.length - 1].issue_type && form.issues[form.issues.length - 1].text.trim());
  const setIssue = (n, v) => setForm((f) => ({ ...f, issues: f.issues.map((x, i) => (i === n ? { ...x, text: v } : x)) }));
  const setIssueType = (n, v) => setForm((f) => ({ ...f, issues: f.issues.map((x, i) => (i === n ? { ...x, issue_type: v } : x)) }));
  const setIssueCost = (n, v) => setForm((f) => ({ ...f, issues: f.issues.map((x, i) => (i === n ? { ...x, cost: v } : x)) }));
  const addIssue = () => { if (!lastFilled) return; setJustAdded(form.issues.length); setForm((f) => ({ ...f, issues: [...f.issues, { issue_type: "", text: "" }] })); };
  const removeIssue = (n) => { if (form.issues.length <= 1) return; setJustAdded(-1); setActive(`iss-${Math.max(0, n - 1)}`); setForm((f) => ({ ...f, issues: f.issues.filter((_, i) => i !== n) })); };
  const selectCls = "h-10 w-full rounded-none border-0 bg-transparent px-3 shadow-none focus:ring-0 focus:ring-offset-0";
  const inputCls = "w-full h-10 bg-transparent px-3 text-sm text-mv-text placeholder:text-mv-dim outline-none";
  const renderCell = (key, placeholder) => {
    if (key === "vehicle_id") return (
      <Select value={form.vehicle_id} onValueChange={(v) => set("vehicle_id", v)}>
        <SelectTrigger className={selectCls} data-testid="sr-vehicle-select"><SelectValue placeholder="Select vehicle" /></SelectTrigger>
        <SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-64">{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.registration_number || v.vehicle_number} · {v.city}</SelectItem>)}</SelectContent>
      </Select>
    );
    if (key === "issue_type") return (
      <Select value={form.issue_type} onValueChange={(v) => set("issue_type", v)}>
        <SelectTrigger className={selectCls}><SelectValue /></SelectTrigger>
        <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["Breakdown", "Battery", "Tyre", "Brake", "Electrical", "Charger", "Accident", "General", "Other"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
      </Select>
    );
    if (key === "priority") return (
      <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
        <SelectTrigger className={`${selectCls} capitalize`}><SelectValue /></SelectTrigger>
        <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["critical", "high", "medium", "low"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
      </Select>
    );
    if (key.startsWith("iss-")) { const n = Number(key.slice(4)); return <textarea rows={2} autoFocus={justAdded === n} value={form.issues[n].text} onChange={(e) => setIssue(n, e.target.value)} placeholder={placeholder} className="w-full min-h-[112px] bg-transparent px-3 py-2 text-sm text-mv-text placeholder:text-mv-dim outline-none resize-none" />; }
    if (key === "estimated_cost") return <input readOnly tabIndex={-1} value={totalCost ?? 0} title="Calculated from the issue costs" className={`${inputCls} cursor-not-allowed bg-mv-surface2/60 font-semibold`} />;
    if (key === "odometer") return <input inputMode="numeric" value={form.odometer} onChange={(e) => set("odometer", e.target.value.replace(/\D/g, ""))} placeholder={placeholder} className={inputCls} />;
    if (key === "vin_number") return <input value={form.vin_number} maxLength={17} onChange={(e) => set("vin_number", e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())} placeholder={placeholder} className={inputCls} />;
    return <input value={form[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} className={inputCls} />;
  };
  const save = async () => {
    const v = vehicles.find((x) => x.id === form.vehicle_id);
    if (!v) { toast.error("Select a vehicle"); return; }
    const issues = form.issues.map((i) => ({ issue_type: i.issue_type, text: i.text.trim(), cost: i.cost === "" || i.cost == null ? null : Number(i.cost) })).filter((i) => i.issue_type || i.text || i.cost != null);
    const bad = issues.findIndex((i) => !i.issue_type);
    if (bad !== -1) { toast.error(`Select the issue type for row ${bad + 1}`); return; }
    try { await api.post("/service-requests", { ...form, issues, issue_type: issues[0]?.issue_type || "General", issue: issues[0]?.text || "", estimated_cost: totalCost, odometer: form.odometer === "" ? null : Number(form.odometer), vehicle_number: v.vehicle_number, registration_number: v.registration_number, city: v.city, driver_id: v.current_driver_id, driver_name: v.current_driver_name }); toast.success("Service request created ✓"); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-4xl">
        <DialogHeader><DialogTitle className="font-display">New Job Card</DialogTitle></DialogHeader>
        <div className="flex items-center h-9 min-w-0 border border-mv-border bg-mv-surface2 text-sm" data-testid="sr-formula-bar">
          <div className="w-16 text-center border-r border-mv-border text-mv-muted">{active.startsWith("cst-") ? "C" : "B"}{activeIdx + 2}</div>
          <div className="w-9 text-center italic text-mv-dim">fx</div>
          <div className="px-2 truncate capitalize">{activeVal}</div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full border-collapse table-fixed text-sm">
            <colgroup><col className="w-11" /><col className="w-52" /><col /></colgroup>
            <tbody>
              <tr className="h-7 text-center text-[11px] text-mv-dim bg-mv-surface2">
                <td className="border border-mv-border" /><td className="border border-mv-border">A</td><td className="border border-mv-border">B</td>
              </tr>
              <tr className="h-9">
                <td className="text-center text-[11px] text-mv-dim bg-mv-surface2 border border-mv-border">1</td>
                <td className="px-3 font-semibold bg-mv-surface2 border border-mv-border">Field</td>
                <td className="px-3 font-semibold bg-mv-surface2 border border-mv-border">Value</td>
              </tr>
              {rows.map(([key, label, placeholder], i) => (
                <tr key={key}>
                  <td className="text-center text-[11px] text-mv-dim bg-mv-surface2 border border-mv-border">{i + 2}</td>
                  <td className="px-3 text-[11px] font-semibold uppercase tracking-wide text-mv-muted bg-mv-surface2 border border-mv-border">
                    {key.startsWith("iss-") ? (
                      <div className="flex flex-col gap-1 py-2 h-[112px]">
                        <div className="flex items-center justify-between">
                          <span>Issue type</span>
                          {form.issues.length > 1 && (
                            <button type="button" onClick={() => removeIssue(Number(key.slice(4)))}
                              className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-red-500 hover:bg-red-500/10 hover:text-red-600">- Remove issue</button>
                          )}
                        </div>
                        <Select value={form.issues[Number(key.slice(4))].issue_type} onValueChange={(v) => setIssueType(Number(key.slice(4)), v)}>
                          <SelectTrigger className="h-8 w-full rounded-md border border-mv-border bg-mv-surface px-2 text-sm font-normal normal-case tracking-normal"><SelectValue placeholder="Select type" /></SelectTrigger>
                          <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{ISSUE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                        {key === `iss-${form.issues.length - 1}` && (
                          <button type="button" onClick={addIssue} disabled={!lastFilled} data-testid="add-issue-btn"
                            className="mt-auto self-end rounded-md px-2 py-1 text-[11px] font-semibold normal-case tracking-normal bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">+ Add issue</button>
                        )}
                      </div>
                    ) : label}
                  </td>
                  <td onFocus={() => setActive(key)} className={`p-0 border border-mv-border ${active === key && !key.startsWith("iss-") ? "ring-2 ring-inset ring-mv-primary" : ""}`}>
                    {key.startsWith("iss-") ? (
                      <div className="flex min-w-0">
                        <div className="flex-1 min-w-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-mv-primary">{renderCell(key, placeholder)}</div>
                        <div onFocus={(e) => { e.stopPropagation(); setActive(`cst-${key.slice(4)}`); }} className="w-40 shrink-0 border-l border-mv-border focus-within:ring-2 focus-within:ring-inset focus-within:ring-mv-primary">
                          <div className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-mv-muted">Est. cost ₹</div>
                          <input type="number" min="0" value={form.issues[Number(key.slice(4))].cost ?? ""} onChange={(e) => setIssueCost(Number(key.slice(4)), e.target.value)} placeholder="0" className="w-full h-10 bg-transparent px-3 text-sm text-mv-text placeholder:text-mv-dim outline-none" />
                        </div>
                      </div>
                    ) : renderCell(key, placeholder)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs font-semibold px-3 py-1.5 bg-mv-surface2 border border-mv-border border-b-2 border-b-green-500 text-mv-text">Job Card</span>
          <PrimaryBtn onClick={save} data-testid="save-sr-btn">Create Job Card</PrimaryBtn>
        </div>
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
        <div className="space-y-3 text-sm min-w-0">
          <div className="grid grid-cols-2 gap-3">
            {[["Vehicle", sr.registration_number || sr.vehicle_number], ["Driver", <>{sr.driver_name || "—"} <DriverCode id={sr.driver_id} /></>], ["Issue Type", sr.issue_type], ["City", sr.city], ["Source", sr.source], ["Status", sr.status]].map(([k, v]) => (
              <div key={k}><div className="mv-label">{k}</div><div className="font-medium capitalize">{v}</div></div>
            ))}
          </div>
          {sr.description && <div><div className="mv-label">Description</div><p className="text-mv-muted mt-1">{sr.description}</p></div>}
          {(sr.issues?.length ? sr.issues : sr.issue ? [{ issue_type: sr.issue_type, text: sr.issue }] : []).map((x, n) => {
            const it = typeof x === "string" ? { issue_type: n === 0 ? sr.issue_type : "", text: x } : x;
            return <div key={n}><div className="mv-label flex items-center justify-between gap-2"><span>{it.issue_type || `Issue ${n + 1}`}</span>{it.cost != null && it.cost !== "" && <span className="normal-case tracking-normal">{inr(it.cost)}</span>}</div><p className="text-mv-muted mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{it.text}</p></div>;
          })}
          {(sr.approved_manager || sr.estimated_cost != null) && (
            <div className="grid grid-cols-2 gap-3">
              <div><div className="mv-label">Approved Manager</div><div className="font-medium">{sr.approved_manager || "—"}</div></div>
              <div><div className="mv-label">Estimated Total Cost</div><div className="font-medium">{sr.estimated_cost != null ? inr(sr.estimated_cost) : "—"}</div></div>
            </div>
          )}
          {(sr.vehicle_model || sr.odometer != null || sr.vin_number) && (
            <div className="grid grid-cols-2 gap-3">
              <div><div className="mv-label">Vehicle Model</div><div className="font-medium">{sr.vehicle_model || "—"}</div></div>
              <div><div className="mv-label">Odometer</div><div className="font-medium">{sr.odometer != null ? `${sr.odometer} km` : "—"}</div></div>
              <div className="col-span-2"><div className="mv-label">VIN</div><div className="font-medium font-mono">{sr.vin_number || "—"}</div></div>
            </div>
          )}
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
  const [form, setForm] = useState({ priority: "", status: "", description: "", issues: [{ issue_type: "", text: "" }], approved_manager: "", estimated_cost: "", vehicle_model: "", odometer: "", vin_number: "" });
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState("priority");
  const [justAdded, setJustAdded] = useState(-1);

  useEffect(() => {
    if (open && sr) {
      setForm({
        priority: sr.priority || "", status: sr.status || "", description: sr.description || "",
        issues: sr.issues?.length
          ? sr.issues.map((x) => (typeof x === "string" ? { issue_type: sr.issue_type || "", text: x } : { issue_type: x.issue_type || "", text: x.text || "", cost: x.cost ?? "" }))
          : [{ issue_type: sr.issue_type || "", text: sr.issue || "" }],
        approved_manager: sr.approved_manager || "", estimated_cost: sr.estimated_cost ?? "",
        vehicle_model: sr.vehicle_model || "", odometer: sr.odometer ?? "", vin_number: sr.vin_number || "",
      });
      setActive("priority");
      setJustAdded(-1);
    }
  }, [open, sr]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const lastFilled = !!(form.issues[form.issues.length - 1].issue_type && form.issues[form.issues.length - 1].text.trim());
  const setIssue = (n, v) => setForm((f) => ({ ...f, issues: f.issues.map((x, i) => (i === n ? { ...x, text: v } : x)) }));
  const setIssueType = (n, v) => setForm((f) => ({ ...f, issues: f.issues.map((x, i) => (i === n ? { ...x, issue_type: v } : x)) }));
  const setIssueCost = (n, v) => setForm((f) => ({ ...f, issues: f.issues.map((x, i) => (i === n ? { ...x, cost: v } : x)) }));
  const addIssue = () => { if (!lastFilled) return; setJustAdded(form.issues.length); setForm((f) => ({ ...f, issues: [...f.issues, { issue_type: "", text: "" }] })); };
  const removeIssue = (n) => { if (form.issues.length <= 1) return; setJustAdded(-1); setActive(`iss-${Math.max(0, n - 1)}`); setForm((f) => ({ ...f, issues: f.issues.filter((_, i) => i !== n) })); };

  const rows = SHEET_FIELDS
    .filter(([k]) => k !== "vehicle_id")
    .flatMap(([k, label, ph]) => (k === "priority" ? [[k, label, ph], ["status", "Status", ""]] : [[k, label, ph]]))
    .flatMap(([k, label, ph]) => (k === "issue" ? form.issues.map((_, n) => [`iss-${n}`, `Issue ${n + 1}`, ph]) : [[k, label, ph]]));
  const anyCost = form.issues.some((i) => i.cost !== "" && i.cost != null);
  const totalCost = anyCost
    ? form.issues.reduce((s, i) => s + (Number(i.cost) || 0), 0)
    : (form.estimated_cost === "" || form.estimated_cost == null ? null : Number(form.estimated_cost));
  const activeIdx = Math.max(0, rows.findIndex(([k]) => k === (active.startsWith("cst-") ? `iss-${active.slice(4)}` : active)));
  const activeVal = (active.startsWith("iss-") || active.startsWith("cst-"))
    ? (form.issues[Number(active.slice(4))]?.[active.startsWith("cst-") ? "cost" : "text"] ?? "")
    : active === "status" ? (STAGES.find(([k]) => k === form.status)?.[1] || "") : String(active === "estimated_cost" ? (totalCost ?? 0) : (form[active] ?? ""));

  const selectCls = "h-10 w-full rounded-none border-0 bg-transparent px-3 shadow-none focus:ring-0 focus:ring-offset-0";
  const inputCls = "w-full h-10 bg-transparent px-3 text-sm text-mv-text placeholder:text-mv-dim outline-none";
  const renderCell = (key, placeholder) => {
    if (key === "priority") return (
      <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
        <SelectTrigger className={`${selectCls} capitalize`}><SelectValue /></SelectTrigger>
        <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["critical", "high", "medium", "low"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
      </Select>
    );
    if (key === "status") return (
      <Select value={form.status} onValueChange={(v) => set("status", v)}>
        <SelectTrigger className={selectCls}><SelectValue /></SelectTrigger>
        <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{STAGES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
      </Select>
    );
    if (key.startsWith("iss-")) { const n = Number(key.slice(4)); return <textarea rows={2} autoFocus={justAdded === n} value={form.issues[n].text} onChange={(e) => setIssue(n, e.target.value)} placeholder={placeholder} className="w-full min-h-[112px] bg-transparent px-3 py-2 text-sm text-mv-text placeholder:text-mv-dim outline-none resize-none" />; }
    if (key === "estimated_cost") return <input readOnly tabIndex={-1} value={totalCost ?? 0} title="Calculated from the issue costs" className={`${inputCls} cursor-not-allowed bg-mv-surface2/60 font-semibold`} />;
    if (key === "odometer") return <input inputMode="numeric" value={form.odometer} onChange={(e) => set("odometer", e.target.value.replace(/\D/g, ""))} placeholder={placeholder} className={inputCls} />;
    if (key === "vin_number") return <input value={form.vin_number} maxLength={17} onChange={(e) => set("vin_number", e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())} placeholder={placeholder} className={inputCls} />;
    return <input value={form[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} className={inputCls} />;
  };

  const save = async () => {
    const issues = form.issues.map((i) => ({ issue_type: i.issue_type, text: i.text.trim(), cost: i.cost === "" || i.cost == null ? null : Number(i.cost) })).filter((i) => i.issue_type || i.text || i.cost != null);
    const bad = issues.findIndex((i) => !i.issue_type);
    if (bad !== -1) { toast.error(`Select the issue type for row ${bad + 1}`); return; }
    setSaving(true);
    try {
      await api.put(`/service-requests/${sr.id}`, { ...form, issues, issue_type: issues[0]?.issue_type || "General", issue: issues[0]?.text || "", estimated_cost: totalCost, odometer: form.odometer === "" || form.odometer == null ? null : Number(form.odometer) });
      toast.success("Request updated ✓"); onDone();
    } catch { toast.error("Failed"); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-4xl">
        <DialogHeader><DialogTitle className="font-display">Edit Job Card</DialogTitle></DialogHeader>
        <div className="flex items-center h-9 min-w-0 border border-mv-border bg-mv-surface2 text-sm">
          <div className="w-16 text-center border-r border-mv-border text-mv-muted">{active.startsWith("cst-") ? "C" : "B"}{activeIdx + 2}</div>
          <div className="w-9 text-center italic text-mv-dim">fx</div>
          <div className="px-2 truncate capitalize">{activeVal}</div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full border-collapse table-fixed text-sm">
            <colgroup><col className="w-11" /><col className="w-52" /><col /></colgroup>
            <tbody>
              <tr className="h-7 text-center text-[11px] text-mv-dim bg-mv-surface2">
                <td className="border border-mv-border" /><td className="border border-mv-border">A</td><td className="border border-mv-border">B</td>
              </tr>
              <tr className="h-9">
                <td className="text-center text-[11px] text-mv-dim bg-mv-surface2 border border-mv-border">1</td>
                <td className="px-3 font-semibold bg-mv-surface2 border border-mv-border">Field</td>
                <td className="px-3 font-semibold bg-mv-surface2 border border-mv-border">Value</td>
              </tr>
              {rows.map(([key, label, placeholder], i) => (
                <tr key={key}>
                  <td className="text-center text-[11px] text-mv-dim bg-mv-surface2 border border-mv-border">{i + 2}</td>
                  <td className="px-3 text-[11px] font-semibold uppercase tracking-wide text-mv-muted bg-mv-surface2 border border-mv-border">
                    {key.startsWith("iss-") ? (
                      <div className="flex flex-col gap-1 py-2 h-[112px]">
                        <div className="flex items-center justify-between">
                          <span>Issue type</span>
                          {form.issues.length > 1 && (
                            <button type="button" onClick={() => removeIssue(Number(key.slice(4)))}
                              className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-red-500 hover:bg-red-500/10 hover:text-red-600">- Remove issue</button>
                          )}
                        </div>
                        <Select value={form.issues[Number(key.slice(4))].issue_type} onValueChange={(v) => setIssueType(Number(key.slice(4)), v)}>
                          <SelectTrigger className="h-8 w-full rounded-md border border-mv-border bg-mv-surface px-2 text-sm font-normal normal-case tracking-normal"><SelectValue placeholder="Select type" /></SelectTrigger>
                          <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{ISSUE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                        </Select>
                        {key === `iss-${form.issues.length - 1}` && (
                          <button type="button" onClick={addIssue} disabled={!lastFilled}
                            className="mt-auto self-end rounded-md px-2 py-1 text-[11px] font-semibold normal-case tracking-normal bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">+ Add issue</button>
                        )}
                      </div>
                    ) : label}
                  </td>
                  <td onFocus={() => setActive(key)} className={`p-0 border border-mv-border ${active === key && !key.startsWith("iss-") ? "ring-2 ring-inset ring-mv-primary" : ""}`}>
                    {key.startsWith("iss-") ? (
                      <div className="flex min-w-0">
                        <div className="flex-1 min-w-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-mv-primary">{renderCell(key, placeholder)}</div>
                        <div onFocus={(e) => { e.stopPropagation(); setActive(`cst-${key.slice(4)}`); }} className="w-40 shrink-0 border-l border-mv-border focus-within:ring-2 focus-within:ring-inset focus-within:ring-mv-primary">
                          <div className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-mv-muted">Est. cost ₹</div>
                          <input type="number" min="0" value={form.issues[Number(key.slice(4))].cost ?? ""} onChange={(e) => setIssueCost(Number(key.slice(4)), e.target.value)} placeholder="0" className="w-full h-10 bg-transparent px-3 text-sm text-mv-text placeholder:text-mv-dim outline-none" />
                        </div>
                      </div>
                    ) : renderCell(key, placeholder)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs font-semibold px-3 py-1.5 bg-mv-surface2 border border-mv-border border-b-2 border-b-green-500 text-mv-text">Job Card</span>
          <PrimaryBtn onClick={save} disabled={saving}>Save Changes</PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditSRDialogOld({ open, setOpen, sr, onDone }) {
  const [form, setForm] = useState({ issue_type: "", priority: "", description: "", status: "", issues: [{ issue_type: "", text: "" }], approved_manager: "", estimated_cost: "", vehicle_model: "", odometer: "", vin_number: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && sr) setForm({ issue_type: sr.issue_type, priority: sr.priority, description: sr.description || "", status: sr.status, issues: sr.issues?.length ? sr.issues.map((x) => (typeof x === "string" ? { issue_type: sr.issue_type || "", text: x } : { issue_type: x.issue_type || "", text: x.text || "", cost: x.cost ?? "" })) : [{ issue_type: sr.issue_type || "", text: sr.issue || "" }], approved_manager: sr.approved_manager || "", estimated_cost: sr.estimated_cost ?? "", vehicle_model: sr.vehicle_model || "", odometer: sr.odometer ?? "", vin_number: sr.vin_number || "" });
  }, [open, sr]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const lastFilled = !!(form.issues[form.issues.length - 1].issue_type && form.issues[form.issues.length - 1].text.trim());
  const setIssue = (n, v) => setForm((f) => ({ ...f, issues: f.issues.map((x, i) => (i === n ? { ...x, text: v } : x)) }));
  const setIssueType = (n, v) => setForm((f) => ({ ...f, issues: f.issues.map((x, i) => (i === n ? { ...x, issue_type: v } : x)) }));
  const setIssueCost = (n, v) => setForm((f) => ({ ...f, issues: f.issues.map((x, i) => (i === n ? { ...x, cost: v } : x)) }));
  const addIssue = () => { if (lastFilled) setForm((f) => ({ ...f, issues: [...f.issues, { issue_type: "", text: "" }] })); };
  const save = async () => {
    setSaving(true);
    const issues = form.issues.map((i) => ({ issue_type: i.issue_type, text: i.text.trim(), cost: i.cost === "" || i.cost == null ? null : Number(i.cost) })).filter((i) => i.issue_type || i.text || i.cost != null);
    const bad = issues.findIndex((i) => !i.issue_type);
    if (bad !== -1) { toast.error(`Select the issue type for row ${bad + 1}`); setSaving(false); return; }
    try { await api.put(`/service-requests/${sr.id}`, { ...form, issues, issue_type: issues[0]?.issue_type || "General", issue: issues[0]?.text || "", estimated_cost: form.estimated_cost === "" || form.estimated_cost == null ? null : Number(form.estimated_cost), odometer: form.odometer === "" || form.odometer == null ? null : Number(form.odometer) }); toast.success("Request updated ✓"); onDone(); } catch { toast.error("Failed"); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Edit Job Card</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-2">
          {/* <Field label="Issue Type"><Select value={form.issue_type} onValueChange={(v) => set("issue_type", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["Breakdown", "Battery", "Tyre", "Brake", "Electrical", "Charger", "Accident", "General", "Other"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></Field> */}
          <Field label="Priority"><Select value={form.priority} onValueChange={(v) => set("priority", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["critical", "high", "medium", "low"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent></Select></Field>
          <div><Field label="Status"><Select value={form.status} onValueChange={(v) => set("status", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{STAGES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></Field></div>
          {/* <div className="col-span-2"><Field label="Description"><TextArea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field></div> */}
          <div className="col-span-2 space-y-3">
            {form.issues.map((it, n) => (
              <div key={n} className="grid grid-cols-[180px_1fr] gap-3 items-start">
                <Field label="Issue type"><Select value={it.issue_type} onValueChange={(v) => setIssueType(n, v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder="Select type" /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{ISSUE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="Issue"><TextArea rows={3} value={it.text} onChange={(e) => setIssue(n, e.target.value)} /></Field>
              </div>
            ))}
            <div className="flex justify-end">
              <button type="button" onClick={addIssue} disabled={!lastFilled} className="rounded-md px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">+ Add issue</button>
            </div>
          </div>
          <Field label="Approved Manager"><TextInput value={form.approved_manager} onChange={(e) => set("approved_manager", e.target.value)} /></Field>
          <Field label="Estimated Cost ₹"><TextInput type="number" min="0" value={form.estimated_cost} onChange={(e) => set("estimated_cost", e.target.value)} /></Field>
          <Field label="Vehicle Model"><TextInput value={form.vehicle_model} onChange={(e) => set("vehicle_model", e.target.value)} /></Field>
          <Field label="Odometer"><TextInput inputMode="numeric" value={form.odometer} onChange={(e) => set("odometer", e.target.value.replace(/\D/g, ""))} /></Field>
          <div className="col-span-2"><Field label="VIN"><TextInput value={form.vin_number} maxLength={17} onChange={(e) => set("vin_number", e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())} /></Field></div>
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
