import { useState, useEffect, useCallback } from "react";
import api from "../lib/api";
import { Check, X, MapPin, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useApp, CITIES } from "../context/AppContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

export default function KycApprovals() {
  const { city: gCity } = useApp();
  const [city, setCity] = useState(gCity === "all" ? "all" : gCity);
  const [search, setSearch] = useState("");
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = city !== "all" ? { city } : {};
      if (search) p.driver_name = search;
      
      const { data } = await api.get("/admin/kyc/pending", { params: p });
      setDrivers(data);
    } catch {
      toast.error("Failed to load pending KYC");
    } finally {
      setLoading(false);
    }
  }, [city, search]);

  useEffect(() => { load(); }, [load]);

  const action = async (id, type) => {
    try {
      await api.post(`/admin/kyc/${id}/${type}`);
      toast.success(`KYC ${type}d successfully`);
      setSelected(null);
      load();
    } catch {
      toast.error(`Failed to ${type} KYC`);
    }
  };

  if (loading) return <div className="flex justify-center p-20"><Loader2 className="w-8 h-8 animate-spin text-slate-300" /></div>;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900">KYC Approvals</h1>
          <p className="text-slate-500 mt-1">Review and approve driver KYC documents.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="w-40 h-10 rounded-xl bg-white border-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white rounded-xl border-slate-200 text-slate-900">
              <SelectItem value="all">All Cities</SelectItem>
              {CITIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search driver..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 h-10 rounded-xl bg-white border border-slate-200 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 w-48 transition-all"
            />
          </div>
        </div>
      </div>

      {drivers.length === 0 ? (
        <div className="text-center py-32 bg-white rounded-3xl border border-slate-100 shadow-sm">
          <Check className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900">All caught up!</h2>
          <p className="text-slate-500 mt-1">No pending KYC approvals at the moment.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {drivers.map(d => (
            <div key={d.id} className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelected(d)}>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center font-bold text-lg">
                  {d.name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">{d.name}</h3>
                  <p className="text-sm text-slate-500">{d.phone}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                <MapPin className="w-4 h-4" /> 
                {d.location?.lat ? `${parseFloat(d.location.lat).toFixed(4)}, ${parseFloat(d.location.lng).toFixed(4)}` : "No location"}
              </div>
              <button className="mt-5 w-full h-10 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-xl transition-colors">
                Review Documents
              </button>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white/90 backdrop-blur-sm z-10">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Review: {selected.name}</h2>
                <p className="text-slate-500 text-sm mt-0.5">{selected.phone}</p>
              </div>
              <button onClick={() => setSelected(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X className="w-6 h-6" /></button>
            </div>
            
            <div className="p-6 grid md:grid-cols-2 gap-6">
              <DocCard title="Driving License (Front)" url={selected.kyc_documents?.dl_front} />
              <DocCard title="Driving License (Back)" url={selected.kyc_documents?.dl_back} />
              <DocCard title="Aadhaar Card" url={selected.kyc_documents?.aadhaar} />
              <DocCard title="PAN Card" url={selected.kyc_documents?.pan} />
              
              <div className="md:col-span-2 rounded-2xl border border-slate-100 p-4 bg-slate-50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h4 className="font-semibold text-slate-900">Current Address</h4>
                  <p className="text-sm text-slate-500 mt-1 max-w-xl">
                    {selected.location?.address || "No address provided."}
                  </p>
                  <p className="text-xs text-slate-400 font-mono mt-1">
                    GPS: {selected.location?.lat}, {selected.location?.lng}
                  </p>
                </div>
                {selected.location?.lat && (
                  <a href={`https://www.google.com/maps/search/?api=1&query=${selected.location.lat},${selected.location.lng}`} target="_blank" rel="noreferrer" className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl hover:border-emerald-500 text-sm font-medium transition-colors">
                    <MapPin className="w-4 h-4 text-emerald-500" /> View on Maps
                  </a>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 flex gap-4 sticky bottom-0 bg-white/90 backdrop-blur-sm">
              <button onClick={() => action(selected.id, "reject")} className="flex-1 h-12 border-2 border-red-500 text-red-600 hover:bg-red-50 font-bold rounded-2xl transition-colors">
                Reject KYC
              </button>
              <button onClick={() => action(selected.id, "approve")} className="flex-1 h-12 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-colors">
                Approve KYC
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocCard({ title, url }) {
  if (!url) return <div className="aspect-video bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 text-sm">Not Provided</div>;
  const fullUrl = (process.env.REACT_APP_BACKEND_URL || "") + url;
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
