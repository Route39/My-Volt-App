import { useEffect, useState, useCallback, useMemo, useRef, useLayoutEffect } from "react";
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
// import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "../components/ui/tooltip";   // row hover tooltip (disabled for now)

// A table row that shows a hover tooltip with the details of that row
// Tooltip is disabled for now: this renders a plain row. To turn it back on, restore the import above,
// change the function to `RowTip({ tip, className, children })` and swap the return for the commented block below.
function RowTip({ className, children }) {
  return <tr className={className}>{children}</tr>;
  /*
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <tr className={className}>{children}</tr>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="bg-white text-slate-800 border border-slate-200 text-xs px-3 py-2 rounded-lg shadow-lg">
          <div className="flex flex-col gap-1">
            {tip.map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <span className="text-slate-500 min-w-[70px]">{label}</span>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
  */
}

// ---- Excel-like resizable columns: drag the right edge of a column header ----
const MIN_COL_W = 60;

function useColResize(tabKey) {
  const tableRef = useRef(null);
  const [all, setAll] = useState({});           // { [tab]: { [columnId]: widthPx } }  (each tab keeps its own widths)
  const widths = all[tabKey] || null;           // null = never resized -> normal automatic layout
  const drag = useRef(null);

  // keep the table exactly as wide as its columns, so shrinking one column does not stretch the others
  useLayoutEffect(() => {
    const t = tableRef.current;
    if (!t) return;
    if (!widths) { t.style.width = ""; return; }
    let total = 0;
    t.querySelectorAll("thead th").forEach((th) => { total += widths[th.dataset.col] || th.offsetWidth; });
    t.style.width = `${total}px`;
  });

  const apply = () => {
    const d = drag.current;
    if (!d) return;
    setAll((p) => ({ ...p, [tabKey]: { ...(p[tabKey] || {}), [d.id]: d.w } }));
  };
  const begin = (id, e) => {
    const t = tableRef.current;
    if (!t) return;
    const snap = {};
    t.querySelectorAll("thead th").forEach((th) => { snap[th.dataset.col] = th.offsetWidth; });   // freeze today's widths on the first drag
    const base = widths || snap;
    drag.current = { id, startX: e.clientX, startW: base[id], w: base[id], raf: 0 };
    if (!widths) setAll((p) => ({ ...p, [tabKey]: snap }));
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    d.w = Math.max(MIN_COL_W, Math.round(d.startW + e.clientX - d.startX));
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; apply(); });
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    if (d.raf) cancelAnimationFrame(d.raf);
    apply();
    drag.current = null;
  };
  const reset = () => setAll((p) => { const n = { ...p }; delete n[tabKey]; return n; });   // double-click a handle: back to automatic widths

  return { tableRef, widths, begin, move, end, reset };
}

function ResizableTh({ id, rz, className = "px-5 py-4", children }) {
  const w = rz.widths && rz.widths[id];
  return (
    <th data-col={id} className={`${className} relative`} style={w ? { width: w } : undefined}>
      {children}
      <span
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); rz.begin(id, e); }}
        onPointerMove={rz.move}
        onPointerUp={rz.end}
        onPointerCancel={rz.end}
        onDoubleClick={rz.reset}
        title="Drag to resize · double-click to reset"
        className="group absolute top-0 right-0 z-10 h-full w-4 cursor-col-resize select-none"
        style={{ touchAction: "none" }}
      >
        {/* red line shown on hover, centred in the handle */}
        <span className="absolute top-0 left-1/2 -translate-x-1/2 h-full w-1.5 pointer-events-none group-hover:bg-mv-primary/40" />
        {/* Excel-style column-resize marker: vertical bar with a left and a right arrow (◀|▶) */}
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-mv-muted opacity-60 group-hover:opacity-100 group-hover:text-mv-primary transition-opacity"
        >
          <rect x="7.25" y="1" width="1.5" height="14" rx="0.5" />
          <path d="M6 7.2H3.6V5L0 8l3.6 3V8.8H6z" />
          <path d="M10 7.2h2.4V5L16 8l-3.6 3V8.8H10z" />
        </svg>
      </span>
    </th>
  );
}

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
  const rz = useColResize(pkgTab);               // column widths of the table shown in the current tab
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const reqId = useRef(0);   // id of the latest request, so an old slow response can never overwrite a newer one
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);
  const [pendMap, setPendMap] = useState({});     // driver_id -> row from /pending-payments
  const [pendRows, setPendRows] = useState([]);

  const load = useCallback(async () => {
    const myId = ++reqId.current;
    setLoading(true);
    try {
      const p = city !== "all" ? { city } : {};
      
      if (debouncedSearch) p.driver_name = debouncedSearch;
      
      if (dateFilter === "today") {
        // no dates sent: the server uses its own IST date for "today"
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
      if (myId === reqId.current) setItems(data);
    } catch (e) {
      console.error(e);
    } finally {
      if (myId === reqId.current) setLoading(false);
    }
  }, [city, dateFilter, fromDate, toDate, pickDate, pickMonth, debouncedSearch]);

  useEffect(() => { load(); }, [load]);

  // Same data the Pending Payments page shows: each driver's TOTAL pending rent + deposit
  useEffect(() => {
    let live = true;
    api.get("/pending-payments").then(({ data }) => {
      if (!live) return;
      const m = {};
      (data || []).forEach((r) => { m[String(r.id)] = r; if (r.driver_id) m[String(r.driver_id)] = r; });
      setPendMap(m); setPendRows(data || []);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

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
      const _todayIST = items[0]?.server_today || todayIST;
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
  // A salary driver who paid TODAY's rent today itself (after 9 PM) shows that payment on today's row;
  // the next day's row then shows it as already paid and does not count it again.
  const pkgRows = rows.flatMap((x) => {
    // A salary driver's early payment (today's rent paid today) makes the backend also return a row dated TOMORROW
    // (its "yesterday" has a payment). That future row showed tomorrow's date beside today's payment, so it is dropped:
    // the payment is already shown on the row dated today (the "early" row below).
    if (x.package_category === "salary" && x.date > (x.server_today || todayIST)) return [];
    const prevEarly = !!x.prev_collection?.paid_early;
    const base = { ...x, collection: prevEarly ? null : x.prev_collection };
    if (!x.early_collection) return [base];
    // the early row always carries the date of the payment itself (today)
    const early = { ...x, id: `${x.id}-early`, date: x.early_collection.for_date || x.date, collection: x.early_collection, is_early_row: true };
    return (x.prev_collection && !prevEarly) || x.prev_day_status ? [base, early] : [early];
  });
  // Commission / Salary tabs: total amount paid by the drivers in the rows shown (follows the city / date / search filters)
  const pkgPaidTotal = pkgRows.reduce((s, x) => s + (Number(x.collection?.pay_amount) || 0), 0);

  // Salary-rent of one row, using the same rules as the salary "Daily Rent" cell.
  // Returns { amount, paid }. Amount is 0 when no rent applies on that row.
  const salaryRentOf = (it) => {
    const none = { amount: 0, paid: false };
    if (it.package_category !== "salary") return none;
    // paid today itself (after 9 PM): counted once, on this early row
    if (it.is_early_row) return { amount: Number(it.collection?.pay_amount) || 0, paid: true };
    if (!it.prev_rent_row) return none;
    if (it.rental_start && it.date <= it.rental_start) return none;
    if (it.prev_day_status || !it.rent_for_date) return none;   // week-off / paid-leave / nothing due
    const pc = it.prev_collection;
    if (pc) return pc.paid_early ? none : { amount: Number(pc.pay_amount) || 0, paid: true };  // early payments are already counted on the early row
    return { amount: Number(it.salary_daily_rent) || 0, paid: false };
  };
  // Salary-rent totals of the rows shown (follows the city / date / search filters; rental & commission rows are ignored)
  const salaryTotals = pkgRows.reduce((a, x) => {
    const r = salaryRentOf(x);
    if (r.paid) a.settled += r.amount; else a.unsettled += r.amount;
    return a;
  }, { settled: 0, unsettled: 0 });
  const salaryGross = salaryTotals.settled + salaryTotals.unsettled;

  // Hover tooltip of a row: driver, vehicle, package, date and the rent / salary-rent / commission paid or pending
  // (same rules as the cells of the table)
  const rowTipOf = (it) => {
    const cat = it.package_category;
    let label = "Rent";
    let amount = "—";
    if (cat === "commission" || cat === "salary") {
      label = cat === "commission" ? "Commission" : "Salary rent";
      const s = cat === "salary" ? salaryRentOf(it) : null;
      if (s && s.amount > 0) amount = `${inr(s.amount)} (${s.paid ? "Paid" : "Pending"})`;
      else if (!s && it.collection) amount = `${inr(it.collection.pay_amount)} (Paid)`;
      else if (it.rent_status === "week_off") amount = "Week-off";
      else if (it.rent_status === "paid_leave") amount = "Paid leave";
      else if (!s && it.rent_for_date && !it.prev_collection && !(it.rental_start && it.date <= it.rental_start)) amount = "Pending";
    } else if (it.rent_status === "week_off") amount = "Week-off";
    else if (it.rent_status === "paid_leave") amount = "Paid leave";
    else if (it.is_today_row || it.prev_rent_row) {
      amount = it.prev_rent ? `${inr(it.prev_rent.amount)} (${it.prev_rent.status === "paid" ? "Paid" : "Pending"})` : "—";
    } else if (it.rent_status === "paid") amount = it.rent_amount > 0 ? `${inr(it.rent_amount)} (Paid)` : "—";
    else amount = `${inr(it.rent_amount)} (Pending)`;
    return [
      ["Driver", it.driver_name || "—"],
      ["Vehicle", it.vehicle_reg || it.vehicle_code || "—"],
      ["Package", it.package_name || "—"],
      ["Date", it.date || "—"],
      [label, amount],
    ];
  };

  // Settled / Unsettled button is shown only for Commission / Salary package drivers (not Rental package)
  const settleBtn = (it) => {
    if (it.package_category !== "commission" && it.package_category !== "salary") return null;
    // salary driver paid TODAY's rent today itself (after 9 PM): shown on today's row with the date it is for
    if (it.is_early_row) return (
      <div className="flex flex-col items-start gap-1" data-testid={`settle-chip-${it.id}`}>
        <span className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-green-50 text-green-600 text-xs font-bold tracking-wide border border-green-200 shadow-sm">
          <Check className="w-3.5 h-3.5" /> {isPkgTab ? "Salary-rent paid" : <>Paid {inr(it.collection.pay_amount)}</>}
        </span>
        <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.collection.for_date}</span>
      </div>
    );
    // week-off / paid-leave day: nothing is paid on this day -> show the day's status instead of "-"
    // if (it.rent_status === "week_off") return <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-violet-50 text-violet-600 text-xs font-bold tracking-wide border border-violet-200 shadow-sm">Week-off</span>;
    // if (it.rent_status === "paid_leave") return <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-red-50 text-red-600 text-xs font-bold tracking-wide border border-red-200 shadow-sm">PAID LEAVE</span>;
    // // rental started on this date: the amount is settled the next day -> just "-"
    if (it.rental_start && it.date <= it.rental_start) return <span className="text-slate-400 font-medium">-</span>;
    // yesterday was a week-off / paid-leave day: nothing to settle -> show that status with yesterday's date
    if (it.prev_day_status) return (
      <div className="flex flex-col items-start gap-1">
        {it.prev_day_status === "week_off"
          ? <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-violet-50 text-violet-600 text-xs font-bold tracking-wide border border-violet-200 shadow-sm">Week-off</span>
          : <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-red-50 text-red-600 text-xs font-bold tracking-wide border border-red-200 shadow-sm">PAID LEAVE</span>}
        <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.prev_date}</span>
      </div>
    );
    if (!it.rent_for_date) return <span className="text-slate-400 font-medium">-</span>;
    const pc = it.prev_collection;
    return (
      <div className="flex flex-col items-start gap-1" data-testid={`settle-chip-${it.id}`}>
        {pc ? (
          <>
            <span className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-green-50 text-green-600 text-xs font-bold tracking-wide border border-green-200 shadow-sm">
              <Check className="w-3.5 h-3.5" /> {isPkgTab
                ? (it.package_category === "commission" ? "Commission paid" : "Salary-rent paid")
                : <>{it.package_category === "commission" ? "Commission paid" : "Paid"} {inr(pc.pay_amount)}</>}
            </span>
            {/* TXN box hidden (All Packages tab)
            {!isPkgTab && pc.transaction_id && (
              <span className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200">TXN {pc.transaction_id}</span>
            )}
            */}
          </>
        ) : (
          <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-amber-50 text-amber-600 text-xs font-bold tracking-wide border border-amber-200 shadow-sm">Unsettled</span>
        )}
        {/* the day being settled = yesterday */}
        <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.rent_for_date}</span>
      </div>
    );
  };

  // ---- pending rent / deposit helpers (merged from Pending Payments) ----
  const _special = (it) => it.package_category === "commission" || it.package_category === "salary";
  const pendOf = (it) => pendMap[String(it.driver_id)] || null;
  const pendingRentOf = (it) => (pendOf(it) ? Number(pendOf(it).rent_pending) || 0 : 0);
  const depositOf = (it) => {
    const total = Number(it.deposit) || 0;
    if (pendOf(it) && pendOf(it).deposit_pending != null) {
      const pend = Number(pendOf(it).deposit_pending) || 0;
      return { total, paid: Math.max(0, total - pend), pending: pend };
    }
    let paid = 0;
    if (it.deposit_status === "paid") paid = Number(it.deposit_paid || it.deposit) || 0;
    else if (it.deposit_split && it.deposit_status === "partial") paid = Number(it.deposit_first_amount) || 0;
    else paid = Number(it.deposit_paid) || 0;
    return { total, paid, pending: Math.max(0, total - paid) };
  };
  const stats = (() => {
    const vehicles = new Set(), weekOff = new Set(), depSeen = new Set(), rentPaidSet = new Set(), rentUnpaidSet = new Set();
    let pendRent = 0, pendDep = 0, rentPaidAmt = 0, rentUnpaidAmt = 0;
    for (const it of rows) {
      if (it.rent_status === "week_off") weekOff.add(it.driver_id);
      else if (it.rent_status !== "paid_leave" && (it.vehicle_code || it.vehicle_reg)) vehicles.add(it.vehicle_code || it.vehicle_reg);
      pendRent += pendingRentOf(it);
      if (!_special(it) && it.rent_status !== "week_off" && it.rent_status !== "paid_leave") {
        const _amt = Number(it.rent_amount || it.daily_rate) || 0;
        if (it.rent_status === "paid") { rentPaidSet.add(String(it.driver_id)); rentPaidAmt += _amt; }
        else { rentUnpaidSet.add(String(it.driver_id)); rentUnpaidAmt += _amt; }
      }
      if (!_special(it) && !depSeen.has(it.driver_id)) { depSeen.add(it.driver_id); pendDep += depositOf(it).pending; }
    }
    const seenDrv = new Set(rows.map((x) => String(x.driver_id)));
    const matched = pendRows.filter((r) => seenDrv.has(String(r.id)) || seenDrv.has(String(r.driver_id)));
    // salary drivers' unpaid salary-rent (from /pending-payments) is part of the pending rent too
    const salaryDue = matched.reduce((a, r) => a + (r.package_category === "salary"
      ? Object.values(r.salary_rent_by_date || {}).reduce((s, v) => s + (Number(v) || 0), 0) : 0), 0);
    const dueRent = (pendRows.length ? matched.reduce((a, r) => a + (Number(r.rent_pending) || 0), 0) : pendRent) + salaryDue;
    const dueDep = pendRows.length ? matched.reduce((a, r) => a + (Number(r.deposit_pending) || 0), 0) : pendDep;
    return { running: vehicles.size, rentPaid: rentPaidSet.size, rentUnpaid: rentUnpaidSet.size, rentPaidAmt, rentUnpaidAmt, weekOff: weekOff.size, netDue: dueRent + dueDep, dueRent, dueDep };
  })();

  // Commission / Salary package drivers pay no daily rent and no deposit
  const isSpecialPkg = (it) => it.package_category === "commission" || it.package_category === "salary";
  const pkgPill = (it) => (
    <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-violet-50 text-violet-600 text-xs font-bold tracking-wide border border-violet-200 shadow-sm">
      {it.package_category === "commission" ? "Commission" : "Salary"}
    </span>
  );
  // Salary package drivers: Daily Rent (Salary) is paid the next day -> shown like the rental drivers' Daily Rent (PAID / NOT PAID)
  const salaryRentCell = (it) => {
    if (it.is_early_row) {
      const c = it.collection;
      return (
        <div className="flex flex-col gap-1 mt-1 mb-1">
          <span className="font-display font-bold text-sm text-green-600">{inr(c.pay_amount)}</span>
          <span className="text-[11px] text-mv-muted whitespace-nowrap">{c.for_date}</span>
          <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-green-50 text-green-600 text-xs font-bold tracking-wide border border-green-200 shadow-sm">
            <Check className="w-3.5 h-3.5" /> PAID
          </div>
          {/* TXN box hidden (All Packages tab)
          {c.transaction_id && (
            <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200 mt-0.5">TXN {c.transaction_id}</div>
          )}
          */}
        </div>
      );
    }
    if (it.rental_start && it.date <= it.rental_start) return <span className="text-slate-400 font-medium">—</span>;
    if (it.prev_day_status) return (
      <div className="flex flex-col items-start gap-1">
        {it.prev_day_status === "week_off"
          ? <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-violet-50 text-violet-600 text-xs font-bold tracking-wide border border-violet-200 shadow-sm">Week-off</span>
          : <span className="inline-flex items-center w-max px-2.5 py-1 rounded-md bg-red-50 text-red-600 text-xs font-bold tracking-wide border border-red-200 shadow-sm">PAID LEAVE</span>}
        <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.prev_date}</span>
      </div>
    );
    if (!it.rent_for_date) return <span className="text-slate-400 font-medium">—</span>;
    const pc = it.prev_collection;
    if (pc) return (
      <div className="flex flex-col gap-1 mt-1 mb-1">
        <span className="font-display font-bold text-sm text-green-600">{inr(pc.pay_amount)}</span>
        <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.rent_for_date}</span>
        <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-green-50 text-green-600 text-xs font-bold tracking-wide border border-green-200 shadow-sm">
          <Check className="w-3.5 h-3.5" /> PAID
        </div>
        {/* TXN box hidden (All Packages tab)
        {pc.transaction_id && (
          <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200 mt-0.5">TXN {pc.transaction_id}</div>
        )}
        */}
      </div>
    );
    return (
      <div className="flex flex-col gap-1 mt-1 mb-1">
        <span className="font-display font-bold text-sm text-red-500/80">{Number(it.salary_daily_rent) > 0 ? inr(it.salary_daily_rent) : "—"}</span>
        <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.rent_for_date}</span>
        <div className="inline-flex items-center gap-1.5 w-max px-3 py-1 rounded-full bg-red-500/10 text-red-500 text-xs font-bold tracking-wide">NOT PAID</div>
      </div>
    );
  };
  const qrBadgeCls = "text-[9px] px-1.5 py-0.5 rounded w-max border mt-0.5 font-bold text-green-600 bg-green-50 border-green-200";
  const txnChip = (t, manual) => t ? (
    <>
      {/* TXN box hidden in the Deposit column
      <div className={`text-[9px] font-mono px-1.5 py-0.5 rounded w-max border mt-0.5 font-bold ${t.startsWith('QR_') ? 'text-green-600 bg-green-50 border-green-200' : 'text-slate-400 bg-slate-50 border-slate-200'}`}>
        {t.startsWith('QR_') ? 'Paid by QR' : `TXN ${t}`}
      </div>
      */}
      {t.startsWith('QR_') && <div className={qrBadgeCls}>Paid by QR</div>}
      {manual && !t.startsWith('QR_') && <div className={qrBadgeCls}>Paid by QR</div>}
    </>
  ) : null;

  return (
    <div>
      <PageHeader title="Daily Collection" subtitle={<>Finance and cash flow control center{isPkgTab && <span className="block mt-1 font-medium text-mv-text" data-testid="pkg-paid-total">Total amount paid - {inr(pkgPaidTotal)}</span>}</>} />

      <style>{`
        .mv-col-fixed { table-layout: fixed; }
        .mv-col-fixed th, .mv-col-fixed td { overflow: hidden; text-overflow: ellipsis; }
        /* smaller column-header text (was 11px) */
        .mv-card table thead tr.mv-label th { font-size: 10px; }
      `}</style>

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
          
          <div className="w-full flex flex-wrap items-center gap-2 mb-1" data-testid="date-tabs">
            {[["today", "Today"], ["this_week", "This Week"], ["this_month", "This Month"], ["date", "Specific Date"], ["month", "Specific Month"], ["custom", "Custom Range"]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setDateFilter(k)} data-testid={`date-tab-${k}`}
                className={`h-9 px-4 rounded-full text-sm font-medium transition-colors ${dateFilter === k ? "bg-mv-primary text-white" : "border border-mv-border text-mv-muted hover:bg-mv-elevated"}`}>
                {l}
              </button>
            ))}
          </div>

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

      {!isPkgTab && (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6" data-testid="dc-summary">
        <div className="mv-card p-5">
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Running Vehicles</div>
          <div className="text-3xl font-display font-bold text-mv-text">{stats.running}</div>
        </div>
        <div className="mv-card p-5">
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Rent Paid</div>
          <div className="text-3xl font-display font-bold text-green-600">{stats.rentPaid}</div>
          <div className="text-xs text-mv-dim mt-1">Drivers · <b className="text-green-600">{inr(stats.rentPaidAmt)}</b></div>
        </div>
        <div className="mv-card p-5">
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Rent Unpaid</div>
          <div className="text-3xl font-display font-bold text-amber-500">{stats.rentUnpaid}</div>
          <div className="text-xs text-mv-dim mt-1">Drivers · <b className="text-amber-500">{inr(stats.rentUnpaidAmt)}</b></div>
        </div>
        <div className="mv-card p-5">
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Revenue</div>
          <div className="text-3xl font-display font-bold text-red-500">{inr(totalSettled + salaryTotals.settled)}</div>
          <div className="text-xs text-mv-dim mt-1">Collected</div>
        </div>
        <div className="mv-card p-5">
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Week Off</div>
          <div className="text-3xl font-display font-bold text-violet-500">{stats.weekOff}</div>
          <div className="text-xs text-mv-dim mt-1">Drivers</div>
        </div>
        <div className="mv-card p-5">
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Net Due</div>
          <div className="text-3xl font-display font-bold text-rose-500">{inr(stats.netDue)}</div>
          <div className="text-xs text-mv-dim mt-1">Pending rent + deposit</div>
          <div className="mt-2 pt-2 border-t border-mv-border/60 text-xs flex justify-between gap-2">
            <span className="text-mv-muted">Rent <b className="text-red-500">{inr(stats.dueRent)}</b></span>
            <span className="text-mv-muted">Deposit <b className="text-red-500">{inr(stats.dueDep)}</b></span>
          </div>
        </div>
      </div>
      )}

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
             <ArrowUpRight className="w-16 h-16 text-red-500" />
          </div>
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Total Settled</div>
          <div className="text-3xl font-display font-bold text-red-400 mb-1">{inr(totalSettled)}</div>
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

      {/* Salary package tab: salary-rent cards */}
      {pkgTab === "salary" && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6" data-testid="salary-summary">
        <div className="mv-card p-5 relative overflow-hidden mv-rise">
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Gross Revenue {city !== "all" ? `(${city})` : ""}</div>
          <div className="text-3xl font-display font-bold text-mv-text mb-1">{inr(salaryGross)}</div>
          <div className="text-xs text-mv-dim">Salary-rent (paid + unpaid)</div>
        </div>
        <div className="mv-card p-5 relative overflow-hidden mv-rise" style={{ animationDelay: "50ms" }}>
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <ArrowUpRight className="w-16 h-16 text-red-500" />
          </div>
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Total Settled</div>
          <div className="text-3xl font-display font-bold text-red-400 mb-1">{inr(salaryTotals.settled)}</div>
          <div className="text-xs text-mv-dim">Salary-rent paid by drivers</div>
        </div>
        <div className="mv-card p-5 relative overflow-hidden mv-rise" style={{ animationDelay: "100ms" }}>
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <ArrowDownRight className="w-16 h-16 text-rose-500" />
          </div>
          <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">Total Unsettled</div>
          <div className="text-3xl font-display font-bold text-rose-400 mb-1">{inr(salaryTotals.unsettled)}</div>
          <div className="text-xs text-mv-dim">Salary-rent pending</div>
        </div>
      </div>
      )}

      {pkgTab === "commission" && (() => {
        const cr = rows.filter((it) => it.package_category === "commission");
        const veh = new Set(), paidD = new Set(), unpaidD = new Set(), wo = new Set();
        let paidAmt = 0, collected = 0;
        for (const it of cr) {
          if (it.rent_status === "week_off" || it.rent_status === "paid_leave") { if (it.rent_status === "week_off") wo.add(String(it.driver_id)); continue; }
          if (it.vehicle_code || it.vehicle_reg) veh.add(it.vehicle_code || it.vehicle_reg);
          if (it.collection) { paidD.add(String(it.driver_id)); paidAmt += Number(it.collection.pay_amount) || 0; collected += Number(it.collection.total_collected) || 0; }
          else if (it.rent_for_date && !it.prev_collection && !(it.rental_start && it.date <= it.rental_start)) unpaidD.add(String(it.driver_id));
        }
        const cards = [
          { label: "Running Vehicles", value: veh.size, sub: "", color: "text-mv-text" },
          { label: "Commission Paid", value: paidD.size, sub: `Drivers · ${inr(paidAmt)}`, color: "text-green-600" },
          { label: "Commission Unpaid", value: unpaidD.size, sub: "Drivers", color: "text-amber-500" },
          { label: "Total Collection", value: inr(collected), sub: "Collected by drivers", color: "text-red-500" },
          { label: "Week Off", value: wo.size, sub: "Drivers", color: "text-violet-500" },
        ];
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-6" data-testid="commission-summary">
            {cards.map((k) => (
              <div key={k.label} className="mv-card p-5">
                <div className="text-xs text-mv-muted uppercase tracking-widest font-semibold mb-3">{k.label}</div>
                <div className={`text-3xl font-display font-bold ${k.color}`}>{k.value}</div>
                {k.sub && <div className="text-xs text-mv-dim mt-1">{k.sub}</div>}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Commission / Salary package tabs: their own table */}
      {isPkgTab && (
        <div className="mv-card overflow-hidden overflow-x-auto mv-rise" style={{ animationDelay: "150ms" }}>
          <table ref={rz.tableRef} className={`w-full text-sm ${rz.widths ? "mv-col-fixed" : ""}`}>
            <thead>
              <tr className="border-b border-mv-border text-left mv-label">
                <ResizableTh id="driver" rz={rz}>Driver</ResizableTh>
                <ResizableTh id="date" rz={rz}>Date</ResizableTh>
                <ResizableTh id="vehicle" rz={rz}>Vehicle</ResizableTh>
                <ResizableTh id="pct" rz={rz}>{pkgTab === "commission" ? "Commission %" : "Salary"}</ResizableTh>
                <ResizableTh id="total" rz={rz}>Total Collected</ResizableTh>
                <ResizableTh id="amount" rz={rz}>{pkgTab === "commission" ? "Commission Amount" : "Rent (Salary) Paid"}</ResizableTh>
                <ResizableTh id="receipt" rz={rz}>Uploaded Receipt</ResizableTh>
                <ResizableTh id="txn" rz={rz}>Transaction ID</ResizableTh>
                <ResizableTh id="trip" rz={rz}>Trip Screenshot</ResizableTh>
                <ResizableTh id="settle" rz={rz}>Settled / Unsettled</ResizableTh>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="10" className="px-5 py-16 text-center text-mv-muted">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Loader2 className="w-6 h-6 animate-spin text-mv-primary" />
                      Loading collection data...
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan="10" className="px-5 py-16 text-center">
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
                  <RowTip key={it.id} tip={rowTipOf(it)} className="border-b border-mv-border/50 hover:bg-mv-elevated transition-colors">
                    <td className="px-5 py-4 font-medium flex items-center gap-3">
                      <Avatar className="w-8 h-8"><AvatarImage src={it.driver_avatar} /><AvatarFallback className="text-[10px] bg-mv-elevated">{it.driver_name?.[0]}</AvatarFallback></Avatar>
                      <div className="flex flex-col items-start">
                        <span>{it.driver_name}</span>
                        <DriverCode id={it.driver_id} className="block whitespace-nowrap" />
                      </div>
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
                      {it.collection && it.collection.total_collected != null ? inr(it.collection.total_collected) : <span className="text-slate-400 font-medium">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      {it.collection ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-green-600 font-display font-bold text-sm">{inr(it.collection.pay_amount)}</span>
                          {it.package_category === "salary" && <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.collection.for_date}</span>}
                          <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-green-50 text-green-600 text-xs font-bold tracking-wide border border-green-200 shadow-sm">
                            <Check className="w-3.5 h-3.5" /> PAID
                          </div>
                          {it.collection.transaction_id && (
                            <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200 mt-0.5">TXN {it.collection.transaction_id}</div>
                          )}
                        </div>
                      ) : (it.rent_status === "week_off" || it.rent_status === "paid_leave") ? (
                        <span className="text-slate-400 font-medium">—</span>
                      ) : (it.rent_for_date && !it.prev_collection && !(it.rental_start && it.date <= it.rental_start)) ? (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 text-red-500 text-xs font-bold tracking-wide">NOT PAID</div>
                      ) : (
                        <span className="text-slate-400 font-medium">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {it.collection?.receipt_url ? (
                        <a href={imgUrl(it.collection.receipt_url)} target="_blank" rel="noreferrer">
                          <img src={imgUrl(it.collection.receipt_url)} alt="Payment receipt" className="w-14 h-14 object-cover rounded-lg border border-mv-border" />
                        </a>
                      ) : (
                        <span className="text-slate-400 font-medium">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {it.collection?.receipt_txn ? (
                        <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200">{it.collection.receipt_txn}</div>
                      ) : it.collection?.receipt_url ? (
                        <span className="text-[11px] text-mv-muted">Not detected</span>
                      ) : it.collection?.transaction_id ? (
                        <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200">{it.collection.transaction_id}</div>
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
                  </RowTip>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Table Section */}
      {!isPkgTab && (
      <div className="mv-card overflow-hidden overflow-x-auto mv-rise" style={{ animationDelay: "150ms" }}>
        <table ref={rz.tableRef} className={`w-full text-sm ${rz.widths ? "mv-col-fixed" : ""}`}>
          <thead>
            <tr className="border-b border-mv-border text-left mv-label">
              <ResizableTh id="driver" rz={rz}>Driver</ResizableTh>
              <ResizableTh id="date" rz={rz}>Date</ResizableTh>
              <ResizableTh id="vehicle" rz={rz}>Vehicle</ResizableTh>
              {/* <th className="px-5 py-4">Start KM</th>
              <th className="px-5 py-4">End KM</th>
              <th className="px-5 py-4">Total KM</th> */}
              <ResizableTh id="revenue" rz={rz} className="px-5 py-4 text-amber-500">Revenue</ResizableTh>
              {/* <th className="px-5 py-4 text-red-500">Extra KM</th> */}
              <ResizableTh id="rent" rz={rz}>Daily Rent</ResizableTh>
              {/* <th className="px-5 py-4">Extra KM Charges</th> */}
              <ResizableTh id="pending" rz={rz}>Pending Rent</ResizableTh>
              <ResizableTh id="receipt" rz={rz}>Uploaded Receipt</ResizableTh>
              <ResizableTh id="txn" rz={rz}>Transaction ID</ResizableTh>
              <ResizableTh id="dep-amount" rz={rz}>Deposit Amount</ResizableTh>
              <ResizableTh id="dep-paid" rz={rz}>Deposit Paid</ResizableTh>
              <ResizableTh id="dep-pending" rz={rz}>Deposit Pending</ResizableTh>
              <ResizableTh id="dep-status" rz={rz}>Deposit Status</ResizableTh>
              <ResizableTh id="trip" rz={rz}>Trip Screenshot</ResizableTh>
              {pkgTab !== "rental" && <ResizableTh id="settle" rz={rz}>Settled / Unsettled</ResizableTh>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={pkgTab === "rental" ? 13 : 14} className="px-5 py-16 text-center text-mv-muted">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <Loader2 className="w-6 h-6 animate-spin text-mv-primary" />
                    Loading collection data...
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={pkgTab === "rental" ? 13 : 14} className="px-5 py-16 text-center">
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
                  <RowTip key={it.id} tip={rowTipOf(it)} className="border-b border-mv-border/50 hover:bg-mv-elevated transition-colors">
                    <td className="px-5 py-4 font-medium flex items-center gap-3">
                      <Avatar className="w-8 h-8"><AvatarImage src={it.driver_avatar} /><AvatarFallback className="text-[10px] bg-mv-elevated">{it.driver_name?.[0]}</AvatarFallback></Avatar>
                      <div className="flex flex-col items-start">
                        <span>{it.driver_name}</span>
                        <DriverCode id={it.driver_id} className="block whitespace-nowrap" />
                      </div>
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
                      {it.package_category === "salary"
                        ? (salaryRentOf(it).amount > 0
                            ? <div className="text-amber-500/90">{inr(salaryRentOf(it).amount)}</div>
                            : <span className="text-slate-400 font-medium">-</span>)
                        : isSpecialPkg(it) ? <span className="text-slate-400 font-medium">-</span> : <div className="text-amber-500/90">{inr(it.daily_rate)}</div>}
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
                        <span className="text-[11px] text-red-600 font-semibold">Within Limit</span>
                      )}
                    </td> */}
                    <td className="px-5 py-4">
                      {it.package_category === "salary" ? (
                        salaryRentCell(it)
                      ) : isSpecialPkg(it) ? (
                        pkgPill(it)
                      ) : it.rent_status === "week_off" ? (
                        <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-violet-50 text-violet-600 text-xs font-bold tracking-wide border border-violet-200 shadow-sm">
                          Week-off
                        </div>
                      ) : it.rent_status === "paid_leave" ? (
                        <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-red-50 text-red-600 text-xs font-bold tracking-wide border border-red-200 shadow-sm">
                          PAID LEAVE
                        </div>
                      ) : (it.is_today_row || it.prev_rent_row) ? (
                        it.prev_rent ? (
                          <div className="flex flex-col gap-1 mt-1 mb-1">
                            <span className={`font-display font-bold text-sm ${it.prev_rent.status === "paid" ? "text-green-600" : "text-red-500/80"}`}>{inr(it.prev_rent.amount)}</span>
                            <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.prev_rent.date}</span>
                            {it.prev_rent.status === "paid" ? (
                              <>
                                <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-green-50 text-green-600 text-xs font-bold tracking-wide border border-green-200 shadow-sm">
                                  <Check className="w-3.5 h-3.5" /> PAID
                                </div>
                                {it.prev_rent.transaction_id && (
                                  <>
                                    {pkgTab !== "all" && (
                                    <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200 mt-0.5">
                                      TXN {it.prev_rent.transaction_id}
                                    </div>
                                    )}
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
                          <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-green-50 text-green-600 text-xs font-bold tracking-wide border border-green-200 shadow-sm">
                            <Check className="w-3.5 h-3.5" /> PAID
                          </div>
                          {it.rent_for_date && <span className="text-[11px] text-mv-muted whitespace-nowrap">{it.rent_for_date}</span>}
                          <span className="text-green-600 font-display font-bold text-sm">{inr(it.rent_amount)}</span>
                          {it.rent_transaction_id && (
                            <>
                              {pkgTab !== "all" && (
                              <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200 mt-0.5">
                                TXN {it.rent_transaction_id}
                              </div>
                              )}
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
                        <span className="text-[11px] text-red-500/80">Trip in progress</span>
                      ) : (it.extra_km_amount || 0) <= 0 ? (
                        <span className="text-slate-400 font-medium">0</span>
                      ) : it.extra_km_status === "paid" ? (
                        <div className="flex flex-col gap-1 mt-1 mb-1">
                          <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-green-50 text-green-600 text-xs font-bold tracking-wide border border-green-200 shadow-sm">
                            <Check className="w-3.5 h-3.5" /> PAID
                          </div>
                          <span className="text-green-600 font-display font-bold text-sm">{inr(it.extra_km_amount)}</span>
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
                    <td className="px-5 py-4 font-display font-bold">
                      {pendingRentOf(it) > 0 ? <span className="text-red-500">{inr(pendingRentOf(it))}</span> : <span className="text-slate-400 font-medium">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      {it.pending_receipt?.url ? (
                        <a href={imgUrl(it.pending_receipt.url)} target="_blank" rel="noreferrer" data-testid="pending-receipt-link">
                          <img src={imgUrl(it.pending_receipt.url)} alt="Payment receipt" className="w-14 h-14 object-cover rounded-lg border border-mv-border" />
                        </a>
                      ) : (
                        <span className="text-slate-400 font-medium">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {it.pending_receipt?.txn ? (
                        <div className="text-[10px] font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded w-max border border-slate-200">{it.pending_receipt.txn}</div>
                      ) : it.pending_receipt?.url ? (
                        <span className="text-[11px] text-mv-muted">Not detected</span>
                      ) : (
                        <span className="text-slate-400 font-medium">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 font-display font-bold">
                      {_special(it) || !(it.deposit > 0) ? <span className="text-slate-400 font-medium">—</span> : inr(depositOf(it).total)}
                    </td>
                    <td className="px-5 py-4 font-display font-bold">
                      {_special(it) || !(it.deposit > 0) ? <span className="text-slate-400 font-medium">—</span> : <span className="text-green-600">{inr(depositOf(it).paid)}</span>}
                    </td>
                    <td className="px-5 py-4 font-display font-bold">
                      {_special(it) || !(it.deposit > 0) ? <span className="text-slate-400 font-medium">—</span>
                        : depositOf(it).pending > 0 ? <span className="text-red-500">{inr(depositOf(it).pending)}</span>
                        : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">PAID</span>}
                    </td>
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
                          <span className="inline-flex items-center gap-1.5 w-max px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">REMAINING AMOUNT PAID - {inr(it.deposit_second_amount)}</span>
                          {txnChip(it.deposit_transaction_id, it.deposit_main_manual)}
                          <span className="text-red-600 font-bold text-xs">Total amount - {inr(it.deposit)}</span>
                        </div>
                      ) : it.deposit_status !== "paid" && it.deposit > 0 ? (
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold">DEPOSIT PENDING</span>
                          <span className="text-red-500 font-bold">{inr(it.deposit)}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1 mt-1 mb-1">
                          {it.deposit > 0 && it.deposit_status === "paid" && !depositRowIds.has(it.id) ? (
                            <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-green-50 text-green-600 text-[10px] font-bold tracking-wide border border-green-200 shadow-sm">
                              <Check className="w-3 h-3" /> ALREADY PAID
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1.5 w-max px-2.5 py-1 rounded-md bg-green-50 text-green-600 text-[10px] font-bold tracking-wide border border-green-200 shadow-sm">
                              <Check className="w-3 h-3" /> PAID
                            </div>
                          )}
                          <span className="text-green-600 font-bold">{inr(it.deposit_paid || it.deposit || 0)}</span>
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
                          {/* <span className="text-[11px] text-mv-muted">Collected {inr(it.collection.total_collected)}</span>
                          <span className="text-[11px] font-bold text-green-600">Paid {inr(it.collection.pay_amount)}</span> */}
                        </div>
                      ) : (
                        <span className="text-slate-400 font-medium">—</span>
                      )}
                    </td>
                    {pkgTab !== "rental" && <td className="px-5 py-4">{settleBtn(it)}</td>}
                  </RowTip>
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
