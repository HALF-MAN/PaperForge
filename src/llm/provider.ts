import { z } from "zod";

export type LlmJsonRequest = {
  system: string;
  user: string;
  temperature?: number;
};

export type LlmJsonResponse<T> = {
  data: T;
  provider: string;
  model: string;
};

export interface LlmProvider {
  readonly provider: string;
  readonly model: string;
  generateJson<T>(request: LlmJsonRequest, schema: z.ZodType<T>): Promise<LlmJsonResponse<T>>;
}

const OpenAiCompatibleResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string()
      })
    })
  )
});

export function getLlmProvider(): LlmProvider | null {
  const provider = process.env.LLM_PROVIDER ?? "dashscope";

  if (provider !== "dashscope") {
    return null;
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const model = process.env.DASHSCOPE_MODEL ?? "qwen-plus";

  if (!apiKey) {
    return null;
  }

  return new OpenAiCompatibleProvider({
    apiKey,
    baseUrl,
    model,
    provider: "dashscope"
  });
}

class OpenAiCompatibleProvider implements LlmProvider {
  readonly provider: string;
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; baseUrl: string; model: string; provider: string }) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.provider = options.provider;
  }

  async generateJson<T>(request: LlmJsonRequest, schema: z.ZodType<T>): Promise<LlmJsonResponse<T>> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user }
        ],
        temperature: request.temperature ?? 0.2,
        max_tokens: 1800,
        response_format: { type: "json_object" }
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`LLM request failed: ${response.status} ${message.slice(0, 240)}`);
    }

    const payload = OpenAiCompatibleResponseSchema.parse(await response.json());
    const content = payload.choices[0]?.message.content;

    if (!content) {
      throw new Error("LLM response did not include message content.");
    }

    return {
      data: schema.parse(parseJsonContent(content)),
      provider: this.provider,
      model: this.model
    };
  }
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);

    if (match?.[1]) {
      return JSON.parse(match[1].trim());
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new Error("LLM response is not valid JSON.");
  }
}
