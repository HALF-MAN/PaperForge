import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

async function proxyMarketplace(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const baseUrl = process.env.PAPERFORGE_PY_BACKEND_URL ?? "http://127.0.0.1:8765";
  const suffix = path.length ? `/${path.join("/")}` : "";
  try {
    const body = request.method === "GET" ? undefined : await request.text();
    const response = await fetch(`${baseUrl}/marketplace${suffix}`, {
      method: request.method,
      headers: { "content-type": "application/json" },
      body: body || undefined,
      signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Python backend is unavailable" },
      { status: 502 },
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxyMarketplace(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxyMarketplace(request, context);
}
