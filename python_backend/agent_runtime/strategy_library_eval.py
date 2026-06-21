from __future__ import annotations

from typing import Any

from agent_runtime.models import StrategySearchQuery
from agent_runtime.strategy_library_store import StrategyLibraryStore


STRATEGY_LIBRARY_EVAL_CASES: list[dict[str, Any]] = [
    {
        "name": "ranging RSI reversal",
        "query": {"query": "震荡 RSI 反转", "market": "crypto_perpetual", "timeframe": "4h", "regime": "ranging", "available_data": ["ohlcv"]},
        "expected_ids": {"strategy-card-rsi-bollinger-mean-reversion"},
    },
    {
        "name": "EMA trend",
        "query": {"query": "EMA 趋势", "market": "crypto_spot", "timeframe": "1d", "regime": "trending_up", "trend": "up", "available_data": ["ohlcv"]},
        "expected_ids": {"strategy-card-ema-trend-following"},
    },
    {
        "name": "supertrend",
        "query": {"query": "Supertrend 高波动趋势", "market": "crypto_perpetual", "timeframe": "1h", "regime": "trending_down", "trend": "down", "volatility": "high", "available_data": ["ohlcv"]},
        "expected_ids": {"strategy-card-supertrend-directional-controller"},
    },
    {
        "name": "dual thrust breakout",
        "query": {"query": "Dual Thrust 突破", "market": "crypto_perpetual", "timeframe": "1h", "regime": "high_volatility_transition", "available_data": ["ohlcv"]},
        "expected_ids": {"strategy-card-dual-thrust-breakout"},
    },
    {
        "name": "bollinger directional",
        "query": {"query": "Bollinger 方向控制器", "market": "crypto_perpetual", "timeframe": "15m", "regime": "ranging", "available_data": ["ohlcv"]},
        "expected_ids": {"strategy-card-bollinger-directional-controller"},
    },
    {
        "name": "grid",
        "query": {"query": "震荡网格", "market": "crypto_spot", "timeframe": "5m", "regime": "ranging", "available_data": ["orderbook", "trades", "ticker"]},
        "expected_ids": {"strategy-card-grid-strike-market-making"},
    },
    {
        "name": "dynamic market making",
        "query": {"query": "动态做市 inventory", "market": "crypto_spot", "timeframe": "1m", "regime": "ranging", "available_data": ["orderbook", "trades", "ticker"]},
        "expected_ids": {"strategy-card-dynamic-pure-market-making"},
    },
    {
        "name": "cross exchange market making",
        "query": {"query": "XEMM 跨交易所做市", "market": "crypto_spot", "timeframe": "1m", "available_data": ["orderbook", "trades", "ticker", "multi_exchange_quotes"]},
        "expected_ids": {"strategy-card-cross-exchange-market-making"},
    },
    {
        "name": "cross market arbitrage",
        "query": {"query": "跨交易所套利", "market": "crypto_spot", "timeframe": "1m", "available_data": ["orderbook", "multi_exchange_quotes", "fees"]},
        "expected_ids": {"strategy-card-cross-market-arbitrage-controller"},
    },
    {
        "name": "cointegration",
        "query": {"query": "协整 pairs 配对交易", "market": "crypto_perpetual", "timeframe": "4h", "regime": "ranging", "available_data": ["multi_asset_ohlcv"]},
        "expected_ids": {"strategy-card-cointegration-pairs-trading"},
    },
    {
        "name": "regime switch",
        "query": {"query": "动量和均值回归状态切换", "market": "crypto_perpetual", "timeframe": "4h", "available_data": ["ohlcv"]},
        "expected_ids": {"strategy-card-momentum-mean-reversion-regime"},
    },
    {
        "name": "funding carry",
        "query": {"query": "资金费率 基差 carry", "market": "crypto_perpetual", "timeframe": "4h", "available_data": ["spot_ticker", "futures_ticker", "funding_rate", "open_interest"]},
        "expected_ids": {"strategy-card-funding-basis-carry"},
    },
    {
        "name": "low volatility range",
        "query": {"query": "低波动震荡反转", "market": "crypto_spot", "timeframe": "1h", "regime": "ranging", "volatility": "low", "available_data": ["ohlcv"]},
        "expected_families": {"mean_reversion"},
    },
    {
        "name": "high volatility breakout",
        "query": {"query": "高波动突破", "market": "crypto_perpetual", "timeframe": "1h", "regime": "high_volatility_transition", "volatility": "high", "available_data": ["ohlcv"]},
        "expected_families": {"breakout", "trend_following"},
    },
    {
        "name": "daily long trend",
        "query": {"query": "日线多头趋势", "market": "crypto_spot", "timeframe": "1d", "regime": "trending_up", "trend": "up", "direction": "long", "available_data": ["ohlcv"]},
        "expected_families": {"trend_following"},
    },
    {
        "name": "perpetual short trend",
        "query": {"query": "永续空头趋势", "market": "crypto_perpetual", "timeframe": "4h", "regime": "trending_down", "trend": "down", "direction": "short", "available_data": ["ohlcv"]},
        "expected_families": {"trend_following", "breakout"},
    },
    {
        "name": "balanced range",
        "query": {"query": "平衡风险震荡策略", "market": "crypto_spot", "timeframe": "4h", "regime": "ranging", "risk_tolerance": "balanced", "available_data": ["ohlcv"]},
        "expected_families": {"mean_reversion", "momentum"},
    },
    {
        "name": "only OHLCV",
        "query": {"query": "只使用 OHLCV 的策略", "market": "crypto_perpetual", "timeframe": "1h", "available_data": ["ohlcv"]},
        "forbidden_families": {"market_making", "grid", "cross_exchange_arbitrage"},
    },
    {
        "name": "no orderbook market making",
        "query": {"query": "做市策略", "market": "crypto_spot", "timeframe": "1h", "available_data": ["ohlcv"]},
        "forbidden_families": {"market_making", "grid", "cross_exchange_arbitrage"},
    },
    {
        "name": "conservative excludes high risk",
        "query": {"query": "保守型震荡策略", "market": "crypto_spot", "timeframe": "1h", "regime": "ranging", "risk_tolerance": "conservative", "available_data": ["ohlcv"]},
        "forbidden_top_ids": {"strategy-card-dynamic-pure-market-making", "strategy-card-grid-strike-market-making"},
    },
]


def evaluate_strategy_library(store: StrategyLibraryStore) -> dict[str, Any]:
    passed = 0
    details: list[dict[str, Any]] = []
    for case in STRATEGY_LIBRARY_EVAL_CASES:
        result = store.search(StrategySearchQuery.model_validate(case["query"]))
        candidates = result["results"]
        top_ids = {item["id"] for item in candidates[:3]}
        top_families = {item["family"] for item in candidates[:3]}
        all_families = {item["family"] for item in candidates}
        success = True
        if case.get("expected_ids"):
            success = bool(top_ids & set(case["expected_ids"]))
        if case.get("expected_families"):
            success = success and bool(top_families & set(case["expected_families"]))
        if case.get("forbidden_families"):
            success = success and not bool(all_families & set(case["forbidden_families"]))
        if case.get("forbidden_top_ids"):
            success = success and not bool(top_ids & set(case["forbidden_top_ids"]))
        passed += int(success)
        details.append(
            {
                "name": case["name"],
                "passed": success,
                "topIds": [item["id"] for item in candidates[:3]],
            }
        )
    total = len(STRATEGY_LIBRARY_EVAL_CASES)
    return {
        "passed": passed,
        "total": total,
        "passRate": round(passed / total, 4) if total else 0.0,
        "details": details,
    }
