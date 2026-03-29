import type { BacktestRow } from './csv.js';
import { calculateFee, type BacktestFeeModel } from './fees.js';
import { createStrategyRegistry } from '../core/strategy-registry.js';
import { getStrategyParamOverrides, resolveStrategyParams } from '../core/strategy-params.js';
import type {
  BacktestEquityPoint,
  BacktestSummary,
  BacktestTrade,
  BotlabCandle,
  BotlabStrategyContext,
  PredictionSide,
} from '../core/types.js';

export interface RunBacktestInput {
  strategyId: string;
  strategyDir: string;
  startingBalance: number;
  strategyParams?: Record<string, Record<string, unknown>>;
  signalSide: Exclude<PredictionSide, 'flat'>;
  slippage: number;
  feeModel: BacktestFeeModel;
  rows: BacktestRow[];
}

export interface RunBacktestResult {
  equityCurve: BacktestEquityPoint[];
  trades: BacktestTrade[];
  summary: BacktestSummary;
}

function clampPrice(price: number): number {
  return Math.max(0.01, Math.min(0.99, Number(price.toFixed(6))));
}

function getEntryAsk(row: BacktestRow, side: Exclude<PredictionSide, 'flat'>): number {
  if (side === 'up') {
    return row.upAsk ?? row.upPrice;
  }

  return row.downAsk ?? row.downPrice;
}

function getExitBid(row: BacktestRow, side: Exclude<PredictionSide, 'flat'>): number {
  if (side === 'up') {
    return row.upBid ?? row.upPrice;
  }

  return row.downBid ?? row.downPrice;
}

function parseAsset(market: string): string {
  return market.split('-')[0] ?? market;
}

function buildCandleWindow(rows: BacktestRow[], endIndex: number, side: Exclude<PredictionSide, 'flat'>): BotlabCandle[] {
  return rows.slice(0, endIndex + 1).map((row, index, windowRows) => {
    const currentPrice = side === 'up' ? row.upPrice : row.downPrice;
    const previousPrice = index === 0
      ? currentPrice
      : side === 'up'
        ? windowRows[index - 1]?.upPrice ?? currentPrice
        : windowRows[index - 1]?.downPrice ?? currentPrice;

    return {
      timestamp: row.timestamp,
      open: previousPrice,
      high: Math.max(previousPrice, currentPrice),
      low: Math.min(previousPrice, currentPrice),
      close: currentPrice,
      volume: row.volume,
    };
  });
}

function markToMarket(row: BacktestRow, currentSide: PredictionSide, currentShares: number): number {
  if (currentSide === 'flat' || currentShares <= 0) {
    return 0;
  }

  const price = getExitBid(row, currentSide);
  return currentShares * price;
}

function buildContext(
  row: BacktestRow,
  candles: BotlabCandle[],
  balance: number,
  currentShares: number,
  entryPrice: number | null,
): BotlabStrategyContext {
  return {
    mode: 'dry-run',
    market: {
      asset: parseAsset(row.market),
      symbol: row.market,
      timeframe: row.timeframe,
      price: candles.at(-1)?.close ?? row.upPrice,
      changePct24h: 0,
      momentum: 0,
      volume: row.volume,
      timestamp: row.timestamp,
      candles,
    },
    position: {
      side: currentShares > 0 ? 'long' : 'flat',
      size: currentShares,
      entryPrice,
    },
    balance,
    clock: {
      now: row.timestamp,
    },
  };
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

export async function runBacktest(input: RunBacktestInput): Promise<RunBacktestResult> {
  const registry = await createStrategyRegistry(input.strategyDir);
  const strategy = registry.getById(input.strategyId);
  const strategyParams = getStrategyParamOverrides(input.strategyParams, input.strategyId);
  const rows = input.rows;
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];

  let cash = input.startingBalance;
  let currentSide: PredictionSide = 'flat';
  let currentShares = 0;
  let entryPrice: number | null = null;
  let entryFee = 0;
  let entryTimestamp: string | null = null;
  let feeTotal = 0;
  let settled = false;

  for (const [index, row] of rows.entries()) {
    const markValue = markToMarket(row, currentSide, currentShares);
    const balance = cash + markValue;
    const candles = buildCandleWindow(rows, index, input.signalSide);
    const context = buildContext(row, candles, balance, currentShares, entryPrice);
    const decision = strategy.evaluate(context, resolveStrategyParams(strategy.defaults, strategyParams));

    if (decision.action === 'buy' && currentSide === 'flat') {
      const quotedOpen = getEntryAsk(row, input.signalSide);
      const openPrice = clampPrice(quotedOpen + input.slippage);
      const perShareCost = openPrice + calculateFee(input.feeModel, 1, openPrice);
      const buyBudget = Number.isFinite(decision.size) && (decision.size ?? 0) > 0
        ? Math.min(cash, decision.size ?? cash)
        : cash;
      const shares = Math.floor((buyBudget * 100) / perShareCost) / 100;
      const openFee = calculateFee(input.feeModel, shares, openPrice);
      const totalCost = shares * openPrice + openFee;

      if (shares > 0 && totalCost <= cash) {
        cash -= totalCost;
        currentSide = input.signalSide;
        currentShares = shares;
        entryPrice = openPrice;
        entryFee = openFee;
        entryTimestamp = row.timestamp;
        feeTotal += openFee;
      }
    }

    if (index === rows.length - 1 && row.outcome && currentSide !== 'flat' && entryPrice !== null && entryTimestamp !== null) {
      const settledPrice = currentSide === row.outcome ? 1 : 0;
      const closeFee = calculateFee(input.feeModel, currentShares, settledPrice);
      const proceeds = currentShares * settledPrice;
      const feesPaid = entryFee + closeFee;
      const realizedPnl = proceeds - feesPaid - (currentShares * entryPrice);

      cash += proceeds - closeFee;
      feeTotal += closeFee;
      trades.push({
        side: currentSide,
        entryTimestamp,
        exitTimestamp: row.timestamp,
        entryPrice,
        exitPrice: settledPrice,
        shares: currentShares,
        feesPaid,
        realizedPnl,
      });
      currentSide = 'flat';
      currentShares = 0;
      entryPrice = null;
      entryFee = 0;
      entryTimestamp = null;
      settled = true;
    } else if (decision.action === 'sell' && currentSide !== 'flat' && entryPrice !== null && entryTimestamp !== null) {
      const quotedClose = getExitBid(row, currentSide);
      const closePrice = clampPrice(quotedClose - input.slippage);
      const closeFee = calculateFee(input.feeModel, currentShares, closePrice);
      const proceeds = currentShares * closePrice;
      const feesPaid = entryFee + closeFee;
      const realizedPnl = proceeds - feesPaid - (currentShares * entryPrice);

      cash += proceeds - closeFee;
      feeTotal += closeFee;
      trades.push({
        side: currentSide,
        entryTimestamp,
        exitTimestamp: row.timestamp,
        entryPrice,
        exitPrice: closePrice,
        shares: currentShares,
        feesPaid,
        realizedPnl,
      });
      currentSide = 'flat';
      currentShares = 0;
      entryPrice = null;
      entryFee = 0;
      entryTimestamp = null;
    } else if (index === rows.length - 1 && row.outcome) {
      settled = true;
    }

    equityCurve.push({
      timestamp: row.timestamp,
      cash,
      equity: cash + markToMarket(row, currentSide, currentShares),
    });
  }

  const endingEquity = equityCurve.at(-1)?.equity ?? input.startingBalance;
  const winCount = trades.filter((trade) => trade.realizedPnl > 0).length;
  const lossCount = trades.filter((trade) => trade.realizedPnl < 0).length;

  return {
    equityCurve,
    trades,
    summary: {
      tradeCount: trades.length,
      winCount,
      lossCount,
      feeTotal,
      endingEquity,
      returnPct: input.startingBalance === 0
        ? 0
        : ((endingEquity - input.startingBalance) / input.startingBalance) * 100,
      maxDrawdownPct: calculateMaxDrawdownPct(equityCurve),
      settled,
    },
  };
}
