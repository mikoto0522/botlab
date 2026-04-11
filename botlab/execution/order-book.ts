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

export const DEFAULT_MAX_PRICE_SLIPPAGE_PCT = 0.05;

interface LiquidityLevels {
  levels: PaperOrderBookLevel[];
  depthVisible: boolean;
  quotedPrice: number | null;
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
    levels: [],
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
  return {
    levels: [],
    depthVisible: false,
    quotedPrice: Number.isFinite(fallbackPrice) && fallbackPrice >= 0 && fallbackPrice <= 1
      ? fallbackPrice
      : null,
  };
}

export function previewBuyExecution(
  snapshot: PaperMarketSnapshot,
  side: OutcomeSide,
  requestedStake: number,
  feeModel: BacktestFeeModel,
): BuyExecutionPreview | null {
  const { levels, depthVisible, quotedPrice } = getEntryLiquidityLevels(snapshot, side);
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

export function applyBuySlippageLimit(
  preview: BuyExecutionPreview,
  maxPriceSlippagePct: number,
): BuyExecutionPreview | null {
  const anchorPrice = preview.fills[0]?.price ?? preview.avgPrice;
  if (!isFinitePositiveNumber(anchorPrice)) {
    return null;
  }

  const maxAllowedPrice = anchorPrice * (1 + Math.max(0, maxPriceSlippagePct));
  const fills = preview.fills.filter((fill) => fill.price <= maxAllowedPrice + 1e-9);
  const shares = fills.reduce((sum, fill) => sum + fill.shares, 0);
  if (!isFinitePositiveNumber(shares)) {
    return null;
  }

  const grossCost = fills.reduce((sum, fill) => sum + fill.grossAmount, 0);
  const totalFee = fills.reduce((sum, fill) => sum + fill.fee, 0);

  return {
    requestedStake: preview.requestedStake,
    shares,
    avgPrice: grossCost / shares,
    totalCost: grossCost + totalFee,
    totalFee,
    partialFill: preview.requestedStake - (grossCost + totalFee) > 1e-9,
    levelsConsumed: fills.length,
    bookVisible: preview.bookVisible,
    quotedPrice: preview.quotedPrice,
    fills,
  };
}

export function wasExecutionTrimmed<
  T extends { fills: ExecutionFillLevel[]; shares: number },
>(original: T, limited: T): boolean {
  return limited.fills.length < original.fills.length || limited.shares + 1e-9 < original.shares;
}

export function guardBuyExecution(
  preview: BuyExecutionPreview,
  maxPriceSlippagePct: number,
): BuyExecutionPreview | null {
  const limitedPreview = applyBuySlippageLimit(preview, maxPriceSlippagePct);
  if (!limitedPreview || wasExecutionTrimmed(preview, limitedPreview)) {
    return null;
  }

  return limitedPreview;
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

export function applySellSlippageLimit(
  preview: SellExecutionPreview,
  maxPriceSlippagePct: number,
): SellExecutionPreview | null {
  const anchorPrice = preview.fills[0]?.price ?? preview.avgPrice;
  if (!Number.isFinite(anchorPrice) || anchorPrice < 0) {
    return null;
  }

  const minAllowedPrice = anchorPrice * (1 - Math.max(0, maxPriceSlippagePct));
  const fills = preview.fills.filter((fill) => fill.price + 1e-9 >= minAllowedPrice);
  const shares = fills.reduce((sum, fill) => sum + fill.shares, 0);
  if (!isFinitePositiveNumber(shares)) {
    return null;
  }

  const proceeds = fills.reduce((sum, fill) => sum + fill.grossAmount, 0);
  const totalFee = fills.reduce((sum, fill) => sum + fill.fee, 0);

  return {
    requestedShares: preview.requestedShares,
    shares,
    remainingShares: floorShares(Math.max(0, preview.requestedShares - shares)),
    avgPrice: proceeds / shares,
    proceeds,
    totalFee,
    partialFill: shares + 1e-9 < preview.requestedShares,
    levelsConsumed: fills.length,
    bookVisible: preview.bookVisible,
    quotedPrice: preview.quotedPrice,
    fills,
  };
}

export function guardSellExecution(
  preview: SellExecutionPreview,
  maxPriceSlippagePct: number,
): SellExecutionPreview | null {
  const limitedPreview = applySellSlippageLimit(preview, maxPriceSlippagePct);
  if (!limitedPreview || wasExecutionTrimmed(preview, limitedPreview)) {
    return null;
  }

  return limitedPreview;
}
