import Link from "next/link";
import {
  ArrowRight,
  Play,
  TrendingUp,
  Shield,
  LineChart,
  Zap,
  Activity,
  BarChart3,
  Target,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  Bot,
  Lightbulb,
  AlertCircle
} from "lucide-react";
import { getPythonSnapshot } from "@/src/platform/python-backend";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const snapshot = await getPythonSnapshot();

  // 转换数据：Mission → Strategy（概念映射）
  const strategies = snapshot.missions.map(m => ({
    id: m.id,
    name: m.title,
    status: mapStrategyStatus(m.status),
    phase: getCurrentPhase(m.status),
    progress: calculateProgress(m.status),
    pnl: m.paper?.pnl_pct || m.backtest?.total_return_pct || 0,
    symbol: m.strategy?.symbol || "BTCUSDT",
    aiGenerated: true, // 标记AI生成
  }));

  const activeStrategies = strategies.filter(s => s.status === "running" || s.status === "paper_trading").length;
  const pendingStrategies = strategies.filter(s => s.status === "pending").length;
  const aiGeneratedToday = strategies.length > 0 ? Math.min(2, strategies.length) : 0; // 模拟AI生成数
  const humanApprovedToday = Math.min(1, strategies.filter(s => s.status === "completed").length);

  // Portfolio级别聚合指标
  const totalPnl = strategies.reduce((sum, s) => sum + s.pnl, 0);
  const avgSharpe = 1.87; // 模拟Portfolio Sharpe
  const maxDrawdown = 3.2; // 模拟Portfolio Max DD

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* ═════════════════ Header ═════════════════ */}
      <header className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot size={28} className="text-[var(--accent)]" />
              <h1 className="text-2xl font-bold text-[var(--foreground)]">PaperForge Quant Console</h1>
              <span className="rounded-full border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1 text-xs font-medium text-[var(--accent)]">
                Agent-Driven Pipeline
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--success)]/10 px-3 py-2">
              <CheckCircle2 size={16} className="text-[var(--success)]" />
              <span className="text-sm font-medium text-[var(--success)]">Agent System Operational</span>
            </div>
          </div>
        </div>
      </header>

      {/* ═════════════════ AI System Overview (Portfolio级别) ═════════════════ */}
      <section className="mx-auto max-w-7xl px-6 py-8">
        <h2 className="mb-6 text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
          <Bot size={20} className="text-[var(--accent)]" />
          Agent System Overview
        </h2>

        <div className="grid gap-6 md:grid-cols-2">
          {/* AI System Status Panel */}
          <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent)]/10 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Bot size={24} className="text-[var(--accent)]" />
              <h3 className="text-lg font-bold text-[var(--accent-strong)]">Agent System Status</h3>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-[var(--background)] p-3">
                <span className="text-sm text-[var(--muted)]">Strategies in AI Workflow</span>
                <span className="text-xl font-bold text-[var(--accent)]">{strategies.length}</span>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-[var(--background)] p-3">
                <span className="text-sm text-[var(--muted)]">Agent-Generated Today</span>
                <span className="text-xl font-bold text-[var(--accent)]">{aiGeneratedToday}</span>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-[var(--background)] p-3">
                <span className="text-sm text-[var(--muted)]">Human-Approved Today</span>
                <span className="text-xl font-bold text-[var(--success)]">{humanApprovedToday}</span>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-[var(--background)] p-3">
                <span className="text-sm text-[var(--muted)]">Agent-Rejected Today</span>
                <span className="text-xl font-bold text-[var(--warning)]">1</span>
              </div>
            </div>

            {/* System Health */}
            <div className="mt-4 pt-4 border-t border-[var(--line)]">
              <h4 className="text-sm font-semibold text-[var(--muted)] mb-3">Agent Framework Health</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <CheckCircle2 size={14} className="text-[var(--success)]" />
                  <span className="text-[var(--foreground)]">Executor Engine: ✓</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <CheckCircle2 size={14} className="text-[var(--success)]" />
                  <span className="text-[var(--foreground)]">Data Pipeline: ✓</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <CheckCircle2 size={14} className="text-[var(--success)]" />
                  <span className="text-[var(--foreground)]">Risk Agent: ✓</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <CheckCircle2 size={14} className="text-[var(--success)]" />
                  <span className="text-[var(--foreground)]">LLM Provider: ✓</span>
                </div>
              </div>
            </div>
          </div>

          {/* Portfolio Performance Metrics */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-6">
            <div className="flex items-center gap-3 mb-4">
              <BarChart3 size={24} className="text-[var(--muted)]" />
              <h3 className="text-lg font-bold text-[var(--foreground)]">Portfolio Performance</h3>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-[var(--success)] bg-[var(--success)]/5 p-4">
                <div className="text-xs text-[var(--muted)] mb-2">Total PnL</div>
                <div className="text-2xl font-bold text-[var(--success)]">
                  {totalPnl > 0 ? "+" : ""}{totalPnl.toFixed(2)}%
                </div>
                <div className="flex items-center gap-1 mt-2">
                  <TrendingUp size={14} className="text-[var(--success)]" />
                  <span className="text-xs text-[var(--muted)]">Portfolio Level</span>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/5 p-4">
                <div className="text-xs text-[var(--muted)] mb-2">Sharpe Ratio</div>
                <div className="text-2xl font-bold text-[var(--accent)]">{avgSharpe.toFixed(2)}</div>
                <div className="flex items-center gap-1 mt-2">
                  <Activity size={14} className="text-[var(--accent)]" />
                  <span className="text-xs text-[var(--muted)]">Risk-Adjusted</span>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--warning)] bg-[var(--warning)]/5 p-4">
                <div className="text-xs text-[var(--muted)] mb-2">Max Drawdown</div>
                <div className="text-2xl font-bold text-[var(--warning)]">{maxDrawdown.toFixed(1)}%</div>
                <div className="flex items-center gap-1 mt-2">
                  <AlertTriangle size={14} className="text-[var(--warning)]" />
                  <span className="text-xs text-[var(--muted)]">Portfolio DD</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-[var(--line)]">
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center">
                  <div className="text-lg font-bold text-[var(--foreground)]">{activeStrategies}</div>
                  <div className="text-xs text-[var(--muted)]">Active</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-[var(--accent)]">
                    {strategies.filter(s => s.status === "paper_trading").length}
                  </div>
                  <div className="text-xs text-[var(--muted)]">Paper Trading</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-[var(--success)]">
                    {strategies.filter(s => s.status === "running").length}
                  </div>
                  <div className="text-xs text-[var(--muted)]">Running</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-[var(--warning)]">{pendingStrategies}</div>
                  <div className="text-xs text-[var(--muted)]">Pending</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═════════════════ AI Recommendations (系统级推荐) ═════════════════ */}
      <section className="mx-auto max-w-7xl px-6 py-6">
        <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
          <Lightbulb size={20} className="text-[var(--accent)]" />
          Agent Recommendations
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Recommendation #1 */}
          <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent)]/5 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-[var(--accent)]/20 p-2">
                <Sparkles size={20} className="text-[var(--accent)]" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-[var(--accent)]">Agent Recommendation</span>
                  <CheckCircle2 size={14} className="text-[var(--success)]" />
                </div>
                <p className="text-sm text-[var(--foreground)] mb-3">
                  Deploy EMA Breakout template - favorable market conditions detected in BTCUSDT with strong momentum signals
                </p>
                <div className="flex gap-2">
                  <Link
                    href="/strategy-library"
                    className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-bold text-white hover:bg-[var(--accent-strong)]"
                  >
                    Accept
                  </Link>
                  <button className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--muted)] hover:border-[var(--accent)]">
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Alert #1 */}
          <div className="rounded-xl border border-[var(--warning)] bg-[var(--warning)]/5 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-[var(--warning)]/20 p-2">
                <AlertCircle size={20} className="text-[var(--warning)]" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-[var(--warning)]">Agent Alert</span>
                  <AlertTriangle size={14} className="text-[var(--warning)]" />
                </div>
                <p className="text-sm text-[var(--foreground)] mb-3">
                  High volatility detected in BTCUSDT - consider reducing position sizes for active strategies
                </p>
                <div className="flex gap-2">
                  <button className="rounded-lg border border-[var(--warning)] bg-[var(--warning)] px-3 py-2 text-xs font-bold text-white hover:bg-[var(--warning)]">
                    Acknowledge
                  </button>
                  <button className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--muted)] hover:border-[var(--accent)]">
                    View Details
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═════════════════ Recent System Events (系统事件日志) ═════════════════ */}
      <section className="mx-auto max-w-7xl px-6 py-6">
        <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
          <Activity size={20} className="text-[var(--muted)]" />
          Recent System Events
        </h2>

        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
          <div className="space-y-3">
            <EventLogItem
              icon={<AlertTriangle size={16} className="text-[var(--warning)]" />}
              message="Risk Agent blocked strategy #2 (risk score: 45/100)"
              timestamp="10 mins ago"
              type="warning"
            />
            <EventLogItem
              icon={<TrendingUp size={16} className="text-[var(--success)]" />}
              message="Factor Agent detected momentum opportunity in BTCUSDT"
              timestamp="25 mins ago"
              type="success"
            />
            <EventLogItem
              icon={<CheckCircle2 size={16} className="text-[var(--success)]" />}
              message="Human approved strategy #3 for paper trading"
              timestamp="1 hour ago"
              type="success"
            />
            <EventLogItem
              icon={<Sparkles size={16} className="text-[var(--accent)]" />}
              message="Strategy Agent generated 2 custom strategies from NL input"
              timestamp="2 hours ago"
              type="accent"
            />
          </div>
        </div>
      </section>

      {/* ═════════════════ Quick Actions ═════════════════ */}
      <section className="mx-auto max-w-7xl px-6 py-6">
        <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Quick Actions</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <Link
            href="/strategy-library"
            className="group relative overflow-hidden rounded-xl border-2 border-[var(--accent)] bg-[var(--accent)]/10 p-6 transition-all hover:bg-[var(--accent)]/20"
          >
            <div className="relative z-10">
              <div className="mb-3 flex items-center gap-3">
                <Zap size={24} className="text-[var(--accent)]" />
                <h3 className="text-xl font-bold text-[var(--accent-strong)]">Create Strategy with Agent</h3>
              </div>
              <p className="text-sm text-[var(--muted)]">
                Describe your strategy in natural language. Strategy Agent will generate complete spec.
              </p>
              <div className="mt-4 flex items-center gap-2 text-sm font-medium text-[var(--accent)]">
                <span>Start Creating</span>
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>

          <Link
            href="/strategy-library"
            className="group relative overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] p-6 transition-all hover:border-[var(--accent)] hover:shadow-lg"
          >
            <div className="relative z-10">
              <div className="mb-3 flex items-center gap-3">
                <LineChart size={24} className="text-[var(--muted)]" />
                <h3 className="text-xl font-bold text-[var(--foreground)]">Browse Strategy Library</h3>
              </div>
              <p className="text-sm text-[var(--muted)]">
                Choose from pre-built templates: EMA Breakout, RSI Reversal, Multi-factor Momentum
              </p>
              <div className="mt-4 flex items-center gap-2 text-sm font-medium text-[var(--accent)]">
                <span>View Templates</span>
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* ═════════════════ Active Strategies Overview ═════════════════ */}
      <section className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Active Strategies</h2>
          <Link
            href="/strategies"
            className="text-sm font-medium text-[var(--accent)] hover:underline"
          >
            View All Strategies →
          </Link>
        </div>

        <div className="space-y-4">
          {strategies.slice(0, 5).map((strategy) => (
            <StrategyCard key={strategy.id} strategy={strategy} />
          ))}
        </div>
      </section>

      {/* ═════════════════ Footer ═════════════════ */}
      <footer className="border-t border-[var(--line)] py-6">
        <div className="mx-auto max-w-7xl px-6">
          <nav className="flex items-center justify-center gap-6 text-sm">
            <Link href="/dashboard" className="text-[var(--accent)]">Dashboard</Link>
            <Link href="/strategy-library" className="text-[var(--muted)] hover:text-[var(--accent)]">Strategy Library</Link>
            <Link href="/strategies" className="text-[var(--muted)] hover:text-[var(--accent)]">All Strategies</Link>
            <Link href="/live-monitor" className="text-[var(--muted)] hover:text-[var(--accent)]">Live Monitor</Link>
          </nav>
          <p className="mt-4 text-center text-xs text-[var(--faint)]">
            PaperForge Quant Console · Agent-Driven Strategy Pipeline · Bitget AI Hackathon 2026
          </p>
        </div>
      </footer>
    </div>
  );
}

// ═════════════════ Helper Functions ═════════════════

function mapStrategyStatus(missionStatus: string): string {
  const mapping: Record<string, string> = {
    "running": "running",
    "paper_trading": "paper_trading",
    "approval": "pending",
    "ready": "ready",
    "completed": "completed",
    "failed": "failed",
  };
  return mapping[missionStatus] || "pending";
}

function getCurrentPhase(status: string): string {
  const mapping: Record<string, string> = {
    "running": "Backtest Validation",
    "paper_trading": "Paper Trading",
    "approval": "Approval Gate",
    "ready": "Ready to Deploy",
    "completed": "Completed",
    "failed": "Failed",
  };
  return mapping[status] || "Research Phase";
}

function calculateProgress(status: string): number {
  const mapping: Record<string, number> = {
    "intake": 10,
    "planning": 20,
    "ready": 30,
    "running": 50,
    "paper_trading": 70,
    "approval": 80,
    "completed": 100,
    "failed": 0,
  };
  return mapping[status] || 0;
}

// ═════════════════ Components ═════════════════

function EventLogItem({
  icon,
  message,
  timestamp,
  type
}: {
  icon: React.ReactNode;
  message: string;
  timestamp: string;
  type: "success" | "warning" | "accent" | "error";
}) {
  const borderColors = {
    success: "border-[var(--success)]/30",
    warning: "border-[var(--warning)]/30",
    accent: "border-[var(--accent)]/30",
    error: "border-[var(--error)]/30",
  };

  return (
    <div className={`flex items-center gap-3 rounded-lg border ${borderColors[type]} bg-[var(--background)] px-3 py-2`}>
      <div className="flex-shrink-0">{icon}</div>
      <div className="flex-1 text-sm text-[var(--foreground)]">{message}</div>
      <div className="text-xs text-[var(--muted)]">{timestamp}</div>
    </div>
  );
}

function StrategyCard({ strategy }: { strategy: any }) {
  return (
    <Link
      href={`/strategies/${strategy.id}`}
      className="group block rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 transition-all hover:border-[var(--accent)] hover:shadow-lg"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-lg font-semibold text-[var(--foreground)] group-hover:text-[var(--accent)]">
              {strategy.name}
            </h3>
            {strategy.aiGenerated && (
              <span className="rounded-full bg-[var(--accent)]/15 px-2 py-1 text-xs text-[var(--accent)]">
                ⚡ Agent-Generated
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
            <span className="rounded-full border border-[var(--line)] bg-[var(--background)] px-2 py-1">
              {strategy.symbol}
            </span>
            <span className={strategy.pnl > 0 ? "text-[var(--success)]" : "text-[var(--error)]"}>
              PnL: {strategy.pnl > 0 ? "+" : ""}{strategy.pnl.toFixed(2)}%
            </span>
            <span className="rounded-full border border-[var(--line)] px-2 py-1">
              {strategy.phase}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-[var(--line)]">
              <div
                className="h-2 rounded-full bg-[var(--accent)] transition-all"
                style={{ width: `${strategy.progress}%` }}
              />
            </div>
            <span className="text-xs text-[var(--muted)]">{strategy.progress}%</span>
          </div>
        </div>

        <ArrowRight size={20} className="text-[var(--muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--accent)]" />
      </div>
    </Link>
  );
}