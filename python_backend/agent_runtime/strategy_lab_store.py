from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock, Thread
from typing import Any
from uuid import uuid4

from agent_runtime.platform_store import connect, get_entity, list_entities, upsert_entity
from agent_runtime.sandbox_executor import StrategySandboxExecutor
from agent_runtime.strategy_lab_single_agent import run_strategy_lab_agent


_MESSAGE_JOBS: dict[str, dict[str, Any]] = {}
_MESSAGE_JOBS_LOCK = Lock()


def list_strategy_lab_sessions() -> list[dict[str, Any]]:
    sessions = list_entities("strategy_lab_session")
    visible_sessions = [
        session
        for session in sessions
        if _session_has_user_activity(session["id"])
    ]
    return sorted(visible_sessions, key=lambda session: session.get("updatedAt", ""), reverse=True)


def create_strategy_lab_session(input_data: dict[str, Any] | None = None) -> dict[str, Any]:
    input_data = input_data or {}
    now = _now()
    session_id = f"sl-session-{uuid4().hex[:8]}"
    title = str(input_data.get("title") or "未命名策略").strip()
    session = {
        "id": session_id,
        "title": title,
        "subtitle": str(input_data.get("subtitle") or "Python sandbox workspace").strip(),
        "createdAt": now,
        "updatedAt": now,
        "activeArtifactId": None,
        "feed": [],
        "framework": "agent-framework",
    }

    with connect() as db:
        upsert_entity(db, "strategy_lab_session", session_id, session)

    return session


def get_strategy_lab_session(session_id: str) -> dict[str, Any] | None:
    session = get_entity("strategy_lab_session", session_id)
    if not session:
        return None
    return {
        "session": session,
        "messages": _session_messages(session_id),
        "artifacts": _session_artifacts(session_id),
        "feed": session.get("feed", []),
    }


def create_strategy_lab_message(
    session_id: str,
    input_data: dict[str, Any],
    progress_callback: Any = None,
) -> dict[str, Any]:
    session = get_entity("strategy_lab_session", session_id)
    if not session:
        raise ValueError(f"Strategy Lab session not found: {session_id}")

    prompt = str(input_data.get("content") or input_data.get("message") or "").strip()
    if not prompt:
        raise ValueError("content is required")

    now = _now()
    user_message = _message(session_id, "user", prompt, now=now)
    existing_artifacts = _session_artifacts(session_id)
    existing_messages = _session_messages(session_id)

    try:
        agent_result = run_strategy_lab_agent(
            prompt=prompt,
            session=session,
            messages=existing_messages,
            artifacts=existing_artifacts,
            progress_callback=progress_callback,
        )
    except Exception as error:
        agent_result = {
            "content": _friendly_agent_error(error),
            "toolTrace": [],
            "framework": "microsoft-agent-framework/agent-tool-loop",
            "agent": "StrategyLabAgent",
        }

    assistant_message = _message(
        session_id,
        "assistant",
        str(agent_result.get("content") or "StrategyLabAgent 已完成本轮处理。"),
        now=now,
    )
    assistant_message["agent"] = agent_result.get("agent") or "StrategyLabAgent"
    assistant_message["framework"] = agent_result.get("framework")
    assistant_message["toolTrace"] = agent_result.get("toolTrace") or []
    assistant_message["llmProvider"] = agent_result.get("llmProvider")
    assistant_message["llmModel"] = agent_result.get("llmModel")

    artifacts_to_save: list[dict[str, Any]] = []
    code_package_result = agent_result.get("codePackage")
    code_artifact: dict[str, Any] | None = None
    if isinstance(code_package_result, dict):
        code_artifact = _code_package(
            session_id=session_id,
            title=str(code_package_result.get("title") or prompt[:18] or "策略代码包"),
            code=str(code_package_result.get("code") or ""),
            params=dict(input_data.get("params") or code_package_result.get("params") or {}),
            explanation=str(code_package_result.get("explanation") or ""),
            now=now,
            metadata={
                "framework": agent_result.get("framework"),
                "agent": agent_result.get("agent"),
                "codeSource": code_package_result.get("codeSource") or "strategy_lab_agent",
                "codeValidation": code_package_result.get("validation"),
                "strategyReferences": code_package_result.get("strategyReferences") or [],
                "toolTrace": agent_result.get("toolTrace") or [],
                "llmProvider": agent_result.get("llmProvider"),
                "llmModel": agent_result.get("llmModel"),
            },
        )
        artifacts_to_save.append(code_artifact)

    backtest_proposal = agent_result.get("backtestProposal")
    if isinstance(backtest_proposal, dict):
        source = code_artifact or backtest_proposal.get("source") or {}
        backtest_artifact = _backtest_artifact(
            session_id=session_id,
            source=source,
            result=dict(backtest_proposal.get("result") or {}),
            params=dict(backtest_proposal.get("params") or source.get("params") or {}),
            now=now,
        )
        backtest_artifact["backtestConfig"] = backtest_proposal.get("config") or {}
        backtest_artifact["framework"] = agent_result.get("framework")
        backtest_artifact["agent"] = agent_result.get("agent")
        backtest_artifact["toolTrace"] = agent_result.get("toolTrace") or []
        artifacts_to_save.append(backtest_artifact)

    session["updatedAt"] = now
    if not _session_has_user_activity(session_id):
        session["title"] = str((code_artifact or {}).get("title") or prompt[:18] or "策略研究")
    if artifacts_to_save:
        session["activeArtifactId"] = artifacts_to_save[-1]["id"]
    session.setdefault("feed", []).extend(
        [
            {"id": user_message["id"], "kind": "message", "messageId": user_message["id"]},
            {"id": assistant_message["id"], "kind": "message", "messageId": assistant_message["id"]},
        ]
    )
    session["feed"].extend(
        {"id": f"feed-{artifact['id']}", "kind": "artifact", "artifactId": artifact["id"]}
        for artifact in artifacts_to_save
    )

    with connect() as db:
        upsert_entity(db, "strategy_lab_session", session_id, session)
        upsert_entity(db, "strategy_lab_message", user_message["id"], user_message)
        upsert_entity(db, "strategy_lab_message", assistant_message["id"], assistant_message)
        for artifact in artifacts_to_save:
            upsert_entity(db, "strategy_lab_artifact", artifact["id"], artifact)

    return get_strategy_lab_session(session_id) or {}


def start_strategy_lab_message_job(session_id: str, input_data: dict[str, Any]) -> dict[str, Any]:
    session = get_entity("strategy_lab_session", session_id)
    if not session:
        raise ValueError(f"Strategy Lab session not found: {session_id}")
    prompt = str(input_data.get("content") or input_data.get("message") or "").strip()
    if not prompt:
        raise ValueError("content is required")

    job_id = f"sl-job-{uuid4().hex[:10]}"
    job = {
        "id": job_id,
        "sessionId": session_id,
        "status": "running",
        "events": [
            {
                "tool": "request_received",
                "status": "running",
                "summary": "正在理解请求并准备研究步骤",
                "startedAt": _now(),
            }
        ],
        "createdAt": _now(),
        "updatedAt": _now(),
    }
    with _MESSAGE_JOBS_LOCK:
        _MESSAGE_JOBS[job_id] = job

    def update_progress(event: dict[str, Any]) -> None:
        with _MESSAGE_JOBS_LOCK:
            current = _MESSAGE_JOBS.get(job_id)
            if not current:
                return
            events = current.setdefault("events", [])
            if event.get("tool") != "request_received":
                for item in events:
                    if item.get("tool") == "request_received" and item.get("status") == "running":
                        item["status"] = "completed"
                        item["completedAt"] = _now()
            event_key = (event.get("tool"), event.get("startedAt"))
            match = next(
                (
                    index
                    for index, item in enumerate(events)
                    if (item.get("tool"), item.get("startedAt")) == event_key
                ),
                None,
            )
            if match is None:
                events.append(dict(event))
            else:
                events[match] = dict(event)
            current["updatedAt"] = _now()

    def run_job() -> None:
        try:
            detail = create_strategy_lab_message(
                session_id,
                input_data,
                progress_callback=update_progress,
            )
            with _MESSAGE_JOBS_LOCK:
                current = _MESSAGE_JOBS[job_id]
                current["status"] = "completed"
                current["detail"] = detail
                current["updatedAt"] = _now()
        except Exception as error:
            with _MESSAGE_JOBS_LOCK:
                current = _MESSAGE_JOBS[job_id]
                current["status"] = "failed"
                current["error"] = str(error)
                current["updatedAt"] = _now()

    Thread(target=run_job, name=job_id, daemon=True).start()
    return dict(job)


def get_strategy_lab_message_job(job_id: str) -> dict[str, Any] | None:
    with _MESSAGE_JOBS_LOCK:
        job = _MESSAGE_JOBS.get(job_id)
        return dict(job) if job else None


def update_strategy_lab_artifact(artifact_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    artifact = get_entity("strategy_lab_artifact", artifact_id)
    if not artifact:
        raise ValueError(f"Strategy Lab artifact not found: {artifact_id}")

    allowed_fields = {"title", "code", "params", "explanation"}
    for field in allowed_fields:
        if field in patch:
            artifact[field] = patch[field]
    artifact["updatedAt"] = _now()

    with connect() as db:
        upsert_entity(db, "strategy_lab_artifact", artifact_id, artifact)
    return artifact


def run_strategy_lab_artifact(artifact_id: str, input_data: dict[str, Any]) -> dict[str, Any]:
    source = get_entity("strategy_lab_artifact", artifact_id)
    if not source:
        raise ValueError(f"Strategy Lab artifact not found: {artifact_id}")

    session_id = source.get("sessionId")
    session = get_entity("strategy_lab_session", session_id)
    if not session:
        raise ValueError(f"Strategy Lab session not found: {session_id}")

    code = str(input_data.get("strategyCode") or input_data.get("code") or source.get("code") or "")
    if not code.strip():
        raise ValueError("strategyCode is required")

    params = dict(input_data.get("params") or source.get("params") or {})
    backtest_config = input_data.get("backtestConfig") or input_data.get("backtest_config") or {}
    result = StrategySandboxExecutor.execute_strategy(code, backtest_config)
    if not result.get("success"):
        return {
            "success": False,
            "error": result.get("error", "Sandbox execution failed"),
            "result": result,
        }

    now = _now()
    source_for_artifact = {
        **source,
        "code": code,
        "params": params,
    }
    artifact = _backtest_artifact(
        session_id=session_id,
        source=source_for_artifact,
        result=result,
        params=params,
        now=now,
    )
    artifact["backtestConfig"] = backtest_config
    message = _message(
        session_id,
        "assistant",
        "沙箱回测已完成，当前策略卡片已更新。",
        now=now,
        message_id=f"message-run-{artifact['id']}",
    )
    session["updatedAt"] = now
    session["activeArtifactId"] = artifact["id"]
    session["feed"] = _replace_strategy_run_feed_item(
        session=session,
        current_artifact=artifact,
    )

    with connect() as db:
        upsert_entity(db, "strategy_lab_session", session_id, session)
        upsert_entity(db, "strategy_lab_message", message["id"], message)
        upsert_entity(db, "strategy_lab_artifact", artifact["id"], artifact)

    return {
        "success": True,
        "artifact": artifact,
        "message": message,
        "session": session,
        "result": result,
    }


def _friendly_agent_error(error: Exception) -> str:
    detail = str(error)
    if "AllocationQuota.FreeTierOnly" in detail or "free tier" in detail.lower():
        return (
            "本轮请求未能完成：当前大模型的免费额度已用尽。"
            "系统没有继续伪造研究或策略结果，请切换到有可用额度的模型后重试。"
        )
    if "403" in detail or "PermissionDenied" in detail:
        return "本轮请求未能完成：大模型服务拒绝了请求，请检查模型权限或账户额度后重试。"
    return f"本轮 Agent 执行失败：{detail[:400]}"


def _replace_strategy_run_feed_item(
    *,
    session: dict[str, Any],
    current_artifact: dict[str, Any],
) -> list[dict[str, Any]]:
    package_id = current_artifact.get("codePackageId") or current_artifact.get("id")
    current_feed_item = {
        "id": f"feed-{current_artifact['id']}",
        "kind": "artifact",
        "artifactId": current_artifact["id"],
    }
    replaced = False
    next_feed: list[dict[str, Any]] = []

    for item in session.get("feed") or []:
        if item.get("kind") == "message":
            message_id = str(item.get("messageId") or item.get("id") or "")
            if message_id.startswith("message-run-"):
                continue
            next_feed.append(item)
            continue

        if item.get("kind") != "artifact":
            next_feed.append(item)
            continue

        feed_artifact = get_entity("strategy_lab_artifact", str(item.get("artifactId") or ""))
        if not feed_artifact:
            continue

        feed_package_id = feed_artifact.get("codePackageId") or feed_artifact.get("id")
        if feed_package_id == package_id:
            if not replaced:
                next_feed.append(current_feed_item)
                replaced = True
            continue

        next_feed.append(item)

    if not replaced:
        next_feed.append(current_feed_item)

    return next_feed


def analyze_strategy_lab_artifact(artifact_id: str) -> dict[str, Any]:
    """分析回测结果，给出诊断建议（手动触发）"""
    artifact = get_entity("strategy_lab_artifact", artifact_id)
    if not artifact:
        raise ValueError(f"Strategy Lab artifact not found: {artifact_id}")

    if artifact.get("type") != "backtest_run":
        raise ValueError("Only backtest_run artifacts can be analyzed")

    metrics = artifact.get("metrics") or {}
    analysis_result = _analyze_backtest_metrics(metrics)

    now = _now()
    message = _message(
        artifact.get("sessionId"),
        "assistant",
        f"Analysis Agent 已完成诊断：\n\n**诊断**：{analysis_result['diagnosis']}\n\n**建议**：\n{chr(10).join(f'- {r}' for r in analysis_result['recommendations'])}",
        now=now,
        message_id=f"message-analysis-{artifact_id}",
    )

    # 更新 artifact 添加分析结果
    artifact["analysisResult"] = analysis_result
    artifact["updatedAt"] = now

    session = get_entity("strategy_lab_session", artifact.get("sessionId"))
    if session:
        session["updatedAt"] = now
        session.setdefault("feed", []).append(
            {"id": message["id"], "kind": "message", "messageId": message["id"]}
        )
        with connect() as db:
            upsert_entity(db, "strategy_lab_session", session["id"], session)

    with connect() as db:
        upsert_entity(db, "strategy_lab_artifact", artifact_id, artifact)
        upsert_entity(db, "strategy_lab_message", message["id"], message)

    return {
        "success": True,
        "artifact": artifact,
        "message": message,
        "analysis": analysis_result,
    }


def _analyze_backtest_metrics(metrics: dict[str, Any]) -> dict[str, Any]:
    """分析回测指标，给出诊断建议"""
    trade_count = int(metrics.get("tradeCount") or 0)
    total_return = float(metrics.get("totalReturn") or 0)
    sharpe = float(metrics.get("sharpe") or 0)
    max_drawdown = float(metrics.get("maxDrawdown") or 0)

    # 诊断逻辑
    if trade_count == 0:
        return {
            "isSatisfactory": False,
            "diagnosis": "策略逻辑过于严格，没有产生任何交易信号",
            "recommendations": [
                "放宽 RSI 阈值（如 oversold=40, overbought=60）",
                "改用单条件触发（OR 而不是 AND）",
                "降低 MACD 参数以增加灵敏度",
            ],
            "metricsSummary": f"trade_count={trade_count}, total_return={total_return}%",
            "shouldOptimize": True,
            "suggestedParams": {
                "rsi_oversold": 40.0,
                "rsi_overbought": 60.0,
                "use_or_condition": True,
            },
        }

    if total_return < 5 and sharpe < 0.5:
        return {
            "isSatisfactory": False,
            "diagnosis": f"回测收益偏低（{total_return}%），风险调整收益不足（sharpe={sharpe})",
            "recommendations": [
                "增加止损逻辑（如 max_drawdown_pct=15%）",
                "优化入场时机（增加趋势过滤）",
                "调整仓位管理（如 max_position_pct=20%）",
            ],
            "metricsSummary": f"total_return={total_return}%, sharpe={sharpe}",
            "shouldOptimize": True,
            "suggestedParams": {
                "stop_loss_pct": 5.0,
                "max_position_pct": 20.0,
            },
        }

    if max_drawdown > 25:
        return {
            "isSatisfactory": False,
            "diagnosis": f"最大回撤过大（{max_drawdown}%），风险控制不足",
            "recommendations": [
                "增加止损条件",
                "降低仓位比例",
                "增加波动率过滤",
            ],
            "metricsSummary": f"max_drawdown={max_drawdown}%",
            "shouldOptimize": True,
            "suggestedParams": {
                "max_position_pct": 10.0,
                "stop_loss_pct": 8.0,
            },
        }

    if trade_count >= 3 and total_return >= 5 and sharpe >= 0.7:
        return {
            "isSatisfactory": True,
            "diagnosis": f"策略表现良好：{trade_count}次交易，收益{total_return}%，夏普{sharpe}",
            "recommendations": ["当前策略已通过基础风险检查，可以进入下一轮参数微调"],
            "metricsSummary": f"trade_count={trade_count}, return={total_return}%, sharpe={sharpe}",
            "shouldOptimize": False,
            "suggestedParams": {},
        }

    return {
        "isSatisfactory": False,
        "diagnosis": "策略表现一般，建议继续优化",
        "recommendations": ["尝试调整参数组合"],
        "metricsSummary": f"trade_count={trade_count}, return={total_return}%",
        "shouldOptimize": True,
        "suggestedParams": {},
    }


def seed_strategy_lab_if_empty() -> None:
    if list_entities("strategy_lab_session"):
        return
    create_strategy_lab_session()


def _session_has_user_activity(session_id: str) -> bool:
    messages = _session_messages(session_id)
    artifacts = _session_artifacts(session_id)
    return any(message.get("role") == "user" for message in messages) or any(
        artifact.get("type") == "backtest_run" for artifact in artifacts
    )


def _session_messages(session_id: str) -> list[dict[str, Any]]:
    return [
        message
        for message in list_entities("strategy_lab_message")
        if message.get("sessionId") == session_id
    ]


def _session_artifacts(session_id: str) -> list[dict[str, Any]]:
    return [
        artifact
        for artifact in list_entities("strategy_lab_artifact")
        if artifact.get("sessionId") == session_id
    ]


def _message(
    session_id: str,
    role: str,
    content: str,
    *,
    now: str,
    message_id: str | None = None,
) -> dict[str, Any]:
    return {
        "id": message_id or f"message-{uuid4().hex[:10]}",
        "sessionId": session_id,
        "kind": "message",
        "role": role,
        "content": content,
        "createdAt": now,
    }


def _code_package(
    *,
    session_id: str,
    title: str,
    code: str,
    params: dict[str, Any],
    explanation: str,
    now: str,
    artifact_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "type": "code_package",
        "id": artifact_id or f"artifact-code-{uuid4().hex[:10]}",
        "sessionId": session_id,
        "title": title,
        "code": code,
        "params": params,
        "explanation": explanation,
        **(metadata or {}),
        "createdAt": _display_time(now),
        "updatedAt": now,
    }


def _backtest_artifact(
    *,
    session_id: str,
    source: dict[str, Any],
    result: dict[str, Any],
    params: dict[str, Any],
    now: str,
) -> dict[str, Any]:
    backtest = result.get("backtest") or {}
    risk = result.get("risk") or {}
    total_return = float(backtest.get("total_return_pct") or 0)
    trades = _trade_rows(backtest.get("trades") or [])
    return {
        "type": "backtest_run",
        "id": f"artifact-run-{uuid4().hex[:10]}",
        "sessionId": session_id,
        "title": f"{_base_strategy_title(source.get('title') or '策略代码包')} 回测",
        "codePackageId": source.get("codePackageId") or source.get("id"),
        "code": source.get("code") or "",
        "params": params,
        "strategyReferences": source.get("strategyReferences") or [],
        "metrics": {
            "totalReturn": total_return,
            "annualReturn": round(total_return, 2),
            "sharpe": float(backtest.get("sharpe_ratio") or 0),
            "maxDrawdown": float(backtest.get("max_drawdown_pct") or 0),
            "winRate": float(backtest.get("win_rate_pct") or 0),
            "tradeCount": int(backtest.get("trade_count") or 0),
            "riskScore": float(risk.get("risk_score") or 0),
            "riskDecision": risk.get("decision") or "UNKNOWN",
            "recommendations": risk.get("recommendations") if isinstance(risk.get("recommendations"), list) else [],
        },
        "charts": result.get("charts") or {"cumulativeReturn": [], "dates": []},
        "monthlyReturns": result.get("monthlyReturns") or [],
        "trades": trades,
        "positions": _position_rows(trades),
        "logs": _run_logs(result, now),
        "createdAt": _display_time(now),
        "updatedAt": now,
    }


def _base_strategy_title(title: str) -> str:
    normalized = str(title or "策略代码包").strip() or "策略代码包"
    while normalized.endswith(" 回测"):
        normalized = normalized[: -len(" 回测")].rstrip()
    return normalized or "策略代码包"


def _trade_rows(raw_trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for trade in raw_trades:
        price = float(trade.get("price") or 0)
        quantity = 100
        fee = round(price * quantity * 0.001, 2)
        pnl_pct = float(trade.get("pnl_pct") or 0)
        side = "sell" if trade.get("side") == "sell" else "buy"
        rows.append(
            {
                "date": str(trade.get("date") or "-"),
                "symbol": "BTCUSDT",
                "side": side,
                "quantity": quantity,
                "price": price,
                "amount": round(price * quantity, 2),
                "pnl": round((price * quantity * pnl_pct) / 100, 2) if side == "sell" else None,
                "fee": fee,
            }
        )
    return rows


def _position_rows(trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    buy_trades = [trade for trade in trades if trade.get("side") == "buy"][-12:]
    for index, trade in enumerate(buy_trades):
        price = float(trade.get("price") or 0)
        quantity = float(trade.get("quantity") or 0)
        close = round(price * (1 + ((index % 5) - 2) * 0.012), 4)
        market_value = round(close * quantity, 2)
        rows.append(
            {
                "date": trade.get("date"),
                "symbol": trade.get("symbol"),
                "quantity": quantity,
                "cost": price,
                "close": close,
                "marketValue": market_value,
                "weight": round(market_value / 100000 * 100, 2),
                "pnl": round((close - price) * quantity, 2),
            }
        )
    return rows


def _run_logs(result: dict[str, Any], now: str) -> list[dict[str, Any]]:
    display_time = _display_time(now)
    logs = [
        {"time": display_time, "level": "INFO", "message": "start sandbox backtest"},
        {"time": display_time, "level": "INFO", "message": f"sandbox type: {result.get('sandbox_type') or 'python'}"},
        {"time": display_time, "level": "INFO", "message": "generate mock market data"},
        {"time": display_time, "level": "INFO", "message": "execute strategy.generate_signals(data)"},
        {"time": display_time, "level": "INFO", "message": "calculate metrics, trades, drawdown, monthly returns"},
    ]
    if result.get("stdout"):
        logs.append({"time": display_time, "level": "INFO", "message": f"stdout: {result['stdout']}"})
    if result.get("stderr"):
        logs.append({"time": display_time, "level": "WARN", "message": f"stderr: {result['stderr']}"})
    return logs


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _display_time(value: str) -> str:
    return value[11:19] if len(value) >= 19 else value
