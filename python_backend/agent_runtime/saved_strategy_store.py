from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from agent_runtime.platform_store import connect, get_entity, list_entities, upsert_entity


def list_saved_strategies() -> list[dict[str, Any]]:
    strategies = [
        strategy
        for strategy in list_entities("saved_strategy")
        if strategy.get("status") != "archived"
    ]
    return sorted(strategies, key=lambda item: item.get("updatedAt", ""), reverse=True)


def list_published_strategies() -> list[dict[str, Any]]:
    strategies = [
        _public_strategy(strategy)
        for strategy in list_entities("saved_strategy")
        if strategy.get("status") != "archived"
        and strategy.get("visibility") == "published"
    ]
    return sorted(
        strategies,
        key=lambda item: item.get("publishedAt") or item.get("updatedAt", ""),
        reverse=True,
    )


def get_saved_strategy(strategy_id: str) -> dict[str, Any] | None:
    strategy = get_entity("saved_strategy", strategy_id)
    if not strategy:
        return None
    versions = [
        version
        for version in list_entities("strategy_version")
        if version.get("strategyId") == strategy_id
    ]
    versions.sort(key=lambda item: int(item.get("version") or 0), reverse=True)
    current_version = next(
        (version for version in versions if version.get("id") == strategy.get("currentVersionId")),
        versions[0] if versions else None,
    )
    return {
        "strategy": strategy,
        "currentVersion": current_version,
        "versions": versions,
    }


def get_published_strategy(strategy_id: str) -> dict[str, Any] | None:
    detail = get_saved_strategy(strategy_id)
    if not detail or detail["strategy"].get("visibility") != "published":
        return None
    return {
        "strategy": _public_strategy(detail["strategy"]),
        "currentVersion": _public_version(detail.get("currentVersion")),
    }


def save_strategy_from_artifact(input_data: dict[str, Any]) -> dict[str, Any]:
    artifact_id = str(input_data.get("artifactId") or input_data.get("artifact_id") or "").strip()
    if not artifact_id:
        raise ValueError("artifactId is required")
    artifact = get_entity("strategy_lab_artifact", artifact_id)
    if not artifact:
        raise ValueError(f"Strategy Lab artifact not found: {artifact_id}")
    if artifact.get("type") not in {"code_package", "backtest_run"}:
        raise ValueError("Only code packages and backtest runs can be saved as strategies")

    source_code_package_id = str(artifact.get("codePackageId") or artifact.get("id"))
    existing = next(
        (
            item
            for item in list_entities("saved_strategy")
            if item.get("sourceCodePackageId") == source_code_package_id
            and item.get("status") != "archived"
        ),
        None,
    )
    now = _now()
    strategy_id = str((existing or {}).get("id") or f"strategy-{uuid4().hex[:10]}")
    versions = [
        version
        for version in list_entities("strategy_version")
        if version.get("strategyId") == strategy_id
    ]
    snapshot = _version_snapshot(strategy_id, artifact, len(versions) + 1, now)
    current = get_entity("strategy_version", str((existing or {}).get("currentVersionId") or ""))

    if current and current.get("fingerprint") == snapshot.get("fingerprint"):
        version = current
    else:
        version = snapshot
        with connect() as db:
            upsert_entity(db, "strategy_version", version["id"], version)

    name = str(input_data.get("name") or (existing or {}).get("name") or _base_title(artifact)).strip()
    if not name:
        raise ValueError("name is required")
    description = str(
        input_data.get("description")
        or (existing or {}).get("description")
        or artifact.get("explanation")
        or "由 Strategy Lab 保存的量化策略。"
    ).strip()
    tags = _normalize_tags(input_data.get("tags"), fallback=(existing or {}).get("tags"))
    config = version.get("backtestConfig") or {}
    strategy = {
        **(existing or {}),
        "id": strategy_id,
        "name": name[:100],
        "description": description[:500],
        "tags": tags,
        "status": str((existing or {}).get("status") or "active"),
        "visibility": str((existing or {}).get("visibility") or "private"),
        "sourceSessionId": artifact.get("sessionId"),
        "sourceCodePackageId": source_code_package_id,
        "sourceArtifactId": artifact_id,
        "currentVersionId": version["id"],
        "versionCount": max(len(versions), int(version.get("version") or 1)),
        "symbol": str(config.get("symbol") or (existing or {}).get("symbol") or "BTCUSDT"),
        "timeframe": str(config.get("granularity") or (existing or {}).get("timeframe") or "1day"),
        "latestMetrics": version.get("metrics") or {},
        "createdAt": str((existing or {}).get("createdAt") or now),
        "updatedAt": now,
    }
    with connect() as db:
        upsert_entity(db, "saved_strategy", strategy_id, strategy)
    return {
        "strategy": strategy,
        "version": version,
        "created": existing is None,
        "versionCreated": not current or current.get("id") != version.get("id"),
    }


def update_saved_strategy(strategy_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    strategy = get_entity("saved_strategy", strategy_id)
    if not strategy:
        raise ValueError(f"Saved strategy not found: {strategy_id}")
    if "name" in patch:
        name = str(patch.get("name") or "").strip()
        if not name:
            raise ValueError("name cannot be empty")
        strategy["name"] = name[:100]
    if "description" in patch:
        strategy["description"] = str(patch.get("description") or "").strip()[:500]
    if "tags" in patch:
        strategy["tags"] = _normalize_tags(patch.get("tags"))
    if patch.get("status") in {"active", "archived"}:
        strategy["status"] = patch["status"]
    if patch.get("visibility") in {"private", "published"}:
        visibility = patch["visibility"]
        strategy["visibility"] = visibility
        if visibility == "published":
            strategy["publishedAt"] = strategy.get("publishedAt") or _now()
            strategy["publisherName"] = str(
                patch.get("publisherName")
                or strategy.get("publisherName")
                or "PaperForge Creator"
            ).strip()[:80]
        else:
            strategy.pop("publishedAt", None)
    strategy["updatedAt"] = _now()
    with connect() as db:
        upsert_entity(db, "saved_strategy", strategy_id, strategy)
    return strategy


def copy_published_strategy(strategy_id: str) -> dict[str, Any]:
    detail = get_published_strategy(strategy_id)
    if not detail:
        raise ValueError(f"Published strategy not found: {strategy_id}")
    source_strategy = detail["strategy"]
    source_version = get_entity(
        "strategy_version", str(source_strategy.get("currentVersionId") or "")
    )
    if not source_version:
        raise ValueError("Published strategy has no current version")

    now = _now()
    new_strategy_id = f"strategy-{uuid4().hex[:10]}"
    new_version_id = f"strategy-version-{uuid4().hex[:10]}"
    version = {
        **source_version,
        "id": new_version_id,
        "strategyId": new_strategy_id,
        "version": 1,
        "sourceMarketplaceStrategyId": strategy_id,
        "createdAt": now,
    }
    strategy = {
        **source_strategy,
        "id": new_strategy_id,
        "name": f"{source_strategy.get('name') or '未命名策略'} 副本"[:100],
        "status": "active",
        "visibility": "private",
        "currentVersionId": new_version_id,
        "versionCount": 1,
        "sourceMarketplaceStrategyId": strategy_id,
        "createdAt": now,
        "updatedAt": now,
    }
    strategy.pop("publishedAt", None)
    strategy.pop("publisherName", None)
    strategy.pop("copyCount", None)

    original = get_entity("saved_strategy", strategy_id) or {}
    original["copyCount"] = int(original.get("copyCount") or 0) + 1
    with connect() as db:
        upsert_entity(db, "strategy_version", new_version_id, version)
        upsert_entity(db, "saved_strategy", new_strategy_id, strategy)
        upsert_entity(db, "saved_strategy", strategy_id, original)
    return {"strategy": strategy, "version": version}


def _public_strategy(strategy: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in strategy.items()
        if key
        not in {
            "sourceSessionId",
            "sourceCodePackageId",
            "sourceArtifactId",
        }
    }


def _public_version(version: dict[str, Any] | None) -> dict[str, Any] | None:
    if not version:
        return None
    return {
        "id": version.get("id"),
        "strategyId": version.get("strategyId"),
        "version": version.get("version"),
        "title": version.get("title"),
        "params": version.get("params") or {},
        "metrics": version.get("metrics") or {},
        "backtestConfig": version.get("backtestConfig") or {},
        "backtestSnapshot": version.get("backtestSnapshot") or {},
        "strategyReferences": version.get("strategyReferences") or [],
        "createdAt": version.get("createdAt"),
    }


def _version_snapshot(
    strategy_id: str,
    artifact: dict[str, Any],
    version_number: int,
    now: str,
) -> dict[str, Any]:
    payload = {
        "code": str(artifact.get("code") or ""),
        "params": dict(artifact.get("params") or {}),
        "metrics": dict(artifact.get("metrics") or {}),
        "backtestConfig": dict(artifact.get("backtestConfig") or {}),
        "strategyReferences": list(artifact.get("strategyReferences") or []),
    }
    fingerprint = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return {
        "id": f"strategy-version-{uuid4().hex[:10]}",
        "strategyId": strategy_id,
        "version": version_number,
        "title": _base_title(artifact),
        **payload,
        "backtestSnapshot": {
            "charts": artifact.get("charts") or {},
            "monthlyReturns": artifact.get("monthlyReturns") or [],
            "trades": artifact.get("trades") or [],
            "positions": artifact.get("positions") or [],
            "logs": artifact.get("logs") or [],
        },
        "sourceArtifactId": artifact.get("id"),
        "sourceArtifactType": artifact.get("type"),
        "fingerprint": fingerprint,
        "createdAt": now,
    }


def _normalize_tags(value: Any, fallback: Any = None) -> list[str]:
    source = value if value is not None else fallback
    if isinstance(source, str):
        raw = source.replace("，", ",").split(",")
    elif isinstance(source, list):
        raw = source
    else:
        raw = []
    tags: list[str] = []
    for item in raw:
        tag = str(item).strip().lower()
        if tag and tag not in tags:
            tags.append(tag[:24])
    return tags[:8]


def _base_title(artifact: dict[str, Any]) -> str:
    title = str(artifact.get("title") or "未命名策略").strip()
    while title.endswith(" 回测"):
        title = title[: -len(" 回测")].rstrip()
    return title or "未命名策略"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
