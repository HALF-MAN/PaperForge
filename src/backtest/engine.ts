import { BacktestReportSchema, type BacktestReport, type StrategySpec } from "@/src/domain/schema";
import type { Candle } from "@/src/exchange/types";
import { ema, rsi } from "./indicators";

type Position = {
  entryPrice: number;
  sizePct: number;
};

type Trade = {
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
};

export function runCandleBacktest(spec: StrategySpec, candles: Candle[]): BacktestReport {
  if (candles.length < 70) {
    throw new Error("At least 70 candles are required for EMA/RSI backtest.");
  }

  const closes = candles.map((candle) => candle.close);
  const ema20 = ema(closes, 20);
  const ema60 = ema(closes, 60);
  const rsi14 = rsi(closes, 14);
  const trades: Trade[] = [];
  const equityCurve: number[] = [1];
  let equity = 1;
  let peak = 1;
  let maxDrawdownPct = 0;
  let position: Position | null = null;

  for (let index = 61; index < candles.length; index += 1) {
    const previousFast = ema20[index - 1];
    const previousSlow = ema60[index - 1];
    const currentFast = ema20[index];
    const currentSlow = ema60[index];
    const currentRsi = rsi14[index];
    const price = closes[index];

    if (
      previousFast === null ||
      previousSlow === null ||
      currentFast === null ||
      currentSlow === null ||
      currentRsi === null
    ) {
      continue;
    }

    if (!position && shouldEnter(spec, previousFast, previousSlow, currentFast, currentSlow, currentRsi)) {
      position = {
        entryPrice: price,
        sizePct: spec.risk.maxPositionPct
      };
      equityCurve.push(equity);
      continue;
    }

    if (position && shouldExit(spec, position.entryPrice, price, previousFast, previousSlow, currentFast, currentSlow, currentRsi)) {
      const rawReturnPct = (price - position.entryPrice) / position.entryPrice;
      const feeAdjustedReturnPct = rawReturnPct - 0.002;
      const portfolioReturnPct = feeAdjustedReturnPct * position.sizePct * spec.risk.maxLeverage;

      equity *= 1 + portfolioReturnPct;
      peak = Math.max(peak, equity);
      maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
      trades.push({
        entryPrice: position.entryPrice,
        exitPrice: price,
        returnPct: portfolioReturnPct * 100
      });
      equityCurve.push(equity);
      position = null;
    } else {
      equityCurve.push(equity);
    }
  }

  if (position) {
    const finalPrice = closes[closes.length - 1];
    const rawReturnPct = (finalPrice - position.entryPrice) / position.entryPrice;
    const portfolioReturnPct = (rawReturnPct - 0.002) * position.sizePct * spec.risk.maxLeverage;
    equity *= 1 + portfolioReturnPct;
    trades.push({
      entryPrice: position.entryPrice,
      exitPrice: finalPrice,
      returnPct: portfolioReturnPct * 100
    });
  }

  const winningTrades = trades.filter((trade) => trade.returnPct > 0);
  const grossProfit = trades.filter((trade) => trade.returnPct > 0).reduce((sum, trade) => sum + trade.returnPct, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.returnPct < 0).reduce((sum, trade) => sum + trade.returnPct, 0));
  const totalReturnPct = (equity - 1) * 100;

  return BacktestReportSchema.parse({
    totalReturnPct: round(totalReturnPct),
    maxDrawdownPct: round(maxDrawdownPct),
    winRatePct: trades.length ? round((winningTrades.length / trades.length) * 100) : 0,
    tradeCount: trades.length,
    profitFactor: grossLoss === 0 ? round(grossProfit || 1) : round(grossProfit / grossLoss),
    averageTradePct: trades.length ? round(trades.reduce((sum, trade) => sum + trade.returnPct, 0) / trades.length) : 0
  });
}

function shouldEnter(
  spec: StrategySpec,
  previousFast: number,
  previousSlow: number,
  currentFast: number,
  currentSlow: number,
  currentRsi: number
): boolean {
  if (spec.tags.includes("rsi")) {
    return currentRsi < 30;
  }

  return previousFast <= previousSlow && currentFast > currentSlow && currentRsi < 70;
}

function shouldExit(
  spec: StrategySpec,
  entryPrice: number,
  price: number,
  previousFast: number,
  previousSlow: number,
  currentFast: number,
  currentSlow: number,
  currentRsi: number
): boolean {
  const pnlPct = (price - entryPrice) / entryPrice;

  if (spec.risk.stopLossPct && pnlPct <= -spec.risk.stopLossPct) {
    return true;
  }

  if (spec.risk.takeProfitPct && pnlPct >= spec.risk.takeProfitPct) {
    return true;
  }

  if (spec.tags.includes("rsi")) {
    return currentRsi > 52;
  }

  return previousFast >= previousSlow && currentFast < currentSlow;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
