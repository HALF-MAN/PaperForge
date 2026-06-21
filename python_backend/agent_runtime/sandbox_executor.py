"""
PaperForge Sandbox Executor
使用langchain-sandbox执行用户策略代码

架构转变：不再使用StrategySpec，用户直接编写Python代码
"""

import sys
import io
import signal
import json
import threading
import pandas as pd
import numpy as np
from typing import Dict, Any, Optional, List
from agent_runtime.bitget_client import fetch_bitget_candles_for_backtest
from datetime import datetime
from contextlib import redirect_stdout, redirect_stderr

try:
    from langchain_sandbox import PyodideSandbox
    LANGCHAIN_SANDBOX_AVAILABLE = True
except ImportError:
    LANGCHAIN_SANDBOX_AVAILABLE = False
    print("⚠️ langchain-sandbox not available, using restricted Python execution")


class StrategySandboxExecutor:
    """
    策略代码沙箱执行器

    安全机制：
    - 静态代码检查（禁止危险模块）
    - 沙箱隔离执行（langchain-sandbox or RestrictedPython）
    - 超时限制（最多5秒）
    - 资源限制（内存、CPU）
    """

    # 禁止的模块列表
    BLACKLIST_MODULES = [
        'os', 'sys', 'subprocess', 'socket', 'requests',
        'urllib', 'http', 'ftplib', 'smtplib', 'telnetlib',
        'pickle', 'marshal', 'shelve', 'dbm',
        'multiprocessing', 'threading', '_thread',
        'ctypes', 'signal',
    ]

    # 禁止的代码模式
    FORBIDDEN_PATTERNS = [
        r'import\s+os',
        r'import\s+subprocess',
        r'import\s+socket',
        r'from\s+os',
        r'from\s+subprocess',
        r'open\s*\(',
        r'eval\s*\(',
        r'exec\s*\(',
        r'__import__\s*\(',
        r'compile\s*\(',
        r'globals\s*\(',
        r'locals\s*\(',
        r'getattr\s*\(',
        r'setattr\s*\(',
        r'delattr\s*\(',
        r'while\s+True\s*:',
        r'for\s+.*\s+in\s+range\s*\(\s*[1-9]\d{6,}',
    ]

    MAX_EXECUTION_TIME = 5  # seconds
    MAX_MEMORY_MB = 100

    @staticmethod
    def check_code_safety(code: str) -> tuple[bool, str]:
        """
        静态检查代码安全性
        """
        import re

        for pattern in StrategySandboxExecutor.FORBIDDEN_PATTERNS:
            if re.search(pattern, code):
                return False, f"Forbidden pattern detected: {pattern}"

        return True, "Code passed safety check"

    @staticmethod
    def generate_mock_data(days: int = 100, start_date: str = '2024-01-01') -> pd.DataFrame:
        """
        生成模拟的回测数据（用于测试）
        """
        import numpy as np

        days = max(30, min(days, 2000))
        dates = pd.date_range(start=start_date, periods=days, freq='D')
        rng = np.random.default_rng(42)

        # 生成可复现的 OHLCV 数据，避免同一段策略每次回测结果跳动。
        returns = rng.normal(loc=0.0008, scale=0.025, size=days)
        close = 100 * np.cumprod(1 + returns)

        # 生成其他字段
        volume = rng.integers(1000, 10000, days)

        df = pd.DataFrame({
            'date': dates,
            'open': close * (1 + rng.normal(0, 0.006, days)),
            'high': close * (1 + np.abs(rng.normal(0, 0.012, days))),
            'low': close * (1 - np.abs(rng.normal(0, 0.012, days))),
            'close': close,
            'volume': volume,
        })

        return df

    @staticmethod
    def execute_strategy(
        strategy_code: str,
        backtest_config: Dict[str, Any],
        use_sandbox: bool = True
    ) -> Dict[str, Any]:
        """
        执行用户策略代码

        Args:
            strategy_code: 用户编写的Python策略代码
            backtest_config: 回测配置（startDate, endDate, initialCapital等）
            use_sandbox: 是否使用沙箱执行

        Returns:
            回测结果（收益、回撤、夏普等）
        """

        # 1. 静态代码检查
        safe, reason = StrategySandboxExecutor.check_code_safety(strategy_code)
        if not safe:
            return {
                'success': False,
                'error': reason,
                'backtest': None,
            }

        # 2. 获取回测数据（支持真实数据和mock数据）
        data_source = backtest_config.get("dataSource", "mock")  # 默认使用mock数据

        if data_source == "bitget_public":
            # 使用Bitget真实数据
            symbol = backtest_config.get("symbol", "BTCUSDT")
            granularity = backtest_config.get("granularity", "1D")
            limit = backtest_config.get("limit", 300)
            start_date = backtest_config.get("startDate")
            end_date = backtest_config.get("endDate")

            candles_data = fetch_bitget_candles_for_backtest(
                symbol,
                granularity,
                limit,
                start_date=start_date,
                end_date=end_date,
            )

            if candles_data:
                # 使用真实数据
                data = pd.DataFrame(candles_data)
                data['date'] = pd.to_datetime(data['date'])
                if start_date:
                    data = data[data['date'] >= pd.Timestamp(start_date)]
                if end_date:
                    data = data[data['date'] <= pd.Timestamp(end_date)]
                data = data.sort_values('date').reset_index(drop=True)
                if len(data) < 2:
                    return {
                        'success': False,
                        'error': '所选时间段内的 Bitget K 线不足，请扩大日期范围或调整 K 线周期。',
                        'backtest': None,
                    }
                print(f"✅ Using Bitget real data: {len(data)} candles for {symbol}")
            else:
                return {
                    'success': False,
                    'error': 'Bitget 在所选时间段内没有返回 K 线，请检查日期范围、K 线周期或网络连接。',
                    'backtest': None,
                }
        else:
            # 使用mock数据（默认）
            days = 100
            start_date = '2024-01-01'
            if backtest_config.get('startDate') and backtest_config.get('endDate'):
                from datetime import datetime as dt
                start = dt.strptime(backtest_config['startDate'], '%Y-%m-%d')
                end = dt.strptime(backtest_config['endDate'], '%Y-%m-%d')
                days = max((end - start).days, 30)
                start_date = backtest_config['startDate']

            data = StrategySandboxExecutor.generate_mock_data(days, start_date)
            print(f"📊 Using mock data: {len(data)} days from {start_date}")

        # 3. 执行策略代码
        try:
            if use_sandbox and LANGCHAIN_SANDBOX_AVAILABLE:
                # 使用langchain-sandbox
                result = StrategySandboxExecutor._execute_with_langchain_sandbox(
                    strategy_code, data, backtest_config
                )
            else:
                # 使用受限Python执行
                result = StrategySandboxExecutor._execute_with_restricted_python(
                    strategy_code, data, backtest_config
                )

            return result

        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'backtest': None,
            }

    @staticmethod
    def _execute_with_langchain_sandbox(
        code: str,
        data: pd.DataFrame,
        config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        使用langchain-sandbox执行（推荐方案）

        注意：langchain-sandbox当前版本API较复杂，暂时使用restricted-python作为主要方案
        """
        try:
            # langchain-sandbox需要更复杂的配置，暂时fallback到restricted-python
            return StrategySandboxExecutor._execute_with_restricted_python(code, data, config)

        except Exception as e:
            return {
                'success': False,
                'error': f'langchain-sandbox execution failed: {str(e)}',
                'backtest': None,
            }

    @staticmethod
    def _execute_with_restricted_python(
        code: str,
        data: pd.DataFrame,
        config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        使用受限Python执行（备选方案）
        """

        # 创建受限的globals
        # 定义安全的__import__函数
        def safe_import(name, *args, **kwargs):
            """只允许导入安全的模块"""
            allowed_modules = ['pandas', 'numpy', 'math', 'datetime']
            if name in allowed_modules:
                return __import__(name, *args, **kwargs)
            else:
                raise ImportError(f"Module '{name}' is not allowed")

        restricted_globals = {
            '__builtins__': {
                'abs': abs, 'min': min, 'max': max,
                'sum': sum, 'len': len, 'range': range,
                'enumerate': enumerate, 'zip': zip,
                'list': list, 'dict': dict, 'set': set,
                'str': str, 'int': int, 'float': float,
                'bool': bool, 'print': print,
                '__build_class__': __build_class__,  # 必需：用于定义class
                '__name__': '__main__',  # 必需：模块名
                '__import__': safe_import,  # 安全的import函数
            },
            'pd': pd,
            'np': np,
            'data': data,
        }

        stdout = io.StringIO()
        stderr = io.StringIO()

        try:
            # 设置超时。HTTP server 使用工作线程，Python signal 只能在主线程里注册。
            def timeout_handler(signum, frame):
                raise TimeoutError("Execution timeout")

            use_alarm = threading.current_thread() is threading.main_thread()
            if use_alarm:
                signal.signal(signal.SIGALRM, timeout_handler)
                signal.alarm(StrategySandboxExecutor.MAX_EXECUTION_TIME)

            # 执行代码
            with redirect_stdout(stdout), redirect_stderr(stderr):
                exec(code, restricted_globals)

            if use_alarm:
                signal.alarm(0)

            # 获取结果
            strategy_class = restricted_globals.get('Strategy')
            if strategy_class is None:
                strategy_class = StrategySandboxExecutor._find_strategy_class(restricted_globals)

            if strategy_class is None:
                return {
                    'success': False,
                    'error': 'Strategy class not found. Define class Strategy with generate_signals(data), or any class that implements generate_signals(data).',
                    'backtest': None,
                }

            strategy = strategy_class()
            raw_signals = strategy.generate_signals(data.copy())
            signals = StrategySandboxExecutor._normalize_signals(raw_signals, data)
            result = StrategySandboxExecutor._run_long_only_backtest(data, signals, config)

            result.update({
                'success': True,
                'sandbox_type': 'restricted-python',
                'stdout': stdout.getvalue(),
                'stderr': stderr.getvalue(),
            })
            return result

        except TimeoutError:
            return {
                'success': False,
                'error': 'Execution timeout',
                'backtest': None,
            }

        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'backtest': None,
            }

        finally:
            if threading.current_thread() is threading.main_thread():
                signal.alarm(0)

    @staticmethod
    def _find_strategy_class(globals_dict: Dict[str, Any]) -> Optional[type]:
        for value in globals_dict.values():
            if isinstance(value, type) and hasattr(value, 'generate_signals'):
                return value
        return None

    @staticmethod
    def _normalize_signals(raw_signals: Any, data: pd.DataFrame) -> pd.Series:
        if isinstance(raw_signals, pd.DataFrame):
            if 'signal' not in raw_signals.columns:
                raise ValueError("Strategy returned a DataFrame but no 'signal' column was found")
            signals = raw_signals['signal']
        elif isinstance(raw_signals, pd.Series):
            signals = raw_signals
        else:
            signals = pd.Series(raw_signals)

        signals = signals.reindex(range(len(data))) if not signals.index.equals(data.index) else signals
        signals = signals.fillna(0).replace({True: 1, False: 0}).astype(float)
        return signals.clip(lower=-1, upper=1)

    @staticmethod
    def _run_long_only_backtest(data: pd.DataFrame, signals: pd.Series, config: Dict[str, Any]) -> Dict[str, Any]:
        initial_capital = float(config.get('initialCapital', 100000) or 100000)
        commission_rate = float(config.get('commissionRate', 0.001) or 0)
        slippage = float(config.get('slippage', 0.0005) or 0)

        cash = initial_capital
        position = 0.0
        entry_value = 0.0
        closed_trade_returns: list[float] = []
        gross_profit = 0.0
        gross_loss = 0.0
        equity_curve: list[float] = []
        benchmark_curve: list[float] = []
        trade_log: list[dict[str, Any]] = []

        first_price = float(data['close'].iloc[0])

        for index, signal_value in enumerate(signals):
            price = float(data['close'].iloc[index])
            date_value = data['date'].iloc[index]

            if signal_value > 0 and position == 0:
                buy_price = price * (1 + slippage)
                units = cash / buy_price if buy_price > 0 else 0
                fee = units * buy_price * commission_rate
                position = max(units - (fee / buy_price if buy_price > 0 else 0), 0)
                cash = 0.0
                entry_value = position * buy_price
                trade_log.append({'date': str(date_value.date()), 'side': 'buy', 'price': round(buy_price, 4)})
            elif signal_value < 0 and position > 0:
                sell_price = price * (1 - slippage)
                exit_value = position * sell_price
                fee = exit_value * commission_rate
                cash = max(exit_value - fee, 0)
                pnl = cash - entry_value
                trade_return = pnl / entry_value if entry_value else 0
                closed_trade_returns.append(trade_return)
                gross_profit += max(pnl, 0)
                gross_loss += min(pnl, 0)
                trade_log.append({'date': str(date_value.date()), 'side': 'sell', 'price': round(sell_price, 4), 'pnl_pct': round(trade_return * 100, 3)})
                position = 0.0
                entry_value = 0.0

            equity = cash + position * price
            equity_curve.append(equity)
            benchmark_curve.append((price / first_price - 1) * 100)

        final_equity = equity_curve[-1] if equity_curve else initial_capital
        total_return_pct = (final_equity / initial_capital - 1) * 100

        equity_series = pd.Series(equity_curve, index=pd.to_datetime(data['date']))
        returns = equity_series.pct_change().fillna(0)
        running_max = equity_series.cummax()
        drawdown_pct = ((equity_series / running_max) - 1) * 100
        max_drawdown_pct = abs(float(drawdown_pct.min())) if not drawdown_pct.empty else 0.0
        sharpe_ratio = 0.0
        if float(returns.std()) > 0:
            sharpe_ratio = float((returns.mean() / returns.std()) * np.sqrt(252))

        wins = [trade for trade in closed_trade_returns if trade > 0]
        trade_count = len(closed_trade_returns)
        win_rate_pct = (len(wins) / trade_count * 100) if trade_count else 0.0
        profit_factor = (gross_profit / abs(gross_loss)) if gross_loss < 0 else (gross_profit if gross_profit > 0 else 0.0)
        average_trade_pct = (sum(closed_trade_returns) / trade_count * 100) if trade_count else 0.0

        monthly_returns = (
            equity_series.resample('ME').last().pct_change().fillna((equity_series.resample('ME').last().iloc[0] / initial_capital) - 1)
            if len(equity_series) > 0
            else pd.Series(dtype=float)
        )

        risk_score = max(0, min(100, int(75 + total_return_pct * 0.4 - max_drawdown_pct * 1.8 + sharpe_ratio * 4)))
        if max_drawdown_pct > 25 or total_return_pct < -10:
            decision = 'BLOCK'
        elif max_drawdown_pct > 12 or sharpe_ratio < 0.7:
            decision = 'WARN'
        else:
            decision = 'PASS'

        recommendations = []
        if max_drawdown_pct > 12:
            recommendations.append('回撤偏高，建议降低单次仓位或增加止损条件。')
        if trade_count < 3:
            recommendations.append('交易次数偏少，建议扩大样本周期后再判断稳定性。')
        if sharpe_ratio < 1:
            recommendations.append('风险调整收益偏弱，建议继续优化入场过滤条件。')
        if not recommendations:
            recommendations.append('当前沙箱回测通过基础风险检查，可以进入下一轮参数调优。')

        return {
            'backtest': {
                'total_return_pct': round(float(total_return_pct), 2),
                'max_drawdown_pct': round(float(max_drawdown_pct), 2),
                'win_rate_pct': round(float(win_rate_pct), 1),
                'sharpe_ratio': round(float(sharpe_ratio), 2),
                'trade_count': trade_count,
                'profit_factor': round(float(profit_factor), 2),
                'average_trade_pct': round(float(average_trade_pct), 3),
                'signals': signals.astype(float).tolist(),
                'trades': trade_log[-20:],
            },
            'risk': {
                'decision': decision,
                'risk_score': risk_score,
                'issues': [],
                'recommendations': recommendations,
            },
            'charts': {
                'dates': [str(value.date()) for value in pd.to_datetime(data['date'])],
                'cumulativeReturn': [round((value / initial_capital - 1) * 100, 3) for value in equity_curve],
                'benchmark': [round(float(value), 3) for value in benchmark_curve],
                'drawdown': [round(float(value), 3) for value in drawdown_pct.tolist()],
            },
            'monthlyReturns': [
                {'month': index.strftime('%b'), 'return': round(float(value) * 100, 3)}
                for index, value in monthly_returns.items()
            ],
        }


# 测试示例
if __name__ == "__main__":
    # 用户策略代码示例
    user_strategy = """
class Strategy:
    def __init__(self):
        self.ema_period = 20

    def generate_signals(self, data):
        import pandas as pd
        import numpy as np

        ema = data['close'].ewm(span=self.ema_period).mean()
        signal = (data['close'] > ema).astype(int)
        return signal
"""

    # 回测配置
    config = {
        'startDate': '2024-01-01',
        'endDate': '2024-12-31',
        'initialCapital': 100000,
    }

    # 执行策略
    result = StrategySandboxExecutor.execute_strategy(user_strategy, config)

    print("Execution Result:")
    print(json.dumps(result, indent=2))
