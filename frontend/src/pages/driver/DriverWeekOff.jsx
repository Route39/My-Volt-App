import { useEffect, useState, useCallback } from "react";
import { Loader2, CalendarDays } from "lucide-react";
import dapi from "../../lib/driverApi";
import { Calendar } from "../../components/ui/calendar";

const toKey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const toDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

const STATUS_LABEL = { pending: "Pending approval", approved: "Approved", rejected: "Rejected" };

const STATUS_CLS = {
  pending: "bg-amber-50 text-amber-600 border-amber-200",
  approved: "bg-emerald-50 text-emerald-600 border-emerald-200",
  rejected: "bg-red-50 text-red-600 border-red-200",
};

export default function DriverWeekOff() {
  const [info, setInfo] = useState(null);
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const [editId, setEditId] = useState(null);   // id of the pending request being edited

  const load = useCallback(async () => {
    try {
      const { data } = await dapi.get("/driver/week-off");
      setInfo(data);
    } catch (e) {
      setMsg({ type: "error", text: e.response?.data?.detail || "Failed to load week-off details" });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!info) {
    return (
      <div className="p-6">
        {msg.text
          ? <div className="text-red-600 text-sm font-semibold">{msg.text}</div>
          : <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>}
      </div>
    );
  }

  // days already approved / waiting for approval use up the monthly limit
  // while editing, the request's own dates are NOT "used" – they can be changed / re-picked
  const editReq = (info.requests || []).find((r) => r.id === editId && r.status === "pending");
  const own = new Set(editReq ? editReq.dates : []);
  const otherPending = (info.pending_dates || []).filter((x) => !own.has(x));
  const used = new Set([...(info.taken_dates || []), ...otherPending]);
  const maxPick = Math.max(0, info.max_days - used.size);

  const startEdit = (r) => {
    setEditId(r.id);
    setMsg({ type: "", text: "" });
    // past dates (and today if its rent is already paid) can no longer be picked
    setSel(r.dates.filter((x) => x >= info.today && !(x === info.today && info.today_rent_paid)).map(toDate));
    document.querySelector('[data-testid="driver-week-off"]')?.scrollIntoView({ behavior: "smooth" });
  };
  const cancelEdit = () => { setEditId(null); setSel([]); setMsg({ type: "", text: "" }); };

  // today (only if its rent is not paid) or a later day of the current month
  const isDisabled = (day) => {
    if (info.rent_pending) return true;   // rent pending up to yesterday: calendar stays disabled
    if (maxPick === 0) return true;
    const k = toKey(day);
    if (k < info.today || k.slice(0, 7) !== info.today.slice(0, 7)) return true;
    if (k === info.today && info.today_rent_paid) return true;
    if ((info.leave_dates || []).includes(k)) return true;   // already a paid leave day
    return used.has(k);
  };

  const apply = async () => {
    if (!sel.length) return setMsg({ type: "error", text: "Select at least one date." });
    setBusy(true);
    setMsg({ type: "", text: "" });
    try {
      const dates = sel.map(toKey).sort();
      if (editId) {
        await dapi.put(`/driver/week-off/${editId}`, { dates });
        setEditId(null);
        setMsg({ type: "ok", text: "Week-off request updated. Waiting for admin approval." });
      } else {
        await dapi.post("/driver/week-off", { dates });
        setMsg({ type: "ok", text: "Week-off request sent. Waiting for admin approval." });
      }
      setSel([]);
      await load();
    } catch (e) {
      setMsg({ type: "error", text: e.response?.data?.detail || "Failed to apply week-off" });
    } finally { setBusy(false); }
  };

  return (
    <div className="p-5" data-testid="driver-week-off">
      <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
        <CalendarDays className="w-5 h-5 text-emerald-600" /> Week-off
      </h1>
      <p className="text-sm font-semibold text-slate-700 mt-4">Select dates to apply week-off</p>
      <p className="text-xs text-slate-400 mt-1">
        You can pick up to {maxPick} more day{maxPick === 1 ? "" : "s"} this month (maximum {info.max_days} per month).
        {info.today_rent_paid ? " Today's rent is already paid, so today cannot be selected." : ""}
      </p>
      {info.rent_pending && (
        <div className="mt-3 rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-xs font-semibold text-red-600" data-testid="week-off-rent-pending">
          You have pending rent (up to yesterday). Please pay it to apply for a week-off.
        </div>
      )}

      <div className="mt-3 flex justify-center rounded-2xl bg-white border border-slate-100 py-2">
        <Calendar
          mode="multiple"
          selected={sel}
          onSelect={(v) => setSel(v || [])}
          max={maxPick || undefined}
          disabled={isDisabled}
          defaultMonth={toDate(info.today)}
          fromMonth={toDate(info.today)}
          toMonth={toDate(info.today)}
          showOutsideDays={false}
          modifiers={{ pending: otherPending.map(toDate), taken: (info.taken_dates || []).map(toDate) }}
          modifiersClassNames={{ pending: "bg-amber-100 text-amber-700 rounded-md", taken: "bg-emerald-100 text-emerald-700 rounded-md" }}
        />
      </div>

      {msg.text && (
        <div className={`text-xs font-semibold mt-3 text-center ${msg.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</div>
      )}

      <button onClick={apply} disabled={busy || !sel.length || info.rent_pending} data-testid="apply-week-off-btn"
        className="mt-4 w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold transition-colors flex items-center justify-center gap-2">
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : editId ? "Update Week-off" : "Apply Week-off"}
      </button>
      {editId && (
        <button onClick={cancelEdit} disabled={busy}
          className="mt-2 w-full h-11 rounded-2xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors">
          Cancel editing
        </button>
      )}

      {(info.requests || []).length > 0 && (
        <div className="mt-6">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Applied week-offs</div>
          <div className="space-y-2">
            {info.requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl bg-white border border-slate-100 px-3 py-2.5">
                <span className="text-sm font-medium text-slate-700">{r.dates.join(", ")}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {r.status === "pending" && (
                    <button onClick={() => startEdit(r)} data-testid={`edit-week-off-${r.id}`}
                      className="text-[11px] font-bold px-2 py-0.5 rounded-md border border-emerald-200 text-emerald-600 hover:bg-emerald-50">Edit</button>
                  )}
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${STATUS_CLS[r.status] || STATUS_CLS.pending}`}>{STATUS_LABEL[r.status] || r.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}