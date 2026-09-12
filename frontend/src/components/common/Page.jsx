export function PageHeader({ title, subtitle, children, testid }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6 mv-rise" data-testid={testid}>
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-mv-muted text-sm mt-1">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div>
      <label className="mv-label">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function TextInput(props) {
  return (
    <input {...props}
      className={`w-full h-10 px-3 rounded-xl bg-mv-surface2 border border-mv-border outline-none focus:border-mv-primary transition-colors text-sm ${props.className || ""}`} />
  );
}

export function TextArea(props) {
  return (
    <textarea {...props}
      className={`w-full px-3 py-2 rounded-xl bg-mv-surface2 border border-mv-border outline-none focus:border-mv-primary transition-colors text-sm ${props.className || ""}`} />
  );
}

export function PrimaryBtn({ children, className = "", ...props }) {
  return (
    <button {...props}
      className={`inline-flex items-center justify-center gap-2 h-9 px-4 rounded-xl bg-mv-primary hover:bg-blue-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 ${className}`}>
      {children}
    </button>
  );
}

export function GhostBtn({ children, className = "", ...props }) {
  return (
    <button {...props}
      className={`inline-flex items-center justify-center gap-2 h-9 px-3 rounded-xl border border-mv-border bg-mv-surface hover:bg-mv-elevated text-sm font-medium transition-colors ${className}`}>
      {children}
    </button>
  );
}

export function FilterChip({ active, children, ...props }) {
  return (
    <button {...props}
      className={`h-8 px-3 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
        active ? "bg-mv-primary text-white" : "border border-mv-border bg-mv-surface text-mv-muted hover:bg-mv-elevated"}`}>
      {children}
    </button>
  );
}
