from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


# ===== 现有模型（重构为 Pydantic） =====

RiskDecision = Literal["PASS", "WARN", "BLOCK"]
EventStatus = Literal["started", "completed", "stopped", "blocked", "error"]
RunStatus = Literal["advanced", "blocked", "awaiting_human", "idle", "error"]


class Rule(BaseModel):
    """规则定义"""
    left: str
    operator: str
    right: str
    description: str


class RuleGroup(BaseModel):
    """规则组"""
    mode: Literal["all", "any"]
    rules: List[Rule]


class StrategyRisk(BaseModel):
    """策略风控参数"""
    max_position_pct: float
    max_leverage: float
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    max_daily_loss_pct: Optional[float] = None
    kill_switch_drawdown_pct: Optional[float] = None


class StrategySpec(BaseModel):
    """策略规格"""
    id: str
    source: Literal["library_template", "custom_spec", "custom_code"]
    name: str
    symbol: str
    market: Literal["spot", "futures"]
    timeframe: Literal["1m", "5m", "15m", "1h", "4h", "1d"]
    entry: RuleGroup
    exit: RuleGroup
    risk: StrategyRisk
    tags: List[str] = Field(default_factory=list)


class BacktestReport(BaseModel):
    """回测报告"""
    total_return_pct: float
    max_drawdown_pct: float
    win_rate_pct: float
    trade_count: int
    profit_factor: float
    average_trade_pct: float


class RiskReport(BaseModel):
    """风险评估报告"""
    decision: RiskDecision
    risk_score: float
    issues: List[str]
    recommendations: List[str]


class PaperOrder(BaseModel):
    """模拟盘订单"""
    id: str
    symbol: str
    side: Literal["buy", "sell"]
    price: float
    size: float
    reason: str


class PaperSession(BaseModel):
    """模拟盘会话"""
    id: str
    starting_balance: float
    ending_balance: float
    pnl_pct: float
    max_drawdown_pct: float
    order_count: int
    status: Literal["completed", "paused", "blocked"]
    orders: List[PaperOrder]


class MissionInput(BaseModel):
    """任务输入"""
    mission_id: str
    title: str
    objective: str
    strategy: Optional[StrategySpec] = None


class OrchestratorEvent(BaseModel):
    """编排器事件"""
    agent: str
    step: str
    action: str
    status: EventStatus
    summary: str


class QuantMissionResult(BaseModel):
    """量化任务结果"""
    mission_id: str
    status: RunStatus
    stop_reason: str
    framework: str
    strategy: StrategySpec
    backtest: BacktestReport
    risk: RiskReport
    paper: Optional[PaperSession] = None
    events: List[OrchestratorEvent]

    def to_dict(self) -> dict[str, Any]:
        """转换为字典（兼容旧代码）"""
        return self.model_dump()


# ===== 新增模型（根据 architecture.md） =====


class AgentConfig(BaseModel):
    """Agent 配置 - 根据 architecture.md 第 57-63 行"""
    role: str  # 角色名称：如"因子研究员"
    goal: str  # 目标描述
    backstory: str  # 背景故事（引导 LLM 行为）
    tools: List[str]  # 工具清单：["fetch_market_data", "factor_calculator"]
    llm_model: str  # 模型：gpt-4o / claude-3.5 等


class TaskConfig(BaseModel):
    """任务配置 - 根据 architecture.md 第 65-72 行"""
    name: str  # 任务标识：factor_mining / strategy / backtest
    description: str  # 任务描述（支持模板变量：{factors}）
    expected_output: str  # 期望输出格式
    agent_role: str  # 分配给哪个 Agent
    inputs: Dict[str, str]  # 输入来源：state:xxx / memory:xxx / prev:task_name
    outputs: List[str]  # 输出字段清单


class ExecutionPlan(BaseModel):
    """执行计划 - 根据 architecture.md 第 74-82 行"""
    task_id: str
    task_summary: str
    agents: List[AgentConfig]
    tasks: List[TaskConfig]  # 执行顺序即列表顺序
    flow_type: str  # sequential / hierarchical / conditional
    risk_level: str  # low / medium / high
    memory_scope: str  # 根 scope，如 /quant/20240607_001
    constraints: str  # 约束条件文本


class QuantState(BaseModel):
    """流水线状态 - 根据 architecture.md 第 86-117 行"""
    # 基础标识
    run_id: str
    task_description: str
    created_at: str

    # 阶段机（用于幂等检查）
    current_phase: Literal[
        "init", "planning", "factor_mining", "strategy", "backtest",
        "risk_audit", "paper_trading", "live_decision", "done", "failed"
    ]

    # Planner 生成的计划（必须持久化，恢复时需要重建工作流）
    plan: Optional[ExecutionPlan] = None

    # 各阶段结果（动态字段）
    result_factor_mining: Optional[Dict[str, Any]] = None
    result_strategy: Optional[Dict[str, Any]] = None
    result_backtest: Optional[Dict[str, Any]] = None
    result_risk_audit: Optional[Dict[str, Any]] = None
    result_paper_trading: Optional[Dict[str, Any]] = None
    result_live_decision: Optional[Dict[str, Any]] = None

    # 人工审核状态
    audit_checkpoint_id: Optional[str] = None
    audit_status: Optional[str] = None  # pending / approved / rejected / modified / timeout

    # 错误追踪
    errors: List[Dict[str, Any]] = Field(default_factory=list)
    retry_count: Dict[str, int] = Field(default_factory=dict)


class AuditCheckpoint(BaseModel):
    """人工审核检查点 - 根据 architecture.md 第 121-133 行"""
    checkpoint_id: str
    run_id: str
    stage: str  # risk_audit / live_decision
    status: str  # pending / approved / rejected / modified / timeout
    auditor: Optional[str] = None
    comment: Optional[str] = None
    modified_data: Optional[Dict[str, Any]] = None  # 人工修改的内容
    submitted_at: str
    timeout_at: str
    resolved_at: Optional[str] = None


# ===== 记忆系统数据模型（Phase 2） =====


class MemoryRecord(BaseModel):
    """记忆记录 - LanceDB 存储模型"""
    id: str
    scope: str  # Scope 路径：/planning/{task_id}, /factor/library 等
    title: str
    summary: str
    content: str  # 详细内容
    source_mission_id: Optional[str] = None
    promoted: bool = False  # 是否为永久级记忆
    created_at: str
    updated_at: str

    # 保留 embedding 字段（后续添加向量搜索时使用）
    # embedding: Optional[List[float]] = None


# ===== 策略知识库数据模型 =====


class StrategySource(BaseModel):
    """A traceable external or manually curated source for a strategy card."""

    id: str
    strategy_card_id: str
    provider: Literal["freqtrade", "hummingbot", "quantconnect", "qlib", "manual"]
    source_type: Literal["documentation", "repository", "paper", "manual"]
    title: str
    source_url: str
    source_version: str = ""
    authors: List[str] = Field(default_factory=list)
    license: str = "unknown"
    attribution_required: bool = True
    retrieved_at: str
    content_hash: str = ""


class StrategyParameter(BaseModel):
    """A tunable parameter described by the reference strategy."""

    name: str
    description: str
    value_type: Literal["int", "float", "str", "bool"]
    default: Any = None
    minimum: Optional[float] = None
    maximum: Optional[float] = None


class StrategyCard(BaseModel):
    """Normalized strategy knowledge; never treated as directly executable code."""

    id: str
    name: str
    aliases: List[str] = Field(default_factory=list)
    family: str
    summary: str
    thesis: str
    markets: List[str] = Field(default_factory=list)
    timeframes: List[str] = Field(default_factory=list)
    regimes: List[str] = Field(default_factory=list)
    trends: List[str] = Field(default_factory=list)
    volatility: List[str] = Field(default_factory=list)
    directions: List[str] = Field(default_factory=list)
    required_data: List[str] = Field(default_factory=list)
    optional_data: List[str] = Field(default_factory=list)
    indicators: List[str] = Field(default_factory=list)
    entry_logic: str
    exit_logic: str
    risk_controls: List[str] = Field(default_factory=list)
    parameters: List[StrategyParameter] = Field(default_factory=list)
    failure_modes: List[str] = Field(default_factory=list)
    validation_requirements: List[str] = Field(default_factory=list)
    risk_level: Literal["low", "medium", "high"] = "medium"
    implementation_compatibility: Literal["reference_only", "adaptable", "unsupported"] = "adaptable"
    status: Literal["draft", "published", "needs_review", "disabled"] = "draft"
    quality_score: float = Field(default=0.5, ge=0.0, le=1.0)
    source_ids: List[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class StrategySearchQuery(BaseModel):
    """Structured query used before deterministic filtering and ranking."""

    query: str = ""
    market: str = ""
    timeframe: str = ""
    regime: str = ""
    trend: str = ""
    volatility: str = ""
    direction: str = ""
    available_data: List[str] = Field(default_factory=list)
    risk_tolerance: str = ""
    limit: int = Field(default=5, ge=1, le=10)


class StrategyValidation(BaseModel):
    """An auditable knowledge or design check, never a profitability certification."""

    id: str
    strategy_card_id: str
    validation_type: Literal[
        "source_review",
        "design_compatibility",
        "lookahead_check",
        "out_of_sample",
        "walk_forward",
        "cost_sensitivity",
    ]
    status: Literal["informational", "passed", "warning", "failed"]
    summary: str
    details: Dict[str, Any] = Field(default_factory=dict)
    data_source: str = ""
    created_at: str
