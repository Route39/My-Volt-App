import shutil, sys

def edit(path, pairs):
    s = open(path).read()
    for old, new in pairs:
        if s.count(old) != 1:
            print(f"STOP (nothing changed in {path}): expected 1 match, found {s.count(old)} for:\n{old[:90]!r}")
            sys.exit(1)
    for old, new in pairs:
        s = s.replace(old, new, 1)
    shutil.copy(path, path + ".bak")
    open(path, "w").write(s)
    print("patched", path)

D = "frontend/src/pages/"

# ---------------- Drivers: table default + Supervisor column ----------------
edit(D + "Drivers.jsx", [
('const [view, setView] = useState("cards");', 'const [view, setView] = useState("list");'),
('<th className="px-4 py-3">City</th><th className="px-4 py-3">KYC</th>',
 '<th className="px-4 py-3">City</th><th className="px-4 py-3">Supervisor</th><th className="px-4 py-3">KYC</th>'),
('''                <td className="px-4 py-3">{d.city}</td>
                <td className="px-4 py-3"><KycStatusChip status={d.kyc_status || "pending"} /></td>''',
 '''                <td className="px-4 py-3">{d.city}</td>
                <td className="px-4 py-3 text-mv-muted">{d.supervisor_name || "—"}</td>
                <td className="px-4 py-3"><KycStatusChip status={d.kyc_status || "pending"} /></td>'''),
])

# ---------------- Fleet: table default + more columns ----------------
edit(D + "Fleet.jsx", [
('const [view, setView] = useState("grid");', 'const [view, setView] = useState("list");'),
('''                <th className="px-4 py-3 font-semibold">City</th>
              </tr></thead>''',
 '''                <th className="px-4 py-3 font-semibold">City</th>
                <th className="px-4 py-3 font-semibold">VIN</th><th className="px-4 py-3 font-semibold">Rental Ends</th>
              </tr></thead>'''),
('''                    <td className="px-4 py-3">{v.city}</td>
                  </tr>''',
 '''                    <td className="px-4 py-3">{v.city}</td>
                    <td className="px-4 py-3 font-mono text-xs text-mv-muted">{v.vin_number || "—"}</td>
                    <td className="px-4 py-3 text-amber-400">{(v.status === "rented" && v.rental_end) ? relativeEnd(v.rental_end) : <span className="text-mv-dim">—</span>}</td>
                  </tr>'''),
])

# ---------------- Rentals: table view (default) + cards toggle ----------------
TABLE = '''      {items && items.length > 0 && view === "table" && (
        <div className={`mv-card overflow-hidden overflow-x-auto transition-opacity duration-200 ${loading ? "opacity-60" : "opacity-100"}`} data-testid="rentals-table">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-mv-border text-left mv-label">
                <th className="px-4 py-3">Rental ID</th><th className="px-4 py-3">Driver</th><th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">City</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th><th className="px-4 py-3">Ends</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} onClick={() => nav(`/rentals/${r.id}`)} data-testid={`rental-row-${r.id}`}
                    className="border-b border-mv-border/50 hover:bg-mv-elevated cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-semibold">{r.rental_code}</td>
                  <td className="px-4 py-3">{r.driver_name} <DriverCode id={r.driver_id} /></td>
                  <td className="px-4 py-3">{r.vehicle_number || "—"}</td>
                  <td className="px-4 py-3">{r.city}</td>
                  <td className="px-4 py-3">{r.plan_name}</td>
                  <td className="px-4 py-3 text-mv-muted">
                    {r.package_category === "commission" ? `Commission · ${r.commission_percent ?? "—"}%`
                      : r.package_category === "salary" ? `Salary · ₹${r.salary_amount ?? "—"}` : "Rental"}
                  </td>
                  <td className="px-4 py-3"><StatusChip status={r.status === "suspended" ? "suspended" : r.display_status} /></td>
                  <td className="px-4 py-3 text-amber-400">{(r.end && r.end !== "Ongoing") ? relativeEnd(r.end) : "Ongoing"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

'''
edit(D + "Rentals.jsx", [
('import { Search, Plus, KeyRound, Car, User } from "lucide-react";',
 'import { Search, Plus, KeyRound, Car, User, LayoutGrid, List } from "lucide-react";'),
('  const [tab, setTab] = useState(params.get("status") || "active");',
 '  const [view, setView] = useState("table");\n  const [tab, setTab] = useState(params.get("status") || "active");'),
('''      <div className="relative flex-1 max-w-md mb-5">
        <Search className''',
 '''      <div className="flex items-center gap-3 mb-5">
      <div className="relative flex-1 max-w-md">
        <Search className'''),
('''text-sm" />
      </div>

      {!items && <div className="grid grid-cols-1 md:grid-cols-2''',
 '''text-sm" />
      </div>
      <div className="flex rounded-xl border border-mv-border overflow-hidden">
        <button onClick={() => setView("cards")} className={`w-10 h-10 flex items-center justify-center ${view === "cards" ? "bg-mv-elevated text-mv-primary" : "text-mv-dim"}`}><LayoutGrid className="w-4 h-4" /></button>
        <button onClick={() => setView("table")} data-testid="rentals-table-view" className={`w-10 h-10 flex items-center justify-center ${view === "table" ? "bg-mv-elevated text-mv-primary" : "text-mv-dim"}`}><List className="w-4 h-4" /></button>
      </div>
      </div>

      {!items && <div className="grid grid-cols-1 md:grid-cols-2'''),
('''      {items && items.length > 0 && (
        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 transition-opacity''',
 TABLE + '''      {items && items.length > 0 && view === "cards" && (
        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 transition-opacity'''),
])
print("DONE. Restart frontend (npm start) and refresh. Undo: mv file.bak file")
