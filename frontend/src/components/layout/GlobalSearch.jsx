import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Car, User, KeyRound, Wrench } from "lucide-react";
import api from "../../lib/api";

const FLEET_GROUPS = [
  { key: "vehicles", label: "Vehicles", icon: Car, render: (v) => ({ t: v.vehicle_number, s: `${v.registration_number} · ${v.city}`, path: `/fleet/${v.id}` }) },
  { key: "drivers", label: "Drivers", icon: User, render: (d) => ({ t: d.name, s: `${d.phone} · ${d.city}`, path: `/drivers/${d.id}` }) },
  { key: "rentals", label: "Rentals", icon: KeyRound, render: (r) => ({ t: r.rental_code, s: `${r.driver_name} · ${r.vehicle_number}`, path: `/rentals/${r.id}` }) },
  { key: "service_requests", label: "Service Requests", icon: Wrench, render: (s) => ({ t: s.code, s: `${s.vehicle_number} · ${s.issue_type}`, path: `/service-requests` }) },
];

export default function GlobalSearch({ open, setOpen }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const groups = FLEET_GROUPS;
  const endpoint = "/search";
  const inputRef = useRef();
  const timer = useRef();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQ(""); setRes(null); }
  }, [open]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!q.trim()) { setRes(null); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const { data } = await api.get(endpoint, { params: { q } });
        setRes(data);
      } catch {} finally { setLoading(false); }
    }, 220);
  }, [q]);

  if (!open) return null;

  const go = (path) => { setOpen(false); nav(path); };
  const hasResults = res && groups.some((g) => (res[g.key] || []).length);

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4"
         onClick={() => setOpen(false)} data-testid="global-search-overlay">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm mv-fade" />
      <div className="relative w-full max-w-2xl mv-card glass overflow-hidden mv-rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 border-b border-mv-border">
          <Search className="w-5 h-5 text-mv-dim" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
                 data-testid="global-search-input"
                 placeholder="Search vehicles, drivers, rentals, service requests…"
                 className="flex-1 bg-transparent py-4 outline-none text-mv-text placeholder:text-mv-dim" />
          <kbd className="text-[10px] text-mv-dim border border-mv-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {loading && <div className="p-4 text-sm text-mv-dim">Searching…</div>}
          {!loading && q && !hasResults && <div className="p-6 text-sm text-mv-dim text-center">No results for “{q}”.</div>}
          {!q && <div className="p-6 text-sm text-mv-dim text-center">Type to search across your fleet.</div>}
          {hasResults && groups.map((g) => {
            const items = res[g.key] || [];
            if (!items.length) return null;
            const Icon = g.icon;
            return (
              <div key={g.key} className="mb-2">
                <div className="mv-label px-3 py-1.5">{g.label}</div>
                {items.map((it) => {
                  const r = g.render(it);
                  return (
                    <button key={it.id} onClick={() => go(r.path)}
                            data-testid={`search-result-${it.id}`}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-mv-elevated text-left transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-mv-surface2 border border-mv-border flex items-center justify-center">
                        <Icon className="w-4 h-4 text-mv-muted" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-mv-text truncate">{r.t}</div>
                        <div className="text-xs text-mv-dim truncate">{r.s}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
