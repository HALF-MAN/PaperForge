"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Check,
  Copy,
  Database,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Store,
} from "lucide-react";
import {
  copyMarketplaceStrategy,
  getMarketplaceStrategy,
  type SavedStrategy,
  type StrategyVersion,
} from "@/src/utils/savedStrategies";

type PublicDetail = {
  strategy: SavedStrategy;
  currentVersion: Omit<StrategyVersion, "code" | "sourceArtifactId" | "sourceArtifactType"> | null;
};

export default function MarketplaceStrategyPage() {
  const { strategyId } = useParams<{ strategyId: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<PublicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMarketplaceStrategy(strategyId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "公开策略加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [strategyId]);

  const copyStrategy = async () => {
    setCopying(true);
    setError(null);
    try {
      const result = await copyMarketplaceStrategy(strategyId);
      router.push(`/strategies/${result.strategy.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "复制策略失败");
      setCopying(false);
    }
  };

  if (loading) return <div className="grid min-h-screen place-items-center bg-[var(--background)] text-sm text-[var(--muted)]"><span className="flex items-center gap-2"><Loader2 size={17} className="animate-spin" />加载公开策略...</span></div>;
  if (!detail) return <div className="grid min-h-screen place-items-center bg-[var(--background)] text-center"><div><p className="text-sm text-[var(--danger)]">{error || "策略不存在或已取消发布"}</p><Link href={"/marketplace" as Route} className="mt-4 inline-flex text-sm font-bold text-[var(--accent)]">返回策略广场</Link></div></div>;

  const { strategy, currentVersion } = detail;
  const metrics = strategy.latestMetrics || {};
  const params = currentVersion?.params || {};
  const config = currentVersion?.backtestConfig || {};

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
          <Link href={"/marketplace" as Route} className="flex items-center gap-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={16} />策略广场</Link>
          <button onClick={() => void copyStrategy()} disabled={copying} className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-bold text-white disabled:opacity-60">
            {copying ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}复制到我的策略
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
        <div className="grid gap-8 border-b border-[var(--line)] pb-8 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded border border-[var(--success)]/25 bg-[var(--success-soft)] px-2 py-1 text-xs font-semibold text-[var(--success)]"><ShieldCheck size={12} />公开策略</span>
              <span className="rounded border border-[var(--line)] px-2 py-1 text-xs text-[var(--muted)]">{strategy.symbol} · {strategy.timeframe}</span>
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-[-0.02em] lg:text-4xl">{strategy.name}</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--muted)]">{strategy.description}</p>
            <div className="mt-5 flex flex-wrap gap-2">{strategy.tags.map((tag) => <span key={tag} className="rounded bg-[var(--panel-muted)] px-2 py-1 text-xs text-[var(--muted)]">{tag}</span>)}</div>
          </div>
          <div className="border-l border-[var(--line)] pl-6 text-sm">
            <p className="text-xs text-[var(--muted)]">发布者</p><p className="mt-1 font-bold">{strategy.publisherName || "PaperForge Creator"}</p>
            <p className="mt-5 text-xs text-[var(--muted)]">发布时间</p><p className="mt-1 font-semibold">{formatDate(strategy.publishedAt || strategy.updatedAt)}</p>
            <p className="mt-5 flex items-center gap-1.5 text-xs text-[var(--muted)]"><Copy size={12} />已被复制 {strategy.copyCount || 0} 次</p>
          </div>
        </div>

        {error && <div className="mt-5 rounded-md border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">{error}</div>}

        <div className="grid overflow-hidden rounded-md border border-[var(--line)] bg-[var(--panel)] sm:grid-cols-5 mt-7">
          <Metric label="累计收益" value={formatPercent(metrics.totalReturn)} tone={(metrics.totalReturn || 0) >= 0 ? "success" : "danger"} />
          <Metric label="年化收益" value={formatPercent(metrics.annualReturn)} />
          <Metric label="Sharpe" value={formatNumber(metrics.sharpe)} />
          <Metric label="最大回撤" value={formatPercent(metrics.maxDrawdown)} />
          <Metric label="胜率" value={formatPercent(metrics.winRate)} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <section className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5">
              <h2 className="flex items-center gap-2 font-bold"><BarChart3 size={17} className="text-[var(--accent)]" />回测证据</h2>
              <div className="mt-5 grid gap-5 text-sm sm:grid-cols-3">
                <Info label="数据标的" value={String(config.symbol || strategy.symbol)} />
                <Info label="时间周期" value={String(config.granularity || strategy.timeframe)} />
                <Info label="交易次数" value={String(metrics.tradeCount ?? "--")} />
                <Info label="开始日期" value={String(config.startDate || "--")} />
                <Info label="结束日期" value={String(config.endDate || "--")} />
                <Info label="策略版本" value={`v${currentVersion?.version || strategy.versionCount}`} />
              </div>
            </section>
            <section className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5">
              <h2 className="flex items-center gap-2 font-bold"><Database size={17} className="text-[var(--accent)]" />公开参数</h2>
              <div className="mt-4 grid gap-x-8 sm:grid-cols-2">
                {Object.entries(params).map(([key, value]) => <div key={key} className="flex items-center justify-between border-b border-[var(--line)] py-3 text-sm"><span className="font-mono text-xs text-[var(--muted)]">{key}</span><span className="font-semibold">{String(value)}</span></div>)}
                {!Object.keys(params).length && <p className="text-sm text-[var(--muted)]">该策略没有公开参数。</p>}
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5">
              <h2 className="flex items-center gap-2 font-bold"><Store size={17} />如何使用</h2>
              <div className="mt-4 space-y-3 text-sm leading-6 text-[var(--muted)]">
                <p className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-[var(--success)]" />复制后会创建独立的私有策略和版本。</p>
                <p className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-[var(--success)]" />可以查看源码、修改参数并重新回测。</p>
                <p className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-[var(--success)]" />原策略后续变化不会覆盖你的版本。</p>
              </div>
            </section>
            <section className="rounded-md border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-5">
              <h2 className="flex items-center gap-2 text-sm font-bold"><LockKeyhole size={16} />风险提示</h2>
              <p className="mt-2 text-xs leading-6 text-[var(--muted)]">历史回测不代表未来收益。公开策略仅用于研究和沙箱验证，不构成投资建议。</p>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) { return <div className="border-b border-[var(--line)] p-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><div className="text-xs text-[var(--muted)]">{label}</div><div className={`mt-2 text-xl font-bold ${tone === "success" ? "text-[var(--success)]" : tone === "danger" ? "text-[var(--danger)]" : ""}`}>{value}</div></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div><div className="text-xs text-[var(--muted)]">{label}</div><div className="mt-1 font-semibold">{value}</div></div>; }
function formatPercent(value?: number) { return value === undefined ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`; }
function formatNumber(value?: number) { return value === undefined ? "--" : value.toFixed(2); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
