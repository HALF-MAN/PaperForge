import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const baseUrl = process.env.PAPERFORGE_PY_BACKEND_URL ?? "http://127.0.0.1:8765";

  try {
    const response = await fetch(`${baseUrl}/sandbox/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Python sandbox backend is unavailable",
        backtest: null,
      },
      { status: 502 },
    );
  }
}
