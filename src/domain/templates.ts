import type { StrategySpec } from "./schema";

export type StrategyTemplate = {
  id: string;
  name: string;
  summary: string;
  riskProfile: "conservative" | "balanced" | "aggressive";
  spec: StrategySpec;
};

export const strategyTemplates: StrategyTemplate[] = [
  {
    id: "ema-trend-breakout",
    name: "EMA Trend Breakout",
    summary: "Trades trend continuation after EMA20 confirms above EMA60.",
    riskProfile: "balanced",
    spec: {
      id: "spec-ema-trend-breakout-v1",
      source: "library_template",
      name: "EMA Trend Breakout",
      symbol: "BTCUSDT",
      market: "spot",
      timeframe: "1h",
      entry: {
        mode: "all",
        rules: [
          {
            left: "EMA20",
            operator: "crosses_above",
            right: "EMA60",
            description: "EMA20 crosses above EMA60"
          },
          {
            left: "RSI14",
            operator: "less_than",
            right: "70",
            description: "Avoid entering when RSI is already overheated"
          }
        ]
      },
      exit: {
        mode: "any",
        rules: [
          {
            left: "EMA20",
            operator: "crosses_below",
            right: "EMA60",
            description: "EMA20 crosses below EMA60"
          },
          {
            left: "PnL",
            operator: "less_than",
            right: "-3%",
            description: "Stop loss reached"
          }
        ]
      },
      risk: {
        maxPositionPct: 0.2,
        maxLeverage: 1,
        stopLossPct: 0.03,
        takeProfitPct: 0.06,
        maxDailyLossPct: 0.05,
        killSwitchDrawdownPct: 0.12
      },
      tags: ["trend", "ema", "library"]
    }
  },
  {
    id: "rsi-mean-reversion",
    name: "RSI Mean Reversion",
    summary: "Buys oversold pullbacks and exits after momentum normalizes.",
    riskProfile: "conservative",
    spec: {
      id: "spec-rsi-mean-reversion-v1",
      source: "library_template",
      name: "RSI Mean Reversion",
      symbol: "ETHUSDT",
      market: "spot",
      timeframe: "4h",
      entry: {
        mode: "all",
        rules: [
          {
            left: "RSI14",
            operator: "less_than",
            right: "30",
            description: "RSI14 is below 30"
          }
        ]
      },
      exit: {
        mode: "any",
        rules: [
          {
            left: "RSI14",
            operator: "greater_than",
            right: "52",
            description: "RSI14 returns above 52"
          },
          {
            left: "PnL",
            operator: "less_than",
            right: "-2.5%",
            description: "Stop loss reached"
          }
        ]
      },
      risk: {
        maxPositionPct: 0.12,
        maxLeverage: 1,
        stopLossPct: 0.025,
        takeProfitPct: 0.045,
        maxDailyLossPct: 0.035,
        killSwitchDrawdownPct: 0.08
      },
      tags: ["mean-reversion", "rsi", "library"]
    }
  }
];
