"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BookOpen,
  BrainCircuit,
  Database,
  FileText,
  FlaskConical,
  GitBranch,
  Layers3,
  ListChecks,
  Play,
  Radio,
  SearchCheck,
  ShieldAlert,
  TerminalSquare,
  UserCheck
} from "lucide-react";
import type { AgentTranscriptEntry } from "@/src/agents/transcript";
import type { AgentEvent, ApprovalDecision, BacktestReport } from "@/src/domain/schema";
import { strategyTemplates, type StrategyTemplate } from "@/src/domain/templates";
import type { ExchangeStatus, Ticker } from "@/src/exchange/types";
import {
  runCustomPipeline,
  runTemplatePipeline,
  type PipelineResult,
  type PipelineStepStatus
} from "@/src/pipeline/runner";
import { compileCustomStrategy } from "@/src/strategy/custom-compiler";

type MissionAgent = {
  id: string;
  name: string;
  role: string;
  status: PipelineStepStatus;
  group: "Lead" | "Specialists" | "Review" | "Ops";
  action: string;
  tool: string;
  artifact: string;
  evidence: string;
  transcript?: AgentTranscriptEntry;
};

type MissionArtifact = {
  id: string;
  title: string;
  type: string;
  status: "pending" | "created" | "validated" | "warning" | "failed" | "promoted";
  summary: string;
};

type TraceEvent = {
  id: string;
  agent: string;
  type: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
};

const workstationClass: Record<PipelineStepStatus, string> = {
  pass: "border-[var(--success)]/70 bg-[var(--success-soft)] shadow-[0_0_0_1px_rgba(16,185,129,0.05)]",
  warn: "border-[var(--warning)]/80 bg-[var(--warning-soft)] shadow-[0_0_0_1px_rgba(245,184,75,0.06)]",
  active: "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_0_24px_rgba(59,130,246,0.12)]",
  pending: "border-[var(--line)] bg-[var(--panel-soft)]",
  locked: "border-[var(--line)] bg-[var(--panel-soft)] opacity-70",
  block: "border-[var(--danger)]/80 bg-[var(--danger-soft)]"
};

const statusDotClass: Record<PipelineStepStatus, string> = {
  pass: "bg-[var(--success)]",
  warn: "bg-[var(--warning)]",
  active: "bg-[var(--accent)] shadow-[0_0_18px_rgba(59,130,246,0.8)]",
  pending: "bg-[var(--faint)]",
  locked: "bg-[var(--faint)]",
  block: "bg-[var(--danger)]"
};

const artifactStatusClass: Record<MissionArtifact["status"], string> = {
  pending: "border-[var(--line)] text-[var(--muted)]",
  created: "border-[var(--info)]/60 text-[var(--info)]",
  validated: "border-[var(--success)]/70 text-[var(--success)]",
  warning: "border-[var(--warning)]/80 text-[var(--warning)]",
  failed: "border-[var(--danger)]/80 text-[var(--danger)]",
  promoted: "border-[var(--accent)]/80 text-[var(--accent)]"
};

export function PaperForgeConsole() {
  const [selectedTemplateId, setSelectedTemplateId] = useState(strategyTemplates[0].id);
  const [customPrompt, setCustomPrompt] = useState(
    "BTC 1h EMA20 上穿 EMA60 开多，止损 3%，仓位 20%，最多 2 倍杠杆"
  );
  const [customResult, setCustomResult] = useState<PipelineResult | null>(null);
  const [paperStarted, setPaperStarted] = useState(false);
  const [approval, setApproval] = useState<ApprovalDecision | undefined>();
  const [exchangeStatus, setExchangeStatus] = useState<ExchangeStatus | null>(null);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [realBacktest, setRealBacktest] = useState<BacktestReport | null>(null);
  const [backtestSource, setBacktestSource] = useState<"deterministic" | "bitget_public">("deterministic");
  const [isBacktestLoading, setIsBacktestLoading] = useState(false);
  const [agentTranscript, setAgentTranscript] = useState<AgentTranscriptEntry[]>([]);
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [agentProvider, setAgentProvider] = useState("not requested");
  const [agentWarning, setAgentWarning] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("risk");

  const activeTemplate = useMemo(
    () => strategyTemplates.find((template) => template.id === selectedTemplateId) ?? strategyTemplates[0],
    [selectedTemplateId]
  );

  const templateResult = useMemo(
    () =>
      runTemplatePipeline(activeTemplate, {
        withPaper: paperStarted,
        approval,
        backtestOverride: realBacktest ?? undefined,
        dataSource: backtestSource
      }),
    [activeTemplate, approval, backtestSource, paperStarted, realBacktest]
  );

  const result = customResult ?? templateResult;
  const activeStrategyName = customResult ? result.spec.name : activeTemplate.name;
  const nextGate =
    result.risk.decision === "BLOCK"
      ? "Revise strategy"
      : result.live
        ? "Live dry-run monitoring"
        : result.paper
          ? "Human approval"
          : "Paper trading required";
  const agents = buildMissionAgents(result, backtestSource, agentTranscript);
  const artifacts = buildArtifacts(result, backtestSource, agentTranscript.length > 0);
  const traceEvents = buildTraceEvents(result.events, result, backtestSource, agentTranscript.length > 0);
  const activeAgent =
    agents.find((agent) => agent.id === selectedAgentId) ??
    agents.find((agent) => agent.status === "active") ??
    agents.find((agent) => agent.id === "risk") ??
    agents[0];

  useEffect(() => {
    let cancelled = false;

    async function loadExchangeState() {
      const [statusResponse, tickerResponse] = await Promise.all([
        fetch("/api/exchange/status"),
        fetch(`/api/exchange/ticker?symbol=${result.spec.symbol}`)
      ]);

      if (cancelled) {
        return;
      }

      setExchangeStatus((await statusResponse.json()) as ExchangeStatus);
      setTicker((await tickerResponse.json()) as Ticker);
    }

    loadExchangeState().catch(() => {
      if (!cancelled) {
        setExchangeStatus({
          exchange: "Bitget",
          dataSource: "mock",
          authConfigured: false,
          mode: "paper",
          tradingEnabled: false,
          publicMarketData: false,
          message: "Exchange status unavailable. Falling back to local demo state."
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [result.spec.symbol]);

  function resetGeneratedState() {
    setPaperStarted(false);
    setApproval(undefined);
    setRealBacktest(null);
    setBacktestSource("deterministic");
    setAgentTranscript([]);
    setAgentProvider("not requested");
    setAgentWarning(null);
    setSelectedAgentId("risk");
  }

  function handleSelectTemplate(templateId: string) {
    setCustomResult(null);
    resetGeneratedState();
    setSelectedTemplateId(templateId);
  }

  function handleCompileCustom() {
    resetGeneratedState();
    setCustomResult(runCustomPipeline(compileCustomStrategy(customPrompt)));
  }

  function handleStartPaper() {
    setPaperStarted(true);
    setApproval(undefined);
    setAgentTranscript([]);
    setAgentProvider("not requested");
    setAgentWarning(null);
    setSelectedAgentId("demo");
    if (customResult) {
      setCustomResult(
        runCustomPipeline(compileCustomStrategy(customPrompt), {
          withPaper: true,
          backtestOverride: realBacktest ?? undefined,
          dataSource: backtestSource
        })
      );
    }
  }

  function handleApproval(decision: ApprovalDecision) {
    setApproval(decision);
    setAgentTranscript([]);
    setAgentProvider("not requested");
    setAgentWarning(null);
    setSelectedAgentId("approval");
    if (customResult) {
      setCustomResult(
        runCustomPipeline(compileCustomStrategy(customPrompt), {
          withPaper: true,
          approval: decision,
          backtestOverride: realBacktest ?? undefined,
          dataSource: backtestSource
        })
      );
    }
  }

  async function handleRealBacktest() {
    setIsBacktestLoading(true);
    try {
      const response = await fetch("/api/backtest", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          spec: result.spec,
          source: "bitget_public"
        })
      });

      if (!response.ok) {
        throw new Error("Backtest request failed");
      }

      const payload = (await response.json()) as { report: BacktestReport };
      setRealBacktest(payload.report);
      setBacktestSource("bitget_public");
      setPaperStarted(false);
      setApproval(undefined);
      setAgentTranscript([]);
      setAgentProvider("not requested");
      setAgentWarning(null);
      setSelectedAgentId("backtest");

      if (customResult) {
        setCustomResult(
          runCustomPipeline(compileCustomStrategy(customPrompt), {
            backtestOverride: payload.report,
            dataSource: "bitget_public"
          })
        );
      }
    } finally {
      setIsBacktestLoading(false);
    }
  }

  async function handleAskAgents() {
    setIsAgentThinking(true);
    try {
      const response = await fetch("/api/agents/transcript", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          source: backtestSource,
          spec: result.spec,
          backtest: result.backtest,
          risk: result.risk,
          paper: result.paper,
          live: result.live
        })
      });

      if (!response.ok) {
        throw new Error("Agent transcript request failed");
      }

      const payload = (await response.json()) as {
        provider: string;
        model: string;
        warning?: string;
        entries: AgentTranscriptEntry[];
      };

      setAgentTranscript(payload.entries);
      setAgentProvider(`${payload.provider}/${payload.model}`);
      setAgentWarning(payload.warning ?? null);
      setSelectedAgentId("evaluator");
    } finally {
      setIsAgentThinking(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(59,130,246,0.08),transparent_42%)]" />
      <div className="relative px-4 py-4 lg:px-5">
        <MissionHeader
          activeStrategyName={activeStrategyName}
          agentProvider={agentProvider}
          approval={result.approval}
          exchangeStatus={exchangeStatus}
          nextGate={nextGate}
          result={result}
          ticker={ticker}
        />

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 space-y-4">
            <FocusRoom
              activeAgent={activeAgent}
              agents={agents}
              onSelectAgent={setSelectedAgentId}
              result={result}
            />
            <details className="rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] p-4">
              <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                Mission Details
              </summary>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <ArtifactDock artifacts={artifacts} />
                <TraceStream events={traceEvents} />
              </div>
            </details>
          </section>

          <MissionControlPanel
            activeTemplate={activeTemplate}
            agentProvider={agentProvider}
            agentWarning={agentWarning}
            approval={result.approval}
            backtestSource={backtestSource}
            customPrompt={customPrompt}
            customResult={customResult}
            isAgentThinking={isAgentThinking}
            isBacktestLoading={isBacktestLoading}
            onApproval={handleApproval}
            onAskAgents={handleAskAgents}
            onCompileCustom={handleCompileCustom}
            onPromptChange={setCustomPrompt}
            onRealBacktest={handleRealBacktest}
            onSelectTemplate={handleSelectTemplate}
            onStartPaper={handleStartPaper}
            result={result}
            selectedTemplateId={selectedTemplateId}
          />
        </section>
      </div>
    </main>
  );
}

function MissionHeader({
  activeStrategyName,
  agentProvider,
  approval,
  exchangeStatus,
  nextGate,
  result,
  ticker
}: {
  activeStrategyName: string;
  agentProvider: string;
  approval?: ApprovalDecision;
  exchangeStatus: ExchangeStatus | null;
  nextGate: string;
  result: PipelineResult;
  ticker: Ticker | null;
}) {
  return (
    <header className="mb-4 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-2xl backdrop-blur">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            <GitBranch size={15} aria-hidden />
            PaperForge Mission Room
          </div>
          <h1 className="text-xl font-semibold tracking-normal text-[var(--foreground)] md:text-2xl">
            Evaluate BTC EMA strategy for paper deployment
          </h1>
          <div className="mt-2 text-sm text-[var(--muted)]">
            Current handoff: <span className="text-[var(--foreground)]">{nextGate}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Pill label="Run" value={result.run.id} tone="neutral" />
          <Pill label="Strategy" value={activeStrategyName} tone="neutral" />
          <Pill label="Risk" value={result.risk.decision} tone={riskTone(result.risk.decision)} />
          <Pill label="Approval" value={approval ?? "waiting"} tone={approval === "approved" ? "success" : "accent"} />
          <Pill label="Model" value={agentProvider === "not requested" ? "standby" : agentProvider} tone="accent" />
          <Pill label="Exchange" value={exchangeStatus?.exchange ?? "Bitget"} tone="neutral" />
          <Pill
            label="Auth"
            value={exchangeStatus?.authConfigured ? "configured" : "not set"}
            tone={exchangeStatus?.authConfigured ? "success" : "neutral"}
          />
          <Pill label="Trading" value="disabled" tone="neutral" />
          {ticker ? <Pill label={ticker.symbol} value={`$${ticker.last.toLocaleString()}`} tone="success" /> : null}
        </div>
      </div>
    </header>
  );
}

function FocusRoom({
  activeAgent,
  agents,
  onSelectAgent,
  result
}: {
  activeAgent?: MissionAgent;
  agents: MissionAgent[];
  onSelectAgent: (id: string) => void;
  result: PipelineResult;
}) {
  const corePath = ["strategy", "backtest", "risk", "demo", "evaluator", "approval"];
  const pathAgents = corePath
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is MissionAgent => Boolean(agent));
  const focusAgent = activeAgent ?? pathAgents.find((agent) => agent.status === "active") ?? pathAgents[0];

  return (
    <Panel title="Mission Focus">
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] p-5">
          <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--faint)]">Current Agent</div>
              <div className="mt-2 flex items-center gap-3">
                <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-muted)] p-3 text-[var(--accent)]">
                  {renderAgentIcon(focusAgent.name)}
                </div>
                <div>
                  <div className="text-2xl font-semibold text-[var(--foreground)]">{focusAgent.name}</div>
                  <div className="mt-1 text-sm text-[var(--muted)]">{focusAgent.role}</div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-muted)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              <span className={`h-2 w-2 rounded-full ${statusDotClass[focusAgent.status]}`} />
              {focusAgent.status}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <FocusFact label="Action" value={focusAgent.action} />
            <FocusFact label="Tool" value={focusAgent.tool} />
            <FocusFact label="Output" value={focusAgent.artifact} />
          </div>

          <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm leading-6 text-[var(--muted)]">
            {focusAgent.transcript?.reasoning ?? focusAgent.evidence}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--faint)]">Mission Brief</div>
          <div className="mt-3 text-sm leading-6 text-[var(--foreground)]">
            Validate <span className="text-[var(--accent)]">{result.spec.symbol}</span> {result.spec.timeframe}{" "}
            {result.spec.name} before paper deployment.
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <SummaryItem label="Risk" value={`${result.risk.decision} ${result.risk.riskScore}/100`} />
            <SummaryItem label="Trades" value={String(result.backtest.tradeCount)} />
            <SummaryItem label="Return" value={`${result.backtest.totalReturnPct}%`} />
            <SummaryItem label="Paper" value={result.paper ? result.paper.status : "waiting"} />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] p-3">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--faint)]">Team Path</div>
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {pathAgents.map((agent) => (
            <button
              className={`rounded-md border px-3 py-2 text-left transition hover:border-[var(--accent)] ${workstationClass[agent.status]}`}
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              type="button"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-[var(--foreground)]">{agent.name}</span>
                <span className={`h-2 w-2 rounded-full ${statusDotClass[agent.status]}`} />
              </div>
              <div className="mt-1 truncate text-[11px] text-[var(--muted)]">{agent.artifact}</div>
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function FocusFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--panel-soft)] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)]">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-[var(--foreground)]">{value}</div>
    </div>
  );
}

function MissionControlPanel({
  activeTemplate,
  agentProvider,
  agentWarning,
  approval,
  backtestSource,
  customPrompt,
  customResult,
  isAgentThinking,
  isBacktestLoading,
  onApproval,
  onAskAgents,
  onCompileCustom,
  onPromptChange,
  onRealBacktest,
  onSelectTemplate,
  onStartPaper,
  result,
  selectedTemplateId
}: {
  activeTemplate: StrategyTemplate;
  agentProvider: string;
  agentWarning: string | null;
  approval?: ApprovalDecision;
  backtestSource: string;
  customPrompt: string;
  customResult: PipelineResult | null;
  isAgentThinking: boolean;
  isBacktestLoading: boolean;
  onApproval: (decision: ApprovalDecision) => void;
  onAskAgents: () => void;
  onCompileCustom: () => void;
  onPromptChange: (value: string) => void;
  onRealBacktest: () => void;
  onSelectTemplate: (templateId: string) => void;
  onStartPaper: () => void;
  result: PipelineResult;
  selectedTemplateId: string;
}) {
  return (
    <aside className="space-y-4">
      <Panel title="Mission Controls">
        <div className="grid gap-2">
          <button
            className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-60"
            disabled={isAgentThinking}
            onClick={onAskAgents}
            type="button"
          >
            <BrainCircuit size={15} aria-hidden />
            {isAgentThinking ? "Agents thinking..." : "Ask AI Agents"}
          </button>
          <button
            className="rounded-md border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2 text-sm font-semibold text-[var(--foreground)] disabled:opacity-60"
            disabled={isBacktestLoading}
            onClick={onRealBacktest}
            type="button"
          >
            {isBacktestLoading ? "Reading candles..." : "Use Bitget Candles"}
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
            disabled={result.risk.decision === "BLOCK"}
            onClick={onStartPaper}
            type="button"
          >
            <Play size={15} aria-hidden />
            Start Paper
          </button>
        </div>
        <div className="mt-3 rounded-md border border-[var(--line)] bg-[var(--panel-soft)] p-3 text-xs leading-5 text-[var(--muted)]">
          Model: {agentProvider}
          {agentWarning ? <div className="mt-2 text-[var(--warning)]">LLM fallback: {agentWarning}</div> : null}
        </div>
      </Panel>

      <Panel title="Approval">
        <div className="grid grid-cols-2 gap-2">
          <SummaryItem label="Risk" value={`${result.risk.decision} ${result.risk.riskScore}/100`} />
          <SummaryItem label="Paper" value={result.paper ? result.paper.status : "waiting"} />
          <SummaryItem label="Approval" value={approval ?? "waiting"} />
          <SummaryItem label="Data" value={backtestSource} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-md bg-[var(--success)] px-3 py-2 text-xs font-semibold text-black disabled:opacity-50"
            disabled={!result.paper}
            onClick={() => onApproval("approved")}
            type="button"
          >
            Approve
          </button>
          <button
            className="rounded-md border border-[var(--warning)] bg-[var(--warning-soft)] px-3 py-2 text-xs font-semibold text-[var(--warning)] disabled:opacity-50"
            disabled={!result.paper}
            onClick={() => onApproval("changes_requested")}
            type="button"
          >
            Request Changes
          </button>
          <button
            className="rounded-md border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--danger)] disabled:opacity-50"
            disabled={!result.paper}
            onClick={() => onApproval("rejected")}
            type="button"
          >
            Reject
          </button>
        </div>
      </Panel>

      <details className="rounded-lg border border-[var(--line)] bg-[var(--panel-soft)] p-4">
        <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          Strategy Source
        </summary>
        <div className="mt-4 space-y-3">
          {strategyTemplates.map((template) => (
            <StrategyTemplateButton
              key={template.id}
              selected={!customResult && template.id === selectedTemplateId}
              template={template}
              onSelect={() => onSelectTemplate(template.id)}
            />
          ))}
        </div>
        <textarea
          className="mt-3 min-h-24 w-full resize-none rounded-md border border-[var(--line)] bg-[var(--panel-soft)] p-3 text-sm leading-5 text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
          onChange={(event) => onPromptChange(event.target.value)}
          value={customPrompt}
        />
        <button
          className="mt-3 w-full rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-black"
          onClick={onCompileCustom}
          type="button"
        >
          Ask Strategy Agent
        </button>
        <div className="mt-2 text-xs text-[var(--muted)]">Active template: {activeTemplate.name}</div>
      </details>
    </aside>
  );
}

function ArtifactDock({ artifacts }: { artifacts: MissionArtifact[] }) {
  return (
    <Panel title="Artifact Dock">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {artifacts.map((artifact) => (
          <div
            className={`min-w-[150px] rounded-md border bg-[var(--panel-soft)] p-3 text-left ${artifactStatusClass[artifact.status]}`}
            key={artifact.id}
          >
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
              <FileText size={14} aria-hidden />
              {artifact.status}
            </div>
            <div className="text-sm font-semibold text-[var(--foreground)]">{artifact.title}</div>
            <div className="mt-1 line-clamp-2 text-xs leading-4 text-[var(--muted)]">{artifact.summary}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function TraceStream({ events }: { events: TraceEvent[] }) {
  return (
    <Panel title="Live Trace Stream">
      <div className="max-h-52 space-y-2 overflow-auto pr-1">
        {events.map((event) => (
          <div
            className="grid w-full grid-cols-[76px_150px_minmax(0,1fr)] gap-3 rounded-md border border-[var(--line)] bg-[var(--panel-soft)] px-3 py-2 text-left text-xs"
            key={event.id}
          >
            <span className={traceSeverityClass(event.severity)}>{event.type}</span>
            <span className="truncate font-semibold text-[var(--foreground)]">{event.agent}</span>
            <span className="truncate text-[var(--muted)]">{event.message}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StrategyTemplateButton({
  selected,
  template,
  onSelect
}: {
  selected: boolean;
  template: StrategyTemplate;
  onSelect: () => void;
}) {
  return (
    <button
      className={`w-full rounded-md border p-3 text-left transition ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-[var(--line)] bg-[var(--panel-soft)] hover:border-[var(--accent)]"
      }`}
      onClick={onSelect}
      type="button"
    >
      <div className="text-sm font-semibold text-[var(--foreground)]">{template.name}</div>
      <div className="mt-1 text-xs leading-5 text-[var(--muted)]">{template.summary}</div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="rounded-md bg-[var(--panel-muted)] px-2 py-1 text-[var(--muted)]">{template.spec.symbol}</span>
        <span className="rounded-md bg-[var(--panel-muted)] px-2 py-1 text-[var(--muted)]">{template.spec.timeframe}</span>
        <span className="rounded-md bg-[var(--panel-muted)] px-2 py-1 text-[var(--muted)]">{template.riskProfile}</span>
      </div>
    </button>
  );
}

function Panel({
  action,
  children,
  title
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 shadow-xl backdrop-blur">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--panel-soft)] p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--faint)]">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-[var(--foreground)]">{value}</div>
    </div>
  );
}

function Pill({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warn" | "pass" | "block" | "accent";
}) {
  const toneClass = {
    neutral: "border-[var(--line)] bg-[var(--panel-muted)] text-[var(--muted)]",
    success: "border-[var(--success)]/60 bg-[var(--success-soft)] text-[var(--success)]",
    pass: "border-[var(--success)]/60 bg-[var(--success-soft)] text-[var(--success)]",
    warn: "border-[var(--warning)]/70 bg-[var(--warning-soft)] text-[var(--warning)]",
    block: "border-[var(--danger)]/70 bg-[var(--danger-soft)] text-[var(--danger)]",
    accent: "border-[var(--accent)]/70 bg-[var(--accent-soft)] text-[var(--accent)]"
  }[tone];

  return (
    <span className={`rounded-md border px-2.5 py-1 ${toneClass}`}>
      <span className="font-medium">{label}:</span> {value}
    </span>
  );
}

function buildMissionAgents(
  result: PipelineResult,
  source: "deterministic" | "bitget_public",
  transcript: AgentTranscriptEntry[]
): MissionAgent[] {
  const byName = new Map(result.steps.map((step) => [step.name, step.status]));
  const transcriptByAgent = new Map(transcript.map((entry) => [entry.agent, entry]));

  return [
    {
      id: "intake",
      name: "Task Intake",
      role: "Mission brief",
      status: "pass",
      group: "Lead",
      action: "Captured task constraints",
      tool: "task_brief",
      artifact: "TaskBrief",
      evidence: "Goal, constraints, and success criteria are ready."
    },
    {
      id: "staffing",
      name: "Staffing Agent",
      role: "Team assembly",
      status: "pass",
      group: "Lead",
      action: "Selected quant team",
      tool: "match_skills",
      artifact: "TeamProposal",
      evidence: "Strategy, backtest, risk, evaluator, and approval roles assigned."
    },
    {
      id: "strategy",
      name: "Strategy Agent",
      role: "Spec compiler",
      status: byName.get("Strategy") ?? "pending",
      group: "Specialists",
      action: "Compiled StrategySpec",
      tool: "compile_strategy_spec",
      artifact: "StrategySpec",
      evidence: `${result.spec.symbol} ${result.spec.timeframe}, source ${result.spec.source}`,
      transcript: transcriptByAgent.get("Strategy Agent")
    },
    {
      id: "backtest",
      name: "Backtest Agent",
      role: "Historical simulator",
      status: byName.get("Backtest") ?? "pending",
      group: "Specialists",
      action: source === "bitget_public" ? "Tested Bitget candles" : "Tested fixture data",
      tool: "run_backtest",
      artifact: "BacktestReport",
      evidence: `${result.backtest.totalReturnPct}% return, ${result.backtest.tradeCount} trades`,
      transcript: transcriptByAgent.get("Backtest Agent")
    },
    {
      id: "risk",
      name: "Risk Agent",
      role: "Deployment gatekeeper",
      status: byName.get("Risk") ?? "pending",
      group: "Specialists",
      action: `Decision ${result.risk.decision}`,
      tool: "score_risk",
      artifact: "RiskReport",
      evidence: result.risk.issues[0] ?? "No blocking issue detected.",
      transcript: transcriptByAgent.get("Risk Agent")
    },
    {
      id: "demo",
      name: "Demo Agent",
      role: "Paper operator",
      status: byName.get("Demo") ?? "pending",
      group: "Specialists",
      action: result.paper ? "Recorded paper orders" : "Waiting for paper start",
      tool: "start_paper_session",
      artifact: result.paper ? "PaperSession" : "pending",
      evidence: result.paper ? `${result.paper.pnlPct}% paper PnL, ${result.paper.orderCount} orders` : "No real order execution.",
      transcript: transcriptByAgent.get("Demo Agent")
    },
    {
      id: "evaluator",
      name: "Evaluator",
      role: "Evidence checker",
      status: result.risk.decision === "BLOCK" ? "block" : result.risk.decision === "WARN" ? "warn" : "pass",
      group: "Review",
      action: "Checked claims",
      tool: "detect_unsupported_claims",
      artifact: "EvaluatorReport",
      evidence: "Claims must match StrategySpec and tool outputs.",
      transcript: transcriptByAgent.get("Review Agent")
    },
    {
      id: "approval",
      name: "Human Reviewer",
      role: "Approval gate",
      status: byName.get("Approval") ?? "pending",
      group: "Review",
      action: result.approval ? `Decision ${result.approval}` : "Awaiting decision",
      tool: "request_human_approval",
      artifact: "ApprovalRequest",
      evidence: "Approve, request changes, or reject before live dry-run."
    },
    {
      id: "live",
      name: "Live Agent",
      role: "Dry-run monitor",
      status: byName.get("Live Dry-Run") ?? "locked",
      group: "Ops",
      action: result.live ? "Monitoring live data" : "Locked",
      tool: "prepare_live_dry_run",
      artifact: result.live ? "LiveDryRun" : "locked",
      evidence: result.live ? "Real order execution disabled." : "Live path locked."
    },
    {
      id: "memory",
      name: "Memory Agent",
      role: "Lesson writer",
      status: result.approval ? "pass" : "pending",
      group: "Ops",
      action: result.approval ? "Prepared memory note" : "Waiting for outcome",
      tool: "write_memory_summary",
      artifact: result.approval ? "MemoryNote" : "pending",
      evidence: "Reusable lessons are written after approval or rejection."
    }
  ];
}

function buildArtifacts(
  result: PipelineResult,
  source: "deterministic" | "bitget_public",
  hasTranscript: boolean
): MissionArtifact[] {
  return [
    {
      id: "task-brief",
      title: "TaskBrief",
      type: "task_brief",
      status: "validated",
      summary: "Evaluate BTC EMA strategy with no real execution."
    },
    {
      id: "team-proposal",
      title: "TeamProposal",
      type: "team_proposal",
      status: "validated",
      summary: "Strategy, backtest, risk, evaluator, approval, and memory roles selected."
    },
    {
      id: "strategy-spec",
      title: "StrategySpec",
      type: "strategy_spec",
      status: "validated",
      summary: `${result.spec.name} on ${result.spec.symbol} ${result.spec.timeframe}.`
    },
    {
      id: "backtest-report",
      title: "BacktestReport",
      type: "backtest_report",
      status: source === "bitget_public" ? "validated" : "created",
      summary: `${result.backtest.totalReturnPct}% return, ${result.backtest.maxDrawdownPct}% MDD.`
    },
    {
      id: "risk-report",
      title: "RiskReport",
      type: "risk_report",
      status: result.risk.decision === "PASS" ? "validated" : result.risk.decision === "WARN" ? "warning" : "failed",
      summary: `${result.risk.decision} with risk score ${result.risk.riskScore}/100.`
    },
    {
      id: "evaluator-report",
      title: "EvaluatorReport",
      type: "evaluator_report",
      status: hasTranscript ? "validated" : "created",
      summary: hasTranscript ? "LLM transcript generated and ready for evidence checks." : "Deterministic evidence checks ready."
    },
    {
      id: "approval-request",
      title: "ApprovalRequest",
      type: "approval_request",
      status: result.approval === "approved" ? "validated" : result.approval ? "warning" : result.paper ? "created" : "pending",
      summary: result.paper ? "Human decision required before live dry-run." : "Waiting for paper session evidence."
    },
    {
      id: "paper-session",
      title: "PaperSession",
      type: "paper_session",
      status: result.paper ? "created" : "pending",
      summary: result.paper ? `${result.paper.orderCount} paper orders, ${result.paper.pnlPct}% PnL.` : "Paper session not started."
    },
    {
      id: "memory-note",
      title: "MemoryNote",
      type: "memory_note",
      status: result.approval ? "promoted" : "pending",
      summary: result.approval ? "Reusable lesson prepared for workspace memory." : "Written after approval decision."
    }
  ];
}

function buildTraceEvents(
  events: AgentEvent[],
  result: PipelineResult,
  source: "deterministic" | "bitget_public",
  hasTranscript: boolean
): TraceEvent[] {
  const base: TraceEvent[] = [
    {
      id: "task-created",
      agent: "Task Intake",
      type: "task_created",
      message: "Mission brief created for BTC EMA paper deployment.",
      severity: "info"
    },
    {
      id: "team-selected",
      agent: "Staffing Agent",
      type: "team_selected",
      message: "Selected strategy, backtest, risk, evaluator, approval, and memory roles.",
      severity: "success"
    },
    {
      id: "plan-created",
      agent: "Planner Agent",
      type: "plan_created",
      message: "Plan created: spec, backtest, risk, evaluate, approve, remember.",
      severity: "success"
    }
  ];

  const mapped = events.map((event): TraceEvent => ({
    id: event.id,
    agent: event.agent,
    type: event.type,
    message: event.message,
    severity: event.type === "risk" && result.risk.decision !== "PASS" ? "warning" : event.type === "error" ? "error" : "info"
  }));

  const tail: TraceEvent[] = [
    {
      id: "data-source",
      agent: "Backtest Agent",
      type: "tool_called",
      message: source === "bitget_public" ? "Used Bitget public candles." : "Used deterministic fixture data.",
      severity: source === "bitget_public" ? "success" : "info"
    },
    {
      id: "ai-transcript",
      agent: "Evaluator",
      type: "decision_made",
      message: hasTranscript ? "AI transcript generated for agent workbench." : "Awaiting AI transcript request.",
      severity: hasTranscript ? "success" : "info"
    }
  ];

  return [...base, ...mapped, ...tail];
}

function renderAgentIcon(name: string) {
  if (name.includes("Intake")) return <ListChecks size={17} aria-hidden />;
  if (name.includes("Staffing")) return <Layers3 size={17} aria-hidden />;
  if (name.includes("Strategy")) return <BookOpen size={17} aria-hidden />;
  if (name.includes("Backtest")) return <Activity size={17} aria-hidden />;
  if (name.includes("Risk")) return <ShieldAlert size={17} aria-hidden />;
  if (name.includes("Demo")) return <FlaskConical size={17} aria-hidden />;
  if (name.includes("Evaluator")) return <SearchCheck size={17} aria-hidden />;
  if (name.includes("Human")) return <UserCheck size={17} aria-hidden />;
  if (name.includes("Live")) return <Radio size={17} aria-hidden />;
  if (name.includes("Memory")) return <Database size={17} aria-hidden />;
  return <TerminalSquare size={17} aria-hidden />;
}

function riskTone(decision: PipelineResult["risk"]["decision"]) {
  return decision === "PASS" ? "pass" : decision === "WARN" ? "warn" : "block";
}

function traceSeverityClass(severity: TraceEvent["severity"]) {
  return {
    info: "text-[var(--muted)]",
    success: "text-[var(--success)]",
    warning: "text-[var(--warning)]",
    error: "text-[var(--danger)]"
  }[severity];
}
