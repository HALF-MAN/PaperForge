from __future__ import annotations

import os
import ssl
import unittest
from unittest.mock import patch

from agent_runtime.crypto_research_clients import (
    _request_json,
    get_cmc_asset_profile,
    get_cmc_global_market,
    get_coin_metrics_onchain,
    get_mempool_network_state,
)


class CryptoResearchClientsTest(unittest.TestCase):
    def setUp(self) -> None:
        os.environ.pop("CMC_API_KEY", None)

    @patch("agent_runtime.crypto_research_clients._cmc_request")
    def test_asset_profile_selects_ranked_native_asset(self, request) -> None:
        request.return_value = {
            "data": [
                {
                    "id": 999,
                    "name": "BTC Token",
                    "symbol": "BTC",
                    "is_active": 1,
                    "cmc_rank": 3000,
                    "platform": {"symbol": "ETH"},
                    "quote": [{"symbol": "USD", "price": "0.1"}],
                },
                {
                    "id": 1,
                    "name": "Bitcoin",
                    "symbol": "BTC",
                    "slug": "bitcoin",
                    "is_active": 1,
                    "cmc_rank": 1,
                    "platform": None,
                    "circulating_supply": "20000000",
                    "quote": [{"symbol": "USD", "price": "63000", "market_cap": "1.2e12"}],
                },
            ]
        }

        result = get_cmc_asset_profile("btc")

        self.assertEqual(result["id"], 1)
        self.assertEqual(result["priceUsd"], 63000.0)
        self.assertEqual(result["source"], "coinmarketcap_keyless")

    @patch("agent_runtime.crypto_research_clients._cmc_request")
    def test_global_market_combines_sentiment(self, request) -> None:
        request.side_effect = [
            {
                "data": {
                    "btc_dominance": "58.2",
                    "eth_dominance": "9.8",
                    "quote": {"USD": {"total_market_cap": "2.1e12", "total_volume_24h": "8e10"}},
                }
            },
            {"data": [{"value": "34", "value_classification": "Fear", "timestamp": "now"}]},
        ]

        result = get_cmc_global_market()

        self.assertEqual(result["btcDominancePct"], 58.2)
        self.assertEqual(result["fearAndGreed"]["value"], 34.0)

    @patch("agent_runtime.crypto_research_clients._request_json")
    def test_onchain_metrics_tolerate_partial_coverage(self, request) -> None:
        request.return_value = {
            "data": [
                {"asset": "btc", "time": "2026-06-18", "AdrActCnt": "750000", "TxCnt": "400000"},
                {"asset": "btc", "time": "2026-06-17", "AdrActCnt": "730000", "TxCnt": None},
            ]
        }

        result = get_coin_metrics_onchain("btc", 2)

        self.assertEqual(result["latest"]["AdrActCnt"], 750000.0)
        self.assertIsNone(result["history"][1]["TxCnt"])
        params = request.call_args.args[1]
        self.assertNotIn("sort", params)
        self.assertIn("start_time", params)

    @patch("agent_runtime.crypto_research_clients._request_json")
    def test_mempool_state_combines_backlog_and_fees(self, request) -> None:
        request.side_effect = [
            {"count": 1000, "vsize": 2000000, "total_fee": 300000},
            {"fastestFee": 5, "halfHourFee": 3, "hourFee": 2, "economyFee": 1, "minimumFee": 1},
        ]

        result = get_mempool_network_state()

        self.assertEqual(result["mempool"]["transactionCount"], 1000)
        self.assertEqual(result["recommendedFeesSatVb"]["fastest"], 5)

    @patch("agent_runtime.crypto_research_clients.urllib.request.urlopen")
    def test_http_client_uses_explicit_ca_context(self, urlopen) -> None:
        response = urlopen.return_value.__enter__.return_value
        response.read.return_value = b'{"ok": true}'

        result = _request_json("https://example.test/data")

        self.assertTrue(result["ok"])
        context = urlopen.call_args.kwargs["context"]
        self.assertIsInstance(context, ssl.SSLContext)


if __name__ == "__main__":
    unittest.main()
