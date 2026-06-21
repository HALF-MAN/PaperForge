import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  buildMockAgentTranscript,
  type AgentTranscriptInput
} from "@/src/agents/transcript";
import {
  BacktestReportSchema,
  LiveDryRunSchema,
  PaperSessionSchema,
  RiskReportSchema,
  StrategySpecSchema
} from "@/src/domain/schema";
import { getLlmProvider } from "@/src/llm/provider";

const TranscriptToolCallSchema = z.object({
  name: z.string(),
  input: z.string(),
  output: z.string()
});

const TranscriptEntrySchema = z.object({
  id: z.string(),
  agent: z.string(),
  role: z.string(),
  observation: z.string(),
  reasoning: z.string(),
  action: z.string(),
  result: z.string(),
  handoff: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  toolCalls: z.array(TranscriptToolCallSchema)
});

const TranscriptResponseSchema = z.object({
  entries: z.array(TranscriptEntrySchema).min(4).max(7)
});

const TranscriptRequestSchema = z.object({
  source: z.enum(["deterministic", "bitget_public", "mock"]),
  spec: StrategySpecSchema,
  backtest: BacktestReportSchema,
  risk: RiskReportSchema,
  paper: PaperSessionSchema.optional(),
  live: LiveDryRunSchema.optional()
});

export async function POST(request: NextRequest) {
  const input = TranscriptRequestSchema.parse(await request.json()) satisfies AgentTranscriptInput;
  const fallbackEntries = buildMockAgentTranscript(input);
  const provider = getLlmProvider();

  if (!provider) {
    return NextResponse.json({
      provider: "mock",
      model: "local-deterministic",
      entries: fallbackEntries
    });
  }

  try {
    const response = await provider.generateJson(
      {
        system:
          "You are PaperForge's multi-agent coordinator. Return only valid JSON. Do not include markdown. Use only facts from the input payload. Do not invent dates, candle counts, filenames, session IDs, approvals, paper sessions, or live status. Do not recommend real-money execution. Keep all trading actions behind human approval.",
        user: buildTranscriptPrompt(input),
        temperature: 0.2
      },
      TranscriptResponseSchema
    );

    return NextResponse.json({
      provider: response.provider,
      model: response.model,
      entries: response.data.entries
    });
  } catch (error) {
    return NextResponse.json({
      provider: "mock",
      model: "local-deterministic",
      warning: error instanceof Error ? error.message : "LLM transcript generation failed.",
      entries: fallbackEntries
    });
  }
}

function buildTranscriptPrompt(input: AgentTranscriptInput) {
  return `
Generate an Agent Transcript for PaperForge.

PaperForge is a multi-agent launch gate for trading strategies. It validates a strategy before paper trading, human approval, and live dry-run. Real order execution is disabled unless a separate human approval is granted.

Return JSON with this exact shape:
{
  "entries": [
    {
      "id": "strategy_agent",
      "agent": "Strategy Agent",
      "role": "Spec compiler",
      "observation": "...",
      "reasoning": "...",
      "action": "...",
      "result": "...",
      "handoff": "...",
      "confidence": "low|medium|high",
      "toolCalls": [
        { "name": "compile_strategy_spec", "input": "...", "output": "..." }
      ]
    }
  ]
}

Required agents:
- Strategy Agent
- Backtest Agent
- Risk Agent
- Demo Agent
- Review Agent

Write concise English UI copy. Make it feel like real agent work:
- Observation: evidence the agent saw.
- Reasoning: why the agent made the decision.
- Action: tool or next step.
- Result: key output.
- Handoff: who receives the task next and why.

Hard constraints:
- Use only values present in the input JSON.
- If paper is missing, Demo Agent must say paper trading has not started.
- If live is missing, Review Agent must say live dry-run is locked or pending approval.
- Do not mention PDFs, external files, arbitrary session IDs, historical date ranges, or candle counts unless they appear in the input JSON.
- Do not claim a risk recommendation was already applied unless the input shows a changed spec.

Use these known tool names when relevant:
- compile_strategy_spec
- fetch_market_candles
- run_backtest
- score_risk
- start_paper_session
- generate_review_report
- request_human_approval
- prepare_live_dry_run

Input:
${JSON.stringify(input, null, 2)}
`.trim();
}
