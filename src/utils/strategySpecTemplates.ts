/**
 * Strategy Spec Templates
 * 与Python展示代码对应的执行模板
 */

export interface StrategySpecTemplate {
  strategy_type: string;
  name: string;
  description: string;
  parameters: Record<string, any>;
  indicators: IndicatorConfig[];
  rules: SignalRule[];
  risk_config: RiskConfig;
}

export interface IndicatorConfig {
  name: string;
  type: string;
  params: Record<string, any>;
}

export interface SignalRule {
  indicator: string;
  condition: string;
  action: 'buy' | 'sell' | 'hold';
}

export interface RiskConfig {
  stop_loss_pct: number;
  take_profit_pct: number;
  max_position_pct: number;
}

/**
 * 策略模板库
 */
export const STRATEGY_TEMPLATES_SPEC: Record<string, StrategySpecTemplate> = {
  ema_breakout: {
    strategy_type: "ema_breakout",
    name: "EMA Breakout Strategy",
    description: "EMA均线突破策略，基于两条EMA交叉生成信号",
    parameters: {
      ema_period_1: 20,
      ema_period_2: 60,
      stop_loss_pct: 5.0,
      take_profit_pct: 10.0,
      max_position_pct: 10.0,
    },
    indicators: [
      {
        name: "ema_1",
        type: "ema",
        params: { period: 20 }
      },
      {
        name: "ema_2",
        type: "ema",
        params: { period: 60 }
      }
    ],
    rules: [
      {
        indicator: "ema_1",
        condition: "cross_above",
        action: "buy"
      },
      {
        indicator: "ema_1",
        condition: "cross_below",
        action: "sell"
      }
    ],
    risk_config: {
      stop_loss_pct: 5.0,
      take_profit_pct: 10.0,
      max_position_pct: 10.0,
    }
  },

  rsi_reversal: {
    strategy_type: "rsi_reversal",
    name: "RSI Reversal Strategy",
    description: "RSI超买超卖反转策略",
    parameters: {
      rsi_period: 14,
      rsi_upper: 70,
      rsi_lower: 30,
      stop_loss_pct: 5.0,
    },
    indicators: [
      {
        name: "rsi",
        type: "rsi",
        params: { period: 14 }
      }
    ],
    rules: [
      {
        indicator: "rsi",
        condition: "below_30",
        action: "buy"
      },
      {
        indicator: "rsi",
        condition: "above_70",
        action: "sell"
      }
    ],
    risk_config: {
      stop_loss_pct: 5.0,
      take_profit_pct: 10.0,
      max_position_pct: 10.0,
    }
  },

  macd_signal: {
    strategy_type: "macd_signal",
    name: "MACD Signal Strategy",
    description: "MACD金叉死叉策略",
    parameters: {
      macd_fast: 12,
      macd_slow: 26,
      macd_signal: 9,
    },
    indicators: [
      {
        name: "macd",
        type: "macd",
        params: { fast: 12, slow: 26, signal: 9 }
      }
    ],
    rules: [
      {
        indicator: "macd",
        condition: "golden_cross",
        action: "buy"
      },
      {
        indicator: "macd",
        condition: "death_cross",
        action: "sell"
      }
    ],
    risk_config: {
      stop_loss_pct: 5.0,
      take_profit_pct: 10.0,
      max_position_pct: 10.0,
    }
  },
};

/**
 * 根据模板和用户参数生成StrategySpec
 */
export function generateStrategySpec(
  templateId: string,
  userParams: Record<string, any>,
  symbol: string = "BTCUSDT",
  timeframe: string = "1h"
): any {
  const template = STRATEGY_TEMPLATES_SPEC[templateId];

  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }

  // 合并模板参数和用户参数
  const finalParams = { ...template.parameters, ...userParams };

  // 根据参数更新指标配置
  const indicators = template.indicators.map(ind => {
    const updatedParams = { ...ind.params };

    // EMA参数映射
    if (ind.type === "ema") {
      if (ind.name === "ema_1") {
        updatedParams.period = finalParams.ema_period_1;
      } else if (ind.name === "ema_2") {
        updatedParams.period = finalParams.ema_period_2;
      }
    }

    // RSI参数映射
    if (ind.type === "rsi") {
      updatedParams.period = finalParams.rsi_period;
    }

    return {
      ...ind,
      params: updatedParams
    };
  });

  // 更新风控配置
  const risk_config = {
    stop_loss_pct: finalParams.stop_loss_pct || template.risk_config.stop_loss_pct,
    take_profit_pct: finalParams.take_profit_pct || template.risk_config.take_profit_pct,
    max_position_pct: finalParams.max_position_pct || template.risk_config.max_position_pct,
  };

  // 生成完整的StrategySpec
  return {
    strategy_type: template.strategy_type,
    name: template.name,
    description: template.description,
    symbol,
    timeframe,
    parameters: finalParams,
    indicators,
    rules: template.rules,
    risk_config,
    created_by: "strategy_agent",
    created_at: new Date().toISOString(),
    version: "1.0",
  };
}

/**
 * 验证参数有效性
 */
export function validateParams(params: Record<string, any>): boolean {
  // EMA参数验证
  if (params.ema_period_1) {
    if (params.ema_period_1 < 5 || params.ema_period_1 > 100) {
      return false;
    }
  }

  if (params.ema_period_2) {
    if (params.ema_period_2 < 10 || params.ema_period_2 > 200) {
      return false;
    }
  }

  // RSI参数验证
  if (params.rsi_period) {
    if (params.rsi_period < 5 || params.rsi_period > 50) {
      return false;
    }
  }

  // 风控参数验证
  if (params.stop_loss_pct) {
    if (params.stop_loss_pct < 1 || params.stop_loss_pct > 20) {
      return false;
    }
  }

  if (params.max_position_pct) {
    if (params.max_position_pct < 5 || params.max_position_pct > 30) {
      return false;
    }
  }

  return true;
}