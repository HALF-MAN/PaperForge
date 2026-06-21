"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, BriefcaseBusiness, Database, FolderKanban, Gauge, Library, Network } from "lucide-react";
import type { PlatformWorkspace } from "@/src/platform/types";

const navItems = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/missions", label: "Missions", icon: FolderKanban },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/skills", label: "Skills", icon: Library },
  { href: "/memory", label: "Memory", icon: Database }
];

export function PlatformShell({ children, workspace }: { children: React.ReactNode; workspace: PlatformWorkspace }) {
  const pathname = usePathname();

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="grid min-h-screen lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b border-[var(--line)] bg-[var(--panel-soft)] p-4 backdrop-blur-xl lg:border-b-0 lg:border-r">
          <Link className="mb-8 flex items-center gap-3" href={{ pathname: "/" }}>
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <Network size={20} aria-hidden />
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--foreground)]">{workspace.name}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">{workspace.domain}</div>
            </div>
          </Link>

          <nav className="flex gap-2 overflow-auto lg:block lg:space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

              return (
                <Link
                  className={`flex min-w-fit items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                    active
                      ? "bg-[var(--surface)] text-[var(--foreground)] shadow-[inset_0_0_0_1px_var(--line)]"
                      : "text-[var(--muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--foreground)]"
                  }`}
                  href={{ pathname: item.href }}
                  key={item.href}
                >
                  <Icon size={16} aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-8 hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)] lg:block">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">
              <BriefcaseBusiness size={14} aria-hidden />
              Workspace
            </div>
            <div className="text-sm text-[var(--muted)]">Mode</div>
            <div className="mt-1 text-sm font-semibold text-[var(--foreground)]">{workspace.operatingMode}</div>
          </div>
        </aside>

        <section className="min-w-0">{children}</section>
      </div>
    </main>
  );
}
