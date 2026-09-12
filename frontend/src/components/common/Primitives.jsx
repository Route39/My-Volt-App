import { useEffect, useRef, useState } from "react";

// Status semantics -> chip class + label
const STATUS_MAP = {
  // vehicle
  available: ["chip-green", "Available"],
  rented: ["chip-blue", "Rented"],
  service: ["chip-amber", "Service"],
  idle: ["chip-neutral", "Idle"],
  accident: ["chip-red", "Accident"],
  inactive: ["chip-neutral", "Inactive"],
  // rentals
  active: ["chip-green", "Active"],
  expiring_soon: ["chip-amber", "Expiring Soon"],
  expired: ["chip-red", "Expired"],
  pending_payment: ["chip-amber", "Pending Payment"],
  suspended: ["chip-red", "Suspended"],
  closed: ["chip-neutral", "Closed"],
  draft: ["chip-neutral", "Draft"],
  renewed: ["chip-blue", "Renewed"],
  // payment
  paid: ["chip-green", "Paid"],
  partial: ["chip-amber", "Partial"],
  pending: ["chip-red", "Due"],
  // driver
  none: ["chip-neutral", "No Rental"],
  // documents
  valid: ["chip-green", "Valid"],
  // service request
  new: ["chip-blue", "New"],
  assigned: ["chip-amber", "Assigned"],
  inspection: ["chip-amber", "Inspection"],
  repair: ["chip-amber", "Repair"],
  ready: ["chip-green", "Ready"],
  // orders (Nayara)
  received: ["chip-blue", "Received"],
  processing: ["chip-amber", "Processing"],
  on_hold: ["chip-neutral", "On Hold"],
  completed: ["chip-green", "Completed"],
  urgent: ["chip-red", "Urgent"],
  on_track: ["chip-green", "On Track"],
  due_soon: ["chip-amber", "Due Soon"],
  overdue: ["chip-red", "Overdue"],
  // priority
  critical: ["chip-red", "Critical"],
  high: ["chip-amber", "High"],
  medium: ["chip-blue", "Medium"],
  low: ["chip-neutral", "Low"],
  // incident
  reported: ["chip-red", "Reported"],
  investigation: ["chip-amber", "Investigation"],
  action: ["chip-amber", "Action"],
  resolved: ["chip-green", "Resolved"],
  // health
  Healthy: ["chip-green", "Healthy"],
  Good: ["chip-green", "Good"],
  Fair: ["chip-amber", "Fair"],
  "Needs Check": ["chip-red", "Needs Check"],
};

export function StatusChip({ status, label, className = "", testid }) {
  const [cls, txt] = STATUS_MAP[status] || ["chip-neutral", label || status];
  return (
    <span className={`chip ${cls} ${className}`} data-testid={testid}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label || txt}
    </span>
  );
}

export function AnimatedCounter({ value = 0, duration = 900, className = "" }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef();
  useEffect(() => {
    const start = performance.now();
    const from = ref.current || 0;
    const to = Number(value) || 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setDisplay(to); ref.current = to; return; }
    let raf;
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else ref.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={className}>{display.toLocaleString("en-IN")}</span>;
}

export function BatteryBar({ percent = 0, className = "" }) {
  const color = percent > 50 ? "#22c55e" : percent > 20 ? "#f59e0b" : "#ef4444";
  return (
    <div className={className}>
      <div className="h-2 rounded-full bg-mv-elevated overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-500"
             style={{ width: `${percent}%`, background: color }} />
      </div>
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`mv-skel ${className}`} />;
}

export function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 mv-fade">
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-mv-surface2 border border-mv-border flex items-center justify-center mb-5">
          <Icon className="w-7 h-7 text-mv-dim" />
        </div>
      )}
      <h3 className="font-display text-xl font-semibold text-mv-text">{title}</h3>
      {subtitle && <p className="text-mv-muted text-sm mt-2 max-w-sm">{subtitle}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
