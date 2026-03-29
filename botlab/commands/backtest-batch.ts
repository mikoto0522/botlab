import type { BotlabConfig } from '../core/types.js';
import { loadBacktestRows } from '../backtest/csv.js';
import { runBatchBacktest } from '../backtest/batch-engine.js';
import {
  createBacktestRuntimeOptions,
  formatBacktestNumber,
  resolveProjectRelativePath,
} from './backtest-common.js';

export async function backtestBatchCommand(
  strategyId: string,
  dataPath: string,
  config: BotlabConfig,
): Promise<string> {
  const resolvedDataPath = resolveProjectRelativePath(config, dataPath);
  const rows = loadBacktestRows(resolvedDataPath);
  const result = await runBatchBacktest({
    strategyId,
    ...createBacktestRuntimeOptions(config),
    rows,
  });

  return [
    'Batch Backtest Summary',
    `Strategy: ${strategyId}`,
    `Rows: ${rows.length}`,
    `Trades: ${result.summary.tradeCount}`,
    `Up Trades: ${result.summary.upTradeCount}`,
    `Down Trades: ${result.summary.downTradeCount}`,
    `Skipped Inputs: ${result.summary.skippedCount}`,
    `Fees: ${formatBacktestNumber(result.summary.feeTotal)}`,
    `Ending Equity: ${formatBacktestNumber(result.summary.endingEquity)}`,
    `Return: ${formatBacktestNumber(result.summary.returnPct)}%`,
    `Max Drawdown: ${formatBacktestNumber(result.summary.maxDrawdownPct)}%`,
    `Settled: ${result.summary.settled ? 'yes' : 'no'}`,
  ].join('\n');
}
