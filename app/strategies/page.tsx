"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock3,
  Code2,
  Loader2,
  Lock,
  Plus,
  Search,
  Store,
} from "lucide-react";
import { listSavedStrategies, type SavedStrategy } from "@/src/utils/savedStrategies";

type Filter = "all" | "private" | "published";

export default function MyStrategiesPage() {
  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSavedStrategies()
      .then((result) => {
        if (!cancelled) setStrategies(result.strategies);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "策略加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return strategies.filter((strategy) => {
      if (filter !== "all" && strategy.visibility !== filter) return false;
      if (!normalized) return true;
      return [strategy.name, strategy.description, strategy.symbol, ...strategy.tags]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [filter, query, strategies]);

  const backtestedCount = strategies.filter((item) => item.latestMetrics?.totalReturn !== undefined).length;

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md border border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]">
              <BookOpen size={18} />
            </div>
            <div>
              <div className="text-sm font-bold">PaperForge</div>
              <div className="text-xs text-[var(--muted)]">Strategy workspace</div>
            </div>
          </div>
          <nav className="flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--background)] p-1 text-sm">
            <Link href="/strategy-lab" className="rounded px-3 py-1.5 text-[var(--muted)] hover:text-[var(--foreground)]">策略研究</Link>
            <span className="rounded bg-[var(--surface)] px-3 py-1.5 font-semibold shadow-sm">我的策略</span>
            <Link href={"/marketplace" as Route} className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[var(--muted)] hover:text-[var(--foreground)]">
              <Store size={14} />
              策略广场
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
        <div className="flex flex-col justify-between gap-5 border-b border-[var(--line)] pb-7 md:flex-row md:items-end">
          <div>
            <p className="mb-2 text-xs font-bold uppercase text-[var(--accent)]">My Strategies</p>
            <h1 className="text-3xl font-bold">我的策略</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              管理从 Strategy Lab 保存的代码、参数和回测版本，并将验证后的策略发布到策略广场。
            </p>
          </div>
          <Link
            href="/strategy-lab"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-bold text-white hover:bg-[var(--accent-strong)]"
          >
            <Plus size={16} />
            新建策略
          </Link>
        </div>

        <div className="grid border-b border-[var(--line)] sm:grid-cols-3">
          <SummaryCell label="已保存策略" value={strategies.length} icon={<BookOpen size={16} />} />
          <SummaryCell label="已有回测" value={backtestedCount} icon={<BarChart3 size={16} />} />
          <SummaryCell label="已发布" value={strategies.filter((item) => item.visibility === "published").length} icon={<Store size={16} />} />
        </div>

        <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1 rounded-md border border-[var(--line)] bg-[var(--panel)] p-1">
            {(["all", "private", "published"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  filter === value
                    ? "bg-[var(--foreground)] text-[var(--panel)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {value === "all" ? "全部" : value === "private" ? "私有" : "已分享"}
              </button>
            ))}
          </div>
          <label className="flex h-10 w-full items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 sm:w-72">
            <Search size={16} className="text-[var(--muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、标签或标的"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--faint)]"
            />
          </label>
        </div>

        {loading ? (
          <div className="grid min-h-72 place-items-center border-y border-[var(--line)] text-sm text-[var(--muted)]">
            <span className="flex items-center gap-2"><Loader2 size={17} className="animate-spin" />加载策略...</span>
          </div>
        ) : error ? (
          <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">{error}</div>
        ) : filtered.length ? (
          <div className="overflow-hidden rounded-md border border-[var(--line)] bg-[var(--panel)]">
            <div className="hidden grid-cols-[minmax(280px,1.5fr)_140px_repeat(4,110px)_44px] gap-4 border-b border-[var(--line)] bg-[var(--panel-muted-2)] px-5 py-3 text-xs font-semibold text-[var(--muted)] lg:grid">
              <span>策略</span><span>标的 / 周期</span><span>累计收益</span><span>最大回撤</span><span>Sharpe</span><span>更新时间</span><span />
            </div>
            {filtered.map((strategy) => <StrategyRow key={strategy.id} strategy={strategy} />)}
          </div>
        ) : (
          <div className="grid min-h-80 place-items-center rounded-md border border-dashed border-[var(--line-strong)] bg-[var(--panel)] p-8 text-center">
            <div>
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-md bg-[var(--panel-muted)] text-[var(--muted)]"><Code2 size={21} /></div>
              <h2 className="mt-4 text-lg font-bold">{strategies.length ? "没有匹配的策略" : "还没有保存策略"}</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">在 Strategy Lab 完成回测后，点击右上角“保存策略”。</p>
              {!strategies.length && <Link href="/strategy-lab" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]">前往 Strategy Lab <ArrowRight size={15} /></Link>}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function SummaryCell({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-[var(--line)] px-1 py-5 sm:border-r sm:px-5 first:pl-0 last:border-r-0">
      <div><div className="text-sm text-[var(--muted)]">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></div>
      <div className="text-[var(--faint)]">{icon}</div>
    </div>
  );
}

function StrategyRow({ strategy }: { strategy: SavedStrategy }) {
  const metrics = strategy.latestMetrics || {};
  return (
    <Link
      href={`/strategies/${strategy.id}`}
      className="grid gap-4 border-b border-[var(--line)] px-5 py-5 transition last:border-b-0 hover:bg-[var(--panel-muted-2)] lg:grid-cols-[minmax(280px,1.5fr)_140px_repeat(4,110px)_44px] lg:items-center"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-bold">{strategy.name}</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
            {strategy.visibility === "private" ? <Lock size={10} /> : <CheckCircle2 size={10} />}
            {strategy.visibility === "private" ? "私有" : "已分享"}
          </span>
        </div>
        <p className="mt-1 line-clamp-1 text-sm text-[var(--muted)]">{strategy.description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {strategy.tags.map((tag) => <span key={tag} className="rounded bg-[var(--panel-muted)] px-2 py-0.5 text-[10px] text-[var(--muted)]">{tag}</span>)}
          <span className="text-[10px] text-[var(--faint)]">v{strategy.versionCount}</span>
        </div>
      </div>
      <div className="text-sm"><div className="font-semibold">{strategy.symbol}</div><div className="text-xs text-[var(--muted)]">{strategy.timeframe}</div></div>
      <Metric label="累计收益" value={formatPercent(metrics.totalReturn)} positive={(metrics.totalReturn || 0) >= 0} />
      <Metric label="最大回撤" value={formatPercent(metrics.maxDrawdown)} />
      <Metric label="Sharpe" value={formatNumber(metrics.sharpe)} />
      <div className="text-xs text-[var(--muted)]"><Clock3 size={13} className="mb-1" />{formatDate(strategy.updatedAt)}</div>
      <ArrowRight size={17} className="hidden text-[var(--faint)] lg:block" />
    </Link>
  );
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return <div><div className="text-xs text-[var(--muted)] lg:hidden">{label}</div><div className={`text-sm font-bold ${positive === undefined ? "" : positive ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{value}</div></div>;
}

function formatPercent(value?: number) {
  return value === undefined ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatNumber(value?: number) {
  return value === undefined ? "--" : value.toFixed(2);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
