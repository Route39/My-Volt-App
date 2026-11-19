import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Save, Loader2, Navigation, ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiErrorDetail } from "../lib/api";
import { Switch } from "./ui/switch";

const hasPin = (p) => p && p.lat !== "" && p.lat != null && p.lng !== "" && p.lng != null;
const errMsg = (e) => formatApiErrorDetail(e?.response?.data?.detail);

// One office / hub: address search (Google Maps / OpenStreetMap), radius and "Use My GPS".
function PointEditor({ title, dot, point, onChange, onRemove, nameEditable }) {
  const [sugg, setSugg] = useState([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const pinned = hasPin(point);

  const onAddress = (text) => {
    onChange({ address: text, lat: "", lng: "" });
    clearTimeout(timer.current);
    const t = (text || "").trim();
    if (t.length < 3 || /^https?:/i.test(t) || /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(t)) { setSugg([]); return; }
    timer.current = setTimeout(async () => {
      try { const { data } = await api.post("/attendance/suggest", { query: t }); setSugg(data); }
      catch (_) { setSugg([]); }
    }, 400);
  };

  const pick = async (s) => {
    setSugg([]);
    if (s.lat != null && s.lng != null) { onChange({ address: s.description, lat: s.lat, lng: s.lng }); return; }
    onChange({ address: s.description, lat: "", lng: "" });
    setBusy(true);
    try {
      const { data } = await api.post("/attendance/place-details", { place_id: s.place_id });
      onChange({ address: data.address || s.description, lat: data.lat, lng: data.lng });
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };

  // address typed / pasted (or a Google Maps link / "lat, lng") -> coordinates
  const findCoords = async () => {
    const addr = (point.address || "").trim();
    if (pinned || addr.length < 5) return;
    setBusy(true);
    try {
      const { data } = await api.post("/attendance/geocode", { address: addr });
      onChange({ lat: data.lat, lng: data.lng });
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };

  const useGps = () => {
    if (!navigator.geolocation) { toast.error("Location is not supported in this browser"); return; }
    const id = toast.loading("Detecting current GPS coordinates…");
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = p.coords.latitude, lng = p.coords.longitude;
        try {
          const { data } = await api.post("/attendance/reverse", { lat, lng });
          onChange({ address: data.address, lat, lng });
          toast.success("GPS location and address detected", { id });
        } catch (_) {
          onChange({ lat, lng });
          toast.message("GPS coordinates updated", { id });
        }
      },
      () => toast.error("Could not read GPS location. Allow location permission.", { id }),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  return (
    <div className="rounded-2xl border border-mv-border bg-mv-surface2/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${pinned ? dot : "bg-slate-300"}`} />
          {nameEditable ? (
            <input value={point.name || ""} onChange={(e) => onChange({ name: e.target.value })}
              className="h-8 px-2 rounded-lg border border-mv-border bg-white text-xs font-bold uppercase tracking-wide w-44" />
          ) : (
            <span className="text-xs font-bold uppercase tracking-wide text-slate-700">{title}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {pinned && (
            <a href={`https://www.google.com/maps?q=${point.lat},${point.lng}`} target="_blank" rel="noreferrer"
              className="text-xs font-semibold text-red-600 hover:underline inline-flex items-center gap-1">View Pin <ExternalLink className="w-3 h-3" /></a>
          )}
          {onRemove && (
            <button onClick={onRemove} className="p-1.5 text-slate-400 hover:text-red-600" title="Remove"><Trash2 className="w-4 h-4" /></button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
        <div className="relative">
          <label className="mv-label">Address (Google Maps Search)</label>
          <input value={point.address || ""} placeholder="Type the address, landmark, Google Maps link or lat, lng…"
            onChange={(e) => onAddress(e.target.value)} onBlur={() => setTimeout(findCoords, 200)}
            onKeyDown={(e) => e.key === "Enter" && findCoords()}
            className="mt-1.5 w-full h-10 px-3 rounded-xl bg-white border border-mv-border outline-none focus:border-mv-primary text-sm" />
          {sugg.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl border border-mv-border bg-white shadow-lg overflow-hidden">
              {sugg.map((s, i) => (
                <button key={i} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-0">{s.description}</button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mv-label">Radius (m)</label>
            <input type="number" min="10" value={point.radius_m ?? 40} onChange={(e) => onChange({ radius_m: e.target.value })}
              className="mt-1.5 w-24 h-10 px-3 rounded-xl bg-white border border-mv-border outline-none focus:border-mv-primary text-sm" />
          </div>
          <div className="flex rounded-xl border border-mv-border overflow-hidden h-10 bg-white">
            {[[40, "40m Door"], [80, "80m"], [150, "150m"]].map(([v, l]) => (
              <button key={v} type="button" onClick={() => onChange({ radius_m: v })}
                className={`px-3 text-xs font-semibold ${Number(point.radius_m) === v ? "bg-red-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{l}</button>
            ))}
          </div>
          <button type="button" onClick={useGps}
            className="h-10 px-3 rounded-xl border border-mv-border bg-white text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5">
            <Navigation className="w-3.5 h-3.5 text-red-600" /> Use My GPS
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        {busy ? (
          <span className="text-slate-500 inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Finding exact pin…</span>
        ) : pinned ? (
          <span className="text-slate-600 inline-flex items-center gap-2 flex-wrap">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Exact pin verified:
            <code className="px-2 py-0.5 rounded-md bg-white border border-mv-border">{Number(point.lat).toFixed(6)}, {Number(point.lng).toFixed(6)}</code>
          </span>
        ) : (
          <span className="text-amber-600 font-medium">No pin yet. Pick a suggestion, press Enter, or tap Use My GPS.</span>
        )}
        {pinned && (
          <a href={`https://www.google.com/maps/@${point.lat},${point.lng},19z/data=!3m1!1e3`} target="_blank" rel="noreferrer"
            className="font-semibold text-red-600 hover:underline inline-flex items-center gap-1">Verify on Satellite Map <ExternalLink className="w-3 h-3" /></a>
        )}
      </div>
    </div>
  );
}

export default function AttendanceSettings() {
  const [enabled, setEnabled] = useState(true);
  const [rows, setRows] = useState(null);       // { [city]: { main, branches, hubs } }
  const [cities, setCities] = useState([]);
  const [saving, setSaving] = useState({});

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/attendance/settings");
      setEnabled(!!data.geofence_enabled);
      const m = {};
      data.locations.forEach((l) => {
        m[l.city] = {
          main: { address: l.address || "", lat: l.lat ?? "", lng: l.lng ?? "", radius_m: l.radius_m ?? 40 },
          branches: (l.branches || []).map((b) => ({ ...b, lat: b.lat ?? "", lng: b.lng ?? "" })),
          hubs: (l.hubs || []).map((h) => ({ ...h, lat: h.lat ?? "", lng: h.lng ?? "" })),
        };
      });
      setCities(data.locations.map((l) => l.city));
      setRows(m);
    } catch (e) { toast.error(errMsg(e)); setRows({}); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const patchMain = (city, patch) => setRows((r) => ({ ...r, [city]: { ...r[city], main: { ...r[city].main, ...patch } } }));
  const patchList = (city, key, idx, patch) => setRows((r) => {
    const list = [...r[city][key]];
    list[idx] = { ...list[idx], ...patch };
    return { ...r, [city]: { ...r[city], [key]: list } };
  });
  const addPoint = (city, key) => setRows((r) => {
    const label = key === "branches" ? "Office" : "Hub";
    const n = r[city][key].length + (key === "branches" ? 2 : 1);
    return { ...r, [city]: { ...r[city], [key]: [...r[city][key], { name: `${label} ${n}`, address: "", lat: "", lng: "", radius_m: 40 }] } };
  });
  const removePoint = (city, key, idx) => setRows((r) => ({
    ...r, [city]: { ...r[city], [key]: r[city][key].filter((_, i) => i !== idx) },
  }));

  const toggle = async (checked) => {
    try {
      await api.put("/attendance/settings", { geofence_enabled: checked });
      setEnabled(checked);
      toast.success(checked ? "Entrance-only check-in is ACTIVE" : "Geofence is OFF (drivers can check in from anywhere)");
    } catch (e) { toast.error(errMsg(e)); }
  };

  const num = (v) => (v === "" || v == null ? null : Number(v));
  const save = async (city) => {
    const r = rows[city];
    const pts = [r.main, ...r.branches, ...r.hubs];
    if (!pts.some(hasPin)) { toast.error("Set at least one office or hub location (pin) before saving."); return; }
    const unpinned = pts.find((p) => (p.address || "").trim() && !hasPin(p));
    if (unpinned) { toast.error("One of the addresses has no pin yet. Pick a suggestion or press Enter to find it."); return; }
    setSaving((s) => ({ ...s, [city]: true }));
    try {
      const clean = (p) => ({ name: (p.name || "").trim(), address: (p.address || "").trim(), lat: num(p.lat), lng: num(p.lng), radius_m: Number(p.radius_m) || 40 });
      await api.put(`/attendance/locations/${encodeURIComponent(city)}`, {
        address: (r.main.address || "").trim(), lat: num(r.main.lat), lng: num(r.main.lng), radius_m: Number(r.main.radius_m) || 40,
        branches: r.branches.map(clean), hubs: r.hubs.map(clean),
      });
      toast.success(`${city} check-in locations saved`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    setSaving((s) => ({ ...s, [city]: false }));
  };

  if (!rows) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-mv-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="attendance-settings">
      <div className="mv-card p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-extrabold text-slate-900 text-lg">Driver Check-in (Selfie + Location)</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Drivers can <strong>check in only when they are physically inside</strong> one of the offices or hubs saved below.
            Add the office / hub address for each city.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-mv-border px-4 py-3">
          <div>
            <div className="mv-label">Geofence policy</div>
            <div className={`text-sm font-bold ${enabled ? "text-emerald-600" : "text-slate-500"}`}>
              {enabled ? "Strict Entrance-Only (ACTIVE)" : "Off (Anywhere Allowed)"}
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={toggle} />
        </div>
      </div>

      {cities.map((city) => {
        const r = rows[city];
        const total = [r.main, ...r.branches, ...r.hubs].filter(hasPin).length;
        return (
          <div key={city} className="mv-card p-5 space-y-4" data-testid={`att-city-${city}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-red-600 text-white font-bold flex items-center justify-center">{city.slice(0, 2).toUpperCase()}</div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-slate-900 text-lg">{city}</h3>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${total ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {total ? `${total} Check-in Point${total > 1 ? "s" : ""} Active` : "Not configured"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">Drivers can check in at any configured office or hub below.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => addPoint(city, "branches")} className="h-9 px-3 rounded-full border border-mv-border bg-white text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Another Office</button>
                <button onClick={() => addPoint(city, "hubs")} className="h-9 px-3 rounded-full border border-mv-border bg-white text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Hub</button>
              </div>
            </div>

            <PointEditor title="Main Office (Primary)" dot="bg-emerald-500" point={r.main} onChange={(p) => patchMain(city, p)} />
            {r.branches.map((b, i) => (
              <PointEditor key={`b${i}`} nameEditable dot="bg-emerald-500" point={b}
                onChange={(p) => patchList(city, "branches", i, p)} onRemove={() => removePoint(city, "branches", i)} />
            ))}
            {r.hubs.map((h, i) => (
              <PointEditor key={`h${i}`} nameEditable dot="bg-amber-500" point={h}
                onChange={(p) => patchList(city, "hubs", i, p)} onRemove={() => removePoint(city, "hubs", i)} />
            ))}

            <div className="flex justify-end">
              <button onClick={() => save(city)} disabled={saving[city]}
                className="h-10 px-5 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold inline-flex items-center gap-2 shadow-md disabled:opacity-60">
                {saving[city] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save All {city} Check-in Locations
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
