export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-b border-[var(--line)] bg-[var(--panel-soft)] px-6 py-5 backdrop-blur-xl">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">{eyebrow}</div>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function ModulePanel({
  title,
  subtitle,
  children,
  action
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)]">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "accent" | "danger" }) {
  const toneClass = {
    neutral: "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]",
    good: "border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]",
    warn: "border-[var(--warning)]/35 bg-[var(--warning-soft)] text-[var(--warning)]",
    accent: "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-strong)]",
    danger: "border-[var(--danger)]/35 bg-[var(--danger-soft)] text-[var(--danger)]"
  }[tone];

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass}`}>{children}</span>;
}

export function DataCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] p-3">
      <div className="text-[10px] font-semibold uppercase text-[var(--faint)]">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-[var(--foreground)]">{value}</div>
    </div>
  );
}
