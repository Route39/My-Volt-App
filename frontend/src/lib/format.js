const CURRENCY = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const inr = (n) => `₹${CURRENCY.format(Math.round(Number(n || 0)))}`;

export function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function fmtDate(iso, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  const opts = { day: "numeric", month: "short", year: "numeric" };
  if (withTime) return d.toLocaleString("en-IN", { ...opts, hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-IN", opts);
}

export function relativeEnd(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  const h = Math.round(diff / 3600000);
  if (diff < 0) return "Expired";
  if (h < 24) {
    const t = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    return h < 12 ? `Today, ${t}` : `Tomorrow, ${t}`;
  }
  const days = Math.round(h / 24);
  return `in ${days} day${days > 1 ? "s" : ""}`;
}
