import type { BacktestRow } from './csv.js';
import { calculateFee, type BacktestFeeModel } from './fees.js';
import { createStrategyRegistry } from '../core/strategy-registry.js';
import type {
  BacktestEquityPoint,
  BacktestTrade,
  BatchBacktestResult,
  BatchBacktestSummary,
  BotlabCandle,
  BotlabRelatedMarketRuntime,
  BotlabStrategyContext,
} from '../core/types.js';

export interface RunBatchBacktestInput {
  strategyId: string;
  strategyDir: string;
  startingBalance: number;
  slippage: number;
  feeModel: BacktestFeeModel;
  rows: BacktestRow[];
}

const MAX_CONTEXT_CANDLES = 128;

function clampPrice(price: number): number {
  return Math.max(0.01, Math.min(0.99, Number(price.toFixed(6))));
}

function getEntryAsk(row: BacktestRow, side: 'up' | 'down'): number {
  if (side === 'up') {
    return row.upAsk ?? row.upPrice;
  }

  return row.downAsk ?? row.downPrice;
}

function parseAsset(market: string): string {
  return market.split('-')[0] ?? market;
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

function parseTimestamp(timestamp: string): number {
  const parsed = Date.parse(timestamp);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Batch backtest row has invalid timestamp: ${timestamp}`);
  }

  return parsed;
}

function buildContext(
  row: BacktestRow,
  candles: BotlabCandle[],
  relatedMarkets: BotlabRelatedMarketRuntime[],
  currentPrice: number,
  balance: number,
): BotlabStrategyContext {
  return {
    mode: 'dry-run',
    market: {
      asset: parseAsset(row.market),
      symbol: row.market,
      timeframe: row.timeframe,
      price: currentPrice,
      upPrice: row.upPrice,
      downPrice: row.downPrice,
      upAsk: row.upAsk,
      downAsk: row.downAsk,
      changePct24h: 0,
      momentum: 0,
      volume: row.volume,
      timestamp: row.timestamp,
      candles,
    },
    relatedMarkets,
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance,
    clock: {
      now: row.timestamp,
    },
  };
}

function cloneCandles(candles: BotlabCandle[]): BotlabCandle[] {
  return candles.map((candle) => ({ ...candle }));
}

function cloneRecentCandles(candles: BotlabCandle[]): BotlabCandle[] {
  return cloneCandles(candles.slice(-MAX_CONTEXT_CANDLES));
}

function calculateMaxDrawdownPct(equityCurve: BacktestEquityPoint[]): number {
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

function formatRowLabel(row: BacktestRow, index: number): string {
  return `${index + 1} (${row.market} @ ${row.timestamp})`;
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

function buildRelatedMarkets(
  currentAsset: string,
  timeframe: string,
  historyByAssetTimeframe: Map<string, BotlabCandle[]>,
  latestRowByAssetTimeframe: Map<string, BacktestRow>,
): BotlabRelatedMarketRuntime[] {
  const relatedMarkets: BotlabRelatedMarketRuntime[] = [];

  for (const [key, history] of historyByAssetTimeframe.entries()) {
    if (history.length === 0) {
      continue;
    }

    const latestRow = latestRowByAssetTimeframe.get(key);
    if (!latestRow) {
      continue;
    }

    const asset = parseAsset(latestRow.market);
    if (asset === currentAsset || latestRow.timeframe !== timeframe) {
      continue;
    }

    const latestCandle = history.at(-1);
    if (!latestCandle) {
      continue;
    }

    relatedMarkets.push({
      asset,
      symbol: latestRow.market,
      timeframe: latestRow.timeframe,
      price: latestCandle.close,
      upPrice: latestRow.upPrice,
      downPrice: latestRow.downPrice,
      upAsk: latestRow.upAsk,
      downAsk: latestRow.downAsk,
      volume: latestCandle.volume,
      timestamp: latestCandle.timestamp,
      candles: cloneRecentCandles(history),
    });
  }

  relatedMarkets.sort((left, right) => left.asset.localeCompare(right.asset));

  return relatedMarkets;
}

export async function runBatchBacktest(input: RunBatchBacktestInput): Promise<BatchBacktestResult> {
  const registry = await createStrategyRegistry(input.strategyDir);
  const strategy = registry.getById(input.strategyId);
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];
  const historyByAsset = new Map<string, BotlabCandle[]>();
  const historyByAssetTimeframe = new Map<string, BotlabCandle[]>();
  const latestRowByAssetTimeframe = new Map<string, BacktestRow>();
  const lastTimestampByAsset = new Map<string, number>();

  let cash = input.startingBalance;
  let feeTotal = 0;
  let upTradeCount = 0;
  let downTradeCount = 0;
  let skippedCount = 0;
  let winCount = 0;
  let lossCount = 0;

  const timestampGroups = groupRowsByTimestamp(input.rows);

  for (const group of timestampGroups) {
    const pendingUpdates: Array<{
      asset: string;
      assetTimeframeKey: string;
      row: BacktestRow;
      candle: BotlabCandle;
      timestamp: number;
    }> = [];
    const seenAssetsInGroup = new Set<string>();

    for (const { row, index } of group) {
      if (row.outcome !== 'up' && row.outcome !== 'down') {
        throw new Error(`Batch backtest row ${formatRowLabel(row, index)} is missing outcome`);
      }

      const asset = parseAsset(row.market);
      const currentTimestamp = parseTimestamp(row.timestamp);
      const lastTimestamp = lastTimestampByAsset.get(asset);

      if (lastTimestamp !== undefined && currentTimestamp <= lastTimestamp) {
        throw new Error(`Batch backtest rows for ${asset} must be in chronological order and unique by timestamp`);
      }

      if (seenAssetsInGroup.has(asset)) {
        throw new Error(`Batch backtest rows for ${asset} must be in chronological order and unique by timestamp`);
      }

      seenAssetsInGroup.add(asset);

      const assetTimeframeKey = `${asset}|${row.timeframe}`;
      const history = historyByAsset.get(asset) ?? [];
      const candles = cloneRecentCandles(history);
      const previousClose = history.at(-1)?.close ?? row.upPrice;
      const relatedMarkets = buildRelatedMarkets(asset, row.timeframe, historyByAssetTimeframe, latestRowByAssetTimeframe);
      const context = buildContext(row, candles, relatedMarkets, previousClose, cash);
      const decision = strategy.evaluate(context, structuredClone(strategy.defaults));

      if (decision.action === 'sell') {
        throw new Error(`Batch backtest strategy returned sell for row ${formatRowLabel(row, index)}`);
      }

      pendingUpdates.push({
        asset,
        assetTimeframeKey,
        row,
        candle: buildCandle(row, previousClose),
        timestamp: currentTimestamp,
      });

      if (decision.action !== 'buy') {
        skippedCount++;
        equityCurve.push({
          timestamp: row.timestamp,
          cash,
          equity: cash,
        });
        continue;
      }

      const side = decision.side;
      if (side !== 'up' && side !== 'down') {
        throw new Error(`Batch backtest strategy must choose side up or down for row ${formatRowLabel(row, index)}`);
      }

      const quotedPrice = getEntryAsk(row, side);
      const openPrice = clampPrice(quotedPrice + input.slippage);

      let requestedSize = cash;
      if (decision.size !== undefined) {
        if (typeof decision.size !== 'number' || !Number.isFinite(decision.size) || decision.size <= 0) {
          throw new Error(`Batch backtest strategy returned invalid size for row ${formatRowLabel(row, index)}`);
        }

        requestedSize = Math.min(cash, decision.size);
      }

      const perShareCost = openPrice + calculateFee(input.feeModel, 1, openPrice);
      const shares = Math.floor((requestedSize * 100) / perShareCost) / 100;

      if (shares <= 0) {
        skippedCount++;
        equityCurve.push({
          timestamp: row.timestamp,
          cash,
          equity: cash,
        });
        continue;
      }

      const openFee = calculateFee(input.feeModel, shares, openPrice);
      const totalCost = shares * openPrice + openFee;

      if (totalCost > cash) {
        skippedCount++;
        equityCurve.push({
          timestamp: row.timestamp,
          cash,
          equity: cash,
        });
        continue;
      }

      cash -= totalCost;

      const closePrice = row.outcome === side ? 1 : 0;
      const closeFee = calculateFee(input.feeModel, shares, closePrice);
      const proceeds = shares * closePrice;
      const feesPaid = openFee + closeFee;
      const realizedPnl = proceeds - feesPaid - (shares * openPrice);

      cash += proceeds - closeFee;
      feeTotal += feesPaid;
      if (side === 'up') {
        upTradeCount++;
      } else {
        downTradeCount++;
      }
      if (realizedPnl > 0) {
        winCount++;
      } else if (realizedPnl < 0) {
        lossCount++;
      }

      trades.push({
        side,
        entryTimestamp: row.timestamp,
        exitTimestamp: row.timestamp,
        entryPrice: openPrice,
        exitPrice: closePrice,
        shares,
        feesPaid,
        realizedPnl,
      });
      equityCurve.push({
        timestamp: row.timestamp,
        cash,
        equity: cash,
      });
    }

    for (const update of pendingUpdates) {
      const history = historyByAsset.get(update.asset) ?? [];
      history.push(update.candle);
      historyByAsset.set(update.asset, history);

      const timeframeHistory = historyByAssetTimeframe.get(update.assetTimeframeKey) ?? [];
      timeframeHistory.push(update.candle);
      historyByAssetTimeframe.set(update.assetTimeframeKey, timeframeHistory);
      latestRowByAssetTimeframe.set(update.assetTimeframeKey, update.row);
      lastTimestampByAsset.set(update.asset, update.timestamp);
    }
  }

  const endingEquity = equityCurve.at(-1)?.equity ?? input.startingBalance;

  return {
    equityCurve,
    trades,
    summary: {
      tradeCount: trades.length,
      upTradeCount,
      downTradeCount,
      skippedCount,
      winCount,
      lossCount,
      feeTotal,
      endingEquity,
      returnPct: input.startingBalance === 0
        ? 0
        : ((endingEquity - input.startingBalance) / input.startingBalance) * 100,
      maxDrawdownPct: calculateMaxDrawdownPct(equityCurve),
      settled: true,
    } satisfies BatchBacktestSummary,
  };
}
