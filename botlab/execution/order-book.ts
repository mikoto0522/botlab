import { calculateFee, type BacktestFeeModel } from '../backtest/fees.js';
import type { PaperMarketSnapshot, PaperOrderBookLevel } from '../paper/market-source.js';

export type OutcomeSide = 'up' | 'down';

export interface ExecutionFillLevel {
  price: number;
  shares: number;
  grossAmount: number;
  fee: number;
}

export interface BuyExecutionPreview {
  requestedStake: number;
  shares: number;
  avgPrice: number;
  totalCost: number;
  totalFee: number;
  partialFill: boolean;
  levelsConsumed: number;
  bookVisible: boolean;
  quotedPrice: number | null;
  fills: ExecutionFillLevel[];
}

export interface BuyExecutionPreviewOptions {
  allowQuotedFallback?: boolean;
}

export interface SellExecutionPreview {
  requestedShares: number;
  shares: number;
  remainingShares: number;
  avgPrice: number;
  proceeds: number;
  totalFee: number;
  partialFill: boolean;
  levelsConsumed: number;
  bookVisible: boolean;
  quotedPrice: number | null;
  fills: ExecutionFillLevel[];
}

interface LiquidityLevels {
  levels: PaperOrderBookLevel[];
  depthVisible: boolean;
  quotedPrice: number | null;
}

function createQuotedFallbackLevel(quotedPrice: number | null): PaperOrderBookLevel[] {
  if (!isFinitePositiveNumber(quotedPrice)) {
    return [];
  }

  return [{ price: quotedPrice, size: Number.MAX_SAFE_INTEGER }];
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function floorShares(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor((value + Number.EPSILON) * 100) / 100;
}

function getEntryPrice(snapshot: PaperMarketSnapshot, side: OutcomeSide): number {
  return side === 'up'
    ? snapshot.upAsk ?? snapshot.upPrice ?? 0
    : snapshot.downAsk ?? snapshot.downPrice ?? 0;
}

function getExitPrice(snapshot: PaperMarketSnapshot, side: OutcomeSide): number {
  return side === 'up'
    ? snapshot.upPrice ?? 0
    : snapshot.downPrice ?? 0;
}

export function readBestOutcomeAsk(snapshot: PaperMarketSnapshot, side: OutcomeSide): number | null {
  const orderBook = side === 'up' ? snapshot.upOrderBook : snapshot.downOrderBook;
  const orderBookAsk = orderBook?.asks[0]?.price;
  if (isFinitePositiveNumber(orderBookAsk)) {
    return orderBookAsk;
  }

  const fallbackAsk = side === 'up' ? snapshot.upAsk : snapshot.downAsk;
  return isFinitePositiveNumber(fallbackAsk) ? fallbackAsk : null;
}

export function hasOnlyPlaceholderOutcomeAsks(snapshot: PaperMarketSnapshot): boolean {
  const upBestAsk = readBestOutcomeAsk(snapshot, 'up');
  const downBestAsk = readBestOutcomeAsk(snapshot, 'down');
  if (upBestAsk === null || downBestAsk === null) {
    return false;
  }

  return (
    upBestAsk >= 0.95
    && downBestAsk >= 0.95
    && snapshot.upPrice !== null
    && snapshot.upPrice > 0.05
    && snapshot.upPrice < 0.95
    && snapshot.downPrice !== null
    && snapshot.downPrice > 0.05
    && snapshot.downPrice < 0.95
  );
}

function getEntryLiquidityLevels(
  snapshot: PaperMarketSnapshot,
  side: OutcomeSide,
  options: BuyExecutionPreviewOptions,
): LiquidityLevels {
  if (hasOnlyPlaceholderOutcomeAsks(snapshot)) {
    return {
      levels: [],
      depthVisible: false,
      quotedPrice: readBestOutcomeAsk(snapshot, side),
    };
  }

  const orderBook = side === 'up' ? snapshot.upOrderBook : snapshot.downOrderBook;
  if (orderBook && orderBook.asks.length > 0) {
    return {
      levels: orderBook.asks,
      depthVisible: true,
      quotedPrice: readBestOutcomeAsk(snapshot, side),
    };
  }

  const fallbackPrice = getEntryPrice(snapshot, side);
  return {
    levels: options.allowQuotedFallback
      ? createQuotedFallbackLevel(isFinitePositiveNumber(fallbackPrice) ? fallbackPrice : null)
      : [],
    depthVisible: false,
    quotedPrice: isFinitePositiveNumber(fallbackPrice) ? fallbackPrice : null,
  };
}

function getExitLiquidityLevels(snapshot: PaperMarketSnapshot, side: OutcomeSide): LiquidityLevels {
  const orderBook = side === 'up' ? snapshot.upOrderBook : snapshot.downOrderBook;
  if (orderBook && orderBook.bids.length > 0) {
    return {
      levels: orderBook.bids,
      depthVisible: true,
      quotedPrice: orderBook.bids[0]?.price ?? null,
    };
  }

  const fallbackPrice = getExitPrice(snapshot, side);
  if (!Number.isFinite(fallbackPrice) || fallbackPrice < 0 || fallbackPrice > 1) {
    return {
      levels: [],
      depthVisible: false,
      quotedPrice: null,
    };
  }

  return {
    levels: [{ price: fallbackPrice, size: Number.MAX_SAFE_INTEGER }],
    depthVisible: false,
    quotedPrice: fallbackPrice,
  };
}

export function previewBuyExecution(
  snapshot: PaperMarketSnapshot,
  side: OutcomeSide,
  requestedStake: number,
  feeModel: BacktestFeeModel,
  options: BuyExecutionPreviewOptions = {},
): BuyExecutionPreview | null {
  const { levels, depthVisible, quotedPrice } = getEntryLiquidityLevels(snapshot, side, options);
  let remainingBudget = requestedStake;
  let totalShares = 0;
  let grossCost = 0;
  let totalFee = 0;
  const fills: ExecutionFillLevel[] = [];

  for (const level of levels) {
    if (!isFinitePositiveNumber(level.price) || !isFinitePositiveNumber(level.size)) {
      continue;
    }

    const perShareCost = level.price + calculateFee(feeModel, 1, level.price);
    if (!isFinitePositiveNumber(perShareCost)) {
      continue;
    }

    const affordableShares = floorShares(remainingBudget / perShareCost);
    const availableShares = floorShares(level.size);
    const shares = floorShares(Math.min(affordableShares, availableShares));
    if (!isFinitePositiveNumber(shares)) {
      continue;
    }

    const fee = calculateFee(feeModel, shares, level.price);
    const grossAmount = shares * level.price;
    const totalLevelCost = grossAmount + fee;
    if (!Number.isFinite(totalLevelCost) || totalLevelCost > remainingBudget + 1e-9) {
      continue;
    }

    remainingBudget -= totalLevelCost;
    totalShares += shares;
    grossCost += grossAmount;
    totalFee += fee;
    fills.push({ price: level.price, shares, grossAmount, fee });
  }

  if (!isFinitePositiveNumber(totalShares)) {
    return null;
  }

  return {
    requestedStake,
    shares: totalShares,
    avgPrice: grossCost / totalShares,
    totalCost: grossCost + totalFee,
    totalFee,
    partialFill: depthVisible && requestedStake - (grossCost + totalFee) > 1e-9,
    levelsConsumed: fills.length,
    bookVisible: depthVisible,
    quotedPrice,
    fills,
  };
}

export function previewSellExecution(
  snapshot: PaperMarketSnapshot,
  side: OutcomeSide,
  requestedShares: number,
  feeModel: BacktestFeeModel,
): SellExecutionPreview | null {
  const { levels, depthVisible, quotedPrice } = getExitLiquidityLevels(snapshot, side);
  let remainingShares = requestedShares;
  let totalShares = 0;
  let proceeds = 0;
  let totalFee = 0;
  const fills: ExecutionFillLevel[] = [];

  for (const level of levels) {
    if (!isFinitePositiveNumber(level.size) || !Number.isFinite(level.price) || level.price < 0 || level.price > 1) {
      continue;
    }

    const availableShares = floorShares(level.size);
    const shares = floorShares(Math.min(remainingShares, availableShares));
    if (!isFinitePositiveNumber(shares)) {
      continue;
    }

    const fee = calculateFee(feeModel, shares, level.price);
    const grossAmount = shares * level.price;

    remainingShares = floorShares(remainingShares - shares);
    totalShares += shares;
    proceeds += grossAmount;
    totalFee += fee;
    fills.push({ price: level.price, shares, grossAmount, fee });

    if (remainingShares <= 0) {
      break;
    }
  }

  if (!isFinitePositiveNumber(totalShares)) {
    return null;
  }

  return {
    requestedShares,
    shares: totalShares,
    remainingShares,
    avgPrice: proceeds / totalShares,
    proceeds,
    totalFee,
    partialFill: depthVisible && remainingShares > 0,
    levelsConsumed: fills.length,
    bookVisible: depthVisible,
    quotedPrice,
    fills,
  };
}
