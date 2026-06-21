"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Shield,
  Target,
  BarChart3,
  LineChart,
  Zap,
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Sparkles,
  Database,
  Wrench,
  Clock
} from "lucide-react";
import { runQuantFlow, type QuantFlowState } from "@/src/platform/python-backend";

const PHASES = [
  { id: "init", name: "Init", agent: "Orchestrator", skill: "initialize" },
  { id: "factor_mining", name: "Market Data", agent: "Factor Analyst", skill: "fetch_market_data" },
  { id: "strategy", name: "Strategy", agent: "Strategy Engineer", skill: "compile_strategy" },
  { id: "backtest", name: "Backtest", agent: "Backtest Engineer", skill: "run_backtest" },
  { id: "risk_audit", name: "Risk Gate", agent: "Risk Manager", skill: "score_risk" },
  { id: "paper_trading", name: "Paper Trade", agent: "Paper Trader", skill: "paper_simulation" },
  { id: "live_decision", name: "Decision", agent: "Decision Maker", skill: "promote_memory" },
];

const phaseOrder = ["init", "factor_mining", "strategy", "backtest", "risk_audit", "paper_trading", "live_decision", "done", "failed"];

export default function RunPage() {
  const [flowState, setFlowState] = useState<QuantFlowState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startFlow = useCallback(async () => {
    setIsRunning(true);
    setHasStarted(true);
    setError(null);
    setFlowState(null);

    try {
      const result = await runQuantFlow("demo-run");
      setFlowState(result.final_state);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setIsRunning(false);
    }
  }, []);

  const currentPhase = flowState?.current_phase ?? "init";
  const currentIndex = phaseOrder.indexOf(currentPhase);

  const getPhaseStatus = (phaseId: string) => {
    if (!flowState) return "waiting";
    const idx = phaseOrder.indexOf(phaseId);
    if (idx < currentIndex) return "done";
    if (idx === currentIndex) return "active";
    return "waiting";
  };

  const backtest = flowState?.result_backtest;
  const risk = flowState?.result_risk_audit;
  const decision = flowState?.result_live_decision;

  // 获取当前阶段信息
  const currentPhaseInfo = PHASES.find(p => p.id === currentPhase) || PHASES[0];

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--panel-soft)]/90 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-sm text-[var(--muted)] transition hover:text-[var(--accent)]">
            <ArrowLeft size={16} />
            Back
          </Link>

          <div className="flex items-center gap-3">
            {flowState && (
              <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                currentPhase === "done"
                  ? "bg-[var(--success)]/20 text-[var(--success)]"
                  : currentPhase === "failed"
                    ? "bg-[var(--danger)]/20 text-[var(--danger)]"
                    : "bg-[var(--accent)]/20 text-[var(--accent)] animate-pulse"
              }`}>
                {currentPhase === "done" ? "COMPLETED" : currentPhase === "failed" ? "FAILED" : currentPhase}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* 未开始状态 */}
        {!hasStarted && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="absolute inset-0 max-w-6xl mx-auto">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--accent)_0%,transparent_70%)] opacity-10" />
            </div>

            <Bot size={64} className="mb-8 text-[var(--accent)]" />
            <h1 className="text-3xl font-bold text-[var(--foreground)] mb-4">Ready to Run</h1>
            <p className="text-[var(--muted)] mb-12 text-center max-w-lg">
              Execute the full quant pipeline with real Agent-Skill-Memory orchestration
            </p>

            <button
              onClick={startFlow}
              className="group relative flex items-center gap-4 rounded-2xl bg-[var(--accent)] px-12 py-6 text-xl font-bold text-white shadow-[0_0_50px_rgba(94,106,210,0.5)] transition-all hover:scale-105 hover:shadow-[0_0_70px_rgba(94,106,210,0.7)]"
            >
              <Play size={28} className="relative z-10" />
              <span className="relative z-10">Start Execution</span>
            </button>

            {/* 流程预览 - 显示 Agent */}
            <div className="mt-16 flex items-center gap-4">
              {PHASES.map((phase, i) => (
                <div key={phase.id} className="flex items-center gap-4">
                  <div className="flex flex-col items-center p-3 rounded-xl border border-[var(--line)] bg-[var(--panel)]">
                    <Bot size={16} className="text-[var(--accent)] mb-1" />
                    <span className="text-xs font-semibold text-[var(--foreground)]">{phase.agent}</span>
                    <span className="text-xs text-[var(--faint)]">{phase.name}</span>
                  </div>
                  {i < PHASES.length - 1 && <ArrowRight size={14} className="text-[var(--line-strong)]" />}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 执行中/完成状态 */}
        {hasStarted && (
          <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">

            {/* 左侧：Agent + Skill + Memory 动态展示 */}
            <aside className="space-y-4">

              {/* 当前执行状态 */}
              <section className="rounded-xl border-2 border-[var(--accent)] bg-[var(--accent)]/10 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Activity size={16} className="text-[var(--accent)] animate-pulse" />
                  <span className="text-xs font-bold uppercase text-[var(--accent)]">Live Execution</span>
                </div>

                {/* 当前 Agent */}
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 mb-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--accent)]/20 text-[var(--accent)]">
                      {isRunning ? <Loader2 size={18} className="animate-spin" /> : <Bot size={18} />}
                    </div>
                    <div>
                      <div className="text-xs text-[var(--faint)]">Current Agent</div>
                      <div className="text-sm font-bold text-[var(--foreground)]">{currentPhaseInfo.agent}</div>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--muted)]">Executing phase: {currentPhaseInfo.name}</p>
                </div>

                {/* 当前 Skill */}
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
                  <div className="flex items-center gap-2">
                    <Wrench size={14} className="text-[var(--accent)]" />
                    <span className="text-xs text-[var(--faint)]">Active Skill:</span>
                    <code className="text-xs font-mono text-[var(--accent-strong)]">{currentPhaseInfo.skill}</code>
                  </div>
                </div>
              </section>

              {/* Agent 团队 */}
              {flowState?.plan && (
                <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
                  <div className="text-xs font-semibold uppercase text-[var(--faint)] mb-3">Agent Team</div>
                  <div className="space-y-2">
                    {flowState.plan.agents.slice(0, 5).map((agent, i) => (
                      <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                        agent.role === currentPhaseInfo.agent
                          ? "bg-[var(--accent)]/15 border border-[var(--accent)]/30"
                          : "bg-[var(--surface)]"
                      }`}>
                        <Bot size={12} className={agent.role === currentPhaseInfo.agent ? "text-[var(--accent)]" : "text-[var(--muted)]"} />
                        <span className="font-semibold text-[var(--foreground)]">{agent.role}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Memory 沉淀 */}
              {(currentPhase === "done" || currentPhase === "live_decision") && flowState && (
                <section className="rounded-xl border border-[var(--success)]/30 bg-[var(--success)]/5 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Database size={14} className="text-[var(--success)]" />
                    <span className="text-xs font-semibold uppercase text-[var(--success)]">Memory Created</span>
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    Strategy results archived to memory scope: {flowState.plan?.memory_scope || "/archive/" + flowState.run_id}
                  </div>
                </section>
              )}
            </aside>

            {/* 右侧：主要数据展示 */}
            <div className="space-y-6">

              {/* 加载状态 */}
              {!flowState && !error && (
                <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-[var(--line)] bg-[var(--panel)]">
                  <Loader2 size={32} className="mb-4 text-[var(--accent)] animate-spin" />
                  <h2 className="text-lg font-bold text-[var(--foreground)]">Executing Pipeline...</h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {currentPhaseInfo.agent} is running {currentPhaseInfo.skill}
                  </p>
                </div>
              )}

              {/* 错误状态 */}
              {error && (
                <div className="flex flex-col items-center justify-center py-16 rounded-xl border border-[var(--danger)] bg-[var(--danger)]/10">
                  <XCircle size={32} className="mb-4 text-[var(--danger)]" />
                  <h2 className="text-lg font-bold text-[var(--danger)]">Execution Failed</h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">{error}</p>
                  <button onClick={startFlow} className="mt-6 flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                    <Play size={14} /> Retry
                  </button>
                </div>
              )}

              {/* 数据展示 */}
              {flowState && (
                <>
                  {/* 进度条 */}
                  <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
                    <div className="flex items-center gap-3">
                      {PHASES.map((phase, i) => {
                        const status = getPhaseStatus(phase.id);
                        return (
                          <div key={phase.id} className="flex items-center gap-3">
                            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${
                              status === "active" ? "bg-[var(--accent)] text-white" :
                              status === "done" ? "bg-[var(--success)]/20 text-[var(--success)]" :
                              "bg-[var(--surface)] text-[var(--muted)]"
                            }`}>
                              {status === "done" ? <CheckCircle2 size={12} /> :
                               status === "active" ? <Loader2 size={12} className="animate-spin" /> :
                               <span>{i+1}</span>}
                              <span>{phase.name}</span>
                            </div>
                            {i < PHASES.length - 1 && (
                              <div className={`w-4 h-0.5 ${status === "done" ? "bg-[var(--success)]" : "bg-[var(--line)]"}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* 回测 + 风控 */}
                  <div className="grid gap-6 md:grid-cols-2">
                    {/* 回测 */}
                    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <LineChart size={18} className="text-[var(--accent)]" />
                        <h3 className="text-sm font-bold text-[var(--foreground)]">Backtest Results</h3>
                      </div>

                      {backtest ? (
                        <div className="space-y-4">
                          <div className="text-center p-4 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
                            <div className="text-xs text-[var(--faint)] mb-1">Total Return</div>
                            <div className={`text-3xl font-black ${backtest.total_return_pct >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                              {backtest.total_return_pct}%
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-center">
                            <div className="p-2 rounded border border-[var(--line)] bg-[var(--surface)]">
                              <div className="text-xs text-[var(--faint)]">Drawdown</div>
                              <div className="text-sm font-bold">{backtest.max_drawdown_pct}%</div>
                            </div>
                            <div className="p-2 rounded border border-[var(--line)] bg-[var(--surface)]">
                              <div className="text-xs text-[var(--faint)]">Win Rate</div>
                              <div className="text-sm font-bold">{backtest.win_rate_pct}%</div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-[var(--muted)]">
                          {isRunning ? <Loader2 size={16} className="animate-spin mx-auto" /> : "Waiting..."}
                        </div>
                      )}
                    </section>

                    {/* 风控 */}
                    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <Shield size={18} className="text-[var(--accent)]" />
                        <h3 className="text-sm font-bold text-[var(--foreground)]">Risk Assessment</h3>
                      </div>

                      {risk ? (
                        <div className="space-y-4">
                          <div className="text-center">
                            <div className={`inline-grid h-20 w-20 place-items-center rounded-full border-4 ${
                              risk.risk_score >= 80 ? "border-[var(--success)]" :
                              risk.risk_score >= 60 ? "border-[var(--warning)]" :
                              "border-[var(--danger)]"
                            }`}>
                              <span className="text-2xl font-black">{risk.risk_score}</span>
                            </div>
                          </div>
                          <div className="text-center">
                            <span className={`px-4 py-2 rounded-full text-xs font-bold ${
                              risk.decision === "PASS" ? "bg-[var(--success)] text-white" :
                              risk.decision === "WARN" ? "bg-[var(--warning)] text-white" :
                              "bg-[var(--danger)] text-white"
                            }`}>
                              {risk.decision}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-[var(--muted)]">
                          {isRunning ? <Loader2 size={16} className="animate-spin mx-auto" /> : "Waiting..."}
                        </div>
                      )}
                    </section>
                  </div>

                  {/* 完成状态 */}
                  {currentPhase === "done" && (
                    <section className="rounded-xl border-2 border-[var(--success)] bg-[var(--success)]/10 p-6">
                      <CheckCircle2 size={32} className="mb-4 text-[var(--success)]" />
                      <h2 className="text-xl font-bold text-[var(--foreground)]">Pipeline Completed</h2>

                      <div className="mt-4 flex items-center gap-6 text-sm">
                        <div className="flex items-center gap-2">
                          <Bot size={14} className="text-[var(--accent)]" />
                          <span>7 Agents Executed</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Wrench size={14} className="text-[var(--accent)]" />
                          <span>7 Skills Applied</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Database size={14} className="text-[var(--success)]" />
                          <span>Memory Archived</span>
                        </div>
                      </div>

                      <div className="mt-6 flex gap-3">
                        <Link href="/history" className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold">
                          <Activity size={14} /> View History
                        </Link>
                        <button onClick={startFlow} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                          <Play size={14} /> Run Again
                        </button>
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}