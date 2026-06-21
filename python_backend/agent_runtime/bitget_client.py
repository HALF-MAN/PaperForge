"""
Bitget API Client for Strategy Lab
提供真实市场数据获取功能

使用 urllib（Python内置）代替 requests，避免依赖问题
"""

from __future__ import annotations

import time
import hmac
import hashlib
import base64
import urllib.request
import urllib.error
import json
import ssl
from datetime import datetime, timedelta, timezone
from typing import Any


class BitgetApiClient:
    """Bitget API客户端（支持公共数据和私有数据）"""

    BASE_URL = "https://api.bitget.com"

    def __init__(
        self,
        api_key: str | None = None,
        secret_key: str | None = None,
        passphrase: str | None = None,
    ):
        self.api_key = api_key
        self.secret_key = secret_key
        self.passphrase = passphrase

    def _sign(self, timestamp: str, method: str, path: str, body: str = "") -> str:
        """生成API签名（私有接口需要）"""
        if not self.secret_key:
            raise ValueError("Secret key required for private API")

        message = f"{timestamp}{method.upper()}{path}{body}"
        mac = hmac.new(
            self.secret_key.encode(),
            message.encode(),
            hashlib.sha256,
        )
        return base64.b64encode(mac.digest()).decode()

    def _headers(self, method: str, path: str, body: str = "") -> dict[str, str]:
        """生成请求头"""
        timestamp = str(int(time.time() * 1000))

        headers = {
            "Content-Type": "application/json",
            "ACCESS-KEY": self.api_key or "",
            "ACCESS-SIGN": self._sign(timestamp, method, path, body) if self.secret_key else "",
            "ACCESS-TIMESTAMP": timestamp,
            "ACCESS-PASSPHRASE": self.passphrase or "",
        }

        # 公共接口不需要认证
        if not self.api_key:
            headers = {"Content-Type": "application/json"}

        return headers

    def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """发送HTTP请求（使用urllib）"""
        url = f"{self.BASE_URL}{path}"

        # 构建query参数
        if params:
            query_string = "&".join(f"{k}={v}" for k, v in params.items())
            url = f"{url}?{query_string}"

        headers = self._headers(
            method,
            path,
            body=json.dumps(body) if body else "",
        )

        try:
            request_data = None
            if method.upper() == "POST" and body:
                request_data = json.dumps(body).encode("utf-8")

            req = urllib.request.Request(
                url,
                data=request_data,
                headers=headers,
                method=method.upper(),
            )

            # 创建SSL context（忽略证书验证，用于开发环境）
            # 生产环境应该正确配置SSL证书
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

            with urllib.request.urlopen(req, timeout=10, context=ssl_context) as response:
                response_data = response.read().decode("utf-8")
                data = json.loads(response_data)

                if data.get("code") != "00000":
                    raise ValueError(f"Bitget API error: {data.get('msg')}")

                return data.get("data", {})

        except urllib.error.URLError as error:
            raise ValueError(f"Bitget request failed: {error}")
        except json.JSONDecodeError as error:
            raise ValueError(f"Bitget response parse failed: {error}")

    # === 公共接口（无需认证） ===

    def get_ticker(self, symbol: str = "BTCUSDT") -> dict[str, Any]:
        """获取Ticker数据"""
        data = self._request("GET", "/api/v2/spot/market/tickers", params={"symbol": symbol})

        if not data:
            raise ValueError(f"Ticker not found for {symbol}")

        ticker = data[0]
        return {
            "symbol": ticker.get("symbol"),
            "last": float(ticker.get("lastPr", 0)),
            "high24h": float(ticker.get("high24h", 0)),
            "low24h": float(ticker.get("low24h", 0)),
            "volume24h": float(ticker.get("quoteVolume", 0)),
            "timestamp": ticker.get("ts"),
        }

    def get_candles(
        self,
        symbol: str = "BTCUSDT",
        granularity: str = "1day",  # Bitget API格式：1min, 5min, 15min, 30min, 1h, 4h, 6h, 12h, 1day, 1week, 1M
        limit: int = 300,
        start_time: int | None = None,
        end_time: int | None = None,
    ) -> list[dict[str, Any]]:
        """
        获取K线数据（用于回测）

        Args:
            symbol: 交易对符号
            granularity: K线周期（1min, 5min, 15min, 30min, 1h, 4h, 6h, 12h, 1day, 1week, 1M）
            limit: 数据条数（最大1000）

        Returns:
            list of candles: [{ts, open, high, low, close, volume}]
        """
        params = {
            "symbol": symbol,
            "granularity": granularity,
            "limit": str(min(limit, 1000)),
        }
        if start_time is not None:
            params["startTime"] = str(start_time)
        if end_time is not None:
            params["endTime"] = str(end_time)

        data = self._request("GET", "/api/v2/spot/market/candles", params=params)

        candles = []
        for row in data:
            # Bitget返回格式: [ts, open, high, low, close, baseVolume, quoteVolume]
            candles.append({
                "timestamp": int(row[0]),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]),
            })

        # 按时间升序排列
        candles.sort(key=lambda x: x["timestamp"])

        return candles

    # === 私有接口（需要认证） ===

    def get_balance(self) -> list[dict[str, Any]]:
        """获取账户余额"""
        if not self.api_key:
            raise ValueError("API key required for private endpoints")

        data = self._request("GET", "/api/v2/spot/account/assets")

        return [
            {
                "coin": item.get("coin"),
                "available": float(item.get("available", 0)),
                " frozen": float(item.get("frozen", 0)),
                "total": float(item.get("total", 0)),
            }
            for item in data
        ]


def fetch_bitget_candles_for_backtest(
    symbol: str = "BTCUSDT",
    granularity: str = "1day",  # Bitget API格式：使用1day而不是1D
    limit: int = 300,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict[str, Any]]:
    """
    获取Bitget K线数据用于回测

    这个函数会被 sandbox_executor 调用
    """
    client = BitgetApiClient()  # 公共接口不需要认证

    try:
        candles = client.get_candles(
            symbol,
            granularity,
            limit,
            start_time=_date_to_timestamp_ms(start_date) if start_date else None,
            end_time=(
                _date_to_timestamp_ms(end_date, end_of_day=True)
                if end_date
                else None
            ),
        )

        # 转换为DataFrame格式（与sandbox_executor兼容）
        formatted = []
        for candle in candles:
            formatted.append({
                "date": datetime.fromtimestamp(
                    candle["timestamp"] / 1000,
                    tz=timezone.utc,
                ).strftime("%Y-%m-%d"),
                "open": candle["open"],
                "high": candle["high"],
                "low": candle["low"],
                "close": candle["close"],
                "volume": candle["volume"],
            })

        return formatted

    except Exception as error:
        print(f"⚠️  Bitget API failed, fallback to mock data: {error}")
        return []


def _date_to_timestamp_ms(value: str, *, end_of_day: bool = False) -> int:
    parsed = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    if end_of_day:
        parsed = parsed + timedelta(days=1) - timedelta(milliseconds=1)
    return int(parsed.timestamp() * 1000)


if __name__ == "__main__":
    # 测试
    candles = fetch_bitget_candles_for_backtest("BTCUSDT", "1day", 100)
    print(f"✅ Fetched {len(candles)} candles from Bitget")
    print(f"First candle: {candles[0] if candles else 'None'}")
    print(f"Last candle: {candles[-1] if candles else 'None'}")
