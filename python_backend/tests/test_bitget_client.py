from __future__ import annotations

import unittest
from unittest.mock import patch

from agent_runtime.bitget_client import (
    BitgetApiClient,
    _date_to_timestamp_ms,
    fetch_bitget_candles_for_backtest,
)


class BitgetBacktestRangeTest(unittest.TestCase):
    def test_get_candles_sends_requested_time_range(self) -> None:
        client = BitgetApiClient()
        with patch.object(client, "_request", return_value=[]) as request:
            client.get_candles(
                "BTCUSDT",
                "4h",
                300,
                start_time=1704067200000,
                end_time=1735689599999,
            )

        params = request.call_args.kwargs["params"]
        self.assertEqual(params["startTime"], "1704067200000")
        self.assertEqual(params["endTime"], "1735689599999")

    @patch("agent_runtime.bitget_client.BitgetApiClient.get_candles")
    def test_backtest_fetch_forwards_dates(self, get_candles) -> None:
        get_candles.return_value = []

        fetch_bitget_candles_for_backtest(
            "BTCUSDT",
            "1day",
            300,
            start_date="2024-01-01",
            end_date="2024-12-31",
        )

        kwargs = get_candles.call_args.kwargs
        self.assertEqual(kwargs["start_time"], _date_to_timestamp_ms("2024-01-01"))
        self.assertEqual(
            kwargs["end_time"],
            _date_to_timestamp_ms("2024-12-31", end_of_day=True),
        )


if __name__ == "__main__":
    unittest.main()
