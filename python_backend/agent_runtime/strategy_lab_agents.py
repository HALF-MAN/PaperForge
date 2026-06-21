from __future__ import annotations

import asyncio
import ast
import json
import os
import re
import ssl
from dataclasses import asdict, dataclass, field
from importlib.metadata import PackageNotFoundError, version
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from agent_framework import Executor, WorkflowBuilder, WorkflowContext, handler

from agent_runtime.env import load_dotenv


PlannerIntent = Literal["create_code_package", "modify_code", "explain", "run_backtest"]
TurnIntent = Literal["research", "chat", "create_code_package", "modify_code", "explain", "run_backtest"]
StrategyFamily = Literal["ema_trend", "rsi_reversal", "kdj_reversal", "momentum"]


class CodeGenerationError(RuntimeError):
    """Raised when Code Agent cannot produce valid LLM-generated code."""


@dataclass
class PlannerDecision:
    intent: PlannerIntent
    title: str
    strategy_family: StrategyFamily
    summary: str
    required_context: list[str]
    output_type: Literal["code_package"] = "code_package"
    selected_agents: list[str] = field(default_factory=list)
    selected_skills: list[str] = field(default_factory=list)
    delivery_standards: list[str] = field(default_factory=list)
    next_actions: list[str] = field(default_factory=list)
    planner_source: Literal["llm", "rules"] = "rules"
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_warning: str | None = None


@dataclass
class CodeAgentResult:
    title: str
    code: str
    params: dict[str, Any]
    explanation: str
    code_source: Literal["llm"] = "llm"
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_warning: str | None = None


@dataclass
class CodeValidationResult:
    valid: bool
    status: Literal["passed", "failed"]
    checks: list[str]
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class IntentRoutingResult:
    intent: TurnIntent
    title: str
    summary: str
    should_generate_code: bool
    response_kind: Literal["message", "code_package"]
    confidence: float
    router_source: Literal["rules", "llm"] = "rules"
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_warning: str | None = None


class StrategyLabPlannerExecutor(Executor):
    """Plan a Strategy Lab turn before code generation.

    This keeps the outer orchestration in Microsoft Agent Framework while the
    agent internals can later be replaced with LLM/tool-calling.
    """

    def __init__(self):
        super().__init__(id="strategy_lab_planner")

    @handler
    async def handle(self, request: dict[str, Any], ctx: WorkflowContext[dict[str, Any]]) -> None:
        prompt = str(request.get("prompt") or "")
        session = request.get("session") if isinstance(request.get("session"), dict) else {}
        artifacts = request.get("artifacts") if isinstance(request.get("artifacts"), list) else []
        messages = request.get("messages") if isinstance(request.get("messages"), list) else []
        has_code_package = any(artifact.get("type") == "code_package" for artifact in artifacts)

        decision = await asyncio.to_thread(
            _plan_strategy_turn,
            prompt,
            has_code_package=has_code_package,
            session=session,
            artifacts=artifacts,
            messages=messages,
        )
        trace = [
            {
                "agent": "Planner Agent",
                "step": "understand_request",
                "status": "completed",
                "summary": decision.summary,
            },
            {
                "agent": "Planner Agent",
                "step": "compose_workflow",
                "status": "completed",
                "summary": (
                    "LLM planner selected Code Agent and code_package delivery standards."
                    if decision.planner_source == "llm"
                    else "Rule planner selected Code Agent and code_package delivery standards."
                ),
            },
        ]

        await ctx.send_message(
            {
                **request,
                "plannerDecision": asdict(decision),
                "agentTrace": trace,
                "framework": _framework_label(),
            }
        )


class StrategyLabCodeAgentExecutor(Executor):
    """Generate sandbox-compatible Python Strategy code."""

    def __init__(self):
        super().__init__(id="strategy_lab_code_agent")

    @handler
    async def handle(self, state: dict[str, Any], ctx: WorkflowContext[dict[str, Any]]) -> None:
        decision = state.get("plannerDecision") or {}
        prompt = str(state.get("prompt") or "")
        artifacts = state.get("artifacts") if isinstance(state.get("artifacts"), list) else []
        previous_code = _latest_code_package(artifacts).get("code") if artifacts else None

        result = _generate_code_package(
            prompt=prompt,
            decision=decision,
            previous_code=str(previous_code or ""),
        )
        validation = _validate_strategy_code(result.code)
        if not validation.valid:
            raise CodeGenerationError(
                "Code Agent generated invalid code: "
                f"{'; '.join(validation.errors[:3])}"
            )

        trace = list(state.get("agentTrace") or [])
        trace.append(
            {
                "agent": "Code Agent",
                "step": "generate_code_package",
                "status": "completed",
                "summary": (
                    f"Generated {decision.get('strategy_family', 'momentum')} Python Strategy code "
                    f"with {result.code_source} source."
                ),
            }
        )
        trace.append(
            {
                "agent": "Validator Agent",
                "step": "validate_code_package",
                "status": "completed" if validation.valid else "blocked",
                "summary": (
                    "Strategy code passed static sandbox contract checks."
                    if validation.valid
                    else f"Strategy code failed validation: {'; '.join(validation.errors[:3])}"
                ),
            }
        )

        await ctx.yield_output(
            {
                "plannerDecision": decision,
                "codeAgentResult": asdict(result),
                "codeValidation": asdict(validation),
                "agentTrace": trace,
                "framework": state.get("framework") or _framework_label(),
            }
        )


def run_strategy_lab_agent_workflow(
    *,
    prompt: str,
    session: dict[str, Any],
    artifacts: list[dict[str, Any]],
    messages: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run the Strategy Lab planning/code workflow synchronously for HTTP handlers."""

    async def run_async() -> dict[str, Any]:
        planner = StrategyLabPlannerExecutor()
        code_agent = StrategyLabCodeAgentExecutor()
        workflow = WorkflowBuilder(
            name="StrategyLabPlanningWorkflow",
            description="Plan a Strategy Lab turn and generate a runnable code package.",
            start_executor=planner,
        )
        workflow.add_chain([planner, code_agent])
        result = await workflow.build().run(
            {
                "prompt": prompt,
                "session": session,
                "artifacts": artifacts,
                "messages": messages or [],
            }
        )
        outputs = result.get_outputs()
        if not outputs:
            raise RuntimeError("Strategy Lab Agent Framework workflow produced no output.")
        return outputs[0]

    return asyncio.run(run_async())


def route_strategy_lab_turn(
    *,
    prompt: str,
    session: dict[str, Any] | None = None,
    artifacts: list[dict[str, Any]] | None = None,
    messages: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Classify a Strategy Lab turn before running expensive workflows."""

    artifacts = artifacts or []
    has_code_package = any(artifact.get("type") == "code_package" for artifact in artifacts)
    routing = _rule_route_strategy_turn(
        prompt,
        has_code_package=has_code_package,
        messages=messages or [],
        artifacts=artifacts,
    )
    return asdict(routing)


def answer_strategy_lab_turn(
    *,
    prompt: str,
    routing: dict[str, Any],
    session: dict[str, Any] | None = None,
    artifacts: list[dict[str, Any]] | None = None,
    messages: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Answer non-code Strategy Lab turns without invoking Code Agent."""

    fallback = _rule_answer_strategy_turn(prompt=prompt, routing=routing, artifacts=artifacts or [])
    llm_answer = _try_llm_answer_strategy_turn(
        prompt=prompt,
        routing=routing,
        session=session or {},
        artifacts=artifacts or [],
        messages=messages or [],
        fallback=fallback,
    )
    return llm_answer or fallback


def _rule_route_strategy_turn(
    prompt: str,
    *,
    has_code_package: bool,
    messages: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
) -> IntentRoutingResult:
    normalized = prompt.lower().strip()
    family = _resolve_strategy_family(prompt, messages=messages, artifacts=artifacts)
    title = _title_from_prompt(prompt, family)

    run_keywords = ["运行", "回测", "跑一下", "run", "backtest", "执行策略"]
    explain_keywords = ["解释", "说明", "为什么", "怎么看", "分析一下", "explain"]
    modify_keywords = ["改", "修改", "优化", "增加", "调整", "change", "update", "refactor"]
    create_keywords = [
        "生成",
        "创建",
        "写一个",
        "实现",
        "做一个",
        "帮我写",
        "代码",
        "code",
        "implement",
        "create",
        "build",
    ]
    research_keywords = [
        "有哪些",
        "有什么",
        "推荐",
        "适合",
        "最近",
        "当前",
        "哪种",
        "哪个好",
        "思路",
        "策略列表",
        "比较",
        "建议",
    ]

    if any(keyword in normalized for keyword in run_keywords):
        return IntentRoutingResult(
            intent="run_backtest",
            title=title,
            summary="User wants to run or backtest the current code package.",
            should_generate_code=False,
            response_kind="message",
            confidence=0.92,
        )

    if has_code_package and any(keyword in normalized for keyword in modify_keywords):
        return IntentRoutingResult(
            intent="modify_code",
            title=title,
            summary="User wants to modify the current strategy code package.",
            should_generate_code=True,
            response_kind="code_package",
            confidence=0.9,
        )

    if any(keyword in normalized for keyword in explain_keywords):
        return IntentRoutingResult(
            intent="explain",
            title=title,
            summary="User is asking for explanation or interpretation.",
            should_generate_code=False,
            response_kind="message",
            confidence=0.86,
        )

    if any(keyword in normalized for keyword in research_keywords) and not any(
        keyword in normalized for keyword in create_keywords
    ):
        return IntentRoutingResult(
            intent="research",
            title=title,
            summary="User is asking for strategy ideas or research guidance, not a code package yet.",
            should_generate_code=False,
            response_kind="message",
            confidence=0.88,
        )

    if any(keyword in normalized for keyword in create_keywords):
        return IntentRoutingResult(
            intent="create_code_package",
            title=title,
            summary="User is asking to create a runnable strategy code package.",
            should_generate_code=True,
            response_kind="code_package",
            confidence=0.84,
        )

    return IntentRoutingResult(
        intent="chat",
        title=title,
        summary="User is continuing the conversation without requesting a code workflow.",
        should_generate_code=False,
        response_kind="message",
        confidence=0.7,
    )


def _rule_answer_strategy_turn(
    *,
    prompt: str,
    routing: dict[str, Any],
    artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    intent = str(routing.get("intent") or "chat")
    normalized = prompt.lower()

    if intent == "run_backtest":
        latest_code = _latest_code_package(artifacts)
        if latest_code:
            content = "我识别到你想运行回测。现在可以点击右侧代码包里的「运行当前快照」来创建一条独立回测记录。"
        else:
            content = "我识别到你想运行回测，但当前会话还没有代码包。你可以先让我生成一个策略代码包，再运行回测。"
    elif intent == "explain":
        content = "我识别到这是解释类问题。你可以点开右侧代码包或回测快照，我会基于当前上下文解释策略逻辑、参数含义和回测表现。"
    elif "btc" in normalized or "btcusdt" in normalized or "比特币" in normalized:
        content = (
            "如果只是先找 BTC 策略思路，我建议先从这几类开始，不急着生成代码：\n\n"
            "1. 趋势跟随：EMA/MA 均线、通道突破，适合 BTC 单边行情。\n"
            "2. 动量策略：20/60 日动量、成交量确认，适合捕捉阶段性强势。\n"
            "3. 波动率过滤：ATR 或历史波动率控制仓位，避免高波动阶段过度交易。\n"
            "4. 均值回归：RSI/KDJ 超买超卖，适合震荡行情，但要加止损。\n"
            "5. 突破 + 风控：唐奇安通道或布林带突破，搭配最大回撤/移动止损。\n\n"
            "更合理的下一步是先选一个方向，比如「生成一个 BTC EMA 趋势策略」或「用 KDJ 做 BTC 低位反转策略」，我再进入代码生成工作流。"
        )
    else:
        content = (
            "我先把这次识别为咨询/研究意图，所以不直接生成代码包。\n\n"
            "你可以先让我比较策略思路、解释已有代码，或者明确说「生成一个...策略」，我再启动 Planner 和 Code Agent。"
        )

    return {
        "content": content,
        "routing": routing,
        "agentTrace": [
            {
                "agent": "Intent Router",
                "step": "classify_turn",
                "status": "completed",
                "summary": str(routing.get("summary") or "Classified the turn before workflow execution."),
            },
            {
                "agent": "Strategy Advisor",
                "step": "answer_without_code_workflow",
                "status": "completed",
                "summary": "Returned a conversational answer without invoking Planner -> Code Agent.",
            },
        ],
        "framework": _framework_label(),
        "answer_source": "rules",
    }


def _try_llm_answer_strategy_turn(
    *,
    prompt: str,
    routing: dict[str, Any],
    session: dict[str, Any],
    artifacts: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    fallback: dict[str, Any],
) -> dict[str, Any] | None:
    config = _llm_config()
    if not config:
        return None

    try:
        payload = _call_openai_compatible_json(
            config=config,
            system=_advisor_system_prompt(),
            user=_advisor_user_prompt(
                prompt=prompt,
                routing=routing,
                session=session,
                artifacts=artifacts,
                messages=messages,
            ),
            max_tokens=900,
            temperature=0.2,
        )
        content = _coerce_text(payload.get("content"), fallback["content"], max_length=1200)
        return {
            **fallback,
            "content": content,
            "answer_source": "llm",
            "llm_provider": config["provider"],
            "llm_model": config["model"],
        }
    except Exception as error:
        return {
            **fallback,
            "llm_warning": f"Advisor LLM fallback: {error}",
        }


def _advisor_system_prompt() -> str:
    return (
        "You are Strategy Advisor inside PaperForge Strategy Lab. "
        "Answer research, chat, explain, or run-intent turns without writing code unless the user explicitly asks for code. "
        "Return only JSON with key content. Keep the answer concise, Chinese, product-oriented, and actionable. "
        "Do not claim real-time market data access. If the user asks about recent markets, frame suggestions as strategy categories "
        "and say that live market validation requires a later data/backtest step."
    )


def _advisor_user_prompt(
    *,
    prompt: str,
    routing: dict[str, Any],
    session: dict[str, Any],
    artifacts: list[dict[str, Any]],
    messages: list[dict[str, Any]],
) -> str:
    compact_artifacts = [
        {"type": artifact.get("type"), "title": artifact.get("title")}
        for artifact in artifacts[-5:]
    ]
    return json.dumps(
        {
            "user_prompt": prompt,
            "routing": routing,
            "session": {"id": session.get("id"), "title": session.get("title")},
            "recent_messages": _compact_recent_messages(messages),
            "recent_artifacts": compact_artifacts,
            "output_schema": {"content": "Chinese answer shown in chat"},
        },
        ensure_ascii=False,
    )


def _plan_strategy_turn(
    prompt: str,
    *,
    has_code_package: bool,
    session: dict[str, Any] | None = None,
    artifacts: list[dict[str, Any]] | None = None,
    messages: list[dict[str, Any]] | None = None,
) -> PlannerDecision:
    fallback = _rule_plan_strategy_turn(
        prompt,
        has_code_package=has_code_package,
        messages=messages or [],
        artifacts=artifacts or [],
    )
    llm_result = _try_llm_plan_strategy_turn(
        prompt=prompt,
        has_code_package=has_code_package,
        session=session or {},
        artifacts=artifacts or [],
        messages=messages or [],
        fallback=fallback,
    )
    return llm_result or fallback


def _rule_plan_strategy_turn(
    prompt: str,
    *,
    has_code_package: bool,
    messages: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
) -> PlannerDecision:
    normalized = prompt.lower()
    intent: PlannerIntent = "create_code_package"
    if any(keyword in normalized for keyword in ["运行", "回测", "run", "backtest"]):
        intent = "run_backtest"
    if has_code_package and any(keyword in normalized for keyword in ["改", "修改", "优化", "增加", "调整", "change", "update"]):
        intent = "modify_code"
    if any(keyword in normalized for keyword in ["解释", "说明", "为什么", "explain"]):
        intent = "explain"

    family = _resolve_strategy_family(prompt, messages=messages, artifacts=artifacts)
    title = _title_from_prompt(prompt, family)
    standards = [
        "代码必须定义 class Strategy。",
        "Strategy.generate_signals(df) 必须返回包含 signal 列的 DataFrame。",
        "参数必须用 @param 注释声明，便于前端生成参数表单。",
        "不得调用真实交易、网络或文件写入接口。",
    ]
    return PlannerDecision(
        intent=intent,
        title=title,
        strategy_family=family,
        summary=f"Interpreted request as {intent} for {family}.",
        required_context=["session messages", "latest code_package", "strategy sandbox contract"],
        selected_agents=["Planner Agent", "Code Agent"],
        selected_skills=["strategy-planning", "python-code-generation", "sandbox-contract-check"],
        delivery_standards=standards,
        next_actions=["create code_package", "open artifact drawer", "run sandbox backtest"],
        planner_source="rules",
    )


def _try_llm_plan_strategy_turn(
    *,
    prompt: str,
    has_code_package: bool,
    session: dict[str, Any],
    artifacts: list[dict[str, Any]],
    messages: list[dict[str, Any]],
    fallback: PlannerDecision,
) -> PlannerDecision | None:
    config = _llm_config()
    if not config:
        return None

    try:
        payload = _call_openai_compatible_json(
            config=config,
            system=_planner_system_prompt(),
            user=_planner_user_prompt(
                prompt=prompt,
                has_code_package=has_code_package,
                session=session,
                artifacts=artifacts,
                messages=messages,
            ),
        )
        decision = _planner_decision_from_llm_payload(payload, fallback=fallback)
        decision.planner_source = "llm"
        decision.llm_provider = config["provider"]
        decision.llm_model = config["model"]
        return decision
    except Exception as error:
        fallback.llm_warning = f"Planner LLM fallback: {error}"
        return None


def _llm_config() -> dict[str, str] | None:
    load_dotenv()
    provider = os.environ.get("LLM_PROVIDER", "dashscope").strip().lower()
    if provider in {"", "none", "local", "deterministic"}:
        return None

    if provider == "dashscope":
        api_key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
        if not api_key:
            return None
        return {
            "provider": "dashscope",
            "api_key": api_key,
            "base_url": os.environ.get("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/"),
            "model": os.environ.get("DASHSCOPE_MODEL", "qwen-plus"),
            "timeout": os.environ.get("STRATEGY_LAB_LLM_TIMEOUT_SEC", "45"),
        }

    if provider == "openai-compatible":
        api_key = os.environ.get("OPENAI_COMPATIBLE_API_KEY", "").strip()
        base_url = os.environ.get("OPENAI_COMPATIBLE_BASE_URL", "").strip().rstrip("/")
        model = os.environ.get("OPENAI_COMPATIBLE_MODEL", "").strip()
        if not api_key or not base_url or not model:
            return None
        return {
            "provider": "openai-compatible",
            "api_key": api_key,
            "base_url": base_url,
            "model": model,
            "timeout": os.environ.get("STRATEGY_LAB_LLM_TIMEOUT_SEC", "45"),
        }

    return None


def _code_llm_config() -> dict[str, str] | None:
    config = _llm_config()
    if not config:
        return None

    code_config = dict(config)
    load_dotenv()
    code_model = (
        os.environ.get("STRATEGY_LAB_CODE_MODEL")
        or os.environ.get("DASHSCOPE_CODE_MODEL")
        or os.environ.get("OPENAI_COMPATIBLE_CODE_MODEL")
    )
    if code_model and code_model.strip():
        code_config["model"] = code_model.strip()
    elif code_config.get("provider") == "dashscope":
        code_config["model"] = "kimi-k2.7-code"
    code_config["timeout"] = os.environ.get("STRATEGY_LAB_CODE_LLM_TIMEOUT_SEC", "60")
    return code_config


def _call_openai_compatible_json(
    *,
    config: dict[str, str],
    system: str,
    user: str,
    max_tokens: int = 1400,
    temperature: float = 0.1,
) -> dict[str, Any]:
    body = json.dumps(
        {
            "model": config["model"],
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = Request(
        f"{config['base_url']}/chat/completions",
        data=body,
        headers={
            "authorization": f"Bearer {config['api_key']}",
            "content-type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=_request_timeout(config), context=_ssl_context()) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        message = error.read().decode("utf-8", errors="ignore")[:240]
        raise RuntimeError(f"LLM request failed: {error.code} {message}") from error
    except URLError as error:
        raise RuntimeError(f"LLM request failed: {error.reason}") from error

    message = ((response_payload.get("choices") or [{}])[0].get("message") or {})
    content = message.get("content") or message.get("reasoning_content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("LLM response did not include message content.")
    parsed = _parse_json_content(content)
    if not isinstance(parsed, dict):
        raise RuntimeError("LLM response JSON must be an object.")
    return parsed


def _request_timeout(config: dict[str, str]) -> float:
    try:
        return max(5.0, min(90.0, float(config.get("timeout") or 45)))
    except ValueError:
        return 45.0


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _parse_json_content(content: str) -> Any:
    trimmed = content.strip()
    try:
        return json.loads(trimmed)
    except json.JSONDecodeError:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)```", trimmed)
        if match:
            return json.loads(match.group(1).strip())
        start = trimmed.find("{")
        end = trimmed.rfind("}")
        if start >= 0 and end > start:
            return json.loads(trimmed[start : end + 1])
        raise RuntimeError("LLM response is not valid JSON.")


def _planner_system_prompt() -> str:
    return (
        "You are the Planner Agent inside PaperForge Strategy Lab. "
        "You do not write Python code. You plan the next workflow step for a quant strategy chat. "
        "Return only a compact JSON object. No markdown. "
        "Allowed intent values: create_code_package, modify_code, explain, run_backtest. "
        "Allowed strategy_family values: ema_trend, rsi_reversal, kdj_reversal, momentum. "
        "If the user prompt is elliptical or refers to prior discussion, inherit the latest explicit "
        "strategy indicator/topic from recent_messages and recent_artifacts unless the user overrides it. "
        "The workflow must remain auditable and safe: generated code must be sandbox-only, no live trading, "
        "no network access, no file writes. "
        "Required JSON keys: intent, title, strategy_family, summary, required_context, selected_agents, "
        "selected_skills, delivery_standards, next_actions."
    )


def _planner_user_prompt(
    *,
    prompt: str,
    has_code_package: bool,
    session: dict[str, Any],
    artifacts: list[dict[str, Any]],
    messages: list[dict[str, Any]],
) -> str:
    compact_artifacts = [
        {
            "type": artifact.get("type"),
            "title": artifact.get("title"),
            "metrics": artifact.get("metrics") if artifact.get("type") == "backtest_run" else None,
        }
        for artifact in artifacts[-6:]
    ]
    context = {
        "user_prompt": prompt,
        "session": {
            "id": session.get("id"),
            "title": session.get("title"),
            "has_code_package": has_code_package,
        },
        "recent_messages": _compact_recent_messages(messages),
        "recent_artifacts": compact_artifacts,
        "context_rule": (
            "If user_prompt is an elliptical follow-up such as '先帮我写一个' or '生成一个', "
            "inherit the most recent explicit strategy indicator/topic from recent_messages unless user_prompt overrides it."
        ),
        "sandbox_contract": {
            "required_class": "Strategy",
            "required_method": "generate_signals(df)",
            "required_output_column": "signal",
            "param_annotation": "# @param: id|Display Name|type|default|min-max",
        },
    }
    return json.dumps(context, ensure_ascii=False)


def _planner_decision_from_llm_payload(payload: dict[str, Any], *, fallback: PlannerDecision) -> PlannerDecision:
    intent = _coerce_choice(
        payload.get("intent"),
        allowed={"create_code_package", "modify_code", "explain", "run_backtest"},
        fallback=fallback.intent,
    )
    family = _coerce_choice(
        payload.get("strategy_family"),
        allowed={"ema_trend", "rsi_reversal", "kdj_reversal", "momentum"},
        fallback=fallback.strategy_family,
    )
    title = _coerce_text(payload.get("title"), fallback.title, max_length=32)
    summary = _coerce_text(payload.get("summary"), fallback.summary, max_length=220)
    return PlannerDecision(
        intent=intent,  # type: ignore[arg-type]
        title=title,
        strategy_family=family,  # type: ignore[arg-type]
        summary=summary,
        required_context=_coerce_string_list(payload.get("required_context"), fallback.required_context),
        selected_agents=_coerce_string_list(payload.get("selected_agents"), fallback.selected_agents),
        selected_skills=_coerce_string_list(payload.get("selected_skills"), fallback.selected_skills),
        delivery_standards=_coerce_string_list(payload.get("delivery_standards"), fallback.delivery_standards),
        next_actions=_coerce_string_list(payload.get("next_actions"), fallback.next_actions),
    )


def _coerce_choice(value: Any, *, allowed: set[str], fallback: str) -> str:
    text = str(value or "").strip()
    return text if text in allowed else fallback


def _coerce_text(value: Any, fallback: str, *, max_length: int) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:max_length] if text else fallback


def _coerce_string_list(value: Any, fallback: list[str]) -> list[str]:
    if not isinstance(value, list):
        return fallback
    items = [str(item).strip() for item in value if str(item).strip()]
    return items[:8] or fallback


def _generate_code_package(prompt: str, decision: dict[str, Any], previous_code: str) -> CodeAgentResult:
    llm_result = _try_llm_generate_code_package(
        prompt=prompt,
        decision=decision,
        previous_code=previous_code,
    )
    if llm_result:
        return llm_result
    raise CodeGenerationError("Code Agent LLM failed; no local strategy generator is available.")


def _try_llm_generate_code_package(
    *,
    prompt: str,
    decision: dict[str, Any],
    previous_code: str,
) -> CodeAgentResult | None:
    config = _code_llm_config()
    if not config:
        raise CodeGenerationError("Code Agent LLM is not configured.")

    try:
        payload = _call_openai_compatible_json(
            config=config,
            system=_code_agent_system_prompt(),
            user=_code_agent_user_prompt(
                prompt=prompt,
                decision=decision,
                previous_code=previous_code,
            ),
            max_tokens=2600,
            temperature=0.08,
        )
        result = _code_agent_result_from_llm_payload(payload, decision=decision)
        result.code_source = "llm"
        result.llm_provider = config["provider"]
        result.llm_model = config["model"]
        return result
    except Exception as error:
        raise CodeGenerationError(f"Code Agent LLM request failed: {error}") from error


def _code_agent_system_prompt() -> str:
    return (
        "You are the Code Agent inside PaperForge Strategy Lab. "
        "Write safe Python strategy code for a sandbox backtest. "
        "Return only a compact JSON object. No markdown, no fenced code. "
        "Required JSON keys: title, code, params, explanation. "
        "The code must define class Strategy with __init__ and generate_signals(self, df). "
        "generate_signals must return a DataFrame containing a signal column. "
        "Use only pandas and numpy imports. Do not use network, file system, subprocess, os, sys, requests, "
        "eval, exec, compile, __import__, globals, locals, or live trading APIs. "
        "\n\n**CRITICAL: Every strategy MUST include risk management parameters:**\n"
        "- # @param: stop_loss_pct|止损百分比|float|5.0|1-20\n"
        "- # @param: take_profit_pct|止盈百分比|float|10.0|5-50\n"
        "- # @param: max_position_pct|最大仓位百分比|float|10.0|5-30\n"
        "\nThese parameters are REQUIRED for all strategies, in addition to strategy-specific technical parameters.\n\n"
        "Strategy-specific technical parameters (like rsi_period, ema_period) should be dynamically generated based on the strategy type.\n"
        "Parameter fields must be declared in __init__ with comments like "
        "# @param: id|Display Name|type|default|min-max immediately before self.id assignment. "
        "\n\nSignals should use 1 for long, -1 for exit/short, and 0 for neutral. "
        "Keep the strategy deterministic and suitable for daily OHLCV data with open, high, low, close, volume columns. "
        "Keep code under 120 lines and avoid long comments."
    )


def _code_agent_user_prompt(*, prompt: str, decision: dict[str, Any], previous_code: str) -> str:
    context = {
        "user_prompt": prompt,
        "planner_decision": decision,
        "previous_code": previous_code[-3500:] if previous_code else "",
        "sandbox_contract": {
            "required_class": "Strategy",
            "required_method": "generate_signals(self, df)",
            "required_output_column": "signal",
            "allowed_imports": ["pandas as pd", "numpy as np"],
            "data_columns": ["open", "high", "low", "close", "volume"],
            "param_annotation": "# @param: id|Display Name|type|default|min-max",
        },
        "output_schema": {
            "title": "short strategy package title",
            "code": "full runnable Python code as a string",
            "params": {"param_id": "default value"},
            "explanation": "Chinese explanation of what the strategy does and why it matches the prompt",
        },
    }
    return json.dumps(context, ensure_ascii=False)


def _code_agent_result_from_llm_payload(payload: dict[str, Any], *, decision: dict[str, Any]) -> CodeAgentResult:
    fallback_title = str(decision.get("title") or "策略代码包")
    title = _coerce_text(payload.get("title"), fallback_title, max_length=40)
    code = _clean_code_text(str(payload.get("code") or ""))
    if not code.strip():
        raise RuntimeError("Code Agent LLM response did not include code.")

    params = payload.get("params")
    if not isinstance(params, dict):
        params = {}
    params = {str(key): value for key, value in params.items() if str(key).strip()}

    explanation = _coerce_text(
        payload.get("explanation"),
        "Code Agent 已根据当前会话上下文生成沙箱策略代码。",
        max_length=420,
    )
    return CodeAgentResult(
        title=title,
        code=code,
        params=params,
        explanation=explanation,
    )


def _clean_code_text(code: str) -> str:
    text = code.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:python)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip() + "\n"


def _validate_strategy_code(code: str) -> CodeValidationResult:
    checks: list[str] = []
    errors: list[str] = []
    warnings: list[str] = []

    stripped = code.strip()
    if not stripped:
        return CodeValidationResult(
            valid=False,
            status="failed",
            checks=[],
            errors=["Generated code is empty."],
        )

    lowered = stripped.lower()
    forbidden_patterns = [
        (r"\bimport\s+os\b", "os import is not allowed."),
        (r"\bimport\s+sys\b", "sys import is not allowed."),
        (r"\bimport\s+subprocess\b", "subprocess import is not allowed."),
        (r"\bimport\s+socket\b", "socket import is not allowed."),
        (r"\bimport\s+requests\b", "requests import is not allowed."),
        (r"\bfrom\s+urllib\b", "urllib import is not allowed."),
        (r"\bopen\s*\(", "file open is not allowed."),
        (r"\beval\s*\(", "eval is not allowed."),
        (r"\bexec\s*\(", "exec is not allowed."),
        (r"\bcompile\s*\(", "compile is not allowed."),
        (r"__import__\s*\(", "__import__ is not allowed."),
        (r"\bglobals\s*\(", "globals is not allowed."),
        (r"\blocals\s*\(", "locals is not allowed."),
    ]
    for pattern, message in forbidden_patterns:
        if re.search(pattern, lowered):
            errors.append(message)
    checks.append("forbidden_api_scan")

    try:
        tree = ast.parse(stripped)
        compile(stripped, "<strategy_lab_code_agent>", "exec")
        checks.append("python_ast_parse")
    except SyntaxError as error:
        errors.append(f"Python syntax error: {error.msg} at line {error.lineno}.")
        return CodeValidationResult(valid=False, status="failed", checks=checks, errors=errors)

    classes = [node for node in tree.body if isinstance(node, ast.ClassDef)]
    strategy_classes = [
        node
        for node in classes
        if node.name == "Strategy" or any(isinstance(item, ast.FunctionDef) and item.name == "generate_signals" for item in node.body)
    ]
    if not strategy_classes:
        errors.append("No Strategy class or generate_signals-capable class found.")
    else:
        checks.append("strategy_class_present")

    target_class = next((node for node in strategy_classes if node.name == "Strategy"), strategy_classes[0] if strategy_classes else None)
    method = None
    if target_class:
        method = next(
            (item for item in target_class.body if isinstance(item, ast.FunctionDef) and item.name == "generate_signals"),
            None,
        )
    if not method:
        errors.append("Strategy.generate_signals(self, df) is required.")
    else:
        checks.append("generate_signals_method_present")

    if "'signal'" not in stripped and '"signal"' not in stripped:
        errors.append("generate_signals must create a signal column.")
    else:
        checks.append("signal_column_present")

    if "# @param:" not in stripped:
        warnings.append("No @param annotations found; the frontend may not expose editable parameters.")
    else:
        checks.append("param_annotations_present")

    valid = not errors
    return CodeValidationResult(
        valid=valid,
        status="passed" if valid else "failed",
        checks=checks,
        errors=errors,
        warnings=warnings,
    )


def _compact_recent_messages(messages: list[dict[str, Any]], limit: int = 8) -> list[dict[str, str]]:
    compact: list[dict[str, str]] = []
    for message in messages[-limit:]:
        content = re.sub(r"\s+", " ", str(message.get("content") or "")).strip()
        if not content:
            continue
        compact.append(
            {
                "role": str(message.get("role") or "user"),
                "content": content[:360],
            }
        )
    return compact


def _resolve_strategy_family(
    prompt: str,
    *,
    messages: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
) -> StrategyFamily:
    explicit = _detect_strategy_family(prompt)
    if explicit:
        return explicit

    for message in reversed(messages):
        content = str(message.get("content") or "")
        inherited = _detect_strategy_family(content)
        if inherited:
            return inherited

    for artifact in reversed(artifacts):
        text = " ".join(
            str(value or "")
            for value in [
                artifact.get("title"),
                artifact.get("explanation"),
                artifact.get("code"),
            ]
        )
        inherited = _detect_strategy_family(text)
        if inherited:
            return inherited

    return "momentum"


def _detect_strategy_family(prompt: str) -> StrategyFamily | None:
    normalized = prompt.lower()
    if any(keyword in normalized for keyword in ["kdj", "金叉", "死叉", "低位金叉", "k值", "d值", "j值"]):
        return "kdj_reversal"
    if any(keyword in normalized for keyword in ["rsi", "超买", "超卖"]):
        return "rsi_reversal"
    if any(keyword in normalized for keyword in ["ema", "均线", "趋势", "突破", "ma"]):
        return "ema_trend"
    if any(keyword in normalized for keyword in ["动量", "momentum"]):
        return "momentum"
    return None


def _title_from_prompt(prompt: str, family: str) -> str:
    clean = re.sub(r"\s+", " ", prompt).strip()
    if clean:
        return clean[:18]
    labels = {
        "ema_trend": "EMA 趋势策略",
        "rsi_reversal": "RSI 反转策略",
        "kdj_reversal": "KDJ 低位金叉",
        "momentum": "动量策略",
    }
    return labels.get(family, "策略代码包")


def _latest_code_package(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    code_packages = [artifact for artifact in artifacts if artifact.get("type") == "code_package"]
    if not code_packages:
        return {}
    return sorted(code_packages, key=lambda artifact: str(artifact.get("updatedAt") or ""), reverse=True)[0]


def _framework_label() -> str:
    try:
        return f"microsoft-agent-framework-core/{version('agent-framework-core')}"
    except PackageNotFoundError:
        return "microsoft-agent-framework-core/unavailable"
