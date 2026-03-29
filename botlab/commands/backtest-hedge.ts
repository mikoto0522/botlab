import type { BotlabConfig } from '../core/types.js';
import { loadBacktestRows } from '../backtest/csv.js';
import { runHedgeBacktest } from '../backtest/hedge-engine.js';
import {
  createBacktestRuntimeOptions,
  formatBacktestNumber,
  resolveProjectRelativePath,
} from './backtest-common.js';

export async function backtestHedgeCommand(
  strategyId: string,
  dataPath: string,
  config: BotlabConfig,
): Promise<string> {
  const resolvedDataPath = resolveProjectRelativePath(config, dataPath);
  const rows = loadBacktestRows(resolvedDataPath);
  const result = await runHedgeBacktest({
    strategyId,
    ...createBacktestRuntimeOptions(config),
    rows,
  });

  return [
    'Hedge Backtest Summary',
    `Strategy: ${strategyId}`,
    `Rows: ${rows.length}`,
    `Paired Trades: ${result.summary.tradeCount}`,
    `Legs: ${result.summary.legCount}`,
    `Skipped Groups: ${result.summary.skippedGroups}`,
    `Wins: ${result.summary.winCount}`,
    `Losses: ${result.summary.lossCount}`,
    `Fees: ${formatBacktestNumber(result.summary.feeTotal)}`,
    `Ending Equity: ${formatBacktestNumber(result.summary.endingEquity)}`,
    `Return: ${formatBacktestNumber(result.summary.returnPct)}%`,
    `Max Drawdown: ${formatBacktestNumber(result.summary.maxDrawdownPct)}%`,
    `Settled: ${result.summary.settled ? 'yes' : 'no'}`,
  ].join('\n');
}
