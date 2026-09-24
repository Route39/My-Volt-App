import { useEffect, useState, useCallback, useMemo } from "react";
import api from "../lib/api";
import { useApp, CITIES } from "../context/AppContext";
import { inr } from "../lib/format";
import { Loader2, ArrowUpRight, ArrowDownRight, AlertCircle, Check, Search } from "lucide-react";
import { PageHeader } from "../components/common/Page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";

export default function DailyCollection() {
  const { city: gCity } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState(gCity === "all" ? "all" : gCity);
  
  const [dateFilter, setDateFilter] = useState("today");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
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
      
      const { data } = await api.get("/admin/daily-collection", { params: p });
      setItems(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [city, dateFilter, fromDate, toDate, search]);

  useEffect(() => { load(); }, [load]);

  const totalRevenue = useMemo(() => items.reduce((acc, it) => acc + (it.total_charge ?? it.daily_rate), 0), [items]);
  const totalSettled = useMemo(() => items.reduce((acc, it) => acc + it.today_paid, 0), [items]);
  const totalUnsettled = totalRevenue - totalSettled;

  return (
    <div>
      <PageHeader title="Daily Collection" subtitle="Finance and cash flow control center" />

      {/* Controls */}
      <div className="flex flex-col xl:flex-row justify-between gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="w-40 h-10 rounded-xl bg-mv-surface border-mv-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-mv-surface rounded-xl border-mv-border text-mv-text">
              <SelectItem value="all">All Cities</SelectItem>
              {CITIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-40 h-10 rounded-xl bg-mv-surface border-mv-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-mv-surface rounded-xl border-mv-border text-mv-text">
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
                className="h-10 px-3 rounded-xl border border-mv-border bg-mv-surface text-sm focus:border-mv-primary outline-none" 
              />
              <span className="text-mv-dim">to</span>
              <input 
                type="date" 
                value={toDate} 
                onChange={e => setToDate(e.target.value)}
                className="h-10 px-3 rounded-xl border border-mv-border bg-mv-surface text-sm focus:border-mv-primary outline-none" 
              />
            </div>
          )}
        </div>
        <div className="flex items-center relative">
          <Search className="w-4 h-4 text-mv-dim absolute left-3" />
          <input 
            type="text" 
            placeholder="Search driver name..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-10 pl-9 pr-4 rounded-xl border border-mv-border bg-mv-surface w-full xl:w-64 focus:border-mv-primary outline-none transition-colors text-sm"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="mv-card p-5 relative overflow-hidden mv-rise">
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Gross Revenue {city !== "all" ? `(${city})` : ""}</div>
          <div className="text-3xl font-display font-bold text-mv-text mb-1">{inr(totalRevenue)}</div>
          <div className="text-xs text-mv-dim">Expected daily collection</div>
        </div>
        <div className="mv-card p-5 relative overflow-hidden mv-rise" style={{ animationDelay: "50ms" }}>
          <div className="absolute top-0 right-0 p-4 opacity-10">
             <ArrowUpRight className="w-16 h-16 text-emerald-500" />
          </div>
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Total Settled</div>
          <div className="text-3xl font-display font-bold text-emerald-400 mb-1">{inr(totalSettled)}</div>
          <div className="text-xs text-mv-dim">Driver rent collected today</div>
        </div>
        <div className="mv-card p-5 relative overflow-hidden mv-rise" style={{ animationDelay: "100ms" }}>
           <div className="absolute top-0 right-0 p-4 opacity-10">
             <ArrowDownRight className="w-16 h-16 text-rose-500" />
          </div>
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Total Unsettled</div>
          <div className="text-3xl font-display font-bold text-rose-400 mb-1">{inr(totalUnsettled)}</div>
          <div className="text-xs text-mv-dim">Revenue pending settlement</div>
        </div>
      </div>

      {/* Table Section */}
      <div className="mv-card overflow-hidden overflow-x-auto mv-rise" style={{ animationDelay: "150ms" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mv-border text-left mv-label">
              <th className="px-5 py-4">Driver</th>
              <th className="px-5 py-4">Date</th>
              <th className="px-5 py-4">Vehicle</th>
              <th className="px-5 py-4">Start Meter</th>
              <th className="px-5 py-4">End Meter</th>
              <th className="px-5 py-4">Total KM</th>
              <th className="px-5 py-4 text-amber-500">Revenue</th>
              <th className="px-5 py-4 text-red-500">Extra KM</th>
              <th className="px-5 py-4">Payment Status</th>
              <th className="px-5 py-4">Deposit</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="9" className="px-5 py-16 text-center text-mv-muted">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <Loader2 className="w-6 h-6 animate-spin text-mv-primary" />
                    Loading collection data...
                  </div>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan="9" className="px-5 py-16 text-center">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <div className="w-12 h-12 rounded-full bg-mv-elevated flex items-center justify-center mb-2">
                      <AlertCircle className="w-5 h-5 text-mv-dim" />
                    </div>
                    <span className="text-mv-text font-medium">No active rentals found {city !== "all" ? `for ${city}` : ""}</span>
                    <span className="text-mv-dim text-xs">Activate a rental to see daily collections.</span>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((it) => {
                return (
                  <tr key={it.id} className="border-b border-mv-border/50 hover:bg-mv-elevated transition-colors">
                    <td className="px-5 py-4 font-medium flex items-center gap-3">
                      <Avatar className="w-8 h-8"><AvatarImage src={it.driver_avatar} /><AvatarFallback className="text-[10px] bg-mv-elevated">{it.driver_name?.[0]}</AvatarFallback></Avatar>
                      {it.driver_name}
                    </td>
                    <td className="px-5 py-4 text-mv-muted whitespace-nowrap">{it.date || "—"}</td>
                    <td className="px-5 py-4">
                      <div className="font-display font-semibold text-mv-text">{it.vehicle_code || "—"}</div>
                      {it.vehicle_reg && <div className="text-xs text-mv-muted font-mono">{it.vehicle_reg}</div>}
                    </td>
                    <td className="px-5 py-4 text-mv-muted">{it.start_meter || "—"}</td>
                    <td className="px-5 py-4 text-mv-muted">{it.end_meter || "—"}</td>
                    <td className="px-5 py-4 font-medium">{it.total_km || "—"} km</td>
                    <td className="px-5 py-4 font-display font-bold">
                      <div className="text-amber-500/90">{inr(it.daily_rate)}</div>
                      {(it.extra_km_charge > 0) && (
                        <div className="text-[11px] text-red-500 font-semibold">+{inr(it.extra_km_charge)} extra</div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {(it.extra_km > 0) ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 border border-red-200 text-red-600 text-xs font-bold">+{it.extra_km} km</span>
                          <span className="text-[10px] text-red-500">@ ₹{it.overage_per_km}/km</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-emerald-600 font-semibold">Within Limit</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {it.daily_status === "paid" ? (
                        <div className="flex flex-col gap-1 mt-1 mb-1">
                          <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 text-xs font-bold tracking-wide border border-emerald-200 shadow-sm">
                            <Check className="w-3.5 h-3.5" /> PAID
                            {it.payment_method === "razorpay" && <span className="ml-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[9px] uppercase tracking-wider border border-indigo-100">Razorpay</span>}
                            {it.payment_method === "cash" && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[9px] uppercase tracking-wider border border-amber-100">Cash</span>}
                          </div>
                          {it.transaction_id && (
                            <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200 mt-0.5">
                              TXN {it.transaction_id}
                            </div>
                          )}
                          {it.paid_on && it.paid_on !== it.date && (
                            <div className="text-[10px] font-semibold text-slate-400">Paid on {it.paid_on}</div>
                          )}
                        </div>
                      ) : (
                        <div className="inline-flex flex-col gap-0.5">
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 text-red-500 text-xs font-bold tracking-wide">
                            NOT PAID
                          </div>
                          <span className="text-xs font-bold text-red-500/80 ml-1">Due: {inr((it.total_charge ?? it.daily_rate) - it.today_paid)}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 font-display font-bold flex items-center gap-1 text-slate-500">
                      {inr(it.deposit_paid)} <span className="text-xs text-mv-muted font-sans font-normal">/ {inr(it.deposit)}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
