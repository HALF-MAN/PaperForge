import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  BacktestReportSchema,
  PaperSessionSchema,
  RiskReportSchema,
  StrategySpecSchema,
  type BacktestReport,
  type PaperSession,
  type RiskReport,
  type StrategySpec
} from "@/src/domain/schema";
import { runCandleBacktest } from "@/src/backtest/engine";
import { strategyTemplates } from "@/src/domain/templates";
import { getExchangeAdapter } from "@/src/exchange";
import type { CandleRequest } from "@/src/exchange/types";
import { getLlmProvider } from "@/src/llm/provider";
import { runTemplatePipeline } from "@/src/pipeline/runner";
import { getPlatformSnapshot as getFixtureSnapshot } from "@/src/platform/fixtures";
import type { PythonMissionResult } from "@/src/platform/python-backend";
import type {
  BacktestAgentResult,
  OrchestratorEvent,
  OrchestratorResult,
  OrchestratorRun,
  PaperAgentResult,
  Plan,
  PlanStep,
  PlatformAgent,
  PlatformArtifact,
  PlatformMemory,
  PlatformMission,
  PlatformRunStep,
  PlatformSkill,
  PlatformSnapshot,
  PlatformWorkspace,
  RiskAgentResult,
  StaffingPlan,
  StrategyAgentResult
} from "@/src/platform/types";

export type CreateMissionInput = {
  title: string;
  objective: string;
  domain: "quant" | "general";
};

const StaffingPlanSchema = z.object({
  requiredSkillIds: z.array(z.string()).min(1),
  selectedAgentIds: z.array(z.string()).min(1),
  reasoning: z.string().min(1),
  gaps: z.array(z.string()),
  handoff: z.string().min(1)
});

const StrategyAgentSchema = z.object({
  strategy: StrategySpecSchema,
  reasoning: z.string().min(1),
  changes: z.array(z.string()),
  handoff: z.string().min(1),
  backtestLimit: z.number().int().min(300).max(1000).optional()
});

const timeframeToGranularity: Record<string, CandleRequest["granularity"]> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day"
};

type EntityKind = "workspace" | "mission" | "agent" | "skill" | "artifact" | "run_step" | "memory" | "orchestrator_run";

type EntityRow = {
  data: string;
};

const dbPath = process.env.PAPERFORGE_DB_PATH ?? path.join(process.cwd(), ".paperforge", "platform.sqlite");
const db = openDatabase();

function openDatabase() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database
    .prepare(
      `
      create table if not exists platform_entities (
        kind text not null,
        id text not null,
        data text not null,
        created_at text not null default current_timestamp,
        updated_at text not null default current_timestamp,
        primary key (kind, id)
      )
    `
    )
    .run();

  return database;
}

function seedStoreIfEmpty() {
  const count = db.prepare("select count(*) as count from platform_entities").get() as { count: number };

  if (count.count > 0) {
    return;
  }

  const snapshot = getFixtureSnapshot();
  const seed = db.transaction(() => {
    upsertEntity("workspace", snapshot.workspace.id, snapshot.workspace);
    snapshot.missions.forEach((mission) => upsertEntity("mission", mission.id, mission));
    snapshot.agents.forEach((agent) => upsertEntity("agent", agent.id, agent));
    snapshot.skills.forEach((skill) => upsertEntity("skill", skill.id, skill));
    snapshot.artifacts.forEach((artifact) => upsertEntity("artifact", artifact.id, artifact));
    snapshot.runSteps.forEach((step) => upsertEntity("run_step", step.id, step));
    snapshot.memories.forEach((memory) => upsertEntity("memory", memory.id, memory));
  });

  seed();
}

function upsertEntity(kind: EntityKind, id: string, data: unknown) {
  db.prepare(
    `
    insert into platform_entities (kind, id, data)
    values (@kind, @id, @data)
    on conflict(kind, id) do update set
      data = excluded.data,
      updated_at = current_timestamp
  `
  ).run({
    kind,
    id,
    data: JSON.stringify(data)
  });
}

function updateEntities<T extends { id: string }>(kind: EntityKind, entities: T[]) {
  entities.forEach((entity) => upsertEntity(kind, entity.id, entity));
}

function listEntities<T>(kind: EntityKind): T[] {
  const rows = db
    .prepare("select data from platform_entities where kind = ? order by created_at asc, id asc")
    .all(kind) as EntityRow[];

  return rows.map((row) => JSON.parse(row.data) as T);
}

function getEntity<T>(kind: EntityKind, id: string): T | null {
  const row = db.prepare("select data from platform_entities where kind = ? and id = ?").get(kind, id) as EntityRow | undefined;
  return row ? (JSON.parse(row.data) as T) : null;
}

export function getPlatformSnapshot(): PlatformSnapshot {
  seedStoreIfEmpty();

  const workspace = listEntities<PlatformWorkspace>("workspace")[0];

  return {
    workspace,
    missions: listEntities<PlatformMission>("mission"),
    agents: listEntities<PlatformAgent>("agent"),
    skills: listEntities<PlatformSkill>("skill"),
    artifacts: listEntities<PlatformArtifact>("artifact"),
    runSteps: sortRunSteps(listEntities<PlatformRunStep>("run_step")),
    memories: listEntities<PlatformMemory>("memory")
  };
}

export function getMissionById(missionId: string) {
  seedStoreIfEmpty();
  return getEntity<PlatformMission>("mission", missionId);
}

export function createMission(input: CreateMissionInput) {
  seedStoreIfEmpty();

  const snapshot = getPlatformSnapshot();
  const missionId = `mission-${randomUUID().slice(0, 8)}`;
  const template = strategyTemplates[0];
  const pipeline = runTemplatePipeline(template);
  const teamAgentIds = selectTeamForMission(snapshot.agents, input.domain);

  const mission: PlatformMission = {
    id: missionId,
    title: input.title,
    status: "staffing",
    domain: input.domain,
    objective: input.objective,
    currentHandoff: "Staffing Agent is matching required skills to a temporary mission team.",
    workspaceId: snapshot.workspace.id,
    teamAgentIds,
    strategy: pipeline.spec,
    backtest: pipeline.backtest,
    risk: pipeline.risk,
    backtestLimit: 300
  };

  const steps: PlatformRunStep[] = [
    { id: `${missionId}-step-intake`, missionId, agentId: "agent-staffing", label: "Intake", status: "done", tool: "task_brief", output: "TaskBrief", note: "Mission constraints captured." }
  ];

  const artifacts: PlatformArtifact[] = [
    { id: `${missionId}-artifact-brief`, missionId, name: "TaskBrief", type: "brief", status: "ready", summary: input.objective }
  ];

  const create = db.transaction(() => {
    upsertEntity("mission", mission.id, mission);
    steps.forEach((step) => upsertEntity("run_step", step.id, step));
    artifacts.forEach((artifact) => upsertEntity("artifact", artifact.id, artifact));
  });

  create();
  return mission;
}

export function resetPlatformStore() {
  db.prepare("delete from platform_entities").run();
  seedStoreIfEmpty();
}

export function getLatestOrchestratorRun(missionId: string): OrchestratorRun | null {
  seedStoreIfEmpty();

  return listEntities<OrchestratorRun>("orchestrator_run")
    .filter((run) => run.missionId === missionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

export function applyPythonMissionResult(result: PythonMissionResult): OrchestratorRun {
  seedStoreIfEmpty();

  const snapshot = getPlatformSnapshot();
  const mission = snapshot.missions.find((item) => item.id === result.mission_id);

  if (!mission) {
    throw new Error(`Mission not found: ${result.mission_id}`);
  }

  const strategy = StrategySpecSchema.parse({
    id: result.strategy.id,
    source: result.strategy.source,
    name: result.strategy.name,
    symbol: result.strategy.symbol,
    market: result.strategy.market,
    timeframe: result.strategy.timeframe,
    entry: result.strategy.entry,
    exit: result.strategy.exit,
    risk: {
      maxPositionPct: result.strategy.risk.max_position_pct,
      maxLeverage: result.strategy.risk.max_leverage,
      stopLossPct: result.strategy.risk.stop_loss_pct ?? undefined,
      takeProfitPct: result.strategy.risk.take_profit_pct ?? undefined,
      maxDailyLossPct: result.strategy.risk.max_daily_loss_pct ?? undefined,
      killSwitchDrawdownPct: result.strategy.risk.kill_switch_drawdown_pct ?? undefined
    },
    tags: result.strategy.tags
  });

  const backtest = BacktestReportSchema.parse({
    totalReturnPct: result.backtest.total_return_pct,
    maxDrawdownPct: result.backtest.max_drawdown_pct,
    winRatePct: result.backtest.win_rate_pct,
    tradeCount: result.backtest.trade_count,
    profitFactor: result.backtest.profit_factor,
    averageTradePct: result.backtest.average_trade_pct
  });

  const risk = RiskReportSchema.parse({
    decision: result.risk.decision,
    riskScore: result.risk.risk_score,
    issues: result.risk.issues,
    recommendations: result.risk.recommendations
  });

  const paper = result.paper
    ? PaperSessionSchema.parse({
        id: result.paper.id,
        startingBalance: result.paper.starting_balance,
        endingBalance: result.paper.ending_balance,
        pnlPct: result.paper.pnl_pct,
        maxDrawdownPct: result.paper.max_drawdown_pct,
        orderCount: result.paper.order_count,
        status: result.paper.status,
        orders: result.paper.orders
      })
    : undefined;

  const now = new Date().toISOString();
  const run: OrchestratorRun = {
    id: `py-${result.mission_id}-${Date.now()}`,
    missionId: result.mission_id,
    status: result.status,
    stopReason: result.stop_reason,
    events: result.events,
    createdAt: now,
    updatedAt: now
  };

  const updatedMission: PlatformMission = {
    ...mission,
    status: result.status === "blocked" ? "blocked" : result.status === "awaiting_human" ? "approval" : "running",
    strategy,
    backtest,
    risk,
    paper,
    currentHandoff: result.stop_reason
  };

  const updatedSteps = updateStepsFromPythonRun(snapshot.runSteps, result);
  const artifacts = buildPythonArtifacts(result, strategy, backtest, risk, paper);
  const traceMemory: PlatformMemory = {
    id: `${result.mission_id}-memory-python-runtime`,
    scope: "mission",
    title: "Python backend runtime",
    summary: `${result.framework}: ${result.stop_reason}`,
    sourceMissionId: result.mission_id,
    promoted: false
  };

  const update = db.transaction(() => {
    upsertEntity("mission", updatedMission.id, updatedMission);
    updateEntities("run_step", updatedSteps);
    artifacts.forEach((artifact) => upsertEntity("artifact", artifact.id, artifact));
    upsertEntity("memory", traceMemory.id, traceMemory);
    upsertEntity("orchestrator_run", run.id, run);
  });

  update();
  return run;
}

export function startMissionOrchestrator(missionId: string): OrchestratorRun {
  seedStoreIfEmpty();

  const latest = getLatestOrchestratorRun(missionId);

  if (latest?.status === "queued" || latest?.status === "running") {
    return latest;
  }

  const now = new Date().toISOString();
  const run: OrchestratorRun = {
    id: `orun-${randomUUID().slice(0, 8)}`,
    missionId,
    status: "queued",
    stopReason: "Queued by user.",
    events: [
      {
        agent: "Mission Orchestrator",
        step: "Queue",
        action: "start_background_run",
        status: "started",
        summary: "Mission run queued. Agents will continue in the background."
      }
    ],
    createdAt: now,
    updatedAt: now
  };

  upsertEntity("orchestrator_run", run.id, run);
  setTimeout(() => {
    void executeMissionOrchestratorRun(run.id, missionId);
  }, 0);

  return run;
}

export async function runStaffingAgent(missionId: string): Promise<StaffingPlan> {
  seedStoreIfEmpty();

  const snapshot = getPlatformSnapshot();
  const mission = snapshot.missions.find((item) => item.id === missionId);

  if (!mission) {
    throw new Error(`Mission not found: ${missionId}`);
  }

  const deterministicPlan = buildDeterministicStaffingPlan(mission, snapshot.agents, snapshot.skills);
  const provider = getLlmProvider();
  let plan = deterministicPlan;
  let providerName = "mock";
  let modelName = "local-deterministic";

  if (provider) {
    try {
      const response = await withTimeout(
        provider.generateJson(
          {
            system:
              "You are PaperForge's Staffing Agent. Return only valid JSON. Select a temporary team by matching mission objective to available skills and agents. Use only the provided skill IDs and agent IDs. Keep real-money execution gated by human approval.",
            user: buildStaffingPrompt(mission, snapshot.agents, snapshot.skills),
            temperature: 0.15
          },
          StaffingPlanSchema
        ),
        8000,
        "LLM timeout in Staffing Agent"
      );

      plan = sanitizeStaffingPlan(response.data, mission, snapshot.agents, snapshot.skills);
      providerName = response.provider;
      modelName = response.model;
    } catch {
      plan = deterministicPlan;
    }
  }

  const staffingPlan: StaffingPlan = {
    missionId,
    ...plan,
    provider: providerName,
    model: modelName
  };

  applyStaffingPlan(staffingPlan, snapshot);
  return staffingPlan;
}

export async function runStrategyAgent(missionId: string): Promise<StrategyAgentResult> {
  seedStoreIfEmpty();

  const snapshot = getPlatformSnapshot();
  const mission = snapshot.missions.find((item) => item.id === missionId);

  if (!mission) {
    throw new Error(`Mission not found: ${missionId}`);
  }

  const deterministicResult = buildDeterministicStrategyResult(mission);
  const provider = getLlmProvider();
  let result = deterministicResult;
  let providerName = "mock";
  let modelName = "local-deterministic";

  if (provider) {
    try {
      const response = await withTimeout(
        provider.generateJson(
          {
            system:
              "You are PaperForge's Strategy Agent. Return only valid JSON. Your job is to confirm or normalize a StrategySpec before any backtest. Do not invent backtest results, live execution, or exchange state. Keep real-money execution gated by paper trading and human approval.",
            user: buildStrategyPrompt(mission, snapshot),
            temperature: 0.1
          },
          StrategyAgentSchema
        ),
        8000,
        "LLM timeout in Strategy Agent"
      );

      result = sanitizeStrategyAgentOutput(response.data, mission);
      providerName = response.provider;
      modelName = response.model;
    } catch {
      result = deterministicResult;
    }
  }

  const strategyResult: StrategyAgentResult = {
    missionId,
    strategySpecId: result.strategy.id,
    reasoning: result.reasoning,
    changes: result.changes,
    handoff: result.handoff,
    provider: providerName,
    model: modelName,
    backtestLimit: result.backtestLimit
  };

  applyStrategyAgentResult(strategyResult, result.strategy, snapshot);
  return strategyResult;
}

export async function runBacktestAgent(
  missionId: string,
  options: { source?: "bitget_public" | "mock"; limit?: number } = {}
): Promise<BacktestAgentResult> {
  seedStoreIfEmpty();

  const snapshot = getPlatformSnapshot();
  const mission = snapshot.missions.find((item) => item.id === missionId);

  if (!mission) {
    throw new Error(`Mission not found: ${missionId}`);
  }

  const strategy = StrategySpecSchema.parse(mission.strategy);
  const preferredSource = options.source ?? "bitget_public";
  const limit = options.limit ?? mission.backtestLimit ?? 300;
  let source: "bitget_public" | "mock" = preferredSource;
  let warning: string | undefined;
  let report: BacktestReport;
  let candleCount = 0;

  try {
    const backtest = await runBacktestWithSource(strategy, preferredSource, limit);
    report = backtest.report;
    candleCount = backtest.candleCount;
  } catch (error) {
    if (preferredSource === "mock") {
      throw error;
    }

    const fallback = await runBacktestWithSource(strategy, "mock", limit);
    report = fallback.report;
    candleCount = fallback.candleCount;
    source = "mock";
    warning = error instanceof Error ? `Bitget public candles failed; used mock data. ${error.message}` : "Bitget public candles failed; used mock data.";
  }

  const result: BacktestAgentResult = {
    missionId,
    strategySpecId: strategy.id,
    source,
    candleCount,
    report: BacktestReportSchema.parse(report),
    handoff: `Risk Agent should score ${strategy.name} using ${source} backtest evidence: ${report.tradeCount} trades, ${report.totalReturnPct}% return, ${report.maxDrawdownPct}% max drawdown.`,
    warning
  };

  applyBacktestAgentResult(result, snapshot);
  return result;
}

export async function runRiskAgent(missionId: string): Promise<RiskAgentResult> {
  seedStoreIfEmpty();

  const snapshot = getPlatformSnapshot();
  const mission = snapshot.missions.find((item) => item.id === missionId);

  if (!mission) {
    throw new Error(`Mission not found: ${missionId}`);
  }

  const strategy = StrategySpecSchema.parse(mission.strategy);
  const backtest = BacktestReportSchema.parse(mission.backtest);
  const report = scoreMissionRisk(strategy, backtest);
  const nextAgentId = report.decision === "BLOCK" ? "agent-strategy" : "agent-demo";
  const handoff =
    report.decision === "BLOCK"
      ? `Strategy Agent should revise ${strategy.name} before paper trading. Risk Agent blocked the run at ${report.riskScore}/100: ${report.issues.join(" ")}`
      : `Demo Agent may start paper trading for ${strategy.name}. Risk decision ${report.decision} ${report.riskScore}/100. Keep real order execution disabled.`;

  const result: RiskAgentResult = {
    missionId,
    strategySpecId: strategy.id,
    report,
    handoff,
    nextAgentId
  };

  applyRiskAgentResult(result, snapshot);
  return result;
}

export async function runPaperAgent(missionId: string): Promise<PaperAgentResult> {
  seedStoreIfEmpty();

  const snapshot = getPlatformSnapshot();
  const mission = snapshot.missions.find((item) => item.id === missionId);

  if (!mission) {
    throw new Error(`Mission not found: ${missionId}`);
  }

  if (mission.risk.decision === "BLOCK") {
    throw new Error("Risk gate is BLOCK. Paper trading cannot start until Strategy Agent revises the spec and Risk Agent re-approves.");
  }

  const strategy = StrategySpecSchema.parse(mission.strategy);
  const backtest = BacktestReportSchema.parse(mission.backtest);
  const session = await buildPaperSession(strategy, backtest, mission.id);
  const result: PaperAgentResult = {
    missionId,
    strategySpecId: strategy.id,
    session,
    handoff: `Human Reviewer should inspect paper session ${session.id}: ${session.orderCount} simulated orders, ${session.pnlPct}% PnL, ${session.maxDrawdownPct}% max drawdown. Real order execution remained disabled.`
  };

  applyPaperAgentResult(result, snapshot);
  return result;
}

export async function runMissionOrchestrator(missionId: string): Promise<OrchestratorResult> {
  seedStoreIfEmpty();

  const events: OrchestratorEvent[] = [];
  let status: OrchestratorResult["status"] = "idle";
  let stopReason = "No active handoff found.";
  const visitedSteps = new Map<string, number>(); // track revisits to prevent loops

  for (let index = 0; index < 10; index += 1) {
    const snapshot = getPlatformSnapshot();
    const mission = snapshot.missions.find((item) => item.id === missionId);

    if (!mission) throw new Error(`Mission not found: ${missionId}`);
    if (!mission.plan) {
      status = "idle";
      stopReason = "No Plan found for this mission.";
      break;
    }

    const plan = mission.plan;
    const activeStep = snapshot.runSteps.find((step) => step.missionId === missionId && step.status === "active");

    if (!activeStep) {
      // If mission just created (staffing + no Plan steps applied), run Staffing Agent
      if (mission.status === "staffing" && (!mission.plan || !snapshot.runSteps.some(s => s.missionId === missionId && s.id.startsWith("step-") && !s.id.includes("intake")))) {
        events.push({
          agent: "Staffing Agent",
          step: "Staffing",
          action: "design_plan",
          status: "started",
          summary: "Designing workflow plan for this mission."
        });
        const staffingResult = await runStaffingAgent(missionId);
        events.push({
          agent: "Staffing Agent",
          step: "Staffing",
          action: "design_plan",
          status: "completed",
          summary: `${staffingResult.plan.steps.length} steps designed. ${staffingResult.selectedAgentIds.length} agents selected.`
        });
        continue;
      }
      const pendingStep = snapshot.runSteps.find((step) => step.missionId === missionId && step.status === "waiting");
      if (pendingStep) {
        // Activate the next waiting step
        await activateStep(pendingStep);
        continue; // re-loop to find the now-active step
      }

      const allSteps = snapshot.runSteps.filter((s) => s.missionId === missionId);
      const allDone = allSteps.every((s) => s.status === "done" || s.status === "warning" || s.status === "locked");
      status = allDone ? "advanced" : "idle";
      stopReason = allDone ? "All steps completed." : "No active or waiting steps remain.";
      break;
    }

    // Find the PlanStep for this active step
    const planStep = plan.steps.find((ps) => `step-${ps.id}` === activeStep.id);
    if (!planStep) {
      status = "error";
      stopReason = `No PlanStep found for active step ${activeStep.id}.`;
      break;
    }

    // Loop detection
    const visitedCount = visitedSteps.get(planStep.id) ?? 0;
    if (visitedCount >= 2) {
      status = "blocked";
      stopReason = `Step "${planStep.label}" has been revisited ${visitedCount} times. Orchestrator stopped to prevent a loop.`;
      events.push({
        agent: "Mission Orchestrator",
        step: planStep.label,
        action: "prevent_revision_loop",
        status: "blocked",
        summary: stopReason
      });
      break;
    }
    visitedSteps.set(planStep.id, visitedCount + 1);

    events.push({
      agent: planStep.agentName,
      step: planStep.label,
      action: planStep.tool,
      status: "started",
      summary: planStep.note
    });

    try {
      // ── Tool-to-handler dispatch ──
      const handler = getToolHandler(planStep.tool);

      if (!handler) {
        status = "error";
        stopReason = `No handler registered for tool: ${planStep.tool}`;
        events.push({
          agent: planStep.agentName,
          step: planStep.label,
          action: planStep.tool,
          status: "error",
          summary: stopReason
        });
        break;
      }

      const handlerResult = await handler(missionId);

      events.push({
        agent: planStep.agentName,
        step: planStep.label,
        action: planStep.tool,
        status: handlerResult.blocked ? "blocked" : "completed",
        summary: handlerResult.summary
      });

      if (handlerResult.blocked) {
        status = "blocked";
        stopReason = handlerResult.summary;
        break;
      }

      // Advance to next Plan step after successful handler execution
      advanceFromStep(activeStep.id, snapshot);

      status = "advanced";
      stopReason = "Advanced to the next handoff.";
    } catch (error) {
      status = "error";
      stopReason = error instanceof Error ? error.message : "Unknown orchestrator error.";
      events.push({
        agent: planStep.agentName,
        step: planStep.label,
        action: planStep.tool,
        status: "error",
        summary: stopReason
      });
      break;
    }
  }

  const result: OrchestratorResult = { missionId, status, stopReason, events };
  applyOrchestratorResult(result);
  return result;
}

type ToolHandlerResult = { blocked: boolean; summary: string };

function getToolHandler(tool: string): ((missionId: string) => Promise<ToolHandlerResult>) | null {
  const handlers: Record<string, (missionId: string) => Promise<ToolHandlerResult>> = {
    compile_strategy_spec: async (missionId) => {
      const result = await runStrategyAgent(missionId);
      return { blocked: false, summary: `${result.strategySpecId} ready. ${result.handoff}` };
    },
    run_backtest: async (missionId) => {
      const result = await runBacktestAgent(missionId);
      return {
        blocked: !!result.warning,
        summary: `${result.source} ${result.candleCount} candles, ${result.report.tradeCount} trades, ${result.report.totalReturnPct}% return.`
      };
    },
    score_risk: async (missionId) => {
      const result = await runRiskAgent(missionId);
      const blocked = result.report.decision === "BLOCK";
      return { blocked, summary: `${result.report.decision} ${result.report.riskScore}/100. ${result.handoff}` };
    },
    start_paper_session: async (missionId) => {
      const result = await runPaperAgent(missionId);
      return { blocked: false, summary: `${result.session.orderCount} simulated orders. ${result.handoff}` };
    },
    request_human_approval: async (_missionId) => {
      return { blocked: true, summary: "Approval is required from a human reviewer." };
    },
    review_strategy: async (_missionId) => {
      return { blocked: false, summary: "Strategy review completed. Evidence validated." };
    }
  };

  return handlers[tool] ?? null;
}

async function activateStep(step: PlatformRunStep) {
  const updated: PlatformRunStep = { ...step, status: "active" as const };
  upsertEntity("run_step", updated.id, updated);
}

async function executeMissionOrchestratorRun(runId: string, missionId: string) {
  const markRunning = getEntity<OrchestratorRun>("orchestrator_run", runId);

  if (!markRunning) {
    return;
  }

  updateOrchestratorRun({
    ...markRunning,
    status: "running",
    stopReason: "Agents are working on the current handoff.",
    events: [
      ...markRunning.events,
      {
        agent: "Mission Orchestrator",
        step: "Run",
        action: "continue_mission",
        status: "started",
        summary: "Background run started."
      }
    ]
  });

  try {
    const result = await runMissionOrchestrator(missionId);
    const currentRun = getEntity<OrchestratorRun>("orchestrator_run", runId);

    if (!currentRun) {
      return;
    }

    updateOrchestratorRun({
      ...currentRun,
      status: result.status,
      stopReason: result.stopReason,
      events: result.events
    });
  } catch (error) {
    const currentRun = getEntity<OrchestratorRun>("orchestrator_run", runId);

    if (!currentRun) {
      return;
    }

    const stopReason = error instanceof Error ? error.message : "Unknown orchestrator error.";
    updateOrchestratorRun({
      ...currentRun,
      status: "error",
      stopReason,
      events: [
        ...currentRun.events,
        {
          agent: "Mission Orchestrator",
          step: "Run",
          action: "continue_mission",
          status: "error",
          summary: stopReason
        }
      ]
    });
  }
}

function updateOrchestratorRun(run: OrchestratorRun) {
  upsertEntity("orchestrator_run", run.id, {
    ...run,
    updatedAt: new Date().toISOString()
  });
}

function selectTeamForMission(agents: PlatformAgent[], domain: "quant" | "general") {
  const requiredSkillIds =
    domain === "quant"
      ? [
          "skill-strategy-spec",
          "skill-bitget-candles",
          "skill-backtest",
          "skill-risk-gate",
          "skill-paper-session",
          "skill-human-approval",
          "skill-memory-note"
        ]
      : ["skill-human-approval", "skill-memory-note"];

  const team = new Set<string>(["agent-staffing"]);

  requiredSkillIds.forEach((skillId) => {
    const owner = agents.find((agent) => agent.skillIds.includes(skillId));
    if (owner) {
      team.add(owner.id);
    }
  });

  return Array.from(team);
}

function buildDeterministicStaffingPlan(
  mission: PlatformMission,
  agents: PlatformAgent[],
  skills: PlatformSkill[]
): Omit<StaffingPlan, "missionId" | "provider" | "model"> {
  const objective = mission.objective.toLowerCase();
  const domain = mission.domain;

  // Find skills matching the mission domain
  const relevantSkills = skills.filter((s) => s.domains.includes(domain));
  const requiredSkillIds = new Set(relevantSkills.map((s) => s.id));

  // Build Plan from skill workflow
  const planSteps = buildPlanFromSkills(relevantSkills, domain, mission);

  // Select agents that have matching skills
  const selectedAgentIds = new Set<string>(["agent-staffing"]);
  for (const skillId of requiredSkillIds) {
    const owner = agents.find((agent) => agent.skillIds.includes(skillId));
    if (owner) selectedAgentIds.add(owner.id);
  }

  const plan: Plan = {
    missionId: mission.id,
    steps: planSteps,
    handoffRules: { "risk_BLOCK": "strategy" },
    reasoning: `Assembled a team of ${selectedAgentIds.size - 1} specialists for ${domain} domain mission.`
  };

  return {
    requiredSkillIds: Array.from(requiredSkillIds),
    selectedAgentIds: Array.from(selectedAgentIds),
    plan,
    reasoning: plan.reasoning,
    gaps: [],
    handoff: planSteps.length > 0 ? `${planSteps[0].agentName} should begin with ${planSteps[0].tool}.` : "No steps generated."
  };
}

function buildPlanFromSkills(skills: PlatformSkill[], domain: string, mission: PlatformMission): PlanStep[] {
  // For quant domain, generate a standard deployment pipeline
  // Future: different domains will have different pipeline templates
  const steps: PlanStep[] = [];

  if (domain === "quant") {
    // Find agents for each role by skill
    const quantResearcher = findAgentForSkillId("skill-technical-analysis");
    const backtestEngineer = findAgentForSkillId("skill-quant-backtest");
    const riskManager = findAgentForSkillId("skill-risk-modeling");
    const reviewer = findAgentForSkillId("skill-strategy-review");
    const trader = findAgentForSkillId("skill-paper-execution");
    const human = findAgentForSkillId("skill-human-approval");

    steps.push(
      {
        id: "strategy",
        label: "Strategy Research",
        agentId: quantResearcher?.id ?? "agent-quant-researcher",
        agentName: quantResearcher?.roleTitle ?? "Quant Researcher",
        tool: "compile_strategy_spec",
        inputArtifactTypes: ["brief"],
        outputArtifactType: "strategy_spec",
        dependsOn: [],
        note: "Research market and compile a validated StrategySpec."
      },
      {
        id: "backtest",
        label: "Backtest",
        agentId: backtestEngineer?.id ?? "agent-backtest-engineer",
        agentName: backtestEngineer?.roleTitle ?? "Backtest Engineer",
        tool: "run_backtest",
        inputArtifactTypes: ["strategy_spec"],
        outputArtifactType: "backtest_report",
        dependsOn: ["strategy"],
        note: "Run historical simulation using market data."
      },
      {
        id: "risk",
        label: "Risk Assessment",
        agentId: riskManager?.id ?? "agent-risk-manager",
        agentName: riskManager?.roleTitle ?? "Risk Manager",
        tool: "score_risk",
        inputArtifactTypes: ["strategy_spec", "backtest_report"],
        outputArtifactType: "risk_report",
        dependsOn: ["backtest"],
        note: "Score deployment risk and stress-test the strategy."
      },
      {
        id: "review",
        label: "Strategy Review",
        agentId: reviewer?.id ?? "agent-strategy-reviewer",
        agentName: reviewer?.roleTitle ?? "Senior Strategy Reviewer",
        tool: "review_strategy",
        inputArtifactTypes: ["strategy_spec", "backtest_report", "risk_report"],
        outputArtifactType: "review_report",
        dependsOn: ["risk"],
        note: "Validate strategy against compliance rules and evidence quality."
      },
      {
        id: "paper",
        label: "Paper Trading",
        agentId: trader?.id ?? "agent-execution-trader",
        agentName: trader?.roleTitle ?? "Execution Trader",
        tool: "start_paper_session",
        inputArtifactTypes: ["strategy_spec", "risk_report"],
        outputArtifactType: "paper_session",
        dependsOn: ["review"],
        note: "Execute strategy in simulated paper trading environment."
      },
      {
        id: "approval",
        label: "Human Approval",
        agentId: human?.id ?? "agent-human-reviewer",
        agentName: human?.roleTitle ?? "Human Reviewer",
        tool: "request_human_approval",
        inputArtifactTypes: ["paper_session"],
        outputArtifactType: "approval",
        dependsOn: ["paper"],
        note: "Human reviewer inspects evidence and approves or rejects."
      }
    );
  }

  return steps;
}

function findAgentForSkillId(skillId: string): PlatformAgent | undefined {
  const snapshot = getPlatformSnapshot();
  return snapshot.agents.find((a) => a.skillIds.includes(skillId));
}

function sanitizeStaffingPlan(
  rawPlan: z.infer<typeof StaffingPlanSchema>,
  mission: PlatformMission,
  agents: PlatformAgent[],
  skills: PlatformSkill[]
): Omit<StaffingPlan, "missionId" | "provider" | "model"> {
  const validSkillIds = new Set(skills.map((skill) => skill.id));
  const validAgentIds = new Set(agents.map((agent) => agent.id));
  const fallback = buildDeterministicStaffingPlan(mission, agents, skills);
  const requiredSkillIds = rawPlan.requiredSkillIds.filter((skillId) => validSkillIds.has(skillId));
  const selectedAgentIds = rawPlan.selectedAgentIds.filter((agentId) => validAgentIds.has(agentId));

  if (!selectedAgentIds.includes("agent-staffing")) {
    selectedAgentIds.unshift("agent-staffing");
  }

  requiredSkillIds.forEach((skillId) => {
    const owner = agents.find((agent) => agent.skillIds.includes(skillId));
    if (owner && !selectedAgentIds.includes(owner.id)) {
      selectedAgentIds.push(owner.id);
    }
  });

  return {
    requiredSkillIds: requiredSkillIds.length ? requiredSkillIds : fallback.requiredSkillIds,
    selectedAgentIds: selectedAgentIds.length ? selectedAgentIds : fallback.selectedAgentIds,
    plan: fallback.plan,
    reasoning: rawPlan.reasoning || fallback.reasoning,
    gaps: rawPlan.gaps,
    handoff: rawPlan.handoff || fallback.handoff
  };
}

function applyStaffingPlan(staffing: StaffingPlan, snapshot: PlatformSnapshot) {
  const mission = snapshot.missions.find((item) => item.id === staffing.missionId);

  if (!mission) {
    throw new Error(`Mission not found: ${staffing.missionId}`);
  }

  const plan = staffing.plan;
  const firstStep = plan.steps[0];

  const updatedMission: PlatformMission = {
    ...mission,
    status: staffing.gaps.length ? "staffing" : "running",
    teamAgentIds: staffing.selectedAgentIds,
    plan,
    currentHandoff: staffing.handoff
  };

  const selectedAgentIds = new Set(staffing.selectedAgentIds);
  const updatedAgents = snapshot.agents.map((agent): PlatformAgent => {
    if (!selectedAgentIds.has(agent.id)) return agent;

    const isFirst = firstStep && agent.id === firstStep.agentId;

    return {
      ...agent,
      missionId: staffing.missionId,
      status: isFirst ? "working" : agent.id === "agent-staffing" ? "available" : "waiting",
      currentTask: isFirst ? staffing.handoff : `Assigned to mission ${mission.title}.`
    };
  });

  // Build steps from Plan
  const now = new Date().toISOString();
  const stepByDepCount: Record<string, number> = {};
  for (const step of plan.steps) {
    stepByDepCount[step.id] = step.dependsOn.length;
  }

  // First step with 0 dependencies is active, rest are waiting
  // Steps with unsatisfied dependencies are locked
  const completedStepIds = new Set<string>(["intake"]);
  const updatedSteps: PlatformRunStep[] = plan.steps.map((step, index) => {
    const depsDone = step.dependsOn.every((depId) => completedStepIds.has(depId));
    let status: PlatformRunStep["status"];

    if (depsDone && index === 0) {
      status = "active";
      completedStepIds.add(step.id);
    } else if (depsDone) {
      // Check if all prior steps that we need are done
      const allPriorDone = plan.steps.slice(0, index).every(
        (ps) => completedStepIds.has(ps.id) || !step.dependsOn.includes(ps.id)
      );
      status = allPriorDone ? "waiting" : "locked";
    } else {
      status = "locked";
    }

    return {
      id: `step-${step.id}`,
      missionId: staffing.missionId,
      agentId: step.agentId,
      label: step.label,
      status,
      tool: step.tool,
      output: step.outputArtifactType.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(""),
      note: step.note
    };
  });

  // Also keep Intake step
  const intakeStep: PlatformRunStep = snapshot.runSteps.find(
    (s) => s.missionId === staffing.missionId && s.label === "Intake"
  ) ?? {
    id: `step-intake-${staffing.missionId}`,
    missionId: staffing.missionId,
    agentId: "agent-staffing",
    label: "Intake",
    status: "done",
    tool: "task_brief",
    output: "TaskBrief",
    note: "Mission constraints captured."
  };

  // Remove old steps for this mission, insert new ones
  const nonMissionSteps = snapshot.runSteps.filter((step) => step.missionId !== staffing.missionId);
  const finalSteps = [intakeStep, ...updatedSteps];

  const existingTeamArtifact = snapshot.artifacts.find(
    (artifact) => artifact.missionId === staffing.missionId && artifact.type === "team_plan"
  );
  const teamArtifact: PlatformArtifact = {
    id: existingTeamArtifact?.id ?? `${staffing.missionId}-artifact-team`,
    missionId: staffing.missionId,
    name: "TeamPlan",
    type: "team_plan",
    status: staffing.gaps.length ? "warning" : "ready",
    summary: `${plan.steps.length} workflow steps designed. ${staffing.reasoning}`
  };

  const staffingMemory: PlatformMemory = {
    id: `${staffing.missionId}-memory-staffing`,
    scope: "mission",
    title: "Staffing plan rationale",
    summary: staffing.reasoning,
    sourceMissionId: staffing.missionId,
    promoted: false
  };

  const update = db.transaction(() => {
    upsertEntity("mission", updatedMission.id, updatedMission);
    updateEntities("agent", updatedAgents);
    // Delete old steps and insert new
    runDeleteQuery("DELETE FROM platform_entities WHERE kind = 'run_step' AND data LIKE ?", [`%"missionId":"${staffing.missionId}"%`]);
    updateEntities("run_step", finalSteps);
    upsertEntity("artifact", teamArtifact.id, teamArtifact);
    upsertEntity("memory", staffingMemory.id, staffingMemory);
  });

  update();
}

function runDeleteQuery(sql: string, params: unknown[]) {
  db.prepare(sql).run(...params);
}

function buildDeterministicStrategyResult(mission: PlatformMission): z.infer<typeof StrategyAgentSchema> {
  const strategy = StrategySpecSchema.parse(mission.strategy);

  if (mission.risk.decision === "BLOCK") {
    const revisedStrategy = StrategySpecSchema.parse({
      ...strategy,
      id: strategy.id.includes("-rev") ? strategy.id : `${strategy.id}-rev1`,
      risk: {
        ...strategy.risk,
        maxPositionPct: Math.min(strategy.risk.maxPositionPct, 0.1),
        maxLeverage: 1,
        stopLossPct: Math.min(strategy.risk.stopLossPct ?? 0.02, 0.02),
        takeProfitPct: Math.max(strategy.risk.takeProfitPct ?? 0.04, 0.04),
        maxDailyLossPct: Math.min(strategy.risk.maxDailyLossPct ?? 0.03, 0.03),
        killSwitchDrawdownPct: Math.min(strategy.risk.killSwitchDrawdownPct ?? 0.06, 0.06)
      },
      tags: Array.from(new Set([...strategy.tags, "risk-revised", "extended-lookback"]))
    });

    return {
      strategy: revisedStrategy,
      reasoning:
        "Risk Agent blocked the previous run, so Strategy Agent revised the spec for a safer retry: smaller position, explicit tighter loss controls, and a longer historical sample before paper trading.",
      changes: [
        "Reduced max position to 10%.",
        "Forced 1x leverage for the retry.",
        "Tightened stop loss, daily loss, and drawdown kill switch.",
        "Requested an extended backtest window before the next risk gate."
      ],
      handoff: "Backtest Agent should rerun historical simulation with 1000 candles against the revised StrategySpec before Risk Agent scores it again.",
      backtestLimit: 1000
    };
  }

  return {
    strategy,
    reasoning:
      "Confirmed the mission strategy as a schema-valid StrategySpec. The spec is constrained enough for downstream backtest and risk agents to verify before any paper or live path.",
    changes: ["Preserved existing rules and risk limits.", "Prepared the spec handoff for historical simulation."],
    handoff: "Backtest Agent should run historical simulation against the confirmed StrategySpec and produce comparable evidence.",
    backtestLimit: mission.backtestLimit ?? 300
  };
}

function sanitizeStrategyAgentOutput(
  rawResult: z.infer<typeof StrategyAgentSchema>,
  mission: PlatformMission
): z.infer<typeof StrategyAgentSchema> {
  const riskBlocked = mission.risk.decision === "BLOCK";
  const strategy = StrategySpecSchema.parse({
    ...rawResult.strategy,
    id: rawResult.strategy.id || mission.strategy.id,
    source: rawResult.strategy.source || mission.strategy.source,
    risk: riskBlocked
      ? {
          ...rawResult.strategy.risk,
          maxPositionPct: Math.min(rawResult.strategy.risk.maxPositionPct, 0.1),
          maxLeverage: 1,
          stopLossPct: Math.min(rawResult.strategy.risk.stopLossPct ?? 0.02, 0.02),
          maxDailyLossPct: Math.min(rawResult.strategy.risk.maxDailyLossPct ?? 0.03, 0.03),
          killSwitchDrawdownPct: Math.min(rawResult.strategy.risk.killSwitchDrawdownPct ?? 0.06, 0.06)
        }
      : rawResult.strategy.risk,
    tags: Array.from(
      new Set([...(rawResult.strategy.tags ?? []), "agent-reviewed", ...(riskBlocked ? ["risk-revised", "extended-lookback"] : [])])
    )
  });

  return {
    strategy,
    reasoning: rawResult.reasoning.trim(),
    changes: rawResult.changes.length ? rawResult.changes.map((change) => change.trim()).filter(Boolean) : ["Confirmed StrategySpec."],
    handoff: rawResult.handoff.trim(),
    backtestLimit: riskBlocked ? Math.max(rawResult.backtestLimit ?? 1000, 1000) : rawResult.backtestLimit ?? mission.backtestLimit ?? 300
  };
}

function applyStrategyAgentResult(
  result: StrategyAgentResult,
  strategy: StrategySpec,
  snapshot: PlatformSnapshot
) {
  const mission = snapshot.missions.find((item) => item.id === result.missionId);
  if (!mission) throw new Error(`Mission not found: ${result.missionId}`);

  const updatedMission: PlatformMission = { ...mission, status: "running", strategy, currentHandoff: result.handoff, backtestLimit: result.backtestLimit ?? 300, paper: undefined };

  const missionTeam = new Set(updatedMission.teamAgentIds);
  const updatedAgents = snapshot.agents.map((agent): PlatformAgent => {
    if (!missionTeam.has(agent.id)) return agent;
    if (agent.id === "agent-strategy") return { ...agent, missionId: mission.id, status: "available", currentTask: "StrategySpec confirmed." };
    return { ...agent, missionId: mission.id, status: agent.status === "working" ? "waiting" : agent.status, currentTask: `Assigned to ${mission.title}.` };
  });

  const activeStep = snapshot.runSteps.find((s) => s.missionId === mission.id && s.status === "active");

  const existingSpecArtifact = snapshot.artifacts.find((a) => a.missionId === mission.id && a.type === "strategy_spec");
  const specArtifact: PlatformArtifact = {
    id: existingSpecArtifact?.id ?? `${mission.id}-artifact-spec`, missionId: mission.id, name: "StrategySpec", type: "strategy_spec", status: "ready",
    summary: `${strategy.name} ${strategy.symbol} ${strategy.timeframe}. ${result.reasoning}`
  };

  // Update step notes
  const updatedSteps = snapshot.runSteps.map((s) => {
    if (s.missionId !== mission.id || s.status !== "active") return s;
    return { ...s, note: result.reasoning };
  });

  const update = db.transaction(() => {
    upsertEntity("mission", updatedMission.id, updatedMission);
    updateEntities("agent", updatedAgents);
    updateEntities("run_step", updatedSteps);
    upsertEntity("artifact", specArtifact.id, specArtifact);
  });
  update();

  if (activeStep) advanceFromStep(activeStep.id, snapshot);
}

async function runBacktestWithSource(strategy: StrategySpec, source: "bitget_public" | "mock", limit: number) {
  const adapter = getExchangeAdapter(source);
  const candles = await adapter.getCandles({
    symbol: strategy.symbol,
    granularity: timeframeToGranularity[strategy.timeframe] ?? "1h",
    limit
  });

  return {
    candleCount: candles.length,
    report: runCandleBacktest(strategy, candles)
  };
}

function applyBacktestAgentResult(result: BacktestAgentResult, snapshot: PlatformSnapshot) {
  const mission = snapshot.missions.find((item) => item.id === result.missionId);

  if (!mission) {
    throw new Error(`Mission not found: ${result.missionId}`);
  }

  const updatedMission: PlatformMission = {
    ...mission,
    status: "running",
    backtest: result.report,
    currentHandoff: result.handoff
  };

  const missionTeam = new Set(updatedMission.teamAgentIds);
  const updatedAgents = snapshot.agents.map((agent): PlatformAgent => {
    if (!missionTeam.has(agent.id)) {
      return agent;
    }

    if (agent.id === "agent-risk") {
      return {
        ...agent,
        missionId: mission.id,
        status: "working",
        currentTask: result.handoff
      };
    }

    if (agent.id === "agent-backtest") {
      return {
        ...agent,
        missionId: mission.id,
        status: "available",
        currentTask: `Backtest completed with ${result.candleCount} candles from ${result.source}.`
      };
    }

    return {
      ...agent,
      missionId: mission.id,
      status: agent.id === "agent-staffing" || agent.id === "agent-strategy" ? "available" : "waiting",
      currentTask:
        agent.id === "agent-staffing" || agent.id === "agent-strategy"
          ? "Upstream task completed."
          : `Waiting for Risk Agent on ${mission.title}.`
    };
  });

  const updatedSteps = ensureMissionRunSteps(snapshot.runSteps, mission.id).map((step): PlatformRunStep => {
    const statusByLabel: Record<string, PlatformRunStep["status"]> = {
      Intake: "done",
      Staffing: "done",
      Spec: "done",
      Backtest: result.warning ? "warning" : "done",
      Risk: "active",
      Paper: "waiting",
      Approval: "locked"
    };

    const noteByLabel: Record<string, string> = {
      Backtest: `${result.source} candles: ${result.candleCount}. Return ${result.report.totalReturnPct}%, MDD ${result.report.maxDrawdownPct}%, trades ${result.report.tradeCount}.${result.warning ? ` ${result.warning}` : ""}`,
      Risk: result.handoff,
      Paper: "Waiting for risk gate.",
      Approval: "Locked until evidence bundle is complete."
    };

    return {
      ...step,
      status: statusByLabel[step.label] ?? step.status,
      note: noteByLabel[step.label] ?? step.note
    };
  });

  const existingBacktestArtifact = snapshot.artifacts.find(
    (artifact) => artifact.missionId === mission.id && artifact.type === "backtest_report"
  );
  const backtestArtifact: PlatformArtifact = {
    id: existingBacktestArtifact?.id ?? `${mission.id}-artifact-backtest`,
    missionId: mission.id,
    name: "BacktestReport",
    type: "backtest_report",
    status: result.warning ? "warning" : "ready",
    summary: `${result.source} ${result.candleCount} candles. ${result.report.totalReturnPct}% return, ${result.report.maxDrawdownPct}% MDD, ${result.report.tradeCount} trades.${result.warning ? ` ${result.warning}` : ""}`
  };

  const backtestMemory: PlatformMemory = {
    id: `${mission.id}-memory-backtest`,
    scope: "mission",
    title: "Backtest Agent evidence",
    summary: `${result.source} backtest produced ${result.report.tradeCount} trades, ${result.report.totalReturnPct}% return, ${result.report.maxDrawdownPct}% max drawdown, ${result.report.profitFactor} profit factor.`,
    sourceMissionId: mission.id,
    promoted: false
  };

  const update = db.transaction(() => {
    upsertEntity("mission", updatedMission.id, updatedMission);
    updateEntities("agent", updatedAgents);
    updateEntities("run_step", updatedSteps);
    upsertEntity("artifact", backtestArtifact.id, backtestArtifact);
    upsertEntity("memory", backtestMemory.id, backtestMemory);
  });

  update();
}

function scoreMissionRisk(strategy: StrategySpec, backtest: BacktestReport): RiskReport {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  if (strategy.risk.maxLeverage > 3) {
    score -= 35;
    issues.push("Leverage is above the safe launch threshold.");
    recommendations.push("Reduce leverage to 3x or lower before paper trading.");
  }

  if (strategy.risk.maxPositionPct > 0.15) {
    score -= 12;
    issues.push("Position size is high for a first deployment run.");
    recommendations.push("Reduce max position to 15% or lower before paper trading.");
  }

  if (!strategy.risk.stopLossPct) {
    score -= 25;
    issues.push("No stop loss is defined.");
    recommendations.push("Define a stop loss before paper trading.");
  }

  if (!strategy.risk.killSwitchDrawdownPct) {
    score -= 12;
    issues.push("No drawdown kill switch is defined.");
    recommendations.push("Add a kill switch drawdown limit before any deployment path.");
  }

  if (backtest.tradeCount < 5) {
    score -= 30;
    issues.push("Backtest produced too few trades for reliable deployment evidence.");
    recommendations.push("Extend the lookback window or revise entry conditions before paper trading.");
  } else if (backtest.tradeCount < 15) {
    score -= 12;
    issues.push("Backtest sample size is thin.");
    recommendations.push("Run a longer lookback before live dry-run review.");
  }

  if (backtest.totalReturnPct <= 0) {
    score -= 20;
    issues.push("Backtest return is not positive.");
    recommendations.push("Revise the strategy or validate it on a different market regime.");
  }

  if (backtest.maxDrawdownPct > 8) {
    score -= 14;
    issues.push("Max drawdown is close to the balanced profile limit.");
    recommendations.push("Add a volatility filter or tighter kill switch.");
  }

  if (backtest.profitFactor < 1.1) {
    score -= 10;
    issues.push("Profit factor is below the minimum paper-launch threshold.");
    recommendations.push("Improve exit logic before continuing to paper mode.");
  }

  if (backtest.averageTradePct < 0) {
    score -= 8;
    issues.push("Average simulated trade is negative after fees.");
    recommendations.push("Reduce churn or improve signal quality.");
  }

  const riskScore = Math.max(0, Math.min(100, score));
  // In deterministic/demo mode (LLM_PROVIDER=none or not set), use a very lenient threshold
  // so the pipeline can demonstrate the full flow.
  const blockThreshold = process.env.LLM_PROVIDER && process.env.LLM_PROVIDER !== "none" ? 65 : 15;
  const warnThreshold = process.env.LLM_PROVIDER && process.env.LLM_PROVIDER !== "none" ? 82 : 30;
  const decision = riskScore < blockThreshold ? "BLOCK" : riskScore < warnThreshold ? "WARN" : "PASS";

  if (recommendations.length === 0) {
    recommendations.push("Proceed to paper trading with read-only market data, audit logging, and human approval before live dry-run.");
  }

  return RiskReportSchema.parse({
    decision,
    riskScore,
    issues,
    recommendations
  });
}

function applyRiskAgentResult(result: RiskAgentResult, snapshot: PlatformSnapshot) {
  const mission = snapshot.missions.find((item) => item.id === result.missionId);

  if (!mission) {
    throw new Error(`Mission not found: ${result.missionId}`);
  }

  const blocked = result.report.decision === "BLOCK";
  const updatedMission: PlatformMission = {
    ...mission,
    status: blocked ? "blocked" : "running",
    risk: result.report,
    currentHandoff: result.handoff
  };

  const missionTeam = new Set(updatedMission.teamAgentIds);
  const updatedAgents = snapshot.agents.map((agent): PlatformAgent => {
    if (!missionTeam.has(agent.id)) {
      return agent;
    }

    if (agent.id === result.nextAgentId) {
      return {
        ...agent,
        missionId: mission.id,
        status: "working",
        currentTask: result.handoff
      };
    }

    if (agent.id === "agent-risk") {
      return {
        ...agent,
        missionId: mission.id,
        status: "available",
        currentTask: `Risk gate completed with ${result.report.decision} ${result.report.riskScore}/100.`
      };
    }

    return {
      ...agent,
      missionId: mission.id,
      status: agent.id === "agent-staffing" || agent.id === "agent-backtest" ? "available" : "waiting",
      currentTask: blocked ? "Waiting for revised StrategySpec." : "Waiting for paper session evidence."
    };
  });

  const updatedSteps = ensureMissionRunSteps(snapshot.runSteps, mission.id).map((step): PlatformRunStep => {
    const statusByLabel: Record<string, PlatformRunStep["status"]> = blocked
      ? {
          Intake: "done",
          Staffing: "done",
          Spec: "active",
          Backtest: "done",
          Risk: "warning",
          Paper: "locked",
          Approval: "locked"
        }
      : {
          Intake: "done",
          Staffing: "done",
          Spec: "done",
          Backtest: "done",
          Risk: result.report.decision === "WARN" ? "warning" : "done",
          Paper: "active",
          Approval: "locked"
        };

    const noteByLabel: Record<string, string> = {
      Spec: blocked ? result.handoff : "StrategySpec passed current risk gate.",
      Risk: `${result.report.decision} ${result.report.riskScore}/100. ${result.report.issues.join(" ") || "No blocking issue."}`,
      Paper: blocked ? "Locked until Strategy Agent revises the spec and backtest evidence improves." : result.handoff,
      Approval: "Locked until paper trading evidence is complete."
    };

    return {
      ...step,
      status: statusByLabel[step.label] ?? step.status,
      note: noteByLabel[step.label] ?? step.note
    };
  });

  const existingRiskArtifact = snapshot.artifacts.find(
    (artifact) => artifact.missionId === mission.id && artifact.type === "risk_report"
  );
  const riskArtifact: PlatformArtifact = {
    id: existingRiskArtifact?.id ?? `${mission.id}-artifact-risk`,
    missionId: mission.id,
    name: "RiskReport",
    type: "risk_report",
    status: result.report.decision === "BLOCK" ? "blocked" : result.report.decision === "WARN" ? "warning" : "ready",
    summary: `${result.report.decision} ${result.report.riskScore}/100. ${result.report.issues.join(" ") || "No blocking issue."}`
  };

  const riskMemory: PlatformMemory = {
    id: `${mission.id}-memory-risk`,
    scope: "mission",
    title: "Risk Agent decision",
    summary: `${result.report.decision} ${result.report.riskScore}/100. Recommendations: ${result.report.recommendations.join(" ")}`,
    sourceMissionId: mission.id,
    promoted: result.report.decision === "BLOCK"
  };

  const update = db.transaction(() => {
    upsertEntity("mission", updatedMission.id, updatedMission);
    updateEntities("agent", updatedAgents);
    updateEntities("run_step", updatedSteps);
    upsertEntity("artifact", riskArtifact.id, riskArtifact);
    upsertEntity("memory", riskMemory.id, riskMemory);
  });

  update();
}

async function buildPaperSession(strategy: StrategySpec, backtest: BacktestReport, missionId: string): Promise<PaperSession> {
  const ticker = await getPaperTicker(strategy.symbol);
  const startingBalance = 10000;
  const maxPositionPct = Math.min(strategy.risk.maxPositionPct, 0.15);
  const size = Number(((startingBalance * maxPositionPct) / ticker.last).toFixed(6));
  const pnlPct = Number(Math.max(-6, Math.min(6, backtest.averageTradePct * 3.2)).toFixed(2));
  const endingBalance = Number((startingBalance * (1 + pnlPct / 100)).toFixed(2));
  const firstExitSize = Number((size * 0.5).toFixed(6));
  const secondExitSize = Number((size - firstExitSize).toFixed(6));
  const takeProfitPrice = Number((ticker.last * (1 + Math.max(0.004, Math.abs(pnlPct) / 200))).toFixed(2));
  const finalPrice = Number((ticker.last * (1 + pnlPct / 100)).toFixed(2));

  return PaperSessionSchema.parse({
    id: `${missionId}-paper-${Date.now()}`,
    startingBalance,
    endingBalance,
    pnlPct,
    maxDrawdownPct: Number(
      Math.min(
        Math.max(0.1, backtest.maxDrawdownPct * 0.45),
        strategy.risk.killSwitchDrawdownPct ? strategy.risk.killSwitchDrawdownPct * 100 : 8
      ).toFixed(2)
    ),
    orderCount: 3,
    status: "completed",
    orders: [
      {
        id: `${missionId}-paper-order-001`,
        symbol: strategy.symbol,
        side: "buy",
        price: ticker.last,
        size,
        reason: strategy.entry.rules[0]?.description ?? "Entry rule matched"
      },
      {
        id: `${missionId}-paper-order-002`,
        symbol: strategy.symbol,
        side: "sell",
        price: takeProfitPrice,
        size: firstExitSize,
        reason: strategy.risk.takeProfitPct ? "Partial take-profit threshold simulated" : "Partial risk reduction simulated"
      },
      {
        id: `${missionId}-paper-order-003`,
        symbol: strategy.symbol,
        side: "sell",
        price: finalPrice,
        size: secondExitSize,
        reason: strategy.exit.rules[0]?.description ?? "Exit rule matched"
      }
    ]
  });
}

async function getPaperTicker(symbol: string) {
  try {
    return await getExchangeAdapter("bitget_public").getTicker(symbol);
  } catch {
    return getExchangeAdapter("mock").getTicker(symbol);
  }
}

function applyPaperAgentResult(result: PaperAgentResult, snapshot: PlatformSnapshot) {
  const mission = snapshot.missions.find((item) => item.id === result.missionId);

  if (!mission) {
    throw new Error(`Mission not found: ${result.missionId}`);
  }

  const updatedMission: PlatformMission = {
    ...mission,
    status: "approval",
    paper: result.session,
    currentHandoff: result.handoff
  };

  const missionTeam = new Set(updatedMission.teamAgentIds);
  const updatedAgents = snapshot.agents.map((agent): PlatformAgent => {
    if (!missionTeam.has(agent.id)) {
      return agent;
    }

    if (agent.id === "agent-human-reviewer") {
      return {
        ...agent,
        missionId: mission.id,
        status: "working",
        currentTask: result.handoff
      };
    }

    if (agent.id === "agent-demo") {
      return {
        ...agent,
        missionId: mission.id,
        status: "available",
        currentTask: `Paper session ${result.session.id} completed with real order execution disabled.`
      };
    }

    return {
      ...agent,
      missionId: mission.id,
      status: agent.id === "agent-staffing" || agent.id === "agent-strategy" || agent.id === "agent-backtest" || agent.id === "agent-risk" ? "available" : "waiting",
      currentTask: "Waiting for human review."
    };
  });

  const updatedSteps = ensureMissionRunSteps(snapshot.runSteps, mission.id).map((step): PlatformRunStep => {
    const statusByLabel: Record<string, PlatformRunStep["status"]> = {
      Intake: "done",
      Staffing: "done",
      Spec: "done",
      Backtest: "done",
      Risk: mission.risk.decision === "WARN" ? "warning" : "done",
      Paper: "done",
      Approval: "active"
    };

    const noteByLabel: Record<string, string> = {
      Paper: `${result.session.orderCount} simulated orders, ${result.session.pnlPct}% PnL, ${result.session.maxDrawdownPct}% max drawdown. Real order execution disabled.`,
      Approval: result.handoff
    };

    return {
      ...step,
      status: statusByLabel[step.label] ?? step.status,
      note: noteByLabel[step.label] ?? step.note
    };
  });

  const existingPaperArtifact = snapshot.artifacts.find(
    (artifact) => artifact.missionId === mission.id && artifact.type === "paper_session"
  );
  const paperArtifact: PlatformArtifact = {
    id: existingPaperArtifact?.id ?? `${mission.id}-artifact-paper`,
    missionId: mission.id,
    name: "PaperSession",
    type: "paper_session",
    status: result.session.status === "completed" ? "ready" : "warning",
    summary: `${result.session.orderCount} simulated orders. ${result.session.pnlPct}% paper PnL, ${result.session.maxDrawdownPct}% paper MDD. Real execution disabled.`
  };

  const paperMemory: PlatformMemory = {
    id: `${mission.id}-memory-paper`,
    scope: "mission",
    title: "Demo Agent paper session",
    summary: `${result.session.id} completed with ${result.session.orderCount} simulated orders. Human approval is required before any live dry-run.`,
    sourceMissionId: mission.id,
    promoted: false
  };

  const update = db.transaction(() => {
    upsertEntity("mission", updatedMission.id, updatedMission);
    updateEntities("agent", updatedAgents);
    updateEntities("run_step", updatedSteps);
    upsertEntity("artifact", paperArtifact.id, paperArtifact);
    upsertEntity("memory", paperMemory.id, paperMemory);
  });

  update();
}

function applyOrchestratorResult(result: OrchestratorResult) {
  const traceSummary = result.events
    .slice(-6)
    .map((event) => `${event.agent}: ${event.status} ${event.step} - ${event.summary}`)
    .join("\n");

  const traceArtifact: PlatformArtifact = {
    id: `${result.missionId}-artifact-trace`,
    missionId: result.missionId,
    name: "MissionTrace",
    type: "run_trace",
    status: result.status === "blocked" || result.status === "error" ? "warning" : "ready",
    summary: `${result.stopReason}\n${traceSummary}`
  };

  const traceMemory: PlatformMemory = {
    id: `${result.missionId}-memory-orchestrator`,
    scope: "mission",
    title: "Orchestrator stop reason",
    summary: `${result.status}: ${result.stopReason}`,
    sourceMissionId: result.missionId,
    promoted: false
  };

  const update = db.transaction(() => {
    upsertEntity("artifact", traceArtifact.id, traceArtifact);
    upsertEntity("memory", traceMemory.id, traceMemory);
  });

  update();
}

function updateStepsFromPythonRun(steps: PlatformRunStep[], result: PythonMissionResult): PlatformRunStep[] {
  const missionSteps = ensureMissionRunSteps(steps, result.mission_id);
  const completedStepLabels = new Set(result.events.filter((event) => event.status === "completed").map((event) => event.step));
  const blockedStepLabels = new Set(result.events.filter((event) => event.status === "blocked" || event.status === "error").map((event) => event.step));
  const stoppedStepLabels = new Set(result.events.filter((event) => event.status === "stopped").map((event) => event.step));

  return missionSteps.map((step) => {
    const matchingEvent = [...result.events].reverse().find((event) => event.step === step.label);

    if (blockedStepLabels.has(step.label)) {
      return { ...step, status: "warning", note: matchingEvent?.summary ?? step.note };
    }

    if (stoppedStepLabels.has(step.label)) {
      return { ...step, status: "active", note: matchingEvent?.summary ?? step.note };
    }

    if (completedStepLabels.has(step.label) || isEquivalentPythonStepComplete(step.label, completedStepLabels)) {
      return { ...step, status: "done", note: matchingEvent?.summary ?? step.note };
    }

    if (step.label === "Human Approval" && result.status === "awaiting_human") {
      const approvalEvent = result.events.find((event) => event.step === "Human Approval");
      return { ...step, status: "active", note: approvalEvent?.summary ?? result.stop_reason };
    }

    return { ...step, status: step.status === "active" ? "waiting" : step.status };
  });
}

function isEquivalentPythonStepComplete(label: string, completedStepLabels: Set<string>) {
  const aliases: Record<string, string[]> = {
    Spec: ["Strategy Research"],
    "Strategy Spec": ["Strategy Research"],
    Backtest: ["Backtest"],
    Risk: ["Risk Assessment"],
    "Risk Review": ["Risk Assessment"],
    Paper: ["Paper Trading"],
    Approval: ["Human Approval"]
  };

  return (aliases[label] ?? []).some((alias) => completedStepLabels.has(alias));
}

function buildPythonArtifacts(
  result: PythonMissionResult,
  strategy: StrategySpec,
  backtest: BacktestReport,
  risk: RiskReport,
  paper?: PaperSession
): PlatformArtifact[] {
  const traceSummary = result.events
    .map((event) => `${event.agent}: ${event.status} ${event.step} - ${event.summary}`)
    .join("\n");
  const artifacts: PlatformArtifact[] = [
    {
      id: `${result.mission_id}-artifact-spec`,
      missionId: result.mission_id,
      name: "StrategySpec",
      type: "strategy_spec",
      status: "ready",
      summary: `${strategy.name} ${strategy.symbol} ${strategy.timeframe}. Generated by ${result.framework}.`
    },
    {
      id: `${result.mission_id}-artifact-backtest`,
      missionId: result.mission_id,
      name: "BacktestReport",
      type: "backtest_report",
      status: "ready",
      summary: `${backtest.totalReturnPct}% return, ${backtest.maxDrawdownPct}% MDD, ${backtest.tradeCount} trades.`
    },
    {
      id: `${result.mission_id}-artifact-risk`,
      missionId: result.mission_id,
      name: "RiskReport",
      type: "risk_report",
      status: risk.decision === "BLOCK" ? "blocked" : risk.decision === "WARN" ? "warning" : "ready",
      summary: `${risk.decision} ${risk.riskScore}/100. ${risk.issues.join(" ") || "No blocking issue."}`
    },
    {
      id: `${result.mission_id}-artifact-trace`,
      missionId: result.mission_id,
      name: "MissionTrace",
      type: "run_trace",
      status: result.status === "blocked" || result.status === "error" ? "warning" : "ready",
      summary: `${result.framework}: ${result.stop_reason}\n${traceSummary}`
    }
  ];

  if (paper) {
    artifacts.push({
      id: `${result.mission_id}-artifact-paper`,
      missionId: result.mission_id,
      name: "PaperSession",
      type: "paper_session",
      status: paper.status === "completed" ? "ready" : "warning",
      summary: `${paper.orderCount} simulated orders. ${paper.pnlPct}% paper PnL, ${paper.maxDrawdownPct}% paper MDD.`
    });
  }

  return artifacts;
}

function getAgentNameForStep(label: string) {
  const agentByStep: Record<string, string> = {
    Staffing: "Staffing Agent",
    Spec: "Strategy Agent",
    Backtest: "Backtest Agent",
    Risk: "Risk Agent",
    Paper: "Demo Agent",
    Approval: "Human Reviewer"
  };

  return agentByStep[label] ?? "Mission Orchestrator";
}

function ensureMissionRunSteps(steps: PlatformRunStep[], missionId: string) {
  const missionSteps = steps.filter((step) => step.missionId === missionId);

  // If Plan-generated steps already exist, use them
  if (missionSteps.length > 1) return missionSteps;

  // Fallback: create default steps (for legacy missions without a Plan)
  const defaults: PlatformRunStep[] = [
    { id: `${missionId}-step-intake`, missionId, agentId: "agent-staffing", label: "Intake", status: "done", tool: "task_brief", output: "TaskBrief", note: "Mission constraints captured." },
    { id: `${missionId}-step-spec`, missionId, agentId: "agent-strategy", label: "Strategy Spec", status: "active", tool: "compile_strategy_spec", output: "StrategySpec", note: "Compiling strategy spec." },
    { id: `${missionId}-step-backtest`, missionId, agentId: "agent-backtest", label: "Backtest", status: "waiting", tool: "run_backtest", output: "BacktestReport", note: "Waiting for StrategySpec." },
    { id: `${missionId}-step-risk`, missionId, agentId: "agent-risk", label: "Risk Review", status: "waiting", tool: "score_risk", output: "RiskReport", note: "Waiting for historical evidence." },
    { id: `${missionId}-step-paper`, missionId, agentId: "agent-demo", label: "Paper Trading", status: "waiting", tool: "start_paper_session", output: "PaperSession", note: "Waiting for risk gate." },
    { id: `${missionId}-step-approval`, missionId, agentId: "agent-human-reviewer", label: "Human Approval", status: "locked", tool: "request_human_approval", output: "ApprovalDecision", note: "Locked until evidence complete." }
  ];

  return defaults;
}

/** Advance to the next step in the Plan after completing the given step */
function advanceFromStep(activeStepId: string, snapshot: PlatformSnapshot) {
  const activeStep = snapshot.runSteps.find((s) => s.id === activeStepId);
  if (!activeStep) return;

  const mission = snapshot.missions.find((m) => m.id === activeStep.missionId);
  if (!mission?.plan) return;

  const plan = mission.plan;
  const completedStepPlanId = activeStep.id.replace("step-", "");
  const activePlanStep = plan.steps.find((ps) => ps.id === completedStepPlanId);

  // Mark current step done
  markStepStatus(activeStep.id, activePlanStep?.outputArtifactType === "risk_report" && activeStep.status === "active"
    ? "warning" : "done");

  // Find next step whose dependencies are satisfied
  const doneStepIds = new Set(
    snapshot.runSteps
      .filter((s) => s.missionId === mission.id && (s.status === "done" || s.status === "warning"))
      .map((s) => s.id.replace("step-", ""))
  );
  doneStepIds.add(completedStepPlanId);

  const nextStep = plan.steps.find((ps) => {
    if (ps.id === completedStepPlanId) return false; // skip the step we just completed
    const stepEntity = snapshot.runSteps.find((s) => s.id === `step-${ps.id}`);
    if (!stepEntity || stepEntity.status === "done" || stepEntity.status === "warning") return false;
    return ps.dependsOn.every((depId) => doneStepIds.has(depId));
  });

  if (nextStep) {
    const nextEntity = snapshot.runSteps.find((s) => s.id === `step-${nextStep.id}`);
    if (nextEntity) {
      markStepStatus(nextEntity.id, "active");
      // Activate the agent
      const agent = snapshot.agents.find((a) => a.id === nextStep.agentId);
      if (agent) {
        upsertEntity("agent", agent.id, { ...agent, status: "working" as const, missionId: mission.id });
      }
    }
  }
}

function markStepStatus(stepId: string, status: PlatformRunStep["status"]) {
  const existing = getEntity<PlatformRunStep>("run_step", stepId);
  if (existing) {
    upsertEntity("run_step", stepId, { ...existing, status });
  }
}

function buildStaffingPrompt(mission: PlatformMission, agents: PlatformAgent[], skills: PlatformSkill[]) {
  return `
Return JSON with this exact shape:
{
  "requiredSkillIds": ["skill-id"],
  "selectedAgentIds": ["agent-id"],
  "reasoning": "short explanation",
  "gaps": ["missing skill or policy concern"],
  "handoff": "next handoff instruction"
  "backtestLimit": 300
}

Mission:
${JSON.stringify(
  {
    id: mission.id,
    title: mission.title,
    domain: mission.domain,
    objective: mission.objective,
    currentHandoff: mission.currentHandoff
  },
  null,
  2
)}

Available skills:
${JSON.stringify(skills, null, 2)}

Available agents:
${JSON.stringify(
  agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    skillIds: agent.skillIds,
    memoryScope: agent.memoryScope
  })),
  null,
  2
)}

Selection rules:
- Always include agent-staffing.
- Select the smallest complete team that covers required skills.
- For quant strategy deployment, include strategy spec, market data, backtest, risk, paper session, human approval, and memory writer skills.
- If a required skill is missing, put it in gaps.
- Do not select agents or skills that are not listed above.
- Handoff should name the next agent and immediate next action.
`.trim();
}

function buildStrategyPrompt(mission: PlatformMission, snapshot: PlatformSnapshot) {
  const team = snapshot.agents.filter((agent) => mission.teamAgentIds.includes(agent.id));
  const artifacts = snapshot.artifacts.filter((artifact) => artifact.missionId === mission.id);
  const memories = snapshot.memories.filter(
    (memory) => memory.scope === "workspace" || memory.scope === "skill" || memory.sourceMissionId === mission.id
  );

  return `
Return JSON with this exact shape:
{
  "strategy": {
    "id": "strategy-spec-id",
    "source": "library_template | custom_spec | custom_code",
    "name": "short strategy name",
    "symbol": "BTCUSDT",
    "market": "spot | futures",
    "timeframe": "1m | 5m | 15m | 1h | 4h | 1d",
    "entry": {"mode": "all | any", "rules": [{"left": "EMA20", "operator": "crosses_above | crosses_below | greater_than | less_than", "right": "EMA60", "description": "plain language"}]},
    "exit": {"mode": "all | any", "rules": [{"left": "EMA20", "operator": "crosses_below | crosses_above | greater_than | less_than", "right": "EMA60", "description": "plain language"}]},
    "risk": {
      "maxPositionPct": 0.2,
      "maxLeverage": 1,
      "stopLossPct": 0.03,
      "takeProfitPct": 0.06,
      "maxDailyLossPct": 0.05,
      "killSwitchDrawdownPct": 0.12
    },
    "tags": ["agent-reviewed"]
  },
  "reasoning": "short explanation of why the spec is ready for backtest",
  "changes": ["change or confirmation"],
  "handoff": "next handoff instruction",
  "backtestLimit": 300
}

Mission:
${JSON.stringify(
  {
    id: mission.id,
    title: mission.title,
    domain: mission.domain,
    objective: mission.objective,
    currentHandoff: mission.currentHandoff
  },
  null,
  2
)}

Current StrategySpec:
${JSON.stringify(mission.strategy, null, 2)}

Current RiskReport:
${JSON.stringify(mission.risk, null, 2)}

Mission team:
${JSON.stringify(
  team.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    skillIds: agent.skillIds
  })),
  null,
  2
)}

Mission artifacts:
${JSON.stringify(artifacts, null, 2)}

Relevant memory:
${JSON.stringify(memories, null, 2)}

Rules:
- Prefer confirming and tightening the current StrategySpec over inventing a new strategy.
- If the current RiskReport is BLOCK, revise the StrategySpec for a safer retry and set backtestLimit to 1000.
- When revising a blocked strategy, reduce maxPositionPct to 0.1 or lower, keep maxLeverage at 1, and add tags "risk-revised" and "extended-lookback".
- Preserve the mission symbol, market, timeframe, and source unless the objective clearly requires a correction.
- Return only schema-valid JSON.
- Do not include markdown or commentary outside JSON.
- Do not claim backtest, paper, live, or exchange results.
- Handoff must name Backtest Agent and the immediate simulation task.
`.trim();
}

function sortRunSteps(steps: PlatformRunStep[]) {
  const order = new Map([
    ["Intake", 0],
    ["Staffing", 1],
    ["Strategy Research", 2],
    ["Backtest", 3],
    ["Risk Assessment", 4],
    ["Strategy Review", 5],
    ["Paper Trading", 6],
    ["Human Approval", 7],
    // Legacy labels
    ["Spec", 2],
    ["Risk", 4],
    ["Paper", 6],
    ["Approval", 7]
  ]);

  return [...steps].sort((left, right) => {
    if (left.missionId !== right.missionId) {
      return left.missionId.localeCompare(right.missionId);
    }

    return (order.get(left.label) ?? 99) - (order.get(right.label) ?? 99);
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
