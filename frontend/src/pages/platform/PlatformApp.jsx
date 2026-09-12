import { useEffect, useState } from "react";
import { Routes, Route, Navigate, NavLink, useNavigate, useParams } from "react-router-dom";
import {
  LayoutDashboard, Building2, CreditCard, Layers, UsersRound, Settings as SettingsIcon,
  Zap, LogOut, Plus, Search, ArrowLeft, ArrowRight, CheckCircle2, Clock, Users as UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { AnimatedCounter, Skeleton, EmptyState } from "../../components/common/Primitives";
import { PageHeader, PrimaryBtn, GhostBtn, Field, TextInput, FilterChip } from "../../components/common/Page";
import { fmtDate, timeAgo } from "../../lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";

const NAV = [
  { to: "/platform/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/platform/companies", label: "Companies", icon: Building2 },
  { to: "/platform/subscriptions", label: "Subscriptions", icon: CreditCard },
  { to: "/platform/industries", label: "Industries", icon: Layers },
  { to: "/platform/users", label: "Platform Users", icon: UsersRound },
  { to: "/platform/settings", label: "Settings", icon: SettingsIcon },
];

const StatusPill = ({ s }) => (
  <span className={`chip ${s === "active" ? "chip-green" : s === "trial" ? "chip-amber" : "chip-neutral"}`}>
    <span className="w-1.5 h-1.5 rounded-full bg-current" />{s === "active" ? "Active" : s === "trial" ? "Trial" : "Inactive"}
  </span>
);

function Shell({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const initials = (user?.name || "P").split(" ").map((s) => s[0]).slice(0, 2).join("");
  return (
    <div className="mv-noise min-h-screen flex bg-mv-bg">
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-mv-border bg-mv-surface fixed inset-y-0 left-0 z-30">
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-mv-border">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center"><Zap className="w-5 h-5 text-white" fill="white" /></div>
          <div className="leading-none"><div className="font-display font-extrabold text-lg tracking-tight">MyVolt</div><div className="text-[10px] text-mv-dim tracking-wider uppercase mt-0.5">Platform Admin</div></div>
        </div>
        <nav className="flex-1 py-3 px-3 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} data-testid={`pnav-${label.toLowerCase().replace(/ /g, "-")}`}
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? "bg-mv-primary/12 text-mv-primary" : "text-mv-muted hover:text-mv-text hover:bg-mv-elevated"}`}>
              <Icon className="w-[18px] h-[18px]" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-mv-border flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-mv-elevated flex items-center justify-center text-xs font-semibold">{initials}</div>
          <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{user?.name}</div><div className="text-[11px] text-mv-dim">Platform Admin</div></div>
          <button onClick={logout} data-testid="logout-btn" className="text-mv-dim hover:text-red-500"><LogOut className="w-4 h-4" /></button>
        </div>
      </aside>
      <div className="flex-1 lg:pl-64 min-w-0 relative z-10">
        <header className="h-16 sticky top-0 z-20 glass border-b border-mv-border flex items-center px-4 sm:px-6">
          <div className="lg:hidden flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center"><Zap className="w-4 h-4 text-white" fill="white" /></div><span className="font-display font-bold">MyVolt</span></div>
          <span className="ml-auto text-sm text-mv-muted">Platform Administration</span>
        </header>
        <main className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto">{children}</main>
      </div>
    </div>
  );
}

function Dashboard() {
  const [s, setS] = useState(null);
  const [cos, setCos] = useState(null);
  const nav = useNavigate();
  useEffect(() => { api.get("/platform/summary").then((r) => setS(r.data)); api.get("/platform/companies").then((r) => setCos(r.data)); }, []);
  const kpis = s ? [
    { l: "Total Companies", v: s.total_companies }, { l: "Active Companies", v: s.active_companies },
    { l: "Trial Companies", v: s.trial_companies }, { l: "Total Users", v: s.total_users }, { l: "Active Subscriptions", v: s.active_subscriptions },
  ] : [];
  return (
    <div>
      <PageHeader title="MYVOLT" subtitle="Platform Administration" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
        {!s && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        {kpis.map((k, i) => (
          <div key={k.l} className="mv-card p-5 mv-rise" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="font-display text-3xl font-bold"><AnimatedCounter value={k.v} /></div>
            <div className="mv-label mt-1">{k.l}</div>
          </div>
        ))}
      </div>
      <h3 className="font-display text-lg font-semibold mb-3">Companies Overview</h3>
      <CompaniesTable rows={cos} onOpen={(id) => nav(`/platform/companies/${id}`)} />
    </div>
  );
}

function CompaniesTable({ rows, onOpen }) {
  if (!rows) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>;
  if (rows.length === 0) return <EmptyState icon={Building2} title="No companies yet." subtitle="Add your first company to get started." />;
  return (
    <div className="mv-card overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-mv-border text-left mv-label"><th className="px-4 py-3">Company</th><th className="px-4 py-3">Industry</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Users</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Created</th><th className="px-4 py-3"></th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.org_id} onClick={() => onOpen(c.org_id)} data-testid={`company-row-${c.org_id}`} className="border-b border-mv-border/50 hover:bg-mv-elevated cursor-pointer transition-colors">
              <td className="px-4 py-3 font-semibold flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-blue-500/12 flex items-center justify-center"><Building2 className="w-4 h-4 text-mv-primary" /></div>{c.name}</td>
              <td className="px-4 py-3">{c.industry_label}</td><td className="px-4 py-3">{c.plan}</td>
              <td className="px-4 py-3">{c.users} users</td><td className="px-4 py-3"><StatusPill s={c.status} /></td>
              <td className="px-4 py-3 text-mv-muted">{fmtDate(c.created_at)}</td>
              <td className="px-4 py-3 text-mv-dim"><ArrowRight className="w-4 h-4" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Companies() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState(""); const [ind, setInd] = useState("all"); const [st, setSt] = useState("all");
  const nav = useNavigate();
  const load = () => { const p = {}; if (q) p.q = q; if (ind !== "all") p.industry = ind; if (st !== "all") p.status = st; api.get("/platform/companies", { params: p }).then((r) => setRows(r.data)); };
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [q, ind, st]);
  return (
    <div>
      <PageHeader title="Companies" subtitle="All organizations on the MyVolt platform">
        <PrimaryBtn onClick={() => nav("/platform/companies/new")} data-testid="add-company-btn"><Plus className="w-4 h-4" /> Add Company</PrimaryBtn>
      </PageHeader>
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mv-dim" /><input value={q} onChange={(e) => setQ(e.target.value)} data-testid="company-search" placeholder="Search company…" className="w-full h-10 pl-9 pr-3 rounded-xl bg-mv-surface border border-mv-border outline-none focus:border-mv-primary text-sm" /></div>
        <Select value={ind} onValueChange={setInd}><SelectTrigger className="w-52 h-10 bg-mv-surface border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text"><SelectItem value="all">All Industries</SelectItem><SelectItem value="fleet">Fleet & Rental</SelectItem></SelectContent></Select>
        <Select value={st} onValueChange={setSt}><SelectTrigger className="w-36 h-10 bg-mv-surface border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text"><SelectItem value="all">All Status</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="trial">Trial</SelectItem></SelectContent></Select>
      </div>
      <CompaniesTable rows={rows} onOpen={(id) => nav(`/platform/companies/${id}`)} />
    </div>
  );
}

const slugify = (s) => (s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const INDUSTRY_LABEL = { fleet: "Fleet & Rental" };

function AddCompany() {
  const nav = useNavigate();
  const [f, setF] = useState({
    name: "", code: "", industry: "fleet", plan: "Trial", status: "trial",
    admin: { name: "", email: "", phone: "", password: "" },
  });
  const [codeTouched, setCodeTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setName = (v) => setF((s) => ({ ...s, name: v, code: codeTouched ? s.code : slugify(v) }));
  const setCode = (v) => { setCodeTouched(true); set("code", slugify(v)); };
  const setAdmin = (k, v) => setF((s) => ({ ...s, admin: { ...s.admin, [k]: v } }));

  const save = async () => {
    if (!f.name.trim()) { toast.error("Company name is required"); return; }
    if (!f.code.trim()) { toast.error("Company code is required"); return; }
    if (!f.admin.name.trim()) { toast.error("Admin name is required"); return; }
    if (!f.admin.email.trim()) { toast.error("Admin email is required"); return; }
    if (!f.admin.password.trim() || f.admin.password.length < 6) { toast.error("Temporary password must be at least 6 characters"); return; }
    setSaving(true);
    try {
      const payload = { name: f.name.trim(), code: f.code.trim(), industry: f.industry, plan: f.plan, status: f.status,
        admin: { name: f.admin.name.trim(), email: f.admin.email.trim().toLowerCase(), phone: f.admin.phone.trim(), password: f.admin.password } };
      const { data } = await api.post("/platform/companies", payload);
      toast.success("Company created ✓");
      setDone(data);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to create company"); }
    finally { setSaving(false); }
  };

  if (done) {
    const c = done.company || {}; const a = done.admin || {};
    return (
      <div className="max-w-xl mx-auto" data-testid="onboard-success">
        <div className="mv-card p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-500/12 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-9 h-9 text-green-600" /></div>
          <h1 className="font-display text-2xl font-bold" data-testid="onboard-success-title">Company created</h1>
          <p className="text-mv-muted text-sm mt-1">The organization and its first administrator are ready to go.</p>
          <div className="mv-card bg-mv-surface2/60 p-5 mt-6 text-left space-y-3">
            {[["Company", c.name], ["Industry", c.industry_label || INDUSTRY_LABEL[c.industry] || c.industry],
              ["Admin", a.name], ["Admin Email", a.email]].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4">
                <span className="mv-label">{k}</span>
                <span className="text-sm font-medium text-right" data-testid={`success-${k.toLowerCase().replace(/ /g, "-")}`}>{v || "—"}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 mt-6">
            <GhostBtn onClick={() => nav("/platform/companies")} data-testid="back-to-companies-btn">Back to Companies</GhostBtn>
            <PrimaryBtn onClick={() => nav(`/platform/companies/${c.org_id}`)} data-testid="open-company-btn">Open Company <ArrowRight className="w-4 h-4" /></PrimaryBtn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <button onClick={() => nav("/platform/companies")} className="flex items-center gap-1.5 text-sm text-mv-muted hover:text-mv-text mb-4"><ArrowLeft className="w-4 h-4" /> Companies</button>
      <PageHeader title="Add Company" subtitle="Onboard a new organization and its first administrator" />

      <div className="mv-card p-6 mb-4">
        <h3 className="font-display font-semibold mb-4 flex items-center gap-2"><Building2 className="w-4 h-4 text-mv-primary" /> Company</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company Name"><TextInput value={f.name} onChange={(e) => setName(e.target.value)} placeholder="Acme Textiles" data-testid="company-name" /></Field>
          <Field label="Company Code"><TextInput value={f.code} onChange={(e) => setCode(e.target.value)} placeholder="auto from name" data-testid="company-code" /></Field>
          <div className="col-span-2"><Field label="Industry"><Select value={f.industry} onValueChange={(v) => set("industry", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border" data-testid="company-industry"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text"><SelectItem value="fleet">Fleet & Rental</SelectItem></SelectContent></Select></Field></div>
          <Field label="Subscription Plan"><Select value={f.plan} onValueChange={(v) => set("plan", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border" data-testid="company-plan"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["Trial", "Starter", "Professional", "Enterprise"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Status"><Select value={f.status} onValueChange={(v) => set("status", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border" data-testid="company-status"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["trial", "active", "inactive"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent></Select></Field>
        </div>
      </div>

      <div className="mv-card p-6">
        <h3 className="font-display font-semibold mb-1 flex items-center gap-2"><UsersIcon className="w-4 h-4 text-mv-primary" /> First Administrator</h3>
        <p className="text-mv-muted text-xs mb-4">This person will sign in with the temporary password and manage the company.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Full Name"><TextInput value={f.admin.name} onChange={(e) => setAdmin("name", e.target.value)} placeholder="Jane Doe" data-testid="admin-name" /></Field>
          <Field label="Email"><TextInput value={f.admin.email} onChange={(e) => setAdmin("email", e.target.value)} placeholder="jane@company.com" data-testid="admin-email" /></Field>
          <Field label="Phone"><TextInput value={f.admin.phone} onChange={(e) => setAdmin("phone", e.target.value)} placeholder="+91 90000 00000" data-testid="admin-phone" /></Field>
          <Field label="Temporary Password"><TextInput type="password" value={f.admin.password} onChange={(e) => setAdmin("password", e.target.value)} placeholder="Min. 6 characters" data-testid="admin-password" /></Field>
        </div>
        <div className="flex justify-end pt-5">
          <PrimaryBtn onClick={save} disabled={saving} data-testid="save-company-btn">{saving ? "Creating…" : "Create Company"}</PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

function CompanyProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState(null);
  useEffect(() => { api.get(`/platform/companies/${id}`).then((r) => setC(r.data)); }, [id]);
  if (!c) return <div className="space-y-4"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /></div>;
  return (
    <div>
      <button onClick={() => nav("/platform/companies")} className="flex items-center gap-1.5 text-sm text-mv-muted hover:text-mv-text mb-4"><ArrowLeft className="w-4 h-4" /> Companies</button>
      <div className="mv-card p-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-blue-500/12 flex items-center justify-center shrink-0"><Building2 className="w-8 h-8 text-mv-primary" /></div>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap"><h1 className="font-display text-2xl font-bold">{c.name}</h1><StatusPill s={c.status} /></div>
          <div className="text-mv-muted text-sm mt-1">{c.industry_label} · {c.plan}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        {[["Primary Contact", c.contact_name || "—"], ["Users", `${c.users}`], ["Created", fmtDate(c.created_at)], ["Last Activity", c.last_activity ? timeAgo(c.last_activity) : "—"]].map(([k, v]) => (
          <div key={k} className="mv-card p-4"><div className="mv-label">{k}</div><div className="text-sm font-medium mt-1">{v}</div></div>
        ))}
      </div>
      <div className="mv-card p-5 mt-4">
        <h3 className="font-display font-semibold mb-3 flex items-center gap-2"><Layers className="w-4 h-4 text-mv-primary" /> Enabled Modules</h3>
        <div className="flex flex-wrap gap-2">
          {(c.modules || []).map((m) => <span key={m} className="chip chip-blue capitalize">{m.replace("_", " ")}</span>)}
        </div>
      </div>
    </div>
  );
}

function Placeholder({ title, subtitle }) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState icon={Layers} title="Coming soon" subtitle={`${title} management will be available in a future update.`} />
    </div>
  );
}

export default function PlatformApp() {
  return (
    <Shell>
      <Routes>
        <Route path="/platform/dashboard" element={<Dashboard />} />
        <Route path="/platform/companies" element={<Companies />} />
        <Route path="/platform/companies/new" element={<AddCompany />} />
        <Route path="/platform/companies/:id" element={<CompanyProfile />} />
        <Route path="/platform/subscriptions" element={<Placeholder title="Subscriptions" subtitle="Plans and billing across companies" />} />
        <Route path="/platform/industries" element={<Placeholder title="Industries" subtitle="Industry configurations and modules" />} />
        <Route path="/platform/users" element={<Placeholder title="Platform Users" subtitle="MyVolt platform administrators" />} />
        <Route path="/platform/settings" element={<Placeholder title="Settings" subtitle="Platform configuration" />} />
        <Route path="*" element={<Navigate to="/platform/dashboard" replace />} />
      </Routes>
    </Shell>
  );
}
