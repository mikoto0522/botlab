import type { BacktestRow } from './csv.js';
import { calculateFee, type BacktestFeeModel } from './fees.js';
import { createStrategyRegistry } from '../core/strategy-registry.js';
import { getStrategyParamOverrides, resolveStrategyParams } from '../core/strategy-params.js';
import type {
  BotlabCandle,
  BotlabHedgeContext,
  BotlabHedgeDecision,
  BotlabRelatedMarketRuntime,
  HedgeBacktestLeg,
  HedgeBacktestResult,
} from '../core/types.js';

export interface RunHedgeBacktestInput {
  strategyId: string;
  strategyDir: string;
  startingBalance: number;
  strategyParams?: Record<string, Record<string, unknown>>;
  slippage: number;
  feeModel: BacktestFeeModel;
  rows: BacktestRow[];
}

const MAX_CONTEXT_CANDLES = 128;

function clampPrice(price: number): number {
  return Math.max(0.01, Math.min(0.99, Number(price.toFixed(6))));
}

function parseAsset(market: string): string {
  return market.split('-')[0] ?? market;
}

function parseTimestamp(timestamp: string): number {
  const parsed = Date.parse(timestamp);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Hedge backtest row has invalid timestamp: ${timestamp}`);
  }

  return parsed;
}

function getEntryAsk(row: BacktestRow, side: 'up' | 'down'): number {
  if (side === 'up') {
    return row.upAsk ?? row.upPrice;
  }

  return row.downAsk ?? row.downPrice;
}

function buildCandle(row: BacktestRow, previousClose: number | undefined): BotlabCandle {
  const close = row.upPrice;
  const open = previousClose ?? close;

  return Object.freeze({
    timestamp: row.timestamp,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: row.volume,
  });
}

function cloneRecentCandles(candles: BotlabCandle[]): BotlabCandle[] {
  return candles.slice(-MAX_CONTEXT_CANDLES).map((candle) => ({ ...candle }));
}

function calculateMaxDrawdownPct(
  equityCurve: Array<{ timestamp: string; cash: number; equity: number }>,
): number {
  let peak = 0;
  let maxDrawdownPct = 0;

  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak === 0) {
      continue;
    }

    const drawdownPct = ((peak - point.equity) / peak) * 100;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
  }

  return maxDrawdownPct;
}

function groupRowsByTimestamp(rows: BacktestRow[]): Array<Array<{ row: BacktestRow; index: number }>> {
  const groups: Array<Array<{ row: BacktestRow; index: number }>> = [];
  let currentTimestamp: string | undefined;
  let currentGroup: Array<{ row: BacktestRow; index: number }> = [];

  for (const [index, row] of rows.entries()) {
    if (currentTimestamp === row.timestamp) {
      currentGroup.push({ row, index });
      continue;
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    currentTimestamp = row.timestamp;
    currentGroup = [{ row, index }];
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

function buildMarketRuntime(
  row: BacktestRow,
  candles: BotlabCandle[],
): BotlabRelatedMarketRuntime {
  return {
    asset: parseAsset(row.market),
    symbol: row.market,
    timeframe: row.timeframe,
    price: row.upPrice,
    volume: row.volume,
    timestamp: row.timestamp,
    candles,
  };
}

function buildHedgeContext(
  group: Array<{ row: BacktestRow; index: number }>,
  historyByAsset: Map<string, BotlabCandle[]>,
  balance: number,
): BotlabHedgeContext {
  const markets = group
    .map(({ row }) => {
      const asset = parseAsset(row.market);
      const history = historyByAsset.get(asset) ?? [];

      return buildMarketRuntime(row, cloneRecentCandles(history));
    })
    .sort((left, right) => left.asset.localeCompare(right.asset));

  return {
    mode: 'dry-run',
    markets,
    balance,
    clock: {
      now: group[0]?.row.timestamp ?? new Date(0).toISOString(),
    },
  };
}

function getHedgeDecision(
  strategyId: string,
  evaluateHedge: ((context: BotlabHedgeContext, params: Record<string, unknown>) => BotlabHedgeDecision) | undefined,
  context: BotlabHedgeContext,
  defaults: Record<string, unknown>,
  strategyParams?: Record<string, unknown>,
): BotlabHedgeDecision {
  if (typeof evaluateHedge !== 'function') {
    throw new Error(`Strategy ${strategyId} does not support hedge backtests`);
  }

  return evaluateHedge(context, resolveStrategyParams(defaults, strategyParams));
}

export async function runHedgeBacktest(input: RunHedgeBacktestInput): Promise<HedgeBacktestResult> {
  const registry = await createStrategyRegistry(input.strategyDir);
  const strategy = registry.getById(input.strategyId);
  const strategyParams = getStrategyParamOverrides(input.strategyParams, input.strategyId);
  const historyByAsset = new Map<string, BotlabCandle[]>();
  const lastTimestampByAsset = new Map<string, number>();
  const trades: HedgeBacktestResult['trades'] = [];
  const equityCurve: HedgeBacktestResult['equityCurve'] = [];

  let cash = input.startingBalance;
  let feeTotal = 0;
  let legCount = 0;
  let skippedGroups = 0;
  let winCount = 0;
  let lossCount = 0;

  for (const group of groupRowsByTimestamp(input.rows)) {
    const pendingUpdates: Array<{ asset: string; candle: BotlabCandle; timestamp: number }> = [];
    const rowsByAsset = new Map<string, BacktestRow>();

    for (const { row, index } of group) {
      if (row.outcome !== 'up' && row.outcome !== 'down') {
        throw new Error(`Hedge backtest row ${index + 1} (${row.market} @ ${row.timestamp}) is missing outcome`);
      }

      const asset = parseAsset(row.market);
      const timestamp = parseTimestamp(row.timestamp);
      const lastTimestamp = lastTimestampByAsset.get(asset);

      if (lastTimestamp !== undefined && timestamp <= lastTimestamp) {
        throw new Error(`Hedge backtest rows for ${asset} must be in chronological order and unique by timestamp`);
      }

      if (rowsByAsset.has(asset)) {
        throw new Error(`Hedge backtest rows for ${asset} must be in chronological order and unique by timestamp`);
      }

      rowsByAsset.set(asset, row);
      const history = historyByAsset.get(asset) ?? [];
      const previousClose = history.at(-1)?.close ?? row.upPrice;
      pendingUpdates.push({
        asset,
        candle: buildCandle(row, previousClose),
        timestamp,
      });
    }

    const context = buildHedgeContext(group, historyByAsset, cash);
    const decision = getHedgeDecision(input.strategyId, strategy.evaluateHedge, context, strategy.defaults, strategyParams);

    if (decision.action !== 'hedge' || !Array.isArray(decision.legs) || decision.legs.length === 0) {
      skippedGroups++;
      equityCurve.push({
        timestamp: context.clock.now,
        cash,
        equity: cash,
      });
    } else {
      const validLegs = decision.legs.map((leg) => {
        if (typeof leg.size !== 'number' || !Number.isFinite(leg.size) || leg.size <= 0) {
          throw new Error(`Hedge backtest strategy returned invalid size for ${leg.asset} @ ${context.clock.now}`);
        }

        const row = rowsByAsset.get(leg.asset);
        if (!row) {
          throw new Error(`Hedge backtest strategy selected unknown asset ${leg.asset} @ ${context.clock.now}`);
        }

        return {
          ...leg,
          row,
          requestedSize: leg.size,
        };
      });

      const totalRequested = validLegs.reduce((sum, leg) => sum + leg.requestedSize, 0);
      const scale = totalRequested > cash && totalRequested > 0 ? cash / totalRequested : 1;
      const executedLegs: HedgeBacktestLeg[] = [];
      let tradeFees = 0;
      let tradePnl = 0;

      for (const leg of validLegs) {
        const budget = Number((leg.requestedSize * scale).toFixed(2));
        const openPrice = clampPrice(getEntryAsk(leg.row, leg.side) + input.slippage);
        const perShareCost = openPrice + calculateFee(input.feeModel, 1, openPrice);
        const shares = Math.floor((budget * 100) / perShareCost) / 100;

        if (shares <= 0) {
          continue;
        }

        const openFee = calculateFee(input.feeModel, shares, openPrice);
        const totalCost = shares * openPrice + openFee;

        if (totalCost > cash) {
          continue;
        }

        cash -= totalCost;

        const closePrice = leg.row.outcome === leg.side ? 1 : 0;
        const closeFee = calculateFee(input.feeModel, shares, closePrice);
        const proceeds = shares * closePrice;
        const realizedPnl = proceeds - closeFee - openFee - (shares * openPrice);

        cash += proceeds - closeFee;
        tradeFees += openFee + closeFee;
        tradePnl += realizedPnl;

        if (realizedPnl > 0) {
          winCount++;
        } else if (realizedPnl < 0) {
          lossCount++;
        }

        executedLegs.push({
          asset: leg.asset,
          market: leg.row.market,
          side: leg.side,
          entryTimestamp: leg.row.timestamp,
          exitTimestamp: leg.row.timestamp,
          entryPrice: openPrice,
          exitPrice: closePrice,
          shares,
          feesPaid: openFee + closeFee,
          realizedPnl,
        });
      }

      if (executedLegs.length === 0) {
        skippedGroups++;
      } else {
        legCount += executedLegs.length;
        feeTotal += tradeFees;
        trades.push({
          entryTimestamp: context.clock.now,
          exitTimestamp: context.clock.now,
          reason: decision.reason,
          feesPaid: tradeFees,
          realizedPnl: tradePnl,
          legs: executedLegs,
        });
      }

      equityCurve.push({
        timestamp: context.clock.now,
        cash,
        equity: cash,
      });
    }

    for (const update of pendingUpdates) {
      const history = historyByAsset.get(update.asset) ?? [];
      history.push(update.candle);
      historyByAsset.set(update.asset, history);
      lastTimestampByAsset.set(update.asset, update.timestamp);
    }
  }

  return {
    equityCurve,
    trades,
    summary: {
      tradeCount: trades.length,
      legCount,
      skippedGroups,
      winCount,
      lossCount,
      feeTotal,
      endingEquity: cash,
      returnPct: input.startingBalance === 0 ? 0 : ((cash - input.startingBalance) / input.startingBalance) * 100,
      maxDrawdownPct: calculateMaxDrawdownPct(equityCurve),
      settled: true,
    },
  };
}
