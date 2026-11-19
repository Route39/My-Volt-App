import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, MapPin, UserCheck, UserX, Hourglass, LogOut as LogOutIcon, Clock, ExternalLink, CalendarCheck } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { CITIES } from "../context/AppContext";
import { Skeleton, EmptyState } from "../components/common/Primitives";
import { PageHeader, TextInput, FilterChip } from "../components/common/Page";
import { imgUrl } from "../lib/imgUrl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const istDay = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const tm = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "—");
const hm = (h) => { const m = Math.round((Number(h) || 0) * 60); return `${Math.floor(m / 60)}h ${m % 60}m`; };
const dmy = (d) => (d ? d.split("-").reverse().join("-") : "");
const MARKS = ["Present", "Late", "Absent", "Leave", "Holiday", "Week Off", "Half Day"];
const MARK_STYLE = {
  Present: "bg-emerald-50 text-emerald-700", Late: "bg-amber-50 text-amber-700", Absent: "bg-red-50 text-red-600",
  Leave: "bg-blue-50 text-blue-700", Holiday: "bg-indigo-50 text-indigo-700",
  "Week Off": "bg-slate-100 text-slate-600", "Half Day": "bg-orange-50 text-orange-700",
};

export default function Attendance() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "company_admin";
  const [items, setItems] = useState(null);
  const [dateMode, setDateMode] = useState("today");     // today | yesterday | date | range
  const [pickDate, setPickDate] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [cityTab, setCityTab] = useState("all");
  const [statusTab, setStatusTab] = useState("all");
  const [q, setQ] = useState("");
  const [photo, setPhoto] = useState(null);

  const range = useMemo(() => {
    if (dateMode === "today") return [istDay(0), istDay(0)];
    if (dateMode === "yesterday") return [istDay(-1), istDay(-1)];
    if (dateMode === "date") return [pickDate || istDay(0), pickDate || istDay(0)];
    return [fromDate || toDate || istDay(0), toDate || fromDate || istDay(0)];
  }, [dateMode, pickDate, fromDate, toDate]);

  const load = useCallback(async () => {
    setItems(null);
    try {
      const { data } = await api.get("/attendance/records", { params: { date_from: range[0], date_to: range[1] } });
      setItems(data);
    } catch (e) {
      setItems([]);
      toast.error(formatApiErrorDetail(e?.response?.data?.detail));
    }
  }, [range]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (items || []).filter((r) =>
      (!isAdmin || cityTab === "all" || r.city === cityTab) &&
      (statusTab === "all" || r.status === statusTab) &&
      (!term || `${r.driver_name || ""} ${r.driver_code || ""} ${r.driver_phone || ""}`.toLowerCase().includes(term))
    );
  }, [items, q, cityTab, statusTab, isAdmin]);

  const setMark = async (r, status) => {
    const prev = items;
    setItems((list) => list.map((x) => (x.id === r.id ? { ...x, status } : x)));
    try {
      await api.put("/attendance/mark", { driver_id: r.driver_id, date: r.date, status });
      toast.success(`${r.driver_name} marked ${status}`);
    } catch (e) {
      setItems(prev);
      toast.error(formatApiErrorDetail(e?.response?.data?.detail));
    }
  };

  const working = rows.filter((r) => r.check_in && !r.check_out).length;
  const out = rows.filter((r) => r.check_out).length;
  const cards = [
    { label: "Checked In", n: rows.filter((r) => r.check_in).length, icon: UserCheck, color: "text-red-500", bg: "bg-red-500/15" },
    { label: "Not Checked In", n: rows.filter((r) => !r.check_in).length, icon: UserX, color: "text-slate-500", bg: "bg-slate-500/15" },
    { label: "Half Day", n: rows.filter((r) => r.status === "Half Day").length, icon: Hourglass, color: "text-orange-500", bg: "bg-orange-500/15" },
    { label: "Still Working", n: working, icon: Clock, color: "text-green-500", bg: "bg-green-500/15" },
    { label: "Checked Out", n: out, icon: LogOutIcon, color: "text-amber-500", bg: "bg-amber-500/15" },
  ];

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Driver check-in and check-out with selfie and location" />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-mv-dim absolute left-3 top-1/2 -translate-y-1/2" />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search driver name, code or phone…" className="pl-9" data-testid="att-search" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[["today", "Today"], ["yesterday", "Yesterday"], ["date", "Specific Date"], ["range", "Date Range"]].map(([v, l]) => (
            <FilterChip key={v} active={dateMode === v} onClick={() => setDateMode(v)}>{l}</FilterChip>
          ))}
          {dateMode === "date" && (
            <input type="date" value={pickDate} onChange={(e) => setPickDate(e.target.value)}
              className="h-10 px-3 rounded-xl border border-mv-border bg-mv-surface text-sm focus:border-mv-primary outline-none" />
          )}
          {dateMode === "range" && (
            <>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                className="h-10 px-3 rounded-xl border border-mv-border bg-mv-surface text-sm focus:border-mv-primary outline-none" />
              <span className="text-xs text-mv-muted">to</span>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                className="h-10 px-3 rounded-xl border border-mv-border bg-mv-surface text-sm focus:border-mv-primary outline-none" />
            </>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="flex flex-wrap gap-2 mb-5" data-testid="att-city-tabs">
          {["all", ...CITIES].map((c) => (
            <FilterChip key={c} active={cityTab === c} onClick={() => setCityTab(c)}>{c === "all" ? "All Cities" : c}</FilterChip>
          ))}
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2 mb-5" data-testid="att-status-tabs">
        {["all", ...MARKS].map((s) => (
          <FilterChip key={s} active={statusTab === s} onClick={() => setStatusTab(s)}>{s === "all" ? "All Status" : s}</FilterChip>
        ))}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
        {cards.map((c) => (
          <div key={c.label} className="mv-card p-4 flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${c.bg}`}><c.icon className={`w-5 h-5 ${c.color}`} /></div>
            <div>
              <div className="mv-label">{c.label}</div>
              <div className="text-2xl font-extrabold text-slate-900">{items === null ? "—" : c.n}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      {items === null ? (
        <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="No check-ins found" subtitle="No driver has checked in for the selected date, city or search." />
      ) : (
        <div className="mv-card overflow-x-auto">
          <table className="w-full min-w-[1250px] text-sm">
            <thead>
              <tr className="text-left border-b border-mv-border">
                {["Driver", "City", "Date", "Check In", "Check Out", "Hours", "Check In Location", "Check Out Location", "Status", "Mark"].map((h) => (
                  <th key={h} className="px-4 py-3 mv-label whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-mv-border last:border-0 align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {r.selfie_url ? (
                        <img src={imgUrl(r.selfie_url)} alt="Selfie" loading="lazy" onClick={() => setPhoto(r)}
                          className="w-11 h-11 rounded-full object-cover cursor-pointer border border-mv-border shrink-0" />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-slate-100 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">{r.driver_name || "—"}</div>
                        <div className="text-xs text-mv-muted">{r.driver_code || r.driver_phone || ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.city || "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{dmy(r.date)}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-medium">{tm(r.check_in)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.check_out ? tm(r.check_out) : r.check_in ? <span className="text-amber-600 text-xs font-semibold">Not checked out</span> : "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.check_out ? hm(r.hours) : "—"}</td>
                  <td className="px-4 py-3 max-w-[260px]">
                    {r.check_in_address && (
                      <div className="flex items-start gap-1.5 text-xs font-semibold text-emerald-700 break-words" title={r.check_in_address}>
                        <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{r.check_in_address}</span>
                      </div>
                    )}
                    {r.check_in_lat != null && (
                      <a href={`https://www.google.com/maps?q=${r.check_in_lat},${r.check_in_lng}`} target="_blank" rel="noreferrer"
                        className="text-xs font-semibold text-red-600 hover:underline inline-flex items-center gap-1">Map <ExternalLink className="w-3 h-3" /></a>
                    )}
                    {r.check_in_lat == null && !r.check_in_address && "—"}
                  </td>
                  <td className="px-4 py-3 max-w-[260px]">
                    {r.check_out_address && (
                      <div className="flex items-start gap-1.5 text-xs font-semibold text-emerald-700 break-words" title={r.check_out_address}>
                        <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{r.check_out_address}</span>
                      </div>
                    )}
                    {r.check_out_lat != null && (
                      <a href={`https://www.google.com/maps?q=${r.check_out_lat},${r.check_out_lng}`} target="_blank" rel="noreferrer"
                        className="text-xs font-semibold text-red-600 hover:underline inline-flex items-center gap-1">Map <ExternalLink className="w-3 h-3" /></a>
                    )}
                    {r.check_out_lat == null && !r.check_out_address && "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.check_in && r.status === "Present" ? (
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${r.check_out ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                        {r.check_out ? "Completed" : "Working"}
                      </span>
                    ) : (
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${MARK_STYLE[r.status] || "bg-slate-100 text-slate-600"}`}>
                        {r.status || "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Select value={r.status || undefined} onValueChange={(v) => setMark(r, v)} disabled={r.mark_locked}>
                      <SelectTrigger className="h-9 w-[130px] rounded-xl bg-mv-surface border-mv-border text-sm" title={r.mark_locked ? "Approved week-off" : ""}>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent className="bg-mv-surface border-mv-border text-mv-text">
                        {MARKS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!photo} onOpenChange={(o) => !o && setPhoto(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{photo?.driver_name} · {tm(photo?.check_in)}</DialogTitle></DialogHeader>
          {photo?.selfie_url && <img src={imgUrl(photo.selfie_url)} alt="Check-in selfie" className="w-full rounded-xl" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
