import { StrategySpecSchema, type StrategySpec } from "@/src/domain/schema";

export type CompileResult = {
  spec: StrategySpec;
  notes: string[];
};

export function compileCustomStrategy(input: string): CompileResult {
  const normalized = input.toLowerCase();
  const symbol = normalized.includes("eth") ? "ETHUSDT" : "BTCUSDT";
  const timeframe = normalized.includes("4h") || normalized.includes("4小时") ? "4h" : "1h";
  const maxPositionPct = extractPercent(normalized, ["仓位", "position"], 0.15);
  const stopLossPct = extractPercent(normalized, ["止损", "stop"], 0.03);
  const maxLeverage = extractLeverage(normalized);
  const notes: string[] = [];

  if (normalized.includes("rsi")) {
    notes.push("Matched custom_spec path: RSI mean-reversion strategy.");

    return {
      notes,
      spec: StrategySpecSchema.parse({
        id: `spec-custom-rsi-${Date.now()}`,
        source: "custom_spec",
        name: "Custom RSI Mean Reversion",
        symbol,
        market: "spot",
        timeframe,
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
              description: "RSI14 recovers above 52"
            },
            {
              left: "PnL",
              operator: "less_than",
              right: `-${formatPct(stopLossPct)}`,
              description: "Stop loss reached"
            }
          ]
        },
        risk: {
          maxPositionPct,
          maxLeverage,
          stopLossPct,
          takeProfitPct: stopLossPct * 1.8,
          maxDailyLossPct: stopLossPct * 1.5,
          killSwitchDrawdownPct: stopLossPct * 4
        },
        tags: ["custom", "rsi", "spec"]
      })
    };
  }

  notes.push("Matched custom_spec path: EMA trend strategy.");

  return {
    notes,
    spec: StrategySpecSchema.parse({
      id: `spec-custom-ema-${Date.now()}`,
      source: "custom_spec",
      name: "Custom EMA Trend Strategy",
      symbol,
      market: "spot",
      timeframe,
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
            description: "Avoid entering when RSI is overheated"
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
            right: `-${formatPct(stopLossPct)}`,
            description: "Stop loss reached"
          }
        ]
      },
      risk: {
        maxPositionPct,
        maxLeverage,
        stopLossPct,
        takeProfitPct: stopLossPct * 2,
        maxDailyLossPct: stopLossPct * 1.5,
        killSwitchDrawdownPct: stopLossPct * 4
      },
      tags: ["custom", "ema", "spec"]
    })
  };
}

function extractPercent(input: string, keywords: string[], fallback: number): number {
  for (const keyword of keywords) {
    const index = input.indexOf(keyword);
    if (index === -1) {
      continue;
    }

    const window = input.slice(Math.max(0, index - 16), index + 24);
    const match = window.match(/(\d+(?:\.\d+)?)\s*%/);
    if (match?.[1]) {
      return Number(match[1]) / 100;
    }
  }

  const anyPercent = input.match(/(\d+(?:\.\d+)?)\s*%/);
  return anyPercent?.[1] ? Number(anyPercent[1]) / 100 : fallback;
}

function extractLeverage(input: string): number {
  const match = input.match(/(\d+(?:\.\d+)?)\s*(x|倍)/);
  if (!match?.[1]) {
    return 1;
  }

  return Math.max(1, Math.min(20, Number(match[1])));
}

function formatPct(value: number): string {
  return `${Number((value * 100).toFixed(2))}%`;
}
