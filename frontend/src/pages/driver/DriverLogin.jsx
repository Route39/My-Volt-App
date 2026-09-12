import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Loader2, Smartphone } from "lucide-react";
import { useDriver } from "../../context/DriverAuthContext";

export default function DriverLogin() {
  const { login, requestOtp } = useDriver();
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try { 
      await requestOtp(phone.replace(/\s+/g, "")); 
      setStep(2);
    }
    catch (e2) { setError(e2.response?.data?.detail || "Failed to send OTP"); }
    finally { setLoading(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try { 
      await login(phone.replace(/\s+/g, ""), otp); 
      nav("/driver"); 
    }
    catch (e2) { setError(e2.response?.data?.detail || "Login failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-white flex flex-col justify-center px-6">
      <div className="max-w-sm w-full mx-auto">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-200">
            <Zap className="w-8 h-8 text-white" fill="white" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 mt-4">MyEVRental</h1>
          <p className="text-slate-500 text-sm mt-1">Your daily EV rental, made simple.</p>
        </div>

        <form onSubmit={step === 1 ? handleRequestOtp : handleLogin} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Mobile Number</label>
            <div className="mt-1.5 relative">
              <Smartphone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={step === 2} required data-testid="driver-login-phone"
                placeholder="+91 90000 00000"
                className="w-full h-12 pl-10 pr-3.5 rounded-2xl bg-white border border-slate-200 outline-none focus:border-emerald-500 transition-colors disabled:bg-slate-50 disabled:text-slate-500" />
            </div>
          </div>
          
          {step === 2 && (
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">OTP Code</label>
              <input value={otp} onChange={(e) => setOtp(e.target.value)} type="text" required data-testid="driver-login-otp"
                placeholder="6-digit OTP"
                maxLength={6}
                className="mt-1.5 w-full h-12 px-3.5 text-center tracking-[0.5em] text-lg rounded-2xl bg-white border border-slate-200 outline-none focus:border-emerald-500 transition-colors" />
            </div>
          )}
          
          {error && <div data-testid="driver-login-error" className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</div>}
          
          <button type="submit" disabled={loading} data-testid="driver-login-submit"
            className="w-full h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} {step === 1 ? "Get OTP" : "Verify & Sign In"}
          </button>
          
          {step === 2 && (
            <button type="button" onClick={() => { setStep(1); setOtp(""); setError(""); }} disabled={loading} className="w-full text-center text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
              Change Mobile Number
            </button>
          )}
        </form>
        <p className="text-center text-xs text-slate-400 mt-8">MyEVRental · powered by MyVolt</p>
      </div>
    </div>
  );
}
