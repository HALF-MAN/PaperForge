import type { AgentEvent, BacktestReport, PipelineRun, RiskReport } from "./schema";

export const mockPipelineRun: PipelineRun = {
  id: "run_001",
  status: "awaiting_approval",
  currentAgent: "Review Agent",
  strategyVersionId: "spec-ema-trend-breakout-v1",
  createdAt: "2026-05-30T03:10:00.000Z",
  updatedAt: "2026-05-30T03:18:00.000Z"
};

export const mockBacktestReport: BacktestReport = {
  totalReturnPct: 18.4,
  maxDrawdownPct: 9.7,
  winRatePct: 54.2,
  tradeCount: 31,
  profitFactor: 1.42,
  averageTradePct: 0.59
};

export const mockRiskReport: RiskReport = {
  decision: "WARN",
  riskScore: 74,
  issues: [
    "Max drawdown is below the hard block threshold but still close to the balanced profile limit.",
    "Trade frequency increases during sideways market regimes."
  ],
  recommendations: [
    "Reduce max position from 20% to 15% before live dry-run.",
    "Require volatility filter confirmation before opening new positions."
  ]
};

export const mockAgentEvents: AgentEvent[] = [
  {
    id: "evt_001",
    runId: "run_001",
    agent: "Strategy Agent",
    type: "output",
    message: "Generated Strategy Spec from library template EMA Trend Breakout.",
    createdAt: "2026-05-30T03:11:00.000Z"
  },
  {
    id: "evt_002",
    runId: "run_001",
    agent: "Backtest Agent",
    type: "decision",
    message: "Backtest completed on BTCUSDT 1h fixture with 31 simulated trades.",
    createdAt: "2026-05-30T03:13:00.000Z"
  },
  {
    id: "evt_003",
    runId: "run_001",
    agent: "Risk Agent",
    type: "risk",
    message: "Decision WARN with risk score 74. Live execution requires human approval.",
    createdAt: "2026-05-30T03:15:00.000Z"
  },
  {
    id: "evt_004",
    runId: "run_001",
    agent: "Review Agent",
    type: "decision",
    message: "Recommended paper trading first, then live dry-run with reduced position size.",
    createdAt: "2026-05-30T03:18:00.000Z"
  }
];
