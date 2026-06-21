export type SavedStrategyMetrics = {
  totalReturn?: number;
  annualReturn?: number;
  sharpe?: number;
  maxDrawdown?: number;
  winRate?: number;
  tradeCount?: number;
};

export type SavedStrategy = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  status: "active" | "archived";
  visibility: "private" | "published";
  sourceSessionId?: string;
  sourceCodePackageId?: string;
  sourceArtifactId?: string;
  currentVersionId: string;
  versionCount: number;
  symbol: string;
  timeframe: string;
  latestMetrics: SavedStrategyMetrics;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publisherName?: string;
  copyCount?: number;
  sourceMarketplaceStrategyId?: string;
};

export type StrategyVersion = {
  id: string;
  strategyId: string;
  version: number;
  title: string;
  code: string;
  params: Record<string, unknown>;
  metrics: SavedStrategyMetrics;
  backtestConfig: Record<string, unknown>;
  backtestSnapshot: {
    charts?: Record<string, unknown>;
    monthlyReturns?: unknown[];
    trades?: unknown[];
    positions?: unknown[];
    logs?: unknown[];
  };
  sourceArtifactId: string;
  sourceArtifactType: "code_package" | "backtest_run";
  createdAt: string;
};

export type SavedStrategyDetail = {
  strategy: SavedStrategy;
  currentVersion: StrategyVersion | null;
  versions: StrategyVersion[];
};

async function requestJson<T>(path = "", init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/strategies${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Strategy request failed");
  return payload as T;
}

export async function listSavedStrategies() {
  return requestJson<{ strategies: SavedStrategy[] }>();
}

export async function getSavedStrategy(strategyId: string) {
  return requestJson<SavedStrategyDetail>(`/${strategyId}`);
}

export async function saveStrategyFromArtifact(input: {
  artifactId: string;
  name: string;
  description?: string;
  tags?: string[];
}) {
  return requestJson<{
    strategy: SavedStrategy;
    version: StrategyVersion;
    created: boolean;
    versionCreated: boolean;
  }>("/save", { method: "POST", body: JSON.stringify(input) });
}

export async function updateSavedStrategy(
  strategyId: string,
  patch: Partial<Pick<SavedStrategy, "name" | "description" | "tags" | "status" | "visibility" | "publisherName">>,
) {
  return requestJson<{ strategy: SavedStrategy }>(`/${strategyId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function listMarketplaceStrategies() {
  return requestMarketplaceJson<{ strategies: SavedStrategy[] }>();
}

export async function getMarketplaceStrategy(strategyId: string) {
  return requestMarketplaceJson<{
    strategy: SavedStrategy;
    currentVersion: Omit<StrategyVersion, "code" | "sourceArtifactId" | "sourceArtifactType"> | null;
  }>(`/${strategyId}`);
}

export async function copyMarketplaceStrategy(strategyId: string) {
  return requestMarketplaceJson<{ strategy: SavedStrategy; version: StrategyVersion }>(
    `/${strategyId}/copy`,
    { method: "POST" },
  );
}

async function requestMarketplaceJson<T>(path = "", init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/marketplace${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Marketplace request failed");
  return payload as T;
}
