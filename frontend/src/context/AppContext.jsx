import { createContext, useContext, useState } from "react";

const AppCtx = createContext(null);

export function AppProvider({ children }) {
  const [city, setCity] = useState(localStorage.getItem("mv_city") || "all");
  const setCityPersist = (c) => { setCity(c); localStorage.setItem("mv_city", c); };
  return (
    <AppCtx.Provider value={{ city, setCity: setCityPersist }}>{children}</AppCtx.Provider>
  );
}

export const useApp = () => useContext(AppCtx);
export const CITIES = ["Tiruppur", "Coimbatore", "Chennai", "Bangalore"];
