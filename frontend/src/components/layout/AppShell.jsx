import { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Car, Users, KeyRound, Wrench, ClipboardList, MapPin,
  FileText, AlertTriangle, HeartPulse, BarChart3, Settings, Search, LogOut,
  Zap, MoreHorizontal, ChevronDown, Bike, FileBadge, Banknote, Package
} from "lucide-react";
import { useAuth, roleLabel } from "../../context/AuthContext";
import { useApp, CITIES } from "../../context/AppContext";
import GlobalSearch from "./GlobalSearch";
import Notifications from "./Notifications";
import { QuickActionMenu, QuickActionButton } from "./QuickActions";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { Avatar, AvatarFallback } from "../ui/avatar";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mod: "dashboard" },
  { to: "/drivers", label: "Drivers", icon: Users, mod: "drivers" },
  { to: "/fleet", label: "Vehicles", icon: Car, mod: "fleet" },
  { to: "/packages", label: "Rental Packages", icon: Package, mod: "settings" },
  { to: "/rentals", label: "Rentals", icon: KeyRound, mod: "rentals" },
  { to: "/daily-collection", label: "Daily Collection", icon: Banknote, mod: "rentals" },
  { to: "/odometer", label: "Odometer Logs", icon: Car, mod: "drivers" },
  { to: "/kyc", label: "KYC Approvals", icon: FileBadge, mod: "drivers" },
  { to: "/service-requests", label: "Service Requests", icon: Wrench, mod: "service" },
  { to: "/vehicle-service", label: "Vehicle Service", icon: ClipboardList, mod: "service" },
  { to: "/documents", label: "Documents", icon: FileText, mod: "documents" },
  { to: "/incidents", label: "Incidents", icon: AlertTriangle, mod: "incidents" },
  { to: "/vehicle-health", label: "Vehicle Health", icon: HeartPulse, mod: "health" },
  { to: "/reports", label: "Reports", icon: BarChart3, mod: "reports" },
  { to: "/settings", label: "Settings", icon: Settings, mod: "settings" },
];

const ROLE_MODULES = {
  admin: null,
  city_manager: ["dashboard", "fleet", "drivers", "rentals", "service", "locations", "documents", "incidents", "health", "reports"],
};
const navForRole = (role) => { const a = ROLE_MODULES[role]; return a ? NAV.filter((n) => a.includes(n.mod)) : NAV; };

const MOBILE_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mod: "dashboard" },
  { to: "/fleet", label: "Vehicles", icon: Car, mod: "fleet" },
  { to: "/rentals", label: "Rentals", icon: KeyRound, mod: "rentals" },
];

function CitySelector() {
  const { city, setCity } = useApp();
  const { user } = useAuth();
  useEffect(() => { if (user?.role === "city_manager" && user?.city && city !== user.city) setCity(user.city); }, [user]);
  if (user?.role === "city_manager") {
    return (
      <div data-testid="city-selector" className="inline-flex items-center gap-2 h-9 px-3 rounded-xl border border-mv-border bg-mv-surface text-sm font-medium">
        <MapPin className="w-4 h-4 text-mv-primary" /> {user.city}
      </div>
    );
  }
  const label = city === "all" ? "All Cities" : city;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button data-testid="city-selector"
                className="inline-flex items-center gap-2 h-9 px-3 rounded-xl border border-mv-border bg-mv-surface hover:bg-mv-elevated text-sm font-medium transition-colors">
          <MapPin className="w-4 h-4 text-mv-primary" /> {label}
          <ChevronDown className="w-3.5 h-3.5 text-mv-dim" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-mv-surface border-mv-border text-mv-text">
        <DropdownMenuItem onClick={() => setCity("all")} data-testid="city-opt-all">All Cities</DropdownMenuItem>
        {CITIES.map((c) => (
          <DropdownMenuItem key={c} onClick={() => setCity(c)} data-testid={`city-opt-${c}`}>{c}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const nav = useNavigate();
  const initials = (user?.name || "U").split(" ").map((s) => s[0]).slice(0, 2).join("");
  const navItems = navForRole(user?.role);
  const mobileNav = MOBILE_NAV.filter((m) => navItems.find((n) => n.to === m.to));
  const brand = { name: user?.org_name || "MyVolt", tag: "Fleet Operations", icon: Zap };

  return (
    <div className="mv-noise min-h-screen flex bg-mv-bg">
      {/* Sidebar (desktop) */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-mv-border bg-mv-surface fixed inset-y-0 left-0 z-30">
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-mv-border">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
            <brand.icon className="w-5 h-5 text-white" fill="white" />
          </div>
          <div className="leading-none">
            <div className="font-display font-extrabold text-lg tracking-tight">{brand.name}</div>
            <div className="text-[10px] text-mv-dim tracking-wider uppercase mt-0.5">{brand.tag}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5 no-scrollbar">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} data-testid={`nav-${label.toLowerCase().replace(/ /g, "-")}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive ? "bg-mv-primary/15 text-mv-primary" : "text-mv-muted hover:text-mv-text hover:bg-mv-elevated"
                }`}>
              <Icon className="w-[18px] h-[18px]" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-mv-border">
          <div className="flex items-center gap-3 px-2 py-1">
            <Avatar className="w-9 h-9"><AvatarFallback className="bg-mv-elevated text-mv-text text-xs">{initials}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{user?.name}</div>
              <div className="text-[11px] text-mv-dim truncate">{roleLabel(user?.role)}</div>
            </div>
            <button onClick={logout} data-testid="logout-btn" className="text-mv-dim hover:text-red-400 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 lg:pl-64 min-w-0 relative z-10">
        {/* Top header */}
        <header className="h-16 sticky top-0 z-20 glass border-b border-mv-border flex items-center gap-3 px-4 sm:px-6">
          <div className="lg:hidden flex items-center gap-2 mr-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              <brand.icon className="w-4 h-4 text-white" fill="white" />
            </div>
            <span className="font-display font-bold">{brand.name}</span>
          </div>
          <button onClick={() => setSearchOpen(true)} data-testid="open-search"
                  className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-xl border border-mv-border bg-mv-surface hover:bg-mv-elevated text-mv-dim text-sm flex-1 max-w-xs transition-colors">
            <Search className="w-4 h-4" /> Search…
            <kbd className="ml-auto text-[10px] border border-mv-border rounded px-1.5">⌘K</kbd>
          </button>
          <button onClick={() => setSearchOpen(true)} className="sm:hidden w-9 h-9 rounded-xl border border-mv-border bg-mv-surface flex items-center justify-center">
            <Search className="w-4 h-4 text-mv-muted" />
          </button>
          <div className="ml-auto flex items-center gap-2.5">
            {<CitySelector />}
            <Notifications />
          </div>
        </header>

        <main className="px-4 sm:px-6 py-6 pb-28 lg:pb-10 max-w-[1600px] mx-auto">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass border-t border-mv-border flex items-center justify-around h-16 px-2">
        {mobileNav.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} data-testid={`mnav-${label.toLowerCase()}`}
            className={({ isActive }) => `flex flex-col items-center gap-1 text-[10px] font-medium ${isActive ? "text-mv-primary" : "text-mv-dim"}`}>
            <Icon className="w-5 h-5" /> {label}
          </NavLink>
        ))}
        <button onClick={() => setMoreOpen(true)} data-testid="mnav-more" className="flex flex-col items-center gap-1 text-[10px] font-medium text-mv-dim">
          <MoreHorizontal className="w-5 h-5" /> More
        </button>
      </nav>

      <QuickActionButton floating onClick={() => setQaOpen(true)} />
      <QuickActionMenu open={qaOpen} setOpen={setQaOpen} />
      <GlobalSearch open={searchOpen} setOpen={setSearchOpen} />

      {/* Mobile More sheet */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-[70]" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm mv-fade" />
          <div className="absolute bottom-0 inset-x-0 mv-card glass rounded-b-none rounded-t-2xl p-4 mv-rise" onClick={(e) => e.stopPropagation()}>
            <div className="mv-label mb-3 px-1">More</div>
            <div className="grid grid-cols-3 gap-2">
              {navItems.filter((n) => !mobileNav.find((m) => m.to === n.to)).map(({ to, label, icon: Icon }) => (
                <button key={to} onClick={() => { setMoreOpen(false); nav(to); }}
                        className="mv-card-hover mv-card p-3 flex flex-col items-center gap-2 text-center">
                  <Icon className="w-5 h-5 text-mv-muted" />
                  <span className="text-[11px] text-mv-text leading-tight">{label}</span>
                </button>
              ))}
            </div>
            <button onClick={logout} className="mt-3 w-full py-3 rounded-xl border border-mv-border text-red-400 text-sm font-medium">
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
