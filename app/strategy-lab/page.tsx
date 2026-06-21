"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Bot,
  Box,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code,
  Copy,
  Lightbulb,
  Loader2,
  Menu,
  Play,
  Plus,
  Save,
  Sparkles,
  Store,
  TrendingUp,
  X,
} from "lucide-react";
import {
  CumulativeReturnChart,
  DrawdownChart,
  MonthlyReturnChart,
} from "@/src/components/BacktestCharts";
import { StrategyCodeEditor } from "@/src/components/StrategyCodeEditor";
import {
  extractParamsFromCode,
  updateCodeWithParams,
  type ExtractedParam,
} from "@/src/utils/paramExtractor";
import {
  analyzeStrategyLabArtifact,
  createStrategyLabSession,
  getStrategyLabMessageJob,
  getStrategyLabSession,
  listStrategyLabSessions,
  runStrategyLabArtifact,
  startStrategyLabMessage,
  updateStrategyLabArtifact,
  type StrategyLabProgressEvent,
  type StrategyLabDetail,
  type StrategyLabSession,
} from "@/src/utils/strategyLabBackend";
import { listSavedStrategies, saveStrategyFromArtifact } from "@/src/utils/savedStrategies";

type BacktestConfig = {
  startDate: string;
  endDate: string;
  initialCapital: number;
  commissionRate: number;
  slippage: number;
  dataSource?: "mock" | "bitget_public";
  symbol?: string;
  granularity?: string;
  limit?: number;
};

type BacktestMetrics = {
  totalReturn: number;
  annualReturn: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  tradeCount: number;
  riskScore: number;
  riskDecision: string;
  recommendations: string[];
};

type TradeRow = {
  date: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  amount: number;
  pnl?: number;
  fee: number;
};

type PositionRow = {
  date: string;
  symbol: string;
  quantity: number;
  cost: number;
  close: number;
  marketValue: number;
  weight: number;
  pnl: number;
};

type RunLog = {
  time: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
};

type AgentTraceStep = {
  agent: string;
  step: string;
  status: string;
  summary: string;
};

type ToolTraceStep = {
  tool: string;
  status: "running" | "completed" | "failed";
  summary?: string;
  startedAt?: string;
  completedAt?: string;
};

type PlannerDecision = {
  intent?: string;
  title?: string;
  strategy_family?: string;
  summary?: string;
  selected_agents?: string[];
  selected_skills?: string[];
  delivery_standards?: string[];
  next_actions?: string[];
  planner_source?: string;
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_warning?: string | null;
};

type CodeAgentResult = {
  title?: string;
  code_source?: "llm" | "template";
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_warning?: string | null;
};

type CodeValidationResult = {
  valid?: boolean;
  status?: "passed" | "failed";
  checks?: string[];
  errors?: string[];
  warnings?: string[];
};

type CodePackageArtifact = {
  type: "code_package";
  id: string;
  title: string;
  code: string;
  params: Record<string, unknown>;
  explanation: string;
  framework?: string;
  agent?: string;
  codeSource?: string;
  llmProvider?: string | null;
  llmModel?: string | null;
  toolTrace?: ToolTraceStep[];
  plannerDecision?: PlannerDecision;
  codeAgentResult?: CodeAgentResult;
  codeValidation?: CodeValidationResult;
  agentTrace?: AgentTraceStep[];
  createdAt: string;
  updatedAt?: string;
};

type BacktestRunArtifact = {
  type: "backtest_run";
  id: string;
  title: string;
  codePackageId: string;
  code: string;
  params: Record<string, unknown>;
  metrics: BacktestMetrics;
  charts: {
    cumulativeReturn: number[];
    dates: string[];
    benchmark?: number[];
    drawdown?: number[];
  };
  monthlyReturns: Array<{ month: string; return: number }>;
  trades: TradeRow[];
  positions: PositionRow[];
  logs: RunLog[];
  createdAt: string;
  updatedAt?: string;
};

type StrategyArtifact = CodePackageArtifact | BacktestRunArtifact;

type FeedItem =
  | {
      id: string;
      kind: "message";
      role: "assistant" | "user";
      content: string;
      pending?: boolean;
      progress?: StrategyLabProgressEvent[];
      toolTrace?: StrategyLabProgressEvent[];
    }
  | {
      id: string;
      kind: "artifact";
      artifactId: string;
    };

const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  startDate: "2024-01-01",
  endDate: "2024-12-31",
  initialCapital: 100000,
  commissionRate: 0.001,
  slippage: 0.0005,
  dataSource: "mock",  // 默认使用mock数据
  symbol: "BTCUSDT",
  granularity: "1day",  // Bitget API格式
  limit: 300,
};

const PROMPT_SUGGESTIONS = [
  "分析当前 BTCUSDT 4 小时行情",
  "检查 BTC 资金费率与持仓量",
  "分析 BTC 订单簿与流动性",
  "评估 BTC 链上与市场风险",
  "推荐适合当前行情的策略",
  "生成一个可回测的加密策略",
];

function hydrateParamsFromArtifact(artifact: StrategyArtifact): ExtractedParam[] {
  const savedParams = artifact.params ?? {};

  return extractParamsFromCode(artifact.code).map((param) => ({
    ...param,
    currentValue: coerceSavedParamValue(savedParams[param.id], param.currentValue),
  }));
}

function paramsRecordFromArtifact(artifact: StrategyArtifact): Record<string, unknown> {
  return {
    ...paramsToRecord(hydrateParamsFromArtifact(artifact)),
    ...(artifact.params ?? {}),
  };
}

function codePackageIdForArtifact(artifact: StrategyArtifact): string {
  return artifact.type === "backtest_run" ? artifact.codePackageId : artifact.id;
}

function compareArtifactFreshness(left: StrategyArtifact, right: StrategyArtifact): number {
  const leftTime = Date.parse(left.updatedAt ?? left.createdAt);
  const rightTime = Date.parse(right.updatedAt ?? right.createdAt);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  return 0;
}

function latestRunByCodePackage(artifacts: StrategyArtifact[]) {
  return artifacts.reduce<Map<string, BacktestRunArtifact>>((runs, artifact) => {
    if (artifact.type !== "backtest_run") return runs;
    const current = runs.get(artifact.codePackageId);
    if (!current || compareArtifactFreshness(current, artifact) <= 0) {
      runs.set(artifact.codePackageId, artifact);
    }
    return runs;
  }, new Map());
}

function normalizeStrategyLabFeed(
  detail: StrategyLabDetail<StrategyArtifact>,
): FeedItem[] {
  const messagesById = new Map(
    detail.messages.map((message) => [message.id, message]),
  );
  const artifactsById = new Map(
    detail.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const latestRuns = latestRunByCodePackage(detail.artifacts);
  const displayedArtifacts = new Set<string>();

  return detail.feed.reduce<FeedItem[]>((items, item) => {
    if (item.kind === "artifact") {
      const artifact = artifactsById.get(item.artifactId);
      if (!artifact) return items;

      const packageId = codePackageIdForArtifact(artifact);
      const displayArtifact = latestRuns.get(packageId) ?? artifact;
      if (displayedArtifacts.has(displayArtifact.id)) return items;

      displayedArtifacts.add(displayArtifact.id);
      items.push({
        id: `feed-${displayArtifact.id}`,
        kind: "artifact",
        artifactId: displayArtifact.id,
      });
      return items;
    }

    const message = messagesById.get(item.messageId);
    if (!message) return items;
    if (message.id.startsWith("message-run-")) return items;
    items.push({
      id: item.id,
      kind: "message",
      role: message.role,
      content: message.content,
      toolTrace: message.toolTrace,
    });
    return items;
  }, []);
}

function coerceSavedParamValue(
  value: unknown,
  fallback: ExtractedParam["currentValue"],
): ExtractedParam["currentValue"] {
  if (value === undefined || value === null) return fallback;
  if (typeof fallback === "number") {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (typeof fallback === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return fallback;
}

export default function StrategyLab() {
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const [sessions, setSessions] = useState<StrategyLabSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const [drawerWidth, setDrawerWidth] = useState(720);
  const [isResizingDrawer, setIsResizingDrawer] = useState(false);
  const [artifacts, setArtifacts] = useState<StrategyArtifact[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<
    "code" | "performance" | "trades" | "positions" | "logs" | "analysis"
  >("code");
  const [isRunning, setIsRunning] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isSubmittingPrompt, setIsSubmittingPrompt] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [saveTarget, setSaveTarget] = useState<BacktestRunArtifact | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [saveTags, setSaveTags] = useState("");
  const [isSavingStrategy, setIsSavingStrategy] = useState(false);
  const [saveStrategyError, setSaveStrategyError] = useState<string | null>(null);
  const [savedStrategyLinks, setSavedStrategyLinks] = useState<Record<string, string>>({});
  const [analysisResult, setAnalysisResult] = useState<{
    isSatisfactory: boolean;
    diagnosis: string;
    recommendations: string[];
    metricsSummary: string;
    shouldOptimize: boolean;
    suggestedParams: Record<string, unknown>;
  } | null>(null);
  const [backtestConfig, setBacktestConfig] = useState<BacktestConfig>(
    DEFAULT_BACKTEST_CONFIG,
  );
  const feedScrollRef = useRef<HTMLDivElement>(null);

  const activeArtifact = artifacts.find(
    (artifact) => artifact.id === activeArtifactId,
  );
  const isDraftSession = !activeSessionId && !feed.length;
  const sidebarWidth = sessionsCollapsed ? 64 : 288;

  const applySessionDetail = (
    detail: StrategyLabDetail<StrategyArtifact>,
    options: { openActiveArtifact?: boolean } = {},
  ) => {
    setActiveSessionId(detail.session.id);
    setArtifacts(detail.artifacts);
    setFeed(normalizeStrategyLabFeed(detail));
    setActiveArtifactId(
      options.openActiveArtifact ? detail.session.activeArtifactId ?? null : null,
    );
  };

  useEffect(() => {
    let cancelled = false;

    const loadInitialSession = async () => {
      setIsLoadingSession(true);
      setApiError(null);
      try {
        const list = await listStrategyLabSessions();
        const firstSession = list.sessions[0];

        if (cancelled) return;
        setSessions(list.sessions);
        if (firstSession) {
          const detail = await getStrategyLabSession<StrategyArtifact>(firstSession.id);
          if (cancelled) return;
          applySessionDetail(detail);
        } else {
          startDraftSession();
        }
      } catch (error) {
        if (cancelled) return;
        setApiError(error instanceof Error ? error.message : "Strategy Lab backend unavailable");
      } finally {
        if (!cancelled) setIsLoadingSession(false);
      }
    };

    void loadInitialSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listSavedStrategies()
      .then((result) => {
        if (cancelled) return;
        setSavedStrategyLinks(
          Object.fromEntries(
            result.strategies
              .filter((strategy) => strategy.sourceCodePackageId)
              .map((strategy) => [strategy.sourceCodePackageId as string, strategy.id]),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const getDrawerWidthBounds = () => {
    const minMainWidth = 360;
    const maxDrawerWidth = Math.max(
      280,
      window.innerWidth - sidebarWidth - minMainWidth,
    );

    return {
      min: Math.min(520, maxDrawerWidth),
      max: maxDrawerWidth,
    };
  };

  useEffect(() => {
    if (!activeArtifact) return;

    const clampDrawerWidth = () => {
      const { min, max } = getDrawerWidthBounds();
      setDrawerWidth((width) => Math.min(Math.max(width, min), max));
    };

    clampDrawerWidth();
    window.addEventListener("resize", clampDrawerWidth);

    return () => {
      window.removeEventListener("resize", clampDrawerWidth);
    };
  }, [activeArtifact, sidebarWidth]);

  useEffect(() => {
    if (!isResizingDrawer) return;

    const handleMouseMove = (event: MouseEvent) => {
      const { min, max } = getDrawerWidthBounds();
      const nextWidth = window.innerWidth - event.clientX;
      setDrawerWidth(Math.min(Math.max(nextWidth, min), max));
    };

    const handleMouseUp = () => {
      setIsResizingDrawer(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingDrawer, sidebarWidth]);

  useEffect(() => {
    if (!activeArtifact) return;
    setDrawerTab(activeArtifact.type === "backtest_run" ? "performance" : "code");
  }, [activeArtifactId, activeArtifact?.type]);

  const activeCodeParams = useMemo(() => {
    if (!activeArtifact) return [];
    return hydrateParamsFromArtifact(activeArtifact);
  }, [activeArtifact]);

  const updateCodePackage = (artifactId: string, code: string) => {
    const params = paramsToRecord(extractParamsFromCode(code));
    setArtifacts((current) =>
      current.map((artifact) =>
        artifact.id === artifactId
          ? {
              ...artifact,
              code,
              params,
            }
          : artifact,
      ),
    );
    void updateStrategyLabArtifact(artifactId, { code, params }).catch((error) => {
      setApiError(error instanceof Error ? error.message : "Failed to save artifact");
    });
  };

  const updateParam = (artifactId: string, paramId: string, value: number) => {
    const artifact = artifacts.find((item) => item.id === artifactId);
    if (!artifact) return;

    const updatedParams = hydrateParamsFromArtifact(artifact).map((param) =>
      param.id === paramId ? { ...param, currentValue: value } : param,
    );
    const code = updateCodeWithParams(artifact.code, updatedParams);
    updateCodePackage(artifactId, code);
  };

  const openSession = async (sessionId: string) => {
    setIsLoadingSession(true);
    setApiError(null);
    try {
      const detail = await getStrategyLabSession<StrategyArtifact>(sessionId);
      applySessionDetail(detail);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Failed to open session");
    } finally {
      setIsLoadingSession(false);
    }
  };

  const startDraftSession = () => {
    setActiveSessionId(null);
    setArtifacts([]);
    setFeed([]);
    setActiveArtifactId(null);
    setDrawerTab("code");
    setExecutionError(null);
  };

  const createNewSession = () => {
    setApiError(null);
    setInputMessage("");
    startDraftSession();
  };

  const createCodePackageFromPrompt = async (promptOverride?: string) => {
    const prompt = (promptOverride ?? inputMessage).trim();
    if (!prompt || isSubmittingPrompt) return;

    const optimisticUserId = `local-user-${Date.now()}`;
    const optimisticAssistantId = `local-assistant-${Date.now()}`;
    setIsSubmittingPrompt(true);
    setApiError(null);
    setInputMessage("");
    setActiveArtifactId(null);
    setFeed((current) => [
      ...current,
      {
        id: optimisticUserId,
        kind: "message",
        role: "user",
        content: prompt,
      },
      {
        id: optimisticAssistantId,
        kind: "message",
        role: "assistant",
        content: "正在开始处理",
        pending: true,
        progress: [
          {
            tool: "request_received",
            status: "running",
            summary: "正在理解请求并准备研究步骤",
          },
        ],
      },
    ]);
    window.requestAnimationFrame(() => {
      const container = feedScrollRef.current;
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
    });
    window.setTimeout(() => {
      const container = feedScrollRef.current;
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
    }, 120);

    try {
      const sessionId = activeSessionId
        ? activeSessionId
        : ((await createStrategyLabSession(prompt.slice(0, 18) || "未命名策略")) as StrategyLabDetail<StrategyArtifact>)
            .session.id;
      let { job } = await startStrategyLabMessage<StrategyArtifact>(sessionId, prompt);
      while (job.status === "running") {
        setFeed((current) =>
          current.map((item) =>
            item.kind === "message" && item.id === optimisticAssistantId
              ? { ...item, progress: job.events }
              : item,
          ),
        );
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        job = (await getStrategyLabMessageJob<StrategyArtifact>(job.id)).job;
      }
      if (job.status === "failed" || !job.detail) {
        throw new Error(job.error || "Agent 处理失败");
      }
      const detail = job.detail;
      setSessions((current) =>
        [detail.session, ...current.filter((session) => session.id !== detail.session.id)],
      );
      applySessionDetail(detail, { openActiveArtifact: true });
      setDrawerTab("code");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create code package";
      setApiError(message);
      setFeed((current) =>
        current.map((item) =>
          item.kind === "message" && item.id === optimisticAssistantId
            ? {
                ...item,
                pending: false,
                content: `生成失败：${message}`,
              }
            : item,
        ),
      );
    } finally {
      setIsSubmittingPrompt(false);
    }
  };

  const runBacktest = async (artifact: StrategyArtifact) => {
    setIsRunning(true);
    setExecutionError(null);
    setActiveArtifactId(artifact.id);

    try {
      const params = paramsRecordFromArtifact(artifact);
      const result = await runStrategyLabArtifact<BacktestRunArtifact>(artifact.id, {
        strategyCode: artifact.code,
        params,
        backtestConfig,
      });

      const runArtifact = result.artifact;
      const packageId = codePackageIdForArtifact(runArtifact);
      setArtifacts((current) => [
        ...current.filter(
          (item) =>
            item.id !== runArtifact.id &&
            (item.type !== "backtest_run" || item.codePackageId !== packageId),
        ),
        runArtifact,
      ]);
      setFeed((current) => {
        let replaced = false;
        const next = current.reduce<FeedItem[]>((items, item) => {
          if (item.kind !== "artifact") {
            if (!item.id.startsWith("message-run-")) items.push(item);
            return items;
          }

          const currentArtifact = artifacts.find(
            (candidate) => candidate.id === item.artifactId,
          );
          if (currentArtifact && codePackageIdForArtifact(currentArtifact) === packageId) {
            if (!replaced) {
              items.push({
                id: `feed-${runArtifact.id}`,
                kind: "artifact",
                artifactId: runArtifact.id,
              });
              replaced = true;
            }
            return items;
          }

          items.push(item);
          return items;
        }, []);

        if (!replaced) {
          next.push({
            id: `feed-${runArtifact.id}`,
            kind: "artifact",
            artifactId: runArtifact.id,
          });
        }
        return next;
      });
      setSessions((current) =>
        [result.session, ...current.filter((session) => session.id !== result.session.id)],
      );
      setActiveArtifactId(runArtifact.id);
      setDrawerTab("performance");
    } catch (error) {
      setExecutionError(
        error instanceof Error ? error.message : "Sandbox execution failed",
      );
      setDrawerTab("logs");
    } finally {
      setIsRunning(false);
    }
  };

  const analyzeBacktest = async (artifact: StrategyArtifact) => {
    setIsAnalyzing(true);
    setDrawerTab("analysis");

    try {
      const result = await analyzeStrategyLabArtifact<BacktestRunArtifact>(artifact.id);
      setAnalysisResult(result.analysis);
      setArtifacts((current) =>
        current.map((a) => a.id === result.artifact.id ? result.artifact : a),
      );
      setFeed((current) => [
        ...current,
        {
          id: result.message.id,
          kind: "message",
          role: "assistant",
          content: result.message.content,
        },
      ]);
    } catch (error) {
      setAnalysisResult({
        isSatisfactory: false,
        diagnosis: `分析失败：${error instanceof Error ? error.message : "未知错误"}`,
        recommendations: ["请检查回测结果是否完整"],
        metricsSummary: "",
        shouldOptimize: false,
        suggestedParams: {},
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const openSaveStrategy = (artifact: BacktestRunArtifact) => {
    setSaveTarget(artifact);
    setSaveName(artifact.title.replace(/ 回测$/, ""));
    setSaveDescription("");
    setSaveTags("");
    setSaveStrategyError(null);
  };

  const submitSaveStrategy = async () => {
    if (!saveTarget || !saveName.trim()) return;
    setIsSavingStrategy(true);
    setSaveStrategyError(null);
    try {
      const result = await saveStrategyFromArtifact({
        artifactId: saveTarget.id,
        name: saveName.trim(),
        description: saveDescription.trim(),
        tags: saveTags
          .replace(/，/g, ",")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setSavedStrategyLinks((current) => ({
        ...current,
        [codePackageIdForArtifact(saveTarget)]: result.strategy.id,
      }));
      setSaveTarget(null);
    } catch (error) {
      setSaveStrategyError(error instanceof Error ? error.message : "保存策略失败");
    } finally {
      setIsSavingStrategy(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <aside
        className={`border-r border-[var(--line)] bg-[var(--panel)] transition-all duration-200 ${
          sessionsCollapsed ? "w-16" : "w-72"
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-[var(--line)] px-4">
          <button
            aria-label="Toggle sessions"
            onClick={() => setSessionsCollapsed((value) => !value)}
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--panel-muted)] hover:text-[var(--foreground)]"
          >
            <Menu size={18} />
          </button>
          {!sessionsCollapsed && (
            <button
              onClick={() => void createNewSession()}
              className="rounded-lg p-2 text-[var(--foreground)] hover:bg-[var(--panel-muted)]"
            >
              <Plus size={18} />
            </button>
          )}
        </div>

        {!sessionsCollapsed && (
          <div className="p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              Today
            </div>
            <div className="space-y-2">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => void openSession(session.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
                    activeSessionId === session.id
                      ? "bg-[var(--panel-muted)]"
                      : "hover:bg-[var(--panel-muted)]"
                  }`}
                >
                  <span className="block truncate">{session.title}</span>
                  <span className="mt-1 block truncate text-xs font-normal text-[var(--muted)]">
                    {session.subtitle}
                  </span>
                </button>
              ))}
              {!sessions.length && (
                <div className="rounded-lg border border-dashed border-[var(--line)] px-3 py-6 text-center text-xs text-[var(--muted)]">
                  {isLoadingSession ? "Loading sessions..." : "No sessions"}
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--panel)] px-6">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-md border border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]">
              <BookOpen size={16} />
            </span>
            <div>
              <p className="text-sm font-bold leading-tight">PaperForge</p>
              <p className="text-[10px] text-[var(--muted)]">Strategy workspace</p>
            </div>
          </Link>
          <nav aria-label="Strategy workspace navigation" className="flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--background)] p-1 text-sm">
            <span className="rounded bg-[var(--surface)] px-3 py-1.5 font-semibold shadow-sm">策略研究</span>
            <Link href="/strategies" className="rounded px-3 py-1.5 text-[var(--muted)] hover:text-[var(--foreground)]">我的策略</Link>
            <Link href="/marketplace" className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[var(--muted)] hover:text-[var(--foreground)]">
              <Store size={14} />
              策略广场
            </Link>
          </nav>
        </header>

        <div ref={feedScrollRef} className={`flex-1 overflow-y-auto ${isDraftSession ? "bg-white" : ""}`}>
          <div
            className={`mx-auto flex flex-col gap-5 px-6 ${
              isDraftSession ? "min-h-full max-w-6xl justify-center py-14" : "max-w-4xl pt-8 pb-52"
            }`}
          >
            {apiError && (
              <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">
                {apiError}
              </div>
            )}
            {isLoadingSession && (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
                Loading Strategy Lab session...
              </div>
            )}
            {!isLoadingSession && isDraftSession && (
              <DraftWelcome
                value={inputMessage}
                onChange={setInputMessage}
                onSubmit={createCodePackageFromPrompt}
                isSubmitting={isSubmittingPrompt}
              />
            )}
            {feed.map((item) =>
              item.kind === "message" ? (
                <MessageBubble key={item.id} item={item} />
              ) : (
                <ArtifactCard
                  key={item.id}
                  artifact={artifacts.find((artifact) => artifact.id === item.artifactId)}
                  isActive={activeArtifactId === item.artifactId}
                  onOpen={(artifactId) => setActiveArtifactId(artifactId)}
                />
              ),
            )}
          </div>
        </div>

        {!isDraftSession && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-6 pb-5 pt-16">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/92 to-transparent" />
            <div className="pointer-events-auto relative mx-auto max-w-4xl">
              <PromptComposer
                value={inputMessage}
                onChange={setInputMessage}
                onSubmit={createCodePackageFromPrompt}
                isSubmitting={isSubmittingPrompt}
                compact
              />
            </div>
          </div>
        )}
      </main>

      {activeArtifact && (
        <DrawerResizeHandle
          isDragging={isResizingDrawer}
          onResizeStart={(event) => {
            event.preventDefault();
            setIsResizingDrawer(true);
          }}
        />
      )}

      <ArtifactDrawer
        artifact={activeArtifact}
        width={drawerWidth}
        tab={drawerTab}
        onTabChange={setDrawerTab}
        onClose={() => setActiveArtifactId(null)}
        onRun={runBacktest}
        onAnalyze={analyzeBacktest}
        onSave={openSaveStrategy}
        savedStrategyId={
          activeArtifact
            ? savedStrategyLinks[codePackageIdForArtifact(activeArtifact)]
            : undefined
        }
        isRunning={isRunning}
        isAnalyzing={isAnalyzing}
        executionError={executionError}
        backtestConfig={backtestConfig}
        onBacktestConfigChange={setBacktestConfig}
        codeParams={activeCodeParams}
        onCodeChange={updateCodePackage}
        onParamChange={updateParam}
        analysisResult={analysisResult}
      />

      {saveTarget && (
        <SaveStrategyDialog
          name={saveName}
          description={saveDescription}
          tags={saveTags}
          error={saveStrategyError}
          isSaving={isSavingStrategy}
          onNameChange={setSaveName}
          onDescriptionChange={setSaveDescription}
          onTagsChange={setSaveTags}
          onClose={() => !isSavingStrategy && setSaveTarget(null)}
          onSubmit={() => void submitSaveStrategy()}
        />
      )}
    </div>
  );
}

function DraftWelcome({
  value,
  onChange,
  onSubmit,
  isSubmitting,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value?: string) => void | Promise<void>;
  isSubmitting: boolean;
}) {
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col items-center px-2 pb-24">
      <div className="mb-12 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--muted)] shadow-sm">
          <Sparkles size={14} className="text-[var(--accent)]" />
          PaperForge Quant Agent
        </div>
        <h2 className="text-4xl font-black tracking-normal text-[var(--foreground)]">
          PaperForge 人工智能投研平台
        </h2>
        <p className="mt-4 text-lg font-semibold text-[var(--foreground)]">
          智能投研 Quant Agent
        </p>
      </div>

      <PromptComposer
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        isSubmitting={isSubmitting}
      />

      <div className="mt-6 flex max-w-4xl flex-wrap justify-center gap-3">
        {PROMPT_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => void onSubmit(suggestion)}
            disabled={isSubmitting}
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] shadow-[0_2px_10px_rgba(15,23,42,0.05)] transition hover:border-[var(--accent)]/45 hover:bg-[var(--panel-muted-2)] disabled:opacity-50"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </section>
  );
}

function SaveStrategyDialog({
  name,
  description,
  tags,
  error,
  isSaving,
  onNameChange,
  onDescriptionChange,
  onTagsChange,
  onClose,
  onSubmit,
}: {
  name: string;
  description: string;
  tags: string;
  error: string | null;
  isSaving: boolean;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/25 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-strategy-title"
        className="w-full max-w-lg rounded-lg border border-[var(--line)] bg-[var(--panel)] shadow-[0_24px_80px_rgba(15,23,42,0.22)]"
      >
        <div className="flex items-start justify-between border-b border-[var(--line)] px-6 py-5">
          <div>
            <h2 id="save-strategy-title" className="text-lg font-bold">保存到我的策略</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">保存当前代码、参数和回测结果，后续可以继续迭代。</p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭保存策略窗口"
            className="rounded-md p-2 text-[var(--muted)] hover:bg-[var(--panel-muted)]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <label className="block text-sm font-semibold">
            策略名称
            <input
              autoFocus
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={100}
              className="mt-2 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 font-normal outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="block text-sm font-semibold">
            策略说明
            <textarea
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="记录策略逻辑、适用行情或风险提示"
              rows={3}
              maxLength={500}
              className="mt-2 w-full resize-none rounded-md border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 font-normal outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="block text-sm font-semibold">
            标签
            <input
              value={tags}
              onChange={(event) => onTagsChange(event.target.value)}
              placeholder="例如：BTC, KDJ, 震荡策略"
              className="mt-2 w-full rounded-md border border-[var(--line)] bg-[var(--background)] px-3 py-2.5 font-normal outline-none focus:border-[var(--accent)]"
            />
            <span className="mt-1.5 block text-xs font-normal text-[var(--muted)]">使用逗号分隔，最多保存 8 个标签。</span>
          </label>
          {error && (
            <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-[var(--line)] px-6 py-4">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={isSaving || !name.trim()}
            className="flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {isSaving ? "保存中" : "保存策略"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptComposer({
  value,
  onChange,
  onSubmit,
  isSubmitting,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value?: string) => void | Promise<void>;
  isSubmitting: boolean;
  compact?: boolean;
}) {
  const canSubmit = value.trim().length > 0 && !isSubmitting;

  return (
    <div
      className={`mx-auto w-full ${
        compact ? "max-w-4xl" : "max-w-4xl"
      } overflow-hidden rounded-[28px] border border-[var(--line-strong)] bg-[var(--surface)] shadow-[0_18px_48px_rgba(15,23,42,0.08),0_1px_0_rgba(255,255,255,0.95)_inset] transition focus-within:border-[var(--accent)] focus-within:shadow-[0_24px_70px_rgba(59,130,246,0.13),0_1px_0_rgba(255,255,255,0.95)_inset]`}
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (canSubmit) void onSubmit();
          }
        }}
        placeholder={
          compact
            ? "继续描述你的策略，或说明你想怎么修改当前代码..."
            : "请输入你的策略想法（Shift + Enter 换行）"
        }
        rows={compact ? 3 : 6}
        className={`block w-full resize-none bg-transparent px-7 pt-6 text-[15px] leading-7 text-[var(--foreground)] outline-none placeholder:text-[var(--faint)] ${
          compact ? "min-h-[104px] pb-2" : "min-h-[160px] pb-4"
        }`}
      />
      <div className="flex items-center justify-end gap-3 px-5 pb-5 pt-2">
        <div className="flex items-center gap-3">
          {isSubmitting && (
            <span className="hidden text-xs font-medium text-[var(--muted)] sm:inline">
              Agent 正在执行 · 进展见上方
            </span>
          )}
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={!canSubmit}
            aria-label="Submit prompt"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-[0_10px_22px_rgba(59,130,246,0.24)] transition hover:bg-[var(--accent-strong)] disabled:bg-[var(--line-strong)] disabled:text-white disabled:shadow-none"
          >
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={19} />}
          </button>
        </div>
      </div>
    </div>
  );
}

const TOOL_PRESENTATION: Record<string, { label: string; detail: string }> = {
  request_received: { label: "收到请求", detail: "正在准备研究步骤" },
  agent_reasoning: { label: "分析请求", detail: "选择研究路径并整理证据" },
  bitget_mcp: { label: "连接 Bitget", detail: "加载现货与合约市场工具" },
  list_strategy_skills: { label: "识别能力", detail: "检查可用研究与策略能力" },
  load_strategy_skill: { label: "加载研究方法", detail: "读取当前任务的操作规范" },
  get_market_ticker: { label: "读取实时行情", detail: "获取 Bitget 最新价格" },
  analyze_market_timeframe: { label: "分析技术面", detail: "计算趋势、动量与波动指标" },
  get_asset_profile: { label: "读取资产资料", detail: "查询 CMC 市值、供应与排名" },
  get_global_crypto_market: { label: "分析市场概况", detail: "查询全球市场与主导率" },
  get_onchain_metrics: { label: "分析链上数据", detail: "查询 Coin Metrics 链上指标" },
  get_btc_network_state: { label: "检查 BTC 网络", detail: "查询拥堵与手续费状态" },
  spot_get_ticker: { label: "读取现货行情", detail: "查询 Bitget 实时价格" },
  spot_get_depth: { label: "读取现货深度", detail: "检查买卖盘与流动性" },
  spot_get_candles: { label: "读取现货 K 线", detail: "获取历史价格序列" },
  spot_get_trades: { label: "读取现货成交", detail: "检查近期成交活动" },
  futures_get_ticker: { label: "读取合约行情", detail: "查询 Bitget 合约价格" },
  futures_get_depth: { label: "读取合约深度", detail: "检查合约买卖盘" },
  futures_get_candles: { label: "读取合约 K 线", detail: "获取合约价格序列" },
  futures_get_trades: { label: "读取合约成交", detail: "检查近期合约成交" },
  futures_get_contracts: { label: "读取合约资料", detail: "核对交易规格" },
  futures_get_funding_rate: { label: "查询资金费率", detail: "判断多空拥挤程度" },
  futures_get_open_interest: { label: "查询合约持仓量", detail: "观察杠杆资金变化" },
  system_get_capabilities: { label: "检查 Bitget 能力", detail: "确认可用公开接口" },
  search_strategy_library: { label: "检索策略依据", detail: "匹配当前行情与可用数据" },
  get_strategy_card: { label: "读取策略详情", detail: "核对逻辑、风险与来源" },
  compare_strategy_cards: { label: "比较候选策略", detail: "评估适用条件与风险" },
  validate_strategy_design: { label: "校验策略设计", detail: "检查数据和执行兼容性" },
  validate_and_commit_code: { label: "生成策略代码", detail: "校验并保存代码包" },
  run_strategy_backtest: { label: "运行策略回测", detail: "在 Python 沙箱中执行策略" },
};

function AgentActivity({ events, pending }: { events: StrategyLabProgressEvent[]; pending: boolean }) {
  const visibleEvents = events.filter(
    (event, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.tool === event.tool && candidate.startedAt === event.startedAt,
      ) === index,
  );

  return (
    <div className="mt-1 space-y-2">
      {visibleEvents.map((event, index) => {
        const presentation = TOOL_PRESENTATION[event.tool] ?? {
          label: event.tool.replaceAll("_", " "),
          detail: "正在调用工具",
        };
        return (
          <div key={`${event.tool}-${event.startedAt || index}`} className="flex items-start gap-3 text-xs">
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-[var(--muted)]">
              {event.status === "running" ? (
                <Loader2 size={14} className="animate-spin text-[var(--accent)]" />
              ) : event.status === "failed" ? (
                <AlertCircle size={14} className="text-[var(--danger)]" />
              ) : (
                <CheckCircle2 size={14} className="text-[var(--success)]" />
              )}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-[var(--foreground)]">{presentation.label}</div>
              <div className="mt-0.5 truncate text-[var(--muted)]">
                {event.summary || presentation.detail}
              </div>
            </div>
          </div>
        );
      })}
      {pending && !visibleEvents.some((event) => event.status === "running") && (
        <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
          <Loader2 size={14} className="animate-spin text-[var(--accent)]" />
          正在整理研究结论
        </div>
      )}
    </div>
  );
}

function MessageBubble({ item }: { item: Extract<FeedItem, { kind: "message" }> }) {
  const isUser = item.role === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-200`}
    >
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 ${
          isUser
            ? "bg-[var(--accent)] text-white"
            : "border border-[var(--line)] bg-[var(--surface)]"
        }`}
      >
        {!isUser && (
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--accent)]">
            {item.pending ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
            StrategyBot
          </div>
        )}
        {!isUser && item.pending ? (
          <AgentActivity events={item.progress || []} pending />
        ) : isUser ? (
          <span className="whitespace-pre-wrap break-words">{item.content}</span>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="mb-3 mt-5 text-xl font-bold first:mt-0">{children}</h1>,
              h2: ({ children }) => <h2 className="mb-2 mt-5 text-lg font-bold first:mt-0">{children}</h2>,
              h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-bold first:mt-0">{children}</h3>,
              p: ({ children }) => <p className="my-2 break-words first:mt-0 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
              ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
              li: ({ children }) => <li className="pl-1">{children}</li>,
              strong: ({ children }) => <strong className="font-bold text-[var(--foreground)]">{children}</strong>,
              blockquote: ({ children }) => (
                <blockquote className="my-3 border-l-2 border-[var(--accent)] pl-3 text-[var(--muted)]">
                  {children}
                </blockquote>
              ),
              a: ({ children, href }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-[var(--accent)] underline underline-offset-2"
                >
                  {children}
                </a>
              ),
              code: ({ children, className }) => (
                <code className={`${className || ""} rounded bg-[var(--background)] px-1.5 py-0.5 font-mono text-[0.9em]`}>
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre className="my-3 overflow-x-auto rounded-lg bg-[#171717] p-4 text-xs leading-5 text-[#f5f5f4] [&_code]:bg-transparent [&_code]:p-0">
                  {children}
                </pre>
              ),
              table: ({ children }) => (
                <table className="my-3 block max-w-full overflow-x-auto border-collapse text-left text-xs">
                  {children}
                </table>
              ),
              th: ({ children }) => (
                <th className="whitespace-nowrap border border-[var(--line)] bg-[var(--background)] px-3 py-2 font-semibold">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-[var(--line)] px-3 py-2 align-top">{children}</td>
              ),
              hr: () => <hr className="my-4 border-[var(--line)]" />,
            }}
          >
            {item.content}
          </ReactMarkdown>
        )}
        {!isUser && !item.pending && !!item.toolTrace?.length && (
          <details className="mt-3 border-t border-[var(--line)] pt-2 text-xs text-[var(--muted)]">
            <summary className="cursor-pointer select-none font-medium hover:text-[var(--foreground)]">
              查看研究过程 · {item.toolTrace.length} 个动作
            </summary>
            <AgentActivity events={item.toolTrace} pending={false} />
          </details>
        )}
      </div>
    </div>
  );
}

function ArtifactCard({
  artifact,
  isActive,
  onOpen,
}: {
  artifact?: StrategyArtifact;
  isActive: boolean;
  onOpen: (artifactId: string) => void;
}) {
  if (!artifact) return null;

  if (artifact.type === "code_package") {
    return (
      <button
        onClick={() => onOpen(artifact.id)}
        className={`group rounded-xl border bg-[var(--surface)] p-5 text-left transition hover:border-[var(--accent)] animate-in fade-in slide-in-from-bottom-2 duration-200 ${
          isActive ? "border-[var(--accent)] shadow-sm" : "border-[var(--line)]"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold">
              <Box size={18} className="text-[var(--accent)]" />
              {artifact.title}
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              {artifact.explanation}
            </p>
          </div>
          <ChevronRight
            size={18}
            className="text-[var(--muted)] transition group-hover:translate-x-1 group-hover:text-[var(--accent)]"
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
          <Pill icon={<Code size={13} />}>{artifact.code.split("\n").length} lines</Pill>
          <Pill icon={<Clock size={13} />}>{artifact.createdAt}</Pill>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={() => onOpen(artifact.id)}
      className={`group rounded-xl border bg-[var(--surface)] p-5 text-left transition hover:border-[var(--accent)] animate-in fade-in slide-in-from-bottom-2 duration-200 ${
        isActive ? "border-[var(--accent)] shadow-sm" : "border-[var(--line)]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-bold">
            <TrendingUp size={18} className="text-[var(--danger)]" />
            {artifact.title}
          </div>
          <div className="mt-4 grid grid-cols-5 gap-4">
            <MetricCell label="累计收益" value={`${formatNumber(artifact.metrics.totalReturn)}%`} tone="danger" />
            <MetricCell label="年化收益" value={`${formatNumber(artifact.metrics.annualReturn)}%`} tone="danger" />
            <MetricCell label="夏普比率" value={formatNumber(artifact.metrics.sharpe)} />
            <MetricCell label="最大回撤" value={`${formatNumber(artifact.metrics.maxDrawdown)}%`} />
            <MetricCell label="胜率" value={`${formatNumber(artifact.metrics.winRate)}%`} />
          </div>
          <div className="mt-4 h-44 rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
            <CumulativeReturnChart
              data={artifact.charts}
              compact
              height={124}
              className="h-full border-0 bg-transparent p-0"
            />
          </div>
        </div>
        <ChevronRight
          size={18}
          className="text-[var(--muted)] transition group-hover:translate-x-1 group-hover:text-[var(--accent)]"
        />
      </div>
    </button>
  );
}

function DrawerResizeHandle({
  isDragging,
  onResizeStart,
}: {
  isDragging: boolean;
  onResizeStart: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-label="Resize artifact panel"
      onMouseDown={onResizeStart}
      className={`group relative z-20 w-2 flex-none cursor-col-resize bg-transparent transition-colors hover:bg-[var(--accent-soft)] ${
        isDragging ? "bg-[var(--accent-soft)]" : ""
      }`}
    >
      <span
        className={`absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-[var(--line-strong)] transition-colors group-hover:bg-[var(--accent)] ${
          isDragging ? "bg-[var(--accent)]" : ""
        }`}
      />
      <span className="absolute left-1/2 top-1/2 h-14 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--line-strong)] opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function ArtifactDrawer({
  artifact,
  width,
  tab,
  onTabChange,
  onClose,
  onRun,
  onAnalyze,
  onSave,
  savedStrategyId,
  isRunning,
  isAnalyzing,
  executionError,
  backtestConfig,
  onBacktestConfigChange,
  codeParams,
  onCodeChange,
  onParamChange,
  analysisResult,
}: {
  artifact?: StrategyArtifact;
  width: number;
  tab: "code" | "performance" | "trades" | "positions" | "logs" | "analysis";
  onTabChange: (tab: "code" | "performance" | "trades" | "positions" | "logs" | "analysis") => void;
  onClose: () => void;
  onRun: (artifact: StrategyArtifact) => void;
  onAnalyze: (artifact: StrategyArtifact) => void;
  onSave: (artifact: BacktestRunArtifact) => void;
  savedStrategyId?: string;
  isRunning: boolean;
  isAnalyzing: boolean;
  executionError: string | null;
  backtestConfig: BacktestConfig;
  onBacktestConfigChange: (config: BacktestConfig) => void;
  codeParams: ExtractedParam[];
  onCodeChange: (artifactId: string, code: string) => void;
  onParamChange: (artifactId: string, paramId: string, value: number) => void;
  analysisResult: {
    isSatisfactory: boolean;
    diagnosis: string;
    recommendations: string[];
    metricsSummary: string;
    shouldOptimize: boolean;
    suggestedParams: Record<string, unknown>;
  } | null;
}) {
  if (!artifact) return null;

  const tabs =
    artifact.type === "backtest_run"
      ? [
          ["code", "策略代码"],
          ["performance", "策略绩效"],
          ["trades", "交易详情"],
          ["positions", "持仓详情"],
          ["logs", "运行日志"],
          ["analysis", "分析建议"],
        ] as const
      : ([
          ["code", "策略代码"],
          ["logs", "说明"],
        ] as const);

  return (
    <aside
      style={{ width }}
      className="flex-none animate-[pf-drawer-in_220ms_cubic-bezier(.2,.8,.2,1)_both] overflow-hidden border-l border-[var(--line)] bg-[var(--panel)] shadow-[-20px_0_40px_rgba(0,0,0,0.08)]"
    >
      <div className="flex h-14 items-center justify-between border-b border-[var(--line)] px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={onClose} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--panel-muted)]">
            <X size={18} />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{artifact.title}</div>
            <div className="text-xs text-[var(--muted)]">
              {artifact.type === "backtest_run" ? "Backtest run snapshot" : "Code package snapshot"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {artifact.type === "backtest_run" && (
            <>
              {savedStrategyId ? (
                <Link
                  href={`/strategies/${savedStrategyId}`}
                  className="flex items-center gap-2 rounded-lg border border-[var(--success)]/40 bg-[var(--success-soft)] px-3 py-2 text-sm font-semibold text-[var(--success)]"
                >
                  <CheckCircle2 size={16} />
                  已保存
                </Link>
              ) : (
                <button
                  onClick={() => onSave(artifact)}
                  className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  <Save size={16} />
                  保存策略
                </button>
              )}
              <button
                onClick={() => onAnalyze(artifact)}
                disabled={isAnalyzing}
                className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <Brain size={16} />}
                {isAnalyzing ? "分析中" : "分析"}
              </button>
            </>
          )}
          <button
            onClick={() => onRun(artifact)}
            disabled={isRunning}
            className="flex items-center gap-2 rounded-lg bg-[var(--danger)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {isRunning ? "运行中" : "运行策略"}
          </button>
        </div>
      </div>

      <div className="flex gap-8 overflow-x-auto border-b border-[var(--line)] px-6">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            onClick={() => onTabChange(value)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-1 py-4 text-sm font-semibold ${
              tab === value
                ? "border-[var(--danger)] text-[var(--danger)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="h-[calc(100vh-7rem)] overflow-y-auto p-6">
        {executionError && (
          <div className="mb-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]">
            <div className="flex items-center gap-2 font-bold">
              <AlertCircle size={16} />
              Sandbox Error
            </div>
            <p className="mt-2 text-xs">{executionError}</p>
          </div>
        )}

        {tab === "code" && (
          <CodeTab
            artifact={artifact}
            codeParams={codeParams}
            backtestConfig={backtestConfig}
            onBacktestConfigChange={onBacktestConfigChange}
            onCodeChange={onCodeChange}
            onParamChange={onParamChange}
          />
        )}
        {tab === "performance" && artifact.type === "backtest_run" && (
          <PerformanceTab artifact={artifact} />
        )}
        {tab === "trades" && artifact.type === "backtest_run" && (
          <DataTable
            title="交易详情"
            columns={["日期", "股票", "操作", "数量", "成交价", "成交金额", "平仓盈亏", "交易费用"]}
            rows={artifact.trades.map((trade) => [
              trade.date,
              trade.symbol,
              trade.side === "buy" ? "买" : "卖",
              trade.quantity,
              formatNumber(trade.price),
              formatNumber(trade.amount),
              trade.pnl == null ? "--" : formatNumber(trade.pnl),
              formatNumber(trade.fee),
            ])}
          />
        )}
        {tab === "positions" && artifact.type === "backtest_run" && (
          <DataTable
            title="持仓详情"
            columns={["日期", "股票", "数量", "持仓均价", "收盘价", "持仓市值", "持仓占比", "收益"]}
            rows={artifact.positions.map((position) => [
              position.date,
              position.symbol,
              position.quantity,
              formatNumber(position.cost),
              formatNumber(position.close),
              formatNumber(position.marketValue),
              `${formatNumber(position.weight)}%`,
              formatNumber(position.pnl),
            ])}
          />
        )}
        {tab === "logs" && <LogsTab artifact={artifact} />}
        {tab === "analysis" && artifact.type === "backtest_run" && (
          <AnalysisTab
            analysisResult={analysisResult}
            isAnalyzing={isAnalyzing}
            metrics={artifact.metrics}
          />
        )}
      </div>
    </aside>
  );
}

function CodeTab({
  artifact,
  codeParams,
  backtestConfig,
  onBacktestConfigChange,
  onCodeChange,
  onParamChange,
}: {
  artifact: StrategyArtifact;
  codeParams: ExtractedParam[];
  backtestConfig: BacktestConfig;
  onBacktestConfigChange: (config: BacktestConfig) => void;
  onCodeChange: (artifactId: string, code: string) => void;
  onParamChange: (artifactId: string, paramId: string, value: number) => void;
}) {
  const editable = true;

  return (
    <div className="space-y-5">
      {artifact.type === "code_package" && (
        <AgentWorkflowPanel artifact={artifact} />
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">策略代码</h2>
          <button
            onClick={() => navigator.clipboard?.writeText(artifact.code)}
            className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <Copy size={14} />
            复制
          </button>
        </div>
        <StrategyCodeEditor
          value={artifact.code}
          readOnly={!editable}
          onChange={(code) => onCodeChange(artifact.id, code)}
        />
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <h3 className="mb-3 text-sm font-bold">回测设置</h3>
        <div className="space-y-3">
          {/* 数据源选择 */}
          <div>
            <label className="text-xs text-[var(--muted)] mb-1 block">数据源</label>
            <select
              value={backtestConfig.dataSource || "mock"}
              onChange={(event) =>
                onBacktestConfigChange({
                  ...backtestConfig,
                  dataSource: event.target.value as "mock" | "bitget_public",
                })
              }
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="mock">模拟数据（Mock）</option>
              <option value="bitget_public">Bitget真实数据</option>
            </select>
          </div>

          {/* Bitget配置（仅在真实数据时显示） */}
          {backtestConfig.dataSource === "bitget_public" && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-[var(--muted)] mb-1 block">交易对</label>
                <input
                  type="text"
                  value={backtestConfig.symbol || "BTCUSDT"}
                  onChange={(event) =>
                    onBacktestConfigChange({ ...backtestConfig, symbol: event.target.value })
                  }
                  placeholder="BTCUSDT"
                  className="w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] mb-1 block">K线周期</label>
                <select
                  value={backtestConfig.granularity || "1day"}
                  onChange={(event) =>
                    onBacktestConfigChange({ ...backtestConfig, granularity: event.target.value })
                  }
                  className="w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="1min">1分钟</option>
                  <option value="5min">5分钟</option>
                  <option value="15min">15分钟</option>
                  <option value="30min">30分钟</option>
                  <option value="1h">1小时</option>
                  <option value="4h">4小时</option>
                  <option value="6h">6小时</option>
                  <option value="12h">12小时</option>
                  <option value="1day">1天</option>
                  <option value="1week">1周</option>
                  <option value="1M">1月</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] mb-1 block">最多K线数</label>
                <input
                  type="number"
                  value={backtestConfig.limit || 300}
                  min={30}
                  max={1000}
                  onChange={(event) =>
                    onBacktestConfigChange({ ...backtestConfig, limit: Number(event.target.value) })
                  }
                  className="w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-[var(--muted)]">回测时间段</label>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                value={backtestConfig.startDate}
                max={backtestConfig.endDate}
                aria-label="回测开始日期"
                onChange={(event) =>
                  onBacktestConfigChange({ ...backtestConfig, startDate: event.target.value })
                }
                className="rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={backtestConfig.endDate}
                min={backtestConfig.startDate}
                aria-label="回测结束日期"
                onChange={(event) =>
                  onBacktestConfigChange({ ...backtestConfig, endDate: event.target.value })
                }
                className="rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm"
              />
            </div>
            {backtestConfig.dataSource === "bitget_public" && (
              <p className="mt-1.5 text-[11px] leading-4 text-[var(--faint)]">
                Bitget 将按所选区间查询，最多返回上方设置的 K 线数量。
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <h3 className="mb-3 text-sm font-bold">策略参数</h3>
        <div className="grid grid-cols-2 gap-3">
          {codeParams.length ? (
            codeParams.map((param) => (
              <label key={param.id} className="text-xs text-[var(--muted)]">
                {param.displayName}
                <input
                  type="number"
                  value={param.currentValue as number}
                  min={param.range?.min}
                  max={param.range?.max}
                  step={param.type === "float" ? "0.1" : "1"}
                  readOnly={!editable}
                  onChange={(event) =>
                    onParamChange(artifact.id, param.id, Number(event.target.value))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                />
              </label>
            ))
          ) : (
            <div className="col-span-2 rounded-lg border border-dashed border-[var(--line)] py-5 text-center text-sm text-[var(--muted)]">
              暂无 `# @param:` 参数标记
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AgentWorkflowPanel({ artifact }: { artifact: CodePackageArtifact }) {
  const decision = artifact.plannerDecision;
  const codeAgent = artifact.codeAgentResult;
  const validation = artifact.codeValidation;
  const trace = artifact.agentTrace || [];
  const toolTrace = artifact.toolTrace || [];
  if (!decision && !codeAgent && !validation && !trace.length && !toolTrace.length) return null;

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Bot size={16} className="text-[var(--accent)]" />
          Agent Activity
        </div>
        {artifact.framework && (
          <span className="rounded-full border border-[var(--line)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]">
            {artifact.framework}
          </span>
        )}
      </div>

      {!decision && !codeAgent && (
        <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
            <div className="mb-1 text-[var(--muted)]">Agent</div>
            <div className="font-semibold">{artifact.agent || "StrategyLabAgent"}</div>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
            <div className="mb-1 text-[var(--muted)]">Model</div>
            <div className="truncate font-semibold">{artifact.llmModel || artifact.llmProvider || "--"}</div>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
            <div className="mb-1 text-[var(--muted)]">Code Source</div>
            <div className="font-semibold">{artifact.codeSource || "strategy_lab_agent"}</div>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
            <div className="mb-1 text-[var(--muted)]">Validator</div>
            <div className="font-semibold">{validation?.status || "--"}</div>
          </div>
        </div>
      )}

      {decision && (
        <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
            <div className="mb-1 text-[var(--muted)]">Planner Intent</div>
            <div className="font-semibold">{decision.intent || "--"}</div>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
            <div className="mb-1 text-[var(--muted)]">Strategy Family</div>
            <div className="font-semibold">{decision.strategy_family || "--"}</div>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
            <div className="mb-1 text-[var(--muted)]">Planner Source</div>
            <div className="font-semibold">{decision.planner_source || "--"}</div>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
            <div className="mb-1 text-[var(--muted)]">Model</div>
            <div className="truncate font-semibold">{decision.llm_model || decision.llm_provider || "--"}</div>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
            <div className="mb-1 text-[var(--muted)]">Code Source</div>
            <div className="font-semibold">{codeAgent?.code_source || "--"}</div>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--background)] p-3">
            <div className="mb-1 text-[var(--muted)]">Validator</div>
            <div className="font-semibold">{validation?.status || "--"}</div>
          </div>
        </div>
      )}

      {decision?.llm_warning && (
        <div className="mb-4 rounded-lg border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {decision.llm_warning}
        </div>
      )}
      {codeAgent?.llm_warning && (
        <div className="mb-4 rounded-lg border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {codeAgent.llm_warning}
        </div>
      )}
      {!!validation?.errors?.length && (
        <div className="mb-4 rounded-lg border border-red-300/40 bg-red-50 px-3 py-2 text-xs text-red-700">
          {validation.errors.slice(0, 3).join("；")}
        </div>
      )}
      {!!validation?.warnings?.length && (
        <div className="mb-4 rounded-lg border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {validation.warnings.slice(0, 2).join("；")}
        </div>
      )}

      {trace.length > 0 && (
        <div className="space-y-2">
          {trace.map((item, index) => (
            <div key={`${item.agent}-${item.step}-${index}`} className="flex gap-3 text-xs">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
                <CheckCircle2 size={13} />
              </div>
              <div className="min-w-0">
                <div className="font-semibold">
                  {item.agent} · {item.step}
                </div>
                <div className="mt-0.5 text-[var(--muted)]">{item.summary}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {toolTrace.length > 0 && (
        <div className="space-y-2">
          {toolTrace.map((item, index) => (
            <div key={`${item.tool}-${index}`} className="flex gap-3 text-xs">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
                <CheckCircle2 size={13} />
              </div>
              <div className="min-w-0">
                <div className="font-semibold">{item.tool}</div>
                <div className="mt-0.5 text-[var(--muted)]">{item.summary || item.status}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PerformanceTab({ artifact }: { artifact: BacktestRunArtifact }) {
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-5 text-lg font-bold">收益概况</h2>
        <div className="grid grid-cols-5 gap-4">
          <MetricCell label="累计收益" value={`${formatNumber(artifact.metrics.totalReturn)}%`} tone="danger" />
          <MetricCell label="年化收益" value={`${formatNumber(artifact.metrics.annualReturn)}%`} tone="danger" />
          <MetricCell label="夏普比率" value={formatNumber(artifact.metrics.sharpe)} />
          <MetricCell label="最大回撤" value={`${formatNumber(artifact.metrics.maxDrawdown)}%`} />
          <MetricCell label="胜率" value={`${formatNumber(artifact.metrics.winRate)}%`} />
        </div>
      </section>
      <CumulativeReturnChart data={artifact.charts} />
      <DrawdownChart data={artifact.charts} />
      <MonthlyReturnChart data={artifact.monthlyReturns} />
      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold">
          <CheckCircle2 size={16} className="text-[var(--success)]" />
          风险建议
        </div>
        <ul className="space-y-2 text-sm text-[var(--muted)]">
          {artifact.metrics.recommendations.map((item, index) => (
            <li key={index}>• {item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function LogsTab({ artifact }: { artifact: StrategyArtifact }) {
  const logs =
    artifact.type === "backtest_run"
      ? artifact.logs
      : [
          {
            time: artifact.createdAt,
            level: "INFO" as const,
            message: artifact.explanation,
          },
        ];

  return (
    <section>
      <h2 className="mb-4 text-lg font-bold">运行日志</h2>
      <div className="rounded-lg border border-[var(--line)] bg-[#101114] p-4 font-mono text-xs leading-6 text-slate-200">
        {logs.map((log, index) => (
          <div key={index}>
            <span className="text-slate-500">[{log.time}]</span>{" "}
            <span className={log.level === "ERROR" ? "text-red-400" : log.level === "WARN" ? "text-amber-300" : "text-slate-400"}>
              {log.level}:
            </span>{" "}
            <span>{log.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DataTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-[var(--line)]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[var(--panel-muted)] text-xs text-[var(--muted)]">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 text-left font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-[var(--line)]">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-3">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-8 text-center text-[var(--muted)]" colSpan={columns.length}>
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <div>
      <div className={`text-xl font-black ${tone === "danger" ? "text-[var(--danger)]" : ""}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-[var(--muted)]">{label}</div>
    </div>
  );
}

function Pill({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--background)] px-2 py-1">
      {icon}
      {children}
    </span>
  );
}

function AnalysisTab({
  analysisResult,
  isAnalyzing,
  metrics,
}: {
  analysisResult: {
    isSatisfactory: boolean;
    diagnosis: string;
    recommendations: string[];
    metricsSummary: string;
    shouldOptimize: boolean;
    suggestedParams: Record<string, unknown>;
  } | null;
  isAnalyzing: boolean;
  metrics: {
    totalReturn: number;
    tradeCount: number;
    sharpe: number;
    maxDrawdown: number;
    winRate: number;
  };
}) {
  if (isAnalyzing) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="mx-auto animate-spin text-[var(--primary)]" />
          <div className="mt-3 text-sm text-[var(--muted)]">正在分析回测结果...</div>
        </div>
      </div>
    );
  }

  if (!analysisResult) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-sm text-[var(--muted)]">
          <Brain size={32} className="mx-auto mb-3 opacity-50" />
          点击"分析回测"按钮，让 Analysis Agent 诊断策略问题
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* 诊断结果 */}
      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-3 mb-4">
          {analysisResult.isSatisfactory ? (
            <CheckCircle2 size={20} className="text-green-500" />
          ) : (
            <AlertCircle size={20} className="text-[var(--danger)]" />
          )}
          <h3 className="text-lg font-bold">诊断结果</h3>
        </div>
        <p className="text-sm leading-relaxed text-[var(--foreground)]">
          {analysisResult.diagnosis}
        </p>
      </section>

      {/* 当前指标 */}
      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
        <h3 className="mb-3 text-sm font-bold text-[var(--muted)]">当前回测指标</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-[var(--muted)]">交易次数</div>
            <div className="text-xl font-bold">{metrics.tradeCount}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--muted)]">总收益</div>
            <div className="text-xl font-bold">{metrics.totalReturn.toFixed(2)}%</div>
          </div>
          <div>
            <div className="text-xs text-[var(--muted)]">夏普比率</div>
            <div className="text-xl font-bold">{metrics.sharpe.toFixed(2)}</div>
          </div>
        </div>
      </section>

      {/* 优化建议 */}
      {analysisResult.recommendations.length > 0 && (
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
          <h3 className="mb-4 text-lg font-bold">优化建议</h3>
          <ul className="space-y-3">
            {analysisResult.recommendations.map((rec, index) => (
              <li key={index} className="flex items-start gap-3">
                <Lightbulb size={16} className="mt-1 text-[var(--accent)]" />
                <span className="text-sm leading-relaxed">{rec}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 建议参数 */}
      {analysisResult.shouldOptimize && Object.keys(analysisResult.suggestedParams).length > 0 && (
        <section className="rounded-lg border border-[var(--accent)] bg-[var(--accent-muted)] p-5">
          <h3 className="mb-3 text-sm font-bold text-[var(--accent)]">建议调整参数</h3>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(analysisResult.suggestedParams).map(([key, value]) => (
              <div key={key} className="text-xs">
                <div className="text-[var(--muted)]">{key}</div>
                <div className="text-sm font-semibold">{String(value)}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function paramsToRecord(params: ExtractedParam[]): Record<string, unknown> {
  return params.reduce<Record<string, unknown>>((acc, param) => {
    acc[param.id] = param.currentValue;
    return acc;
  }, {});
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(Math.abs(value) >= 100 ? 1 : 2);
}

function formatTime(date: Date) {
  return date.toISOString().slice(11, 19);
}
