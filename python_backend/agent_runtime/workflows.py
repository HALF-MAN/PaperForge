from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

from agent_runtime.models import (
    BacktestReport,
    MissionInput,
    OrchestratorEvent,
    PaperOrder,
    PaperSession,
    QuantMissionResult,
    RiskReport,
    Rule,
    RuleGroup,
    StrategyRisk,
    StrategySpec,
)


def run_quant_mission(mission: MissionInput) -> QuantMissionResult:
    """Run the first Python-backed PaperForge mission workflow.

    This entry point is intentionally stable for the Next.js app to call later.
    The implementation uses deterministic executors today and reports whether
    Microsoft Agent Framework is installed. Once the Python service owns the
    mission runtime, these executors can be wrapped by MAF WorkflowBuilder.
    """

    framework = _framework_label()
    events: list[OrchestratorEvent] = []

    events.append(
        OrchestratorEvent(
            agent="Mission Orchestrator",
            step="Start",
            action="run_quant_mission",
            status="started",
            summary=f"Python runtime started with {framework}.",
        )
    )

    events.append(
        OrchestratorEvent(
            agent="Staffing Agent",
            step="Staffing & Plan",
            action="build_team_plan",
            status="completed",
            summary="Skill registry matched mission needs, selected agents, and compiled the workflow plan.",
        )
    )

    strategy = mission.strategy or _default_strategy()
    events.append(
        OrchestratorEvent(
            agent="Market Data Agent",
            step="Market Data",
            action="fetch_market_data",
            status="completed",
            summary=f"Market context loaded for {strategy.symbol} {strategy.timeframe}.",
        )
    )

    events.append(
        OrchestratorEvent(
            agent="Strategy Agent",
            step="Strategy Research",
            action="compile_strategy_spec",
            status="completed",
            summary=f"{strategy.name} normalized as {strategy.symbol} {strategy.timeframe}.",
        )
    )

    backtest = _run_mock_backtest(strategy)
    events.append(
        OrchestratorEvent(
            agent="Backtest Agent",
            step="Backtest",
            action="run_backtest",
            status="completed",
            summary=(
                f"{backtest.trade_count} trades, {backtest.total_return_pct}% return, "
                f"{backtest.max_drawdown_pct}% max drawdown."
            ),
        )
    )

    risk = _score_risk(strategy, backtest)
    events.append(
        OrchestratorEvent(
            agent="Risk Agent",
            step="Risk Assessment",
            action="score_risk",
            status="blocked" if risk.decision == "BLOCK" else "completed",
            summary=f"{risk.decision} {risk.risk_score}/100. {' '.join(risk.issues)}",
        )
    )

    if risk.decision == "BLOCK":
        return QuantMissionResult(
            mission_id=mission.mission_id,
            status="blocked",
            stop_reason="Risk gate blocked paper trading.",
            framework=framework,
            strategy=strategy,
            backtest=backtest,
            risk=risk,
            paper=None,
            events=events,
        )

    events.append(
        OrchestratorEvent(
            agent="Strategy Reviewer",
            step="Strategy Review",
            action="review_strategy",
            status="completed",
            summary="Evidence bundle is internally consistent enough for paper trading.",
        )
    )

    paper = _run_paper_session(mission.mission_id, strategy, backtest)
    events.append(
        OrchestratorEvent(
            agent="Paper Trading Agent",
            step="Paper Trading",
            action="start_paper_session",
            status="completed",
            summary=f"{paper.order_count} simulated orders, {paper.pnl_pct}% paper PnL.",
        )
    )

    events.append(
        OrchestratorEvent(
            agent="Human Reviewer",
            step="Human Approval",
            action="request_human_approval",
            status="stopped",
            summary="Human approval is required before any live dry-run step.",
        )
    )

    return QuantMissionResult(
        mission_id=mission.mission_id,
        status="awaiting_human",
        stop_reason="Workflow paused at the human approval gate.",
        framework=framework,
        strategy=strategy,
        backtest=backtest,
        risk=risk,
        paper=paper,
        events=events,
    )


def _framework_label() -> str:
    try:
        return f"microsoft-agent-framework-core/{version('agent-framework-core')}"
    except PackageNotFoundError:
        return "deterministic-python-runtime (agent-framework-core not installed)"


def _default_strategy() -> StrategySpec:
    return StrategySpec(
        id="spec-python-ema-001",
        source="library_template",
        name="Python EMA20/EMA60 Trend Strategy",
        symbol="BTCUSDT",
        market="spot",
        timeframe="1h",
        entry=RuleGroup(
            mode="all",
            rules=[
                Rule(
                    left="EMA20",
                    operator="crosses_above",
                    right="EMA60",
                    description="EMA20 crosses above EMA60",
                ),
                Rule(
                    left="RSI14",
                    operator="less_than",
                    right="70",
                    description="Avoid entries when RSI is overheated",
                ),
            ],
        ),
        exit=RuleGroup(
            mode="any",
            rules=[
                Rule(
                    left="EMA20",
                    operator="crosses_below",
                    right="EMA60",
                    description="EMA20 crosses below EMA60",
                ),
                Rule(
                    left="PnL",
                    operator="less_than",
                    right="-3%",
                    description="Stop loss reached",
                ),
            ],
        ),
        risk=StrategyRisk(
            max_position_pct=0.12,
            max_leverage=1,
            stop_loss_pct=0.03,
            take_profit_pct=0.06,
            max_daily_loss_pct=0.045,
            kill_switch_drawdown_pct=0.12,
        ),
        tags=["python-runtime", "ema", "approval-gated"],
    )


def _run_mock_backtest(strategy: StrategySpec) -> BacktestReport:
    leverage_bonus = max(0, strategy.risk.max_leverage - 1) * 0.7
    position_penalty = 2.4 if strategy.risk.max_position_pct > 0.15 else 0

    return BacktestReport(
        total_return_pct=round(13.8 + leverage_bonus, 2),
        max_drawdown_pct=round(7.9 + position_penalty, 2),
        win_rate_pct=53.6,
        trade_count=26,
        profit_factor=1.37,
        average_trade_pct=0.48,
    )


def _score_risk(strategy: StrategySpec, backtest: BacktestReport) -> RiskReport:
    issues: list[str] = []
    recommendations: list[str] = []
    score = 100.0

    if strategy.risk.max_leverage > 3:
        score -= 35
        issues.append("Leverage is above the safe launch threshold.")
        recommendations.append("Reduce leverage to 3x or lower before paper trading.")

    if strategy.risk.max_position_pct > 0.15:
        score -= 12
        issues.append("Position size is high for a first deployment run.")
        recommendations.append("Reduce max position before live dry-run.")

    if backtest.max_drawdown_pct > 8:
        score -= 14
        issues.append("Max drawdown is close to the balanced profile limit.")
        recommendations.append("Add a volatility filter or tighter kill switch.")

    if backtest.trade_count > 28:
        score -= 8
        issues.append("Trade frequency increases operational risk during sideways markets.")
        recommendations.append("Require an additional trend confirmation before opening positions.")

    if not strategy.risk.stop_loss_pct:
        score -= 25
        issues.append("No stop loss is defined.")
        recommendations.append("Define a stop loss before paper trading.")

    risk_score = max(0, min(100, score))
    decision = "BLOCK" if risk_score < 60 else "WARN" if risk_score < 80 else "PASS"

    if not recommendations:
        recommendations.append("Proceed to paper trading with audit logging and real execution disabled.")

    return RiskReport(
        decision=decision,
        risk_score=risk_score,
        issues=issues,
        recommendations=recommendations,
    )


def _run_paper_session(
    mission_id: str,
    strategy: StrategySpec,
    backtest: BacktestReport,
) -> PaperSession:
    base_price = 68000 if strategy.symbol.startswith("BTC") else 3600
    size = round(10000 * strategy.risk.max_position_pct / base_price, 6)
    pnl_pct = round(max(-6, backtest.average_trade_pct * 3.2), 2)
    ending_balance = round(10000 * (1 + pnl_pct / 100), 2)

    return PaperSession(
        id=f"{mission_id}_python_paper",
        starting_balance=10000,
        ending_balance=ending_balance,
        pnl_pct=pnl_pct,
        max_drawdown_pct=round(min(backtest.max_drawdown_pct * 0.45, 8), 2),
        order_count=3,
        status="completed",
        orders=[
            PaperOrder(
                id=f"{mission_id}_paper_001",
                symbol=strategy.symbol,
                side="buy",
                price=base_price,
                size=size,
                reason=strategy.entry.rules[0].description,
            ),
            PaperOrder(
                id=f"{mission_id}_paper_002",
                symbol=strategy.symbol,
                side="sell",
                price=round(base_price * 1.012, 2),
                size=round(size * 0.5, 6),
                reason="Partial take-profit threshold reached",
            ),
            PaperOrder(
                id=f"{mission_id}_paper_003",
                symbol=strategy.symbol,
                side="sell",
                price=round(base_price * (1 + pnl_pct / 100), 2),
                size=round(size * 0.5, 6),
                reason=strategy.exit.rules[0].description,
            ),
        ],
    )
