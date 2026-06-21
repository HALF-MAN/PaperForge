"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Check,
  Clock3,
  Code2,
  Edit3,
  Globe2,
  History,
  Loader2,
  Lock,
  MessageSquareText,
  Save,
  Store,
  X,
} from "lucide-react";
import { StrategyCodeEditor } from "@/src/components/StrategyCodeEditor";
import {
  getSavedStrategy,
  updateSavedStrategy,
  type SavedStrategyDetail,
} from "@/src/utils/savedStrategies";

type Tab = "overview" | "code" | "versions";

export default function SavedStrategyDetailPage() {
  const params = useParams<{ strategyId: string }>();
  const strategyId = params.strategyId;
  const [detail, setDetail] = useState<SavedStrategyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareDialog, setShareDialog] = useState<"publish" | "unpublish" | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSavedStrategy(strategyId)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        setName(result.strategy.name);
        setDescription(result.strategy.description);
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
  }, [strategyId]);

  const saveMetadata = async () => {
    if (!detail || !name.trim()) return;
    setSaving(true);
    try {
      const result = await updateSavedStrategy(strategyId, {
        name: name.trim(),
        description: description.trim(),
      });
      setDetail({ ...detail, strategy: result.strategy });
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "策略更新失败");
    } finally {
      setSaving(false);
    }
  };

  const updateVisibility = async () => {
    if (!detail || !shareDialog) return;
    setSharing(true);
    setError(null);
    try {
      const result = await updateSavedStrategy(strategyId, {
        visibility: shareDialog === "publish" ? "published" : "private",
      });
      setDetail({ ...detail, strategy: result.strategy });
      setShareDialog(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发布状态更新失败");
    } finally {
      setSharing(false);
    }
  };

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-[var(--background)] text-sm text-[var(--muted)]"><span className="flex items-center gap-2"><Loader2 size={17} className="animate-spin" />加载策略...</span></div>;
  }
  if (!detail) {
    return <div className="grid min-h-screen place-items-center bg-[var(--background)]"><div className="text-center"><p className="text-sm text-[var(--danger)]">{error || "策略不存在"}</p><Link href="/strategies" className="mt-4 inline-flex text-sm font-bold text-[var(--accent)]">返回我的策略</Link></div></div>;
  }

  const { strategy, currentVersion, versions } = detail;
  const metrics = strategy.latestMetrics || {};

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
          <Link href="/strategies" className="flex items-center gap-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={16} />我的策略</Link>
          <div className="flex items-center gap-2">
            {detail.strategy.visibility === "published" ? (
              <Link href={`/marketplace/${strategyId}` as Route} className="hidden items-center gap-2 rounded-md border border-[var(--line)] px-3 py-2 text-sm font-semibold hover:border-[var(--accent)] hover:text-[var(--accent)] sm:flex"><Store size={15} />查看公开页</Link>
            ) : null}
            <button onClick={() => setShareDialog(detail.strategy.visibility === "published" ? "unpublish" : "publish")} className="flex items-center gap-2 rounded-md border border-[var(--line)] px-3 py-2 text-sm font-semibold hover:border-[var(--accent)] hover:text-[var(--accent)]">
              {detail.strategy.visibility === "published" ? <Lock size={15} /> : <Globe2 size={15} />}
              <span className="hidden sm:inline">{detail.strategy.visibility === "published" ? "取消发布" : "发布到广场"}</span>
            </button>
            <Link href="/strategy-lab" className="flex items-center gap-2 rounded-md border border-[var(--line)] px-3 py-2 text-sm font-semibold hover:border-[var(--accent)] hover:text-[var(--accent)]"><MessageSquareText size={15} />继续研究</Link>
            {editing ? (
              <button onClick={() => void saveMetadata()} disabled={saving || !name.trim()} className="flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}保存</button>
            ) : (
              <button onClick={() => setEditing(true)} className="flex items-center gap-2 rounded-md bg-[var(--foreground)] px-3 py-2 text-sm font-bold text-[var(--panel)]"><Edit3 size={15} />编辑信息</button>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
        {error && <div className="mb-5 rounded-md border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">{error}</div>}
        <div className="flex flex-col justify-between gap-6 border-b border-[var(--line)] pb-7 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-semibold ${strategy.visibility === "published" ? "border-[var(--success)]/25 bg-[var(--success-soft)] text-[var(--success)]" : "border-[var(--line)] text-[var(--muted)]"}`}>
                {strategy.visibility === "published" ? <Globe2 size={11} /> : <Lock size={11} />}
                {strategy.visibility === "published" ? "已发布" : "私有策略"}
              </span>
              <span className="rounded border border-[var(--line)] px-2 py-1 text-xs text-[var(--muted)]">v{strategy.versionCount}</span>
              <span className="rounded border border-[var(--line)] px-2 py-1 text-xs text-[var(--muted)]">{strategy.symbol} · {strategy.timeframe}</span>
            </div>
            {editing ? (
              <div className="max-w-2xl space-y-3">
                <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-2xl font-bold outline-none focus:border-[var(--accent)]" />
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="w-full resize-none rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]" />
              </div>
            ) : (
              <><h1 className="truncate text-3xl font-bold">{strategy.name}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">{strategy.description}</p></>
            )}
            <div className="mt-4 flex flex-wrap gap-2">{strategy.tags.map((tag) => <span key={tag} className="rounded bg-[var(--panel-muted)] px-2 py-1 text-xs text-[var(--muted)]">{tag}</span>)}</div>
          </div>
          <div className="text-xs text-[var(--muted)]"><Clock3 size={14} className="mb-1" />最后更新<br /><span className="font-semibold text-[var(--foreground)]">{formatDate(strategy.updatedAt)}</span></div>
        </div>

        <div className="flex gap-6 border-b border-[var(--line)]">
          {(["overview", "code", "versions"] as const).map((value) => (
            <button key={value} onClick={() => setTab(value)} className={`border-b-2 px-1 py-4 text-sm font-semibold ${tab === value ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)]"}`}>
              {value === "overview" ? "策略概览" : value === "code" ? "策略代码" : `版本记录 (${versions.length})`}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="py-7">
            <div className="grid overflow-hidden rounded-md border border-[var(--line)] bg-[var(--panel)] sm:grid-cols-5">
              <Metric label="累计收益" value={formatPercent(metrics.totalReturn)} tone={(metrics.totalReturn || 0) >= 0 ? "success" : "danger"} />
              <Metric label="年化收益" value={formatPercent(metrics.annualReturn)} />
              <Metric label="Sharpe" value={formatNumber(metrics.sharpe)} />
              <Metric label="最大回撤" value={formatPercent(metrics.maxDrawdown)} />
              <Metric label="胜率" value={formatPercent(metrics.winRate)} />
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
              <section className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5">
                <div className="mb-4 flex items-center gap-2 font-bold"><BarChart3 size={17} className="text-[var(--accent)]" />当前版本</div>
                <div className="grid gap-4 text-sm sm:grid-cols-2">
                  <Info label="版本" value={`v${currentVersion?.version || 1}`} />
                  <Info label="来源" value={currentVersion?.sourceArtifactType === "backtest_run" ? "回测快照" : "代码快照"} />
                  <Info label="参数数量" value={String(Object.keys(currentVersion?.params || {}).length)} />
                  <Info label="交易次数" value={String(metrics.tradeCount ?? "--")} />
                </div>
              </section>
              <section className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5">
                <div className="mb-4 flex items-center gap-2 font-bold"><Check size={17} className="text-[var(--success)]" />保存状态</div>
                <p className="text-sm leading-6 text-[var(--muted)]">代码、参数与本次回测结果已经固化为版本快照。继续回测后再次保存，会在此策略下创建新版本。</p>
              </section>
            </div>
          </div>
        )}

        {tab === "code" && (
          <div className="grid gap-6 py-7 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section><div className="mb-3 flex items-center gap-2 font-bold"><Code2 size={17} />Python 策略代码</div><StrategyCodeEditor value={currentVersion?.code || ""} onChange={() => undefined} readOnly /></section>
            <section className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-5"><h2 className="font-bold">策略参数</h2><div className="mt-4 space-y-3">{Object.entries(currentVersion?.params || {}).map(([key, value]) => <div key={key} className="flex items-center justify-between border-b border-[var(--line)] pb-3 text-sm last:border-0"><span className="font-mono text-xs text-[var(--muted)]">{key}</span><span className="font-semibold">{String(value)}</span></div>)}{!Object.keys(currentVersion?.params || {}).length && <p className="text-sm text-[var(--muted)]">当前版本没有可编辑参数。</p>}</div></section>
          </div>
        )}

        {tab === "versions" && (
          <div className="py-7">
            <div className="overflow-hidden rounded-md border border-[var(--line)] bg-[var(--panel)]">
              {versions.map((version) => (
                <div key={version.id} className="grid gap-3 border-b border-[var(--line)] px-5 py-4 last:border-0 sm:grid-cols-[80px_1fr_150px_120px] sm:items-center">
                  <span className="inline-flex w-fit items-center gap-1 rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-bold text-[var(--accent)]"><History size={12} />v{version.version}</span>
                  <div><div className="font-semibold">{version.title}</div><div className="mt-1 text-xs text-[var(--muted)]">{version.sourceArtifactType === "backtest_run" ? "包含回测结果" : "代码版本"}</div></div>
                  <div className="text-sm font-semibold">{formatPercent(version.metrics?.totalReturn)}</div>
                  <div className="text-xs text-[var(--muted)]">{formatDate(version.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {shareDialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-5 backdrop-blur-[2px]">
          <section className="w-full max-w-md rounded-md border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
            <div className="flex items-start justify-between gap-4">
              <div className="grid size-10 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">{shareDialog === "publish" ? <Globe2 size={19} /> : <Lock size={19} />}</div>
              <button onClick={() => setShareDialog(null)} className="grid size-8 place-items-center text-[var(--muted)] hover:text-[var(--foreground)]" aria-label="关闭"><X size={17} /></button>
            </div>
            <h2 id="share-dialog-title" className="mt-5 text-xl font-bold">{shareDialog === "publish" ? "发布到策略广场？" : "取消公开发布？"}</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              {shareDialog === "publish"
                ? "其他用户将看到策略说明、参数和回测绩效，但不会直接看到 Python 源码。他们可以复制一份独立版本到自己的工作区。"
                : "公开详情将立即从策略广场移除，已经被复制的独立策略不会受到影响。"}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setShareDialog(null)} disabled={sharing} className="h-10 rounded-md border border-[var(--line)] px-4 text-sm font-semibold">取消</button>
              <button onClick={() => void updateVisibility()} disabled={sharing} className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-bold text-white disabled:opacity-60">
                {sharing ? <Loader2 size={15} className="animate-spin" /> : shareDialog === "publish" ? <Globe2 size={15} /> : <Lock size={15} />}
                {shareDialog === "publish" ? "确认发布" : "确认取消发布"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return <div className="border-b border-[var(--line)] p-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><div className="text-xs text-[var(--muted)]">{label}</div><div className={`mt-2 text-xl font-bold ${tone === "success" ? "text-[var(--success)]" : tone === "danger" ? "text-[var(--danger)]" : ""}`}>{value}</div></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-[var(--muted)]">{label}</div><div className="mt-1 font-semibold">{value}</div></div>;
}

function formatPercent(value?: number) { return value === undefined ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`; }
function formatNumber(value?: number) { return value === undefined ? "--" : value.toFixed(2); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date); }
