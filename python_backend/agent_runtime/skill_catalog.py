from __future__ import annotations

from pathlib import Path
from typing import Any


SKILLS_DIR = Path(__file__).resolve().parent / "skills"


CONTRACTS: dict[str, dict[str, Any]] = {
    "mission-intake": {
        "id": "skill-mission-intake",
        "usedBy": "planner",
        "category": "planning",
        "toolId": "task_brief",
        "inputs": [],
        "outputs": ["TaskBrief"],
        "domains": ["quant", "general"],
        "sideEffects": "none",
        "requiresApproval": False,
        "failureModes": ["missing_objective", "unsupported_domain"],
        "acceptanceCriteria": [
            "Mission title and objective are persisted.",
            "Operating mode is approval-gated before any execution step.",
            "Initial TaskBrief artifact is available for downstream agents.",
        ],
    },
    "team-staffing": {
        "id": "skill-team-staffing",
        "usedBy": "planner",
        "category": "planning",
        "toolId": "build_team_plan",
        "inputs": ["TaskBrief", "SkillRegistry"],
        "outputs": ["TeamPlan", "WorkflowPlan"],
        "domains": ["quant", "general"],
        "sideEffects": "writes_plan",
        "requiresApproval": False,
        "failureModes": ["missing_required_skill", "unassigned_executor"],
        "acceptanceCriteria": [
            "Selected agents cover every required workflow skill.",
            "Workflow graph contains typed inputs, outputs, and dependencies.",
            "Risk and human approval gates are present when execution could be sensitive.",
        ],
    },
    "market-data-context": {
        "id": "skill-market-data",
        "usedBy": "executor",
        "category": "analysis",
        "toolId": "fetch_market_data",
        "inputs": ["TaskBrief"],
        "outputs": ["MarketDataSnapshot"],
        "domains": ["quant"],
        "sideEffects": "network_read",
        "requiresApproval": False,
        "failureModes": ["symbol_not_found", "insufficient_data", "provider_unavailable"],
        "acceptanceCriteria": [
            "Symbol, market, and timeframe are resolved from the mission.",
            "MarketDataSnapshot artifact names the source and time window.",
            "Downstream strategy and backtest steps can reference the same market context.",
        ],
    },
    "strategy-specification": {
        "id": "skill-technical-analysis",
        "usedBy": "executor",
        "category": "analysis",
        "toolId": "compile_strategy_spec",
        "inputs": ["TaskBrief", "MarketDataSnapshot"],
        "outputs": ["StrategySpec"],
        "domains": ["quant"],
        "sideEffects": "none",
        "requiresApproval": False,
        "failureModes": ["ambiguous_strategy", "missing_risk_parameters"],
        "acceptanceCriteria": [
            "StrategySpec includes entry rules, exit rules, and risk parameters.",
            "Spec references the selected market context and timeframe.",
            "No live execution permission is granted by this step.",
        ],
    },
    "quant-backtest": {
        "id": "skill-quant-backtest",
        "usedBy": "executor",
        "category": "computation",
        "toolId": "run_backtest",
        "inputs": ["StrategySpec", "MarketDataSnapshot"],
        "outputs": ["BacktestReport"],
        "domains": ["quant"],
        "sideEffects": "compute",
        "requiresApproval": False,
        "failureModes": ["invalid_strategy", "insufficient_data"],
        "acceptanceCriteria": [
            "BacktestReport includes return, drawdown, win rate, trade count, and profit factor.",
            "Report uses the StrategySpec generated for this mission.",
            "Backtest result is stored as an auditable artifact.",
        ],
    },
    "risk-scoring": {
        "id": "skill-risk-modeling",
        "usedBy": "reviewer",
        "category": "governance",
        "toolId": "score_risk",
        "inputs": ["StrategySpec", "BacktestReport"],
        "outputs": ["RiskReport"],
        "domains": ["quant", "general"],
        "sideEffects": "none",
        "requiresApproval": False,
        "failureModes": ["policy_violation", "missing_evidence"],
        "acceptanceCriteria": [
            "RiskReport includes PASS/WARN/BLOCK decision and numeric risk score.",
            "Issues and recommendations are explicit when score is below perfect.",
            "BLOCK decision prevents paper execution from progressing.",
        ],
    },
    "evidence-review": {
        "id": "skill-strategy-review",
        "usedBy": "reviewer",
        "category": "review",
        "toolId": "review_strategy",
        "inputs": ["StrategySpec", "BacktestReport", "RiskReport"],
        "outputs": ["ReviewReport"],
        "domains": ["quant"],
        "sideEffects": "none",
        "requiresApproval": False,
        "failureModes": ["inconsistent_evidence", "missing_artifact"],
        "acceptanceCriteria": [
            "ReviewReport reconciles strategy, backtest, and risk artifacts.",
            "Reviewer identifies missing or inconsistent evidence.",
            "Output is suitable for a human approval decision.",
        ],
    },
    "paper-trading": {
        "id": "skill-paper-execution",
        "usedBy": "executor",
        "category": "execution",
        "toolId": "start_paper_session",
        "inputs": ["StrategySpec", "RiskReport", "ReviewReport"],
        "outputs": ["PaperSession"],
        "domains": ["quant"],
        "sideEffects": "paper_simulation",
        "requiresApproval": False,
        "failureModes": ["paper_engine_unavailable", "risk_not_passed"],
        "acceptanceCriteria": [
            "PaperSession records simulated orders only.",
            "No exchange order placement API is called.",
            "Session summary includes PnL, drawdown, and order count.",
        ],
    },
    "human-approval": {
        "id": "skill-human-approval",
        "usedBy": "human",
        "category": "approval",
        "toolId": "request_human_approval",
        "inputs": ["StrategySpec", "BacktestReport", "RiskReport", "PaperSession"],
        "outputs": ["ApprovalDecision"],
        "domains": ["general"],
        "sideEffects": "workflow_pause",
        "requiresApproval": True,
        "failureModes": ["approval_timeout", "revision_requested"],
        "acceptanceCriteria": [
            "Approval request summarizes evidence and residual risk.",
            "Workflow pauses before any live dry-run or irreversible action.",
            "Human decision can approve, reject, or request revision.",
        ],
    },
    "mission-memory": {
        "id": "skill-mission-memory",
        "usedBy": "executor",
        "category": "memory",
        "toolId": "promote_mission_memory",
        "inputs": ["RunTrace", "Artifacts"],
        "outputs": ["MemoryNote"],
        "domains": ["quant", "general"],
        "sideEffects": "writes_memory",
        "requiresApproval": False,
        "failureModes": ["no_promotable_learning"],
        "acceptanceCriteria": [
            "Memory note is linked to the source mission.",
            "Only durable lessons or reusable strategy observations are promoted.",
            "Private or sensitive execution details are not promoted by default.",
        ],
    },
}


def load_skill_catalog() -> list[dict[str, Any]]:
    skills: list[dict[str, Any]] = []
    for slug, contract in CONTRACTS.items():
        skill_md = SKILLS_DIR / slug / "SKILL.md"
        frontmatter = _read_frontmatter(skill_md)
        name = frontmatter.get("name") or slug
        description = frontmatter.get("description") or f"Use the {name} skill."
        skills.append(
            {
                **contract,
                "name": _title_from_name(name),
                "description": description,
                "sourcePath": str(skill_md.relative_to(SKILLS_DIR.parent)) if skill_md.exists() else "",
            }
        )
    return skills


def _read_frontmatter(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    values: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip().strip('"')
    return values


def _title_from_name(name: str) -> str:
    return " ".join(part.capitalize() for part in name.replace("_", "-").split("-"))
