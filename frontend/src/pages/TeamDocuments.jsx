import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Plus, FileText, Download, ExternalLink, MapPin, CalendarDays, Search, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { CITIES } from "../context/AppContext";
import { Skeleton, EmptyState } from "../components/common/Primitives";
import { PageHeader, PrimaryBtn, GhostBtn, Field, TextInput, FilterChip } from "../components/common/Page";
import { fmtDate } from "../lib/format";
import { imgUrl } from "../lib/imgUrl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);
// yyyy-mm-dd in the browser's local timezone (matches the <input type="date"> value)
const KYC_LABELS = { dl_front: "Licence Front", dl_back: "Licence Back", driver_photo: "Driver Photo", vehicle_photo: "Vehicle Photo", agreement: "Agreement", aadhaar_front: "Aadhaar Front", aadhaar_back: "Aadhaar Back", pan: "PAN Card" };
const kycLabel = (k) => KYC_LABELS[k] || k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const localDay = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA") : "");

// Date filter: all | today | this_week (Mon-Sun) | this_month | date | month | custom
function matchesDate(iso, f) {
  if (f.mode === "all") return true;
  const day = localDay(iso);
  if (!day) return false;
  const now = new Date();
  const today = now.toLocaleDateString("en-CA");
  if (f.mode === "today") return day === today;
  if (f.mode === "this_week") {
    const start = new Date(now); start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return day >= start.toLocaleDateString("en-CA") && day <= end.toLocaleDateString("en-CA");
  }
  if (f.mode === "this_month") return day.slice(0, 7) === today.slice(0, 7);
  if (f.mode === "date") return !f.pickDate || day === f.pickDate;
  if (f.mode === "month") return !f.pickMonth || day.slice(0, 7) === f.pickMonth;
  if (f.mode === "custom") return (!f.fromDate || day >= f.fromDate) && (!f.toDate || day <= f.toDate);
  return true;
}

export default function TeamDocuments() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "company_admin";
  const [items, setItems] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [q, setQ] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [pickDate, setPickDate] = useState("");
  const [pickMonth, setPickMonth] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [cityTab, setCityTab] = useState("all");
  const [kycDrivers, setKycDrivers] = useState(null);
  useEffect(() => {
    api.get("/drivers").then(({ data }) => setKycDrivers(Array.isArray(data) ? data : [])).catch(() => setKycDrivers([]));
  }, []);
  const kycList = kycDrivers && kycDrivers.filter((d) => d.kyc_documents && Object.values(d.kyc_documents).some((u) => typeof u === "string" && u)
    && (cityTab === "all" || (d.city || "").toLowerCase() === String(cityTab).toLowerCase())
    && (!q || `${d.name} ${d.driver_code || ""} ${d.current_vehicle_number || ""}`.toLowerCase().includes(q.toLowerCase())));
  const cityDrivers = kycDrivers && kycDrivers.filter((d) => cityTab === "all" || (d.city || "").toLowerCase() === String(cityTab).toLowerCase());
  const kycSubmitted = cityDrivers && cityDrivers.filter((d) => d.kyc_submitted_at || (d.kyc_documents && Object.values(d.kyc_documents).some((u) => typeof u === "string" && u))).length;
  const kycCards = [
    { label: "Total Drivers", n: cityDrivers?.length, color: "text-red-500", bg: "bg-red-500/15" },
    { label: "KYC Submitted", n: kycSubmitted, color: "text-green-500", bg: "bg-green-500/15" },
    { label: "KYC Pending", n: cityDrivers ? cityDrivers.length - kycSubmitted : null, color: "text-amber-500", bg: "bg-amber-500/15" },
  ];

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/team-documents");
      setItems(data);
    } catch (e) {
      setItems([]);
      toast.error(formatApiErrorDetail(e?.response?.data?.detail));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const f = { mode: dateFilter, pickDate, pickMonth, fromDate, toDate };
    return (items || []).filter((d) =>
      (!term || (d.name || "").toLowerCase().includes(term)) &&
      matchesDate(d.created_at, f) &&
      (!isAdmin || cityTab === "all" || d.city === cityTab)
    );
  }, [items, q, dateFilter, pickDate, pickMonth, fromDate, toDate, cityTab, isAdmin]);

  const removeDoc = async (d) => {
    if (!window.confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/team-documents/${d.id}`);
      setItems((arr) => (arr || []).filter((x) => x.id !== d.id));
      toast.success("Document deleted");
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail));
    }
  };

  // open / download the file through the authenticated API (works for any file type)
  const openFile = async (d, download = false) => {
    const w = download ? null : window.open("", "_blank");
    try {
      const res = await api.get(`/team-documents/${d.id}/file`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: d.content_type || res.data.type }));
      if (download || !w) {
        const a = document.createElement("a");
        a.href = url; a.download = d.filename || d.name; document.body.appendChild(a); a.click(); a.remove();
      } else {
        w.location.href = url;
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      if (w) w.close();
      toast.error("Could not open the document");
    }
  };

  return (
    <div>
      <PageHeader title="Documents" subtitle="Company and city documents shared with your team">
        <PrimaryBtn onClick={() => setShowNew(true)} data-testid="add-document-btn"><Plus className="w-4 h-4" /> Add document</PrimaryBtn>
      </PageHeader>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-mv-dim absolute left-3 top-1/2 -translate-y-1/2" />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search document name…" className="pl-9" data-testid="doc-search" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[["all", "All Time"], ["today", "Today"], ["this_week", "This Week"], ["this_month", "This Month"], ["date", "Specific Date"], ["month", "Specific Month"], ["custom", "Custom Range"]].map(([v, l]) => (
            <FilterChip key={v} active={dateFilter === v} onClick={() => setDateFilter(v)}>{l}</FilterChip>
          ))}
          {dateFilter === "date" && (
            <input type="date" value={pickDate} onChange={(e) => setPickDate(e.target.value)}
              className="h-10 px-3 rounded-xl border border-mv-border bg-mv-surface text-sm focus:border-mv-primary outline-none" />
          )}
          {dateFilter === "month" && (
            <input type="month" value={pickMonth} onChange={(e) => setPickMonth(e.target.value)}
              className="h-10 px-3 rounded-xl border border-mv-border bg-mv-surface text-sm focus:border-mv-primary outline-none" />
          )}
          {dateFilter === "custom" && (
            <div className="flex items-center gap-2">
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                className="h-10 px-3 rounded-xl border border-mv-border bg-mv-surface text-sm focus:border-mv-primary outline-none" />
              <span className="text-mv-dim">to</span>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                className="h-10 px-3 rounded-xl border border-mv-border bg-mv-surface text-sm focus:border-mv-primary outline-none" />
            </div>
          )}
        </div>
      </div>

      {/* City tabs - admin only */}
      {isAdmin && (
        <div className="flex flex-wrap gap-2 mb-5" data-testid="doc-city-tabs">
          {["all", ...CITIES].map((c) => (
            <FilterChip key={c} active={cityTab === c} onClick={() => setCityTab(c)}>{c === "all" ? "All Cities" : c}</FilterChip>
          ))}
        </div>
      )}

      {!items && <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>}
      {items && filtered.length === 0 && (
        (items.length ? <div className="mv-card p-5 text-sm text-mv-muted text-center">No company documents match the search or filters.</div> : null)
      )}
      {items && filtered.length > 0 && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((d) => (
            <div key={d.id} className="mv-card mv-card-hover p-4 flex flex-col gap-3" data-testid={`doc-card-${d.id}`}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-mv-primary/15 flex items-center justify-center shrink-0"><FileText className="w-5 h-5 text-mv-primary" /></div>
                <div className="min-w-0">
                  <div className="font-medium truncate" title={d.name}>{d.name}</div>
                  <div className="text-xs text-mv-dim truncate" title={d.filename}>{d.filename} · {fmtSize(d.size)}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mv-muted">
                <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {d.city}</span>
                <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {fmtDate(d.created_at)}</span>
              </div>
              {d.uploaded_by_name && <div className="text-xs text-mv-dim">Uploaded by {d.uploaded_by_name}</div>}
              <div className="flex gap-2 mt-auto pt-1">
                <GhostBtn onClick={() => openFile(d)} className="flex-1"><ExternalLink className="w-4 h-4" /> View</GhostBtn>
                <GhostBtn onClick={() => openFile(d, true)} className="flex-1"><Download className="w-4 h-4" /> Download</GhostBtn>
                <GhostBtn onClick={() => removeDoc(d)} title="Delete" className="px-3 text-red-500 hover:bg-red-50" data-testid={`doc-delete-${d.id}`}><Trash2 className="w-4 h-4" /></GhostBtn>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddDocumentDialog open={showNew} setOpen={setShowNew} isAdmin={isAdmin} userCity={user?.city} onDone={() => { setShowNew(false); load(); }} />
      <div className="mt-10">
        <h2 className="font-display text-xl font-semibold mb-1">Driver KYC Documents</h2>
        <p className="text-sm text-mv-muted mb-4">Documents uploaded by drivers during KYC</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {kycCards.map((k) => (
            <div key={k.label} className="mv-card p-4">
              <div className={`w-9 h-9 rounded-xl ${k.bg} flex items-center justify-center`}><FileText className={`w-4 h-4 ${k.color}`} /></div>
              <div className="font-display text-2xl font-bold mt-3">{k.n == null ? <Skeleton className="h-7 w-10" /> : k.n}</div>
              <div className="text-[11px] tracking-widest uppercase text-mv-dim mt-1">{k.label}</div>
            </div>
          ))}
        </div>
        {kycList === null ? <Skeleton className="h-32 rounded-2xl" /> : kycList.length === 0 ? (
          <div className="mv-card p-8 text-center text-sm text-mv-muted">No driver KYC documents found.</div>
        ) : (
          <div className="space-y-3">
            {kycList.map((d) => {
              const docs = Object.entries(d.kyc_documents).filter(([, u]) => typeof u === "string" && u);
              return (
                <div key={d.id} className="mv-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <div className="font-semibold">{d.name} <span className="text-xs font-mono text-red-500 ml-1">{d.driver_code}</span></div>
                      <div className="text-xs text-mv-muted">{d.current_vehicle_number ? `${d.current_vehicle_number}${d.current_vehicle_reg ? " - " + d.current_vehicle_reg : ""}` : "No vehicle assigned"} · {d.city}</div>
                    </div>
                    <span className="text-xs text-mv-dim">{docs.length} documents</span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-3">
                    {docs.map(([k, u]) => (
                      <div key={k} className="rounded-xl border overflow-hidden">
                        <a href={imgUrl(u)} target="_blank" rel="noreferrer" className="block aspect-square bg-mv-elevated">
                          {/\.pdf$/i.test(u) ? <div className="h-full flex items-center justify-center"><FileText className="w-8 h-8 text-mv-dim" /></div> : <img src={imgUrl(u)} alt={kycLabel(k)} className="w-full h-full object-cover" />}
                        </a>
                        <div className="px-2 py-2 flex items-center justify-between gap-1">
                          <span className="text-xs truncate">{kycLabel(k)}</span>
                          <span className="flex gap-1">
                            <a href={imgUrl(u)} target="_blank" rel="noreferrer" title="View" className="p-1 hover:text-red-500"><ExternalLink className="w-3.5 h-3.5" /></a>
                            <a href={imgUrl(u)} download title="Download" className="p-1 hover:text-red-500"><Download className="w-3.5 h-3.5" /></a>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AddDocumentDialog({ open, setOpen, isAdmin, userCity, onDone }) {
  // city manager: only own city; admin: all cities
  const cityOptions = isAdmin ? CITIES : (userCity ? [userCity] : []);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) { setName(""); setFile(null); setCity(isAdmin ? "" : (userCity || "")); }
  }, [open, isAdmin, userCity]);

  const save = async () => {
    if (!name.trim()) { toast.error("Document name is required"); return; }
    if (!file) { toast.error("Please attach a document"); return; }
    if (!city) { toast.error("City is required"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("File must be under 10 MB"); return; }
    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("city", city);
    fd.append("file", file);
    setSaving(true);
    try {
      await api.post("/team-documents", fd);
      toast.success("Document saved ✓");
      onDone();
    } catch (e) {
      toast.error(formatApiErrorDetail(e?.response?.data?.detail));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Add document</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-1">
          <Field label="Name of the document *">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Insurance policy 2026" data-testid="doc-name" />
          </Field>
          <Field label="Upload document *">
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="doc-file" />
            <button type="button" onClick={() => fileRef.current?.click()}
              className="w-full h-10 px-3 rounded-xl bg-mv-surface2 border border-dashed border-mv-border hover:border-mv-primary text-sm text-left flex items-center gap-2 transition-colors">
              <Upload className="w-4 h-4 text-mv-dim shrink-0" />
              <span className={`truncate ${file ? "text-mv-text" : "text-mv-dim"}`}>{file ? file.name : "Choose a file (max 10 MB)"}</span>
            </button>
          </Field>
          <Field label="City *">
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border" data-testid="doc-city"><SelectValue placeholder="Select city" /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text">
                {cityOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <GhostBtn onClick={() => setOpen(false)}>Cancel</GhostBtn>
          <PrimaryBtn onClick={save} disabled={saving} data-testid="save-document-btn">{saving ? "Saving…" : "Save"}</PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}
