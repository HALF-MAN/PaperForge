import type { BacktestReport, PaperSession, RiskReport, StrategySpec } from "@/src/domain/schema";

export type DomainTag = "quant" | "trading" | "development" | "legal" | "research" | "general";

export type PlatformWorkspace = {
  id: string;
  name: string;
  domain: string;
  operatingMode: "paper_only" | "approval_gated" | "live_dry_run";
};

export type PlatformSkill = {
  id: string;
  name: string;
  usedBy?: "planner" | "executor" | "reviewer" | "human";
  category: "planning" | "analysis" | "computation" | "execution" | "review" | "governance" | "approval" | "memory";
  toolId: string; // maps to a handler in getToolHandler()
  description: string;
  inputs: string[];
  outputs: string[];
  domains: DomainTag[];
  sideEffects?: "none" | "network_read" | "compute" | "writes_plan" | "writes_memory" | "paper_simulation" | "workflow_pause";
  requiresApproval?: boolean;
  failureModes?: string[];
  acceptanceCriteria?: string[];
  argumentSchema?: string;
  resultDescription?: string;
  usageExamples?: string[];
  sourcePath?: string;
  source?: "database" | "seed";
};

export type PlatformAgent = {
  id: string;
  name: string;
  roleTitle: string; // e.g. "Quant Researcher", "Risk Manager"
  role: string;
  backstory: string;
  domain: DomainTag;
  status: "available" | "working" | "waiting" | "blocked";
  missionId?: string;
  skillIds: string[];
  currentTask: string;
  memoryScope: "workspace" | "mission" | "private";
  source?: "database" | "seed";
};

export type PlatformArtifact = {
  id: string;
  missionId: string;
  name: string;
  type:
    | "brief"
    | "team_plan"
    | "market_data"
    | "strategy_spec"
    | "backtest_report"
    | "risk_report"
    | "review_report"
    | "paper_session"
    | "approval"
    | "memory_note"
    | "run_trace";
  status: "draft" | "ready" | "warning" | "approved" | "blocked";
  summary: string;
};

export type PlatformRunStep = {
  id: string;
  missionId: string;
  agentId: string;
  label: string;
  status: "done" | "active" | "waiting" | "warning" | "locked";
  tool: string;
  output: string;
  note: string;
};

export type PlatformMission = {
  id: string;
  title: string;
  status: "intake" | "planning" | "ready" | "staffing" | "running" | "review" | "approval" | "completed" | "blocked";
  domain: "quant" | "general";
  objective: string;
  currentHandoff: string;
  workspaceId: string;
  teamAgentIds: string[];
  plan?: Plan;
  strategy: StrategySpec;
  backtest: BacktestReport;
  risk: RiskReport;
  backtestLimit?: number;
  paper?: PaperSession;
};

export type PlatformMemory = {
  id: string;
  scope: "workspace" | "mission" | "agent" | "skill";
  title: string;
  summary: string;
  sourceMissionId?: string;
  promoted: boolean;
};

export type PlatformSnapshot = {
  workspace: PlatformWorkspace;
  missions: PlatformMission[];
  agents: PlatformAgent[];
  skills: PlatformSkill[];
  artifacts: PlatformArtifact[];
  runSteps: PlatformRunStep[];
  memories: PlatformMemory[];
};

export type PlanStep = {
  id: string;
  label: string;
  agentId: string;
  agentName: string;
  tool: string;
  inputArtifactTypes: PlatformArtifact["type"][];
  outputArtifactType: PlatformArtifact["type"];
  dependsOn: string[]; // step ids that must complete before this one
  condition?: string; // e.g. "risk.decision !== 'BLOCK'" — the step is skipped unless condition holds
  note: string;
  acceptanceCriteria?: string[];
};

export type Plan = {
  missionId: string;
  steps: PlanStep[];
  handoffRules: Record<string, string>; // e.g. { "risk_BLOCK": "spec" } — when step X produces decision Y, route to step Z
  reasoning: string;
  framework?: "crewai" | "agent-framework" | "paperforge";
  planner?: {
    provider: string;
    mode: string;
    reason?: string;
    crew?: string;
    agent?: string;
    plannerSkillIds?: string[];
    executorSkillIds?: string[];
    reviewerSkillIds?: string[];
  };
};

export type StaffingPlan = {
  missionId: string;
  requiredSkillIds: string[];
  selectedAgentIds: string[];
  plan: Plan;
  reasoning: string;
  gaps: string[];
  handoff: string;
  provider: string;
  model: string;
};

export type StrategyAgentResult = {
  missionId: string;
  strategySpecId: string;
  reasoning: string;
  changes: string[];
  handoff: string;
  provider: string;
  model: string;
  backtestLimit?: number;
};

export type BacktestAgentResult = {
  missionId: string;
  strategySpecId: string;
  source: "bitget_public" | "mock";
  candleCount: number;
  report: BacktestReport;
  handoff: string;
  warning?: string;
};

export type RiskAgentResult = {
  missionId: string;
  strategySpecId: string;
  report: RiskReport;
  handoff: string;
  nextAgentId: string;
};

export type PaperAgentResult = {
  missionId: string;
  strategySpecId: string;
  session: PaperSession;
  handoff: string;
};

export type OrchestratorEvent = {
  agent: string;
  step: string;
  action: string;
  status: "started" | "completed" | "stopped" | "blocked" | "error";
  summary: string;
};

export type OrchestratorResult = {
  missionId: string;
  status: "advanced" | "blocked" | "awaiting_human" | "idle" | "error";
  stopReason: string;
  events: OrchestratorEvent[];
};

export type OrchestratorRun = {
  id: string;
  missionId: string;
  status: "queued" | "running" | OrchestratorResult["status"];
  stopReason: string;
  events: OrchestratorEvent[];
  createdAt: string;
  updatedAt: string;
};

// ===== 新增类型（根据 architecture.md） =====

// ExecutionPlan 相关类型
export type AgentConfig = {
  role: string;
  goal: string;
  backstory: string;
  tools: string[];
  llmModel: string;
};

export type TaskConfig = {
  name: string;
  description: string;
  expectedOutput: string;
  agentRole: string;
  inputs: Record<string, string>;
  outputs: string[];
};

export type ExecutionPlan = {
  taskId: string;
  taskSummary: string;
  agents: AgentConfig[];
  tasks: TaskConfig[];
  flowType: "sequential" | "hierarchical" | "conditional";
  riskLevel: "low" | "medium" | "high";
  memoryScope: string;
  constraints: string;
};

// QuantState 类型
export type QuantPhase =
  | "init"
  | "planning"
  | "factor_mining"
  | "strategy"
  | "backtest"
  | "risk_audit"
  | "paper_trading"
  | "live_decision"
  | "done"
  | "failed";

export type QuantState = {
  runId: string;
  taskDescription: string;
  createdAt: string;
  currentPhase: QuantPhase;
  plan?: ExecutionPlan;
  resultFactorMining?: Record<string, unknown>;
  resultStrategy?: Record<string, unknown>;
  resultBacktest?: Record<string, unknown>;
  resultRiskAudit?: Record<string, unknown>;
  resultPaperTrading?: Record<string, unknown>;
  resultLiveDecision?: Record<string, unknown>;
  auditCheckpointId?: string;
  auditStatus?: "pending" | "approved" | "rejected" | "modified" | "timeout";
  errors: Array<Record<string, unknown>>;
  retryCount: Record<string, number>;
};

// AuditCheckpoint 类型
export type AuditCheckpoint = {
  checkpointId: string;
  runId: string;
  stage: string;
  status: "pending" | "approved" | "rejected" | "modified" | "timeout";
  auditor?: string;
  comment?: string;
  modifiedData?: Record<string, unknown>;
  submittedAt: string;
  timeoutAt: string;
  resolvedAt?: string;
};
