import type {
  BacktestReport,
  LiveDryRun,
  PaperSession,
  RiskReport,
  StrategySpec
} from "@/src/domain/schema";

export type AgentTranscriptToolCall = {
  name: string;
  input: string;
  output: string;
};

export type AgentTranscriptEntry = {
  id: string;
  agent: string;
  role: string;
  observation: string;
  reasoning: string;
  action: string;
  result: string;
  handoff: string;
  confidence: "low" | "medium" | "high";
  toolCalls: AgentTranscriptToolCall[];
};

export type AgentTranscriptInput = {
  source: "deterministic" | "bitget_public" | "mock";
  spec: StrategySpec;
  backtest: BacktestReport;
  risk: RiskReport;
  paper?: PaperSession;
  live?: LiveDryRun;
};

export function buildMockAgentTranscript(input: AgentTranscriptInput): AgentTranscriptEntry[] {
  const { backtest, live, paper, risk, source, spec } = input;
  const candleSource = source === "bitget_public" ? "Bitget public candles" : "deterministic fixture data";
  const sampleConfidence = backtest.tradeCount < 5 ? "low" : backtest.tradeCount < 20 ? "medium" : "high";

  return [
    {
      id: "strategy_agent",
      agent: "Strategy Agent",
      role: "Spec compiler",
      observation: `${spec.name} is expressed as ${spec.symbol} ${spec.timeframe} rules with ${spec.entry.rules.length} entry rule and ${spec.exit.rules.length} exit rule.`,
      reasoning: "A constrained Strategy Spec is safer than free-form code because the downstream agents can validate fields before any market action.",
      action: "Compile the strategy into a schema-validated spec and hand it to the backtester.",
      result: `Spec source is ${spec.source}; max position is ${(spec.risk.maxPositionPct * 100).toFixed(0)}%.`,
      handoff: "Backtest Agent should verify whether the rules produce enough historical evidence.",
      confidence: "high",
      toolCalls: [
        {
          name: "compile_strategy_spec",
          input: `${spec.name}, ${spec.symbol}, ${spec.timeframe}`,
          output: `StrategySpec(${spec.id})`
        }
      ]
    },
    {
      id: "backtest_agent",
      agent: "Backtest Agent",
      role: "Historical simulator",
      observation: `The strategy was tested with ${candleSource}; it produced ${backtest.tradeCount} trades and ${backtest.totalReturnPct}% total return.`,
      reasoning:
        backtest.tradeCount < 5
          ? "The trade sample is too small to prove robustness, so the next gate should treat the result as weak evidence."
          : "The sample is usable for a first launch gate, but paper trading is still required before any live path.",
      action: "Run historical simulation and summarize return, drawdown, win rate, and trade count.",
      result: `MDD ${backtest.maxDrawdownPct}%, win rate ${backtest.winRatePct}%, profit factor ${backtest.profitFactor}.`,
      handoff: "Risk Agent should judge whether the result is deployable under the current risk limits.",
      confidence: sampleConfidence,
      toolCalls: [
        {
          name: "fetch_market_candles",
          input: `${spec.symbol}, ${spec.timeframe}, source=${source}`,
          output: source === "bitget_public" ? "300 candles" : "fixture candles"
        },
        {
          name: "run_backtest",
          input: `StrategySpec(${spec.id})`,
          output: `${backtest.tradeCount} trades, ${backtest.totalReturnPct}% return`
        }
      ]
    },
    {
      id: "risk_agent",
      agent: "Risk Agent",
      role: "Deployment gatekeeper",
      observation: risk.issues[0] ?? "No blocking risk issue is currently detected.",
      reasoning:
        risk.decision === "PASS"
          ? "The score clears the launch gate, but the strategy still needs paper evidence and human approval before dry-run."
          : risk.decision === "WARN"
            ? "The strategy can continue to paper mode, but the warning should be resolved before live execution."
            : "The strategy should not proceed because at least one risk constraint is outside the safe launch boundary.",
      action: "Score leverage, position size, drawdown, stop loss coverage, and trade frequency.",
      result: `${risk.decision} with risk score ${risk.riskScore}/100.`,
      handoff:
        risk.decision === "BLOCK"
          ? "Return to Strategy Agent for revision."
          : "Demo Agent can run paper trading with real execution disabled.",
      confidence: risk.decision === "PASS" ? "high" : "medium",
      toolCalls: [
        {
          name: "score_risk",
          input: `position=${(spec.risk.maxPositionPct * 100).toFixed(0)}%, leverage=${spec.risk.maxLeverage}x`,
          output: `${risk.decision}, score=${risk.riskScore}`
        }
      ]
    },
    {
      id: "demo_agent",
      agent: "Demo Agent",
      role: "Paper trader",
      observation: paper
        ? `Paper mode completed ${paper.orderCount} orders with ${paper.pnlPct}% simulated PnL.`
        : "Paper mode has not started yet.",
      reasoning: paper
        ? "Paper results provide execution evidence without touching real funds."
        : "The strategy still needs execution evidence before a human can approve live dry-run.",
      action: paper ? "Record paper orders, PnL, and max drawdown." : "Wait for the user to start the paper session.",
      result: paper ? `Ending balance $${paper.endingBalance.toLocaleString()}; MDD ${paper.maxDrawdownPct}%.` : "No paper orders yet.",
      handoff: paper ? "Review Agent should produce a deployment summary." : "Human should start paper mode if the risk gate is acceptable.",
      confidence: paper ? "medium" : "low",
      toolCalls: [
        {
          name: "start_paper_session",
          input: `StrategySpec(${spec.id})`,
          output: paper ? `${paper.orderCount} audit-only orders` : "waiting"
        }
      ]
    },
    {
      id: "review_agent",
      agent: "Review Agent",
      role: "Evidence synthesizer",
      observation: `Risk gate is ${risk.decision}; paper status is ${paper ? paper.status : "not started"}; live dry-run is ${live ? live.status : "locked"}.`,
      reasoning: live
        ? "The strategy has passed human approval and is only monitoring live market data with execution disabled."
        : "The evidence pack is not sufficient for real execution until paper results and human approval are complete.",
      action: "Prepare the human-readable review report and next recommended action.",
      result: risk.recommendations[0] ?? "Proceed with audit logging and conservative limits.",
      handoff: live ? "Live Agent should keep monitoring and logging." : "Human Supervisor should approve, reject, or request changes.",
      confidence: paper ? "medium" : "low",
      toolCalls: [
        {
          name: "generate_review_report",
          input: `risk=${risk.decision}, paper=${paper ? "completed" : "waiting"}`,
          output: live ? "live dry-run monitor active" : "approval required"
        }
      ]
    }
  ];
}
