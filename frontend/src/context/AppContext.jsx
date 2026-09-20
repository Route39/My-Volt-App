import { createContext, useContext, useState, useEffect } from "react";
import api from "../lib/api";
import { useAuth } from "./AuthContext";

const AppCtx = createContext(null);

export function AppProvider({ children }) {
  const { user } = useAuth();
  const [city, setCity] = useState("all");

  useEffect(() => {
    if (user?.city) setCity(user.city);
  }, [user]);

  const setCityPersist = async (c) => {
    setCity(c);
    if (user) {
      try { await api.post("/admin/preferences/city", { city: c }); } catch (e) {}
    }
  };

  return (
    <AppCtx.Provider value={{ city, setCity: setCityPersist }}>{children}</AppCtx.Provider>
  );
}

export const useApp = () => useContext(AppCtx);
export const CITIES = ["Tiruppur", "Coimbatore", "Chennai", "Bangalore"];
