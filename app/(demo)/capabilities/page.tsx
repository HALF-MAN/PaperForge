import Link from "next/link";
import {
  ArrowLeft,
  TrendingUp,
  Shield,
  Target,
  BarChart3,
  Zap,
  Activity,
  CheckCircle2,
  Code,
  ExternalLink
} from "lucide-react";

export default function CapabilitiesPage() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--panel-soft)]/90 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-sm text-[var(--muted)] transition hover:text-[var(--accent)]">
            <ArrowLeft size={16} />
            Back
          </Link>

          <h1 className="text-lg font-bold text-[var(--foreground)]">Capabilities</h1>

          <Link href="/run" className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]">
            <Zap size={14} />
            Try Demo
          </Link>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-6 py-12">

        {/* 介绍 */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-4 py-2 mb-6">
            <Code size={14} className="text-[var(--accent)]" />
            <span className="text-sm font-medium text-[var(--accent-strong)]">Trading Infra for AI Agents</span>
          </div>

          <h1 className="text-3xl font-bold text-[var(--foreground)] mb-4">
            PaperForge Capabilities
          </h1>
          <p className="text-lg text-[var(--muted)] max-w-2xl mx-auto">
            Plug-and-play infrastructure for building trading AI agents.
            Each capability is designed to solve real pain points in agent development.
          </p>
        </div>

        {/* 核心能力卡片 */}
        <div className="grid gap-8 md:grid-cols-2">

          {/* Paper Trading Sandbox */}
          <CapabilitySection
            title="Paper Trading Sandbox"
            desc="Simulated execution environment with full order tracking, PnL calculation, and kill switch."
            icon={<TrendingUp size={32} />}
            features={[
              "Order simulation with realistic fills",
              "Balance tracking and position management",
              "PnL calculation with fee modeling",
              "Kill switch for emergency stop",
              "14-day tracking period"
            ]}
            apiEndpoint="/missions/run-flow"
            painPoint="Agents need a safe way to validate strategies before real capital"
          />

          {/* Risk Monitor */}
          <CapabilitySection
            title="Risk Monitor & Gate"
            desc="Real-time risk scoring with configurable thresholds and approval gates."
            icon={<Shield size={32} />}
            features={[
              "Drawdown monitoring with alerts",
              "Position size validation",
              "Leverage limits enforcement",
              "Risk score (0-100) with decision output",
              "PASS / WARN / BLOCK classification"
            ]}
            apiEndpoint="/missions/run-flow"
            painPoint="Agents can accidentally execute dangerous trades without safety checks"
          />

          {/* Strategy Compiler */}
          <CapabilitySection
            title="Natural Language Strategy Compiler"
            desc="Convert plain English into structured StrategySpec with entry/exit rules."
            icon={<Target size={32} />}
            features={[
              "Template-based strategy library",
              "Entry/exit rule compilation",
              "Risk parameter normalization",
              "Symbol and timeframe detection",
              "Zod-validated output schema"
            ]}
            apiEndpoint="/missions/run-flow"
            painPoint="Agents need structured input, not freeform text"
          />

          {/* Backtest Engine */}
          <CapabilitySection
            title="Backtest Engine"
            desc="Historical simulation with standard metrics for strategy validation."
            icon={<BarChart3 size={32} />}
            features={[
              "EMA/RSI indicator calculation",
              "Market data fetching (100 candles)",
              "Win rate, profit factor, drawdown",
              "Trade count and average PnL",
              "Mock data mode for demo"
            ]}
            apiEndpoint="/missions/run-flow"
            painPoint="Agents need evidence before recommending trades"
          />
        </div>

        {/* API接入说明 */}
        <section className="mt-16 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 p-8">
          <div className="flex items-center gap-3 mb-6">
            <Code size={24} className="text-[var(--accent)]" />
            <h2 className="text-xl font-bold text-[var(--foreground)]">How to Integrate</h2>
          </div>

          <div className="space-y-4 text-[var(--muted)]">
            <p>
              <strong className="text-[var(--foreground)]">Single API Call:</strong> POST to <code className="px-2 py-1 rounded bg-[var(--surface)] text-[var(--accent)]">/missions/run-flow</code> with <code className="px-2 py-1 rounded bg-[var(--surface)] text-[var(--accent)]">{"{ missionId }"}</code>
            </p>
            <p>
              <strong className="text-[var(--foreground)]">Returns:</strong> Full execution result including backtest metrics, risk score, and deployment decision.
            </p>
            <p>
              <strong className="text-[var(--foreground)]">No Setup Required:</strong> Backend handles plan generation, agent assembly, and execution.
            </p>
          </div>

          <div className="mt-6 flex items-center gap-4">
            <Link href="/run" className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-3 font-semibold text-white transition hover:bg-[var(--accent-strong)]">
              <Play size={16} />
              Try Live Demo
            </Link>
            <a href="https://github.com" className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-5 py-3 font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)]">
              <ExternalLink size={16} />
              View on GitHub
            </a>
          </div>
        </section>

        {/* 黑客松赛道说明 */}
        <section className="mt-12 text-center">
          <div className="inline-flex items-center gap-3 rounded-full bg-[var(--panel)] px-5 py-2 border border-[var(--line)]">
            <CheckCircle2 size={16} className="text-[var(--success)]" />
            <span className="text-sm text-[var(--muted)]">
              Built for <strong className="text-[var(--foreground)]">Trading Infra Track</strong> · Bitget AI Hackathon 2026
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}

function CapabilitySection({
  title,
  desc,
  icon,
  features,
  apiEndpoint,
  painPoint
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  features: string[];
  apiEndpoint: string;
  painPoint: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 transition-all hover:border-[var(--accent)] hover:shadow-[0_0_30px_rgba(94,106,210,0.1)]">
      {/* 图标 + 标题 */}
      <div className="flex items-center gap-4 mb-4">
        <div className="grid h-14 w-14 place-items-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]">
          {icon}
        </div>
        <div>
          <h3 className="text-lg font-bold text-[var(--foreground)]">{title}</h3>
          <p className="text-sm text-[var(--muted)]">{desc}</p>
        </div>
      </div>

      {/* 功能列表 */}
      <ul className="space-y-2 mb-6">
        {features.map((feature, i) => (
          <li key={i} className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <CheckCircle2 size={14} className="text-[var(--success)]" />
            {feature}
          </li>
        ))}
      </ul>

      {/* Pain Point */}
      <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-4 mb-4">
        <div className="flex items-center gap-2 text-xs uppercase text-[var(--warning)] mb-1">
          <Activity size={12} />
          Pain Point Solved
        </div>
        <p className="text-sm text-[var(--muted)]">{painPoint}</p>
      </div>

      {/* API */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-[var(--faint)]">API:</span>
        <code className="px-2 py-1 rounded bg-[var(--surface)] text-[var(--accent)]">{apiEndpoint}</code>
      </div>
    </div>
  );
}

function Play({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}