import { z } from "zod";

export const StrategySourceSchema = z.enum([
  "library_template",
  "custom_spec",
  "custom_code"
]);

export const MarketSchema = z.enum(["spot", "futures"]);

export const TimeframeSchema = z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]);

export const RuleOperatorSchema = z.enum([
  "crosses_above",
  "crosses_below",
  "greater_than",
  "less_than"
]);

export const RuleSchema = z.object({
  left: z.string(),
  operator: RuleOperatorSchema,
  right: z.string(),
  description: z.string()
});

export const RuleGroupSchema = z.object({
  mode: z.enum(["all", "any"]),
  rules: z.array(RuleSchema).min(1)
});

export const StrategySpecSchema = z.object({
  id: z.string(),
  source: StrategySourceSchema,
  name: z.string(),
  symbol: z.string(),
  market: MarketSchema,
  timeframe: TimeframeSchema,
  entry: RuleGroupSchema,
  exit: RuleGroupSchema,
  risk: z.object({
    maxPositionPct: z.number().min(0).max(1),
    maxLeverage: z.number().min(1).max(20),
    stopLossPct: z.number().min(0).max(1).optional(),
    takeProfitPct: z.number().min(0).max(1).optional(),
    maxDailyLossPct: z.number().min(0).max(1).optional(),
    killSwitchDrawdownPct: z.number().min(0).max(1).optional()
  }),
  tags: z.array(z.string()).default([])
});

export const BacktestReportSchema = z.object({
  totalReturnPct: z.number(),
  maxDrawdownPct: z.number(),
  winRatePct: z.number(),
  tradeCount: z.number().int().nonnegative(),
  profitFactor: z.number(),
  averageTradePct: z.number()
});

export const RiskDecisionSchema = z.enum(["PASS", "WARN", "BLOCK"]);

export const RiskReportSchema = z.object({
  decision: RiskDecisionSchema,
  riskScore: z.number().min(0).max(100),
  issues: z.array(z.string()),
  recommendations: z.array(z.string())
});

export const PaperOrderSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  price: z.number(),
  size: z.number(),
  reason: z.string()
});

export const PaperSessionSchema = z.object({
  id: z.string(),
  startingBalance: z.number(),
  endingBalance: z.number(),
  pnlPct: z.number(),
  maxDrawdownPct: z.number(),
  orderCount: z.number().int().nonnegative(),
  status: z.enum(["completed", "paused", "blocked"]),
  orders: z.array(PaperOrderSchema)
});

export const ApprovalDecisionSchema = z.enum(["approved", "rejected", "changes_requested"]);

export const LiveDryRunSchema = z.object({
  id: z.string(),
  mode: z.literal("live_dry_run"),
  status: z.enum(["monitoring", "paused", "completed"]),
  realMarketData: z.boolean(),
  realOrderExecution: z.boolean(),
  maxPositionPct: z.number().min(0).max(1),
  killSwitchArmed: z.boolean(),
  observations: z.array(z.string())
});

export const AgentEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  agent: z.string(),
  type: z.enum(["input", "output", "decision", "order", "risk", "error"]),
  message: z.string(),
  createdAt: z.string()
});

export const PipelineRunSchema = z.object({
  id: z.string(),
  status: z.enum([
    "created",
    "backtesting",
    "paper_running",
    "reviewing",
    "awaiting_approval",
    "live_dry_run",
    "paused",
    "completed",
    "blocked"
  ]),
  currentAgent: z.string(),
  strategyVersionId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type StrategySource = z.infer<typeof StrategySourceSchema>;
export type StrategySpec = z.infer<typeof StrategySpecSchema>;
export type BacktestReport = z.infer<typeof BacktestReportSchema>;
export type RiskReport = z.infer<typeof RiskReportSchema>;
export type PaperOrder = z.infer<typeof PaperOrderSchema>;
export type PaperSession = z.infer<typeof PaperSessionSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type LiveDryRun = z.infer<typeof LiveDryRunSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type PipelineRun = z.infer<typeof PipelineRunSchema>;
