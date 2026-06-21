export type StrategyLabSession = {
  id: string;
  title: string;
  subtitle: string;
  createdAt: string;
  updatedAt: string;
  activeArtifactId?: string | null;
  feed?: StrategyLabFeedItem[];
};

export type StrategyLabFeedItem =
  | {
      id: string;
      kind: "message";
      messageId: string;
    }
  | {
      id: string;
      kind: "artifact";
      artifactId: string;
    };

export type StrategyLabMessage = {
  id: string;
  sessionId: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
  toolTrace?: StrategyLabProgressEvent[];
};

export type StrategyLabProgressEvent = {
  tool: string;
  status: "running" | "completed" | "failed";
  summary?: string;
  startedAt?: string;
  completedAt?: string;
};

export type StrategyLabMessageJob<TArtifact> = {
  id: string;
  sessionId: string;
  status: "running" | "completed" | "failed";
  events: StrategyLabProgressEvent[];
  detail?: StrategyLabDetail<TArtifact>;
  error?: string;
};

export type StrategyLabDetail<TArtifact> = {
  session: StrategyLabSession;
  messages: StrategyLabMessage[];
  artifacts: TArtifact[];
  feed: StrategyLabFeedItem[];
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/strategy-lab${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Strategy Lab API request failed");
  }
  return payload as T;
}

export async function listStrategyLabSessions() {
  return requestJson<{ sessions: StrategyLabSession[] }>("/sessions");
}

export async function createStrategyLabSession(title?: string) {
  return requestJson<StrategyLabDetail<unknown>>("/sessions", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function getStrategyLabSession<TArtifact>(sessionId: string) {
  return requestJson<StrategyLabDetail<TArtifact>>(`/sessions/${sessionId}`);
}

export async function createStrategyLabMessage<TArtifact>(
  sessionId: string,
  content: string,
) {
  return requestJson<StrategyLabDetail<TArtifact>>(`/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function startStrategyLabMessage<TArtifact>(
  sessionId: string,
  content: string,
) {
  return requestJson<{ job: StrategyLabMessageJob<TArtifact> }>(
    `/sessions/${sessionId}/messages/async`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
  );
}

export async function getStrategyLabMessageJob<TArtifact>(jobId: string) {
  return requestJson<{ job: StrategyLabMessageJob<TArtifact> }>(`/jobs/${jobId}`);
}

export async function updateStrategyLabArtifact(
  artifactId: string,
  patch: Record<string, unknown>,
) {
  return requestJson<{ artifact: unknown }>(`/artifacts/${artifactId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function runStrategyLabArtifact<TArtifact>(
  artifactId: string,
  payload: Record<string, unknown>,
) {
  return requestJson<{
    success: boolean;
    artifact: TArtifact;
    session: StrategyLabSession;
    message: StrategyLabMessage;
  }>(`/artifacts/${artifactId}/run`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function analyzeStrategyLabArtifact<TArtifact>(
  artifactId: string,
) {
  return requestJson<{
    success: boolean;
    artifact: TArtifact;
    message: StrategyLabMessage;
    analysis: {
      isSatisfactory: boolean;
      diagnosis: string;
      recommendations: string[];
      metricsSummary: string;
      shouldOptimize: boolean;
      suggestedParams: Record<string, unknown>;
    };
  }>(`/artifacts/${artifactId}/analyze`, {
    method: "POST",
  });
}
