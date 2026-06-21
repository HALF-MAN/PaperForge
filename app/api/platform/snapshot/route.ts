import { NextResponse } from "next/server";
import { getPythonSnapshot } from "@/src/platform/python-backend";

export async function GET() {
  return NextResponse.json(await getPythonSnapshot());
}
