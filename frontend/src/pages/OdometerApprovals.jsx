import { useState, useEffect, useCallback } from "react";
import api from "../lib/api";
import { Image as ImageIcon, Search } from "lucide-react";
import { inr } from "../lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { useApp, CITIES } from "../context/AppContext";

export default function OdometerApprovals() {
  const { city: gCity } = useApp();
  const [city, setCity] = useState(gCity === "all" ? "all" : gCity);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [imgModal, setImgModal] = useState(null);

  const [dateFilter, setDateFilter] = useState("this_month");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const p = city !== "all" ? { city } : {};
      if (search) p.driver_name = search;
      
      if (dateFilter === "today") {
        const today = new Date().toISOString().split('T')[0];
        p.from_date = today;
        p.to_date = today;
      } else if (dateFilter === "this_week") {
        const today = new Date();
        const firstDay = new Date(today.setDate(today.getDate() - today.getDay()));
        const lastDay = new Date(today.setDate(today.getDate() - today.getDay() + 6));
        p.from_date = firstDay.toISOString().split('T')[0];
        p.to_date = lastDay.toISOString().split('T')[0];
      } else if (dateFilter === "this_month") {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        p.from_date = firstDay.toISOString().split('T')[0];
        p.to_date = lastDay.toISOString().split('T')[0];
      } else if (dateFilter === "custom") {
        if (fromDate) p.from_date = fromDate;
        if (toDate) p.to_date = toDate;
      }

      const { data } = await api.get("/admin/odometer", { params: p });
      setLogs(data.logs || data); // handle if data is array or {logs: []}
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [city, dateFilter, fromDate, toDate, search]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="p-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Odometer Logs</h1>
          <p className="text-slate-500">Monitor daily vehicle usage and limits</p>
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

          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-40 h-10 rounded-xl bg-white border-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white rounded-xl border-slate-200 text-slate-900">
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="this_week">This Week</SelectItem>
              <SelectItem value="this_month">This Month</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>

          {dateFilter === "custom" && (
            <div className="flex items-center gap-2">
              <input 
                type="date" 
                value={fromDate} 
                onChange={e => setFromDate(e.target.value)}
                className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm focus:border-indigo-500 outline-none" 
              />
              <span className="text-slate-500">to</span>
              <input 
                type="date" 
                value={toDate} 
                onChange={e => setToDate(e.target.value)}
                className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm focus:border-indigo-500 outline-none" 
              />
            </div>
          )}

          <div className="flex items-center relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3" />
            <input 
              type="text" 
              placeholder="Search driver name..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-10 pl-9 pr-4 rounded-xl border border-slate-200 bg-white w-full md:w-64 focus:border-indigo-500 outline-none transition-colors text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[1100px]">
          <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
            <tr>
              <th className="px-3 py-4 whitespace-nowrap">Driver</th>
              <th className="px-3 py-4 whitespace-nowrap">Date</th>
              <th className="px-3 py-4 whitespace-nowrap">Package</th>
              <th className="px-3 py-4 whitespace-nowrap text-amber-600">Daily Rent</th>
              <th className="px-3 py-4 whitespace-nowrap">Start KM</th>
              <th className="px-3 py-4 whitespace-nowrap">End KM</th>
              <th className="px-3 py-4 whitespace-nowrap text-indigo-600">Today Driven</th>
              <th className="px-3 py-4 whitespace-nowrap">Daily Limit</th>
              <th className="px-3 py-4 whitespace-nowrap text-red-500">Extra KM</th>
              <th className="px-3 py-4 whitespace-nowrap text-center">Monthly KM</th>
              <th className="px-3 py-4 whitespace-nowrap text-center">Status</th>
              <th className="px-3 py-4 whitespace-nowrap text-center">Photos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan="12" className="text-center py-10 text-slate-500">Loading...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan="12" className="text-center py-10 text-slate-500">No odometer logs found</td></tr>
            ) : (
              logs.map(log => {
                const limit = log.limit_kms || 0;
                const percent = Math.min(100, Math.max(0, limit ? (log.monthly_kms / limit) * 100 : 0));
                const overLimit = limit > 0 && log.monthly_kms > limit;
                const driven = log.driven_today || 0;
                const dailyLimit = log.daily_limit_km || 0;
                const extraKm = log.extra_km || 0;
                const extraCharge = log.extra_km_charge || 0;
                const withinLimit = dailyLimit > 0 && driven <= dailyLimit;
                const overDaily = extraKm > 0;

                return (
                  <tr key={log._id} className="hover:bg-slate-50 transition-colors">
                    {/* Driver */}
                    <td className="px-3 py-4 font-bold text-slate-900 whitespace-nowrap">{log.driver_name}</td>
                    
                    {/* Date */}
                    <td className="px-3 py-4 text-slate-500 whitespace-nowrap">{log.date}</td>
                    
                    {/* Package */}
                    <td className="px-3 py-4 whitespace-nowrap">
                      <span className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full whitespace-nowrap">
                        {log.package_name || "—"}
                      </span>
                    </td>
                    
                    {/* Daily Rent */}
                    <td className="px-3 py-4 font-bold text-amber-600 whitespace-nowrap">
                      {log.daily_rent ? inr(log.daily_rent) : "—"}
                    </td>
                    
                    {/* Start KM */}
                    <td className="px-3 py-4 font-mono text-slate-700 whitespace-nowrap">{log.start_reading ? `${log.start_reading} km` : "—"}</td>
                    
                    {/* End KM */}
                    <td className="px-3 py-4 font-mono text-slate-700 whitespace-nowrap">{log.end_reading ? `${log.end_reading} km` : "—"}</td>
                    
                    {/* Today Driven */}
                    <td className="px-3 py-4 whitespace-nowrap">
                      {driven > 0 ? (
                        <div>
                          <span className={`font-bold text-base ${overDaily ? "text-red-600" : "text-indigo-600"}`}>
                            {driven} km
                          </span>
                        </div>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    
                    {/* Daily Limit */}
                    <td className="px-3 py-4 whitespace-nowrap">
                      <span className="text-slate-600 font-medium">{dailyLimit > 0 ? `${dailyLimit} km` : "—"}</span>
                    </td>
                    
                    {/* Extra KM */}
                    <td className="px-3 py-4 whitespace-nowrap">
                      {driven > 0 ? (
                        extraKm > 0 ? (
                          <div>
                            <div className="font-bold text-red-600">+{extraKm} km</div>
                            <div className="text-xs text-red-400">{inr(extraCharge)} extra</div>
                            <div className="text-[10px] text-slate-400">Reduces monthly KM + billed extra</div>
                          </div>
                        ) : (
                          <div>
                            <div className="font-semibold text-emerald-600">Within Limit</div>
                            <div className="text-[10px] text-slate-400">No overage</div>
                          </div>
                        )
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    
                    {/* Monthly KM */}
                    <td className="px-3 py-4 whitespace-nowrap">
                      <div className="flex flex-col items-center">
                        <span className={`font-bold ${overLimit ? "text-red-600" : "text-slate-900"}`}>
                          {log.monthly_kms} / {limit} km
                        </span>
                        <div className="text-[10px] text-slate-400 mb-1">All KM incl. extra counted</div>
                        <div className="w-28 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${overLimit ? "bg-red-500" : percent > 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    
                    {/* Status */}
                    <td className="px-3 py-4 text-center whitespace-nowrap">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${log.status === "active" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {log.status === "active" ? "In Progress" : "Completed"}
                      </span>
                    </td>
                    
                    {/* Photos */}
                    <td className="px-3 py-4 text-center whitespace-nowrap">
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => setImgModal(log.start_image_url || log.image_url)}
                          className="p-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg inline-flex"
                          title="View Start Photo"
                        >
                          <ImageIcon className="w-4 h-4" />
                        </button>
                        {log.end_image_url && (
                          <button
                            onClick={() => setImgModal(log.end_image_url)}
                            className="p-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg inline-flex"
                            title="View End Photo"
                          >
                            <ImageIcon className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {imgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-slate-900/80 backdrop-blur-sm" onClick={() => setImgModal(null)}>
          <img
            src={`http://localhost:8000${imgModal}`}
            alt="Odometer"
            className="max-w-full max-h-[90vh] rounded-2xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
