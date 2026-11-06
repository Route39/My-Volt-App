import { useState, useEffect } from "react";
import { Package, MapPin, Check, ArrowLeft, Edit2 } from "lucide-react";
import api from "../lib/api";
import { inr } from "../lib/format";
import { toast } from "sonner";
import { PrimaryBtn, GhostBtn } from "../components/common/Page";
import { useApp } from "../context/AppContext";
import PackageLock from "../components/common/PackageLock";

const PACKAGE_TYPES = ["Silver", "Gold", "Platinum", "In-Build Vehicles"];
// "In-Build Vehicles" is already a full name, so don't add " Package" after it
const defaultPkgName = (type) => (type === "In-Build Vehicles" ? type : `${type} Package`);

// "In-Build Vehicles" is not offered in Bangalore (only Coimbatore, Chennai, Tiruppur)
const typesForCity = (city) =>
  (city || "").trim().toLowerCase() === "bangalore"
    ? PACKAGE_TYPES.filter((t) => t !== "In-Build Vehicles")
    : PACKAGE_TYPES;

// Commission & Salary packages: exactly 1 of each per city (default names: "Commission Package", "Salary Package")
const COMMISSION_TYPE = "Commission";
const SALARY_TYPE = "Salary";
const COMMISSION_PERCENT_OPTIONS = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70]; // edit this list as needed

export default function Packages() {
  const { cities } = useApp(); // city managers get only their own city; admins get all
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // "list" | "form"
  const [editData, setEditData] = useState(null); // { city, type, pkg? }
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState("rental"); // "rental" | "commission" | "salary"

  const fetchPackages = async () => {
    try {
      const { data } = await api.get("/rental-plans");
      setPackages(data);
    } catch (err) {
      toast.error("Failed to fetch packages");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPackages();
  }, [view]);

  const toggleActive = async (pkg) => {
    try {
      await api.put(`/rental-plans/${pkg.id || pkg._id}`, { active: !pkg.active });
      toast.success(pkg.active ? "Package locked (Coming Soon)" : "Package unlocked");
      fetchPackages();
    } catch (e) {
      toast.error("Failed to update status");
    }
  };

  const handleEdit = (city, type, pkg) => {
    setEditData({ city, type, pkg });
    setView("form");
  };

  if (view === "form") {
    return (
        <PackageForm editData={editData} onBack={() => setView("list")} onSaved={() => setView("list")} />
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-mv-text tracking-tight">
            {tab === "commission" ? "Commission Package" : tab === "salary" ? "Salary Package" : "Rental Packages"}
          </h1>
          {/* <p className="text-mv-muted mt-1">
            {tab === "commission"
              ? "Manage the commission package per city."
              : tab === "salary"
              ? "Manage the salary package per city."
              : "Manage strict Silver, Gold, Platinum, and In-Build Vehicles packages per city."}
          </p> */}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-mv-border pb-3">
        {[
          { key: "rental", label: "Rental Packages" },
          { key: "commission", label: "Commission" },
          { key: "salary", label: "Salary" },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-full text-sm font-bold transition-colors ${tab === t.key ? "bg-mv-primary text-white" : "bg-mv-surface2 text-mv-muted hover:text-mv-text"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 bg-mv-surface/50 rounded-2xl animate-pulse border border-mv-border"></div>
          ))}
        </div>
      ) : (
        <div className="space-y-12">
          {cities.map(city => {
            return (
              <div key={city}>
                <h2 className="text-2xl font-bold text-mv-text mb-6 flex items-center gap-2"><MapPin className="w-6 h-6 text-mv-primary" /> {city}</h2>
                {tab === "rental" && (
                <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 ${typesForCity(city).length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}>
                  {typesForCity(city).map(type => {
                    const pkg = packages.find(p => p.city === city && p.package_type === type);
                    const isActive = pkg && pkg.active;
                    const isConfigured = !!pkg;
                    
                    return (
                      <div 
                        key={type} 
                        onDoubleClick={() => isConfigured ? toggleActive(pkg) : null}
                        className={`mv-card p-6 flex flex-col relative group transition-all select-none ${isConfigured ? 'cursor-pointer hover:border-mv-primary/30' : 'opacity-60 grayscale hover:grayscale-0'}`}
                      >
                        <div className="absolute top-4 right-4 flex opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <button onClick={(e) => { e.stopPropagation(); handleEdit(city, type, pkg); }} className="p-2 text-mv-muted hover:text-mv-primary bg-mv-surface2 rounded-full">
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </div>
                        
                        <div className="flex items-center gap-3 mb-4">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isActive ? 'bg-mv-primary/10 text-mv-primary' : 'bg-slate-100 text-slate-400'}`}>
                            <Package className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="font-bold text-lg text-mv-text leading-tight">{pkg?.name || defaultPkgName(type)}</h3>
                            {isActive ? (
                              <div className="text-[10px] text-mv-muted mt-0.5 font-medium">{type} · Double click to lock</div>
                            ) : (
                              <div className="text-[10px] text-amber-500 mt-0.5 font-bold uppercase tracking-widest bg-amber-500/10 px-2 py-0.5 rounded inline-block">Coming Soon</div>
                            )}
                          </div>
                        </div>
                        
                        <div className="mt-2 space-y-3">
                          <div className="flex justify-between items-center pb-3 border-b border-mv-border/50">
                            <span className="text-mv-muted text-sm">Daily Rate</span>
                            <span className="font-extrabold text-mv-primary text-xl">{isActive ? inr(pkg.amount) : "—"}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-mv-muted">Daily Limit</span>
                            <span className="font-semibold text-mv-text">{isActive ? `${pkg.daily_limit_km || Math.round((pkg.monthly_km_limit || 0) / 30)} km/day` : "—"}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-mv-muted">Extra KM Fee</span>
                            <span className="font-semibold text-mv-text">{isActive ? `${inr(pkg.overage_per_km)}/km` : "—"}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-mv-muted">Security Deposit</span>
                            <span className="font-semibold text-mv-text">{isActive ? inr(pkg.deposit || 5000) : "—"}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}

                {/* Commission OR Salary package (1 per city), chosen by the tab */}
                {tab !== "rental" && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                  {[tab === "commission" ? COMMISSION_TYPE : SALARY_TYPE].map(type => {
                    const pkg = packages.find(p => p.city === city && p.package_type === type);
                    const isActive = pkg && pkg.active;
                    const isConfigured = !!pkg;

                    return (
                      <div
                        key={type}
                        onDoubleClick={() => isConfigured ? toggleActive(pkg) : null}
                        className={`mv-card p-6 flex flex-col relative group transition-all select-none ${isConfigured ? 'cursor-pointer hover:border-mv-primary/30' : 'opacity-60 grayscale hover:grayscale-0'}`}
                      >
                        <div className="absolute top-4 right-4 flex opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <button onClick={(e) => { e.stopPropagation(); handleEdit(city, type, pkg); }} className="p-2 text-mv-muted hover:text-mv-primary bg-mv-surface2 rounded-full">
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex items-center gap-3 mb-4">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isActive ? 'bg-mv-primary/10 text-mv-primary' : 'bg-slate-100 text-slate-400'}`}>
                            <Package className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="font-bold text-lg text-mv-text leading-tight">{pkg?.name || defaultPkgName(type)}</h3>
                            {isActive ? (
                              <div className="text-[10px] text-mv-muted mt-0.5 font-medium">{type} · Double click to lock</div>
                            ) : (
                              <div className="text-[10px] text-amber-500 mt-0.5 font-bold uppercase tracking-widest bg-amber-500/10 px-2 py-0.5 rounded inline-block">Coming Soon</div>
                            )}
                          </div>
                        </div>

                        <div className="mt-2 space-y-3">
                          {type === COMMISSION_TYPE ? (
                            <div className="flex justify-between items-center">
                              <span className="text-mv-muted text-sm">Commission</span>
                              <span className="font-extrabold text-mv-primary text-xl">{isActive && pkg.commission_percent != null ? `${pkg.commission_percent}%` : "—"}</span>
                            </div>
                          ) : (
                            <div className="flex justify-between items-center">
                              <span className="text-mv-muted text-sm">Salary</span>
                              <span className="font-extrabold text-mv-primary text-xl">{isActive && pkg.salary_amount != null ? inr(pkg.salary_amount) : "—"}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PackageForm({ editData, onBack, onSaved }) {
  const { city, type, pkg } = editData;
  const [form, setForm] = useState({
    name: pkg?.name || defaultPkgName(type),
    package_type: type,
    city: city,
    amount: pkg?.amount || "",
    deposit: pkg?.deposit || 5000,
    daily_limit_km: pkg?.daily_limit_km || (pkg?.monthly_km_limit ? Math.round(pkg.monthly_km_limit / 30) : ""),
    overage_per_km: pkg?.overage_per_km || "",
    active: pkg?.active ?? true,
    commission_percent: pkg?.commission_percent ?? "",
    salary_amount: pkg?.salary_amount ?? ""
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleLimitChange = (e) => set("daily_limit_km", e.target.value);

  const isCommission = form.package_type === COMMISSION_TYPE;
  const isSalary = form.package_type === SALARY_TYPE;
  const isSpecial = isCommission || isSalary;

  const save = async () => {
    if (isSpecial) {
      if (!form.name || (isCommission && form.commission_percent === "") || (isSalary && form.salary_amount === "")) {
        return toast.error("Please fill all fields accurately");
      }
    } else if (!form.name || form.amount === "" || form.daily_limit_km === "" || form.overage_per_km === "" || form.deposit === "") {
      return toast.error("Please fill all fields accurately");
    }
    setSaving(true);
    try {
      const payload = isSpecial ? {
        name: form.name,
        package_type: form.package_type,
        city: form.city,
        active: form.active,
        ...(isCommission ? { commission_percent: Number(form.commission_percent) } : {}),
        ...(isSalary ? { salary_amount: Number(form.salary_amount) } : {})
      } : {
        name: form.name,
        package_type: form.package_type,
        city: form.city,
        amount: Number(form.amount),
        deposit: Number(form.deposit),
        daily_limit_km: Number(form.daily_limit_km),
        monthly_km_limit: Number(form.daily_limit_km) * 30, // legacy field kept in sync
        overage_per_km: Number(form.overage_per_km),
        active: form.active
      };
      
      if (pkg && (pkg.id || pkg._id)) {
        await api.put(`/rental-plans/${pkg.id || pkg._id}`, payload);
        toast.success("Package updated perfectly");
      } else {
        await api.post("/rental-plans", payload);
        toast.success("Package created perfectly");
      }
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error saving package");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-mv-surface2 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-mv-muted" />
          </button>
          <h1 className="text-2xl font-display font-bold">Configure {defaultPkgName(type)} for {city}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-mv-muted">Status:</span>
          <button 
            onClick={() => set("active", !form.active)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-colors ${form.active ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'}`}
          >
            {form.active ? "Active" : "Coming Soon"}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="mv-card p-6 md:p-8">
          <h2 className="text-lg font-bold mb-6 flex items-center gap-2 border-b border-mv-border pb-4">
            <div className="w-8 h-8 rounded-full bg-mv-primary/10 flex items-center justify-center"><Package className="w-4 h-4 text-mv-primary" /></div>
            Basics
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-1">
              <label className="block text-sm font-bold text-mv-text mb-1">Package Name</label>
              <input 
                type="text" 
                value={form.name} 
                onChange={e => set("name", e.target.value)} 
                className="w-full h-11 px-4 rounded-xl border border-mv-border bg-mv-surface text-mv-text focus:outline-none focus:border-mv-primary transition-colors"
                placeholder={`e.g. ${type} Starter`} 
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-bold text-mv-text mb-1">Target City</label>
              <div className="w-full h-11 px-4 flex items-center rounded-xl bg-mv-surface2/50 border border-mv-border/50 text-mv-muted cursor-not-allowed font-medium">
                {form.city}
              </div>
            </div>
            
            <div className="space-y-1 md:col-span-2">
              <label className="block text-sm font-bold text-mv-text mb-1">Package Type</label>
              <div className="w-full h-11 px-4 flex items-center rounded-xl bg-mv-surface2/50 border border-mv-border/50 text-mv-muted cursor-not-allowed font-medium">
                {form.package_type}
              </div>
            </div>
          </div>
        </div>

        {isSpecial && (
          <div className="mv-card p-6 md:p-8">
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2 border-b border-mv-border pb-4">
              <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center"><Check className="w-4 h-4 text-amber-500" /></div>
              {isCommission ? "Commission" : "Salary"}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {isCommission ? (
                <div className="space-y-1">
                  <label className="block text-sm font-bold text-mv-text mb-1">Commission Percentage (%)</label>
                  <select
                    value={form.commission_percent}
                    onChange={e => set("commission_percent", e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-mv-border bg-mv-surface text-mv-text focus:outline-none focus:border-mv-primary transition-colors font-bold"
                  >
                    <option value="">Select percentage</option>
                    {COMMISSION_PERCENT_OPTIONS.map(p => <option key={p} value={p}>{p}%</option>)}
                  </select>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="block text-sm font-bold text-mv-text mb-1">Salary Amount (₹)</label>
                  <input
                    type="number"
                    value={form.salary_amount}
                    onChange={e => set("salary_amount", e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-mv-border bg-mv-surface text-mv-text focus:outline-none focus:border-mv-primary transition-colors font-bold"
                    placeholder="15000"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {!isSpecial && (
        <div className="mv-card p-6 md:p-8">
          <h2 className="text-lg font-bold mb-6 flex items-center gap-2 border-b border-mv-border pb-4">
            <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center"><Check className="w-4 h-4 text-amber-500" /></div>
            Pricing & Limits
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-1">
              <label className="block text-sm font-bold text-mv-text mb-1">Daily Rent Amount (₹)</label>
              <input 
                type="number" 
                value={form.amount} 
                onChange={e => set("amount", e.target.value)} 
                className="w-full h-11 px-4 rounded-xl border border-mv-border bg-mv-surface text-mv-text focus:outline-none focus:border-mv-primary transition-colors font-bold"
                placeholder="800" 
              />
              <p className="text-[10px] font-semibold text-emerald-600 mt-1">✓ Automated: 3 free days given at the end of the month (e.g. 28 days charged for 31-day month).</p>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-bold text-mv-text mb-1">Security Deposit (₹)</label>
              <input 
                type="number" 
                value={form.deposit} 
                onChange={e => set("deposit", e.target.value)} 
                className="w-full h-11 px-4 rounded-xl border border-mv-border bg-mv-surface text-mv-text focus:outline-none focus:border-mv-primary transition-colors font-bold text-mv-primary"
                placeholder="5000" 
              />
              <p className="text-[10px] font-semibold text-red-500 mt-1">Compulsory: Driver blocked from starting trips if unpaid.</p>
            </div>
            
            <div className="space-y-1">
              <label className="block text-sm font-bold text-mv-text mb-1">Daily KM Limit</label>
              <input 
                type="number" 
                value={form.daily_limit_km} 
                onChange={handleLimitChange} 
                className="w-full h-11 px-4 rounded-xl border border-mv-border bg-mv-surface text-mv-text focus:outline-none focus:border-mv-primary transition-colors"
                placeholder="5000" 
              />
            </div>


            <div className="space-y-1">
              <label className="block text-sm font-bold text-mv-text mb-1">Extra KM Charge (₹ per km)</label>
              <input 
                type="number" 
                step="0.5" 
                value={form.overage_per_km} 
                onChange={e => set("overage_per_km", e.target.value)} 
                className="w-full h-11 px-4 rounded-xl border border-mv-border bg-mv-surface text-mv-text focus:outline-none focus:border-mv-primary transition-colors"
                placeholder="20" 
              />
            </div>
          </div>
        </div>
        )}

        <div className="flex flex-wrap justify-end pt-4 gap-3 sm:gap-4">
          <GhostBtn onClick={onBack} disabled={saving}>Cancel</GhostBtn>
          <PrimaryBtn onClick={save} disabled={saving} className="w-full sm:w-auto sm:min-w-[200px]">
            {saving ? "Saving..." : "Save Configuration"}
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}
