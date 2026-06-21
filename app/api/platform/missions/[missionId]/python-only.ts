import { NextResponse } from "next/server";

export function pythonBackendOnlyResponse() {
  return NextResponse.json(
    {
      error: "This single-agent endpoint has moved behind the Python backend. Use POST /api/platform/missions/[missionId]/continue."
    },
    { status: 410 }
  );
}

