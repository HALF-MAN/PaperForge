from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from agent_runtime.memory_store import memory_store


# === 技术指标计算 ===


def calculate_ema(values: List[float], period: int) -> List[float]:
    """
    计算指数移动平均线 (EMA)

    Args:
        values: 价格数据列表
        period: EMA 周期

    Returns:
        EMA 值列表
    """
    if len(values) < period:
        return []

    # EMA = (Price - Previous EMA) * multiplier + Previous EMA
    multiplier = 2 / (period + 1)

    # 初始 SMA
    sma = sum(values[:period]) / period
    ema_values = [sma]

    # 计算 EMA
    for i in range(period, len(values)):
        ema = (values[i] - ema_values[-1]) * multiplier + ema_values[-1]
        ema_values.append(ema)

    return ema_values


def calculate_rsi(values: List[float], period: int = 14) -> List[float]:
    """
    计算相对强弱指数 (RSI)

    Args:
        values: 价格数据列表
        period: RSI 周期（默认 14）

    Returns:
        RSI 值列表（0-100）
    """
    if len(values) < period + 1:
        return []

    # 计算价格变化
    deltas = [values[i] - values[i - 1] for i in range(1, len(values))]

    # 分离上涨和下跌
    gains = [delta if delta > 0 else 0 for delta in deltas]
    losses = [-delta if delta < 0 else 0 for delta in deltas]

    # 计算平均上涨和下跌
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    rsi_values = []

    # 初始 RSI
    if avg_loss == 0:
        rsi = 100
    else:
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
    rsi_values.append(rsi)

    # 计算后续 RSI（使用平滑平均）
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

        if avg_loss == 0:
            rsi = 100
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))
        rsi_values.append(rsi)

    return rsi_values


# === 可直接调用的函数（供 Flow 使用） ===


def fetch_market_data(symbol: str, timeframe: str = "1h", limit: int = 100) -> Dict[str, Any]:
    """
    获取市场数据（K线数据）

    Args:
        symbol: 交易对符号，如 BTCUSDT
        timeframe: 时间周期，如 1h, 4h, 1d
        limit: 数据条数限制

    Returns:
        包含 K线数据的字典
    """
    # 简化实现：生成 Mock 数据（后续可替换为真实 API）
    base_price = 68000 if symbol.startswith("BTC") else 3600
    candles = []

    current_time = datetime.now()
    for i in range(limit):
        # 生成随机价格波动（模拟市场趋势）
        trend_factor = 1.0 + (i / limit) * 0.05  # 轻微上升趋势
        change_pct = random.uniform(-0.02, 0.02)

        open_price = base_price * trend_factor * (1 + random.uniform(-0.01, 0.01))
        close_price = open_price * (1 + change_pct)
        high_price = max(open_price, close_price) * (1 + random.uniform(0, 0.005))
        low_price = min(open_price, close_price) * (1 - random.uniform(0, 0.005))
        volume = random.uniform(100, 1000)

        candles.append(
            {
                "ts": (current_time - timedelta(hours=i)).isoformat(),
                "open": round(open_price, 2),
                "high": round(high_price, 2),
                "low": round(low_price, 2),
                "close": round(close_price, 2),
                "baseVolume": round(volume, 2),
            }
        )

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "candles": candles,
        "count": len(candles),
    }


def run_backtest(strategy_spec: Dict[str, Any], market_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    执行策略回测

    Args:
        strategy_spec: 策略规格（StrategySpec）
        market_data: 市场数据（包含 candles）

    Returns:
        回测报告（BacktestReport）
    """
    candles = market_data.get("candles", [])
    if not candles:
        return {
            "total_return_pct": 0.0,
            "max_drawdown_pct": 0.0,
            "win_rate_pct": 0.0,
            "trade_count": 0,
            "profit_factor": 0.0,
            "average_trade_pct": 0.0,
        }

    # 提取收盘价（按时间正序）
    closes = [candle["close"] for candle in reversed(candles)]

    # 计算 EMA
    ema20 = calculate_ema(closes, 20)
    ema60 = calculate_ema(closes, 60)

    # 模拟交易（EMA 趋势策略）
    initial_balance = 10000
    balance = initial_balance
    max_balance = initial_balance
    min_balance = initial_balance
    position = 0
    entry_price = 0
    trades = []
    wins = 0

    # EMA 趋势策略回测
    for i in range(min(len(ema20), len(ema60))):
        if i < 20:  # 确保 EMA20 有足够数据
            continue

        ema20_val = ema20[i] if i < len(ema20) else None
        ema60_val = ema60[i] if i < len(ema60) else None

        if ema20_val and ema60_val and i + 20 < len(closes):
            current_price = closes[i + 20]

            # 买入信号：EMA20 上穿 EMA60
            if ema20_val > ema60_val and position == 0:
                position = 0.1  # 10% 仓位
                entry_price = current_price

            # 卖出信号：EMA20 下穿 EMA60
            elif ema20_val < ema60_val and position > 0:
                exit_price = current_price
                profit_pct = (exit_price - entry_price) / entry_price * 100

                balance *= (1 + profit_pct * position)
                trades.append(profit_pct)
                if profit_pct > 0:
                    wins += 1

                max_balance = max(max_balance, balance)
                min_balance = min(min_balance, balance)
                position = 0

    # 如果还有持仓，按最后价格平仓
    if position > 0 and len(closes) > 0:
        exit_price = closes[-1]
        profit_pct = (exit_price - entry_price) / entry_price * 100
        balance *= (1 + profit_pct * position)
        trades.append(profit_pct)
        if profit_pct > 0:
            wins += 1
        max_balance = max(max_balance, balance)
        min_balance = min(min_balance, balance)

    # 计算指标
    total_return_pct = (balance - initial_balance) / initial_balance * 100
    max_drawdown_pct = (max_balance - min_balance) / max_balance * 100 if max_balance > 0 else 0
    win_rate_pct = wins / len(trades) * 100 if trades else 0
    trade_count = len(trades)

    # 计算 profit factor
    profits = [t for t in trades if t > 0]
    losses = [abs(t) for t in trades if t < 0]
    profit_factor = sum(profits) / sum(losses) if losses else 0

    average_trade_pct = sum(trades) / len(trades) if trades else 0

    return {
        "total_return_pct": round(total_return_pct, 2),
        "max_drawdown_pct": round(max_drawdown_pct, 2),
        "win_rate_pct": round(win_rate_pct, 2),
        "trade_count": trade_count,
        "profit_factor": round(profit_factor, 2),
        "average_trade_pct": round(average_trade_pct, 2),
    }


def score_risk(strategy_spec: Dict[str, Any], backtest_report: Dict[str, Any]) -> Dict[str, Any]:
    """
    计算风控评分

    Args:
        strategy_spec: 策略规格
        backtest_report: 回测报告

    Returns:
        风控报告（RiskReport）
    """
    issues = []
    recommendations = []
    score = 100.0

    # 检查回撤
    max_drawdown = backtest_report.get("max_drawdown_pct", 0)
    if max_drawdown > 10:
        score -= 20
        issues.append(f"最大回撤过高: {max_drawdown}%")
        recommendations.append("建议降低仓位或增加止损")
    elif max_drawdown > 5:
        score -= 10
        issues.append(f"最大回撤偏高: {max_drawdown}%")

    # 检查胜率
    win_rate = backtest_report.get("win_rate_pct", 0)
    if win_rate < 50:
        score -= 15
        issues.append(f"胜率过低: {win_rate}%")
        recommendations.append("建议优化策略参数")

    # 检查交易次数（太少不稳定）
    trade_count = backtest_report.get("trade_count", 0)
    if trade_count < 10:
        score -= 10
        issues.append(f"交易次数过少: {trade_count}")
        recommendations.append("建议增加数据量以验证策略稳定性")

    # 检查风险参数
    risk = strategy_spec.get("risk", {})
    leverage = risk.get("maxLeverage", 1)
    if leverage > 3:
        score -= 30
        issues.append(f"杠杆过高: {leverage}x")
        recommendations.append("建议降低杠杆至 3x 以下")

    position_pct = risk.get("maxPositionPct", 0.1)
    if position_pct > 0.2:
        score -= 10
        issues.append(f"仓位过大: {position_pct * 100}%")
        recommendations.append("建议降低仓位至 20% 以下")

    # 确定决策
    risk_score = max(0, min(100, score))
    decision = "BLOCK" if risk_score < 60 else "WARN" if risk_score < 80 else "PASS"

    if not recommendations:
        recommendations.append("策略风险可控，可进入模拟盘阶段")

    return {
        "decision": decision,
        "risk_score": round(risk_score, 1),
        "issues": issues,
        "recommendations": recommendations,
    }


def compile_strategy_spec(
    task_brief: Dict[str, Any],
    market_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    编译策略规格

    Args:
        task_brief: 任务简报（包含 objective）
        market_data: 市场数据（可选）

    Returns:
        策略规格（StrategySpec）
    """
    objective = task_brief.get("objective", "")

    # 简化实现：生成默认策略（后续可用 LLM 解析）
    # 检测关键词
    if "btc" in objective.lower() or "bitcoin" in objective.lower():
        symbol = "BTCUSDT"
    elif "eth" in objective.lower() or "ethereum" in objective.lower():
        symbol = "ETHUSDT"
    else:
        symbol = "BTCUSDT"

    # 检测时间周期
    if "1m" in objective.lower():
        timeframe = "1m"
    elif "5m" in objective.lower():
        timeframe = "5m"
    elif "4h" in objective.lower():
        timeframe = "4h"
    elif "1d" in objective.lower():
        timeframe = "1d"
    else:
        timeframe = "1h"

    # 检测策略类型
    if "ema" in objective.lower() or "trend" in objective.lower():
        strategy_name = "EMA Trend Breakout"
        strategy_type = "ema_trend"
    elif "rsi" in objective.lower() or "reversal" in objective.lower():
        strategy_name = "RSI Mean Reversion"
        strategy_type = "rsi_reversal"
    else:
        strategy_name = "EMA Trend Breakout"
        strategy_type = "ema_trend"

    return {
        "id": f"spec-{strategy_type}-{symbol}",
        "source": "library_template",
        "name": strategy_name,
        "symbol": symbol,
        "market": "spot",
        "timeframe": timeframe,
        "entry": {
            "mode": "all",
            "rules": [
                {
                    "left": "EMA20",
                    "operator": "crosses_above",
                    "right": "EMA60",
                    "description": "EMA20 上穿 EMA60",
                },
                {
                    "left": "RSI14",
                    "operator": "less_than",
                    "right": "70",
                    "description": "RSI 未过热",
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
                    "description": "EMA20 下穿 EMA60",
                },
                {
                    "left": "PnL",
                    "operator": "less_than",
                    "right": "-3%",
                    "description": "止损触发",
                },
            ],
        },
        "risk": {
            "maxPositionPct": 0.1,
            "maxLeverage": 1,
            "stopLossPct": 0.03,
            "takeProfitPct": 0.06,
            "maxDailyLossPct": 0.05,
            "killSwitchDrawdownPct": 0.12,
        },
        "tags": [strategy_type, timeframe, "library"],
    }


def promote_mission_memory(
    mission_id: str,
    strategy_spec: Dict[str, Any],
    backtest_report: Dict[str, Any],
    risk_report: Dict[str, Any],
) -> Dict[str, Any]:
    """
    提升任务记忆到永久记忆库

    Args:
        mission_id: 任务 ID
        strategy_spec: 策略规格
        backtest_report: 回测报告
        risk_report: 风控报告

    Returns:
        记忆记录信息
    """
    # 构建记忆内容
    content = f"""
策略: {strategy_spec.get('name', 'Unknown')}
符号: {strategy_spec.get('symbol', 'Unknown')}
时间周期: {strategy_spec.get('timeframe', 'Unknown')}
回测表现: {backtest_report.get('total_return_pct', 0)}% 收益, {backtest_report.get('max_drawdown_pct', 0)}% 回撤
胜率: {backtest_report.get('win_rate_pct', 0)}%
交易次数: {backtest_report.get('trade_count', 0)}
风险评估: {risk_report.get('decision', 'PASS')} (分数: {risk_report.get('risk_score', 100)}/100)
关键问题: {', '.join(risk_report.get('issues', []))}
改进建议: {', '.join(risk_report.get('recommendations', []))}
"""

    # 添加到永久记忆库
    record = memory_store.remember(
        scope="/archive/" + mission_id,
        title=f"Mission {mission_id} Archive",
        summary=f"{strategy_spec.get('name', 'Strategy')} - {backtest_report.get('total_return_pct', 0)}% return",
        content=content,
        source_mission_id=mission_id,
        promoted=True,
    )

    return {
        "memory_id": record.id,
        "scope": record.scope,
        "promoted": record.promoted,
    }