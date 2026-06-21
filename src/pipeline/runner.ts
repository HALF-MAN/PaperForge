import {
  AgentEventSchema,
  BacktestReportSchema,
  LiveDryRunSchema,
  PaperSessionSchema,
  PipelineRunSchema,
  RiskReportSchema,
  StrategySpecSchema,
  type AgentEvent,
  type BacktestReport,
  type ApprovalDecision,
  type LiveDryRun,
  type PaperSession,
  type PipelineRun,
  type RiskReport,
  type StrategySpec
} from "@/src/domain/schema";
import type { StrategyTemplate } from "@/src/domain/templates";
import type { CompileResult } from "@/src/strategy/custom-compiler";

export type PipelineStepStatus = "pass" | "warn" | "active" | "pending" | "locked" | "block";

export type PipelineStep = {
  id: string;
  name: string;
  status: PipelineStepStatus;
};

export type PipelineResult = {
  run: PipelineRun;
  spec: StrategySpec;
  backtest: BacktestReport;
  risk: RiskReport;
  paper?: PaperSession;
  approval?: ApprovalDecision;
  live?: LiveDryRun;
  events: AgentEvent[];
  steps: PipelineStep[];
};

export type PipelineOptions = {
  withPaper?: boolean;
  approval?: ApprovalDecision;
  backtestOverride?: BacktestReport;
  dataSource?: "deterministic" | "bitget_public" | "mock";
};

export function runTemplatePipeline(template: StrategyTemplate, options: PipelineOptions = {}): PipelineResult {
  const spec = StrategySpecSchema.parse(template.spec);
  const runId = `run_${template.id.replaceAll("-", "_")}`;
  const backtest = BacktestReportSchema.parse(options.backtestOverride ?? buildBacktestReport(spec, template.id));
  const dataNote = options.dataSource === "bitget_public" ? " using Bitget public candles" : "";
  return runSpecPipeline(spec, runId, backtest, `Generated Strategy Spec from ${template.name}${dataNote}.`, options);
}

export function runCustomPipeline(compileResult: CompileResult, options: PipelineOptions = {}): PipelineResult {
  const spec = StrategySpecSchema.parse(compileResult.spec);
  const runId = `run_custom_${spec.id.split("-").slice(-1)[0]}`;
  const backtest = BacktestReportSchema.parse(
    options.backtestOverride ?? buildBacktestReport(spec, spec.tags.includes("rsi") ? "custom-rsi" : "custom-ema")
  );
  const dataNote = options.dataSource === "bitget_public" ? " Bitget public candles were used for backtest." : "";
  const strategyMessage = `Compiled user strategy into ${spec.source}: ${compileResult.notes.join(" ")}${dataNote}`;

  return runSpecPipeline(spec, runId, backtest, strategyMessage, options);
}

function runSpecPipeline(
  spec: StrategySpec,
  runId: string,
  backtest: BacktestReport,
  strategyMessage: string,
  options: PipelineOptions
): PipelineResult {
  const risk = RiskReportSchema.parse(scoreRisk(spec, backtest));
  const paper = options.withPaper && risk.decision !== "BLOCK" ? buildPaperSession(runId, spec, backtest) : undefined;
  const live = paper && options.approval === "approved" ? buildLiveDryRun(runId, spec, risk) : undefined;
  const status = risk.decision === "BLOCK" ? "blocked" : live ? "live_dry_run" : paper ? "awaiting_approval" : "paper_running";

  const run = PipelineRunSchema.parse({
    id: runId,
    status,
    currentAgent: risk.decision === "BLOCK" ? "Risk Agent" : live ? "Live Agent" : paper ? "Human Approval" : "Demo Agent",
    strategyVersionId: spec.id,
    createdAt: "2026-05-30T03:10:00.000Z",
    updatedAt: "2026-05-30T03:18:00.000Z"
  });

  const events = [
    event(runId, "Strategy Agent", "output", strategyMessage),
    event(
      runId,
      "Backtest Agent",
      "decision",
      `Backtest completed for ${spec.symbol} ${spec.timeframe} with ${backtest.tradeCount} simulated trades.`
    ),
    event(runId, "Risk Agent", "risk", `Decision ${risk.decision} with risk score ${risk.riskScore}.`),
    ...(paper
      ? [
          event(
            runId,
            "Demo Agent",
            "order",
            `Paper trading completed with ${paper.orderCount} orders and ${paper.pnlPct}% simulated PnL.`
          )
        ]
      : []),
    ...(paper && options.approval
      ? [
          event(
            runId,
            "Human Approval",
            "decision",
            options.approval === "approved"
              ? "Human approved live dry-run with real order execution disabled."
              : `Human decision: ${options.approval}. Live dry-run remains locked.`
          )
        ]
      : []),
    ...(live
      ? [
          event(
            runId,
            "Live Agent",
            "decision",
            "Live dry-run started with real market data enabled and real order execution disabled."
          )
        ]
      : []),
    event(
      runId,
      "Review Agent",
      "decision",
      buildReviewMessage(risk)
    )
  ].map((item) => AgentEventSchema.parse(item));

  return {
    run,
    spec,
    backtest,
    risk,
    paper,
    approval: options.approval,
    live,
    events,
    steps: buildSteps(risk, Boolean(paper), Boolean(live), options.approval)
  };
}

function buildBacktestReport(spec: StrategySpec, strategyId: string): BacktestReport {
  if (strategyId === "rsi-mean-reversion" || strategyId === "custom-rsi") {
    return {
      totalReturnPct: 9.8,
      maxDrawdownPct: 5.4,
      winRatePct: 61.9,
      tradeCount: 18,
      profitFactor: 1.68,
      averageTradePct: 0.54
    };
  }

  if (spec.source === "custom_spec") {
    const positionPenalty = spec.risk.maxPositionPct > 0.2 ? 4.2 : 0;
    const leveragePenalty = spec.risk.maxLeverage > 1 ? 2.8 : 0;

    return {
      totalReturnPct: Number((14.6 + spec.risk.maxLeverage * 1.2).toFixed(1)),
      maxDrawdownPct: Number((8.2 + positionPenalty + leveragePenalty).toFixed(1)),
      winRatePct: 52.8,
      tradeCount: 27,
      profitFactor: 1.31,
      averageTradePct: 0.47
    };
  }

  return {
    totalReturnPct: 18.4,
    maxDrawdownPct: 9.7,
    winRatePct: 54.2,
    tradeCount: 31,
    profitFactor: 1.42,
    averageTradePct: 0.59
  };
}

function scoreRisk(spec: StrategySpec, backtest: BacktestReport): RiskReport {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  if (spec.risk.maxLeverage > 3) {
    score -= 35;
    issues.push("Leverage is above the safe launch threshold.");
    recommendations.push("Reduce leverage to 3x or lower before paper trading.");
  }

  if (spec.risk.maxPositionPct > 0.15) {
    score -= 12;
    issues.push("Position size is high for a first deployment run.");
    recommendations.push("Reduce max position before live dry-run.");
  }

  if (backtest.maxDrawdownPct > 8) {
    score -= 14;
    issues.push("Max drawdown is close to the balanced profile limit.");
    recommendations.push("Add a volatility filter or tighter kill switch.");
  }

  if (backtest.tradeCount > 28) {
    score -= 8;
    issues.push("Trade frequency increases operational risk during sideways markets.");
    recommendations.push("Require an additional trend confirmation before opening positions.");
  }

  if (!spec.risk.stopLossPct) {
    score -= 25;
    issues.push("No stop loss is defined.");
    recommendations.push("Define a stop loss before paper trading.");
  }

  const riskScore = Math.max(0, Math.min(100, score));
  const decision = riskScore < 60 ? "BLOCK" : riskScore < 80 ? "WARN" : "PASS";

  if (recommendations.length === 0) {
    recommendations.push("Proceed to paper trading with read-only market data and audit logging enabled.");
  }

  return {
    decision,
    riskScore,
    issues,
    recommendations
  };
}

function buildPaperSession(runId: string, spec: StrategySpec, backtest: BacktestReport): PaperSession {
  const basePrice = spec.symbol.startsWith("ETH") ? 3600 : 68000;
  const size = Number((10000 * spec.risk.maxPositionPct / basePrice).toFixed(6));
  const pnlPct = Number(Math.max(-6, backtest.averageTradePct * 3.2).toFixed(2));
  const endingBalance = Number((10000 * (1 + pnlPct / 100)).toFixed(2));

  return PaperSessionSchema.parse({
    id: `${runId}_paper`,
    startingBalance: 10000,
    endingBalance,
    pnlPct,
    maxDrawdownPct: Number(Math.min(backtest.maxDrawdownPct * 0.45, spec.risk.killSwitchDrawdownPct ? spec.risk.killSwitchDrawdownPct * 100 : 8).toFixed(2)),
    orderCount: 3,
    status: "completed",
    orders: [
      {
        id: `${runId}_paper_001`,
        symbol: spec.symbol,
        side: "buy",
        price: basePrice,
        size,
        reason: spec.entry.rules[0]?.description ?? "Entry rule matched"
      },
      {
        id: `${runId}_paper_002`,
        symbol: spec.symbol,
        side: "sell",
        price: Number((basePrice * 1.012).toFixed(2)),
        size: Number((size * 0.5).toFixed(6)),
        reason: "Partial take-profit threshold reached"
      },
      {
        id: `${runId}_paper_003`,
        symbol: spec.symbol,
        side: "sell",
        price: Number((basePrice * (1 + pnlPct / 100)).toFixed(2)),
        size: Number((size * 0.5).toFixed(6)),
        reason: spec.exit.rules[0]?.description ?? "Exit rule matched"
      }
    ]
  });
}

function buildLiveDryRun(runId: string, spec: StrategySpec, risk: RiskReport): LiveDryRun {
  return LiveDryRunSchema.parse({
    id: `${runId}_live_dry_run`,
    mode: "live_dry_run",
    status: "monitoring",
    realMarketData: true,
    realOrderExecution: false,
    maxPositionPct: Math.min(spec.risk.maxPositionPct, 0.15),
    killSwitchArmed: true,
    observations: [
      "Reading live market data through exchange adapter.",
      "Order intent is recorded to audit log, not sent to the exchange.",
      `Risk gate remains ${risk.decision}; live execution stays locked until a separate approval.`
    ]
  });
}

function buildSteps(
  risk: RiskReport,
  hasPaper: boolean,
  hasLive: boolean,
  approval?: ApprovalDecision
): PipelineStep[] {
  const riskStatus = risk.decision === "PASS" ? "pass" : risk.decision === "WARN" ? "warn" : "block";
  const blocked = risk.decision === "BLOCK";
  const approvalStatus: PipelineStepStatus = blocked
    ? "locked"
    : hasLive
      ? "pass"
      : approval && approval !== "approved"
        ? "block"
        : hasPaper
          ? "active"
          : "pending";

  return [
    { id: "strategy", name: "Strategy", status: "pass" },
    { id: "backtest", name: "Backtest", status: "pass" },
    { id: "risk", name: "Risk", status: riskStatus },
    { id: "demo", name: "Demo", status: blocked ? "locked" : hasPaper ? "pass" : "active" },
    { id: "review", name: "Review", status: blocked ? "locked" : hasPaper ? "pass" : "pending" },
    { id: "approval", name: "Approval", status: approvalStatus },
    { id: "live", name: "Live Dry-Run", status: hasLive ? "active" : "locked" }
  ];
}

function buildReviewMessage(risk: RiskReport): string {
  if (risk.decision === "PASS") {
    return "Recommended paper trading, then human-approved live dry-run.";
  }

  if (risk.decision === "WARN") {
    return "Paper trading is required before human approval. Apply recommendations before live dry-run.";
  }

  return "Deployment blocked. Strategy must be revised before paper trading.";
}

function event(runId: string, agent: string, type: AgentEvent["type"], message: string): AgentEvent {
  return {
    id: `${runId}_${agent.toLowerCase().replaceAll(" ", "_")}`,
    runId,
    agent,
    type,
    message,
    createdAt: "2026-05-30T03:18:00.000Z"
  };
}
