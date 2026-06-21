from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from agent_runtime.env import load_dotenv
from agent_runtime.memory_store import memory_store
from agent_runtime.models import (
    AuditCheckpoint,
    ExecutionPlan,
    MemoryRecord,
    MissionInput,
    QuantMissionResult,
    QuantState,
)
from agent_runtime.planner import generate_workflow_plan
from agent_runtime.quant_flow import build_quant_workflow, run_quant_flow
from agent_runtime.skill_catalog import load_skill_catalog
from agent_runtime.workflows import run_quant_mission


# Load project .env.local so LLM credentials are available
load_dotenv()


ROOT_DIR = Path(__file__).resolve().parents[2]
DB_PATH = ROOT_DIR / ".paperforge" / "platform.sqlite"
LEGACY_SKILL_IDS = {
    "skill-code-review",
    "skill-data-fetch",
    "skill-document-analysis",
    "skill-evidence-evaluation",
    "skill-market-research",
    "skill-memory-writer",
    "skill-sentiment-analysis",
}


def get_snapshot() -> dict[str, Any]:
    seed_core_if_empty()
    skills = list_entities("skill")
    missions = [_mission_with_plan(mission, skills) for mission in list_entities("mission")]
    return {
        "workspace": list_entities("workspace")[0],
        "missions": missions,
        "agents": list_entities("agent"),
        "skills": skills,
        "artifacts": list_entities("artifact"),
        "runSteps": list_entities("run_step"),
        "memories": list_entities("memory"),
    }


def get_mission(mission_id: str) -> dict[str, Any] | None:
    seed_core_if_empty()
    mission = get_entity("mission", mission_id)
    if mission is None:
        return None
    return _mission_with_plan(mission, list_entities("skill"))


def get_latest_run(mission_id: str) -> dict[str, Any] | None:
    runs = [
        run
        for run in list_entities("orchestrator_run")
        if run.get("missionId") == mission_id
    ]
    if not runs:
        return None
    return sorted(runs, key=lambda run: run.get("createdAt", ""), reverse=True)[0]


def create_skill(input_data: dict[str, Any]) -> dict[str, Any]:
    seed_core_if_empty()
    name = str(input_data.get("name") or "").strip()
    tool_id = str(input_data.get("toolId") or input_data.get("tool_id") or "").strip()
    description = str(input_data.get("description") or "").strip()
    if not name or not tool_id or not description:
        raise ValueError("name, toolId, and description are required")

    used_by = str(input_data.get("usedBy") or input_data.get("used_by") or "executor").strip()
    if used_by not in {"planner", "executor", "reviewer", "human"}:
        used_by = "executor"

    category = str(input_data.get("category") or "analysis").strip()
    if category not in {"planning", "analysis", "computation", "execution", "review", "governance", "approval", "memory"}:
        category = "analysis"

    domains = _list_from_input(input_data.get("domains")) or ["general"]
    inputs = _list_from_input(input_data.get("inputs"))
    outputs = _list_from_input(input_data.get("outputs"))
    acceptance = _list_from_input(input_data.get("acceptanceCriteria") or input_data.get("acceptance"))
    failure_modes = _list_from_input(input_data.get("failureModes") or input_data.get("failure_modes"))
    argument_schema = str(input_data.get("argumentSchema") or input_data.get("argument_schema") or "").strip()
    result_description = str(input_data.get("resultDescription") or input_data.get("result_description") or "").strip()
    usage_examples = _list_from_input(input_data.get("usageExamples") or input_data.get("usage_examples"))
    side_effects = str(input_data.get("sideEffects") or input_data.get("side_effects") or "none").strip()
    if side_effects not in {"none", "network_read", "compute", "writes_plan", "writes_memory", "paper_simulation", "workflow_pause"}:
        side_effects = "none"

    skill = {
        "id": f"skill-{_slugify(name)}-{uuid4().hex[:6]}",
        "name": name,
        "usedBy": used_by,
        "category": category,
        "toolId": tool_id,
        "description": description,
        "inputs": inputs,
        "outputs": outputs,
        "argumentSchema": argument_schema,
        "resultDescription": result_description,
        "usageExamples": usage_examples,
        "domains": domains,
        "sideEffects": side_effects,
        "requiresApproval": _bool_from_input(input_data.get("requiresApproval") or input_data.get("requires_approval")),
        "failureModes": failure_modes,
        "acceptanceCriteria": acceptance,
        "sourcePath": "",
        "source": "database",
    }
    with connect() as db:
        upsert_entity(db, "skill", skill["id"], skill)
    return skill


def create_agent(input_data: dict[str, Any]) -> dict[str, Any]:
    seed_core_if_empty()
    name = str(input_data.get("name") or "").strip()
    role_title = str(input_data.get("roleTitle") or input_data.get("role_title") or "").strip()
    role = str(input_data.get("role") or role_title or "").strip()
    if not name or not role_title or not role:
        raise ValueError("name, roleTitle, and role are required")

    domain = str(input_data.get("domain") or "general").strip()
    if domain not in {"quant", "trading", "development", "legal", "research", "general"}:
        domain = "general"

    memory_scope = str(input_data.get("memoryScope") or input_data.get("memory_scope") or "mission").strip()
    if memory_scope not in {"workspace", "mission", "private"}:
        memory_scope = "mission"

    skill_ids = _list_from_input(input_data.get("skillIds") or input_data.get("skill_ids"))
    known_skill_ids = {skill["id"] for skill in list_entities("skill")}
    skill_ids = [skill_id for skill_id in skill_ids if skill_id in known_skill_ids]

    agent = {
        "id": f"agent-{_slugify(name)}-{uuid4().hex[:6]}",
        "name": name,
        "roleTitle": role_title,
        "role": role,
        "backstory": str(input_data.get("backstory") or "Created from the PaperForge agent registry.").strip(),
        "domain": domain,
        "status": "available",
        "skillIds": skill_ids,
        "currentTask": str(input_data.get("currentTask") or input_data.get("current_task") or "Ready.").strip(),
        "memoryScope": memory_scope,
        "source": "database",
    }
    with connect() as db:
        upsert_entity(db, "agent", agent["id"], agent)
    return agent


def create_mission(input_data: dict[str, Any]) -> dict[str, Any]:
    seed_core_if_empty()
    snapshot = get_snapshot()
    mission_id = f"mission-{uuid4().hex[:8]}"
    title = str(input_data.get("title") or "Untitled mission").strip()
    objective = str(input_data.get("objective") or "").strip()
    domain = "general" if input_data.get("domain") == "general" else "quant"
    strategy = _strategy_to_platform(_default_platform_strategy())
    backtest = {
        "totalReturnPct": 18.4,
        "maxDrawdownPct": 9.7,
        "winRatePct": 54.2,
        "tradeCount": 31,
        "profitFactor": 1.42,
        "averageTradePct": 0.59,
    }
    risk = {
        "decision": "WARN",
        "riskScore": 66,
        "issues": [
            "Position size is high for a first deployment run.",
            "Max drawdown is close to the balanced profile limit.",
            "Trade frequency increases operational risk during sideways markets.",
        ],
        "recommendations": [
            "Reduce max position before live dry-run.",
            "Add a volatility filter or tighter kill switch.",
            "Require an additional trend confirmation before opening positions.",
        ],
    }

    mission = {
        "id": mission_id,
        "title": title,
        "status": "planning",
        "domain": domain,
        "objective": objective,
        "currentHandoff": "Planner Crew is ready to select agents and compose the workflow.",
        "workspaceId": snapshot["workspace"]["id"],
        "teamAgentIds": ["agent-staffing"],
        "strategy": strategy,
        "backtest": backtest,
        "risk": risk,
        "backtestLimit": 300,
    }
    artifact = {
        "id": f"{mission_id}-artifact-brief",
        "missionId": mission_id,
        "name": "TaskBrief",
        "type": "brief",
        "status": "ready",
        "summary": objective,
    }
    with connect() as db:
        upsert_entity(db, "mission", mission_id, mission)
        upsert_entity(db, "artifact", artifact["id"], artifact)
    return mission


def run_mission(mission_id: str) -> dict[str, Any]:
    mission = get_mission(mission_id)
    if mission is None:
        raise ValueError(f"Mission not found: {mission_id}")

    result = run_quant_mission(
        MissionInput(
            mission_id=mission_id,
            title=mission["title"],
            objective=mission["objective"],
        )
    )
    apply_runtime_result(result)
    return result.model_dump()


def advance_mission(mission_id: str) -> dict[str, Any]:
    mission = get_mission(mission_id)
    if mission is None:
        raise ValueError(f"Mission not found: {mission_id}")

    if mission.get("status") == "planning" or not mission.get("plan"):
        return _plan_mission(mission)

    plan = mission["plan"]
    steps = _mission_steps(mission_id)
    if not steps:
        steps = _initial_steps_from_plan(mission_id, plan)

    active_step = next((step for step in steps if step["status"] == "active"), None)
    if active_step is None:
        active_step = next((step for step in steps if step["status"] == "waiting"), None)

    now = datetime.now(timezone.utc).isoformat()

    if active_step is None:
        run = _run_record(
            mission_id=mission_id,
            status="awaiting_human" if mission.get("status") == "approval" else "idle",
            stop_reason=mission.get("currentHandoff", "No active workflow step."),
            events=[],
            now=now,
        )
        with connect() as db:
            upsert_entity(db, "orchestrator_run", run["id"], run)
        return run

    plan_step = _plan_step_for_run_step(plan, active_step)
    if plan_step is None:
        raise ValueError(f"Plan step not found for {active_step['id']}")

    if plan_step["tool"] == "request_human_approval":
        active_step["status"] = "active"
        active_step["note"] = "Workflow paused at the human approval gate."
        mission["status"] = "approval"
        mission["currentHandoff"] = "Workflow paused at the human approval gate."
        event = _event_for_plan_step(plan_step, "stopped", mission)
        run = _run_record(
            mission_id=mission_id,
            status="awaiting_human",
            stop_reason=mission["currentHandoff"],
            events=_merged_run_events(mission_id, event),
            now=now,
        )
        with connect() as db:
            upsert_entity(db, "mission", mission_id, mission)
            upsert_entity(db, "run_step", active_step["id"], active_step)
            upsert_entity(db, "artifact", f"{mission_id}-artifact-approval", _artifact_for_plan_step(mission, plan_step))
            upsert_entity(db, "orchestrator_run", run["id"], run)
        return run

    active_step["status"] = "done"
    active_step["note"] = _summary_for_tool(plan_step["tool"], mission)
    _apply_step_outputs(mission, plan_step)
    next_step = _next_waiting_step(plan, steps, plan_step["id"])
    if next_step:
        next_step["status"] = "active"
        mission["status"] = "running"
        mission["currentHandoff"] = f"{next_step['label']} is ready to execute."
    else:
        mission["status"] = "approval"
        mission["currentHandoff"] = "Workflow paused at the human approval gate."

    event = _event_for_plan_step(plan_step, "completed", mission)
    run = _run_record(
        mission_id=mission_id,
        status="running" if next_step else "awaiting_human",
        stop_reason=mission["currentHandoff"],
        events=_merged_run_events(mission_id, event),
        now=now,
    )

    with connect() as db:
        upsert_entity(db, "mission", mission_id, mission)
        upsert_entity(db, "run_step", active_step["id"], active_step)
        if next_step:
            upsert_entity(db, "run_step", next_step["id"], next_step)
        upsert_entity(db, "artifact", f"{mission_id}-artifact-{plan_step['outputArtifactType']}", _artifact_for_plan_step(mission, plan_step))
        upsert_entity(db, "orchestrator_run", run["id"], run)
    return run


def _plan_mission(mission: dict[str, Any]) -> dict[str, Any]:
    mission_id = mission["id"]
    now = datetime.now(timezone.utc).isoformat()
    skills = list_entities("skill")
    agents = list_entities("agent")
    plan = generate_workflow_plan(
        mission_id=mission_id,
        title=mission.get("title", "Untitled mission"),
        objective=mission.get("objective", ""),
        domain=mission.get("domain", "quant"),
        skills=skills,
        agents=agents,
    )
    steps = _initial_steps_from_plan(mission_id, plan, execution_ready=True)
    active_step = next((step for step in steps if step["status"] == "active"), None)
    selected_agent_ids = _select_team_ids(agents, mission.get("domain", "quant"))
    mission["plan"] = plan
    mission["teamAgentIds"] = selected_agent_ids
    mission["status"] = "ready" if active_step else "approval"
    mission["currentHandoff"] = (
        f"Planner Crew selected {len(selected_agent_ids)} agents and generated {len(plan.get('steps', []))} workflow nodes. "
        f"{active_step['label']} is ready to execute."
        if active_step
        else "Planner Crew generated the workflow and paused at the human gate."
    )

    event = {
        "agent": "Planner Crew",
        "step": "Select team & plan workflow",
        "action": "generate_workflow_plan",
        "status": "completed",
        "summary": mission["currentHandoff"],
    }
    run = _run_record(
        mission_id=mission_id,
        status="advanced",
        stop_reason=mission["currentHandoff"],
        events=_merged_run_events(mission_id, event),
        now=now,
    )
    team_plan_artifact = {
        "id": f"{mission_id}-artifact-team_plan",
        "missionId": mission_id,
        "name": "TeamPlan",
        "type": "team_plan",
        "status": "ready",
        "summary": plan.get("reasoning", mission["currentHandoff"]),
    }

    with connect() as db:
        upsert_entity(db, "mission", mission_id, mission)
        upsert_entity(db, "artifact", team_plan_artifact["id"], team_plan_artifact)
        for step in steps:
            upsert_entity(db, "run_step", step["id"], step)
        upsert_entity(db, "orchestrator_run", run["id"], run)
    return run


def apply_runtime_result(result: QuantMissionResult) -> None:
    mission = get_mission(result.mission_id)
    if mission is None:
        raise ValueError(f"Mission not found: {result.mission_id}")

    strategy = _strategy_to_platform(result.strategy)
    backtest = _backtest_to_platform(result.backtest)
    risk = _risk_to_platform(result.risk)
    paper = _paper_to_platform(result.paper) if result.paper else None
    now = datetime.now(timezone.utc).isoformat()
    run = {
        "id": f"py-{result.mission_id}-{int(datetime.now().timestamp() * 1000)}",
        "missionId": result.mission_id,
        "status": result.status,
        "stopReason": result.stop_reason,
        "events": [event.model_dump() for event in result.events],
        "createdAt": now,
        "updatedAt": now,
    }
    mission.update(
        {
            "status": "approval" if result.status == "awaiting_human" else result.status,
            "currentHandoff": result.stop_reason,
            "plan": mission.get("plan")
            or generate_workflow_plan(
                mission_id=result.mission_id,
                title=mission["title"],
                objective=mission["objective"],
                domain=mission.get("domain", "quant"),
                skills=list_entities("skill"),
            ),
            "strategy": strategy,
            "backtest": backtest,
            "risk": risk,
            "paper": paper,
        }
    )

    with connect() as db:
        upsert_entity(db, "mission", result.mission_id, mission)
        for step in _steps_from_result(result, mission["plan"]):
            upsert_entity(db, "run_step", step["id"], step)
        for artifact in _artifacts_from_result(result, strategy, backtest, risk, paper):
            upsert_entity(db, "artifact", artifact["id"], artifact)
        upsert_entity(db, "orchestrator_run", run["id"], run)
        upsert_entity(
            db,
            "memory",
            f"{result.mission_id}-memory-python-runtime",
            {
                "id": f"{result.mission_id}-memory-python-runtime",
                "scope": "mission",
                "title": "Python backend runtime",
                "summary": f"{result.framework}: {result.stop_reason}",
                "sourceMissionId": result.mission_id,
                "promoted": False,
            },
        )


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.execute(
        """
        create table if not exists platform_entities (
          kind text not null,
          id text not null,
          data text not null,
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp,
          primary key (kind, id)
        )
        """
    )
    return db


def upsert_entity(db: sqlite3.Connection, kind: str, entity_id: str, data: dict[str, Any]) -> None:
    db.execute(
        """
        insert into platform_entities (kind, id, data)
        values (?, ?, ?)
        on conflict(kind, id) do update set
          data = excluded.data,
          updated_at = current_timestamp
        """,
        (kind, entity_id, json.dumps(data, ensure_ascii=False)),
    )
    db.commit()


def list_entities(kind: str) -> list[dict[str, Any]]:
    if kind == "memory":
        # 使用 LanceDB
        records = memory_store.list_all()
        return [_memory_record_to_platform(record) for record in records]

    with connect() as db:
        rows = db.execute(
            "select data from platform_entities where kind = ? order by created_at asc, id asc",
            (kind,),
        ).fetchall()
    return [json.loads(row[0]) for row in rows]


def get_entity(kind: str, entity_id: str) -> dict[str, Any] | None:
    if kind == "memory":
        # 使用 LanceDB
        record = memory_store.get(entity_id)
        return _memory_record_to_platform(record) if record else None

    with connect() as db:
        row = db.execute(
            "select data from platform_entities where kind = ? and id = ?",
            (kind, entity_id),
        ).fetchone()
    return json.loads(row[0]) if row else None


def _mission_with_plan(mission: dict[str, Any], skills: list[dict[str, Any]]) -> dict[str, Any]:
    if mission.get("plan"):
        return mission
    if mission.get("status") == "planning":
        return mission

    mission["plan"] = generate_workflow_plan(
        mission_id=mission["id"],
        title=mission.get("title", "Untitled mission"),
        objective=mission.get("objective", ""),
        domain=mission.get("domain", "quant"),
        skills=skills,
    )
    with connect() as db:
        upsert_entity(db, "mission", mission["id"], mission)
    return mission


def seed_core_if_empty() -> None:
    with connect() as db:
        count = db.execute("select count(*) from platform_entities").fetchone()[0]
        if count:
            _ensure_core_catalog(db)
            return
        upsert_entity(
            db,
            "workspace",
            "ws-quant-lab",
            {
                "id": "ws-quant-lab",
                "name": "PaperForge Quant Lab",
                "domain": "agentic quant deployment",
                "operatingMode": "approval_gated",
            },
        )
        for agent in _default_agents():
            upsert_entity(db, "agent", agent["id"], agent)
        for skill in _default_skills():
            upsert_entity(db, "skill", skill["id"], skill)


def _ensure_core_catalog(db: sqlite3.Connection) -> None:
    for agent in _default_agents():
        row = db.execute(
            "select 1 from platform_entities where kind = ? and id = ?",
            ("agent", agent["id"]),
        ).fetchone()
        if not row:
            upsert_entity(db, "agent", agent["id"], agent)
    for skill in _default_skills():
        upsert_entity(db, "skill", skill["id"], skill)
    for skill_id in LEGACY_SKILL_IDS:
        db.execute(
            "delete from platform_entities where kind = ? and id = ?",
            ("skill", skill_id),
        )
    db.commit()


def _select_team_ids(agents: list[dict[str, Any]], domain: str) -> list[str]:
    if domain == "general":
        return ["agent-staffing", "agent-human-reviewer"]
    quant_ids = [agent["id"] for agent in agents if agent.get("domain") == "quant"]
    return ["agent-staffing", *quant_ids, "agent-human-reviewer"]


def _list_from_input(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [
        item.strip()
        for item in str(value).replace("\n", ",").split(",")
        if item.strip()
    ]


def _bool_from_input(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on", "required"}


def _slugify(value: str) -> str:
    slug = "".join(char.lower() if char.isalnum() else "-" for char in value).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "custom"


def _default_platform_strategy() -> dict[str, Any]:
    return {
        "id": "spec-ema-trend-breakout-v1",
        "source": "library_template",
        "name": "EMA Trend Breakout",
        "symbol": "BTCUSDT",
        "market": "spot",
        "timeframe": "1h",
        "entry": {
            "mode": "all",
            "rules": [
                {
                    "left": "EMA20",
                    "operator": "crosses_above",
                    "right": "EMA60",
                    "description": "EMA20 crosses above EMA60",
                },
                {
                    "left": "RSI14",
                    "operator": "less_than",
                    "right": "70",
                    "description": "Avoid entering when RSI is already overheated",
                },
            ],
        },
        "exit": {
            "mode": "any",
            "rules": [
                {
                    "left": "EMA20",
                    "operator": "crosses_below",
                    "right": "EMA60",
                    "description": "EMA20 crosses below EMA60",
                },
                {
                    "left": "PnL",
                    "operator": "less_than",
                    "right": "-3%",
                    "description": "Stop loss reached",
                },
            ],
        },
        "risk": {
            "maxPositionPct": 0.2,
            "maxLeverage": 1,
            "stopLossPct": 0.03,
            "takeProfitPct": 0.06,
            "maxDailyLossPct": 0.05,
            "killSwitchDrawdownPct": 0.12,
        },
        "tags": ["trend", "ema", "library"],
    }


def _initial_steps_from_plan(mission_id: str, plan: dict[str, Any], execution_ready: bool = False) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    active_assigned = False
    for index, plan_step in enumerate(plan.get("steps", [])):
        if execution_ready:
            if plan_step["tool"] in {"task_brief", "build_team_plan"}:
                status = "done"
            elif not active_assigned:
                status = "active"
                active_assigned = True
            else:
                status = "waiting"
        else:
            status = "done" if plan_step["tool"] == "task_brief" else "active" if index == 1 else "waiting"
        note = _summary_for_tool(plan_step["tool"], {"id": mission_id}) if status == "done" else plan_step.get("note", "")
        steps.append(
            {
                "id": f"{mission_id}-step-{plan_step['id']}",
                "missionId": mission_id,
                "agentId": plan_step["agentId"],
                "label": plan_step["label"],
                "status": status,
                "tool": plan_step["tool"],
                "output": _display_artifact_name(plan_step["outputArtifactType"]),
                "note": note,
            }
        )
    return steps


def _mission_steps(mission_id: str) -> list[dict[str, Any]]:
    return [
        step
        for step in list_entities("run_step")
        if step.get("missionId") == mission_id
    ]


def _plan_step_for_run_step(plan: dict[str, Any], run_step: dict[str, Any]) -> dict[str, Any] | None:
    plan_step_id = run_step["id"].split("-step-")[-1]
    return next((step for step in plan.get("steps", []) if step["id"] == plan_step_id), None)


def _next_waiting_step(plan: dict[str, Any], steps: list[dict[str, Any]], completed_plan_step_id: str) -> dict[str, Any] | None:
    order = {step["id"]: index for index, step in enumerate(plan.get("steps", []))}
    completed_index = order.get(completed_plan_step_id, -1)
    waiting_steps = [
        step
        for step in steps
        if step["status"] == "waiting" and order.get(step["id"].split("-step-")[-1], 999) > completed_index
    ]
    return sorted(waiting_steps, key=lambda step: order.get(step["id"].split("-step-")[-1], 999))[0] if waiting_steps else None


def _event_for_plan_step(plan_step: dict[str, Any], status: str, mission: dict[str, Any]) -> dict[str, str]:
    return {
        "agent": plan_step["agentName"],
        "step": plan_step["label"],
        "action": plan_step["tool"],
        "status": status,
        "summary": _summary_for_tool(plan_step["tool"], mission),
    }


def _run_record(
    *,
    mission_id: str,
    status: str,
    stop_reason: str,
    events: list[dict[str, str]],
    now: str,
) -> dict[str, Any]:
    return {
        "id": f"py-{mission_id}-{int(datetime.now().timestamp() * 1000)}",
        "missionId": mission_id,
        "status": status,
        "stopReason": stop_reason,
        "events": events,
        "createdAt": now,
        "updatedAt": now,
    }


def _merged_run_events(mission_id: str, event: dict[str, str]) -> list[dict[str, str]]:
    latest = get_latest_run(mission_id)
    events = list(latest.get("events", [])) if latest else []
    if not any(existing.get("action") == event["action"] for existing in events):
        events.append(event)
    return events


def _apply_step_outputs(mission: dict[str, Any], plan_step: dict[str, Any]) -> None:
    tool = plan_step["tool"]
    if tool == "compile_strategy_spec":
        mission["strategy"] = _strategy_to_platform(_default_platform_strategy())
    elif tool == "run_backtest":
        mission["backtest"] = {
            "totalReturnPct": 13.8,
            "maxDrawdownPct": 7.9,
            "winRatePct": 53.6,
            "tradeCount": 26,
            "profitFactor": 1.37,
            "averageTradePct": 0.48,
        }
    elif tool == "score_risk":
        mission["risk"] = {
            "decision": "PASS",
            "riskScore": 100,
            "issues": [],
            "recommendations": ["Proceed to paper trading with audit logging and real execution disabled."],
        }
    elif tool == "start_paper_session":
        mission["paper"] = {
            "id": f"{mission['id']}_python_paper",
            "startingBalance": 10000,
            "endingBalance": 10154.0,
            "pnlPct": 1.54,
            "maxDrawdownPct": 3.56,
            "orderCount": 3,
            "status": "completed",
            "orders": [
                {"id": f"{mission['id']}_paper_001", "symbol": "BTCUSDT", "side": "buy", "price": 68000, "size": 0.017647, "reason": "EMA20 crosses above EMA60"},
                {"id": f"{mission['id']}_paper_002", "symbol": "BTCUSDT", "side": "sell", "price": 68816.0, "size": 0.008823, "reason": "Partial take-profit threshold reached"},
                {"id": f"{mission['id']}_paper_003", "symbol": "BTCUSDT", "side": "sell", "price": 69047.2, "size": 0.008823, "reason": "EMA20 crosses below EMA60"},
            ],
        }


def _artifact_for_plan_step(mission: dict[str, Any], plan_step: dict[str, Any]) -> dict[str, Any]:
    artifact_type = plan_step["outputArtifactType"]
    status = "draft" if artifact_type == "approval" else "ready"
    if artifact_type == "risk_report" and mission.get("risk", {}).get("decision") == "WARN":
        status = "warning"

    return {
        "id": f"{mission['id']}-artifact-{artifact_type}",
        "missionId": mission["id"],
        "name": _display_artifact_name(artifact_type),
        "type": artifact_type,
        "status": status,
        "summary": _summary_for_tool(plan_step["tool"], mission),
    }


def _summary_for_tool(tool: str, mission: dict[str, Any]) -> str:
    strategy = mission.get("strategy", {})
    backtest = mission.get("backtest", {})
    risk = mission.get("risk", {})
    paper = mission.get("paper", {})
    summaries = {
        "task_brief": "Mission constraints captured.",
        "build_team_plan": "Skill registry matched mission needs, selected agents, and compiled the workflow plan.",
        "fetch_market_data": f"Market context loaded for {strategy.get('symbol', 'BTCUSDT')} {strategy.get('timeframe', '1h')}.",
        "compile_strategy_spec": f"{strategy.get('name', 'StrategySpec')} normalized as {strategy.get('symbol', 'BTCUSDT')} {strategy.get('timeframe', '1h')}.",
        "run_backtest": f"{backtest.get('tradeCount', 26)} trades, {backtest.get('totalReturnPct', 13.8)}% return, {backtest.get('maxDrawdownPct', 7.9)}% max drawdown.",
        "score_risk": f"{risk.get('decision', 'PASS')} {risk.get('riskScore', 100)}/100. {' '.join(risk.get('issues', []))}",
        "review_strategy": "Evidence bundle is internally consistent enough for paper trading.",
        "start_paper_session": f"{paper.get('orderCount', 3)} simulated orders, {paper.get('pnlPct', 1.54)}% paper PnL.",
        "request_human_approval": "Workflow paused at the human approval gate.",
    }
    return summaries.get(tool, "Step completed.")


def _strategy_to_platform(strategy: Any) -> dict[str, Any]:
    if isinstance(strategy, dict):
        return strategy
    # 使用 Pydantic 的 model_dump() 替代手动转换
    data = strategy.model_dump()
    # 转换为 camelCase
    return {
        "id": data["id"],
        "source": data["source"],
        "name": data["name"],
        "symbol": data["symbol"],
        "market": data["market"],
        "timeframe": data["timeframe"],
        "entry": data["entry"],
        "exit": data["exit"],
        "risk": {
            "maxPositionPct": data["risk"]["max_position_pct"],
            "maxLeverage": data["risk"]["max_leverage"],
            "stopLossPct": data["risk"]["stop_loss_pct"],
            "takeProfitPct": data["risk"]["take_profit_pct"],
            "maxDailyLossPct": data["risk"]["max_daily_loss_pct"],
            "killSwitchDrawdownPct": data["risk"]["kill_switch_drawdown_pct"],
        },
        "tags": data["tags"],
    }


def _backtest_to_platform(backtest: Any) -> dict[str, Any]:
    return {
        "totalReturnPct": backtest.total_return_pct,
        "maxDrawdownPct": backtest.max_drawdown_pct,
        "winRatePct": backtest.win_rate_pct,
        "tradeCount": backtest.trade_count,
        "profitFactor": backtest.profit_factor,
        "averageTradePct": backtest.average_trade_pct,
    }


def _risk_to_platform(risk: Any) -> dict[str, Any]:
    return {
        "decision": risk.decision,
        "riskScore": risk.risk_score,
        "issues": risk.issues,
        "recommendations": risk.recommendations,
    }


def _paper_to_platform(paper: Any) -> dict[str, Any]:
    return {
        "id": paper.id,
        "startingBalance": paper.starting_balance,
        "endingBalance": paper.ending_balance,
        "pnlPct": paper.pnl_pct,
        "maxDrawdownPct": paper.max_drawdown_pct,
        "orderCount": paper.order_count,
        "status": paper.status,
        "orders": [order.model_dump() for order in paper.orders],
    }


# ===== 新增转换函数（Pydantic 数据模型） =====


def _execution_plan_to_platform(plan: ExecutionPlan) -> dict[str, Any]:
    """将 ExecutionPlan 转换为前端兼容格式"""
    return {
        "taskId": plan.task_id,
        "taskSummary": plan.task_summary,
        "agents": [
            {
                "role": agent.role,
                "goal": agent.goal,
                "backstory": agent.backstory,
                "tools": agent.tools,
                "llmModel": agent.llm_model,
            }
            for agent in plan.agents
        ],
        "tasks": [
            {
                "name": task.name,
                "description": task.description,
                "expectedOutput": task.expected_output,
                "agentRole": task.agent_role,
                "inputs": task.inputs,
                "outputs": task.outputs,
            }
            for task in plan.tasks
        ],
        "flowType": plan.flow_type,
        "riskLevel": plan.risk_level,
        "memoryScope": plan.memory_scope,
        "constraints": plan.constraints,
    }


def _quant_state_to_platform(state: QuantState) -> dict[str, Any]:
    """将 QuantState 转换为前端兼容格式"""
    return {
        "runId": state.run_id,
        "taskDescription": state.task_description,
        "createdAt": state.created_at,
        "currentPhase": state.current_phase,
        "plan": _execution_plan_to_platform(state.plan) if state.plan else None,
        "resultFactorMining": state.result_factor_mining,
        "resultStrategy": state.result_strategy,
        "resultBacktest": state.result_backtest,
        "resultRiskAudit": state.result_risk_audit,
        "resultPaperTrading": state.result_paper_trading,
        "resultLiveDecision": state.result_live_decision,
        "auditCheckpointId": state.audit_checkpoint_id,
        "auditStatus": state.audit_status,
        "errors": state.errors,
        "retryCount": state.retry_count,
    }


def _audit_checkpoint_to_platform(checkpoint: AuditCheckpoint) -> dict[str, Any]:
    """将 AuditCheckpoint 转换为前端兼容格式"""
    return {
        "checkpointId": checkpoint.checkpoint_id,
        "runId": checkpoint.run_id,
        "stage": checkpoint.stage,
        "status": checkpoint.status,
        "auditor": checkpoint.auditor,
        "comment": checkpoint.comment,
        "modifiedData": checkpoint.modified_data,
        "submittedAt": checkpoint.submitted_at,
        "timeoutAt": checkpoint.timeout_at,
        "resolvedAt": checkpoint.resolved_at,
    }


# ===== 记忆系统转换函数（Phase 2） =====


def _memory_record_to_platform(record: MemoryRecord) -> dict[str, Any]:
    """将 MemoryRecord 转换为前端 PlatformMemory 格式"""
    return {
        "id": record.id,
        "scope": record.scope,
        "title": record.title,
        "summary": record.summary,
        "sourceMissionId": record.source_mission_id,
        "promoted": record.promoted,
    }


# ===== 记忆技能工具（Phase 2） =====


def promote_mission_memory(mission_id: str) -> dict[str, Any]:
    """
    将任务记忆提升为永久记忆

    根据 skill_catalog.py 的定义：
    - 输入：RunTrace, Artifacts
    - 输出：MemoryNote
    - 只提升可复用的策略观察和持久化教训
    """
    mission = get_mission(mission_id)
    if not mission:
        raise ValueError(f"Mission not found: {mission_id}")

    # 提取关键记忆内容
    strategy = mission.get("strategy", {})
    backtest = mission.get("backtest", {})
    risk = mission.get("risk", {})

    # 构建记忆内容
    content = f"""
策略: {strategy.get('name', 'Unknown')}
回测表现: {backtest.get('totalReturnPct', 0)}% 收益, {backtest.get('maxDrawdownPct', 0)}% 回撤
风险评估: {risk.get('decision', 'PASS')} (分数: {risk.get('riskScore', 100)}/100)
关键问题: {', '.join(risk.get('issues', []))}
改进建议: {', '.join(risk.get('recommendations', []))}
"""

    # 添加到永久记忆库
    record = memory_store.remember(
        scope="/archive/" + mission_id,
        title=f"Mission {mission_id} Archive",
        summary=f"{strategy.get('name', 'Strategy')} - {backtest.get('totalReturnPct', 0)}% return",
        content=content,
        source_mission_id=mission_id,
        promoted=True,  # 永久记忆
    )

    return {
        "memoryId": record.id,
        "scope": record.scope,
        "promoted": record.promoted,
    }


# ===== Flow 执行函数（已迁移到 quant_flow.py） =====

# run_quant_flow 函数现在在 quant_flow.py 中实现
# 使用 Microsoft Agent Framework Workflow API


def _convert_to_execution_plan(
    plan: dict[str, Any] | None,
    mission_id: str,
    mission: dict[str, Any],
) -> dict[str, Any]:
    """
    将 workflow plan 或缺失的 plan 转换为 ExecutionPlan 格式

    支持两种输入：
    1. workflow plan (来自 planner.py): 包含 missionId/steps/handoffRules
    2. None 或不完整的 plan: 自动生成默认 ExecutionPlan
    """
    # 如果 plan 已经是 ExecutionPlan 格式，直接返回
    required_fields = {"task_id", "task_summary", "agents", "tasks", "flow_type"}
    if plan and required_fields.issubset(plan.keys()):
        return plan

    # 如果 plan 是 workflow plan 格式，提取信息并转换
    if plan and "missionId" in plan and "steps" in plan:
        return _workflow_plan_to_execution_plan(
            workflow_plan=plan,
            mission_id=mission_id,
            mission=mission,
        )

    # 否则生成默认 ExecutionPlan
    strategy = mission.get("strategy", {})
    return _generate_default_execution_plan(
        mission_id=mission_id,
        title=mission.get("title", "Quant Strategy Pipeline"),
        objective=mission.get("objective", ""),
        strategy=strategy,
    )


def _workflow_plan_to_execution_plan(
    workflow_plan: dict[str, Any],
    mission_id: str,
    mission: dict[str, Any],
) -> dict[str, Any]:
    """
    将 workflow plan (planner.py 输出) 转换为 execution plan (ExecutionPlan 模型)

    workflow plan 结构：
    {
      "missionId": "...",
      "steps": [{ id, label, agentId, agentName, tool, ... }],
      "handoffRules": {...},
      "reasoning": "..."
    }

    execution plan 结构：
    {
      "task_id": "...",
      "task_summary": "...",
      "agents": [{ role, goal, backstory, tools, llm_model }],
      "tasks": [{ name, description, expected_output, agent_role, inputs, outputs }],
      "flow_type": "...",
      "risk_level": "...",
      "memory_scope": "...",
      "constraints": "..."
    }
    """
    steps = workflow_plan.get("steps", [])

    # 从 steps 提取 agent 信息
    agents = []
    agent_map = {}  # agentId -> AgentConfig
    for step in steps:
        agent_id = step.get("agentId", "")
        agent_name = step.get("agentName", "")
        tool = step.get("tool", "")

        if agent_id and agent_id not in agent_map:
            agent_config = {
                "role": agent_name or agent_id,
                "goal": f"Execute {tool} for {step.get('label', 'unknown')}",
                "backstory": f"Agent responsible for {step.get('note', 'execution')}",
                "tools": [tool] if tool else [],
                "llm_model": "gpt-4o",  # 默认模型
            }
            agents.append(agent_config)
            agent_map[agent_id] = agent_config
        elif agent_id in agent_map and tool:
            # 添加新工具到现有 agent
            if tool not in agent_map[agent_id]["tools"]:
                agent_map[agent_id]["tools"].append(tool)

    # 从 steps 提取 task 信息
    tasks = []
    for step in steps:
        task_config = {
            "name": step.get("id", ""),
            "description": step.get("note", step.get("label", "")),
            "expected_output": step.get("outputArtifactType", "run_trace"),
            "agent_role": step.get("agentName", step.get("agentId", "")),
            "inputs": {},  # 依赖关系从 dependsOn 提取
            "outputs": [step.get("outputArtifactType", "run_trace")],
        }
        tasks.append(task_config)

    # 构建 ExecutionPlan
    return {
        "task_id": mission_id,
        "task_summary": mission.get("title", "Quant Strategy Pipeline"),
        "agents": agents,
        "tasks": tasks,
        "flow_type": "sequential",  # workflow plan 默认顺序执行
        "risk_level": "low" if "risk" not in mission else "medium",
        "memory_scope": f"/quant/{mission_id}",
        "constraints": mission.get("objective", ""),
    }


def _generate_default_execution_plan(
    mission_id: str,
    title: str,
    objective: str,
    strategy: dict[str, Any],
) -> dict[str, Any]:
    """
    生成默认的 ExecutionPlan（用于没有 plan 的 mission）
    """
    return {
        "task_id": mission_id,
        "task_summary": title,
        "agents": [
            {
                "role": "Factor Analyst",
                "goal": "Analyze market data and identify trading factors",
                "backstory": "Expert in quantitative analysis and market research",
                "tools": ["fetch_market_data"],
                "llm_model": "gpt-4o",
            },
            {
                "role": "Strategy Engineer",
                "goal": "Compile strategy specifications from market analysis",
                "backstory": "Specialist in trading strategy design and optimization",
                "tools": ["compile_strategy_spec"],
                "llm_model": "gpt-4o",
            },
            {
                "role": "Backtest Engineer",
                "goal": "Execute historical simulations and validate performance",
                "backstory": "Expert in backtesting methodology and performance metrics",
                "tools": ["run_backtest"],
                "llm_model": "gpt-4o",
            },
            {
                "role": "Risk Manager",
                "goal": "Evaluate strategy risk and provide safety recommendations",
                "backstory": "Seasoned risk analyst with focus on drawdown and volatility",
                "tools": ["score_risk"],
                "llm_model": "gpt-4o",
            },
            {
                "role": "Execution Coordinator",
                "goal": "Manage deployment decisions and memory promotion",
                "backstory": "Operational specialist for live trading preparation",
                "tools": ["promote_mission_memory"],
                "llm_model": "gpt-4o",
            },
        ],
        "tasks": [
            {
                "name": "factor_mining",
                "description": "Fetch market data for the target symbol",
                "expected_output": "Market data dictionary with OHLCV candles",
                "agent_role": "Factor Analyst",
                "inputs": {},
                "outputs": ["market_data"],
            },
            {
                "name": "strategy",
                "description": "Generate strategy specification from market analysis",
                "expected_output": "StrategySpec with entry/exit rules and risk parameters",
                "agent_role": "Strategy Engineer",
                "inputs": {"market_data": "prev:factor_mining"},
                "outputs": ["strategy_spec"],
            },
            {
                "name": "backtest",
                "description": "Run historical backtest simulation",
                "expected_output": "BacktestReport with performance metrics",
                "agent_role": "Backtest Engineer",
                "inputs": {"strategy_spec": "prev:strategy", "market_data": "prev:factor_mining"},
                "outputs": ["backtest_report"],
            },
            {
                "name": "risk_audit",
                "description": "Evaluate risk profile and safety score",
                "expected_output": "RiskReport with decision and recommendations",
                "agent_role": "Risk Manager",
                "inputs": {"strategy_spec": "prev:strategy", "backtest_report": "prev:backtest"},
                "outputs": ["risk_report"],
            },
            {
                "name": "paper_trading",
                "description": "Simulate paper trading execution",
                "expected_output": "PaperSession with simulated orders and PnL",
                "agent_role": "Execution Coordinator",
                "inputs": {"risk_report": "prev:risk_audit"},
                "outputs": ["paper_session"],
            },
            {
                "name": "live_decision",
                "description": "Make final deployment decision and promote memory",
                "expected_output": "Deployment decision with confidence score",
                "agent_role": "Execution Coordinator",
                "inputs": {"paper_session": "prev:paper_trading"},
                "outputs": ["live_decision"],
            },
        ],
        "flow_type": "sequential",
        "risk_level": "high" if strategy.get("risk", {}).get("maxLeverage", 1) > 2 else "low",
        "memory_scope": f"/quant/{mission_id}",
        "constraints": objective,
    }


def _display_artifact_name(artifact_type: str) -> str:
    names = {
        "brief": "TaskBrief",
        "team_plan": "TeamPlan",
        "strategy_spec": "StrategySpec",
        "market_data": "MarketDataSnapshot",
        "backtest_report": "BacktestReport",
        "risk_report": "RiskReport",
        "review_report": "ReviewReport",
        "paper_session": "PaperSession",
        "approval": "ApprovalDecision",
        "memory_note": "MemoryNote",
        "run_trace": "RunTrace",
    }
    return names.get(artifact_type, artifact_type)


def _steps_from_result(result: QuantMissionResult, plan: dict[str, Any]) -> list[dict[str, Any]]:
    mission_id = result.mission_id
    event_by_action = {event.action: event for event in result.events}
    steps: list[dict[str, Any]] = []
    active_seen = False

    for plan_step in plan.get("steps", []):
        event = event_by_action.get(plan_step["tool"])
        status = "waiting"
        note = plan_step.get("note", "")

        if plan_step["tool"] == "task_brief":
            status = "done"
            note = "Mission constraints captured."
        elif plan_step["tool"] == "request_human_approval" and result.status == "awaiting_human":
            status = "active"
            note = result.stop_reason
            active_seen = True
        elif event:
            status = "warning" if event.status == "blocked" else "done"
            note = event.summary
        elif active_seen:
            status = "locked"

        steps.append(
            {
                "id": f"{mission_id}-step-{plan_step['id']}",
                "missionId": mission_id,
                "agentId": plan_step["agentId"],
                "label": plan_step["label"],
                "status": status,
                "tool": plan_step["tool"],
                "output": _display_artifact_name(plan_step["outputArtifactType"]),
                "note": note,
            }
        )

    return steps


def _artifacts_from_result(
    result: QuantMissionResult,
    strategy: dict[str, Any],
    backtest: dict[str, Any],
    risk: dict[str, Any],
    paper: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    mission_id = result.mission_id
    trace = "\n".join(
        f"{event.agent}: {event.status} {event.step} - {event.summary}" for event in result.events
    )
    artifacts = [
        {
            "id": f"{mission_id}-artifact-team-plan",
            "missionId": mission_id,
            "name": "TeamPlan",
            "type": "team_plan",
            "status": "ready",
            "summary": "Skill-matched agent team and workflow plan compiled by the staffing agent.",
        },
        {
            "id": f"{mission_id}-artifact-market-data",
            "missionId": mission_id,
            "name": "MarketDataSnapshot",
            "type": "market_data",
            "status": "ready",
            "summary": f"Market data context prepared for {strategy['symbol']} {strategy['timeframe']}.",
        },
        {
            "id": f"{mission_id}-artifact-spec",
            "missionId": mission_id,
            "name": "StrategySpec",
            "type": "strategy_spec",
            "status": "ready",
            "summary": f"{strategy['name']} {strategy['symbol']} {strategy['timeframe']}. Generated by {result.framework}.",
        },
        {
            "id": f"{mission_id}-artifact-backtest",
            "missionId": mission_id,
            "name": "BacktestReport",
            "type": "backtest_report",
            "status": "ready",
            "summary": f"{backtest['totalReturnPct']}% return, {backtest['maxDrawdownPct']}% MDD, {backtest['tradeCount']} trades.",
        },
        {
            "id": f"{mission_id}-artifact-risk",
            "missionId": mission_id,
            "name": "RiskReport",
            "type": "risk_report",
            "status": "ready" if risk["decision"] == "PASS" else "warning",
            "summary": f"{risk['decision']} {risk['riskScore']}/100. {' '.join(risk['issues']) or 'No blocking issue.'}",
        },
        {
            "id": f"{mission_id}-artifact-review",
            "missionId": mission_id,
            "name": "ReviewReport",
            "type": "review_report",
            "status": "ready",
            "summary": "Evidence bundle reviewed across strategy, backtest, risk, and paper simulation outputs.",
        },
        {
            "id": f"{mission_id}-artifact-approval",
            "missionId": mission_id,
            "name": "ApprovalDecision",
            "type": "approval",
            "status": "draft",
            "summary": "Human approval request is open. No live dry-run or irreversible execution has been authorized.",
        },
        {
            "id": f"{mission_id}-artifact-trace",
            "missionId": mission_id,
            "name": "MissionTrace",
            "type": "run_trace",
            "status": "ready",
            "summary": f"{result.framework}: {result.stop_reason}\n{trace}",
        },
    ]
    if paper:
        artifacts.append(
            {
                "id": f"{mission_id}-artifact-paper",
                "missionId": mission_id,
                "name": "PaperSession",
                "type": "paper_session",
                "status": "ready",
                "summary": f"{paper['orderCount']} simulated orders. {paper['pnlPct']}% paper PnL, {paper['maxDrawdownPct']}% paper MDD.",
            }
        )
    return artifacts


def _default_agents() -> list[dict[str, Any]]:
    return [
        {"id": "agent-staffing", "name": "Orion", "roleTitle": "Staffing Orchestrator", "role": "team builder", "backstory": "Assembles mission teams.", "domain": "general", "status": "available", "skillIds": ["skill-mission-intake", "skill-team-staffing"], "currentTask": "Ready.", "memoryScope": "workspace"},
        {"id": "agent-market-data", "name": "Delta", "roleTitle": "Market Data Analyst", "role": "market data loader", "backstory": "Prepares market context for strategy research and simulation.", "domain": "quant", "status": "available", "skillIds": ["skill-market-data"], "currentTask": "Ready.", "memoryScope": "mission"},
        {"id": "agent-quant-researcher", "name": "Alpha", "roleTitle": "Quant Researcher", "role": "strategy researcher", "backstory": "Researches strategies.", "domain": "quant", "status": "available", "skillIds": ["skill-technical-analysis"], "currentTask": "Ready.", "memoryScope": "workspace"},
        {"id": "agent-backtest-engineer", "name": "Nova", "roleTitle": "Backtest Engineer", "role": "simulation engineer", "backstory": "Runs backtests.", "domain": "quant", "status": "available", "skillIds": ["skill-quant-backtest"], "currentTask": "Ready.", "memoryScope": "mission"},
        {"id": "agent-risk-manager", "name": "Guard", "roleTitle": "Risk Manager", "role": "deployment gatekeeper", "backstory": "Scores risk.", "domain": "quant", "status": "available", "skillIds": ["skill-risk-modeling"], "currentTask": "Ready.", "memoryScope": "workspace"},
        {"id": "agent-strategy-reviewer", "name": "Vega", "roleTitle": "Senior Strategy Reviewer", "role": "strategy reviewer", "backstory": "Reviews evidence.", "domain": "quant", "status": "available", "skillIds": ["skill-strategy-review"], "currentTask": "Ready.", "memoryScope": "workspace"},
        {"id": "agent-execution-trader", "name": "Nexus", "roleTitle": "Execution Trader", "role": "execution operator", "backstory": "Runs paper trading.", "domain": "quant", "status": "available", "skillIds": ["skill-paper-execution"], "currentTask": "Ready.", "memoryScope": "mission"},
        {"id": "agent-human-reviewer", "name": "Human", "roleTitle": "Human Reviewer", "role": "approval owner", "backstory": "Approves releases.", "domain": "general", "status": "available", "skillIds": ["skill-human-approval"], "currentTask": "Ready.", "memoryScope": "workspace"},
    ]


def _default_skills() -> list[dict[str, Any]]:
    return load_skill_catalog()
