export function ema(values: number[], period: number): Array<number | null> {
  if (values.length === 0) {
    return [];
  }

  const result: Array<number | null> = Array(values.length).fill(null);
  const multiplier = 2 / (period + 1);
  let previous: number | null = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (index === period - 1) {
      const seed = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
      previous = seed;
      result[index] = seed;
      continue;
    }

    if (index >= period && previous !== null) {
      previous = value * multiplier + previous * (1 - multiplier);
      result[index] = previous;
    }
  }

  return result;
}

export function rsi(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);

  if (values.length <= period) {
    return result;
  }

  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  result[period] = calculateRsi(averageGain, averageLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    result[index] = calculateRsi(averageGain, averageLoss);
  }

  return result;
}

function calculateRsi(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0) {
    return 100;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}
