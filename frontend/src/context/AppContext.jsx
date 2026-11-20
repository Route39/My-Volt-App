import { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext";

const AppCtx = createContext(null);

export function AppProvider({ children }) {
  const { user } = useAuth();
  // City managers are locked to their own city; admins can see every city.
  const lockedCity = user?.role === "city_manager" && user?.city ? user.city : null;
  const cities = lockedCity ? [lockedCity] : CITIES;
  const [city, setCity] = useState(lockedCity || "all");

  useEffect(() => {
    if (lockedCity) setCity(lockedCity);
    else {
      let saved = null;
      try { saved = localStorage.getItem("mv_city"); } catch (e) {}
      if (saved) setCity(saved);
      else if (user?.city) setCity(user.city);
    }
  }, [user, lockedCity]);

  const setCityPersist = async (c) => {
    if (lockedCity) c = lockedCity;
    setCity(c);
    try { localStorage.setItem("mv_city", c); } catch (e) {}
  };

  return (
    <AppCtx.Provider value={{ city: lockedCity || city, setCity: setCityPersist, lockedCity, cities }}>{children}</AppCtx.Provider>
  );
}

export const useApp = () => useContext(AppCtx);
export const CITIES = ["Tiruppur", "Coimbatore", "Chennai", "Bangalore"];
