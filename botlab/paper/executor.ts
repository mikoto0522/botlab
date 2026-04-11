import { calculateFee, type BacktestFeeModel } from '../backtest/fees.js';
import type { BotlabStrategyDecision } from '../core/types.js';
import {
  previewBuyExecution,
  previewSellExecution,
  type BuyExecutionPreview,
  type ExecutionFillLevel,
  type SellExecutionPreview,
} from '../execution/order-book.js';
import type { PaperMarketSnapshot } from './market-source.js';
import type {
  PaperSessionAsset,
  PaperSessionPosition,
  PaperSessionPredictionSide,
  PaperSessionState,
} from './types.js';

export type PaperExecutionFillLevel = ExecutionFillLevel;

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

type PaperBuyExecution = BuyExecutionPreview;
type PaperSellExecution = SellExecutionPreview;

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

function getExitPrice(snapshot: PaperMarketSnapshot, side: PaperSessionPredictionSide): number {
  return side === 'up'
    ? snapshot.upPrice ?? 0
    : snapshot.downPrice ?? 0;
}

function getMarkExitLiquidityLevels(
  snapshot: PaperMarketSnapshot,
  side: PaperSessionPredictionSide,
): Array<{ price: number; size: number }> {
  const orderBook = side === 'up' ? snapshot.upOrderBook : snapshot.downOrderBook;
  if (orderBook && orderBook.bids.length > 0) {
    return orderBook.bids;
  }

  const fallbackPrice = getExitPrice(snapshot, side);
  return Number.isFinite(fallbackPrice) && fallbackPrice >= 0 && fallbackPrice <= 1
    ? [{ price: fallbackPrice, size: Number.MAX_SAFE_INTEGER }]
    : [];
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

  const levels = getMarkExitLiquidityLevels(snapshot, side);
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

  const execution = previewBuyExecution(snapshot, side, requestedStake, feeModel, {
    allowQuotedFallback: true,
  });
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

  const execution = previewSellExecution(snapshot, side, requestedShares, feeModel);
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
