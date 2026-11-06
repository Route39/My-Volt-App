import { useEffect, useState, useCallback, useMemo } from "react";
import api from "../lib/api";
import { useApp, CITIES } from "../context/AppContext";
import { inr } from "../lib/format";
import { Loader2, ArrowUpRight, ArrowDownRight, AlertCircle, Check, Search } from "lucide-react";
import { PageHeader } from "../components/common/Page";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { DriverCode } from "../lib/driverCodes";
import { imgUrl } from "../lib/imgUrl";

export default function DailyCollection() {
  const { city: gCity, lockedCity, cities } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState(lockedCity ? (lockedCity === true ? gCity : lockedCity) : (gCity === "all" ? "all" : gCity));
  
  const [dateFilter, setDateFilter] = useState("today");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [pickDate, setPickDate] = useState(todayIST);
  const [pickMonth, setPickMonth] = useState(todayIST.slice(0, 7));
  const [search, setSearch] = useState("");
  const [pkgTab, setPkgTab] = useState("all");   // all | rental | commission | salary

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = city !== "all" ? { city } : {};
      
      if (search) p.driver_name = search;
      
      if (dateFilter === "today") {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        p.from_date = today;
        p.to_date = today;
      } else if (dateFilter === "this_week") {
        // Week = Sunday to Saturday, based on today's date in IST
        const [y, m, d] = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).split("-").map(Number);
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        const firstDay = new Date(Date.UTC(y, m - 1, d - dow));
        const lastDay = new Date(Date.UTC(y, m - 1, d - dow + 6));
        p.from_date = firstDay.toISOString().split("T")[0];
        p.to_date = lastDay.toISOString().split("T")[0];
      } else if (dateFilter === "this_month") {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        p.from_date = ymd(firstDay);
        p.to_date = ymd(lastDay);
      } else if (dateFilter === "date") {
        if (pickDate) {
          p.from_date = pickDate;
          p.to_date = pickDate;
        }
      } else if (dateFilter === "month") {
        if (pickMonth) {
          const [yy, mm] = pickMonth.split("-").map(Number);
          p.from_date = `${pickMonth}-01`;
          p.to_date = new Date(Date.UTC(yy, mm, 0)).toISOString().split("T")[0];
        }
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
  }, [city, dateFilter, fromDate, toDate, pickDate, pickMonth, search]);

  useEffect(() => { load(); }, [load]);

  // Deposit is a ONE-TIME payment per driver, so it is counted once, on the row of the
  // day it was paid. Paid deposits are de-duplicated by transaction id; pending deposits
  // (no txn yet) are de-duplicated per driver and shown on the driver's latest row.
  const { totalRevenue, totalSettled, totalUnsettled, depositRowIds, remainingRowIds } = useMemo(() => {
    let revenue = 0, settled = 0, pendingDeposit = 0;
    const seen = new Set();
    const rowIds = new Set();
    const remIds = new Set();

    for (const it of items) {
      // today's rent is paid by the driver tomorrow, so it is not counted (as pending) in the cards today;
      // only if it has already been paid is it counted. Extra-KM charges are unchanged.
      const _todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      if (it.is_today_row || it.date === _todayIST) {
        const todayRentPaid = it.rent_status === "paid" && it.daily_rate > 0 ? it.daily_rate : 0;
        revenue += ((it.total_charge ?? it.daily_rate) || 0) - (it.daily_rate || 0) + todayRentPaid;
      } else {
        revenue += (it.total_charge ?? it.daily_rate) || 0;
      }
      settled += it.today_paid || 0;

      if (!(it.deposit > 0)) continue;

      // Split (half + half) deposit: total counted once on the day the 1st half was paid,
      // 1st half settled that day, 2nd half settled on the day the remaining amount was paid.
      if (it.deposit_split && (it.deposit_status === "partial" || it.deposit_status === "paid")) {
        if (it.date === it.deposit_first_paid_date && !seen.has(`first:${it.driver_id}`)) {
          seen.add(`first:${it.driver_id}`);
          revenue += it.deposit_first_amount || 0;
          settled += it.deposit_first_amount || 0;
        }
        if (it.deposit_status === "paid" && it.date === it.deposit_second_paid_date && !seen.has(`second:${it.driver_id}`)) {
          seen.add(`second:${it.driver_id}`);
          remIds.add(it.id);
          revenue += it.deposit_second_amount || 0;
          settled += it.deposit_second_amount || 0;
        }
        // 2nd half still pending: added to revenue (as unsettled) only from the next payment date onwards
        if (it.deposit_status === "partial" && it.deposit_next_payment_date && it.date >= it.deposit_next_payment_date && !seen.has(`pending:${it.driver_id}`)) {
          seen.add(`pending:${it.driver_id}`);
          revenue += it.deposit_second_amount || 0;
        }
        continue;
      }
      const isPaid = it.deposit_status === "paid";

      if (isPaid) {
        // only the day it was paid (legacy records without a paid date fall through to the first row)
        if (it.deposit_paid_date && it.deposit_paid_date !== it.date) continue;
        const key = `paid:${it.deposit_transaction_id || it.driver_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rowIds.add(it.id);
        const amt = it.deposit_paid || it.deposit || 0;
        revenue += amt;
        settled += amt;
      } else {
        const key = `pending:${it.driver_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rowIds.add(it.id);
        revenue += it.deposit;
        pendingDeposit += it.deposit;
      }
    }
    return {
      totalRevenue: revenue,
      totalSettled: settled,
      totalUnsettled: revenue - settled,
      depositRowIds: rowIds,
      remainingRowIds: remIds,
    };
  }, [items]);

  // Split (half + half) security deposit: which layout this row's Deposit cell uses
  const depositMode = (it) => {
    if (!it.deposit_split || !(it.deposit > 0)) return null;
    const f = it.deposit_first_paid_date, s = it.deposit_second_paid_date;
    if (!f || it.date < f) return null;
    if (it.deposit_status === "partial") return "partial";
    if (it.deposit_status === "paid" && s) {
      if (it.date < s) return "partial";
      if (it.date === s && remainingRowIds.has(it.id)) return "remaining";
    }
    return null;
  };
  // ---- package tabs + settled / unsettled button ----
  const isPkgTab = pkgTab === "commission" || pkgTab === "salary";
  const rows = items.filter((it) =>
    pkgTab === "all" ? true
    : pkgTab === "rental" ? !(it.package_category === "commission" || it.package_category === "salary")
    : it.package_category === pkgTab);
  // Commission / Salary: the collection paid today is for yesterday, so each row shows yesterday's payment
  const pkgRows = rows.map((x) => ({ ...x, collection: x.prev_collection }));
  // Commission / Salary tabs: total amount paid by the drivers in the rows shown (follows the city / date / search filters)
  const pkgPaidTotal = pkgRows.reduce((s, x) => s + (Number(x.collection?.pay_amount) || 0), 0);

  // Settled / Unsettled button is shown only for Commission / Salary package drivers (not Rental package)
  const settleBtn = (it) => {
    if (it.package_category !== "commission" && it.package_category !== "salary") return null;
    // week-off / paid-leave day: nothing is paid on this day -> show the day's status instead of "-"
    // if (it.rent_status === "week_off") return <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-violet-50 text-violet-600 text-xs font-bold tracking-wide border border-violet-200 shadow-sm">Week-off</span>;
    // if (it.rent_status === "paid_leave") return <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-blue-50 text-blue-600 text-xs font-bold tracking-wide border border-blue-200 shadow-sm">PAID LEAVE</span>;
    // // rental started on this date: the amount is settled the next day -> just "-"
    if (it.rental_start && it.date <= it.rental_start) return <span className="text-slate-400 font-medium">-</span>;
    // yesterday was a week-off / paid-leave day: nothing to settle -> show that status with yesterday's date
    if (it.prev_day_status) return (
      <div className="flex flex-col items-start gap-1">
        {it.prev_day_status === "week_off"
          ? <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-violet-50 text-violet-600 text-xs font-bold tracking-wide border border-violet-200 shadow-sm">Week-off</span>
          : <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-blue-50 text-blue-600 text-xs font-bold tracking-wide border border-blue-200 shadow-sm">PAID LEAVE</span>}
        <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.prev_date}</span>
      </div>
    );
    if (!it.rent_for_date) return <span className="text-slate-400 font-medium">-</span>;
    const pc = it.prev_collection;
    return (
      <div className="flex flex-col items-start gap-1" data-testid={`settle-chip-${it.id}`}>
        {pc ? (
          <>
            <span className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 text-xs font-bold tracking-wide border border-emerald-200 shadow-sm">
              <Check className="w-3.5 h-3.5" /> {isPkgTab
                ? (it.package_category === "commission" ? "Commission paid" : "Total amount paid")
                : <>{it.package_category === "commission" ? "Commission" : "Salary"} paid {inr(pc.pay_amount)}</>}
            </span>
            {!isPkgTab && pc.transaction_id && (
              <span className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200">TXN {pc.transaction_id}</span>
            )}
          </>
        ) : (
          <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-amber-50 text-amber-600 text-xs font-bold tracking-wide border border-amber-200 shadow-sm">Unsettled</span>
        )}
        {/* the day being settled = yesterday */}
        <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.rent_for_date}</span>
      </div>
    );
  };

  // Commission / Salary package drivers pay no daily rent and no deposit
  const isSpecialPkg = (it) => it.package_category === "commission" || it.package_category === "salary";
  const pkgPill = (it) => (
    <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-violet-50 text-violet-600 text-xs font-bold tracking-wide border border-violet-200 shadow-sm">
      {it.package_category === "commission" ? "Commission" : "Salary"}
    </span>
  );
  const qrBadgeCls = "text-[9px] px-1.5 py-0.5 rounded w-max border mt-0.5 font-bold text-blue-600 bg-blue-50 border-blue-200";
  const txnChip = (t, manual) => t ? (
    <>
      <div className={`text-[9px] font-mono px-1.5 py-0.5 rounded w-max border mt-0.5 font-bold ${t.startsWith('QR_') ? 'text-blue-600 bg-blue-50 border-blue-200' : 'text-slate-400 bg-slate-50 border-slate-200'}`}>
        {t.startsWith('QR_') ? 'Paid by QR' : `TXN ${t}`}
      </div>
      {manual && !t.startsWith('QR_') && <div className={qrBadgeCls}>Paid by QR</div>}
    </>
  ) : null;

  return (
    <div>
      <PageHeader title="Daily Collection" subtitle={<>Finance and cash flow control center{isPkgTab && <span className="block mt-1 font-medium text-mv-text" data-testid="pkg-paid-total">Total amount paid - {inr(pkgPaidTotal)}</span>}</>} />

      {/* Package tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="package-tabs">
        {[["all", "All Packages"], ["rental", "Rental Package"], ["commission", "Commission Package"], ["salary", "Salary Package"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setPkgTab(k)} data-testid={`pkg-tab-${k}`}
            className={`h-9 px-4 rounded-full text-sm font-medium transition-colors ${pkgTab === k ? "bg-mv-primary text-white" : "border border-mv-border text-mv-muted hover:bg-mv-elevated"}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-col xl:flex-row justify-between gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-2">
          {!lockedCity && (
            <div className="w-full flex flex-wrap items-center gap-2 mb-1" data-testid="city-tabs">
              {["all", ...cities].map((c) => (
                <button key={c} type="button" onClick={() => setCity(c)}
                  data-testid={`city-tab-${c}`}
                  className={`h-9 px-4 rounded-full text-sm font-medium transition-colors ${city === c ? "bg-mv-primary text-white" : "border border-mv-border text-mv-muted hover:bg-mv-elevated"}`}>
                  {c === "all" ? "All Cities" : c}
                </button>
              ))}
            </div>
          )}
          
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-40 h-10 rounded-xl bg-mv-surface border-mv-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-mv-surface rounded-xl border-mv-border text-mv-text">
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="this_week">This Week</SelectItem>
              <SelectItem value="this_month">This Month</SelectItem>
              <SelectItem value="date">Specific Date</SelectItem>
              <SelectItem value="month">Specific Month</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>

          {dateFilter === "date" && (
            <input
              type="date"
              value={pickDate}
              onChange={e => setPickDate(e.target.value)}
              className="h-10 px-3 rounded-xl border border-mv-border bg-mv-surface text-sm focus:border-mv-primary outline-none"
            />
          )}

          {dateFilter === "month" && (
            <input
              type="month"
              value={pickMonth}
              onChange={e => setPickMonth(e.target.value)}
              className="h-10 px-3 rounded-xl border border-mv-border bg-mv-surface text-sm focus:border-mv-primary outline-none"
            />
          )}

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

      {/* Summary Cards (hidden on the Commission / Salary tabs) */}
      {pkgTab === "rental" && (
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
      )}

      {/* Commission / Salary package tabs: their own table */}
      {isPkgTab && (
        <div className="mv-card overflow-hidden overflow-x-auto mv-rise" style={{ animationDelay: "150ms" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mv-border text-left mv-label">
                <th className="px-5 py-4">Driver</th>
                <th className="px-5 py-4">Date</th>
                <th className="px-5 py-4">Vehicle</th>
                <th className="px-5 py-4">{pkgTab === "commission" ? "Commission %" : "Salary"}</th>
                <th className="px-5 py-4">Total Collected</th>
                <th className="px-5 py-4">{pkgTab === "commission" ? "Commission Amount" : "Salary Paid"}</th>
                <th className="px-5 py-4">Trip Screenshot</th>
                <th className="px-5 py-4">Settled / Unsettled</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" className="px-5 py-16 text-center text-mv-muted">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Loader2 className="w-6 h-6 animate-spin text-mv-primary" />
                      Loading collection data...
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="w-12 h-12 rounded-full bg-mv-elevated flex items-center justify-center mb-2">
                        <AlertCircle className="w-5 h-5 text-mv-dim" />
                      </div>
                      <span className="text-mv-text font-medium">No {pkgTab === "commission" ? "commission" : "salary"} package drivers found {city !== "all" ? `for ${city}` : ""}</span>
                    </div>
                  </td>
                </tr>
              ) : (
                pkgRows.map((it) => (
                  <tr key={it.id} className="border-b border-mv-border/50 hover:bg-mv-elevated transition-colors">
                    <td className="px-5 py-4 font-medium flex items-center gap-3">
                      <Avatar className="w-8 h-8"><AvatarImage src={it.driver_avatar} /><AvatarFallback className="text-[10px] bg-mv-elevated">{it.driver_name?.[0]}</AvatarFallback></Avatar>
                      {it.driver_name} <DriverCode id={it.driver_id} className="block" />
                    </td>
                    <td className="px-5 py-4 text-mv-muted whitespace-nowrap">{it.date || "—"}</td>
                    <td className="px-5 py-4">
                      <div className="font-display font-semibold text-mv-text">{it.vehicle_code || "—"}</div>
                      {it.vehicle_reg && <div className="text-xs text-mv-muted font-mono">{it.vehicle_reg}</div>}
                    </td>
                    <td className="px-5 py-4 font-display font-bold text-amber-500/90">
                      {pkgTab === "commission"
                        ? (it.commission_percent != null ? `${it.commission_percent}%` : "—")
                        : (it.salary_amount != null ? inr(it.salary_amount) : "—")}
                    </td>
                    <td className="px-5 py-4 font-display font-bold">
                      {it.collection ? inr(it.collection.total_collected) : <span className="text-slate-400 font-medium">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      {it.collection ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-emerald-600 font-display font-bold text-sm">{inr(it.collection.pay_amount)}</span>
                          <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 text-xs font-bold tracking-wide border border-emerald-200 shadow-sm">
                            <Check className="w-3.5 h-3.5" /> PAID
                          </div>
                          {it.collection.transaction_id && (
                            <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200 mt-0.5">TXN {it.collection.transaction_id}</div>
                          )}
                        </div>
                      ) : (it.rent_status === "week_off" || it.rent_status === "paid_leave") ? (
                        <span className="text-slate-400 font-medium">—</span>
                      ) : (it.rent_for_date && !(it.rental_start && it.date <= it.rental_start)) ? (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 text-red-500 text-xs font-bold tracking-wide">NOT PAID</div>
                      ) : (
                        <span className="text-slate-400 font-medium">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {it.collection?.screenshot_url ? (
                        <a href={imgUrl(it.collection.screenshot_url)} target="_blank" rel="noreferrer">
                          <img src={imgUrl(it.collection.screenshot_url)} alt="Trip screenshot" className="w-14 h-14 object-cover rounded-lg border border-mv-border" />
                        </a>
                      ) : (
                        <span className="text-slate-400 font-medium">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">{settleBtn(it)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Table Section */}
      {!isPkgTab && (
      <div className="mv-card overflow-hidden overflow-x-auto mv-rise" style={{ animationDelay: "150ms" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mv-border text-left mv-label">
              <th className="px-5 py-4">Driver</th>
              <th className="px-5 py-4">Date</th>
              <th className="px-5 py-4">Vehicle</th>
              {/* <th className="px-5 py-4">Start KM</th>
              <th className="px-5 py-4">End KM</th>
              <th className="px-5 py-4">Total KM</th> */}
              <th className="px-5 py-4 text-amber-500">Revenue</th>
              {/* <th className="px-5 py-4 text-red-500">Extra KM</th> */}
              <th className="px-5 py-4">Daily Rent</th>
              {/* <th className="px-5 py-4">Extra KM Charges</th> */}
              <th className="px-5 py-4">Deposit</th>
              <th className="px-5 py-4">Trip Screenshot</th>
              {pkgTab !== "rental" && <th className="px-5 py-4">Settled / Unsettled</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={pkgTab === "rental" ? 7 : 8} className="px-5 py-16 text-center text-mv-muted">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <Loader2 className="w-6 h-6 animate-spin text-mv-primary" />
                    Loading collection data...
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={pkgTab === "rental" ? 7 : 8} className="px-5 py-16 text-center">
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
              pkgRows.map((it) => {
                return (
                  <tr key={it.id} className="border-b border-mv-border/50 hover:bg-mv-elevated transition-colors">
                    <td className="px-5 py-4 font-medium flex items-center gap-3">
                      <Avatar className="w-8 h-8"><AvatarImage src={it.driver_avatar} /><AvatarFallback className="text-[10px] bg-mv-elevated">{it.driver_name?.[0]}</AvatarFallback></Avatar>
                      {it.driver_name} <DriverCode id={it.driver_id} className="block" />
                    </td>
                    <td className="px-5 py-4 text-mv-muted whitespace-nowrap">{it.date || "—"}</td>
                    <td className="px-5 py-4">
                      <div className="font-display font-semibold text-mv-text">{it.vehicle_code || "—"}</div>
                      {it.vehicle_reg && <div className="text-xs text-mv-muted font-mono">{it.vehicle_reg}</div>}
                    </td>
                    {/* <td className="px-5 py-4 text-mv-muted">{it.start_meter || "—"}</td>
                    <td className="px-5 py-4 text-mv-muted">{it.end_meter || "—"}</td>
                    <td className="px-5 py-4 font-medium">
                      {it.total_km ? `${it.total_km} km` : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">No Trip</span>
                      )}
                    </td> */}
                    <td className="px-5 py-4 font-display font-bold">
                      {isSpecialPkg(it) ? <span className="text-slate-400 font-medium">-</span> : <div className="text-amber-500/90">{inr(it.daily_rate)}</div>}
                      {(it.extra_km_charge > 0) && (
                        <div className="text-[11px] text-red-500 font-semibold">+{inr(it.extra_km_charge)} extra</div>
                      )}
                    </td>
                    {/* <td className="px-5 py-4">
                      {(it.extra_km > 0) ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 border border-red-200 text-red-600 text-xs font-bold">+{it.extra_km} km</span>
                          <span className="text-[10px] text-red-500">@ ₹{it.overage_per_km}/km</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-emerald-600 font-semibold">Within Limit</span>
                      )}
                    </td> */}
                    <td className="px-5 py-4">
                      {isSpecialPkg(it) ? (
                        pkgPill(it)
                      ) : it.rent_status === "week_off" ? (
                        <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-violet-50 text-violet-600 text-xs font-bold tracking-wide border border-violet-200 shadow-sm">
                          Week-off
                        </div>
                      ) : it.rent_status === "paid_leave" ? (
                        <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-blue-50 text-blue-600 text-xs font-bold tracking-wide border border-blue-200 shadow-sm">
                          PAID LEAVE
                        </div>
                      ) : (it.is_today_row || it.prev_rent_row) ? (
                        it.prev_rent ? (
                          <div className="flex flex-col gap-1 mt-1 mb-1">
                            <span className={`font-display font-bold text-sm ${it.prev_rent.status === "paid" ? "text-emerald-600" : "text-red-500/80"}`}>{inr(it.prev_rent.amount)}</span>
                            <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.prev_rent.date}</span>
                            {it.prev_rent.status === "paid" ? (
                              <>
                                <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 text-xs font-bold tracking-wide border border-emerald-200 shadow-sm">
                                  <Check className="w-3.5 h-3.5" /> PAID
                                </div>
                                {it.prev_rent.transaction_id && (
                                  <>
                                    <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200 mt-0.5">
                                      TXN {it.prev_rent.transaction_id}
                                    </div>
                                    {it.prev_rent.manual && <div className={qrBadgeCls}>Paid by QR</div>}
                                  </>
                                )}
                              </>
                            ) : (
                              <div className="inline-flex items-center gap-1.5 w-max px-3 py-1 rounded-full bg-red-500/10 text-red-500 text-xs font-bold tracking-wide">
                                NOT PAID
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 font-medium">-</span>
                        )
                      ) : it.rent_status === "paid" && !(it.rent_amount > 0) ? (
                        <span className="text-slate-400 font-medium">_</span>
                      ) : it.rent_status === "paid" ? (
                        <div className="flex flex-col gap-1 mt-1 mb-1">
                          <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 text-xs font-bold tracking-wide border border-emerald-200 shadow-sm">
                            <Check className="w-3.5 h-3.5" /> PAID
                          </div>
                          {it.rent_for_date && <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.rent_for_date}</span>}
                          <span className="text-emerald-600 font-display font-bold text-sm">{inr(it.rent_amount)}</span>
                          {it.rent_transaction_id && (
                            <>
                              <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200 mt-0.5">
                                TXN {it.rent_transaction_id}
                              </div>
                              {it.rent_manual && <div className={qrBadgeCls}>Paid by QR</div>}
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="inline-flex flex-col gap-0.5">
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 text-red-500 text-xs font-bold tracking-wide">
                            NOT PAID
                          </div>
                          {it.rent_for_date && <span className="text-[11px] text-mv-muted whitespace-nowrap ml-1">{it.rent_for_date}</span>}
                          <span className="text-xs font-bold text-red-500/80 ml-1">{inr(it.rent_amount)}</span>
                        </div>
                      )}
                    </td>
                    {/* <td className="px-5 py-4">
                      {(it.start_meter && !it.end_meter) ? (
                        <span className="text-[11px] text-blue-500/80">Trip in progress</span>
                      ) : (it.extra_km_amount || 0) <= 0 ? (
                        <span className="text-slate-400 font-medium">0</span>
                      ) : it.extra_km_status === "paid" ? (
                        <div className="flex flex-col gap-1 mt-1 mb-1">
                          <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 text-xs font-bold tracking-wide border border-emerald-200 shadow-sm">
                            <Check className="w-3.5 h-3.5" /> PAID
                          </div>
                          <span className="text-emerald-600 font-display font-bold text-sm">{inr(it.extra_km_amount)}</span>
                          {it.extra_km_transaction_id && (
                            <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200 mt-0.5">
                              TXN {it.extra_km_transaction_id}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="inline-flex flex-col gap-0.5">
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 text-red-500 text-xs font-bold tracking-wide">
                            NOT PAID
                          </div>
                          <span className="text-xs font-bold text-red-500/80 ml-1">{inr(it.extra_km_amount)}</span>
                        </div>
                      )}
                    </td> */}
                    <td className="px-5 py-4 font-display font-bold flex flex-col items-start justify-center gap-1">
                      {isSpecialPkg(it) ? (
                        pkgPill(it)
                      ) : depositMode(it) === "partial" ? (
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-center gap-1.5 w-max px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">PARTIALLY PAID - {inr(it.deposit_first_amount)}</span>
                          {txnChip(it.deposit_first_txn, it.deposit_first_manual)}
                          <span className="text-red-500 font-bold text-xs">Pending amount - {inr(it.deposit_second_amount)}</span>
                        </div>
                      ) : depositMode(it) === "remaining" ? (
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-center gap-1.5 w-max px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">REMAINING AMOUNT PAID - {inr(it.deposit_second_amount)}</span>
                          {txnChip(it.deposit_transaction_id, it.deposit_main_manual)}
                          <span className="text-emerald-600 font-bold text-xs">Total amount - {inr(it.deposit)}</span>
                        </div>
                      ) : it.deposit_status !== "paid" && it.deposit > 0 ? (
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold">DEPOSIT PENDING</span>
                          <span className="text-red-500 font-bold">{inr(it.deposit)}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1 mt-1 mb-1">
                          {it.deposit > 0 && it.deposit_status === "paid" && !depositRowIds.has(it.id) ? (
                            <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-slate-50 text-slate-500 text-[10px] font-bold tracking-wide border border-slate-200 shadow-sm">
                              <Check className="w-3 h-3" /> ALREADY PAID
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 text-[10px] font-bold tracking-wide border border-emerald-200 shadow-sm">
                              <Check className="w-3 h-3" /> PAID
                            </div>
                          )}
                          <span className="text-emerald-600 font-bold">{inr(it.deposit_paid || it.deposit || 0)}</span>
                          {it.deposit_transaction_id && depositRowIds.has(it.id) && txnChip(it.deposit_transaction_id, it.deposit_main_manual)}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {it.collection?.screenshot_url ? (
                        <div className="flex flex-col gap-1">
                          <a href={imgUrl(it.collection.screenshot_url)} target="_blank" rel="noreferrer">
                            <img src={imgUrl(it.collection.screenshot_url)} alt="Trip screenshot" className="w-14 h-14 object-cover rounded-lg border border-mv-border" />
                          </a>
                          <span className="text-[11px] text-mv-muted">Collected {inr(it.collection.total_collected)}</span>
                          <span className="text-[11px] font-bold text-emerald-600">Paid {inr(it.collection.pay_amount)}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 font-medium">—</span>
                      )}
                    </td>
                    {pkgTab !== "rental" && <td className="px-5 py-4">{settleBtn(it)}</td>}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
