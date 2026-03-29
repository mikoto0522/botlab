import path from 'node:path';
import type { BotlabConfig } from '../core/types.js';
import type { BacktestFeeModel } from '../backtest/fees.js';

export const DEFAULT_BACKTEST_SLIPPAGE = 0.01;
export const DEFAULT_BACKTEST_FEE_MODEL: BacktestFeeModel = 'polymarket-2026-03-26';

export function resolveProjectRelativePath(config: BotlabConfig, targetPath: string): string {
  return path.resolve(path.dirname(config.paths.rootDir), targetPath);
}

export function createBacktestRuntimeOptions(config: BotlabConfig) {
  return {
    strategyDir: config.paths.strategyDir,
    startingBalance: config.runtime.balance,
    strategyParams: config.strategyParams,
    slippage: DEFAULT_BACKTEST_SLIPPAGE,
    feeModel: DEFAULT_BACKTEST_FEE_MODEL,
  };
}

export function formatBacktestNumber(value: number): string {
  return value.toFixed(2);
}
