"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OrchestratorRun } from "@/src/platform/types";

type MissionRunnerProps = {
  missionId: string;
  canRun: boolean;
  initialRun: OrchestratorRun | null;
  fullWidth?: boolean;
  autoStart?: boolean;
  idleLabel?: string;
};

export function MissionRunner({ missionId, canRun, initialRun, fullWidth = false, autoStart = false, idleLabel }: MissionRunnerProps) {
  const router = useRouter();
  const [run, setRun] = useState<OrchestratorRun | null>(initialRun);
  const [isPending, startTransition] = useTransition();
  const isRunning = run?.status === "queued" || run?.status === "running";
  const disabled = !canRun || isRunning || isPending;
  const lastEvent = useMemo(() => run?.events.at(-1), [run]);

  const startRun = useCallback(async () => {
    if (disabled) return;
    const response = await fetch(`/api/platform/missions/${missionId}/continue`, {
      method: "POST"
    });
    const payload = (await response.json()) as { run: OrchestratorRun };
    setRun(payload.run);
    startTransition(() => router.refresh());
  }, [disabled, missionId, router]);

  useEffect(() => {
    if (!isRunning) return;

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/platform/missions/${missionId}/continue`, {
          method: "POST",
          cache: "no-store"
        });
        const payload = (await response.json()) as { run: OrchestratorRun | null };

        if (payload.run) {
          setRun(payload.run);
          startTransition(() => router.refresh());
        }
      } catch {
        // Silently retry on next interval
      }
    }, 1500);

    return () => window.clearInterval(interval);
  }, [isRunning, missionId, router]);

  useEffect(() => {
    if (!autoStart || disabled || run) return;
    const timeout = window.setTimeout(() => {
      void startRun();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [autoStart, disabled, run, startRun]);

  // ── Running state: compact indicator ──
  if (isRunning) {
    return (
      <div className={fullWidth ? "w-full" : "w-[180px]"}>
        <button
          className={`${fullWidth ? "w-full" : ""} flex items-center justify-center gap-2 rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-4 py-2 text-sm font-semibold text-[var(--accent-strong)]`}
          disabled
          type="button"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)]/30 border-t-[var(--accent)]" />
          Running...
        </button>
      </div>
    );
  }

  // ── Idle state: simple button ──
  const buttonLabel = canRun ? idleLabel ?? "Continue mission" : "Waiting for handoff";

  return (
    <div className={fullWidth ? "w-full" : undefined}>
      <button
        className={
          disabled
            ? `${fullWidth ? "w-full" : ""} cursor-not-allowed rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--faint)]`
            : `${fullWidth ? "w-full" : ""} rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(94,106,210,0.22)] transition hover:bg-[var(--accent-strong)]`
        }
        disabled={disabled}
        onClick={startRun}
        type="button"
      >
        {buttonLabel}
      </button>
      {run ? (
        <div className="mt-1.5 rounded-md border border-[var(--line)] bg-[var(--panel-soft)] px-2.5 py-1.5 text-[11px] leading-5 text-[var(--muted)]">
          <span className="font-semibold text-[var(--foreground)]">{run.status}</span>
          <span className="ml-1">{lastEvent?.summary ?? run.stopReason}</span>
        </div>
      ) : null}
    </div>
  );
}
