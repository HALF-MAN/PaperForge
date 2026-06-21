import { NextRequest, NextResponse } from "next/server";
import { getExchangeAdapter } from "@/src/exchange";
import type { CandleRequest } from "@/src/exchange/types";

const allowedGranularity = new Set(["1min", "5min", "15min", "30min", "1h", "4h", "1day"]);

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") ?? "BTCUSDT";
  const granularityParam = request.nextUrl.searchParams.get("granularity") ?? "1h";
  const granularity = allowedGranularity.has(granularityParam)
    ? (granularityParam as CandleRequest["granularity"])
    : "1h";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  const source = request.nextUrl.searchParams.get("source") ?? "bitget_public";
  const adapter = getExchangeAdapter(source);
  const candles = await adapter.getCandles({
    symbol,
    granularity,
    limit: Math.min(Math.max(limit, 1), 1000)
  });

  return NextResponse.json({ data: candles });
}
