import type { PlatformAgent, PlatformMission, PlatformSkill } from "@/src/platform/types";
import type { OrchestratorRun, PlatformSnapshot } from "@/src/platform/types";

export type PythonMissionResult = {
  mission_id: string;
  status: "advanced" | "blocked" | "awaiting_human" | "idle" | "error";
  stop_reason: string;
  framework: string;
  strategy: {
    id: string;
    source: "library_template" | "custom_spec" | "custom_code";
    name: string;
    symbol: string;
    market: "spot" | "futures";
    timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
    entry: { mode: "all" | "any"; rules: Array<{ left: string; operator: string; right: string; description: string }> };
    exit: { mode: "all" | "any"; rules: Array<{ left: string; operator: string; right: string; description: string }> };
    risk: {
      max_position_pct: number;
      max_leverage: number;
      stop_loss_pct?: number | null;
      take_profit_pct?: number | null;
      max_daily_loss_pct?: number | null;
      kill_switch_drawdown_pct?: number | null;
    };
    tags: string[];
  };
  backtest: {
    total_return_pct: number;
    max_drawdown_pct: number;
    win_rate_pct: number;
    trade_count: number;
    profit_factor: number;
    average_trade_pct: number;
  };
  risk: {
    decision: "PASS" | "WARN" | "BLOCK";
    risk_score: number;
    issues: string[];
    recommendations: string[];
  };
  paper: {
    id: string;
    starting_balance: number;
    ending_balance: number;
    pnl_pct: number;
    max_drawdown_pct: number;
    order_count: number;
    status: "completed" | "paused" | "blocked";
    orders: Array<{ id: string; symbol: string; side: "buy" | "sell"; price: number; size: number; reason: string }>;
  } | null;
  events: Array<{
    agent: string;
    step: string;
    action: string;
    status: "started" | "completed" | "stopped" | "blocked" | "error";
    summary: string;
  }>;
};

export async function runPythonMission(mission: PlatformMission): Promise<PythonMissionResult> {
  const baseUrl = process.env.PAPERFORGE_PY_BACKEND_URL ?? "http://127.0.0.1:8765";
  const response = await fetch(`${baseUrl}/missions/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      missionId: mission.id,
      title: mission.title,
      objective: mission.objective
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Python backend failed: ${response.status} ${message.slice(0, 240)}`);
  }

  return (await response.json()) as PythonMissionResult;
}

export async function advancePythonMission(missionId: string): Promise<OrchestratorRun> {
  return backendFetch<OrchestratorRun>("/missions/advance", {
    method: "POST",
    body: JSON.stringify({ missionId })
  });
}

export async function getPythonSnapshot(): Promise<PlatformSnapshot> {
  return backendFetch<PlatformSnapshot>("/platform/snapshot");
}

export async function getPythonMission(missionId: string): Promise<PlatformMission | null> {
  const payload = await backendFetch<{ mission: PlatformMission } | { error: string }>(`/missions/${missionId}`, {
    allowNotFound: true
  });
  return "mission" in payload ? payload.mission : null;
}

export async function getPythonLatestRun(missionId: string): Promise<OrchestratorRun | null> {
  const payload = await backendFetch<{ run: OrchestratorRun | null }>(`/missions/${missionId}/latest-run`);
  return payload.run;
}

export async function createPythonMission(input: {
  title: string;
  objective: string;
  domain: "quant" | "general";
}): Promise<PlatformMission> {
  const payload = await backendFetch<{ mission: PlatformMission }>("/missions", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.mission;
}

export async function createPythonSkill(input: {
  name: string;
  usedBy: NonNullable<PlatformSkill["usedBy"]>;
  category: PlatformSkill["category"];
  toolId: string;
  description: string;
  argumentSchema?: string;
  resultDescription?: string;
  usageExamples?: string[];
  inputs: string[];
  outputs: string[];
  domains: string[];
  sideEffects: NonNullable<PlatformSkill["sideEffects"]>;
  requiresApproval: boolean;
  failureModes: string[];
  acceptanceCriteria: string[];
}): Promise<PlatformSkill> {
  const payload = await backendFetch<{ skill: PlatformSkill }>("/skills", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.skill;
}

export async function createPythonAgent(input: {
  name: string;
  roleTitle: string;
  role: string;
  backstory: string;
  domain: PlatformAgent["domain"];
  skillIds: string[];
  currentTask: string;
  memoryScope: PlatformAgent["memoryScope"];
}): Promise<PlatformAgent> {
  const payload = await backendFetch<{ agent: PlatformAgent }>("/agents", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.agent;
}

// ===== Flow API =====

export type QuantFlowState = {
  run_id: string;
  task_description: string;
  created_at: string;
  current_phase: "init" | "planning" | "factor_mining" | "strategy" | "backtest" | "risk_audit" | "paper_trading" | "live_decision" | "done" | "failed";
  plan: {
    task_id: string;
    task_summary: string;
    agents: Array<{ role: string; goal: string; backstory: string; tools: string[]; llm_model: string }>;
    tasks: Array<{ name: string; description: string; expected_output: string; agent_role: string; inputs: Record<string, string>; outputs: string[] }>;
    flow_type: string;
    risk_level: string;
    memory_scope: string;
    constraints: string;
  } | null;
  result_factor_mining: Record<string, unknown> | null;
  result_strategy: Record<string, unknown> | null;
  result_backtest: {
    total_return_pct: number;
    max_drawdown_pct: number;
    win_rate_pct: number;
    trade_count: number;
    profit_factor: number;
    average_trade_pct: number;
  } | null;
  result_risk_audit: {
    decision: "PASS" | "WARN" | "BLOCK";
    risk_score: number;
    issues: string[];
    recommendations: string[];
  } | null;
  result_paper_trading: Record<string, unknown> | null;
  result_live_decision: Record<string, unknown> | null;
  audit_checkpoint_id: string | null;
  audit_status: string | null;
  errors: Array<{ phase: string; error: string; timestamp: string }>;
  retry_count: Record<string, number>;
};

export type FlowRunResult = {
  run_id: string;
  status: string;
  stop_reason: string;
  result: unknown;
  final_state: QuantFlowState;
};

export async function runQuantFlow(missionId: string): Promise<FlowRunResult> {
  // 如果是 "demo-run"，先创建一个临时 mission
  if (missionId === "demo-run") {
    const baseUrl = process.env.PAPERFORGE_PY_BACKEND_URL ?? "http://127.0.0.1:8765";

    // 创建临时 demo mission
    const createResponse = await fetch(`${baseUrl}/missions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Demo Strategy Run",
        objective: "Demonstrate the quant pipeline: EMA trend strategy for BTCUSDT",
        domain: "quant"
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });

    if (!createResponse.ok) {
      throw new Error("Failed to create demo mission");
    }

    const { mission } = await createResponse.json() as { mission: { id: string } };
    missionId = mission.id;
  }

  const payload = await backendFetch<FlowRunResult>("/missions/run-flow", {
    method: "POST",
    body: JSON.stringify({ missionId })
  });
  return payload;
}

export async function getFlowState(runId: string): Promise<QuantFlowState | null> {
  const payload = await backendFetch<{ state: QuantFlowState } | { error: string }>(`/flows/${runId}/state`, {
    allowNotFound: true
  });
  return "state" in payload ? payload.state : null;
}

async function backendFetch<T>(
  path: string,
  options: RequestInit & { allowNotFound?: boolean } = {}
): Promise<T> {
  const baseUrl = process.env.PAPERFORGE_PY_BACKEND_URL ?? "http://127.0.0.1:8765";
  const request = () =>
    fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...options.headers
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });

  let response: Response;
  try {
    response = await request();
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      response = await request();
    } catch {
      throw error;
    }
  }

  if (options.allowNotFound && response.status === 404) {
    return (await response.json()) as T;
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Python backend failed: ${response.status} ${message.slice(0, 240)}`);
  }

  return (await response.json()) as T;
}
