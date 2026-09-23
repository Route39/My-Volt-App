import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, User, Car, KeyRound, Calendar, Wallet, Zap, Loader2, MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { Field, TextInput, PrimaryBtn, GhostBtn } from "../components/common/Page";
import { inr, fmtDate } from "../lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { useApp } from "../context/AppContext";

const STEPS = [
  { n: 1, label: "Location", icon: MapPin },
  { n: 2, label: "Drivers", icon: User },
  { n: 3, label: "Vehicles", icon: Car },
  { n: 4, label: "Packages", icon: KeyRound },
  { n: 5, label: "Dates", icon: Calendar },
  { n: 6, label: "Activate", icon: Zap },
];

const CITIES = ["Tiruppur", "Coimbatore", "Chennai", "Bangalore"];

export default function RentalCreate() {
  const nav = useNavigate();
  
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  // Data fetching
  const [allDrivers, setAllDrivers] = useState([]);
  const [allVehicles, setAllVehicles] = useState([]);
  const [allPackages, setAllPackages] = useState([]);

  // Wizard State
  const [selCity, setSelCity] = useState("Bangalore");
  const [selDrivers, setSelDrivers] = useState([]); 
  const [drvVehicles, setDrvVehicles] = useState({}); 
  const [drvPackages, setDrvPackages] = useState({}); 
  const [drvDates, setDrvDates] = useState({});

  useEffect(() => {
    // Fetch drivers, vehicles, and packages specifically for the selected city when step 1 changes
    if (step >= 1) {
      api.get("/drivers", { params: { city: selCity, unassigned: true } }).then(r => setAllDrivers(r.data));
      api.get("/vehicles", { params: { status: "available", page_size: 200, city: selCity } }).then(r => setAllVehicles(r.data.items));
      api.get("/rental-plans").then(r => {
        const pkgs = r.data.filter(p => (p.city === selCity || p.city === "All") && p.active !== false);
        setAllPackages(pkgs);
      });
    }
  }, [selCity, step]);

  const toggleDriver = (id) => {
    setSelDrivers(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      // Initialize state for newly selected driver
      if (!prev.includes(id)) {
        setDrvDates(d => ({ ...d, [id]: { start: new Date().toISOString().slice(0, 10), end: "" } }));
        const defaultPkg = allPackages[0];
        if (defaultPkg) setDrvPackages(p => ({ ...p, [id]: defaultPkg }));
      }
      return next;
    });
  };
  
  const toggleAllDrivers = () => {
    if (selDrivers.length === allDrivers.length) {
      setSelDrivers([]);
    } else {
      const allIds = allDrivers.map(d => d.id);
      setSelDrivers(allIds);
      
      const newDates = {};
      const newPkgs = {};
      const defaultPkg = allPackages[0];
      allIds.forEach(id => {
        newDates[id] = { start: new Date().toISOString().slice(0, 10), end: "" };
        if (defaultPkg) newPkgs[id] = defaultPkg;
      });
      setDrvDates(prev => ({ ...prev, ...newDates }));
      setDrvPackages(prev => ({ ...prev, ...newPkgs }));
    }
  };

  const getDriver = (id) => allDrivers.find(d => d.id === id);
  const getVehicle = (id) => allVehicles.find(v => v.id === id);

  // Available vehicles for dropdown (filter out ones already selected by OTHER drivers)
  const getAvailableVehiclesFor = (driverId) => {
    const usedVids = Object.entries(drvVehicles).filter(([d, v]) => d !== driverId).map(([d, v]) => v);
    return allVehicles.filter(v => !usedVids.includes(v.id));
  };

  const canNext = () => {
    if (step === 1) return !!selCity;
    if (step === 2) return selDrivers.length > 0;
    if (step === 3) return selDrivers.every(d => !!drvVehicles[d]);
    if (step === 4) return selDrivers.every(d => !!drvPackages[d]);
    if (step === 5) return selDrivers.every(d => !!drvDates[d]?.start);
    return true;
  };

  const handleNext = () => {
    if (step === 2) {
      // Auto-assign vehicles sequentially
      const newVehicles = { ...drvVehicles };
      let avail = allVehicles.filter(v => !Object.values(newVehicles).includes(v.id));
      
      selDrivers.forEach(did => {
        if (!newVehicles[did] && avail.length > 0) {
          const v = avail.shift();
          newVehicles[did] = v.id;
        }
      });
      setDrvVehicles(newVehicles);
    }
    setStep(step + 1);
  };

  const removeDriver = (did) => {
    setSelDrivers(prev => prev.filter(id => id !== did));
    setDrvVehicles(prev => { const n = {...prev}; delete n[did]; return n; });
    setDrvPackages(prev => { const n = {...prev}; delete n[did]; return n; });
    setDrvDates(prev => { const n = {...prev}; delete n[did]; return n; });
  };

  const submit = async () => {
    setBusy(true);
    try {
      for (const did of selDrivers) {
        const d = getDriver(did);
        const pkg = drvPackages[did];
        const dates = drvDates[did];
        
        const payload = {
          driver_id: did,
          vehicle_id: drvVehicles[did],
          start: new Date(dates.start + "T00:00:00").toISOString(),
          deposit: pkg?.deposit || 5000,
          package_name: pkg?.name,
          plan_id: pkg?.id,
          package_rate: pkg?.rate,
          notes: "Bulk created from dashboard",
        };
        
        if (dates.end) {
            payload.end = new Date(dates.end + "T00:00:00").toISOString();
        }

        const { data } = await api.post("/rentals", payload);
        
        // Auto activate
        await api.post(`/rentals/${data.id}/activate`);
      }
      
      toast.success(`Successfully activated ${selDrivers.length} rentals!`);
      nav("/rentals");
    } catch (e) { 
      toast.error(e.response?.data?.detail || "Failed to create rentals"); 
    } finally { 
      setBusy(false); 
    }
  };

  const selectedDriverObjs = useMemo(() => selDrivers.map(getDriver).filter(Boolean), [selDrivers, allDrivers]);

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <button onClick={() => nav("/rentals")} className="flex items-center gap-1.5 text-sm text-mv-muted hover:text-mv-text mb-4"><ArrowLeft className="w-4 h-4" /> Rentals</button>
      <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight mb-6">Bulk Create Rentals</h1>

      {/* Stepper */}
      <div className="flex items-center mb-8 overflow-x-auto no-scrollbar pb-1">
        {STEPS.map((s, i) => {
          const Icon = s.icon; const done = step > s.n; const active = step === s.n;
          return (
            <div key={s.n} className="flex items-center shrink-0">
              <div className="flex flex-col items-center gap-1.5">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${done ? "bg-green-500/20 text-green-400" : active ? "bg-mv-primary text-white" : "bg-mv-surface2 text-mv-dim border border-mv-border"}`}>
                  {done ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                </div>
                <span className={`text-[10px] ${active ? "text-mv-text" : "text-mv-dim"}`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`w-8 sm:w-12 h-px mx-1 ${done ? "bg-green-500/50" : "bg-mv-border"}`} />}
            </div>
          );
        })}
      </div>

      <div className="mv-card p-6 min-h-[300px]">
        
        {/* STEP 1: LOCATION */}
        {step === 1 && (
          <div className="animate-in fade-in zoom-in-95 duration-200">
            <h3 className="font-display font-semibold mb-6">Select City Location</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {CITIES.map(c => (
                <button key={c} onClick={() => { setSelCity(c); setSelDrivers([]); }}
                  className={`p-6 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 ${selCity === c ? 'border-mv-primary bg-mv-primary/10 scale-[1.02]' : 'border-mv-border bg-mv-surface hover:bg-mv-surface2'}`}
                >
                  <MapPin className={`w-8 h-8 ${selCity === c ? 'text-mv-primary' : 'text-mv-muted'}`} />
                  <span className="font-bold">{c}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STEP 2: DRIVERS */}
        {step === 2 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold">Select Drivers in {selCity}</h3>
              <GhostBtn onClick={toggleAllDrivers} className="text-sm">
                {selDrivers.length === allDrivers.length && allDrivers.length > 0 ? "Deselect All" : "Select All"}
              </GhostBtn>
            </div>
            
            <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-2">
              {allDrivers.length === 0 && <div className="text-sm text-mv-dim py-8 text-center">No drivers found in {selCity}</div>}
              {allDrivers.map((d) => (
                <button key={d.id} onClick={() => toggleDriver(d.id)}
                  className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${selDrivers.includes(d.id) ? "border-mv-primary bg-mv-primary/10" : "border-mv-border bg-mv-surface hover:border-mv-primary/50"}`}
                >
                  <div className="flex items-center gap-4 text-left">
                    <div className={`w-6 h-6 rounded border flex items-center justify-center transition-colors ${selDrivers.includes(d.id) ? 'bg-mv-primary border-mv-primary text-white' : 'border-mv-border'}`}>
                      {selDrivers.includes(d.id) && <Check className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="font-bold">{d.name}</div>
                      <div className="text-sm text-mv-muted">{d.phone} &middot; {d.city}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4 text-sm font-medium text-mv-primary">{selDrivers.length} drivers selected</div>
          </div>
        )}

        {/* STEP 3: VEHICLES */}
        {step === 3 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-200">
            <h3 className="font-display font-semibold mb-4">Assign Vehicles</h3>
            <p className="text-sm text-mv-muted mb-6">Assign an available vehicle to each selected driver.</p>
            
            <div className="space-y-4">
              {selectedDriverObjs.map(d => {
                const avail = getAvailableVehiclesFor(d.id);
                const assigned = drvVehicles[d.id];
                
                return (
                  <div key={d.id} className="p-4 rounded-xl border border-mv-border bg-mv-surface2 flex flex-col md:flex-row md:items-center gap-4">
                    <div className="w-full md:w-1/3 font-semibold">{d.name}</div>
                    <div className="w-full md:w-2/3">
                      <Select value={assigned || ""} onValueChange={(v) => setDrvVehicles(prev => ({ ...prev, [d.id]: v }))}>
                        <SelectTrigger className={`h-10 bg-mv-surface ${!assigned ? 'border-amber-400' : 'border-mv-border'}`}>
                          <SelectValue placeholder="Select Vehicle" />
                        </SelectTrigger>
                        <SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-60">
                          {assigned && !avail.some(v => v.id === assigned) && <SelectItem value={assigned}>{getVehicle(assigned)?.vehicle_number}{getVehicle(assigned)?.registration_number ? ` - ${getVehicle(assigned)?.registration_number}` : ""}</SelectItem>}
                          {avail.map(v => (
                            <SelectItem key={v.id} value={v.id}>{v.vehicle_number}{v.registration_number ? ` - ${v.registration_number}` : ""}</SelectItem>
                          ))}
                          {avail.length === 0 && !assigned && <div className="p-2 text-sm text-mv-muted">No vehicles left</div>}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 4: PACKAGES */}
        {step === 4 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-200">
            <h3 className="font-display font-semibold mb-4">Assign Packages</h3>
            <p className="text-sm text-mv-muted mb-6">Select the daily rental package for each driver based on {selCity} plans.</p>
            
            <div className="space-y-4">
              {selectedDriverObjs.map(d => {
                const currentPkg = drvPackages[d.id];
                
                return (
                  <div key={d.id} className="p-4 rounded-xl border border-mv-border bg-mv-surface2">
                    <div className="font-semibold mb-3">{d.name}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {allPackages.map(p => {
                        const isSel = currentPkg?.id === p.id;
                        return (
                          <button key={p.id} onClick={() => setDrvPackages(prev => ({...prev, [d.id]: p}))}
                            className={`p-3 rounded-xl border text-left flex flex-col transition-all ${isSel ? 'border-mv-primary bg-mv-primary/10' : 'border-mv-border bg-mv-surface hover:border-mv-dim'}`}
                          >
                            <div className="font-bold flex justify-between">
                              <span>{p.name}</span>
                              <span className="text-mv-primary">{inr(p.amount)}/day</span>
                            </div>
                            <div className="text-xs text-mv-muted mt-1">{p.vehicle_category || "Standard"}</div>
                            <div className="text-[10px] text-mv-muted mt-0.5">Limit: {p.monthly_km_limit}km</div>
                          </button>
                        );
                      })}
                    </div>
                    {allPackages.length === 0 && <div className="text-sm text-mv-muted py-2">No packages configured for {selCity}. Configure them in Admin Packages.</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 5: DATES */}
        {step === 5 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-200">
            <h3 className="font-display font-semibold mb-4">Rental Dates</h3>
            <p className="text-sm text-mv-muted mb-6">Set start date and optional end date (leave blank for Ongoing).</p>
            
            <div className="space-y-4">
              {selectedDriverObjs.map(d => {
                const dates = drvDates[d.id] || { start: "", end: "" };
                return (
                  <div key={d.id} className="p-4 rounded-xl border border-mv-border bg-mv-surface2 flex flex-col md:flex-row md:items-center gap-4">
                    <div className="w-full md:w-1/3 font-semibold">{d.name}</div>
                    <div className="w-full md:w-1/3">
                      <div className="text-xs text-mv-muted mb-1">Start Date</div>
                      <TextInput type="date" value={dates.start} onChange={e => setDrvDates(prev => ({...prev, [d.id]: { ...prev[d.id], start: e.target.value}}))} />
                    </div>
                    <div className="w-full md:w-1/3">
                      <div className="text-xs text-mv-muted mb-1">End Date</div>
                      <TextInput type="date" value={dates.end} onChange={e => setDrvDates(prev => ({...prev, [d.id]: { ...prev[d.id], end: e.target.value}}))} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 6: ACTIVATE */}
        {step === 6 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-200">
            <h3 className="font-display font-semibold mb-4">Review Bulk Activation</h3>
            <div className="overflow-x-auto rounded-xl border border-mv-border">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-mv-surface2 text-mv-muted font-medium border-b border-mv-border">
                  <tr>
                    <th className="px-4 py-3">Driver</th>
                    <th className="px-4 py-3">Vehicle</th>
                    <th className="px-4 py-3">Package</th>
                    <th className="px-4 py-3">Dates</th>
                    <th className="px-4 py-3">Deposit</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDriverObjs.map(d => {
                    const veh = getVehicle(drvVehicles[d.id]);
                    const pkg = drvPackages[d.id];
                    const dates = drvDates[d.id];
                    return (
                      <tr key={d.id} className="border-b border-mv-border/50 bg-mv-surface">
                        <td className="px-4 py-3 font-semibold">{d.name}</td>
                        <td className="px-4 py-3">{veh?.vehicle_number}{veh?.registration_number ? ` - ${veh?.registration_number}` : ""}</td>
                        <td className="px-4 py-3">{pkg?.name} (₹{pkg?.amount || pkg?.rate})</td>
                        <td className="px-4 py-3 text-xs">{fmtDate(dates?.start)} → {dates?.end ? fmtDate(dates.end) : 'Ongoing'}</td>
                        <td className="px-4 py-3 font-bold">{inr(pkg?.deposit || 0)}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => removeDriver(d.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            <div className="mt-6 flex items-center justify-between p-4 bg-mv-primary/10 rounded-xl border border-mv-primary/30">
              <div>
                <div className="font-bold text-lg text-mv-primary">Ready to activate {selDrivers.length} rentals</div>
                <div className="text-sm text-mv-muted">Daily collections will be managed via the driver app & dashboard.</div>
              </div>
              <PrimaryBtn onClick={submit} disabled={busy} size="lg">
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                Activate All
              </PrimaryBtn>
            </div>
          </div>
        )}

      </div>

      <div className="flex justify-between mt-5">
        <GhostBtn onClick={() => step > 1 ? setStep(step - 1) : nav("/rentals")}>{step > 1 ? "Back" : "Cancel"}</GhostBtn>
        {step < 6 && (
          <PrimaryBtn onClick={handleNext} disabled={!canNext()} data-testid="wizard-next">
            Continue <ArrowRight className="w-4 h-4 ml-1" />
          </PrimaryBtn>
        )}
      </div>
    </div>
  );
}
