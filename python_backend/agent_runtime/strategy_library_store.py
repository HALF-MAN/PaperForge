from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from agent_runtime.models import (
    StrategyCard,
    StrategySearchQuery,
    StrategySource,
    StrategyValidation,
)


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = ROOT_DIR / ".paperforge" / "platform.sqlite"

KNOWN_QUERY_TERMS = (
    "趋势",
    "突破",
    "震荡",
    "均值回归",
    "反转",
    "动量",
    "做市",
    "网格",
    "套利",
    "跨交易所",
    "资金费率",
    "基差",
    "订单簿",
    "高波动",
    "低波动",
    "bollinger",
    "ema",
    "rsi",
    "kdj",
    "supertrend",
    "dual thrust",
    "pairs",
    "cointegration",
)


class StrategyLibraryStore:
    """SQLite-backed, source-traceable strategy knowledge library."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        configured = os.getenv("PAPERFORGE_DB_PATH")
        self.db_path = Path(db_path or configured or DEFAULT_DB_PATH)

    def connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.db_path)
        db.row_factory = sqlite3.Row
        db.execute(
            """
            create table if not exists strategy_library_cards (
              id text primary key,
              data text not null,
              status text not null,
              family text not null,
              created_at text not null,
              updated_at text not null
            )
            """
        )
        db.execute(
            """
            create table if not exists strategy_library_sources (
              id text primary key,
              strategy_card_id text not null,
              data text not null,
              provider text not null,
              updated_at text not null
            )
            """
        )
        db.execute(
            """
            create table if not exists strategy_library_validations (
              id text primary key,
              strategy_card_id text not null,
              validation_type text not null,
              status text not null,
              data text not null,
              created_at text not null
            )
            """
        )
        db.execute(
            """
            create virtual table if not exists strategy_library_fts using fts5(
              card_id unindexed,
              name,
              aliases,
              summary,
              thesis,
              indicators,
              failure_modes,
              tokenize='unicode61'
            )
            """
        )
        db.commit()
        return db

    @contextmanager
    def connection(self):
        db = self.connect()
        try:
            yield db
        finally:
            db.close()

    def seed_if_empty(self) -> None:
        with self.connection() as db:
            count = int(db.execute("select count(*) from strategy_library_cards").fetchone()[0])
            existing_rows = db.execute("select data from strategy_library_cards").fetchall()
        if count:
            self._ensure_source_review_validations(
                [StrategyCard.model_validate_json(row["data"]) for row in existing_rows]
            )
            return
        for card, source in _seed_records():
            self.upsert_card(card, [source])
        self._ensure_source_review_validations([card for card, _ in _seed_records()])

    def _ensure_source_review_validations(self, cards: list[StrategyCard]) -> None:
        for card in cards:
            validation_id = f"strategy-validation-source-{card.id}"
            with self.connection() as db:
                exists = db.execute(
                    "select 1 from strategy_library_validations where id = ?",
                    (validation_id,),
                ).fetchone()
            if exists:
                continue
            self.upsert_validation(
                StrategyValidation(
                    id=validation_id,
                    strategy_card_id=card.id,
                    validation_type="source_review",
                    status="informational",
                    summary=(
                        "Curated as strategy research knowledge. This review does not certify "
                        "historical performance or future profitability."
                    ),
                    details={"reviewedSourceIds": card.source_ids},
                    data_source="curated_seed",
                    created_at=card.created_at,
                )
            )

    def upsert_card(self, card: StrategyCard, sources: list[StrategySource]) -> None:
        with self.connection() as db:
            db.execute(
                """
                insert into strategy_library_cards (id, data, status, family, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?)
                on conflict(id) do update set
                  data = excluded.data,
                  status = excluded.status,
                  family = excluded.family,
                  updated_at = excluded.updated_at
                """,
                (
                    card.id,
                    card.model_dump_json(),
                    card.status,
                    card.family,
                    card.created_at,
                    card.updated_at,
                ),
            )
            for source in sources:
                db.execute(
                    """
                    insert into strategy_library_sources
                      (id, strategy_card_id, data, provider, updated_at)
                    values (?, ?, ?, ?, ?)
                    on conflict(id) do update set
                      data = excluded.data,
                      provider = excluded.provider,
                      updated_at = excluded.updated_at
                    """,
                    (
                        source.id,
                        source.strategy_card_id,
                        source.model_dump_json(),
                        source.provider,
                        source.retrieved_at,
                    ),
                )
            db.execute("delete from strategy_library_fts where card_id = ?", (card.id,))
            db.execute(
                """
                insert into strategy_library_fts
                  (card_id, name, aliases, summary, thesis, indicators, failure_modes)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    card.id,
                    card.name,
                    " ".join(card.aliases),
                    card.summary,
                    card.thesis,
                    " ".join(card.indicators),
                    " ".join(card.failure_modes),
                ),
            )
            db.commit()

    def get_card(self, card_id: str) -> dict[str, Any] | None:
        self.seed_if_empty()
        with self.connection() as db:
            row = db.execute(
                "select data from strategy_library_cards where id = ?",
                (card_id,),
            ).fetchone()
            if not row:
                return None
            source_rows = db.execute(
                "select data from strategy_library_sources where strategy_card_id = ? order by id",
                (card_id,),
            ).fetchall()
            validation_rows = db.execute(
                """
                select data from strategy_library_validations
                where strategy_card_id = ? order by created_at desc, id
                """,
                (card_id,),
            ).fetchall()
        return {
            "card": StrategyCard.model_validate_json(row["data"]).model_dump(),
            "sources": [
                StrategySource.model_validate_json(source_row["data"]).model_dump()
                for source_row in source_rows
            ],
            "validations": [
                StrategyValidation.model_validate_json(validation_row["data"]).model_dump()
                for validation_row in validation_rows
            ],
        }

    def upsert_validation(self, validation: StrategyValidation) -> None:
        with self.connection() as db:
            db.execute(
                """
                insert into strategy_library_validations
                  (id, strategy_card_id, validation_type, status, data, created_at)
                values (?, ?, ?, ?, ?, ?)
                on conflict(id) do update set
                  validation_type = excluded.validation_type,
                  status = excluded.status,
                  data = excluded.data,
                  created_at = excluded.created_at
                """,
                (
                    validation.id,
                    validation.strategy_card_id,
                    validation.validation_type,
                    validation.status,
                    validation.model_dump_json(),
                    validation.created_at,
                ),
            )
            db.commit()

    def list_cards(self, status: str = "published") -> list[dict[str, Any]]:
        self.seed_if_empty()
        with self.connection() as db:
            rows = db.execute(
                "select data from strategy_library_cards where status = ? order by family, id",
                (status,),
            ).fetchall()
        return [StrategyCard.model_validate_json(row["data"]).model_dump() for row in rows]

    def search(self, query: StrategySearchQuery) -> dict[str, Any]:
        self.seed_if_empty()
        cards = [StrategyCard.model_validate(card) for card in self.list_cards()]
        terms = _query_terms(query.query)
        fts_hits = self._fts_hits(terms)
        available_data = {item.lower() for item in query.available_data if item}
        results: list[dict[str, Any]] = []

        for card in cards:
            excluded = _hard_constraint_failure(card, query, available_data)
            if excluded:
                continue
            score, reasons, mismatches, components = _score_card(
                card=card,
                query=query,
                terms=terms,
                fts_hit=card.id in fts_hits,
                available_data=available_data,
            )
            results.append(
                {
                    "id": card.id,
                    "name": card.name,
                    "family": card.family,
                    "summary": card.summary,
                    "score": round(score, 2),
                    "scoreComponents": components,
                    "matchReasons": reasons,
                    "mismatches": mismatches,
                    "failureModes": card.failure_modes,
                    "requiredData": card.required_data,
                    "sourceIds": card.source_ids,
                }
            )

        results.sort(key=lambda item: (-item["score"], item["name"]))
        return {
            "query": query.model_dump(),
            "retrievalMode": "structured+fts5+deterministic_ranking",
            "vectorSearchUsed": False,
            "totalCandidates": len(results),
            "results": results[: query.limit],
        }

    def compare(
        self,
        *,
        card_ids: list[str],
        market: str = "",
        timeframe: str = "",
        regime: str = "",
        trend: str = "",
        volatility: str = "",
        direction: str = "",
        available_data: list[str] | None = None,
        risk_tolerance: str = "",
    ) -> dict[str, Any]:
        normalized_ids = list(dict.fromkeys(card_ids))[:5]
        if not normalized_ids:
            raise ValueError("card_ids is required")
        query = StrategySearchQuery(
            market=market,
            timeframe=timeframe,
            regime=regime,
            trend=trend,
            volatility=volatility,
            direction=direction,
            available_data=available_data or [],
            risk_tolerance=risk_tolerance,
            limit=5,
        )
        available = {item.lower() for item in query.available_data if item}
        results: list[dict[str, Any]] = []
        for card_id in normalized_ids:
            detail = self.get_card(card_id)
            if not detail:
                results.append(
                    {"id": card_id, "eligible": False, "excludedBy": "not_found", "score": 0}
                )
                continue
            card = StrategyCard.model_validate(detail["card"])
            excluded = _hard_constraint_failure(card, query, available)
            score, reasons, mismatches, components = _score_card(
                card=card,
                query=query,
                terms=[],
                fts_hit=False,
                available_data=available,
            )
            results.append(
                {
                    "id": card.id,
                    "name": card.name,
                    "family": card.family,
                    "eligible": not bool(excluded),
                    "excludedBy": excluded or None,
                    "score": round(score, 2) if not excluded else 0,
                    "scoreComponents": components,
                    "matchReasons": reasons,
                    "mismatches": mismatches,
                    "failureModes": card.failure_modes,
                    "riskControls": card.risk_controls,
                    "sources": [
                        {
                            "id": source["id"],
                            "provider": source["provider"],
                            "title": source["title"],
                            "sourceUrl": source["source_url"],
                        }
                        for source in detail["sources"]
                    ],
                }
            )
        results.sort(key=lambda item: (not item["eligible"], -float(item["score"])))
        return {
            "marketContext": query.model_dump(exclude={"query", "limit"}),
            "vectorSearchUsed": False,
            "rankingPolicy": "hard_constraints_then_deterministic_score",
            "results": results,
        }

    def validate_design(
        self,
        *,
        card_id: str,
        market: str = "",
        timeframe: str = "",
        regime: str = "",
        trend: str = "",
        direction: str = "",
        available_data: list[str] | None = None,
        persist: bool = True,
    ) -> dict[str, Any]:
        detail = self.get_card(card_id)
        if not detail:
            raise ValueError(f"Strategy card not found: {card_id}")
        card = StrategyCard.model_validate(detail["card"])
        available = {item.lower() for item in (available_data or []) if item}
        failures: list[str] = []
        warnings: list[str] = []
        passed_checks: list[str] = []

        missing_data = sorted(
            item for item in card.required_data if item.lower() not in available
        ) if available else []
        if not available:
            warnings.append("未提供可用数据清单，无法确认必需数据")
        elif missing_data:
            failures.append(f"缺少必需数据：{', '.join(missing_data)}")
        else:
            passed_checks.append("必需数据可用")

        for value, options, label in (
            (market, card.markets, "市场"),
            (timeframe, card.timeframes, "周期"),
            (direction, card.directions, "交易方向"),
        ):
            if value and value.lower() not in {item.lower() for item in options}:
                failures.append(f"{label} {value} 不在策略支持范围")
            elif value:
                passed_checks.append(f"{label}匹配")

        for value, options, label in (
            (regime, card.regimes, "行情状态"),
            (trend, card.trends, "趋势"),
        ):
            if value and value.lower() not in {item.lower() for item in options}:
                warnings.append(f"{label} {value} 不是策略的明确适用条件")
            elif value:
                passed_checks.append(f"{label}匹配")

        if not card.entry_logic.strip() or not card.exit_logic.strip():
            failures.append("策略缺少完整入场或退出逻辑")
        else:
            passed_checks.append("入场和退出逻辑完整")
        if not card.risk_controls:
            failures.append("策略没有风险控制")
        else:
            passed_checks.append("风险控制已声明")
        if card.implementation_compatibility == "unsupported":
            failures.append("PaperForge 当前不能适配该策略")
        elif card.implementation_compatibility == "reference_only":
            warnings.append("该策略当前仅供研究参考")
        if not detail["sources"]:
            warnings.append("策略缺少可追溯来源")
        if not detail["validations"]:
            warnings.append("策略尚无任何验证记录")

        decision = "failed" if failures else "warning" if warnings else "passed"
        summary = (
            "策略设计不满足生成条件"
            if failures
            else "策略设计可以进入代码生成，但仍需完成回测验证"
            if not warnings
            else "策略设计可作为候选，但存在需要披露的条件"
        )
        validation = StrategyValidation(
            id=f"strategy-validation-design-{uuid4().hex[:12]}",
            strategy_card_id=card.id,
            validation_type="design_compatibility",
            status=decision,
            summary=summary,
            details={
                "marketContext": {
                    "market": market,
                    "timeframe": timeframe,
                    "regime": regime,
                    "trend": trend,
                    "direction": direction,
                    "availableData": sorted(available),
                },
                "passedChecks": passed_checks,
                "warnings": warnings,
                "failures": failures,
                "requiredFutureValidation": card.validation_requirements,
            },
            data_source="strategy_lab_design_check",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        if persist:
            self.upsert_validation(validation)
        return {
            "decision": decision,
            "canGenerateCode": not failures,
            "summary": summary,
            "passedChecks": passed_checks,
            "warnings": warnings,
            "failures": failures,
            "requiredFutureValidation": card.validation_requirements,
            "validationId": validation.id if persist else None,
        }

    def _fts_hits(self, terms: list[str]) -> set[str]:
        if not terms:
            return set()
        safe_terms = [term.replace('"', "") for term in terms if term.replace('"', "")]
        if not safe_terms:
            return set()
        expression = " OR ".join(f'"{term}"' for term in safe_terms)
        try:
            with self.connection() as db:
                rows = db.execute(
                    "select card_id from strategy_library_fts where strategy_library_fts match ? limit 100",
                    (expression,),
                ).fetchall()
            return {str(row["card_id"]) for row in rows}
        except sqlite3.OperationalError:
            return set()


def search_strategy_library(
    *,
    query: str = "",
    market: str = "",
    timeframe: str = "",
    regime: str = "",
    trend: str = "",
    volatility: str = "",
    direction: str = "",
    available_data: list[str] | None = None,
    risk_tolerance: str = "",
    limit: int = 5,
) -> dict[str, Any]:
    return StrategyLibraryStore().search(
        StrategySearchQuery(
            query=query,
            market=market,
            timeframe=timeframe,
            regime=regime,
            trend=trend,
            volatility=volatility,
            direction=direction,
            available_data=available_data or [],
            risk_tolerance=risk_tolerance,
            limit=limit,
        )
    )


def get_strategy_card(card_id: str) -> dict[str, Any]:
    detail = StrategyLibraryStore().get_card(card_id)
    if not detail:
        raise ValueError(f"Strategy card not found: {card_id}")
    return detail


def compare_strategy_cards(
    *,
    card_ids: list[str],
    market: str = "",
    timeframe: str = "",
    regime: str = "",
    trend: str = "",
    volatility: str = "",
    direction: str = "",
    available_data: list[str] | None = None,
    risk_tolerance: str = "",
) -> dict[str, Any]:
    return StrategyLibraryStore().compare(
        card_ids=card_ids,
        market=market,
        timeframe=timeframe,
        regime=regime,
        trend=trend,
        volatility=volatility,
        direction=direction,
        available_data=available_data,
        risk_tolerance=risk_tolerance,
    )


def validate_strategy_design(
    *,
    card_id: str,
    market: str = "",
    timeframe: str = "",
    regime: str = "",
    trend: str = "",
    direction: str = "",
    available_data: list[str] | None = None,
) -> dict[str, Any]:
    return StrategyLibraryStore().validate_design(
        card_id=card_id,
        market=market,
        timeframe=timeframe,
        regime=regime,
        trend=trend,
        direction=direction,
        available_data=available_data,
    )


def resolve_strategy_references(card_ids: list[str]) -> list[dict[str, Any]]:
    store = StrategyLibraryStore()
    references: list[dict[str, Any]] = []
    for card_id in list(dict.fromkeys(card_ids))[:5]:
        detail = store.get_card(card_id)
        if not detail:
            raise ValueError(f"Strategy card not found: {card_id}")
        card = detail["card"]
        references.append(
            {
                "id": card["id"],
                "name": card["name"],
                "family": card["family"],
                "sources": [
                    {
                        "id": source["id"],
                        "provider": source["provider"],
                        "title": source["title"],
                        "sourceUrl": source["source_url"],
                    }
                    for source in detail["sources"]
                ],
            }
        )
    return references


def _hard_constraint_failure(
    card: StrategyCard,
    query: StrategySearchQuery,
    available_data: set[str],
) -> str:
    if query.market and query.market.lower() not in {item.lower() for item in card.markets}:
        return "market"
    if query.timeframe and query.timeframe.lower() not in {item.lower() for item in card.timeframes}:
        return "timeframe"
    if query.direction and query.direction.lower() not in {item.lower() for item in card.directions}:
        return "direction"
    if available_data and not {item.lower() for item in card.required_data}.issubset(available_data):
        return "required_data"
    return ""


def _score_card(
    *,
    card: StrategyCard,
    query: StrategySearchQuery,
    terms: list[str],
    fts_hit: bool,
    available_data: set[str],
) -> tuple[float, list[str], list[str], dict[str, float]]:
    reasons: list[str] = []
    mismatches: list[str] = []
    searchable = " ".join(
        [
            card.name,
            *card.aliases,
            card.family,
            card.summary,
            card.thesis,
            card.entry_logic,
            card.exit_logic,
            *card.indicators,
            *card.regimes,
            *card.failure_modes,
        ]
    ).lower()

    regime_score = 15.0
    if query.regime:
        if query.regime.lower() in {item.lower() for item in card.regimes}:
            regime_score = 30.0
            reasons.append(f"适用行情包含 {query.regime}")
        else:
            regime_score = 3.0
            mismatches.append(f"策略未明确支持 {query.regime} 行情")

    data_score = 10.0
    if available_data:
        required = {item.lower() for item in card.required_data}
        data_score = 20.0 if required.issubset(available_data) else 0.0
        if data_score:
            reasons.append("当前工具覆盖全部必需数据")

    context_score = 7.5
    context_checks = 0
    context_matches = 0
    for value, options, label in (
        (query.timeframe, card.timeframes, "周期"),
        (query.direction, card.directions, "方向"),
        (query.trend, card.trends, "趋势"),
        (query.volatility, card.volatility, "波动状态"),
    ):
        if not value:
            continue
        context_checks += 1
        if value.lower() in {item.lower() for item in options}:
            context_matches += 1
            reasons.append(f"{label}匹配 {value}")
        else:
            mismatches.append(f"{label}未明确匹配 {value}")
    if context_checks:
        context_score = 15.0 * context_matches / context_checks

    matching_terms = [term for term in terms if _term_matches(term, searchable)]
    lexical_score = min(15.0, len(matching_terms) * 5.0)
    indicator_text = " ".join(card.indicators).lower()
    identity_text = " ".join([card.name, *card.aliases]).lower()
    lexical_score += sum(3.0 for term in terms if _term_matches(term, indicator_text))
    lexical_score += sum(2.0 for term in terms if _term_matches(term, identity_text))
    lexical_score = min(15.0, lexical_score)
    if fts_hit:
        lexical_score = max(lexical_score, 8.0)
    if matching_terms:
        reasons.append(f"关键词匹配：{', '.join(matching_terms[:4])}")

    risk_score = 5.0
    if query.risk_tolerance:
        tolerance = query.risk_tolerance.lower()
        accepted = {
            "conservative": {"low"},
            "balanced": {"low", "medium"},
            "aggressive": {"low", "medium", "high"},
        }.get(tolerance, {tolerance})
        risk_score = 10.0 if card.risk_level in accepted else 0.0
        if not risk_score:
            mismatches.append(f"风险等级 {card.risk_level} 高于约束")

    quality_score = card.quality_score * 10.0
    components = {
        "regime": round(regime_score, 2),
        "data": round(data_score, 2),
        "context": round(context_score, 2),
        "lexical": round(lexical_score, 2),
        "risk": round(risk_score, 2),
        "quality": round(quality_score, 2),
    }
    return sum(components.values()), reasons, mismatches, components


def _query_terms(value: str) -> list[str]:
    normalized = value.lower().strip()
    terms = re.findall(r"[a-z][a-z0-9_-]{1,}|[0-9]+(?:h|m|d)", normalized)
    terms.extend(term for term in KNOWN_QUERY_TERMS if term in normalized)
    return list(dict.fromkeys(terms))


def _term_matches(term: str, searchable: str) -> bool:
    normalized = term.lower()
    if re.fullmatch(r"[a-z0-9_-]+", normalized):
        return bool(re.search(rf"(?<![a-z0-9_]){re.escape(normalized)}(?![a-z0-9_])", searchable))
    return normalized in searchable


def _seed_records() -> list[tuple[StrategyCard, StrategySource]]:
    now = datetime.now(timezone.utc).isoformat()
    records = [
        _seed(
            now,
            "ema-trend-following",
            "EMA Trend Following",
            ["EMA 趋势跟随", "moving average trend"],
            "trend_following",
            "使用快慢 EMA 与价格方向过滤参与持续趋势。",
            "趋势具有阶段性持续特征，均线排列用于降低逆势交易。",
            ["crypto_spot", "crypto_perpetual"],
            ["1h", "4h", "1d"],
            ["trending_up", "trending_down"],
            ["up", "down"],
            ["low", "medium", "high"],
            ["long", "short"],
            ["ohlcv"],
            ["EMA", "ATR"],
            "快 EMA 上穿慢 EMA 且价格方向一致时入场；反向条件用于做空。",
            "均线反向、ATR 止损或趋势结构破坏时退出。",
            ["atr_stop", "position_cap", "cooldown"],
            ["震荡市场反复交叉", "趋势末端回撤扩大"],
            "freqtrade",
            "Freqtrade Strategy Customization",
            "https://docs.freqtrade.io/en/stable/strategy-customization/",
        ),
        _seed(
            now,
            "rsi-bollinger-mean-reversion",
            "RSI Bollinger Mean Reversion",
            ["RSI 布林带均值回归", "bollinger reversal"],
            "mean_reversion",
            "结合 RSI 极值与布林带偏离捕捉区间回归。",
            "价格在稳定区间中过度偏离局部均值后可能回归，但必须限制趋势风险。",
            ["crypto_spot", "crypto_perpetual"],
            ["15m", "1h", "4h"],
            ["ranging", "weak_trend"],
            ["mixed", "up", "down"],
            ["low", "medium"],
            ["long", "short"],
            ["ohlcv"],
            ["RSI", "Bollinger Bands", "ATR"],
            "价格触及外轨且 RSI 进入极值区，等待反转确认后入场。",
            "回到中轨、达到时间止损或波动止损时退出。",
            ["atr_stop", "max_holding_period", "trend_filter"],
            ["强趋势中持续钝化", "波动扩张导致区间失效"],
            "freqtrade",
            "Freqtrade Strategy Customization",
            "https://docs.freqtrade.io/en/stable/strategy-customization/",
        ),
        _seed(
            now,
            "bollinger-directional-controller",
            "Bollinger Directional Controller",
            ["Bollinger V1", "布林带方向策略"],
            "mean_reversion",
            "使用布林带位置构建方向信号，并由执行控制器管理持仓。",
            "价格相对波动区间的位置可以表达短期偏离或方向强度。",
            ["crypto_spot", "crypto_perpetual"],
            ["1m", "5m", "15m", "1h"],
            ["ranging", "weak_trend"],
            ["mixed", "up", "down"],
            ["low", "medium"],
            ["long", "short"],
            ["ohlcv"],
            ["Bollinger Bands"],
            "根据价格在布林带区间中的归一化位置生成方向信号。",
            "信号反转、止损止盈或执行器时间限制触发退出。",
            ["stop_loss", "take_profit", "time_limit"],
            ["单边趋势导致反转失效", "窄带噪声产生频繁交易"],
            "hummingbot",
            "Hummingbot Directional Controllers",
            "https://hummingbot.org/strategies/v2-strategies/controllers/",
        ),
        _seed(
            now,
            "supertrend-directional-controller",
            "Supertrend Directional Controller",
            ["Supertrend V1", "超级趋势"],
            "trend_following",
            "使用 Supertrend 方向变化跟随趋势。",
            "ATR 自适应通道能将趋势方向与当前波动水平结合。",
            ["crypto_spot", "crypto_perpetual"],
            ["5m", "15m", "1h", "4h"],
            ["trending_up", "trending_down"],
            ["up", "down"],
            ["medium", "high"],
            ["long", "short"],
            ["ohlcv"],
            ["Supertrend", "ATR"],
            "Supertrend 翻转并满足方向过滤时入场。",
            "Supertrend 反向或风险阈值触发时退出。",
            ["atr_stop", "position_cap"],
            ["横盘阶段反复翻转", "跳空或急剧反转造成超预期损失"],
            "hummingbot",
            "Hummingbot Directional Controllers",
            "https://hummingbot.org/strategies/v2-strategies/controllers/",
        ),
        _seed(
            now,
            "grid-strike-market-making",
            "Grid Strike",
            ["网格做市", "grid strike controller"],
            "grid",
            "在限定价格区间布置分层订单，并根据持仓和边界管理执行。",
            "区间波动可以通过重复提供流动性和均值回归获得价差。",
            ["crypto_spot", "crypto_perpetual"],
            ["1m", "5m", "15m"],
            ["ranging"],
            ["mixed"],
            ["low", "medium"],
            ["long", "short"],
            ["orderbook", "trades", "ticker"],
            ["inventory", "spread", "grid levels"],
            "在配置区间和层级上挂出买卖订单，成交后补充对应层级。",
            "价格突破区间、库存超限或风险熔断时撤单退出。",
            ["inventory_limit", "price_bounds", "kill_switch"],
            ["单边突破形成库存风险", "手续费和逆向选择吞噬价差"],
            "hummingbot",
            "Hummingbot Grid Strike Controller",
            "https://hummingbot.org/strategies/v2-strategies/controllers/#other-controllers",
            risk_level="high",
        ),
        _seed(
            now,
            "dynamic-pure-market-making",
            "Dynamic Pure Market Making",
            ["PMM Dynamic", "动态做市"],
            "market_making",
            "依据波动和库存动态调整双边报价距离。",
            "做市收益来自买卖价差，但报价必须补偿库存风险和逆向选择。",
            ["crypto_spot", "crypto_perpetual"],
            ["1m", "5m"],
            ["ranging", "weak_trend"],
            ["mixed"],
            ["low", "medium"],
            ["long", "short"],
            ["orderbook", "trades", "ticker"],
            ["spread", "inventory skew", "volatility"],
            "围绕中间价动态放置双边限价单，并按库存偏斜调整报价。",
            "库存、损失或市场状态超过阈值时撤单并降低风险。",
            ["inventory_limit", "spread_floor", "kill_switch"],
            ["趋势市场库存累积", "低延迟竞争与逆向选择"],
            "hummingbot",
            "Hummingbot Market Making Controllers",
            "https://hummingbot.org/strategies/v2-strategies/controllers/",
            risk_level="high",
        ),
        _seed(
            now,
            "cross-exchange-market-making",
            "Cross-Exchange Market Making",
            ["XEMM", "跨交易所做市"],
            "cross_exchange_arbitrage",
            "在 maker 市场提供流动性，并在另一市场对冲成交风险。",
            "不同市场的流动性和费率差异可以覆盖对冲成本并形成价差收益。",
            ["crypto_spot", "crypto_perpetual"],
            ["1m", "5m"],
            ["ranging", "weak_trend", "trending_up", "trending_down"],
            ["mixed", "up", "down"],
            ["low", "medium", "high"],
            ["long", "short"],
            ["orderbook", "trades", "ticker", "multi_exchange_quotes"],
            ["cross-market spread", "hedge latency"],
            "在 maker 市场挂单，只有对冲市场报价能覆盖成本时才允许成交。",
            "maker 成交后立即对冲；价差、延迟或余额异常时停止。",
            ["hedge_limit", "latency_guard", "balance_guard"],
            ["对冲延迟", "交易所余额和转账风险", "价差瞬时消失"],
            "hummingbot",
            "Hummingbot XEMM Controller",
            "https://hummingbot.org/strategies/v2-strategies/controllers/#other-controllers",
            risk_level="high",
        ),
        _seed(
            now,
            "dual-thrust-breakout",
            "Dual Thrust Breakout",
            ["Dual Thrust", "双轨突破"],
            "breakout",
            "根据前一观察窗口的价格范围构建上下突破阈值。",
            "自适应历史振幅的突破边界可以识别日内方向扩张。",
            ["crypto_spot", "crypto_perpetual"],
            ["15m", "1h", "4h", "1d"],
            ["trending_up", "trending_down", "high_volatility_transition"],
            ["up", "down"],
            ["medium", "high"],
            ["long", "short"],
            ["ohlcv"],
            ["range", "breakout levels", "ATR"],
            "价格突破基于前窗振幅计算的上轨或下轨时入场。",
            "反向突破、ATR 止损或交易时段结束时退出。",
            ["atr_stop", "daily_loss_limit", "position_cap"],
            ["震荡市场假突破", "参数对观察窗口敏感"],
            "quantconnect",
            "Dual Thrust Trading Algorithm",
            "https://www.quantconnect.com/docs/v2/writing-algorithms/strategy-library",
        ),
        _seed(
            now,
            "cointegration-pairs-trading",
            "Cointegration Pairs Trading",
            ["协整配对交易", "statistical pairs"],
            "statistical_arbitrage",
            "交易两个长期协整资产之间标准化价差的偏离和回归。",
            "具有稳定长期关系的资产价差偏离后可能恢复，但关系会发生结构变化。",
            ["crypto_spot", "crypto_perpetual"],
            ["1h", "4h", "1d"],
            ["ranging", "weak_trend"],
            ["mixed"],
            ["low", "medium"],
            ["long", "short"],
            ["multi_asset_ohlcv"],
            ["cointegration", "z-score", "half-life"],
            "价差 z-score 超过阈值时做多相对低估资产并做空相对高估资产。",
            "价差回到均值、协整失效或最大持有期结束时退出。",
            ["cointegration_monitor", "max_holding_period", "pair_exposure_cap"],
            ["协整关系断裂", "两腿执行不同步", "借贷和资金费率侵蚀"],
            "quantconnect",
            "Pairs Trading: Copula vs Cointegration",
            "https://www.quantconnect.com/docs/v2/writing-algorithms/strategy-library",
        ),
        _seed(
            now,
            "momentum-mean-reversion-regime",
            "Momentum and Mean Reversion Regime Switch",
            ["动量均值回归切换", "regime switch"],
            "momentum",
            "按市场状态在动量和均值回归逻辑之间切换。",
            "趋势与震荡环境需要不同信号，状态识别可以降低单一策略的结构性失效。",
            ["crypto_spot", "crypto_perpetual"],
            ["1h", "4h", "1d"],
            ["ranging", "trending_up", "trending_down"],
            ["mixed", "up", "down"],
            ["low", "medium", "high"],
            ["long", "short"],
            ["ohlcv"],
            ["momentum", "z-score", "ADX", "ATR"],
            "ADX/趋势状态高时使用动量，低时使用偏离均值的反转信号。",
            "状态切换、信号反转或统一风险预算触发退出。",
            ["regime_hysteresis", "risk_budget", "atr_stop"],
            ["状态识别滞后", "频繁切换", "两个子策略同时失效"],
            "quantconnect",
            "Combining Mean Reversion and Momentum",
            "https://www.quantconnect.com/docs/v2/writing-algorithms/strategy-library",
        ),
        _seed(
            now,
            "funding-basis-carry",
            "Funding and Basis Carry",
            ["资金费率套利", "基差套利", "cash and carry"],
            "carry_basis_funding",
            "在现货与永续或期货之间构建近似市场中性头寸，获取资金费率或基差收敛。",
            "衍生品持仓需求会形成资金费率与现货基差，但收益必须覆盖交易、借贷和对冲成本。",
            ["crypto_perpetual"],
            ["1h", "4h", "1d"],
            ["ranging", "trending_up", "trending_down"],
            ["mixed", "up", "down"],
            ["low", "medium", "high"],
            ["long", "short"],
            ["spot_ticker", "futures_ticker", "funding_rate", "open_interest"],
            ["basis", "funding rate", "open interest"],
            "当预期资金费率或基差覆盖全部成本时，建立方向相反的现货与衍生品头寸。",
            "费率反转、基差收敛、保证金风险或收益低于成本阈值时退出。",
            ["delta_neutrality", "margin_buffer", "exchange_exposure_cap"],
            ["资金费率反转", "清算与保证金风险", "交易所和对冲腿风险"],
            "manual",
            "PaperForge Curated Funding Research",
            "https://www.bitget.com/api-doc/contract/market/Get-Current-Funding-Rate",
            risk_level="high",
        ),
        _seed(
            now,
            "cross-market-arbitrage-controller",
            "Cross-Market Arbitrage Controller",
            ["套利控制器", "arbitrage controller"],
            "cross_exchange_arbitrage",
            "比较两个市场的可成交价格，在净价差覆盖成本时同步执行两腿。",
            "同一资产在不同市场的短暂定价差异可以形成市场中性机会。",
            ["crypto_spot", "crypto_perpetual"],
            ["1m", "5m"],
            ["ranging", "weak_trend", "trending_up", "trending_down"],
            ["mixed", "up", "down"],
            ["low", "medium", "high"],
            ["long", "short"],
            ["orderbook", "multi_exchange_quotes", "fees"],
            ["executable spread", "fees", "latency"],
            "净可成交价差高于手续费、滑点和安全边际时同步建立两腿。",
            "价差消失、单腿失败或余额不足时停止并执行应急对冲。",
            ["atomicity_guard", "latency_guard", "balance_guard"],
            ["单腿成交风险", "延迟和滑点", "提现或交易所故障"],
            "hummingbot",
            "Hummingbot Arbitrage Controller",
            "https://hummingbot.org/strategies/v2-strategies/controllers/#other-controllers",
            risk_level="high",
        ),
    ]
    return records


def _seed(
    now: str,
    slug: str,
    name: str,
    aliases: list[str],
    family: str,
    summary: str,
    thesis: str,
    markets: list[str],
    timeframes: list[str],
    regimes: list[str],
    trends: list[str],
    volatility: list[str],
    directions: list[str],
    required_data: list[str],
    indicators: list[str],
    entry_logic: str,
    exit_logic: str,
    risk_controls: list[str],
    failure_modes: list[str],
    provider: str,
    source_title: str,
    source_url: str,
    *,
    risk_level: str = "medium",
) -> tuple[StrategyCard, StrategySource]:
    card_id = f"strategy-card-{slug}"
    source_id = f"strategy-source-{slug}"
    source = StrategySource(
        id=source_id,
        strategy_card_id=card_id,
        provider=provider,
        source_type="manual" if provider == "manual" else "documentation",
        title=source_title,
        source_url=source_url,
        source_version="reviewed-2026-06-20",
        license="unknown",
        attribution_required=True,
        retrieved_at=now,
        content_hash=hashlib.sha256(f"{source_title}|{source_url}".encode()).hexdigest(),
    )
    card = StrategyCard(
        id=card_id,
        name=name,
        aliases=aliases,
        family=family,
        summary=summary,
        thesis=thesis,
        markets=markets,
        timeframes=timeframes,
        regimes=regimes,
        trends=trends,
        volatility=volatility,
        directions=directions,
        required_data=required_data,
        optional_data=[],
        indicators=indicators,
        entry_logic=entry_logic,
        exit_logic=exit_logic,
        risk_controls=risk_controls,
        parameters=[],
        failure_modes=failure_modes,
        validation_requirements=[
            "lookahead_check",
            "out_of_sample",
            "fee_slippage_sensitivity",
        ],
        risk_level=risk_level,
        implementation_compatibility="adaptable",
        status="published",
        quality_score=0.8 if provider != "manual" else 0.72,
        source_ids=[source_id],
        created_at=now,
        updated_at=now,
    )
    return card, source


strategy_library_store = StrategyLibraryStore()
