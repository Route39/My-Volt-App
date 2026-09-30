import { useEffect, useState } from "react";
import api from "./api";

// Loads all drivers once and keeps a { driver_id: driver_code } map in memory.
let cache = null;
let pending = null;
const listeners = new Set();

export function loadDriverCodes(force = false) {
  if (cache && !force) return Promise.resolve(cache);
  if (!pending) {
    pending = api.get("/drivers")
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : data.items || [];
        const map = {};
        list.forEach((d) => { if (d.driver_code) map[d.id] = d.driver_code; });
        cache = map;
        listeners.forEach((fn) => fn(cache));
        return cache;
      })
      .catch(() => cache || {})
      .finally(() => { pending = null; });
  }
  return pending;
}

export function useDriverCode(id) {
  const [map, setMap] = useState(cache);
  useEffect(() => {
    listeners.add(setMap);
    loadDriverCodes();
    return () => listeners.delete(setMap);
  }, []);
  return id && map ? map[id] : null;
}

// Usage: <DriverCode id={driver_id} />
export function DriverCode({ id, className = "" }) {
  const code = useDriverCode(id);
  if (!code) return null;
  return <span className={`font-mono text-[11px] font-semibold text-mv-primary ${className}`}>{code}</span>;
}
