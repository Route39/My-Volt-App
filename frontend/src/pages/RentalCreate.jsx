import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, User, Car, KeyRound, Calendar, Wallet, CreditCard, Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { Field, TextInput, PrimaryBtn, GhostBtn } from "../components/common/Page";
import { inr, fmtDate } from "../lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const STEPS = [
  { n: 1, label: "Driver", icon: User },
  { n: 2, label: "Vehicle", icon: Car },
  { n: 3, label: "Plan", icon: KeyRound },
  { n: 4, label: "Dates", icon: Calendar },
  { n: 5, label: "Deposit", icon: Wallet },
  { n: 6, label: "Payment", icon: CreditCard },
  { n: 7, label: "Activate", icon: Zap },
];

export default function RentalCreate() {
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ driver_id: "", vehicle_id: "", plan_id: "", start: new Date().toISOString().slice(0, 10), end: "", amount: 0, deposit: 0, pay_now: 0, method: "upi", reference: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    api.get("/drivers").then((r) => setDrivers(r.data));
    api.get("/vehicles", { params: { status: "available", page_size: 200 } }).then((r) => setVehicles(r.data.items));
    api.get("/rental-plans").then((r) => setPlans(r.data.filter((p) => p.active)));
  }, []);

  const driver = drivers.find((d) => d.id === f.driver_id);
  const vehicle = vehicles.find((v) => v.id === f.vehicle_id);
  const plan = plans.find((p) => p.id === f.plan_id);

  const pickPlan = (id) => {
    const p = plans.find((x) => x.id === id);
    const start = new Date(f.start);
    const end = new Date(start.getTime() + (p?.duration_days || 1) * 86400000);
    set("plan_id", id); set("amount", p?.amount || 0); set("deposit", p?.deposit || 0); set("end", end.toISOString().slice(0, 10));
  };

  const canNext = () => {
    if (step === 1) return !!f.driver_id;
    if (step === 2) return !!f.vehicle_id;
    if (step === 3) return !!f.plan_id;
    if (step === 4) return !!f.start && !!f.end;
    return true;
  };

  const submit = async (activate) => {
    setBusy(true);
    try {
      const { data } = await api.post("/rentals", {
        driver_id: f.driver_id, vehicle_id: f.vehicle_id, plan_id: f.plan_id,
        start: new Date(f.start).toISOString(), end: new Date(f.end).toISOString(),
        amount: Number(f.amount), deposit: Number(f.deposit),
      });
      if (Number(f.pay_now) > 0) await api.post(`/rentals/${data.id}/payments`, { amount: Number(f.pay_now), method: f.method, reference: f.reference, type: "payment" });
      if (activate) { await api.post(`/rentals/${data.id}/activate`); toast.success("Rental activated ✓"); } else toast.success("Rental created ✓");
      nav(`/rentals/${data.id}`);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to create rental"); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => nav("/rentals")} className="flex items-center gap-1.5 text-sm text-mv-muted hover:text-mv-text mb-4"><ArrowLeft className="w-4 h-4" /> Rentals</button>
      <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight mb-6">Create Rental</h1>

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

      <div className="mv-card p-6 min-h-[280px]">
        {step === 1 && <StepPick title="Select Driver" items={drivers} value={f.driver_id} onSelect={(id) => set("driver_id", id)} render={(d) => ({ t: d.name, s: `${d.phone} · ${d.city}` })} testid="wizard-driver" />}
        {step === 2 && <StepPick title="Select Vehicle" items={vehicles} value={f.vehicle_id} onSelect={(id) => set("vehicle_id", id)} render={(v) => ({ t: v.vehicle_number, s: `${v.registration_number} · ${v.city}` })} empty="No available vehicles" testid="wizard-vehicle" />}
        {step === 3 && (
          <div>
            <h3 className="font-display font-semibold mb-4">Select Rental Plan</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {plans.map((p) => (
                <button key={p.id} onClick={() => pickPlan(p.id)} data-testid={`wizard-plan-${p.id}`}
                        className={`mv-card p-4 text-left transition-colors ${f.plan_id === p.id ? "border-mv-primary bg-mv-primary/10" : "mv-card-hover"}`}>
                  <div className="flex items-center justify-between"><span className="font-semibold">{p.name}</span><span className="font-display font-bold">{inr(p.amount)}</span></div>
                  <div className="text-xs text-mv-dim mt-1">{p.duration_days} day(s) · Deposit {inr(p.deposit)}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 4 && (
          <div>
            <h3 className="font-display font-semibold mb-4">Rental Period</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start Date"><TextInput type="date" value={f.start} onChange={(e) => set("start", e.target.value)} /></Field>
              <Field label="End Date"><TextInput type="date" value={f.end} onChange={(e) => set("end", e.target.value)} /></Field>
            </div>
          </div>
        )}
        {step === 5 && (
          <div>
            <h3 className="font-display font-semibold mb-4">Amount & Deposit</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Rental Amount (₹)"><TextInput type="number" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
              <Field label="Deposit (₹)"><TextInput type="number" value={f.deposit} onChange={(e) => set("deposit", e.target.value)} /></Field>
            </div>
            <div className="mt-4 mv-card bg-mv-surface2 p-4 text-sm flex justify-between"><span className="text-mv-muted">Total due at start</span><span className="font-display font-bold text-lg">{inr(Number(f.amount) + Number(f.deposit))}</span></div>
          </div>
        )}
        {step === 6 && (
          <div>
            <h3 className="font-display font-semibold mb-4">Collect Payment</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Pay Now (₹)"><TextInput type="number" value={f.pay_now} onChange={(e) => set("pay_now", e.target.value)} placeholder={String(Number(f.amount) + Number(f.deposit))} /></Field>
              <Field label="Method">
                <Select value={f.method} onValueChange={(v) => set("method", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["upi", "cash", "card", "bank"].map((m) => <SelectItem key={m} value={m} className="uppercase">{m}</SelectItem>)}</SelectContent></Select>
              </Field>
              <Field label="Reference / Txn ID"><TextInput value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
            </div>
            <p className="text-xs text-mv-dim mt-3">Leave 0 to mark as pending payment.</p>
          </div>
        )}
        {step === 7 && (
          <div>
            <h3 className="font-display font-semibold mb-4">Review & Activate</h3>
            <div className="space-y-2 text-sm">
              {[["Driver", driver?.name], ["Vehicle", vehicle?.vehicle_number], ["Plan", plan?.name], ["Period", `${fmtDate(f.start)} → ${fmtDate(f.end)}`], ["Amount", inr(f.amount)], ["Deposit", inr(f.deposit)], ["Paying now", inr(f.pay_now)]].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2 border-b border-mv-border/50"><span className="text-mv-muted">{k}</span><span className="font-medium">{v}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between mt-5">
        <GhostBtn onClick={() => step > 1 ? setStep(step - 1) : nav("/rentals")}>{step > 1 ? "Back" : "Cancel"}</GhostBtn>
        {step < 7 ? (
          <PrimaryBtn onClick={() => setStep(step + 1)} disabled={!canNext()} data-testid="wizard-next">Continue <ArrowRight className="w-4 h-4" /></PrimaryBtn>
        ) : (
          <div className="flex gap-2">
            <GhostBtn onClick={() => submit(false)} disabled={busy}>Save as Draft</GhostBtn>
            <PrimaryBtn onClick={() => submit(true)} disabled={busy} data-testid="wizard-activate">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Activate Rental</PrimaryBtn>
          </div>
        )}
      </div>
    </div>
  );
}

function StepPick({ title, items, value, onSelect, render, empty, testid }) {
  const [q, setQ] = useState("");
  const filtered = items.filter((it) => { const r = render(it); return (r.t + r.s).toLowerCase().includes(q.toLowerCase()); });
  return (
    <div>
      <h3 className="font-display font-semibold mb-3">{title}</h3>
      <TextInput placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" data-testid={`${testid}-search`} />
      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
        {filtered.length === 0 && <div className="text-sm text-mv-dim py-8 text-center">{empty || "No results"}</div>}
        {filtered.map((it) => { const r = render(it); return (
          <button key={it.id} onClick={() => onSelect(it.id)} data-testid={`${testid}-${it.id}`}
                  className={`w-full mv-card p-3 flex items-center justify-between transition-colors ${value === it.id ? "border-mv-primary bg-mv-primary/10" : "mv-card-hover"}`}>
            <div className="text-left"><div className="font-medium">{r.t}</div><div className="text-xs text-mv-dim">{r.s}</div></div>
            {value === it.id && <Check className="w-4 h-4 text-mv-primary" />}
          </button>
        ); })}
      </div>
    </div>
  );
}
