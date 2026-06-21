import { NextRequest, NextResponse } from "next/server";
import { StrategySpecSchema } from "@/src/domain/schema";
import { getExchangeAdapter } from "@/src/exchange";
import type { CandleRequest } from "@/src/exchange/types";
import { runCandleBacktest } from "@/src/backtest/engine";

const timeframeToGranularity: Record<string, CandleRequest["granularity"]> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day"
};

export async function POST(request: NextRequest) {
  const body = await request.json();
  const spec = StrategySpecSchema.parse(body.spec);
  const source = typeof body.source === "string" ? body.source : "bitget_public";
  const adapter = getExchangeAdapter(source);
  const candles = await adapter.getCandles({
    symbol: spec.symbol,
    granularity: timeframeToGranularity[spec.timeframe] ?? "1h",
    limit: 300
  });
  const report = runCandleBacktest(spec, candles);

  return NextResponse.json({
    source,
    candleCount: candles.length,
    report
  });
}
