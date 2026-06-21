import { NextRequest, NextResponse } from "next/server";
import { getExchangeAdapter } from "@/src/exchange";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") ?? "BTCUSDT";
  const source = request.nextUrl.searchParams.get("source") ?? "bitget_public";
  const adapter = getExchangeAdapter(source);
  const ticker = await adapter.getTicker(symbol);

  return NextResponse.json(ticker);
}
