"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  ArrowRight,
  Copy,
  Loader2,
  Search,
  ShieldCheck,
  Store,
  TrendingUp,
} from "lucide-react";
import { listMarketplaceStrategies, type SavedStrategy } from "@/src/utils/savedStrategies";

type Sort = "latest" | "return" | "copied";

export default function MarketplacePage() {
  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState("全部");
  const [sort, setSort] = useState<Sort>("latest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMarketplaceStrategies()
      .then((result) => {
        if (!cancelled) setStrategies(result.strategies);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "策略广场加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    strategies.flatMap((item) => item.tags).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    return ["全部", ...[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tag]) => tag)];
  }, [strategies]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return strategies
      .filter((strategy) => {
        if (activeTag !== "全部" && !strategy.tags.includes(activeTag)) return false;
        if (!normalized) return true;
        return [strategy.name, strategy.description, strategy.symbol, strategy.publisherName, ...strategy.tags]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      })
      .sort((a, b) => {
        if (sort === "return") return (b.latestMetrics.totalReturn || 0) - (a.latestMetrics.totalReturn || 0);
        if (sort === "copied") return (b.copyCount || 0) - (a.copyCount || 0);
        return new Date(b.publishedAt || b.updatedAt).getTime() - new Date(a.publishedAt || a.updatedAt).getTime();
      });
  }, [activeTag, query, sort, strategies]);

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <MarketplaceHeader />

      <section className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto max-w-7xl px-5 py-10 lg:px-8 lg:py-14">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Strategy Marketplace</p>
              <h1 className="mt-3 text-3xl font-bold tracking-[-0.02em] lg:text-4xl">策略广场</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                发现社区公开的量化策略，检查回测证据与参数，再复制到自己的工作区继续研究。
              </p>
            </div>
            <div className="flex gap-8 border-l border-[var(--line)] pl-6">
              <Summary label="公开策略" value={strategies.length} />
              <Summary label="累计复制" value={strategies.reduce((sum, item) => sum + (item.copyCount || 0), 0)} />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-7 lg:px-8">
        <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {tags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(tag)}
                className={`shrink-0 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                  activeTag === tag
                    ? "bg-[var(--foreground)] text-[var(--panel)]"
                    : "border border-[var(--line)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 sm:w-64">
              <Search size={15} className="shrink-0 text-[var(--muted)]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索策略、标的或作者" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--faint)]" />
            </label>
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="h-10 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 text-sm font-medium outline-none">
              <option value="latest">最新发布</option>
              <option value="return">累计收益</option>
              <option value="copied">最多复制</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="grid min-h-80 place-items-center text-sm text-[var(--muted)]"><span className="flex items-center gap-2"><Loader2 size={17} className="animate-spin" />加载公开策略...</span></div>
        ) : error ? (
          <div className="mt-6 rounded-md border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">{error}</div>
        ) : filtered.length ? (
          <div className="grid gap-4 py-6 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((strategy) => <MarketplaceCard key={strategy.id} strategy={strategy} />)}
          </div>
        ) : (
          <div className="grid min-h-96 place-items-center py-8 text-center">
            <div>
              <div className="mx-auto grid size-12 place-items-center rounded-md border border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"><Store size={22} /></div>
              <h2 className="mt-4 text-lg font-bold">{strategies.length ? "没有匹配的公开策略" : "策略广场正在等待第一份作品"}</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">从“我的策略”选择一个已经验证的策略并发布，它会出现在这里。</p>
              {!strategies.length && <Link href="/strategies" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]">前往我的策略 <ArrowRight size={15} /></Link>}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function MarketplaceHeader() {
  return (
    <header className="border-b border-[var(--line)] bg-[var(--panel)]">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5 font-bold"><span className="grid size-8 place-items-center rounded-md bg-[var(--foreground)] text-[var(--panel)]"><Store size={16} /></span>PaperForge</Link>
        <nav className="flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--background)] p-1 text-sm">
          <Link href="/strategy-lab" className="rounded px-3 py-1.5 text-[var(--muted)] hover:text-[var(--foreground)]">策略研究</Link>
          <Link href="/strategies" className="rounded px-3 py-1.5 text-[var(--muted)] hover:text-[var(--foreground)]">我的策略</Link>
          <span className="rounded bg-[var(--surface)] px-3 py-1.5 font-semibold shadow-sm">策略广场</span>
        </nav>
      </div>
    </header>
  );
}

function MarketplaceCard({ strategy }: { strategy: SavedStrategy }) {
  const metrics = strategy.latestMetrics || {};
  return (
    <Link href={`/marketplace/${strategy.id}` as Route} className="group flex min-h-72 flex-col rounded-md border border-[var(--line)] bg-[var(--panel)] p-5 transition hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-soft)]">
      <div className="flex items-start justify-between gap-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]"><TrendingUp size={17} /></div>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--success)]"><ShieldCheck size={12} />公开回测</span>
      </div>
      <h2 className="mt-5 line-clamp-1 text-lg font-bold">{strategy.name}</h2>
      <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-[var(--muted)]">{strategy.description}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">{strategy.tags.slice(0, 4).map((tag) => <span key={tag} className="rounded bg-[var(--panel-muted)] px-2 py-1 text-[10px] text-[var(--muted)]">{tag}</span>)}</div>
      <div className="mt-auto grid grid-cols-3 border-y border-[var(--line)] py-4">
        <CardMetric label="累计收益" value={formatPercent(metrics.totalReturn)} tone={(metrics.totalReturn || 0) >= 0 ? "success" : "danger"} />
        <CardMetric label="最大回撤" value={formatPercent(metrics.maxDrawdown)} />
        <CardMetric label="Sharpe" value={formatNumber(metrics.sharpe)} />
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{strategy.publisherName || "PaperForge Creator"} · {strategy.symbol} {strategy.timeframe}</span>
        <span className="inline-flex items-center gap-1"><Copy size={12} />{strategy.copyCount || 0}</span>
      </div>
    </Link>
  );
}

function Summary({ label, value }: { label: string; value: number }) { return <div><div className="text-2xl font-bold">{value}</div><div className="mt-1 text-xs text-[var(--muted)]">{label}</div></div>; }
function CardMetric({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) { return <div><div className={`text-sm font-bold ${tone === "success" ? "text-[var(--success)]" : tone === "danger" ? "text-[var(--danger)]" : ""}`}>{value}</div><div className="mt-1 text-[10px] text-[var(--muted)]">{label}</div></div>; }
function formatPercent(value?: number) { return value === undefined ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`; }
function formatNumber(value?: number) { return value === undefined ? "--" : value.toFixed(2); }
