import { useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppProvider } from "@/context/AppContext";
import AppShell from "@/components/layout/AppShell";
import { Loader2 } from "lucide-react";

import { Capacitor } from "@capacitor/core";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Fleet from "@/pages/Fleet";
import VehicleProfile from "@/pages/VehicleProfile";
import Drivers from "@/pages/Drivers";
import DriverProfile from "@/pages/DriverProfile";
import Rentals from "@/pages/Rentals";
import RentalCreate from "@/pages/RentalCreate";
import RentalProfile from "@/pages/RentalProfile";
import ServiceRequests from "@/pages/ServiceRequests";
import VehicleService from "@/pages/VehicleService";
import Locations from "@/pages/Locations";
import Incidents from "@/pages/Incidents";
import Packages from "@/pages/Packages";
import Settings from "@/pages/Settings";
import KycApprovals from "@/pages/KycApprovals";
import OdometerApprovals from "@/pages/OdometerApprovals";
import PlatformApp from "@/pages/platform/PlatformApp";
import DriverApp from "@/pages/driver/DriverApp";
import DailyCollection from "@/pages/DailyCollection";
import PrivacyPolicy from "@/pages/PrivacyPolicy";

const FLEET_PATHS = ["/fleet", "/drivers", "/rentals", "/service-requests", "/vehicle-service", "/locations", "/incidents"];

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading || user === null)
    return <div className="min-h-screen flex items-center justify-center bg-mv-bg"><Loader2 className="w-6 h-6 animate-spin text-mv-primary" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <AppShell>{children}</AppShell>;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

function DashboardRouter() { return <Dashboard />; }

function Shell() {
  const { user, loading } = useAuth();
  if (Capacitor.isNativePlatform() && !window.location.pathname.startsWith('/driver')) {
    window.location.replace('/driver');
    return null;
  }
  if (loading)
    return <div className="min-h-screen flex items-center justify-center bg-mv-bg"><Loader2 className="w-6 h-6 animate-spin text-mv-primary" /></div>;
  if (user && user.role === "platform_admin") return <PlatformApp />;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="/kyc" element={<Protected><KycApprovals /></Protected>} />
      <Route path="/odometer" element={<Protected><OdometerApprovals /></Protected>} />

      {/* Fleet (Route39) */}
      <Route path="/fleet" element={<Protected><Fleet /></Protected>} />
      <Route path="/fleet/:id" element={<Protected><VehicleProfile /></Protected>} />
      <Route path="/drivers" element={<Protected><Drivers /></Protected>} />
      <Route path="/drivers/:id" element={<Protected><DriverProfile /></Protected>} />
      <Route path="/rentals" element={<Protected><Rentals /></Protected>} />
      <Route path="/rentals/new" element={<Protected><RentalCreate /></Protected>} />
      <Route path="/rentals/:id" element={<Protected><RentalProfile /></Protected>} />
      <Route path="/daily-collection" element={<Protected><DailyCollection /></Protected>} />
      <Route path="/service-requests" element={<Protected><ServiceRequests /></Protected>} />
      <Route path="/vehicle-service" element={<Protected><VehicleService /></Protected>} />
      <Route path="/incidents" element={<Protected><Incidents /></Protected>} />
      <Route path="/packages" element={<Protected><Packages /></Protected>} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function Root() {
  const loc = useLocation();
  if (loc.pathname.startsWith("/driver/") || loc.pathname === "/driver") return <DriverApp />;
  return <Shell />;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <AppProvider>
          <BrowserRouter>
            <Root />
            <Toaster position="top-right" theme="light" richColors />
          </BrowserRouter>
        </AppProvider>
      </AuthProvider>
    </div>
  );
}

export default App;
