import { createContext, useContext, useEffect, useState, useCallback } from "react";
import dapi from "../lib/driverApi";

const Ctx = createContext(null);

export function DriverAuthProvider({ children }) {
  const [data, setData] = useState(null);      // full /driver/me payload
  const [authed, setAuthed] = useState(!!localStorage.getItem("ev_token"));
  const [loading, setLoading] = useState(!!localStorage.getItem("ev_token"));

  const refresh = useCallback(async () => {
    if (!localStorage.getItem("ev_token")) { setLoading(false); setAuthed(false); return; }
    try {
      const { data } = await dapi.get("/driver/me");
      setData(data); setAuthed(true);
    } catch {
      localStorage.removeItem("ev_token"); setAuthed(false); setData(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const requestOtp = async (phone) => {
    const { data } = await dapi.post("/driver/auth/request-otp", { phone });
    return data;
  };

  const login = async (phone, otp) => {
    const { data } = await dapi.post("/driver/auth/login", { phone, otp });
    localStorage.setItem("ev_token", data.token);
    setAuthed(true);
    await refresh();
    return data;
  };

  const logout = () => {
    localStorage.removeItem("ev_token");
    setAuthed(false); setData(null);
  };

  return (
    <Ctx.Provider value={{ data, authed, loading, login, requestOtp, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export const useDriver = () => useContext(Ctx);
