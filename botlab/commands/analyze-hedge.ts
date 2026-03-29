import type { BotlabConfig } from '../core/types.js';
import { loadBacktestRows } from '../backtest/csv.js';
import { runHedgeBacktest } from '../backtest/hedge-engine.js';
import {
  createBacktestRuntimeOptions,
  formatBacktestNumber,
  resolveProjectRelativePath,
} from './backtest-common.js';

function getMonthKey(timestamp: string): string {
  return timestamp.slice(0, 7);
}

function calculateTrimmedReturnPct(
  startingBalance: number,
  tradePnls: number[],
): number {
  const positivePnls = tradePnls.filter((pnl) => pnl > 0).sort((left, right) => right - left);
  const trimmedCount = positivePnls.length >= 10 ? Math.ceil(positivePnls.length * 0.1) : Math.min(positivePnls.length, 2);
  const trimmedSet = new Set(positivePnls.slice(0, trimmedCount));
  let removed = 0;
  let adjustedPnl = 0;

  for (const pnl of tradePnls) {
    if (pnl > 0 && trimmedSet.has(pnl) && removed < trimmedCount) {
      removed += 1;
      trimmedSet.delete(pnl);
      continue;
    }

    adjustedPnl += pnl;
  }

  if (startingBalance === 0) {
    return 0;
  }

  return (adjustedPnl / startingBalance) * 100;
}

function calculateTopWinnerSharePct(tradePnls: number[]): number {
  const positivePnls = tradePnls.filter((pnl) => pnl > 0).sort((left, right) => right - left);
  const totalPositive = positivePnls.reduce((sum, pnl) => sum + pnl, 0);

  if (totalPositive <= 0) {
    return 0;
  }

  const topPositive = positivePnls.slice(0, 5).reduce((sum, pnl) => sum + pnl, 0);
  return (topPositive / totalPositive) * 100;
}

export async function analyzeHedgeCommand(
  strategyId: string,
  dataPath: string,
  config: BotlabConfig,
): Promise<string> {
  const resolvedDataPath = resolveProjectRelativePath(config, dataPath);
  const rows = loadBacktestRows(resolvedDataPath);
  const runtimeOptions = createBacktestRuntimeOptions(config);
  const result = await runHedgeBacktest({
    strategyId,
    ...runtimeOptions,
    rows,
  });

  const monthKeys = [...new Set(rows.map((row) => getMonthKey(row.timestamp)))].sort();
  const monthlyOutputs: string[] = [];

  for (const monthKey of monthKeys) {
    const monthRows = rows.filter((row) => getMonthKey(row.timestamp) === monthKey);
    const monthResult = await runHedgeBacktest({
      strategyId,
      ...runtimeOptions,
      rows: monthRows,
    });
    monthlyOutputs.push(
      `${monthKey}: trades ${monthResult.summary.tradeCount}, return ${formatBacktestNumber(monthResult.summary.returnPct)}%, drawdown ${formatBacktestNumber(monthResult.summary.maxDrawdownPct)}%`,
    );
  }

  const tradePnls = result.trades.map((trade) => trade.realizedPnl);
  const trimmedReturnPct = calculateTrimmedReturnPct(runtimeOptions.startingBalance, tradePnls);
  const topWinnerSharePct = calculateTopWinnerSharePct(tradePnls);
  const concentrationWarning = topWinnerSharePct >= 60
    ? 'high concentration: a few big trades drive most of the result'
    : 'concentration looks moderate';

  return [
    'Hedge Analysis',
    `Strategy: ${strategyId}`,
    `Rows: ${rows.length}`,
    `Paired Trades: ${result.summary.tradeCount}`,
    `Legs: ${result.summary.legCount}`,
    `Return: ${formatBacktestNumber(result.summary.returnPct)}%`,
    `Max Drawdown: ${formatBacktestNumber(result.summary.maxDrawdownPct)}%`,
    '',
    'Stability Check',
    `Trimmed Return: ${formatBacktestNumber(trimmedReturnPct)}%`,
    `Top Winners Share: ${formatBacktestNumber(topWinnerSharePct)}%`,
    `Concentration: ${concentrationWarning}`,
    '',
    'Monthly Slices',
    ...monthlyOutputs,
  ].join('\n');
}
