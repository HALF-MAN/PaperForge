import Link from "next/link";
import {
  ArrowLeft,
  Activity,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Shield,
  LineChart,
  Zap,
  Play
} from "lucide-react";
import { getPythonSnapshot } from "@/src/platform/python-backend";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const snapshot = await getPythonSnapshot();
  const missions = [...snapshot.missions].reverse();

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--panel-soft)]/90 backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-sm text-[var(--muted)] transition hover:text-[var(--accent)]">
            <ArrowLeft size={16} />
            Back
          </Link>

          <h1 className="text-lg font-bold text-[var(--foreground)]">Run History</h1>

          <Link href="/run" className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]">
            <Play size={14} />
            New Run
          </Link>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* 统计 */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard label="Total Runs" value={String(missions.length)} />
          <StatCard label="Completed" value={String(missions.filter(m => m.status === "completed" || m.status === "approval").length)} />
          <StatCard label="Blocked" value={String(missions.filter(m => m.risk.decision === "BLOCK").length)} />
        </div>

        {/* 运行列表 */}
        <div className="space-y-4">
          {missions.length === 0 ? (
            <div className="text-center py-16 rounded-xl border border-[var(--line)] bg-[var(--panel)]">
              <Activity size={32} className="mx-auto mb-4 text-[var(--muted)]" />
              <p className="text-[var(--muted)]">No runs yet. Start a demo to see results here.</p>
              <Link href="/run" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
                <Play size={14} />
                Launch Demo
              </Link>
            </div>
          ) : (
            missions.map((mission) => (
              <RunCard key={mission.id} mission={mission} />
            ))
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-center">
      <div className="text-2xl font-bold text-[var(--foreground)]">{value}</div>
      <div className="mt-1 text-xs text-[var(--muted)]">{label}</div>
    </div>
  );
}

function RunCard({ mission }: { mission: { id: string; title: string; status: string; strategy: { name: string; symbol: string }; backtest: { totalReturnPct: number; maxDrawdownPct: number; tradeCount: number }; risk: { decision: string; riskScore: number } } }) {
  const isBlocked = mission.risk.decision === "BLOCK";
  const isSuccess = mission.status === "completed" || mission.status === "approval";

  return (
    <Link href={`/run`} className="group block">
      <div className={`rounded-xl border-2 p-5 transition-all group-hover:scale-[1.02] ${
        isBlocked
          ? "border-[var(--danger)]/30 bg-[var(--danger)]/5 group-hover:border-[var(--danger)]"
          : isSuccess
            ? "border-[var(--success)]/30 bg-[var(--success)]/5 group-hover:border-[var(--success)]"
            : "border-[var(--line)] bg-[var(--panel)] group-hover:border-[var(--accent)]"
      }`}>
        {/* 头行 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`grid h-10 w-10 place-items-center rounded-xl ${
              isBlocked
                ? "bg-[var(--danger)]/20 text-[var(--danger)]"
                : isSuccess
                  ? "bg-[var(--success)]/20 text-[var(--success)]"
                  : "bg-[var(--accent)]/20 text-[var(--accent)]"
            }`}>
              {isBlocked ? <XCircle size={20} /> : isSuccess ? <CheckCircle2 size={20} /> : <Activity size={20} />}
            </div>
            <div>
              <div className="font-semibold text-[var(--foreground)]">{mission.title}</div>
              <div className="text-xs text-[var(--muted)]">{mission.strategy.name} · {mission.strategy.symbol}</div>
            </div>
          </div>

          <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${
            isBlocked
              ? "bg-[var(--danger)]/20 text-[var(--danger)]"
              : isSuccess
                ? "bg-[var(--success)]/20 text-[var(--success)]"
                : "bg-[var(--accent)]/20 text-[var(--accent)]"
          }`}>
            {isBlocked ? "BLOCKED" : isSuccess ? "SUCCESS" : mission.status}
          </div>
        </div>

        {/* 数据行 */}
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 mb-1">
              <LineChart size={12} className="text-[var(--accent)]" />
              <span className="text-xs text-[var(--faint)]">Return</span>
            </div>
            <div className={`font-bold ${mission.backtest.totalReturnPct >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
              {mission.backtest.totalReturnPct}%
            </div>
          </div>

          <div>
            <div className="flex items-center justify-center gap-1 mb-1">
              <TrendingDown size={12} className="text-[var(--warning)]" />
              <span className="text-xs text-[var(--faint)]">Drawdown</span>
            </div>
            <div className={`font-bold ${mission.backtest.maxDrawdownPct <= 10 ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>
              {mission.backtest.maxDrawdownPct}%
            </div>
          </div>

          <div>
            <div className="flex items-center justify-center gap-1 mb-1">
              <Shield size={12} className="text-[var(--accent)]" />
              <span className="text-xs text-[var(--faint)]">Risk</span>
            </div>
            <div className={`font-bold ${mission.risk.riskScore >= 80 ? "text-[var(--success)]" : mission.risk.riskScore >= 60 ? "text-[var(--warning)]" : "text-[var(--danger)]"}`}>
              {mission.risk.riskScore}/100
            </div>
          </div>

          <div>
            <div className="flex items-center justify-center gap-1 mb-1">
              <Zap size={12} className="text-[var(--accent)]" />
              <span className="text-xs text-[var(--faint)]">Trades</span>
            </div>
            <div className="font-bold text-[var(--foreground)]">
              {mission.backtest.tradeCount}
            </div>
          </div>
        </div>

        {/* ID */}
        <div className="mt-4 text-xs text-[var(--faint)]">
          ID: {mission.id}
        </div>
      </div>
    </Link>
  );
}