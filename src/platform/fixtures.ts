import { strategyTemplates } from "@/src/domain/templates";
import { runTemplatePipeline } from "@/src/pipeline/runner";
import type {
  Plan,
  PlatformAgent,
  PlatformArtifact,
  PlatformMemory,
  PlatformMission,
  PlatformRunStep,
  PlatformSkill,
  PlatformSnapshot,
  PlatformWorkspace
} from "@/src/platform/types";

const template = strategyTemplates[0];
const pipeline = runTemplatePipeline(template);

export const workspace: PlatformWorkspace = {
  id: "ws-quant-lab",
  name: "PaperForge Quant Lab",
  domain: "agentic quant deployment",
  operatingMode: "approval_gated"
};

// ═══ Skill Registry ═══
// Skills are the atomic unit. Agents are composed from skills.
// Each skill maps to a tool handler via toolId.
export const skills: PlatformSkill[] = [
  // ── Analysis skills ──
  {
    id: "skill-market-research",
    name: "Market Research",
    category: "analysis",
    toolId: "research_market",
    description: "Analyze market conditions, identify trends, and gather intelligence.",
    inputs: ["market_data", "brief"],
    outputs: ["MarketBrief"],
    domains: ["quant", "trading", "research"]
  },
  {
    id: "skill-technical-analysis",
    name: "Technical Analysis",
    category: "analysis",
    toolId: "compile_strategy_spec",
    description: "Apply technical indicators to formulate trading strategies.",
    inputs: ["market_data", "indicators"],
    outputs: ["StrategySpec"],
    domains: ["quant", "trading"]
  },
  {
    id: "skill-sentiment-analysis",
    name: "Sentiment & Positioning",
    category: "analysis",
    toolId: "research_market",
    description: "Analyze market sentiment, long/short ratios, and funding rates.",
    inputs: ["sentiment_data"],
    outputs: ["SentimentReport"],
    domains: ["quant", "trading"]
  },

  // ── Computation skills ──
  {
    id: "skill-quant-backtest",
    name: "Quantitative Backtesting",
    category: "computation",
    toolId: "run_backtest",
    description: "Run historical simulations to validate strategy performance.",
    inputs: ["StrategySpec", "CandleSeries"],
    outputs: ["BacktestReport"],
    domains: ["quant", "trading", "development"]
  },
  {
    id: "skill-data-fetch",
    name: "Market Data Fetching",
    category: "computation",
    toolId: "fetch_candles",
    description: "Fetch and normalize market data from exchanges.",
    inputs: ["symbol", "timeframe"],
    outputs: ["CandleSeries"],
    domains: ["quant", "trading", "research"]
  },

  // ── Review skills ──
  {
    id: "skill-risk-modeling",
    name: "Risk Modeling & Stress Testing",
    category: "review",
    toolId: "score_risk",
    description: "Score deployment risk, identify blockers, and suggest safeguards.",
    inputs: ["StrategySpec", "BacktestReport"],
    outputs: ["RiskReport"],
    domains: ["quant", "trading", "general"]
  },
  {
    id: "skill-strategy-review",
    name: "Strategy Review & Validation",
    category: "review",
    toolId: "review_strategy",
    description: "Validate strategy against compliance rules and evidence quality.",
    inputs: ["StrategySpec", "BacktestReport", "RiskReport"],
    outputs: ["ReviewReport"],
    domains: ["quant", "trading", "legal"]
  },
  {
    id: "skill-evidence-evaluation",
    name: "Evidence Evaluation",
    category: "review",
    toolId: "evaluate_evidence",
    description: "Check artifacts for completeness, consistency, and unsupported claims.",
    inputs: ["Artifacts"],
    outputs: ["EvaluatorReport"],
    domains: ["general"]
  },

  // ── Execution skills ──
  {
    id: "skill-paper-execution",
    name: "Paper Trading Execution",
    category: "execution",
    toolId: "start_paper_session",
    description: "Execute strategy in simulated paper trading environment.",
    inputs: ["StrategySpec", "RiskReport"],
    outputs: ["PaperSession"],
    domains: ["quant", "trading"]
  },

  // ── Approval skills ──
  {
    id: "skill-human-approval",
    name: "Human Approval Gate",
    category: "approval",
    toolId: "request_human_approval",
    description: "Pause execution and request human review before critical actions.",
    inputs: ["EvidenceBundle"],
    outputs: ["ApprovalDecision"],
    domains: ["general"]
  },

  // ── Memory skills ──
  {
    id: "skill-memory-writer",
    name: "Knowledge Capture & Reuse",
    category: "memory",
    toolId: "write_memory",
    description: "Capture lessons, decisions, and reusable patterns from mission traces.",
    inputs: ["RunTrace", "ApprovalDecision"],
    outputs: ["MemoryNote"],
    domains: ["general"]
  },

  // ── Cross-domain skills ──
  {
    id: "skill-document-analysis",
    name: "Document Analysis",
    category: "analysis",
    toolId: "analyze_document",
    description: "Analyze contracts, reports, and structured documents.",
    inputs: ["Document"],
    outputs: ["AnalysisReport"],
    domains: ["legal", "research", "general"]
  },
  {
    id: "skill-code-review",
    name: "Code Review & Audit",
    category: "review",
    toolId: "review_code",
    description: "Review code for quality, security, and best practices.",
    inputs: ["Codebase"],
    outputs: ["CodeReviewReport"],
    domains: ["development"]
  }
];

// ═══ Agent Pool ═══
// Agents are composed from skills. Their identity comes from their skill set.
export const agents: PlatformAgent[] = [
  // ── Quant domain ──
  {
    id: "agent-quant-researcher",
    name: "Alpha",
    roleTitle: "Quant Researcher",
    role: "strategy researcher",
    backstory: "Expert in quantitative strategy research, technical analysis, and market intelligence. Develops trading strategies from data-driven insights.",
    domain: "quant",
    status: "available",
    skillIds: ["skill-market-research", "skill-technical-analysis", "skill-sentiment-analysis"],
    currentTask: "Monitoring markets for strategy opportunities.",
    memoryScope: "workspace"
  },
  {
    id: "agent-backtest-engineer",
    name: "Nova",
    roleTitle: "Backtest Engineer",
    role: "simulation engineer",
    backstory: "Specialized in historical simulation and performance analysis. Validates strategies through rigorous quantitative backtesting.",
    domain: "quant",
    status: "available",
    skillIds: ["skill-quant-backtest", "skill-data-fetch"],
    currentTask: "Ready to validate new strategies.",
    memoryScope: "mission"
  },
  {
    id: "agent-risk-manager",
    name: "Guard",
    roleTitle: "Risk Manager",
    role: "deployment gatekeeper",
    backstory: "Responsible for risk assessment, stress testing, and deployment gating. Ensures no strategy goes live without proper validation.",
    domain: "quant",
    status: "available",
    skillIds: ["skill-risk-modeling"],
    currentTask: "Monitoring risk thresholds.",
    memoryScope: "workspace"
  },
  {
    id: "agent-strategy-reviewer",
    name: "Vega",
    roleTitle: "Senior Strategy Reviewer",
    role: "strategy reviewer",
    backstory: "Veteran strategy reviewer with deep experience in validating trading strategies. Checks evidence quality, compliance, and deployment readiness.",
    domain: "quant",
    status: "available",
    skillIds: ["skill-strategy-review", "skill-evidence-evaluation"],
    currentTask: "Reviewing strategy submissions.",
    memoryScope: "workspace"
  },
  {
    id: "agent-execution-trader",
    name: "Nexus",
    roleTitle: "Execution Trader",
    role: "execution operator",
    backstory: "Handles strategy execution in paper and live environments. Ensures orders follow the approved strategy parameters exactly.",
    domain: "quant",
    status: "available",
    skillIds: ["skill-paper-execution"],
    currentTask: "Ready to execute approved strategies.",
    memoryScope: "mission"
  },

  // ── Cross-domain agents ──
  {
    id: "agent-staffing",
    name: "Orion",
    roleTitle: "Staffing Orchestrator",
    role: "team builder",
    backstory: "Expert in assembling the right team for any task. Analyzes task requirements and matches them to available skills across all domains.",
    domain: "general",
    status: "available",
    skillIds: ["skill-evidence-evaluation", "skill-memory-writer"],
    currentTask: "Ready to assemble mission teams.",
    memoryScope: "workspace"
  },
  {
    id: "agent-human-reviewer",
    name: "Human",
    roleTitle: "Human Reviewer",
    role: "approval owner",
    backstory: "The human-in-the-loop. Reviews evidence bundles and makes final approval decisions.",
    domain: "general",
    status: "available",
    skillIds: ["skill-human-approval"],
    currentTask: "Waiting for approval requests.",
    memoryScope: "workspace"
  },
  {
    id: "agent-memory-keeper",
    name: "Mnemos",
    roleTitle: "Knowledge Archivist",
    role: "memory writer",
    backstory: "Captures lessons, decisions, and reusable patterns from every mission. Builds the organization's knowledge base.",
    domain: "general",
    status: "available",
    skillIds: ["skill-memory-writer"],
    currentTask: "Ready to capture mission knowledge.",
    memoryScope: "workspace"
  },

  // ── Other domain agents (for future expansion) ──
  {
    id: "agent-code-reviewer",
    name: "Lint",
    roleTitle: "Code Reviewer",
    role: "code auditor",
    backstory: "Expert in code quality, security, and best practices. Reviews pull requests and identifies issues.",
    domain: "development",
    status: "available",
    skillIds: ["skill-code-review"],
    currentTask: "Available for code review missions.",
    memoryScope: "workspace"
  },
  {
    id: "agent-document-analyst",
    name: "Lex",
    roleTitle: "Document Analyst",
    role: "legal researcher",
    backstory: "Specialized in analyzing legal documents, contracts, and regulatory filings. Extracts key insights and identifies risks.",
    domain: "legal",
    status: "available",
    skillIds: ["skill-document-analysis"],
    currentTask: "Ready to analyze documents.",
    memoryScope: "workspace"
  }
];

const defaultPlan: Plan = {
  missionId: "mission-ema-paper",
  steps: [
    { id: "strategy", label: "Strategy Research", agentId: "agent-quant-researcher", agentName: "Quant Researcher", tool: "compile_strategy_spec", inputArtifactTypes: ["brief"], outputArtifactType: "strategy_spec", dependsOn: [], note: "Research market and compile validated StrategySpec." },
    { id: "backtest", label: "Backtest", agentId: "agent-backtest-engineer", agentName: "Backtest Engineer", tool: "run_backtest", inputArtifactTypes: ["strategy_spec"], outputArtifactType: "backtest_report", dependsOn: ["strategy"], note: "Run historical simulation using market data." },
    { id: "risk", label: "Risk Assessment", agentId: "agent-risk-manager", agentName: "Risk Manager", tool: "score_risk", inputArtifactTypes: ["strategy_spec", "backtest_report"], outputArtifactType: "risk_report", dependsOn: ["backtest"], note: "Score deployment risk and stress-test strategy." },
    { id: "review", label: "Strategy Review", agentId: "agent-strategy-reviewer", agentName: "Senior Strategy Reviewer", tool: "review_strategy", inputArtifactTypes: ["strategy_spec", "backtest_report", "risk_report"], outputArtifactType: "review_report", dependsOn: ["risk"], note: "Validate strategy against compliance rules.", condition: "risk.decision !== 'BLOCK'" },
    { id: "paper", label: "Paper Trading", agentId: "agent-execution-trader", agentName: "Execution Trader", tool: "start_paper_session", inputArtifactTypes: ["strategy_spec", "risk_report"], outputArtifactType: "paper_session", dependsOn: ["review"], note: "Execute strategy in paper trading environment.", condition: "risk.decision !== 'BLOCK'" },
    { id: "approval", label: "Human Approval", agentId: "agent-human-reviewer", agentName: "Human Reviewer", tool: "request_human_approval", inputArtifactTypes: ["paper_session"], outputArtifactType: "approval", dependsOn: ["paper"], note: "Human reviews evidence and approves or rejects." }
  ],
  handoffRules: { "risk_BLOCK": "strategy" },
  reasoning: "Quant strategy deployment pipeline: research → backtest → risk → review → paper → approval."
};

export const missions: PlatformMission[] = [
  {
    id: "mission-ema-paper",
    title: "Evaluate BTC EMA strategy for paper deployment",
    status: "staffing",
    domain: "quant",
    objective: "Validate a BTCUSDT 1h EMA breakout strategy before any live dry-run path.",
    currentHandoff: "Staffing Agent is building a team and generating a workflow plan.",
    workspaceId: workspace.id,
    teamAgentIds: ["agent-staffing", "agent-quant-researcher", "agent-backtest-engineer", "agent-risk-manager", "agent-strategy-reviewer", "agent-execution-trader", "agent-human-reviewer"],
    plan: defaultPlan,
    strategy: pipeline.spec,
    backtest: pipeline.backtest,
    risk: pipeline.risk
  }
];

export const artifacts: PlatformArtifact[] = [
  { id: "artifact-brief", missionId: "mission-ema-paper", name: "TaskBrief", type: "brief", status: "ready", summary: "Objective, market, constraints captured." }
];

export const runSteps: PlatformRunStep[] = [
  { id: "step-intake", missionId: "mission-ema-paper", agentId: "agent-staffing", label: "Intake", status: "done", tool: "task_brief", output: "TaskBrief", note: "Mission constraints captured." }
];

export const memories: PlatformMemory[] = [
  {
    id: "memory-risk-limit",
    scope: "workspace",
    title: "First paper deployment should start smaller",
    summary: "For new strategies, the Risk Agent should prefer 10-15% max position before paper validation.",
    sourceMissionId: "mission-ema-paper",
    promoted: false
  },
  {
    id: "memory-spec-first",
    scope: "skill",
    title: "Spec before generated code",
    summary: "Constrained StrategySpec remains the handoff contract before any custom code execution.",
    promoted: true
  }
];

export function getPlatformSnapshot(): PlatformSnapshot {
  return {
    workspace,
    missions,
    agents,
    skills,
    artifacts,
    runSteps,
    memories
  };
}
