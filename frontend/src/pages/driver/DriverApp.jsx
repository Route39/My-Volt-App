import { Routes, Route, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { Home, KeyRound, Receipt, User, Loader2 } from "lucide-react";
import { DriverAuthProvider, useDriver } from "../../context/DriverAuthContext";
import DriverLogin from "./DriverLogin";
import DriverHome from "./DriverHome";
import DriverRental from "./DriverRental";
import DriverPayments from "./DriverPayments";
import DriverProfile from "./DriverProfile";

const NAV = [
  { to: "/driver", label: "Home", icon: Home, end: true },
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
  return (
    <div className="h-[100dvh] bg-slate-50 flex flex-col overflow-hidden">
      <div className="max-w-md w-full mx-auto flex flex-col h-full bg-slate-50 relative">
        <div className="flex-1 overflow-y-auto pb-6">
          <Outlet />
        </div>
        <nav className="shrink-0 bg-white border-t border-slate-100 flex items-center justify-around h-16 z-40">
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

export default function DriverApp() {
  return (
    <DriverAuthProvider>
      <Routes>
        <Route path="/driver/login" element={<DriverLogin />} />
        <Route element={<RequireDriver />}>
          <Route element={<DriverShell />}>
            <Route path="/driver" element={<DriverHome />} />
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
