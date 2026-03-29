import { calculateFee, type BacktestFeeModel } from '../backtest/fees.js';
import type { BotlabStrategyDecision } from '../core/types.js';
import type { PaperMarketSnapshot } from './market-source.js';
import type {
  PaperSessionAsset,
  PaperSessionPosition,
  PaperSessionPredictionSide,
  PaperSessionState,
} from './types.js';

export interface OpenPaperPositionResult {
  asset: PaperSessionAsset;
  marketSlug: string;
  side: PaperSessionPredictionSide;
  shares: number;
  stake: number;
  entryPrice: number;
  entryFee: number;
  totalCost: number;
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
  shares: number;
  entryPrice: number;
  exitPrice: number;
  entryFee: number;
  closeFee: number;
  feesPaid: number;
  proceeds: number;
  realizedPnl: number;
  closedAt: string;
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
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

  return shares * getExitPrice(snapshot, side);
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

  const entryPrice = getEntryPrice(snapshot, side);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
    return null;
  }

  const stake = Math.min(state.cash, decision.size);
  if (!isFinitePositiveNumber(stake)) {
    return null;
  }

  const perShareCost = entryPrice + calculateFee(feeModel, 1, entryPrice);
  const shares = Math.floor((stake * 100) / perShareCost) / 100;
  if (!isFinitePositiveNumber(shares)) {
    return null;
  }

  const entryFee = calculateFee(feeModel, shares, entryPrice);
  const totalCost = shares * entryPrice + entryFee;
  if (!Number.isFinite(totalCost) || totalCost > state.cash) {
    return null;
  }

  const position: PaperSessionPosition = {
    asset,
    side: toPositionSide(side),
    predictionSide: side,
    size: shares,
    shares,
    stake,
    entryPrice,
    entryFee,
    marketSlug: snapshot.slug,
    openedAt,
    bucketStartTime: snapshot.bucketStartTime,
    endDate: snapshot.endDate,
  };

  state.cash -= totalCost;
  state.positions[asset] = position;
  state.tradeCount += 1;

  return {
    asset,
    marketSlug: snapshot.slug,
    side,
    shares,
    stake,
    entryPrice,
    entryFee,
    totalCost,
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
): ClosePaperPositionResult {
  const side = inferPredictionSide(position);
  if (!side) {
    throw new Error(`Paper position for ${asset} is missing prediction side`);
  }

  const shares = position.shares ?? position.size;
  const entryPrice = position.entryPrice;
  if (!isFinitePositiveNumber(shares) || !isFinitePositiveNumber(entryPrice)) {
    throw new Error(`Paper position for ${asset} is missing entry details needed to close`);
  }

  const exitPrice = getExitPrice(snapshot, side);
  if (!Number.isFinite(exitPrice) || exitPrice < 0 || exitPrice > 1) {
    throw new Error(`Paper position for ${asset} cannot close from invalid exit price`);
  }

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
    closedAt,
  };
}
