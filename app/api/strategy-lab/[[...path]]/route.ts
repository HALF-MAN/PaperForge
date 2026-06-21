import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

async function proxyStrategyLab(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const baseUrl = process.env.PAPERFORGE_PY_BACKEND_URL ?? "http://127.0.0.1:8765";
  const targetUrl = `${baseUrl}/strategy-lab/${path.join("/")}`;

  try {
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.text();
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        "content-type": request.headers.get("content-type") ?? "application/json",
      },
      body: body || undefined,
      signal: AbortSignal.timeout(Number(process.env.STRATEGY_LAB_PROXY_TIMEOUT_MS ?? 130000)),
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Python Strategy Lab backend is unavailable",
      },
      { status: 502 },
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxyStrategyLab(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxyStrategyLab(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxyStrategyLab(request, context);
}
