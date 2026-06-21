from __future__ import annotations

import asyncio
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from agent_framework import Agent, FunctionTool
from agent_framework.openai import OpenAIChatCompletionClient
from openai import AsyncOpenAI

from agent_runtime.bitget_client import BitgetApiClient
from agent_runtime.bitget_mcp import create_bitget_research_mcp
from agent_runtime.crypto_research_clients import (
    get_cmc_asset_profile,
    get_cmc_global_market,
    get_coin_metrics_onchain,
    get_mempool_network_state,
)
from agent_runtime.sandbox_executor import StrategySandboxExecutor
from agent_runtime.strategy_lab_agents import _llm_config, _validate_strategy_code
from agent_runtime.strategy_library_store import (
    compare_strategy_cards as rank_strategy_cards,
    get_strategy_card as load_strategy_card,
    resolve_strategy_references,
    search_strategy_library as query_strategy_library,
    validate_strategy_design as check_strategy_design,
)


SKILLS_DIR = Path(__file__).resolve().parent / "skills"
STRATEGY_LAB_SKILLS = {
    "strategy-lab-market-research",
    "strategy-lab-strategy-design",
    "strategy-lab-code-generation",
    "strategy-lab-backtest-analysis",
}

STRATEGY_LAB_SKILL_ALIASES = {
    "market-analysis": "strategy-lab-market-research",
    "market-research": "strategy-lab-market-research",
    "strategy-design": "strategy-lab-strategy-design",
    "code-generation": "strategy-lab-code-generation",
    "backtest-analysis": "strategy-lab-backtest-analysis",
}


def run_strategy_lab_agent(
    *,
    prompt: str,
    session: dict[str, Any],
    messages: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Run one Strategy Lab conversational turn through the Agent Framework tool loop."""

    return asyncio.run(
        _run_strategy_lab_agent_async(
            prompt=prompt,
            session=session,
            messages=messages,
            artifacts=artifacts,
            progress_callback=progress_callback,
        )
    )


async def _run_strategy_lab_agent_async(
    *,
    prompt: str,
    session: dict[str, Any],
    messages: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    config = _llm_config()
    if not config:
        raise RuntimeError("StrategyLabAgent LLM is not configured.")

    tool_trace: list[dict[str, Any]] = []
    pending_code_package: dict[str, Any] | None = None
    pending_backtest: dict[str, Any] | None = None
    active_code_package = _latest_code_package(artifacts)
    strategy_search_result: dict[str, Any] | None = None

    def emit(event: dict[str, Any]) -> None:
        if progress_callback:
            progress_callback(dict(event))

    def wrap_mcp_tool(tool: Any) -> FunctionTool:
        async def invoke(**arguments: Any) -> Any:
            started_at = _utc_now()
            entry = {
                "tool": tool.name,
                "status": "running",
                "arguments": _safe_arguments(arguments),
                "startedAt": started_at,
            }
            tool_trace.append(entry)
            emit(entry)
            try:
                result = await tool.invoke(arguments=arguments)
                entry.update(
                    {
                        "status": "completed",
                        "completedAt": _utc_now(),
                        "summary": _tool_result_summary(result),
                    }
                )
                emit(entry)
                return result
            except Exception as error:
                entry.update(
                    {
                        "status": "failed",
                        "completedAt": _utc_now(),
                        "summary": str(error)[:300],
                    }
                )
                emit(entry)
                raise

        return FunctionTool(
            name=tool.name,
            description=tool.description,
            func=invoke,
            input_model=tool.parameters(),
            max_invocations=3,
        )

    def traced(tool_name: str, operation: Callable[..., Any], **arguments: Any) -> Any:
        started_at = _utc_now()
        entry = {
            "tool": tool_name,
            "status": "running",
            "arguments": _safe_arguments(arguments),
            "startedAt": started_at,
        }
        tool_trace.append(entry)
        emit(entry)
        try:
            result = operation(**arguments)
            entry.update(
                {
                    "status": "completed",
                    "completedAt": _utc_now(),
                    "summary": _tool_result_summary(result),
                }
            )
            emit(entry)
            return result
        except Exception as error:
            entry.update(
                {
                    "status": "failed",
                    "completedAt": _utc_now(),
                    "summary": str(error)[:300],
                }
            )
            emit(entry)
            raise

    def list_strategy_skills(query: str = "") -> dict[str, Any]:
        """List Strategy Lab skills. Use this before selecting a domain procedure."""

        return traced("list_strategy_skills", _list_strategy_skills, query=query)

    def load_strategy_skill(name: str) -> dict[str, Any]:
        """Load a Strategy Lab SKILL.md by canonical name or a supported short alias."""

        return traced("load_strategy_skill", _load_strategy_skill, name=name)

    def get_market_ticker(symbol: str = "BTCUSDT") -> dict[str, Any]:
        """Fetch a timestamped public Bitget spot ticker snapshot for a symbol such as BTCUSDT."""

        return traced("get_market_ticker", _get_market_ticker, symbol=symbol)

    def analyze_market_timeframe(
        symbol: str = "BTCUSDT",
        timeframe: str = "4h",
        limit: int = 240,
    ) -> dict[str, Any]:
        """Fetch real Bitget candles and calculate EMA, RSI, ATR, ADX, returns and market regime."""

        return traced(
            "analyze_market_timeframe",
            _analyze_market_timeframe,
            symbol=symbol,
            timeframe=timeframe,
            limit=limit,
        )

    def get_asset_profile(symbol: str = "BTC") -> dict[str, Any]:
        """Get CoinMarketCap market-cap, supply, ranking, and asset profile data."""

        return traced("get_asset_profile", get_cmc_asset_profile, symbol=symbol)

    def get_global_crypto_market() -> dict[str, Any]:
        """Get global crypto market totals, dominance, and fear-and-greed data from CMC."""

        return traced("get_global_crypto_market", get_cmc_global_market)

    def get_onchain_metrics(asset: str = "btc", days: int = 7) -> dict[str, Any]:
        """Get daily community on-chain metrics from Coin Metrics for an asset."""

        return traced("get_onchain_metrics", get_coin_metrics_onchain, asset=asset, days=days)

    def get_btc_network_state() -> dict[str, Any]:
        """Get current Bitcoin mempool backlog and recommended transaction fees."""

        return traced("get_btc_network_state", get_mempool_network_state)

    def compare_strategy_candidates(
        regime: str,
        trend: str,
        volatility: str,
        rsi: float | None = None,
    ) -> dict[str, Any]:
        """Compare strategy styles against an already observed market regime."""

        return traced(
            "compare_strategy_candidates",
            _compare_strategy_candidates,
            regime=regime,
            trend=trend,
            volatility=volatility,
            rsi=rsi,
        )

    def search_strategy_library(
        query: str = "",
        market: str = "",
        timeframe: str = "",
        regime: str = "",
        trend: str = "",
        volatility: str = "",
        direction: str = "",
        available_data_csv: str = "",
        risk_tolerance: str = "",
        limit: int = 5,
    ) -> dict[str, Any]:
        """Search reviewed strategy cards using hard constraints, FTS5, and deterministic ranking."""

        nonlocal strategy_search_result
        if strategy_search_result is not None:
            return {
                **strategy_search_result,
                "cached": True,
                "toolNotice": "Reuse these candidates and continue the answer. Do not search again this turn.",
            }
        normalized_market = market.strip()
        if normalized_market.lower() in {"btc", "btcusdt", "crypto", "perpetual", "futures"}:
            normalized_market = "crypto_perpetual"

        def search_with_fallback(**search_arguments: Any) -> dict[str, Any]:
            original = query_strategy_library(**search_arguments)
            if original.get("results"):
                return original

            regime_terms = {
                "ranging": "震荡 均值回归 RSI 布林带",
                "trending": "趋势 动量 EMA 突破",
                "volatile": "高波动 风险控制 突破",
            }.get(str(search_arguments.get("regime") or "").lower(), "策略")
            relaxed_arguments = {
                **search_arguments,
                "query": " ".join(
                    part for part in (str(search_arguments.get("query") or ""), regime_terms) if part
                ),
                "trend": "",
                "volatility": "",
            }
            relaxed = query_strategy_library(**relaxed_arguments)
            if not relaxed.get("results"):
                relaxed_arguments.update({"market": "", "timeframe": ""})
                relaxed = query_strategy_library(**relaxed_arguments)
            relaxed["fallbackApplied"] = True
            relaxed["fallbackReason"] = "严格条件无候选，已自动放宽趋势与波动约束"
            relaxed["originalQuery"] = original.get("query")
            return relaxed

        strategy_search_result = traced(
            "search_strategy_library",
            search_with_fallback,
            query=query,
            market=normalized_market,
            timeframe=timeframe,
            regime=regime,
            trend=trend,
            volatility=volatility,
            direction=direction,
            available_data=_csv_values(available_data_csv),
            risk_tolerance=risk_tolerance,
            limit=limit,
        )
        recommendations: list[dict[str, Any]] = []
        for candidate in list(strategy_search_result.get("results") or [])[:2]:
            detail = load_strategy_card(str(candidate.get("id") or "")) or {}
            card = detail.get("card") or {}
            recommendations.append(
                {
                    "id": candidate.get("id"),
                    "name": candidate.get("name"),
                    "family": candidate.get("family"),
                    "summary": candidate.get("summary"),
                    "score": candidate.get("score"),
                    "matchReasons": candidate.get("matchReasons") or [],
                    "mismatches": candidate.get("mismatches") or [],
                    "failureModes": candidate.get("failureModes") or [],
                    "riskControls": card.get("riskControls") or card.get("risk_controls") or [],
                    "sources": [
                        {
                            "title": source.get("title"),
                            "provider": source.get("provider"),
                            "sourceUrl": source.get("sourceUrl") or source.get("source_url"),
                        }
                        for source in detail.get("sources") or []
                    ],
                }
            )
        strategy_search_result["recommendedCandidates"] = recommendations
        strategy_search_result["nextAction"] = (
            "Answer the user now with these candidates, reasons, risks, and sources. "
            "Do not call search_strategy_library or compare_strategy_candidates again."
        )
        return strategy_search_result

    def get_strategy_card(card_id: str) -> dict[str, Any]:
        """Load one reviewed strategy card with its logic, risks, validation rules, and sources."""

        return traced("get_strategy_card", load_strategy_card, card_id=card_id)

    def compare_strategy_cards(
        first_card_id: str,
        second_card_id: str,
        third_card_id: str = "",
        market: str = "",
        timeframe: str = "",
        regime: str = "",
        trend: str = "",
        volatility: str = "",
        direction: str = "",
        available_data_csv: str = "",
        risk_tolerance: str = "",
    ) -> dict[str, Any]:
        """Compare up to five reviewed cards against the same observed market constraints."""

        card_ids = [
            card_id.strip()
            for card_id in (first_card_id, second_card_id, third_card_id)
            if card_id.strip()
        ]
        return traced(
            "compare_strategy_cards",
            rank_strategy_cards,
            card_ids=card_ids,
            market=market,
            timeframe=timeframe,
            regime=regime,
            trend=trend,
            volatility=volatility,
            direction=direction,
            available_data=_csv_values(available_data_csv),
            risk_tolerance=risk_tolerance,
        )

    def validate_strategy_design(
        card_id: str,
        market: str = "",
        timeframe: str = "",
        regime: str = "",
        trend: str = "",
        direction: str = "",
        available_data_csv: str = "",
    ) -> dict[str, Any]:
        """Check data, market, direction, risk, and implementation compatibility before coding."""

        return traced(
            "validate_strategy_design",
            check_strategy_design,
            card_id=card_id,
            market=market,
            timeframe=timeframe,
            regime=regime,
            trend=trend,
            direction=direction,
            available_data=_csv_values(available_data_csv),
        )

    def validate_and_commit_code(
        title: str,
        code: str,
        explanation: str,
        strategy_card_ids_csv: str = "",
    ) -> dict[str, Any]:
        """Validate generated Python strategy code and propose a code-package artifact when valid."""

        nonlocal pending_code_package, active_code_package
        result = traced(
            "validate_and_commit_code",
            _validate_and_prepare_code_package,
            title=title,
            code=code,
            explanation=explanation,
            strategy_card_ids=_csv_values(strategy_card_ids_csv),
        )
        if result.get("success"):
            pending_code_package = result["codePackage"]
            active_code_package = pending_code_package
        return result

    def run_strategy_backtest(
        start_date: str = "2024-01-01",
        end_date: str = "2024-12-31",
        data_source: str = "mock",
        symbol: str = "BTCUSDT",
        timeframe: str = "1day",
    ) -> dict[str, Any]:
        """Run the active validated strategy in the restricted Python sandbox after an explicit user request."""

        nonlocal pending_backtest
        result = traced(
            "run_strategy_backtest",
            _run_active_backtest,
            source=active_code_package,
            start_date=start_date,
            end_date=end_date,
            data_source=data_source,
            symbol=symbol,
            timeframe=timeframe,
        )
        if result.get("success"):
            pending_backtest = result["backtestProposal"]
        return {
            "success": result.get("success", False),
            "dataSource": result.get("dataSource"),
            "metrics": result.get("metrics"),
            "error": result.get("error"),
        }

    tools = [
        FunctionTool(
            name="list_strategy_skills",
            description="List the available Strategy Lab skills and their descriptions.",
            func=list_strategy_skills,
            max_invocations=2,
        ),
        FunctionTool(
            name="load_strategy_skill",
            description="Load one Strategy Lab skill's complete operating instructions.",
            func=load_strategy_skill,
            max_invocations=4,
        ),
        FunctionTool(
            name="get_market_ticker",
            description="Get current public Bitget ticker data. Required for current-market claims.",
            func=get_market_ticker,
            max_invocations=2,
        ),
        FunctionTool(
            name="analyze_market_timeframe",
            description="Get real candles and a technical market-regime analysis for one timeframe.",
            func=analyze_market_timeframe,
            max_invocations=3,
        ),
        FunctionTool(
            name="get_asset_profile",
            description="Get CMC asset fundamentals including market cap, FDV, supply, rank, and returns.",
            func=get_asset_profile,
            max_invocations=3,
        ),
        FunctionTool(
            name="get_global_crypto_market",
            description="Get global crypto market size, volume, dominance, and fear-and-greed context.",
            func=get_global_crypto_market,
            max_invocations=2,
        ),
        FunctionTool(
            name="get_onchain_metrics",
            description="Get recent daily on-chain activity from the Coin Metrics Community API.",
            func=get_onchain_metrics,
            max_invocations=3,
        ),
        FunctionTool(
            name="get_btc_network_state",
            description="Get current Bitcoin mempool congestion and recommended fee rates.",
            func=get_btc_network_state,
            max_invocations=2,
        ),
        FunctionTool(
            name="search_strategy_library",
            description=(
                "Search reviewed strategy knowledge with market, timeframe, regime, direction, "
                "available-data, and risk constraints. This is deterministic and does not use vectors."
            ),
            func=search_strategy_library,
            max_invocations=6,
        ),
        FunctionTool(
            name="get_strategy_card",
            description="Load full evidence and source attribution for one strategy-library candidate.",
            func=get_strategy_card,
            max_invocations=4,
        ),
        FunctionTool(
            name="compare_strategy_cards",
            description="Compare reviewed strategy cards under one observed market and data context.",
            func=compare_strategy_cards,
            max_invocations=2,
        ),
        FunctionTool(
            name="validate_strategy_design",
            description=(
                "Validate a reviewed strategy card against available data and market constraints "
                "before generating code. This does not certify profitability."
            ),
            func=validate_strategy_design,
            max_invocations=2,
        ),
        FunctionTool(
            name="validate_and_commit_code",
            description="Validate model-generated strategy code and submit it as a code-package proposal.",
            func=validate_and_commit_code,
            max_invocations=2,
        ),
        FunctionTool(
            name="run_strategy_backtest",
            description="Run the active strategy in the Python sandbox after an explicit backtest request.",
            func=run_strategy_backtest,
            max_invocations=1,
        ),
    ]

    async_client = AsyncOpenAI(
        api_key=config["api_key"],
        base_url=config["base_url"],
        timeout=float(config.get("timeout") or 60),
        max_retries=1,
    )
    client = OpenAIChatCompletionClient(
        model=config["model"],
        async_client=async_client,
        instruction_role="system",
    )
    bitget_mcp = create_bitget_research_mcp()
    try:
        await bitget_mcp.connect()
        tools.extend(wrap_mcp_tool(tool) for tool in bitget_mcp.functions)
    except Exception as error:
        # MCP bootstrap is infrastructure, not a user-visible research action.
        # Individual Bitget calls remain fully traced when the agent actually uses them.
        pass

    agent_error: Exception | None = None
    response: Any = None
    try:
        agent = Agent(
            client=client,
            id="strategy_lab_agent",
            name="StrategyLabAgent",
            description="Conversational quantitative research and strategy development agent.",
            instructions=_agent_instructions(),
            tools=tools,
        )

        reasoning_started_at = _utc_now()
        emit({
            "tool": "agent_reasoning",
            "status": "running",
            "summary": "正在分析请求并选择需要的证据与工具",
            "startedAt": reasoning_started_at,
        })
        response = await agent.run(
            _agent_user_input(
                prompt=prompt,
                session=session,
                messages=messages,
                active_code_package=active_code_package,
            )
        )
        emit({
            "tool": "agent_reasoning",
            "status": "completed",
            "summary": "证据收集完成，正在组织回答",
            "startedAt": reasoning_started_at,
            "completedAt": _utc_now(),
        })
    except Exception as error:
        agent_error = error
        emit({
            "tool": "agent_reasoning",
            "status": "failed",
            "summary": _agent_runtime_error_message(error),
            "startedAt": reasoning_started_at,
            "completedAt": _utc_now(),
        })
    finally:
        await bitget_mcp.close()

    response_text = response.text.strip() if response is not None else ""
    if strategy_search_result:
        candidates = list(strategy_search_result.get("recommendedCandidates") or [])
        candidate_names = [str(item.get("name") or "") for item in candidates]
        if candidates and (
            agent_error is not None
            or not any(name and name in response_text for name in candidate_names)
        ):
            response_text = _strategy_recommendation_markdown(
                candidates,
                fallback_reason=str(strategy_search_result.get("fallbackReason") or ""),
            )
            agent_error = None

    if agent_error is not None:
        response_text = _agent_runtime_error_message(agent_error)

    return {
        "content": response_text,
        "codePackage": pending_code_package,
        "backtestProposal": pending_backtest,
        "toolTrace": tool_trace,
        "framework": "microsoft-agent-framework/agent-tool-loop",
        "agent": "StrategyLabAgent",
        "llmProvider": config["provider"],
        "llmModel": config["model"],
    }


def _strategy_recommendation_markdown(
    candidates: list[dict[str, Any]],
    *,
    fallback_reason: str = "",
) -> str:
    lines = ["## 策略库推荐"]
    if fallback_reason:
        lines.append(f"> {fallback_reason}，以下候选来自放宽后的确定性检索。")

    for index, candidate in enumerate(candidates[:2], start=1):
        name = str(candidate.get("name") or candidate.get("id") or f"候选 {index}")
        lines.extend([f"### {index}. {name}", str(candidate.get("summary") or "")])
        reasons = [str(item) for item in candidate.get("matchReasons") or []]
        risks = [str(item) for item in candidate.get("failureModes") or []]
        mismatches = [str(item) for item in candidate.get("mismatches") or []]
        controls = [str(item) for item in candidate.get("riskControls") or []]
        sources = list(candidate.get("sources") or [])

        if reasons:
            lines.append("**匹配理由**")
            lines.extend(f"- {item}" for item in reasons[:4])
        if risks or mismatches:
            lines.append("**主要风险**")
            lines.extend(f"- {item}" for item in (risks + mismatches)[:4])
        if controls:
            lines.append("**风险控制**")
            lines.extend(f"- {item}" for item in controls[:3])
        if sources:
            lines.append("**来源**")
            for source in sources[:3]:
                title = str(source.get("title") or source.get("provider") or "策略资料")
                url = str(source.get("sourceUrl") or "")
                lines.append(f"- [{title}]({url})" if url else f"- {title}")

    lines.append("> 策略卡仅作为研究依据，不代表盈利保证；运行前仍需结合数据可用性和回测结果验证。")
    return "\n\n".join(line for line in lines if line)


def _agent_runtime_error_message(error: Exception) -> str:
    detail = str(error)
    if "timed out" in detail.lower() or "APITimeoutError" in detail:
        return "本轮大模型响应超时，已经完成的工具结果仍会保留。请重试一次，或缩短本轮任务范围。"
    if "AllocationQuota.FreeTierOnly" in detail or "free tier" in detail.lower():
        return "当前大模型免费额度已用尽，请切换到有可用额度的模型后重试。"
    if "403" in detail or "PermissionDenied" in detail:
        return "大模型服务拒绝了请求，请检查模型权限或账户额度后重试。"
    return f"本轮 Agent 执行失败：{detail[:300]}"


def _agent_instructions() -> str:
    return """You are StrategyLabAgent, a conversational quantitative research assistant.

Use skills and tools rather than a fixed workflow. Your first tool call for any domain task must load the most relevant skill (you may list skills first when necessary). Do not call market, code, or backtest tools before loading that skill. You may load another skill when the conversation changes phase. Valid skill names are exactly: strategy-lab-market-research, strategy-lab-strategy-design, strategy-lab-code-generation, and strategy-lab-backtest-analysis. Never invent another skill name.

Rules:
1. For questions about current market conditions, use real market tools before making claims. Include symbol, timeframe, source, and observation time. Never present mock data as current market data.
1a. Bitget MCP tools prefixed with `spot_` and `futures_` provide public exchange evidence. Use futures funding rate, open interest, order-book depth, and contract data when leverage, crowding, liquidity, or derivatives risk is relevant. These tools are read-only; never claim to place or manage orders.
1b. Use CMC tools for asset fundamentals and global context, Coin Metrics for daily on-chain evidence, and mempool.space for Bitcoin network congestion. State each source and freshness. Never describe these sources as news feeds.
2. Do not generate code unless the user explicitly asks to write, generate, implement, or modify code.
3. When code is explicitly requested from a strategy-library candidate, call validate_strategy_design first. Generate the complete Python code yourself under the code-generation skill, then call validate_and_commit_code with supporting card IDs in strategy_card_ids_csv, for example "strategy-card-rsi-bollinger-mean-reversion". Do not claim success unless that tool succeeds.
4. Do not run a backtest unless the user explicitly asks to run or backtest. Use run_strategy_backtest when explicitly requested.
4a. Backtests support only `mock` simulated data and `bitget_public` public market data. Never invent or claim another data source.
5. Use recent conversation context to resolve references such as '第二个', '这个策略', or '按刚才的行情'.
5a. For strategy recommendations, call search_strategy_library exactly once after collecting relevant market evidence. Pass available data as available_data_csv such as "ohlcv" or "ohlcv,orderbook". The tool automatically relaxes overly strict filters and returns two complete recommendedCandidates with risks and sources. Answer immediately from that evidence; do not call search_strategy_library, get_strategy_card, compare_strategy_candidates, or any other strategy tool again for a simple recommendation. Never announce a future search and stop without recommendations.
5b. Treat strategy cards as research evidence, not executable templates or proof of profitability. Cite their source titles, disclose mismatches and failure modes, and never invent a card or source that tools did not return.
5c. Use compare_strategy_cards once when the user explicitly asks to compare or choose between multiple named candidates. Pass two card IDs as first_card_id and second_card_id and available data as available_data_csv. Do not call it for a simple recommendation.
6. Keep recommendations evidence-based and explain uncertainty. Do not promise investment returns or place live orders.
7. Answer in Chinese unless the user requests another language.
8. Keep final answers concise and useful. Do not expose internal skill names unless they help explain an error.
9. After validate_and_commit_code succeeds, summarize the strategy and tell the user the code card is ready. Do not repeat the full source code in the chat response.
10. For order-book evidence, prefer spot_get_depth. Use futures tools primarily for funding rate and open interest, and pass productType="USDT-FUTURES" for BTCUSDT. Do not retry the same failed external source more than once.
"""


def _agent_user_input(
    *,
    prompt: str,
    session: dict[str, Any],
    messages: list[dict[str, Any]],
    active_code_package: dict[str, Any],
) -> str:
    recent_messages = []
    for message in messages[-10:]:
        content = re.sub(r"\s+", " ", str(message.get("content") or "")).strip()
        if content:
            recent_messages.append(
                {
                    "role": str(message.get("role") or "user"),
                    "content": content[:700],
                }
            )

    active_context: dict[str, Any] | None = None
    if active_code_package:
        active_context = {
            "id": active_code_package.get("id"),
            "title": active_code_package.get("title"),
            "explanation": active_code_package.get("explanation"),
            "params": active_code_package.get("params"),
            "code": str(active_code_package.get("code") or "")[:16000],
        }

    return json.dumps(
        {
            "current_time_utc": _utc_now(),
            "session": {"id": session.get("id"), "title": session.get("title")},
            "recent_messages": recent_messages,
            "active_code_package": active_context,
            "user_message": prompt,
        },
        ensure_ascii=False,
    )


def _list_strategy_skills(query: str = "") -> dict[str, Any]:
    normalized = query.lower().strip()
    skills = []
    for name in sorted(STRATEGY_LAB_SKILLS):
        metadata, _ = _read_skill(name)
        haystack = f"{name} {metadata.get('description', '')}".lower()
        query_tokens = [token for token in re.split(r"[^a-z0-9\u4e00-\u9fff]+", normalized) if len(token) >= 2]
        if normalized and normalized not in haystack and not any(token in haystack for token in query_tokens):
            continue
        skills.append(
            {
                "name": name,
                "description": metadata.get("description", ""),
            }
        )
    return {"skills": skills, "count": len(skills)}


def _load_strategy_skill(name: str) -> dict[str, Any]:
    normalized_name = name.strip().lower().replace("_", "-")
    canonical_name = STRATEGY_LAB_SKILL_ALIASES.get(normalized_name, normalized_name)
    if canonical_name not in STRATEGY_LAB_SKILLS:
        raise ValueError(f"Unknown Strategy Lab skill: {name}")
    metadata, content = _read_skill(canonical_name)
    return {
        "name": canonical_name,
        "requestedName": name,
        "description": metadata.get("description", ""),
        "instructions": content,
    }


def _read_skill(name: str) -> tuple[dict[str, str], str]:
    path = SKILLS_DIR / name / "SKILL.md"
    text = path.read_text(encoding="utf-8")
    metadata: dict[str, str] = {}
    body = text
    if text.startswith("---\n"):
        _, frontmatter, body = text.split("---", 2)
        for line in frontmatter.splitlines():
            key, separator, value = line.partition(":")
            if separator:
                metadata[key.strip()] = value.strip()
    return metadata, body.strip()


def _get_market_ticker(symbol: str) -> dict[str, Any]:
    normalized_symbol = _normalize_symbol(symbol)
    ticker = BitgetApiClient().get_ticker(normalized_symbol)
    timestamp = ticker.get("timestamp")
    observed_at = _timestamp_to_iso(timestamp)
    last = float(ticker.get("last") or 0)
    high = float(ticker.get("high24h") or 0)
    low = float(ticker.get("low24h") or 0)
    return {
        "success": True,
        "source": "bitget_public",
        "symbol": normalized_symbol,
        "observedAt": observed_at,
        "last": last,
        "high24h": high,
        "low24h": low,
        "range24hPct": round(((high - low) / last * 100) if last else 0, 3),
        "quoteVolume24h": float(ticker.get("volume24h") or 0),
    }


def _analyze_market_timeframe(symbol: str, timeframe: str, limit: int) -> dict[str, Any]:
    normalized_symbol = _normalize_symbol(symbol)
    granularity = _normalize_timeframe(timeframe)
    candle_limit = max(80, min(int(limit), 500))
    candles = BitgetApiClient().get_candles(normalized_symbol, granularity, candle_limit)
    if len(candles) < 60:
        raise ValueError(f"Not enough candles returned for {normalized_symbol} {granularity}.")

    frame = pd.DataFrame(candles)
    close = frame["close"].astype(float)
    high = frame["high"].astype(float)
    low = frame["low"].astype(float)
    ema20 = close.ewm(span=20, adjust=False).mean()
    ema60 = close.ewm(span=60, adjust=False).mean()
    ema200 = close.ewm(span=min(200, len(close)), adjust=False).mean()
    rsi = _rsi(close, 14)
    atr = _atr(high, low, close, 14)
    adx = _adx(high, low, close, 14)

    last_close = float(close.iloc[-1])
    last_ema20 = float(ema20.iloc[-1])
    last_ema60 = float(ema60.iloc[-1])
    last_ema200 = float(ema200.iloc[-1])
    last_rsi = float(rsi.iloc[-1])
    last_atr = float(atr.iloc[-1])
    last_adx = float(adx.iloc[-1]) if not math.isnan(float(adx.iloc[-1])) else 0.0
    atr_pct = last_atr / last_close * 100 if last_close else 0.0
    return_20 = (last_close / float(close.iloc[-21]) - 1) * 100 if len(close) > 20 else 0.0
    trend, regime = _classify_regime(
        close=last_close,
        ema20=last_ema20,
        ema60=last_ema60,
        adx=last_adx,
        atr_pct=atr_pct,
    )
    volatility = "high" if atr_pct >= 3.0 else "medium" if atr_pct >= 1.4 else "low"

    return {
        "success": True,
        "source": "bitget_public",
        "symbol": normalized_symbol,
        "timeframe": granularity,
        "observedAt": _timestamp_to_iso(candles[-1].get("timestamp")),
        "candleCount": len(candles),
        "close": round(last_close, 4),
        "return20BarsPct": round(return_20, 3),
        "ema20": round(last_ema20, 4),
        "ema60": round(last_ema60, 4),
        "ema200": round(last_ema200, 4),
        "rsi14": round(last_rsi, 3),
        "atr14": round(last_atr, 4),
        "atrPct": round(atr_pct, 3),
        "adx14": round(last_adx, 3),
        "trend": trend,
        "volatility": volatility,
        "regime": regime,
    }


def _compare_strategy_candidates(
    regime: str,
    trend: str,
    volatility: str,
    rsi: float | None,
) -> dict[str, Any]:
    normalized_regime = regime.lower().strip()
    normalized_trend = trend.lower().strip()
    normalized_volatility = volatility.lower().strip()
    candidates: list[dict[str, Any]] = []

    if "trend" in normalized_regime or normalized_trend in {"up", "down"}:
        candidates.extend(
            [
                {
                    "name": "趋势跟随",
                    "fit": "high",
                    "logic": "EMA/通道方向过滤后顺势参与",
                    "risk": "趋势衰竭或快速反转时连续止损",
                },
                {
                    "name": "波动率突破",
                    "fit": "high" if normalized_volatility != "low" else "medium",
                    "logic": "唐奇安通道或布林带突破配合 ATR 仓位",
                    "risk": "震荡区间容易出现假突破",
                },
            ]
        )
    else:
        candidates.extend(
            [
                {
                    "name": "均值回归",
                    "fit": "high",
                    "logic": "RSI/KDJ 极值结合区间边界反转",
                    "risk": "单边趋势中指标可能长期钝化",
                },
                {
                    "name": "区间突破等待",
                    "fit": "medium",
                    "logic": "减少区间内交易，等待放量突破",
                    "risk": "可能错过区间内部短线机会",
                },
            ]
        )

    if rsi is not None and (float(rsi) >= 70 or float(rsi) <= 30):
        candidates.append(
            {
                "name": "极值反转观察",
                "fit": "conditional",
                "logic": "等待 RSI 极值与价格结构共同确认",
                "risk": "不能仅凭超买超卖逆势入场",
            }
        )

    return {
        "regime": regime,
        "trend": trend,
        "volatility": volatility,
        "candidates": candidates[:3],
    }


def _csv_values(value: str) -> list[str]:
    return [
        item.strip().lower()
        for item in re.split(r"[,，]", value or "")
        if item.strip()
    ]


def _validate_and_prepare_code_package(
    title: str,
    code: str,
    explanation: str,
    strategy_card_ids: list[str] | None = None,
) -> dict[str, Any]:
    validation = _validate_strategy_code(code)
    if not validation.valid:
        return {
            "success": False,
            "validation": {
                "status": validation.status,
                "checks": validation.checks,
                "errors": validation.errors,
                "warnings": validation.warnings,
            },
        }
    clean_code = _clean_code(code)
    try:
        strategy_references = resolve_strategy_references(strategy_card_ids or [])
    except ValueError as error:
        return {
            "success": False,
            "validation": {
                "status": "failed",
                "checks": validation.checks,
                "errors": [str(error)],
                "warnings": validation.warnings,
            },
        }
    return {
        "success": True,
        "codePackage": {
            "title": title.strip()[:80] or "策略代码包",
            "code": clean_code,
            "params": _extract_code_params(clean_code),
            "explanation": explanation.strip(),
            "codeSource": "strategy_lab_agent",
            "strategyReferences": strategy_references,
            "validation": {
                "status": validation.status,
                "checks": validation.checks,
                "errors": validation.errors,
                "warnings": validation.warnings,
            },
        },
    }


def _run_active_backtest(
    *,
    source: dict[str, Any],
    start_date: str,
    end_date: str,
    data_source: str,
    symbol: str,
    timeframe: str,
) -> dict[str, Any]:
    if not source or not str(source.get("code") or "").strip():
        return {"success": False, "error": "当前会话没有可运行的代码包。"}
    normalized_source = "bitget_public" if data_source == "bitget_public" else "mock"
    config = {
        "startDate": start_date,
        "endDate": end_date,
        "initialCapital": 100000,
        "dataSource": normalized_source,
        "symbol": _normalize_symbol(symbol),
        "granularity": _normalize_timeframe(timeframe),
        "limit": 300,
        "params": dict(source.get("params") or {}),
    }
    result = StrategySandboxExecutor.execute_strategy(str(source.get("code") or ""), config)
    if not result.get("success"):
        return {"success": False, "error": result.get("error"), "dataSource": normalized_source}
    backtest = result.get("backtest") or {}
    metrics = {
        "totalReturn": float(backtest.get("total_return_pct") or 0),
        "annualizedReturn": float(backtest.get("annualized_return_pct") or 0),
        "maxDrawdown": float(backtest.get("max_drawdown_pct") or 0),
        "winRate": float(backtest.get("win_rate_pct") or 0),
        "sharpe": float(backtest.get("sharpe_ratio") or 0),
        "tradeCount": int(backtest.get("trade_count") or 0),
        "profitFactor": float(backtest.get("profit_factor") or 0),
        "averageTrade": float(backtest.get("average_trade_pct") or 0),
    }
    return {
        "success": True,
        "dataSource": normalized_source,
        "metrics": metrics,
        "backtestProposal": {
            "source": source,
            "result": result,
            "params": dict(source.get("params") or {}),
            "config": config,
        },
    }


def _extract_code_params(code: str) -> dict[str, Any]:
    params: dict[str, Any] = {}
    pattern = re.compile(
        r"#\s*@param:\s*([A-Za-z_][A-Za-z0-9_]*)\|[^|]*\|(int|float|str|bool)\|([^|\n]+)",
        re.IGNORECASE,
    )
    for match in pattern.finditer(code):
        identifier, value_type, raw_value = match.groups()
        value_text = raw_value.strip()
        try:
            if value_type.lower() == "int":
                value: Any = int(float(value_text))
            elif value_type.lower() == "float":
                value = float(value_text)
            elif value_type.lower() == "bool":
                value = value_text.lower() in {"1", "true", "yes", "on"}
            else:
                value = value_text
        except ValueError:
            continue
        params[identifier] = value
    return params


def _latest_code_package(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    candidates = [artifact for artifact in artifacts if artifact.get("type") == "code_package"]
    if not candidates:
        return {}
    return sorted(candidates, key=lambda item: str(item.get("updatedAt") or ""), reverse=True)[0]


def _rsi(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    gains = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    losses = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    relative_strength = gains / losses.replace(0, np.nan)
    return (100 - (100 / (1 + relative_strength))).fillna(50.0)


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int) -> pd.Series:
    previous_close = close.shift(1)
    true_range = pd.concat(
        [(high - low), (high - previous_close).abs(), (low - previous_close).abs()],
        axis=1,
    ).max(axis=1)
    return true_range.ewm(alpha=1 / period, adjust=False).mean()


def _adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int) -> pd.Series:
    upward = high.diff()
    downward = -low.diff()
    plus_dm = upward.where((upward > downward) & (upward > 0), 0.0)
    minus_dm = downward.where((downward > upward) & (downward > 0), 0.0)
    atr = _atr(high, low, close, period).replace(0, np.nan)
    plus_di = 100 * plus_dm.ewm(alpha=1 / period, adjust=False).mean() / atr
    minus_di = 100 * minus_dm.ewm(alpha=1 / period, adjust=False).mean() / atr
    dx = ((plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)) * 100
    return dx.ewm(alpha=1 / period, adjust=False).mean().fillna(0.0)


def _classify_regime(
    *,
    close: float,
    ema20: float,
    ema60: float,
    adx: float,
    atr_pct: float,
) -> tuple[str, str]:
    if close > ema20 > ema60:
        trend = "up"
    elif close < ema20 < ema60:
        trend = "down"
    else:
        trend = "mixed"
    if adx >= 25 and trend == "up":
        return trend, "trending_up"
    if adx >= 25 and trend == "down":
        return trend, "trending_down"
    if atr_pct >= 3.0:
        return trend, "high_volatility_transition"
    return trend, "ranging"


def _normalize_symbol(symbol: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9]", "", symbol).upper()
    if not normalized:
        raise ValueError("symbol is required")
    return normalized


def _normalize_timeframe(timeframe: str) -> str:
    value = timeframe.strip().lower()
    mapping = {
        "1m": "1min",
        "5m": "5min",
        "15m": "15min",
        "30m": "30min",
        "1h": "1h",
        "4h": "4h",
        "6h": "6h",
        "12h": "12h",
        "1d": "1day",
        "1day": "1day",
        "1w": "1week",
        "1week": "1week",
    }
    if value not in mapping:
        raise ValueError(f"Unsupported timeframe: {timeframe}")
    return mapping[value]


def _timestamp_to_iso(timestamp: Any) -> str:
    try:
        numeric = int(timestamp)
        if numeric > 10_000_000_000:
            numeric /= 1000
        return datetime.fromtimestamp(numeric, tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return _utc_now()


def _clean_code(code: str) -> str:
    text = code.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:python)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip() + "\n"


def _safe_arguments(arguments: dict[str, Any]) -> dict[str, Any]:
    safe = dict(arguments)
    if "code" in safe:
        safe["code"] = f"<{len(str(safe['code']))} chars>"
    return safe


def _tool_result_summary(result: Any) -> str:
    if isinstance(result, dict):
        if result.get("error"):
            return str(result["error"])[:300]
        if "regime" in result:
            return f"regime={result.get('regime')}, trend={result.get('trend')}, volatility={result.get('volatility')}"
        if "codePackage" in result:
            return f"validated code package: {result['codePackage'].get('title')}"
        if "metrics" in result:
            return f"backtest metrics: {json.dumps(result.get('metrics'), ensure_ascii=False)[:220]}"
        if "skills" in result:
            return f"returned {len(result.get('skills') or [])} skills"
        if result.get("observedAt"):
            return f"market data observed at {result.get('observedAt')}"
    content_text = _content_result_text(result)
    if content_text:
        return content_text[:300]
    return str(result)[:300]


def _content_result_text(result: Any) -> str:
    """Extract readable MCP/Agent Framework content without leaking object reprs."""

    values = result if isinstance(result, (list, tuple)) else [result]
    parts: list[str] = []
    for value in values:
        text = getattr(value, "text", None)
        if text is not None:
            parts.append(str(text))
            continue
        content = getattr(value, "content", None)
        if isinstance(content, (list, tuple)):
            parts.extend(
                str(item_text)
                for item in content
                if (item_text := getattr(item, "text", None)) is not None
            )
    return "\n".join(part.strip() for part in parts if part.strip())


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
