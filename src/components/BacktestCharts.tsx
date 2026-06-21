/**
 * Backtest Results Chart Component
 * 使用Recharts可视化回测结果
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import { TrendingUp, Activity, BarChart3 } from 'lucide-react';

interface BacktestChartProps {
  data: {
    cumulativeReturn: number[];
    dates: string[];
    benchmark?: number[];
    drawdown?: number[];
  };
  compact?: boolean;
  height?: number;
  className?: string;
}

export function CumulativeReturnChart({
  data,
  compact = false,
  height = 200,
  className = "",
}: BacktestChartProps) {
  const chartData = data.dates.map((date, i) => ({
    date: date.slice(0, 10), // YYYY-MM-DD
    strategy: data.cumulativeReturn[i],
    benchmark: data.benchmark?.[i] || 0,
  }));

  return (
    <div
      className={`overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] ${
        compact ? "p-2" : "p-4"
      } ${className}`}
    >
      {!compact && (
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-[var(--accent)]" />
          <h3 className="text-sm font-bold text-[var(--foreground)]">Cumulative Return</h3>
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted)" />
          <YAxis
            tick={{ fontSize: 10 }}
            stroke="var(--muted)"
            tickFormatter={(value) => `${value.toFixed(1)}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: '4px',
              fontSize: '12px'
            }}
            formatter={(value) => [`${Number(value ?? 0).toFixed(2)}%`, 'Strategy']}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Line
            type="monotone"
            dataKey="strategy"
            stroke="#4F46E5"
            strokeWidth={2}
            dot={false}
            name="Strategy"
          />
          <Line
            type="monotone"
            dataKey="benchmark"
            stroke="#9CA3AF"
            strokeWidth={1}
            dot={false}
            name="Benchmark"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DrawdownChart({ data }: BacktestChartProps) {
  const chartData = data.dates.map((date, i) => ({
    date: date.slice(0, 10),
    drawdown: Math.abs(data.drawdown?.[i] || 0),
  }));

  return (
    <div className="rounded-lg border border-[var(--warning)] bg-[var(--warning)]/5 p-4">
      <div className="flex items-center gap-2 mb-4">
        <Activity size={16} className="text-[var(--warning)]" />
        <h3 className="text-sm font-bold text-[var(--warning)]">Drawdown Analysis</h3>
      </div>

      <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--muted)" />
          <YAxis
            tick={{ fontSize: 10 }}
            stroke="var(--muted)"
            tickFormatter={(value) => `${value.toFixed(1)}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: '4px',
              fontSize: '12px'
            }}
            formatter={(value) => [`${Number(value ?? 0).toFixed(2)}%`, 'Drawdown']}
          />
          <Area
            type="monotone"
            dataKey="drawdown"
            stroke="#F59E0B"
            fill="#F59E0B33"
            strokeWidth={1}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

interface MonthlyReturnData {
  month: string;
  return: number;
}

export function MonthlyReturnChart({ data }: { data: MonthlyReturnData[] }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 size={16} className="text-[var(--accent)]" />
        <h3 className="text-sm font-bold text-[var(--foreground)]">Monthly Returns</h3>
      </div>

      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="var(--muted)" />
          <YAxis
            tick={{ fontSize: 10 }}
            stroke="var(--muted)"
            tickFormatter={(value) => `${value.toFixed(1)}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: '4px',
              fontSize: '12px'
            }}
            formatter={(value) => [`${Number(value ?? 0).toFixed(2)}%`, 'Return']}
          />
          <Bar dataKey="return">
            {data.map((entry) => (
              <Cell
                key={entry.month}
                fill={entry.return >= 0 ? '#10B981' : '#EF4444'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// 模拟数据生成函数
export function generateMockBacktestData(days: number = 100) {
  const dates: string[] = [];
  const cumulativeReturn: number[] = [];
  const benchmark: number[] = [];
  const drawdown: number[] = [];

  let strategyValue = 0;
  let benchmarkValue = 0;
  let peakValue = 0;

  const startDate = new Date('2024-01-01');

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    dates.push(date.toISOString());

    // 随机收益
    const dailyReturn = (Math.random() - 0.4) * 0.03; // 期望正收益
    strategyValue += dailyReturn;

    const benchmarkReturn = (Math.random() - 0.5) * 0.02;
    benchmarkValue += benchmarkReturn;

    cumulativeReturn.push(strategyValue * 100);
    benchmark.push(benchmarkValue * 100);

    // 计算回撤
    peakValue = Math.max(peakValue, strategyValue);
    const dd = strategyValue - peakValue;
    drawdown.push(dd * 100);
  }

  return {
    dates,
    cumulativeReturn,
    benchmark,
    drawdown,
  };
}

export function generateMockMonthlyReturns() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return months.map(month => ({
    month,
    return: (Math.random() - 0.3) * 5, // 月度收益
  }));
}
