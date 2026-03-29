export type BacktestFeeModel = 'flat' | 'polymarket-2026-03-26';

export function calculateFee(
  model: BacktestFeeModel,
  shares: number,
  price: number,
): number {
  if (model === 'flat') {
    return shares * price * 0.01;
  }

  const feeRate = 0.072;
  const exponent = 1;

  return shares * price * feeRate * Math.pow(price * (1 - price), exponent);
}
