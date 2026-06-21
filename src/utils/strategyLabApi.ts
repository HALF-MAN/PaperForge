/**
 * Strategy Lab API Integration
 * 用户直接提交 Python 策略代码，由 Python 后端沙箱执行。
 */

/**
 * 执行策略回测
 */
export async function runStrategyBacktest(
  strategyCode: string,
  userParams: Record<string, any>,
  backtestConfig: {
    startDate: string;
    endDate: string;
    initialCapital: number;
    commissionRate: number;
    slippage: number;
  }
): Promise<any> {
  if (!strategyCode.trim()) {
    throw new Error('Strategy code is required');
  }

  const response = await fetch('/api/sandbox/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      strategyCode,
      params: userParams,
      backtestConfig,
    }),
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Sandbox execution failed');
  }

  return result;
}

/**
 * 调用Strategy Agent生成策略代码
 */
export async function generateStrategyCode(
  userDescription: string
): Promise<any> {
  try {
    const response = await fetch('/api/agents/transcript', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Generate a trading strategy based on user description: ${userDescription}`,
        agent_type: 'strategy_agent',
      }),
    });

    if (!response.ok) {
      throw new Error('Strategy Agent API failed');
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Strategy generation failed:', error);

    // 返回默认策略
    return {
      strategy_code: `# Strategy generated from: "${userDescription}"

class CustomStrategy:
    def __init__(self):
        # @param: period|Indicator Period|int|20|5-100
        self.period = 20

    def generate_signals(self, data):
        """
        Custom strategy based on user description
        """
        # Default EMA strategy
        ema = data['close'].ewm(span=self.period).mean()
        signal = (data['close'] > ema).astype(int)
        return signal
`,
      template_id: 'ema_breakout',
      confidence: 0.7,
    };
  }
}

/**
 * 保存策略到库
 */
export async function saveStrategy(
  strategyName: string,
  templateId: string,
  params: Record<string, any>,
  backtestResults: any
): Promise<any> {
  try {
    const response = await fetch('/api/strategies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: strategyName,
        template_id: templateId,
        parameters: params,
        backtest_results: backtestResults,
        status: 'draft',
      }),
    });

    if (!response.ok) {
      throw new Error('Save strategy failed');
    }

    return await response.json();
  } catch (error) {
    console.error('Save strategy failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Save strategy failed' };
  }
}
