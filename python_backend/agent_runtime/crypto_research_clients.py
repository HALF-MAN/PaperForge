from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

import certifi


CMC_BASE_URL = "https://pro-api.coinmarketcap.com"
COIN_METRICS_COMMUNITY_URL = "https://community-api.coinmetrics.io/v4"
MEMPOOL_SPACE_URL = "https://mempool.space/api"


def get_cmc_asset_profile(symbol: str = "BTC") -> dict[str, Any]:
    normalized_symbol = symbol.upper().strip()
    payload = _cmc_request(
        "/v3/cryptocurrency/quotes/latest",
        {"symbol": normalized_symbol, "convert": "USD"},
    )
    candidates = payload.get("data") or []
    if isinstance(candidates, dict):
        candidates = list(candidates.values())
    if not candidates:
        raise ValueError(f"CoinMarketCap asset not found: {normalized_symbol}")

    active_candidates = [item for item in candidates if item.get("is_active") == 1]
    ranked_candidates = active_candidates or candidates
    asset = min(
        ranked_candidates,
        key=lambda item: (
            item.get("platform") is not None,
            item.get("cmc_rank") is None,
            item.get("cmc_rank") or 10**9,
        ),
    )
    quote = _usd_quote(asset.get("quote"))
    return {
        "success": True,
        "source": "coinmarketcap_keyless" if not os.getenv("CMC_API_KEY") else "coinmarketcap_pro",
        "observedAt": quote.get("last_updated") or asset.get("last_updated") or _utc_now(),
        "id": asset.get("id"),
        "name": asset.get("name"),
        "symbol": asset.get("symbol"),
        "slug": asset.get("slug"),
        "rank": asset.get("cmc_rank"),
        "priceUsd": _number(quote.get("price")),
        "marketCapUsd": _number(quote.get("market_cap")),
        "fullyDilutedMarketCapUsd": _number(quote.get("fully_diluted_market_cap")),
        "marketCapDominancePct": _number(quote.get("market_cap_dominance")),
        "volume24hUsd": _number(quote.get("volume_24h")),
        "percentChange24h": _number(quote.get("percent_change_24h")),
        "percentChange7d": _number(quote.get("percent_change_7d")),
        "percentChange30d": _number(quote.get("percent_change_30d")),
        "circulatingSupply": _number(asset.get("circulating_supply")),
        "totalSupply": _number(asset.get("total_supply")),
        "maxSupply": _number(asset.get("max_supply")),
        "marketPairs": asset.get("num_market_pairs"),
        "platform": asset.get("platform"),
        "tags": [tag.get("name") for tag in asset.get("tags", []) if tag.get("name")][:12],
    }


def get_cmc_global_market() -> dict[str, Any]:
    market_payload = _cmc_request("/v1/global-metrics/quotes/latest", {"convert": "USD"})
    fear_payload = _cmc_request("/v3/fear-and-greed/latest", {})
    market = market_payload.get("data") or {}
    quote = _usd_quote(market.get("quote"))
    fear_data = fear_payload.get("data") or []
    fear = fear_data[0] if isinstance(fear_data, list) and fear_data else fear_data
    return {
        "success": True,
        "source": "coinmarketcap_keyless" if not os.getenv("CMC_API_KEY") else "coinmarketcap_pro",
        "observedAt": market.get("last_updated") or _utc_now(),
        "totalMarketCapUsd": _number(quote.get("total_market_cap")),
        "totalVolume24hUsd": _number(quote.get("total_volume_24h")),
        "btcDominancePct": _number(market.get("btc_dominance")),
        "ethDominancePct": _number(market.get("eth_dominance")),
        "activeCryptocurrencies": market.get("active_cryptocurrencies"),
        "activeExchanges": market.get("active_exchanges"),
        "fearAndGreed": {
            "value": _number(fear.get("value")) if isinstance(fear, dict) else None,
            "classification": fear.get("value_classification") if isinstance(fear, dict) else None,
            "updatedAt": fear.get("update_time") or fear.get("timestamp") if isinstance(fear, dict) else None,
        },
    }


def get_coin_metrics_onchain(asset: str = "btc", days: int = 7) -> dict[str, Any]:
    normalized_asset = asset.lower().strip()
    normalized_days = max(1, min(int(days), 30))
    metrics = [
        "AdrActCnt",
        "TxCnt",
        "TxTfrValAdjUSD",
        "FeeTotUSD",
        "SplyCur",
        "CapMVRVCur",
        "NVTAdj",
    ]
    if normalized_asset == "btc":
        metrics.append("HashRate")
    payload = _request_json(
        f"{COIN_METRICS_COMMUNITY_URL}/timeseries/asset-metrics",
        {
            "assets": normalized_asset,
            "metrics": ",".join(metrics),
            "frequency": "1d",
            "start_time": (datetime.now(timezone.utc) - timedelta(days=normalized_days + 1)).date().isoformat(),
            "page_size": str(normalized_days + 1),
            "ignore_unsupported_errors": "true",
            "ignore_forbidden_errors": "true",
        },
    )
    rows = sorted(
        payload.get("data") or [],
        key=lambda row: str(row.get("time") or ""),
        reverse=True,
    )[:normalized_days]
    if not rows:
        raise ValueError(f"Coin Metrics community data unavailable for {normalized_asset}")
    latest = rows[0]
    return {
        "success": True,
        "source": "coin_metrics_community",
        "asset": normalized_asset,
        "observedAt": latest.get("time") or _utc_now(),
        "frequency": "1d",
        "latest": {metric: _number(latest.get(metric)) for metric in metrics if metric in latest},
        "history": [
            {
                "time": row.get("time"),
                **{metric: _number(row.get(metric)) for metric in metrics if metric in row},
            }
            for row in rows
        ],
        "limitations": "Community data is daily, rate-limited, and licensed for non-commercial use.",
    }


def get_mempool_network_state() -> dict[str, Any]:
    mempool = _request_json(f"{MEMPOOL_SPACE_URL}/mempool")
    fees = _request_json(f"{MEMPOOL_SPACE_URL}/v1/fees/recommended")
    return {
        "success": True,
        "source": "mempool_space",
        "asset": "btc",
        "observedAt": _utc_now(),
        "mempool": {
            "transactionCount": mempool.get("count"),
            "virtualSizeBytes": mempool.get("vsize"),
            "totalFeesSats": mempool.get("total_fee"),
        },
        "recommendedFeesSatVb": {
            "fastest": fees.get("fastestFee"),
            "halfHour": fees.get("halfHourFee"),
            "hour": fees.get("hourFee"),
            "economy": fees.get("economyFee"),
            "minimum": fees.get("minimumFee"),
        },
    }


def _cmc_request(path: str, params: dict[str, Any]) -> dict[str, Any]:
    api_key = os.getenv("CMC_API_KEY", "").strip()
    prefix = "" if api_key else "/trial-pro-api"
    headers = {"Accept": "application/json"}
    if api_key:
        headers["X-CMC_PRO_API_KEY"] = api_key
    return _request_json(f"{CMC_BASE_URL}{prefix}{path}", params, headers=headers)


def _request_json(
    url: str,
    params: dict[str, Any] | None = None,
    *,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    query = urllib.parse.urlencode(params or {})
    request_url = f"{url}?{query}" if query else url
    request = urllib.request.Request(
        request_url,
        headers={"User-Agent": "PaperForge/0.1", **(headers or {})},
    )
    try:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        with urllib.request.urlopen(request, timeout=20, context=ssl_context) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")[:500]
        raise ValueError(f"Research API returned HTTP {error.code}: {body}") from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise ValueError(f"Research API request failed: {error}") from error


def _usd_quote(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        return next((item for item in value if item.get("symbol") == "USD"), value[0] if value else {})
    if isinstance(value, dict):
        return value.get("USD") or value
    return {}


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
