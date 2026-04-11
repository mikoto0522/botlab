import { calculateFee, type BacktestFeeModel } from '../backtest/fees.js';
import type { BotlabStrategyDecision } from '../core/types.js';
import type { PaperMarketSnapshot, PaperOrderBookLevel } from './market-source.js';
import type {
  PaperSessionAsset,
  PaperSessionPosition,
  PaperSessionPredictionSide,
  PaperSessionState,
} from './types.js';

export interface PaperExecutionFillLevel {
  price: number;
  shares: number;
  grossAmount: number;
  fee: number;
}

export interface OpenPaperPositionResult {
  asset: PaperSessionAsset;
  marketSlug: string;
  side: PaperSessionPredictionSide;
  requestedStake: number;
  shares: number;
  stake: number;
  entryPrice: number;
  entryFee: number;
  totalCost: number;
  partialFill: boolean;
  levelsConsumed: number;
  bookVisible: boolean;
  quotedPrice: number | null;
  fills: PaperExecutionFillLevel[];
  openedAt: string;
  position: PaperSessionPosition;
}

export interface SettlePaperPositionResult {
  asset: PaperSessionAsset;
  marketSlug: string;
  side: PaperSessionPredictionSide;
  shares: number;
  entryPrice: number;
  exitPrice: number;
  entryFee: number;
  closeFee: number;
  feesPaid: number;
  proceeds: number;
  realizedPnl: number;
  settledAt: string;
}

export interface ClosePaperPositionResult {
  asset: PaperSessionAsset;
  marketSlug: string;
  side: PaperSessionPredictionSide;
  requestedShares: number;
  shares: number;
  remainingShares: number;
  entryPrice: number;
  exitPrice: number;
  entryFee: number;
  closeFee: number;
  feesPaid: number;
  proceeds: number;
  realizedPnl: number;
  partialFill: boolean;
  levelsConsumed: number;
  fills: PaperExecutionFillLevel[];
  closedAt: string;
}

interface PaperBuyExecution {
  requestedStake: number;
  shares: number;
  avgPrice: number;
  totalCost: number;
  totalFee: number;
  partialFill: boolean;
  levelsConsumed: number;
  bookVisible: boolean;
  quotedPrice: number | null;
  fills: PaperExecutionFillLevel[];
}

interface PaperSellExecution {
  requestedShares: number;
  shares: number;
  remainingShares: number;
  avgPrice: number;
  proceeds: number;
  totalFee: number;
  partialFill: boolean;
  levelsConsumed: number;
  fills: PaperExecutionFillLevel[];
}

interface PaperLiquidityLevels {
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

function toPositionSide(side: PaperSessionPredictionSide): PaperSessionPosition['side'] {
  return side === 'up' ? 'long' : 'short';
}

function inferPredictionSide(position: PaperSessionPosition): PaperSessionPredictionSide | null {
  if (position.predictionSide === 'up' || position.predictionSide === 'down') {
    return position.predictionSide;
  }
  if (position.side === 'long') {
    return 'up';
  }
  if (position.side === 'short') {
    return 'down';
  }

  return null;
}

function getEntryPrice(snapshot: PaperMarketSnapshot, side: PaperSessionPredictionSide): number {
  return side === 'up'
    ? snapshot.upAsk ?? snapshot.upPrice ?? 0
    : snapshot.downAsk ?? snapshot.downPrice ?? 0;
}

function getExitPrice(snapshot: PaperMarketSnapshot, side: PaperSessionPredictionSide): number {
  return side === 'up'
    ? snapshot.upPrice ?? 0
    : snapshot.downPrice ?? 0;
}

function getEntryLiquidityLevels(
  snapshot: PaperMarketSnapshot,
  side: PaperSessionPredictionSide,
): PaperLiquidityLevels {
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

function getExitLiquidityLevels(
  snapshot: PaperMarketSnapshot,
  side: PaperSessionPredictionSide,
): PaperLiquidityLevels {
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

function readBestOutcomeAsk(snapshot: PaperMarketSnapshot, side: PaperSessionPredictionSide): number | null {
  const orderBook = side === 'up' ? snapshot.upOrderBook : snapshot.downOrderBook;
  const orderBookAsk = orderBook?.asks[0]?.price;
  if (isFinitePositiveNumber(orderBookAsk)) {
    return orderBookAsk;
  }

  const fallbackAsk = side === 'up' ? snapshot.upAsk : snapshot.downAsk;
  return isFinitePositiveNumber(fallbackAsk) ? fallbackAsk : null;
}

function hasOnlyPlaceholderOutcomeAsks(snapshot: PaperMarketSnapshot): boolean {
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

function executeBuyAgainstOrderBook(
  snapshot: PaperMarketSnapshot,
  side: PaperSessionPredictionSide,
  requestedStake: number,
  feeModel: BacktestFeeModel,
): PaperBuyExecution | null {
  const { levels, depthVisible, quotedPrice } = getEntryLiquidityLevels(snapshot, side);
  let remainingBudget = requestedStake;
  let totalShares = 0;
  let grossCost = 0;
  let totalFee = 0;
  const fills: PaperExecutionFillLevel[] = [];

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
    fills.push({
      price: level.price,
      shares,
      grossAmount,
      fee,
    });
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

function executeSellAgainstOrderBook(
  snapshot: PaperMarketSnapshot,
  side: PaperSessionPredictionSide,
  requestedShares: number,
  feeModel: BacktestFeeModel,
): PaperSellExecution | null {
  const { levels, depthVisible } = getExitLiquidityLevels(snapshot, side);
  let remainingShares = requestedShares;
  let totalShares = 0;
  let proceeds = 0;
  let totalFee = 0;
  const fills: PaperExecutionFillLevel[] = [];

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
    fills.push({
      price: level.price,
      shares,
      grossAmount,
      fee,
    });

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
    fills,
  };
}

export function hasOpenPaperPosition(position: PaperSessionPosition | undefined): position is PaperSessionPosition {
  return Boolean(
    position
    && position.side !== 'flat'
    && isFinitePositiveNumber(position.size)
    && typeof position.entryPrice === 'number'
    && Number.isFinite(position.entryPrice),
  );
}

export function markPaperPositionValue(
  position: PaperSessionPosition,
  snapshot: PaperMarketSnapshot,
): number {
  const side = inferPredictionSide(position);
  if (!side) {
    return 0;
  }

  const shares = position.shares ?? position.size;
  if (!isFinitePositiveNumber(shares)) {
    return 0;
  }

  const { levels } = getExitLiquidityLevels(snapshot, side);
  let remainingShares = shares;
  let value = 0;

  for (const level of levels) {
    if (!isFinitePositiveNumber(level.size) || !Number.isFinite(level.price) || level.price < 0 || level.price > 1) {
      continue;
    }

    const fillShares = floorShares(Math.min(remainingShares, level.size));
    if (!isFinitePositiveNumber(fillShares)) {
      continue;
    }

    value += fillShares * level.price;
    remainingShares = floorShares(remainingShares - fillShares);
    if (remainingShares <= 0) {
      break;
    }
  }

  return value;
}

export function calculatePaperSessionEquity(
  state: PaperSessionState,
  markSnapshots: Partial<Record<PaperSessionAsset, PaperMarketSnapshot>>,
): number {
  let equity = state.cash;

  for (const asset of ['BTC', 'ETH'] as const) {
    const position = state.positions[asset];
    const snapshot = markSnapshots[asset];
    if (!hasOpenPaperPosition(position) || !snapshot) {
      continue;
    }

    equity += markPaperPositionValue(position, snapshot);
  }

  return equity;
}

export function openPaperPosition(
  state: PaperSessionState,
  asset: PaperSessionAsset,
  snapshot: PaperMarketSnapshot,
  decision: BotlabStrategyDecision,
  feeModel: BacktestFeeModel,
  openedAt = snapshot.fetchedAt,
): OpenPaperPositionResult | null {
  if (decision.action !== 'buy') {
    return null;
  }

  const side = decision.side;
  if (side !== 'up' && side !== 'down') {
    throw new Error(`Paper strategy must choose side up or down for ${asset} @ ${snapshot.slug}`);
  }
  if (!isFinitePositiveNumber(decision.size)) {
    throw new Error(`Paper strategy returned invalid size for ${asset} @ ${snapshot.slug}`);
  }
  if (hasOpenPaperPosition(state.positions[asset])) {
    return null;
  }

  const requestedStake = Math.min(state.cash, decision.size);
  if (!isFinitePositiveNumber(requestedStake)) {
    return null;
  }

  const execution = executeBuyAgainstOrderBook(snapshot, side, requestedStake, feeModel);
  if (!execution || !isFinitePositiveNumber(execution.totalCost) || execution.totalCost > state.cash + 1e-9) {
    return null;
  }

  const position: PaperSessionPosition = {
    asset,
    side: toPositionSide(side),
    predictionSide: side,
    size: execution.shares,
    shares: execution.shares,
    stake: execution.totalCost,
    entryPrice: execution.avgPrice,
    entryFee: execution.totalFee,
    marketSlug: snapshot.slug,
    openedAt,
    bucketStartTime: snapshot.bucketStartTime,
    endDate: snapshot.endDate,
  };

  state.cash -= execution.totalCost;
  state.positions[asset] = position;
  state.tradeCount += 1;

  return {
    asset,
    marketSlug: snapshot.slug,
    side,
    requestedStake,
    shares: execution.shares,
    stake: execution.totalCost,
    entryPrice: execution.avgPrice,
    entryFee: execution.totalFee,
    totalCost: execution.totalCost,
    partialFill: execution.partialFill,
    levelsConsumed: execution.levelsConsumed,
    bookVisible: execution.bookVisible,
    quotedPrice: execution.quotedPrice,
    fills: execution.fills,
    openedAt,
    position,
  };
}

export function settlePaperPosition(
  state: PaperSessionState,
  asset: PaperSessionAsset,
  position: PaperSessionPosition,
  snapshot: PaperMarketSnapshot,
  feeModel: BacktestFeeModel,
  settledAt = snapshot.fetchedAt,
): SettlePaperPositionResult {
  const side = inferPredictionSide(position);
  if (!side) {
    throw new Error(`Paper position for ${asset} is missing prediction side`);
  }
  if (!snapshot.closed) {
    throw new Error(`Paper position for ${asset} cannot settle before market ${snapshot.slug} is closed`);
  }

  const shares = position.shares ?? position.size;
  const entryPrice = position.entryPrice;
  if (!isFinitePositiveNumber(shares) || !isFinitePositiveNumber(entryPrice)) {
    throw new Error(`Paper position for ${asset} is missing entry details needed for settlement`);
  }

  const exitPrice = getExitPrice(snapshot, side);
  const closeFee = calculateFee(feeModel, shares, exitPrice);
  const proceeds = shares * exitPrice;
  const entryFee = position.entryFee ?? 0;
  const feesPaid = entryFee + closeFee;
  const realizedPnl = proceeds - feesPaid - (shares * entryPrice);

  state.cash += proceeds - closeFee;
  delete state.positions[asset];

  return {
    asset,
    marketSlug: position.marketSlug ?? snapshot.slug,
    side,
    shares,
    entryPrice,
    exitPrice,
    entryFee,
    closeFee,
    feesPaid,
    proceeds,
    realizedPnl,
    settledAt,
  };
}

export function closePaperPosition(
  state: PaperSessionState,
  asset: PaperSessionAsset,
  position: PaperSessionPosition,
  snapshot: PaperMarketSnapshot,
  feeModel: BacktestFeeModel,
  closedAt = snapshot.fetchedAt,
): ClosePaperPositionResult | null {
  const side = inferPredictionSide(position);
  if (!side) {
    throw new Error(`Paper position for ${asset} is missing prediction side`);
  }

  const requestedShares = position.shares ?? position.size;
  const entryPrice = position.entryPrice;
  if (!isFinitePositiveNumber(requestedShares) || !isFinitePositiveNumber(entryPrice)) {
    throw new Error(`Paper position for ${asset} is missing entry details needed to close`);
  }

  const execution = executeSellAgainstOrderBook(snapshot, side, requestedShares, feeModel);
  if (!execution) {
    return null;
  }

  const totalEntryFee = position.entryFee ?? 0;
  const entryFee = totalEntryFee * (execution.shares / requestedShares);
  const remainingEntryFee = totalEntryFee - entryFee;
  const feesPaid = entryFee + execution.totalFee;
  const realizedPnl = execution.proceeds - feesPaid - (execution.shares * entryPrice);

  state.cash += execution.proceeds - execution.totalFee;

  if (execution.remainingShares > 0) {
    state.positions[asset] = {
      ...position,
      size: execution.remainingShares,
      shares: execution.remainingShares,
      stake: (execution.remainingShares * entryPrice) + remainingEntryFee,
      entryFee: remainingEntryFee,
    };
  } else {
    delete state.positions[asset];
  }

  return {
    asset,
    marketSlug: position.marketSlug ?? snapshot.slug,
    side,
    requestedShares,
    shares: execution.shares,
    remainingShares: execution.remainingShares,
    entryPrice,
    exitPrice: execution.avgPrice,
    entryFee,
    closeFee: execution.totalFee,
    feesPaid,
    proceeds: execution.proceeds,
    realizedPnl,
    partialFill: execution.partialFill,
    levelsConsumed: execution.levelsConsumed,
    fills: execution.fills,
    closedAt,
  };
}
