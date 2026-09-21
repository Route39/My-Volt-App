import { useState, useEffect, useCallback, useRef } from "react";
import { Lock, Eye, EyeOff, ShieldCheck, Loader2 } from "lucide-react";
import api from "../../lib/api";

const LOCK_KEY = "pkg_unlocked_until";
const LOCK_DURATION_MS = 10 * 60 * 1000; // 10 minutes

function getUnlockedUntil() {
  // Use memory-only storage (no localStorage per user rules)
  return window.__pkgUnlockedUntil || null;
}
function setUnlockedUntil(ts) {
  window.__pkgUnlockedUntil = ts;
}
function isUnlocked() {
  const until = getUnlockedUntil();
  return until && Date.now() < until;
}

export default function PackageLock({ children }) {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  // Auto-lock when navigating away from this page
  useEffect(() => {
    return () => {
      // When component unmounts (user navigates away), lock it
      setUnlockedUntil(null);
    };
  }, []);

  // Auto-lock after 10 minutes
  const scheduleAutoLock = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setUnlockedUntil(null);
      setUnlocked(false);
    }, LOCK_DURATION_MS);
  }, []);

  const handleUnlock = async () => {
    if (!password) { setError("Enter the password"); return; }
    setLoading(true);
    setError("");
    try {
      await api.post("/settings/package-password/verify", { password });
      const until = Date.now() + LOCK_DURATION_MS;
      setUnlockedUntil(until);
      setUnlocked(true);
      scheduleAutoLock();
    } catch (e) {
      setError(e.response?.data?.detail || "Wrong password");
    } finally {
      setLoading(false);
    }
  };

  if (unlocked) return children;

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xl p-10 w-full max-w-sm text-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-6">
          <Lock className="w-8 h-8 text-indigo-600" />
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900">Rental Packages</h2>
        <p className="text-slate-500 text-sm mt-2 mb-8">This page is protected. Enter the password to access it.</p>

        <div className="relative mb-4">
          <input
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            placeholder="Enter password"
            autoFocus
            className="w-full h-12 px-4 pr-12 rounded-xl border border-slate-200 bg-slate-50 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 text-slate-900 transition-all"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

        <button
          onClick={handleUnlock}
          disabled={loading}
          className="w-full h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ShieldCheck className="w-5 h-5" /> Unlock</>}
        </button>

        <p className="text-xs text-slate-400 mt-6">Locks automatically after 10 minutes</p>
      </div>
    </div>
  );
}
