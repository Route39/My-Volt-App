import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, UserPlus, Search } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { fmtDate } from "../lib/format";
import { loadDriverCodes } from "../lib/driverCodes";
import { Field, PrimaryBtn, GhostBtn, TextInput } from "../components/common/Page";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const today = () => new Date().toISOString().slice(0, 10);

/* ---------- Shared list (used in sidebar page + driver profile tab) ---------- */
export function ReferralList({ referrerId, referrerName, referrerCode, showReferrer = true }) {
    const nav = useNavigate();
    const { user } = useAuth();
    const canEdit = ["admin", "company_admin", "city_manager"].includes(user?.role);
    const [items, setItems] = useState(null);
    const [q, setQ] = useState("");
    const [form, setForm] = useState(null); // null = closed, {} = add, {id..} = edit

    const load = useCallback(async () => {
        const { data } = await api.get("/referrals", { params: referrerId ? { referrer_id: referrerId } : {} });
        setItems(data);
    }, [referrerId]);
    useEffect(() => { load(); }, [load]);

    const remove = async (r) => {
        if (!window.confirm(`Delete referral of ${r.referred_name}?`)) return;
        try { await api.delete(`/referrals/${r.id}`); toast.success("Referral deleted"); load(); }
        catch { toast.error("Failed to delete"); }
    };

    const list = (items || []).filter((r) => {
        const s = q.toLowerCase();
        return !s || [r.referred_name, r.referred_phone, r.referrer_name].some((v) => (v || "").toLowerCase().includes(s));
    });

    return (
        <div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between mb-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mv-dim" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, referrer..."
                        className="w-full h-10 pl-9 pr-3 rounded-xl border border-mv-border bg-mv-surface text-sm outline-none focus:ring-2 focus:ring-mv-primary/30" />
                </div>
                {canEdit && (
                    <PrimaryBtn onClick={() => setForm({})} data-testid="add-referral-btn">
                        <Plus className="w-4 h-4" /> Add Referral
                    </PrimaryBtn>
                )}
            </div>

            {items === null ? (
                <div className="mv-card p-10 text-center text-mv-muted text-sm">Loading...</div>
            ) : list.length === 0 ? (
                <div className="mv-card p-10 text-center text-mv-muted text-sm">
                    <UserPlus className="w-8 h-8 mx-auto mb-2 text-mv-dim" /> No referrals yet.
                </div>
            ) : (
                <div className="mv-card overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-mv-dim text-xs uppercase tracking-wide border-b border-mv-border">
                                <th className="p-4">Referred Driver</th>
                                <th className="p-4">Phone</th>
                                {showReferrer && <th className="p-4">Referred By</th>}
                                <th className="p-4">Referred On</th>
                                <th className="p-4">Joined On</th>
                <th className="p-4">Days Driven</th>
                <th className="p-4">Reward</th>
                                {canEdit && <th className="p-4 text-right">Actions</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-mv-border">
                            {list.map((r) => (
                                <tr key={r.id} className="hover:bg-mv-elevated/50">
                                    <td className="p-4 font-medium">
                    {r.referred_driver_id
                      ? <button onClick={() => nav(`/drivers/${r.referred_driver_id}`)} className="text-mv-primary hover:underline">{r.referred_name}</button>
                      : r.referred_name}
                    {r.referred_code && <div className="text-xs font-mono text-mv-dim">{r.referred_code}</div>}
                  </td>
                                    <td className="p-4 text-mv-muted">{r.referred_phone || "—"}</td>
                                    {showReferrer && (
                                        <td className="p-4">
                                            <button onClick={() => nav(`/drivers/${r.referrer_driver_id}`)} className="text-mv-primary hover:underline">
                                                {r.referrer_name}
                                            </button>
                                            {r.referrer_code && <div className="text-xs text-mv-dim">{r.referrer_code}</div>}
                                        </td>
                                    )}
                                    <td className="p-4">{r.referred_at ? fmtDate(r.referred_at) : "—"}</td>
                                    <td className="p-4">
                                        {r.joined_at
                                            ? fmtDate(r.joined_at)
                                            : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Not joined yet</span>}
                                    </td>
                  <td className="p-4">
                    <div className="font-semibold">{r.days_driven || 0} <span className="text-mv-dim font-normal">/ 60</span></div>
                    <div className="w-24 h-1.5 bg-mv-elevated rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, ((r.days_driven || 0) / 60) * 100)}%` }} />
                    </div>
                    <div className="text-[11px] text-mv-dim mt-1">{r.rental_start ? `Since ${fmtDate(r.rental_start)}` : "No rental yet"}</div>
                  </td>
                  <td className="p-4 text-xs space-y-1 whitespace-nowrap">
                    <RewardLine amount={1000} target={30} days={r.days_driven || 0} />
                    <RewardLine amount={1500} target={60} days={r.days_driven || 0} />
                    <div className="font-bold text-emerald-600 pt-1">Earned: ₹{(r.reward_earned || 0).toLocaleString("en-IN")}</div>
                  </td>
                                    {canEdit && (
                                        <td className="p-4">
                                            <div className="flex justify-end gap-1">
                                                <button onClick={() => setForm(r)} className="p-2 rounded-lg hover:bg-mv-elevated text-mv-muted"><Pencil className="w-4 h-4" /></button>
                                                <button onClick={() => remove(r)} className="p-2 rounded-lg hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button>
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <ReferralDialog value={form} setValue={setForm} fixedReferrerId={referrerId} fixedReferrerName={referrerName} fixedReferrerCode={referrerCode}
                onDone={() => { setForm(null); load(); }} />
        </div>
    );
}

/* ---------- Add / Edit dialog ---------- */
function ReferralDialog({ value, setValue, fixedReferrerId, fixedReferrerName, fixedReferrerCode, onDone }) {
    const isEdit = !!value?.id;
    const [drivers, setDrivers] = useState([]);
    const [f, setF] = useState({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!value) return;
        setF({
            referrer_driver_id: value.referrer_driver_id || fixedReferrerId || "",
            referred_name: value.referred_name || "",
            referred_phone: value.referred_phone || "",
            referred_at: (value.referred_at || today()).slice(0, 10),
            joined_at: (value.joined_at || "").slice(0, 10),
        });
        if (!fixedReferrerId && !isEdit) {
            api.get("/drivers").then(({ data }) => setDrivers(Array.isArray(data) ? data : data.items || []));
        }
    }, [value, fixedReferrerId, isEdit]);

    const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

    const save = async () => {
        if (!f.referrer_driver_id) return toast.error("Select who referred");
        if (!f.referred_name.trim()) return toast.error("Enter referred driver name");
    if (!isEdit && !(f.referred_phone || "").trim()) return toast.error("Enter phone number");
        setSaving(true);
        try {
            const body = { ...f, joined_at: f.joined_at || null };
            if (isEdit) await api.put(`/referrals/${value.id}`, body);
            else await api.post("/referrals", body);
            toast.success(isEdit ? "Referral updated" : "Referral added & driver created");
      loadDriverCodes(true);
            onDone();
        } catch (e) {
            toast.error(e.response?.data?.detail || "Failed to save");
        } finally { setSaving(false); }
    };

    return (
        <Dialog open={!!value} onOpenChange={(o) => !o && setValue(null)}>
            <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
                <DialogHeader><DialogTitle className="font-display">{isEdit ? "Edit Referral" : "Add Referral"}</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="col-span-2">
                        <Field label="Referred By (Existing Driver)">
                            {fixedReferrerId || isEdit ? (
                                <TextInput disabled value={[
                  fixedReferrerName || value?.referrer_name,
                  fixedReferrerCode || value?.referrer_code,
                ].filter(Boolean).join(" · ")} />
                            ) : (
                                <DriverSearch drivers={drivers} value={f.referrer_driver_id} onChange={(id) => set("referrer_driver_id", id)} />
                            )}
                        </Field>
                    </div>
                    <Field label="Referred Driver Name"><TextInput value={f.referred_name || ""} onChange={(e) => set("referred_name", e.target.value)} /></Field>
                    <Field label="Phone"><TextInput value={f.referred_phone || ""} onChange={(e) => set("referred_phone", e.target.value)} placeholder="9876543210" /></Field>
                    <Field label="Referred On"><TextInput type="date" value={f.referred_at || ""} onChange={(e) => set("referred_at", e.target.value)} /></Field>
                    <Field label="Joined On (optional)"><TextInput type="date" value={f.joined_at || ""} onChange={(e) => set("joined_at", e.target.value)} /></Field>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                    <GhostBtn onClick={() => setValue(null)}>Cancel</GhostBtn>
                    <PrimaryBtn onClick={save} disabled={saving}>{saving ? "Saving..." : isEdit ? "Save Changes" : "Add Referral"}</PrimaryBtn>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function RewardLine({ amount, target, days }) {
  return days >= target
    ? <div className="text-emerald-600 font-semibold">✅ ₹{amount} · {target} days done</div>
    : <div className="text-mv-dim">⏳ ₹{amount} · {target - days} days left</div>;
}

function DriverSearch({ drivers, value, onChange }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const selected = drivers.find((d) => d.id === value);
  const s = q.trim().toLowerCase();
  const list = drivers
    .filter((d) => !s || [d.name, d.driver_code, d.phone].some((v) => (v || "").toLowerCase().includes(s)))
    .slice(0, 50);
  const label = selected ? `${selected.name}${selected.driver_code ? " · " + selected.driver_code : ""} · ${selected.phone}` : "";
  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-mv-dim" />
        <input
          value={open ? q : label}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); setQ(""); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search name, ID or phone..."
          className="w-full h-10 pl-9 pr-3 rounded-xl border border-mv-border bg-mv-surface2 text-sm outline-none focus:ring-2 focus:ring-mv-primary/30" />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-mv-border bg-mv-surface shadow-lg">
          {list.length === 0 ? (
            <div className="p-3 text-sm text-mv-dim">No driver found</div>
          ) : list.map((d) => (
            <button type="button" key={d.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(d.id); setOpen(false); setQ(""); }}
              className={`w-full text-left px-3 py-2 hover:bg-mv-elevated ${d.id === value ? "bg-mv-elevated" : ""}`}>
              <div className="text-sm font-medium">{d.name}</div>
              <div className="text-xs text-mv-dim">
                <span className="font-mono text-mv-primary">{d.driver_code || "—"}</span> · {d.phone}{d.city ? ` · ${d.city}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Sidebar page ---------- */
export default function Referrals() {
    return (
        <div>
            <div className="mb-6">
                <h1 className="font-display text-3xl font-bold">Referral Drivers</h1>
                <p className="text-mv-muted mt-1">Drivers referred by existing drivers</p>
            </div>
            <ReferralList />
        </div>
    );
}