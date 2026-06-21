import { NextRequest, NextResponse } from "next/server";
import { advancePythonMission, getPythonLatestRun, getPythonMission } from "@/src/platform/python-backend";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ missionId: string }> }) {
  const { missionId } = await params;
  const run = await getPythonLatestRun(missionId);

  return NextResponse.json({ run });
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ missionId: string }> }) {
  const { missionId } = await params;
  const mission = await getPythonMission(missionId);

  if (!mission) {
    return NextResponse.json({ error: `Mission not found: ${missionId}` }, { status: 404 });
  }

  const run = await advancePythonMission(mission.id);

  return NextResponse.json({ run, runtime: "python-step-runtime" });
}
