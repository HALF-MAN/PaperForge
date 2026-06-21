"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Activity,
  TrendingUp,
  Shield,
  LineChart,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  XCircle,
  Play,
  Rocket,
  Bot,
  BarChart3,
  Target,
  DollarSign,
  Percent,
  ArrowRight,
  Zap,
  Clock,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { StatusPill } from "@/src/components/platform/ui";
import { runQuantFlow, getFlowState, type QuantFlowState, type FlowRunResult } from "@/src/platform/python-backend";

type PhaseInfo = {
  name: string;
  label: string;
  icon: React.ReactNode;
  description: string;
};

const PHASES: PhaseInfo[] = [
  { name: "init", label: "Initialize", icon: <Rocket size={18} />, description: "Setting up workflow context" },
  { name: "factor_mining", label: "Factor Mining", icon: <BarChart3 size={18} />, description: "Fetching market data" },
  { name: "strategy", label: "Strategy", icon: <Target size={18} />, description: "Generating strategy spec" },
  { name: "backtest", label: "Backtest", icon: <LineChart size={18} />, description: "Running backtest simulation" },
  { name: "risk_audit", label: "Risk Audit", icon: <Shield size={18} />, description: "Scoring risk profile" },
  { name: "paper_trading", label: "Paper Trading", icon: <DollarSign size={18} />, description: "Simulating live execution" },
  { name: "live_decision", label: "Live Decision", icon: <Zap size={18} />, description: "Final deployment decision" },
  { name: "done", label: "Completed", icon: <CheckCircle2 size={18} />, description: "Workflow finished" },
  { name: "failed", label: "Failed", icon: <XCircle size={18} />, description: "Workflow encountered error" }
];

const phaseOrder = ["init", "factor_mining", "strategy", "backtest", "risk_audit", "paper_trading", "live_decision", "done"];

type FlowDashboardProps = {
  missionId: string;
  missionTitle: string;
};

export function FlowDashboard({ missionId, missionTitle }: FlowDashboardProps) {
  const [flowState, setFlowState] = useState<QuantFlowState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);

  const currentPhaseIndex = flowState ? phaseOrder.indexOf(flowState.current_phase) : -1;

  const runFlow = useCallback(async () => {
    setIsRunning(true);
    setError(null);
    try {
      const result = await runQuantFlow(missionId);
      setFlowState(result.final_state);

      // Poll for updates if still running
      if (result.status !== "done" && result.status !== "failed") {
        const pollInterval = setInterval(async () => {
          const state = await getFlowState(result.run_id);
          if (state) {
            setFlowState(state);
            if (state.current_phase === "done" || state.current_phase === "failed") {
              clearInterval(pollInterval);
              setIsRunning(false);
            }
          }
        }, 2000);

        // Stop polling after 60 seconds max
        setTimeout(() => clearInterval(pollInterval), 60000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Flow execution failed");
      setIsRunning(false);
    }
  }, [missionId]);

  // Auto-run on mount
  useEffect(() => {
    runFlow();
  }, [runFlow]);

  const getPhaseStatus = (phaseName: string): "done" | "active" | "waiting" | "error" => {
    if (!flowState) return "waiting";
    if (flowState.current_phase === "failed") {
      const errorPhase = flowState.errors[0]?.phase;
      return phaseName === errorPhase ? "error" : phaseOrder.indexOf(phaseName) < phaseOrder.indexOf(errorPhase) ? "done" : "waiting";
    }
    const phaseIdx = phaseOrder.indexOf(phaseName);
    const currentIdx = phaseOrder.indexOf(flowState.current_phase);
    if (phaseIdx < currentIdx) return "done";
    if (phaseIdx === currentIdx) return "active";
    return "waiting";
  };

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--panel-soft)]/95 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/missions" className="flex items-center gap-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]">
              <ArrowLeft size={14} />
              Missions
            </Link>
            <span className="h-4 w-px bg-[var(--line)]" />
            <div>
              <div className="text-xs font-semibold uppercase text-[var(--accent)]">Flow Execution</div>
              <h1 className="text-lg font-semibold text-[var(--foreground)]">{missionTitle}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {flowState && (
              <StatusPill tone={flowState.current_phase === "done" ? "good" : flowState.current_phase === "failed" ? "danger" : "accent"}>
                {flowState.current_phase}
              </StatusPill>
            )}
            {isRunning && (
              <div className="flex items-center gap-2 text-xs text-[var(--accent)]">
                <Loader2 size={14} className="animate-spin" />
                Running...
              </div>
            )}
            {!isRunning && flowState?.current_phase !== "done" && flowState?.current_phase !== "failed" && (
              <button
                onClick={runFlow}
                className="flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]"
              >
                <Play size={14} />
                Continue
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="flex items-center gap-0 px-6 pb-3">
          {PHASES.filter(p => p.name !== "failed").slice(0, -1).map((phase, i) => {
            const status = getPhaseStatus(phase.name);
            const isLast = i === PHASES.filter(p => p.name !== "failed").length - 2;

            return (
              <div key={phase.name} className="flex items-center">
                {!isLast && (
                  <div className={`w-8 h-0.5 -mx-1 rounded-full transition-colors ${
                    status === "done" || status === "active" ? "bg-[var(--accent)]" : "bg-[var(--line-strong)]"
                  }`} />
                )}
                <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition-all ${
                  status === "active"
                    ? "bg-[var(--accent)]/15 text-[var(--accent-strong)] ring-1 ring-[var(--accent)]/40"
                    : status === "done"
                      ? "text-[var(--success)]"
                      : status === "error"
                        ? "text-[var(--danger)]"
                        : "text-[var(--muted)]"
                }`}>
                  <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                    status === "active" ? "bg-[var(--accent)] text-white animate-pulse" :
                    status === "done" ? "bg-[var(--success)] text-white" :
                    status === "error" ? "bg-[var(--danger)] text-white" :
                    "bg-[var(--line-strong)] text-[var(--faint)]"
                  }`}>
                    {status === "done" ? <CheckCircle2 size={12} /> : status === "active" ? <Loader2 size={12} className="animate-spin" /> : i + 1}
                  </span>
                  <span className="whitespace-nowrap">{phase.label}</span>
                  {status === "active" && (
                    <Activity size={12} className="animate-pulse" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="mx-6 mt-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-4">
          <div className="flex items-center gap-3 text-[var(--danger)]">
            <XCircle size={18} />
            <span className="font-semibold">Error: {error}</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="p-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          {/* Phase Cards */}
          <section className="space-y-4">
            {flowState && (
              <>
                {/* Market Data Card */}
                <PhaseCard
                  title="Factor Mining"
                  icon={<BarChart3 size={20} />}
                  status={getPhaseStatus("factor_mining")}
                  expanded={expandedPhase === "factor_mining"}
                  onToggle={() => setExpandedPhase(expandedPhase === "factor_mining" ? null : "factor_mining")}
                >
                  {flowState.result_factor_mining && (
                    <div className="space-y-3">
                      <DataRow label="Symbol" value={(flowState.result_factor_mining as Record<string, unknown>).symbol as string || "BTCUSDT"} />
                      <DataRow label="Timeframe" value={(flowState.result_factor_mining as Record<string, unknown>).timeframe as string || "1h"} />
                      <DataRow label="Data Points" value={`${(flowState.result_factor_mining as Record<string, unknown>).count as number || 100} candles`} />
                    </div>
                  )}
                </PhaseCard>

                {/* Strategy Card */}
                <PhaseCard
                  title="Strategy Generation"
                  icon={<Target size={20} />}
                  status={getPhaseStatus("strategy")}
                  expanded={expandedPhase === "strategy"}
                  onToggle={() => setExpandedPhase(expandedPhase === "strategy" ? null : "strategy")}
                >
                  {flowState.result_strategy && (
                    <div className="space-y-3">
                      <DataRow label="Strategy" value={(flowState.result_strategy as Record<string, unknown>).name as string || "EMA Trend Breakout"} />
                      <DataRow label="Symbol" value={(flowState.result_strategy as Record<string, unknown>).symbol as string || "BTCUSDT"} />
                      <DataRow label="Market" value={(flowState.result_strategy as Record<string, unknown>).market as string || "spot"} />
                      <DataRow label="Max Position" value={`${(((flowState.result_strategy as Record<string, unknown>).risk as Record<string, unknown>)?.max_position_pct as number || 0.1) * 100}%`} />
                      <DataRow label="Stop Loss" value={`${(((flowState.result_strategy as Record<string, unknown>).risk as Record<string, unknown>)?.stop_loss_pct as number || 0.03) * 100}%`} />
                    </div>
                  )}
                </PhaseCard>

                {/* Backtest Card */}
                <PhaseCard
                  title="Backtest Results"
                  icon={<LineChart size={20} />}
                  status={getPhaseStatus("backtest")}
                  expanded={expandedPhase === "backtest"}
                  onToggle={() => setExpandedPhase(expandedPhase === "backtest" ? null : "backtest")}
                  highlight
                >
                  {flowState.result_backtest && (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <MetricCard
                        label="Total Return"
                        value={`${flowState.result_backtest.total_return_pct}%`}
                        tone={flowState.result_backtest.total_return_pct >= 0 ? "good" : "danger"}
                        icon={<TrendingUp size={16} />}
                      />
                      <MetricCard
                        label="Max Drawdown"
                        value={`${flowState.result_backtest.max_drawdown_pct}%`}
                        tone={flowState.result_backtest.max_drawdown_pct <= 10 ? "good" : flowState.result_backtest.max_drawdown_pct <= 20 ? "warn" : "danger"}
                        icon={<ArrowDown size={16} />}
                      />
                      <MetricCard
                        label="Win Rate"
                        value={`${flowState.result_backtest.win_rate_pct}%`}
                        tone={flowState.result_backtest.win_rate_pct >= 55 ? "good" : flowState.result_backtest.win_rate_pct >= 45 ? "warn" : "danger"}
                        icon={<Percent size={16} />}
                      />
                      <MetricCard
                        label="Trade Count"
                        value={String(flowState.result_backtest.trade_count)}
                        tone="neutral"
                        icon={<Activity size={16} />}
                      />
                      <MetricCard
                        label="Profit Factor"
                        value={String(flowState.result_backtest.profit_factor)}
                        tone={flowState.result_backtest.profit_factor >= 1.5 ? "good" : "warn"}
                        icon={<DollarSign size={16} />}
                      />
                      <MetricCard
                        label="Avg Trade"
                        value={`${flowState.result_backtest.average_trade_pct}%`}
                        tone={flowState.result_backtest.average_trade_pct >= 0 ? "good" : "danger"}
                        icon={<BarChart3 size={16} />}
                      />
                    </div>
                  )}
                </PhaseCard>

                {/* Risk Card */}
                <PhaseCard
                  title="Risk Assessment"
                  icon={<Shield size={20} />}
                  status={getPhaseStatus("risk_audit")}
                  expanded={expandedPhase === "risk_audit"}
                  onToggle={() => setExpandedPhase(expandedPhase === "risk_audit" ? null : "risk_audit")}
                  highlight
                >
                  {flowState.result_risk_audit && (
                    <div className="space-y-4">
                      {/* Risk Score Gauge */}
                      <div className="flex items-center gap-6">
                        <div className={`relative grid h-20 w-20 place-items-center rounded-full ${
                          flowState.result_risk_audit.risk_score >= 80 ? "bg-[var(--success)]/15 text-[var(--success)]" :
                          flowState.result_risk_audit.risk_score >= 60 ? "bg-[var(--warning)]/15 text-[var(--warning)]" :
                          "bg-[var(--danger)]/15 text-[var(--danger)]"
                        }`}>
                          <span className="text-2xl font-bold">{flowState.result_risk_audit.risk_score}</span>
                          <span className="absolute -bottom-1 text-[10px] font-semibold uppercase">/100</span>
                        </div>
                        <div>
                          <StatusPill tone={
                            flowState.result_risk_audit.decision === "PASS" ? "good" :
                            flowState.result_risk_audit.decision === "WARN" ? "warn" : "danger"
                          }>
                            {flowState.result_risk_audit.decision}
                          </StatusPill>
                          <p className="mt-2 text-sm text-[var(--muted)]">
                            {flowState.result_risk_audit.decision === "PASS" ? "Strategy approved for paper trading" :
                             flowState.result_risk_audit.decision === "WARN" ? "Review recommended before proceeding" :
                             "Strategy blocked due to high risk"}
                          </p>
                        </div>
                      </div>

                      {/* Issues */}
                      {flowState.result_risk_audit.issues.length > 0 && (
                        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                          <div className="text-xs font-semibold uppercase text-[var(--faint)]">Issues</div>
                          <ul className="mt-2 space-y-1">
                            {flowState.result_risk_audit.issues.map((issue, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-[var(--muted)]">
                                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--warning)]" />
                                {issue}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Recommendations */}
                      {flowState.result_risk_audit.recommendations.length > 0 && (
                        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                          <div className="text-xs font-semibold uppercase text-[var(--faint)]">Recommendations</div>
                          <ul className="mt-2 space-y-1">
                            {flowState.result_risk_audit.recommendations.map((rec, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-[var(--muted)]">
                                <ArrowRight size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                                {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </PhaseCard>

                {/* Paper Trading Card */}
                <PhaseCard
                  title="Paper Trading"
                  icon={<DollarSign size={20} />}
                  status={getPhaseStatus("paper_trading")}
                  expanded={expandedPhase === "paper_trading"}
                  onToggle={() => setExpandedPhase(expandedPhase === "paper_trading" ? null : "paper_trading")}
                >
                  {flowState.result_paper_trading && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <MetricCard
                        label="PnL"
                        value={`${(flowState.result_paper_trading as Record<string, unknown>).pnl_pct as number}%`}
                        tone={(flowState.result_paper_trading as Record<string, unknown>).pnl_pct as number >= 0 ? "good" : "danger"}
                        icon={<TrendingUp size={16} />}
                      />
                      <MetricCard
                        label="Max Drawdown"
                        value={`${(flowState.result_paper_trading as Record<string, unknown>).max_drawdown_pct as number}%`}
                        tone="neutral"
                        icon={<ArrowDown size={16} />}
                      />
                      <MetricCard
                        label="Orders"
                        value={String((flowState.result_paper_trading as Record<string, unknown>).order_count as number)}
                        tone="neutral"
                        icon={<Activity size={16} />}
                      />
                      <MetricCard
                        label="Duration"
                        value={`${(flowState.result_paper_trading as Record<string, unknown>).duration_days as number || 14} days`}
                        tone="neutral"
                        icon={<Clock size={16} />}
                      />
                    </div>
                  )}
                </PhaseCard>

                {/* Live Decision Card */}
                <PhaseCard
                  title="Live Decision"
                  icon={<Zap size={20} />}
                  status={getPhaseStatus("live_decision")}
                  expanded={expandedPhase === "live_decision"}
                  onToggle={() => setExpandedPhase(expandedPhase === "live_decision" ? null : "live_decision")}
                  highlight
                >
                  {flowState.result_live_decision && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <StatusPill tone={(flowState.result_live_decision as Record<string, unknown>).decision as string === "deploy" ? "good" : "neutral"}>
                          {(flowState.result_live_decision as Record<string, unknown>).decision as string === "deploy" ? "Deploy Ready" : "Hold"}
                        </StatusPill>
                        <div className="text-sm text-[var(--muted)]">
                          Confidence: {Math.round((flowState.result_live_decision as Record<string, unknown>).confidence as number * 100)}%
                        </div>
                      </div>
                      <DataRow label="Max Position" value={`${Math.round((flowState.result_live_decision as Record<string, unknown>).max_position_pct as number * 100)}%`} />
                    </div>
                  )}
                </PhaseCard>
              </>
            )}

            {/* Initial State - No flow running */}
            {!flowState && !error && (
              <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-8 text-center">
                <Bot size={48} className="mx-auto mb-4 text-[var(--accent)]" />
                <h2 className="text-xl font-semibold text-[var(--foreground)]">Preparing Workflow</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">Initializing the quant pipeline...</p>
                <div className="mt-6 flex justify-center">
                  <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
                </div>
              </div>
            )}

            {/* Success State */}
            {flowState?.current_phase === "done" && (
              <div className="rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/10 p-6">
                <div className="flex items-center gap-3">
                  <CheckCircle2 size={24} className="text-[var(--success)]" />
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--success)]">Workflow Completed</h2>
                    <p className="mt-1 text-sm text-[var(--muted)]">All phases executed successfully. Run ID: {flowState.run_id}</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Sidebar - Team & Info */}
          <aside className="space-y-4">
            {/* Team Info */}
            {flowState?.plan && (
              <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
                <div className="text-xs font-semibold uppercase text-[var(--accent)]">Execution Plan</div>
                <h2 className="mt-2 text-lg font-semibold text-[var(--foreground)]">{flowState.plan.task_summary}</h2>
                <div className="mt-4 space-y-2">
                  <DataRow label="Risk Level" value={flowState.plan.risk_level} />
                  <DataRow label="Flow Type" value={flowState.plan.flow_type} />
                  <DataRow label="Memory Scope" value={flowState.plan.memory_scope} />
                </div>

                {/* Agents */}
                <div className="mt-5">
                  <div className="text-xs font-semibold uppercase text-[var(--faint)]">Agents ({flowState.plan.agents.length})</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {flowState.plan.agents.map((agent, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs">
                        <Bot size={12} className="text-[var(--accent)]" />
                        <span className="font-semibold text-[var(--foreground)]">{agent.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Run Info */}
            {flowState && (
              <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
                <div className="text-xs font-semibold uppercase text-[var(--accent)]">Run Info</div>
                <div className="mt-4 space-y-2">
                  <DataRow label="Run ID" value={flowState.run_id} />
                  <DataRow label="Created At" value={new Date(flowState.created_at).toLocaleString()} />
                  <DataRow label="Phase" value={flowState.current_phase} />
                </div>
              </section>
            )}

            {/* Errors */}
            {flowState?.errors.length > 0 && (
              <section className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-5">
                <div className="text-xs font-semibold uppercase text-[var(--danger)]">Errors</div>
                <div className="mt-4 space-y-3">
                  {flowState.errors.map((err, i) => (
                    <div key={i} className="rounded-lg border border-[var(--danger)]/20 bg-[var(--surface)] p-3">
                      <div className="text-xs font-semibold text-[var(--danger)]">{err.phase}</div>
                      <p className="mt-1 text-sm text-[var(--muted)]">{err.error}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

// ===== Sub-components =====

type PhaseCardProps = {
  title: string;
  icon: React.ReactNode;
  status: "done" | "active" | "waiting" | "error";
  expanded: boolean;
  onToggle: () => void;
  highlight?: boolean;
  children: React.ReactNode;
};

function PhaseCard({ title, icon, status, expanded, onToggle, highlight, children }: PhaseCardProps) {
  const statusColors = {
    done: "border-[var(--success)]/40 bg-[var(--success)]/5",
    active: "border-[var(--accent)] ring-2 ring-[var(--accent)]/30 bg-[var(--accent)]/10",
    waiting: "border-[var(--line)] bg-[var(--panel)]",
    error: "border-[var(--danger)]/40 bg-[var(--danger)]/10"
  };

  return (
    <div className={`rounded-xl border transition-all ${statusColors[status]} ${highlight && status === "done" ? "shadow-[var(--shadow-soft)]" : ""}`}>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className={`grid h-10 w-10 place-items-center rounded-lg ${
            status === "done" ? "bg-[var(--success)]/15 text-[var(--success)]" :
            status === "active" ? "bg-[var(--accent)]/15 text-[var(--accent)] animate-pulse" :
            status === "error" ? "bg-[var(--danger)]/15 text-[var(--danger)]" :
            "bg-[var(--surface)] text-[var(--muted)]"
          }`}>
            {status === "active" ? <Loader2 size={18} className="animate-spin" /> : icon}
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--foreground)]">{title}</h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {status === "done" ? "Completed" : status === "active" ? "Running..." : status === "error" ? "Failed" : "Waiting"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status === "done" && <CheckCircle2 size={16} className="text-[var(--success)]" />}
          {status === "error" && <XCircle size={16} className="text-[var(--danger)]" />}
          {expanded ? <ChevronUp size={16} className="text-[var(--muted)]" /> : <ChevronDown size={16} className="text-[var(--muted)]" />}
        </div>
      </button>

      {expanded && status !== "waiting" && (
        <div className="border-t border-[var(--line)] px-5 py-4">
          {status === "active" ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={20} className="animate-spin text-[var(--accent)]" />
              <span className="ml-2 text-sm text-[var(--muted)]">Processing...</span>
            </div>
          ) : children}
        </div>
      )}
    </div>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
  tone: "good" | "warn" | "danger" | "neutral";
  icon: React.ReactNode;
};

function MetricCard({ label, value, tone, icon }: MetricCardProps) {
  const toneStyles = {
    good: "text-[var(--success)]",
    warn: "text-[var(--warning)]",
    danger: "text-[var(--danger)]",
    neutral: "text-[var(--foreground)]"
  };

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2 text-xs text-[var(--faint)]">
        {icon}
        {label}
      </div>
      <div className={`mt-2 text-xl font-bold ${toneStyles[tone]}`}>{value}</div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-semibold text-[var(--foreground)]">{value}</span>
    </div>
  );
}

// ArrowDown icon fallback
function ArrowDown({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  );
}