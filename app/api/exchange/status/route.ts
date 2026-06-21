import { NextResponse } from "next/server";
import { getExchangeAdapter } from "@/src/exchange";

export async function GET() {
  const adapter = getExchangeAdapter("bitget_public");
  return NextResponse.json(adapter.getStatus());
}
