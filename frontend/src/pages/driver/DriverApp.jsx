import { Routes, Route, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Home, KeyRound, Receipt, User, Loader2, FileBadge, Ban, Clock, PhoneCall, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { DriverAuthProvider, useDriver } from "../../context/DriverAuthContext";
import DriverLogin from "./DriverLogin";
import DriverHome from "./DriverHome";
import DriverRental from "./DriverRental";
import DriverPayments from "./DriverPayments";
import DriverProfile from "./DriverProfile";
import DriverKYC from "./DriverKYC";

const NAV = [
  { to: "/driver", label: "Home", icon: Home, end: true },
  { to: "/driver/kyc", label: "KYC", icon: FileBadge },
  { to: "/driver/rental", label: "Rental", icon: KeyRound },
  { to: "/driver/payments", label: "Payments", icon: Receipt },
  { to: "/driver/profile", label: "Profile", icon: User },
];

function RequireDriver() {
  const { authed, loading } = useDriver();
  const loc = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-white"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>;
  if (!authed) return <Navigate to="/driver/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

function DriverShell() {
  const nav = useNavigate();
  const loc = useLocation();
  const [touchStart, setTouchStart] = useState(null);
  const { data, refresh } = useDriver();

  // Check block status every 20 sec (block/unblock applies automatically)
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleTouchStart = (e) => setTouchStart({ x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY });
  const handleTouchEnd = (e) => {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    setTouchStart(null);
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
      const idx = NAV.findIndex(n => n.to === loc.pathname || (n.to !== "/driver" && loc.pathname.startsWith(n.to)));
      if (idx !== -1) {
        if (dx > 0 && idx > 0) nav(NAV[idx - 1].to);
        if (dx < 0 && idx < NAV.length - 1) nav(NAV[idx + 1].to);
      }
    }
  };

  if (data?.admin_block) return <AdminBlockedScreen type={data.admin_block} reason={data.admin_block_reason} />;

  return (
    <div className="h-[100dvh] bg-slate-50 flex flex-col overflow-hidden" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="max-w-md w-full mx-auto flex flex-col h-full bg-slate-50 relative">
        <div className="flex-1 overflow-y-auto pb-6">
          <Outlet />
        </div>
        <nav className="shrink-0 bg-white border-t border-slate-100 flex items-center justify-around h-16 z-40 px-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} data-testid={`dnav-${label.toLowerCase()}`}
              className={({ isActive }) => `flex flex-col items-center gap-1 text-[11px] font-medium transition-colors ${isActive ? "text-emerald-600" : "text-slate-400"}`}>
              <Icon className="w-5 h-5" /> {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

const SUPPORT_PHONE = "+919626499399"; // TODO: support number

function AdminBlockedScreen({ type, reason }) {
  const { logout, refresh } = useDriver();
  const permanent = type === "permanent";
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center px-6" data-testid="admin-blocked-screen">
      <div className="w-full max-w-sm bg-white rounded-3xl p-7 text-center shadow-xl">
        <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-5 ${permanent ? "bg-red-100" : "bg-amber-100"}`}>
          {permanent ? <Ban className="w-10 h-10 text-red-600" /> : <Clock className="w-10 h-10 text-amber-600" />}
        </div>
        <h1 className="text-xl font-extrabold text-slate-900">
          {permanent ? "Your ID is Permanently Blocked" : "Your ID is Temporarily Blocked"}
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          {permanent
            ? "Your driver account has been permanently blocked. You can no longer use this app."
            : "Your driver account has been temporarily blocked. You cannot use the app until it is unblocked."}
        </p>
        {reason && (
          <div className="mt-4 p-3 rounded-2xl bg-slate-50 border border-slate-100 text-left">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Reason</div>
            <div className="text-sm text-slate-700 mt-1">{reason}</div>
          </div>
        )}
        <a href={`tel:${SUPPORT_PHONE}`}
          className="mt-6 w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center justify-center gap-2">
          <PhoneCall className="w-4 h-4" /> Contact Support
        </a>
        {!permanent && (
          <button onClick={refresh} className="mt-3 text-sm text-slate-500 underline">Check again</button>
        )}
        <button onClick={logout} className="mt-4 w-full text-xs text-slate-400 flex items-center justify-center gap-1">
          <LogOut className="w-3.5 h-3.5" /> Logout
        </button>
      </div>
    </div>
  );
}

export default function DriverApp() {
  return (
    <DriverAuthProvider>
      <Routes>
        <Route path="/driver/login" element={<DriverLogin />} />
        <Route element={<RequireDriver />}>
          <Route element={<DriverShell />}>
            <Route path="/driver" element={<DriverHome />} />
            <Route path="/driver/kyc" element={<DriverKYC />} />
            <Route path="/driver/rental" element={<DriverRental />} />
            <Route path="/driver/payments" element={<DriverPayments />} />
            <Route path="/driver/profile" element={<DriverProfile />} />
          </Route>
        </Route>
        <Route path="/driver/*" element={<Navigate to="/driver" replace />} />
      </Routes>
    </DriverAuthProvider>
  );
}
