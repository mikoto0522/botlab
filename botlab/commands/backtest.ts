import type { BotlabConfig } from '../core/types.js';
import { loadBacktestRows } from '../backtest/csv.js';
import { runBacktest } from '../backtest/engine.js';
import {
  createBacktestRuntimeOptions,
  formatBacktestNumber,
  resolveProjectRelativePath,
} from './backtest-common.js';

export type BacktestSide = 'up' | 'down';

export async function backtestCommand(
  strategyId: string,
  dataPath: string,
  side: BacktestSide,
  config: BotlabConfig,
): Promise<string> {
  const resolvedDataPath = resolveProjectRelativePath(config, dataPath);
  const rows = loadBacktestRows(resolvedDataPath);
  const result = await runBacktest({
    strategyId,
    signalSide: side,
    ...createBacktestRuntimeOptions(config),
    rows,
  });

  return [
    'Backtest Summary',
    `Strategy: ${strategyId}`,
    `Rows: ${rows.length}`,
    `Trades: ${result.summary.tradeCount}`,
    `Fees: ${formatBacktestNumber(result.summary.feeTotal)}`,
    `Ending Equity: ${formatBacktestNumber(result.summary.endingEquity)}`,
    `Return: ${formatBacktestNumber(result.summary.returnPct)}%`,
    `Max Drawdown: ${formatBacktestNumber(result.summary.maxDrawdownPct)}%`,
    `Settled: ${result.summary.settled ? 'yes' : 'no'}`,
  ].join('\n');
}
