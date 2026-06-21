"""
Strategy Lab Agent Loop Implementation
基于 Microsoft Agent Framework 的循环优化架构

核心特性：
1. 条件分支（add_switch_case_edge_group）
2. 状态持久化（CheckpointStorage）
3. 实时进度（Intermediate Output）
4. 闭环反馈（Analysis Agent → Planner）
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Literal
from datetime import datetime, timezone

from agent_framework import (
    Executor,
    WorkflowBuilder,
    WorkflowContext,
    handler,
    FileCheckpointStorage,
    Workflow,
)
from agent_framework._workflows._edge import Case, Default
from agent_runtime.strategy_lab_agents import (
    StrategyLabPlannerExecutor,
    StrategyLabCodeAgentExecutor,
    _plan_strategy_turn,
    _generate_code_package,
    _validate_strategy_code,
    _llm_config,
    _code_llm_config,
    CodeGenerationError,
    CodeAgentResult,
    PlannerDecision,
    CodeValidationResult,
)
from agent_runtime.sandbox_executor import StrategySandboxExecutor
from agent_runtime.strategy_lab_store import (
    _code_package,
    _backtest_artifact,
    _now,
)


# === 新增：Analysis Agent ===


@dataclass
class AnalysisResult:
    """回测分析结果"""
    is_satisfactory: bool
    diagnosis: str
    recommendations: list[str]
    metrics_summary: str
    should_optimize: bool
    optimization_feedback: dict[str, Any] | None = None


class StrategyLabAnalysisExecutor(Executor):
    """分析回测结果，决定是否继续优化"""

    def __init__(self, max_iterations: int = 3):
        super().__init__(id="strategy_lab_analysis")
        self._max_iterations = max_iterations

    @handler
    async def handle(
        self,
        state: dict[str, Any],
        ctx: WorkflowContext[dict[str, Any]],
    ) -> None:
        backtest_result = state.get("backtestResult") or {}
        metrics = backtest_result.get("metrics") or {}
        iteration_count = state.get("iterationCount", 0)

        # 分析回测结果
        analysis = await asyncio.to_thread(
            _analyze_backtest_result,
            metrics=metrics,
            iteration=iteration_count,
            max_iterations=self._max_iterations,
        )

        # 保存分析结果到状态
        state["analysisResult"] = analysis
        state["iterationCount"] = iteration_count + 1

        # 输出进度（前端实时显示）
        await ctx.yield_intermediate_output({
            "step": "analysis",
            "status": "completed",
            "summary": analysis.diagnosis,
            "recommendations": analysis.recommendations[:3],
            "iteration": iteration_count + 1,
        })

        # 根据分析结果决定下一步
        if analysis.is_satisfactory or iteration_count >= self._max_iterations:
            # 满意或达到最大迭代次数 → 结束
            await ctx.yield_output(state)
        else:
            # 不满意 → 传递状态给 Planner（循环）
            state["optimizationFeedback"] = analysis.optimization_feedback
            await ctx.send_message(state)


def _analyze_backtest_result(
    *,
    metrics: dict[str, Any],
    iteration: int,
    max_iterations: int,
) -> AnalysisResult:
    """分析回测结果，决定是否需要优化"""

    trade_count = int(metrics.get("tradeCount") or 0)
    total_return = float(metrics.get("totalReturn") or 0)
    sharpe = float(metrics.get("sharpe") or 0)
    max_drawdown = float(metrics.get("maxDrawdown") or 0)

    # 诊断逻辑
    if trade_count == 0:
        # 问题：策略过于严格，没有产生交易
        return AnalysisResult(
            is_satisfactory=False,
            diagnosis="策略逻辑过于严格，没有产生任何交易信号",
            recommendations=[
                "放宽 RSI 阈值（如 oversold=40, overbought=60）",
                "改用单条件触发（OR 而不是 AND）",
                "降低 MACD 参数以增加灵敏度",
            ],
            metrics_summary=f"trade_count={trade_count}, total_return={total_return}%",
            should_optimize=True,
            optimization_feedback={
                "issue": "no_signals",
                "suggested_params": {
                    "rsi_oversold": 40.0,
                    "rsi_overbought": 60.0,
                    "use_or_condition": True,
                },
            },
        )

    if total_return < 5 and sharpe < 0.5:
        # 问题：收益偏低
        return AnalysisResult(
            is_satisfactory=False,
            diagnosis=f"回测收益偏低（{total_return}%），风险调整收益不足（sharpe={sharpe})",
            recommendations=[
                "增加止损逻辑（如 max_drawdown_pct=15%）",
                "优化入场时机（增加趋势过滤）",
                "调整仓位管理（如 max_position_pct=20%）",
            ],
            metrics_summary=f"total_return={total_return}%, sharpe={sharpe}",
            should_optimize=True,
            optimization_feedback={
                "issue": "low_return",
                "suggested_params": {
                    "stop_loss_pct": 5.0,
                    "max_position_pct": 20.0,
                },
            },
        )

    if max_drawdown > 25:
        # 问题：回撤过大
        return AnalysisResult(
            is_satisfactory=False,
            diagnosis=f"最大回撤过大（{max_drawdown}%），风险控制不足",
            recommendations=[
                "增加止损条件",
                "降低仓位比例",
                "增加波动率过滤",
            ],
            metrics_summary=f"max_drawdown={max_drawdown}%",
            should_optimize=True,
            optimization_feedback={
                "issue": "high_drawdown",
                "suggested_params": {
                    "max_position_pct": 10.0,
                    "stop_loss_pct": 8.0,
                },
            },
        )

    # 满意条件：交易次数适中，收益合理，回撤可控
    if trade_count >= 3 and total_return >= 5 and sharpe >= 0.7:
        return AnalysisResult(
            is_satisfactory=True,
            diagnosis=f"策略表现良好：{trade_count}次交易，收益{total_return}%，夏普{sharpe}",
            recommendations=["当前策略已通过基础风险检查，可以进入下一轮参数微调"],
            metrics_summary=f"trade_count={trade_count}, return={total_return}%, sharpe={sharpe}",
            should_optimize=False,
        )

    # 默认：如果还有迭代次数，继续优化
    if iteration < max_iterations - 1:
        return AnalysisResult(
            is_satisfactory=False,
            diagnosis="策略表现一般，建议继续优化",
            recommendations=["尝试调整参数组合"],
            metrics_summary=f"trade_count={trade_count}, return={total_return}%",
            should_optimize=True,
            optimization_feedback={
                "issue": "general_optimization",
                "suggested_params": {},
            },
        )

    # 达到最大迭代次数，即使不满意也结束
    return AnalysisResult(
        is_satisfactory=False,
        diagnosis=f"已达到最大迭代次数（{max_iterations}），停止优化",
        recommendations=["建议手动调整参数或尝试其他策略族"],
        metrics_summary=f"final: trade_count={trade_count}, return={total_return}%",
        should_optimize=False,
    )


# === 新增：Validator Agent（改进版） ===


class StrategyLabValidatorExecutor(Executor):
    """验证代码包，失败时可重试"""

    def __init__(self, max_retries: int = 2):
        super().__init__(id="strategy_lab_validator")
        self._max_retries = max_retries

    @handler
    async def handle(
        self,
        state: dict[str, Any],
        ctx: WorkflowContext[dict[str, Any]],
    ) -> None:
        code_result = state.get("codeAgentResult") or {}
        code = str(code_result.get("code") or "")
        retry_count = state.get("validationRetryCount", 0)

        # 验证代码
        validation = await asyncio.to_thread(_validate_strategy_code, code)
        state["codeValidation"] = validation.__dict__

        if validation.valid:
            # 验证通过 → 继续回测
            state["validationRetryCount"] = 0
            await ctx.yield_intermediate_output({
                "step": "validation",
                "status": "passed",
                "checks": validation.checks,
            })
            await ctx.send_message(state)
        else:
            # 验证失败 → 决策是否重试
            if retry_count < self._max_retries:
                state["validationRetryCount"] = retry_count + 1
                state["validationErrors"] = validation.errors
                await ctx.yield_intermediate_output({
                    "step": "validation",
                    "status": "retrying",
                    "errors": validation.errors[:3],
                    "retry_count": retry_count + 1,
                })
                # 回到 Code Agent 重试
                await ctx.send_message(state)
            else:
                # 达到最大重试次数 → 失败结束
                state["finalError"] = f"Validation failed after {self._max_retries} retries: {validation.errors}"
                await ctx.yield_output(state)


# === 新增：Backtest Executor ===


class StrategyLabBacktestExecutor(Executor):
    """执行沙箱回测"""

    def __init__(self):
        super().__init__(id="strategy_lab_backtest")

    @handler
    async def handle(
        self,
        state: dict[str, Any],
        ctx: WorkflowContext[dict[str, Any]],
    ) -> None:
        code_result = state.get("codeAgentResult") or {}
        code = str(code_result.get("code") or "")
        params = dict(code_result.get("params") or {})

        # 默认回测配置
        backtest_config = {
            "startDate": "2024-01-01",
            "endDate": "2024-12-31",
            "initialCapital": 100000,
        }

        await ctx.yield_intermediate_output({
            "step": "backtest",
            "status": "running",
            "message": "正在沙箱中执行回测...",
        })

        # 执行沙箱回测
        result = await asyncio.to_thread(
            StrategySandboxExecutor.execute_strategy,
            code,
            backtest_config,
        )

        if not result.get("success"):
            state["backtestError"] = result.get("error")
            await ctx.yield_intermediate_output({
                "step": "backtest",
                "status": "failed",
                "error": result.get("error"),
            })
            await ctx.yield_output(state)
            return

        # 保存回测结果
        backtest_artifact = _backtest_artifact(
            session_id=state.get("sessionId") or "unknown",
            source={"id": state.get("sessionId"), "title": code_result.get("title")},
            result=result,
            params=params,
            now=_now(),
        )

        state["backtestResult"] = {
            "artifact": backtest_artifact,
            "metrics": backtest_artifact.get("metrics"),
            "charts": backtest_artifact.get("charts"),
        }

        await ctx.yield_intermediate_output({
            "step": "backtest",
            "status": "completed",
            "metrics": backtest_artifact.get("metrics"),
        })

        await ctx.send_message(state)


# === Agent Loop Workflow 构建器 ===


def build_strategy_lab_loop_workflow(
    max_iterations: int = 3,
    checkpoint_dir: str | None = None,
) -> Workflow:
    """
    构建 Strategy Lab Agent Loop Workflow

    核心特性：
    1. 条件循环（Analysis → Planner）
    2. 验证重试（Validator → Code Agent）
    3. 状态持久化（Checkpoint）
    4. 实时进度（Intermediate Output）
    """

    # 创建 Executor 实例
    router = StrategyLabPlannerExecutor()  # 用 Planner 作为 Router
    planner = StrategyLabPlannerExecutor()
    code_agent = StrategyLabCodeAgentExecutor()
    validator = StrategyLabValidatorExecutor(max_retries=2)
    backtest = StrategyLabBacktestExecutor()
    analysis = StrategyLabAnalysisExecutor(max_iterations=max_iterations)

    # 构建 Workflow
    builder = WorkflowBuilder(
        name="StrategyLabAgentLoop",
        description="Strategy Lab with iterative optimization loop",
        start_executor=router,
        checkpoint_storage=(
            FileCheckpointStorage(checkpoint_dir)
            if checkpoint_dir
            else None
        ),
        max_iterations=max_iterations * 5,  # 每轮最多5个步骤
    )

    # 定义边（流转逻辑）
    # Router → Planner（如果需要生成代码）
    builder.add_switch_case_edge_group(
        source=router,
        cases=[
            Case("create_code_package", target=planner),
            Case("modify_code", target=planner),
            Default(target=None),  # 其他意图直接结束
        ],
    )

    # Planner → Code Agent
    builder.add_edge(planner, code_agent)

    # Code Agent → Validator
    builder.add_edge(code_agent, validator)

    # Validator → 条件分支（通过 → Backtest，失败 → 重试 Code Agent）
    builder.add_switch_case_edge_group(
        source=validator,
        cases=[
            Case("passed", target=backtest),
            Case("retry", target=code_agent),  # ← 循环点1：验证失败重试
            Default(target=None),  # 最终失败
        ],
    )

    # Backtest → Analysis
    builder.add_edge(backtest, analysis)

    # Analysis → 条件分支（满意 → END，不满意 → 回到 Planner）
    builder.add_switch_case_edge_group(
        source=analysis,
        cases=[
            Case("satisfactory", target=None),  # 结束
            Case("optimize", target=planner),  # ← 循环点2：Agent Loop
            Default(target=None),
        ],
    )

    return builder.build()


# === 运行 Agent Loop ===


async def run_strategy_lab_loop_async(
    *,
    prompt: str,
    session: dict[str, Any],
    artifacts: list[dict[str, Any]],
    max_iterations: int = 3,
) -> dict[str, Any]:
    """
    运行 Strategy Lab Agent Loop（异步版本）

    返回：
    - 成功：最终代码包 + 回测结果 + 迭代次数
    - 失败：最后一次尝试的结果 + 诊断信息
    """

    workflow = build_strategy_lab_loop_workflow(
        max_iterations=max_iterations,
        checkpoint_dir=".paperforge/strategy_lab_checkpoints",
    )

    # 初始状态
    initial_state = {
        "prompt": prompt,
        "session": session,
        "artifacts": artifacts,
        "iterationCount": 0,
        "validationRetryCount": 0,
    }

    # 运行 workflow
    result = await workflow.run(initial_state)

    # 获取最终输出
    outputs = result.get_outputs()
    if not outputs:
        return {
            "success": False,
            "error": "Agent Loop produced no output",
            "iterations": max_iterations,
        }

    final_state = outputs[0]
    analysis_result = final_state.get("analysisResult")

    if analysis_result and analysis_result.get("is_satisfactory"):
        # 成功
        return {
            "success": True,
            "code_package": final_state.get("codeAgentResult"),
            "backtest_result": final_state.get("backtestResult"),
            "iterations": final_state.get("iterationCount"),
            "analysis": analysis_result,
        }
    else:
        # 达到最大迭代次数但仍不满意
        return {
            "success": False,
            "reason": analysis_result.get("diagnosis") if analysis_result else "Unknown",
            "last_code_package": final_state.get("codeAgentResult"),
            "last_backtest": final_state.get("backtestResult"),
            "iterations": final_state.get("iterationCount"),
            "recommendations": analysis_result.get("recommendations") if analysis_result else [],
        }


def run_strategy_lab_loop(
    *,
    prompt: str,
    session: dict[str, Any],
    artifacts: list[dict[str, Any]],
    max_iterations: int = 3,
) -> dict[str, Any]:
    """
    运行 Strategy Lab Agent Loop（同步版本，用于 HTTP handler）
    """
    return asyncio.run(
        run_strategy_lab_loop_async(
            prompt=prompt,
            session=session,
            artifacts=artifacts,
            max_iterations=max_iterations,
        )
    )


# === 增强版 Planner（接受优化反馈） ===


def _plan_strategy_turn_with_feedback(
    prompt: str,
    *,
    has_code_package: bool,
    session: dict[str, Any] | None = None,
    artifacts: list[dict[str, Any]] | None = None,
    optimization_feedback: dict[str, Any] | None = None,
) -> PlannerDecision:
    """
    增强版 Planner：根据优化反馈调整规划
    """

    # 如果有优化反馈，调整 prompt
    if optimization_feedback:
        issue = optimization_feedback.get("issue")
        suggested_params = optimization_feedback.get("suggested_params")

        if issue == "no_signals":
            # 问题：没有信号 → 明确要求放宽条件
            enhanced_prompt = f"{prompt}\n\n优化要求：放宽参数阈值（如 {suggested_params}），确保能产生交易信号"
        elif issue == "low_return":
            # 问题：收益低 → 增加止损/仓位管理
            enhanced_prompt = f"{prompt}\n\n优化要求：增加止损逻辑和仓位管理，提升收益"
        elif issue == "high_drawdown":
            # 问题：回撤大 → 降低风险
            enhanced_prompt = f"{prompt}\n\n优化要求：降低仓位、增加止损，控制最大回撤"
        else:
            enhanced_prompt = prompt
    else:
        enhanced_prompt = prompt

    # 调用原始 Planner
    return _plan_strategy_turn(
        enhanced_prompt,
        has_code_package=has_code_package,
        session=session,
        artifacts=artifacts,
    )


# === 测试示例 ===


if __name__ == "__main__":
    import json

    # 测试 Agent Loop
    result = run_strategy_lab_loop(
        prompt="实现一个结合RSI和MACD的双重确认策略",
        session={"id": "test-session"},
        artifacts=[],
        max_iterations=3,
    )

    print("=== Agent Loop Result ===")
    print(json.dumps(result, indent=2, ensure_ascii=False))