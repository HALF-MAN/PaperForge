from __future__ import annotations

from typing import Any


ARTIFACT_TYPES = {
    "brief",
    "team_plan",
    "strategy_spec",
    "market_data",
    "backtest_report",
    "risk_report",
    "review_report",
    "paper_session",
    "approval",
    "memory_note",
    "run_trace",
}


def generate_workflow_plan(
    *,
    mission_id: str,
    title: str,
    objective: str,
    domain: str,
    skills: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a controlled dynamic workflow plan from the skill registry.

    This is the first PaperForge planner. It does not let an LLM emit arbitrary
    executable code. Instead it selects from registered skills and compiles a
    schema-shaped graph that the Agent Framework runtime can later execute.
    """

    skill_by_tool = {skill.get("toolId"): skill for skill in skills}
    is_quant = domain == "quant" or _mentions_any(objective, ["btc", "eth", "usdt", "ema", "backtest", "paper", "trading", "strategy"])
    needs_review = _mentions_any(objective, ["review", "evidence", "approval", "deploy", "deployment", "paper"])
    needs_paper = is_quant and _mentions_any(objective, ["paper", "dry-run", "deploy", "deployment", "simulate"])

    steps: list[dict[str, Any]] = [
        _step(
            mission_id=mission_id,
            step_id="intake",
            label="Mission Intake",
            agent_id="agent-staffing",
            agent_name="Orion",
            tool="task_brief",
            inputs=[],
            output="brief",
            depends_on=[],
            note="Capture mission objective, constraints, and operating mode.",
            acceptance_criteria=_criteria(skill_by_tool, "task_brief"),
        )
    ]

    previous = "intake"

    steps.append(
        _step(
            mission_id=mission_id,
            step_id="staffing",
            label="Staffing & Plan",
            agent_id="agent-staffing",
            agent_name="Orion",
            tool="build_team_plan",
            inputs=["brief"],
            output="team_plan",
            depends_on=[previous],
            note="Resolve matching skills, select agents, and compile the executable workflow plan.",
            acceptance_criteria=_criteria(skill_by_tool, "build_team_plan"),
        )
    )
    previous = "staffing"

    if is_quant and "fetch_market_data" in skill_by_tool:
        steps.append(
            _step(
                mission_id=mission_id,
                step_id="market-data",
                label="Market Data",
                agent_id="agent-market-data",
                agent_name="Delta",
                tool="fetch_market_data",
                inputs=["brief"],
                output="market_data",
                depends_on=[previous],
                note="Load current market context required by downstream quant steps.",
                acceptance_criteria=_criteria(skill_by_tool, "fetch_market_data"),
            )
        )
        previous = "market-data"

    if is_quant and "compile_strategy_spec" in skill_by_tool:
        dependencies = [previous]
        steps.append(
            _step(
                mission_id=mission_id,
                step_id="strategy",
                label="Strategy Research",
                agent_id="agent-quant-researcher",
                agent_name="Alpha",
                tool="compile_strategy_spec",
                inputs=["brief", "market_data"] if previous == "market-data" else ["brief"],
                output="strategy_spec",
                depends_on=dependencies,
                note="Generate a structured StrategySpec from matching strategy skills.",
                acceptance_criteria=_criteria(skill_by_tool, "compile_strategy_spec"),
            )
        )
        previous = "strategy"

    if is_quant and "run_backtest" in skill_by_tool:
        steps.append(
            _step(
                mission_id=mission_id,
                step_id="backtest",
                label="Backtest",
                agent_id="agent-backtest-engineer",
                agent_name="Nova",
                tool="run_backtest",
                inputs=["strategy_spec", "market_data"],
                output="backtest_report",
                depends_on=[previous],
                note="Run deterministic backtest executor and persist the report.",
                acceptance_criteria=_criteria(skill_by_tool, "run_backtest"),
            )
        )
        previous = "backtest"

    if "score_risk" in skill_by_tool:
        steps.append(
            _step(
                mission_id=mission_id,
                step_id="risk",
                label="Risk Assessment",
                agent_id="agent-risk-manager",
                agent_name="Guard",
                tool="score_risk",
                inputs=["strategy_spec", "backtest_report"],
                output="risk_report",
                depends_on=[previous],
                note="Apply policy skills and produce PASS/WARN/BLOCK decision.",
                acceptance_criteria=_criteria(skill_by_tool, "score_risk"),
            )
        )
        previous = "risk"

    if needs_review and "review_strategy" in skill_by_tool:
        steps.append(
            _step(
                mission_id=mission_id,
                step_id="review",
                label="Strategy Review",
                agent_id="agent-strategy-reviewer",
                agent_name="Vega",
                tool="review_strategy",
                inputs=["strategy_spec", "backtest_report", "risk_report"],
                output="review_report",
                depends_on=[previous],
                condition="risk.decision != 'BLOCK'",
                note="Check evidence consistency before paper execution.",
                acceptance_criteria=_criteria(skill_by_tool, "review_strategy"),
            )
        )
        previous = "review"

    if needs_paper and "start_paper_session" in skill_by_tool:
        steps.append(
            _step(
                mission_id=mission_id,
                step_id="paper",
                label="Paper Trading",
                agent_id="agent-execution-trader",
                agent_name="Nexus",
                tool="start_paper_session",
                inputs=["strategy_spec", "risk_report", "review_report"],
                output="paper_session",
                depends_on=[previous],
                condition="risk.decision != 'BLOCK'",
                note="Start paper-only simulation; live order execution remains disabled.",
                acceptance_criteria=_criteria(skill_by_tool, "start_paper_session"),
            )
        )
        previous = "paper"

    if "request_human_approval" in skill_by_tool:
        steps.append(
            _step(
                mission_id=mission_id,
                step_id="approval",
                label="Human Approval",
                agent_id="agent-human-reviewer",
                agent_name="Human",
                tool="request_human_approval",
                inputs=["strategy_spec", "backtest_report", "risk_report", "paper_session"],
                output="approval",
                depends_on=[previous],
                condition="risk.decision != 'BLOCK'",
                note="Pause workflow until a human approves or requests revision.",
                acceptance_criteria=_criteria(skill_by_tool, "request_human_approval"),
            )
        )

    return {
        "missionId": mission_id,
        "steps": steps,
        "handoffRules": {
            "risk_BLOCK": "blocked",
            "approval_rejected": "strategy",
            "approval_approved": "paper_deployment",
        },
        "reasoning": (
            f"Generated from {len(skills)} registered skills for '{title}'. "
            "Planner selected a quant workflow with policy validation and a human gate."
            if is_quant
            else f"Generated from {len(skills)} registered skills for '{title}'. Planner selected a compact general workflow."
        ),
    }


def _step(
    *,
    mission_id: str,
    step_id: str,
    label: str,
    agent_id: str,
    agent_name: str,
    tool: str,
    inputs: list[str],
    output: str,
    depends_on: list[str],
    note: str,
    condition: str | None = None,
    acceptance_criteria: list[str] | None = None,
) -> dict[str, Any]:
    output_type = output if output in ARTIFACT_TYPES else "run_trace"
    step = {
        "id": step_id,
        "label": label,
        "agentId": agent_id,
        "agentName": agent_name,
        "tool": tool,
        "inputArtifactTypes": inputs,
        "outputArtifactType": output_type,
        "dependsOn": depends_on,
        "note": note,
        "acceptanceCriteria": acceptance_criteria or [],
    }
    if condition:
        step["condition"] = condition
    return step


def _mentions_any(text: str, keywords: list[str]) -> bool:
    lower = text.lower()
    return any(keyword in lower for keyword in keywords)


def _criteria(skill_by_tool: dict[str, dict[str, Any]], tool_id: str) -> list[str]:
    skill = skill_by_tool.get(tool_id)
    criteria = skill.get("acceptanceCriteria") if skill else None
    return list(criteria) if isinstance(criteria, list) else []
