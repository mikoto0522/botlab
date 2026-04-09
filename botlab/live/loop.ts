import { calculateFee, type BacktestFeeModel } from '../backtest/fees.js';
import { createStrategyRegistry } from '../core/strategy-registry.js';
import { resolveStrategyParams } from '../core/strategy-params.js';
import type {
  BotlabCandle,
  BotlabMarketRuntime,
  BotlabRelatedMarketRuntime,
  BotlabStrategyDecision,
  BotlabStrategyContext,
} from '../core/types.js';
import {
  calculatePaperSessionEquity,
  hasOpenPaperPosition,
  settlePaperPosition,
  type SettlePaperPositionResult,
} from '../paper/executor.js';
import type {
  PaperMarketDetail,
  PaperMarketSnapshot,
  PaperOrderBookLevel,
} from '../paper/market-source.js';
import { appendLiveSessionEvent, resumeLiveSessionState, saveLiveSessionState } from './session-store.js';
import {
  LIVE_SYNTHETIC_CANDLE_VOLUME,
  type LiveSessionAsset,
  type LiveSessionEvent,
  type LiveSessionHistoryMap,
  type LiveSessionPosition,
  type LiveSessionState,
} from './types.js';
import type {
  LiveBuyOrderResult,
  LiveSellOrderResult,
  LiveTradingClient,
} from './client.js';

const DEFAULT_STRATEGY_ID = 'polybot-ported';
const DEFAULT_FEE_MODEL: BacktestFeeModel = 'polymarket-2026-03-26';
const DEFAULT_STAKE_OVERRIDE_USD = 1;
const DEFAULT_MAX_PRICE_SLIPPAGE_PCT = 0.02;
const LIVE_TIMEFRAME = '5m';
const MAX_CONTEXT_CANDLES = 128;

export interface LiveLoopMarketSource {
  getCurrentSnapshots: () => Promise<PaperMarketSnapshot[]>;
  getSnapshotBySlug?: (slug: string, asset: LiveSessionAsset) => Promise<PaperMarketSnapshot>;
  getMarketDetail: (slug: string, asset: LiveSessionAsset) => Promise<PaperMarketDetail>;
}

export interface RunLiveLoopInput {
  sessionName: string;
  strategyDir: string;
  strategyId?: string;
  strategyParamOverrides?: Record<string, unknown>;
  cwd?: string;
  startingCash?: number;
  feeModel?: BacktestFeeModel;
  intervalMs?: number;
  maxCycles?: number;
  stakeOverrideUsd?: number;
  maxPriceSlippagePct?: number;
  sleepMs?: (delayMs: number) => Promise<void>;
  onCycleReport?: (report: LiveCycleReport) => void | Promise<void>;
  marketSource: LiveLoopMarketSource;
  tradingClient: LiveTradingClient;
}

export interface LiveLoopResult {
  state: LiveSessionState;
  cyclesCompleted: number;
  openedCount: number;
  settledCount: number;
}

async function syncLiveCashBalance(state: LiveSessionState, tradingClient: LiveTradingClient): Promise<number> {
  const liveCash = await tradingClient.getCollateralBalance();
  state.cash = liveCash;
  return liveCash;
}

export interface LiveCycleDecisionSummary {
  asset: LiveSessionAsset;
  action: BotlabStrategyDecision['action'];
  side: BotlabStrategyDecision['side'] | 'flat';
  reason: string;
  marketSlug: string;
  upPrice: number | null;
  downPrice: number | null;
  upAsk: number | null;
  downAsk: number | null;
}

export interface LiveCycleReport {
  type: 'cycle' | 'error';
  timestamp: string;
  cycleCount: number;
  cash: number;
  equity: number;
  openedCount: number;
  closedCount: number;
  settledCount: number;
  decisions?: LiveCycleDecisionSummary[];
  errorMessage?: string;
}

interface LiveExecutionFillLevel {
  price: number;
  shares: number;
  grossAmount: number;
  fee: number;
}

interface LiveBuyPreview {
  requestedStake: number;
  shares: number;
  avgPrice: number;
  totalCost: number;
  totalFee: number;
  partialFill: boolean;
  levelsConsumed: number;
  fills: LiveExecutionFillLevel[];
}

interface LiveSellPreview {
  requestedShares: number;
  shares: number;
  remainingShares: number;
  avgPrice: number;
  proceeds: number;
  totalFee: number;
  partialFill: boolean;
  levelsConsumed: number;
  fills: LiveExecutionFillLevel[];
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

function cloneHistoryMap(history: LiveSessionHistoryMap): LiveSessionHistoryMap {
  return {
    BTC: {
      maxLength: history.BTC.maxLength,
      points: history.BTC.points.map((point) => ({ ...point })),
    },
    ETH: {
      maxLength: history.ETH.maxLength,
      points: history.ETH.points.map((point) => ({ ...point })),
    },
  };
}

function createSnapshotMaps(snapshots: PaperMarketSnapshot[]): {
  byAsset: Record<LiveSessionAsset, PaperMarketSnapshot>;
  bySlug: Map<string, PaperMarketSnapshot>;
} {
  const bySlug = new Map<string, PaperMarketSnapshot>();
  const byAsset = {} as Record<LiveSessionAsset, PaperMarketSnapshot>;

  for (const snapshot of snapshots) {
    if (snapshot.asset !== 'BTC' && snapshot.asset !== 'ETH') {
      throw new Error(`Live loop received unsupported asset ${snapshot.asset}`);
    }
    if (byAsset[snapshot.asset]) {
      throw new Error(`Live loop received duplicate ${snapshot.asset} snapshot for the same cycle`);
    }

    byAsset[snapshot.asset] = snapshot;
    bySlug.set(snapshot.slug, snapshot);
  }

  if (!byAsset.BTC || !byAsset.ETH) {
    throw new Error('Live loop requires both BTC and ETH snapshots in every cycle');
  }

  return { byAsset, bySlug };
}

function requireSnapshotPrice(snapshot: PaperMarketSnapshot, field: 'upPrice' | 'downPrice'): number {
  const value = snapshot[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Live loop snapshot ${snapshot.slug} is missing ${field}`);
  }

  return value;
}

function upsertHistoryPoint(
  history: LiveSessionHistoryMap[LiveSessionAsset],
  snapshot: PaperMarketSnapshot,
): LiveSessionHistoryMap[LiveSessionAsset] {
  const price = requireSnapshotPrice(snapshot, 'upPrice');
  const nextPoints = history.points.map((point) => ({ ...point }));
  const nextPoint = {
    timestamp: snapshot.bucketStartTime,
    price,
  };
  const existingIndex = nextPoints.findIndex((point) => point.timestamp === nextPoint.timestamp);

  if (existingIndex >= 0) {
    nextPoints[existingIndex] = nextPoint;
  } else {
    nextPoints.push(nextPoint);
  }

  return {
    maxLength: history.maxLength,
    points: nextPoints.slice(-history.maxLength),
  };
}

function mergeCurrentSnapshotsIntoHistory(
  history: LiveSessionHistoryMap,
  snapshotsByAsset: Record<LiveSessionAsset, PaperMarketSnapshot>,
): LiveSessionHistoryMap {
  const nextHistory = cloneHistoryMap(history);
  nextHistory.BTC = upsertHistoryPoint(nextHistory.BTC, snapshotsByAsset.BTC);
  nextHistory.ETH = upsertHistoryPoint(nextHistory.ETH, snapshotsByAsset.ETH);
  return nextHistory;
}

function buildSyntheticCandles(history: LiveSessionHistoryMap[LiveSessionAsset]): BotlabCandle[] {
  const candles: BotlabCandle[] = [];

  for (const point of history.points.slice(-MAX_CONTEXT_CANDLES)) {
    const previousClose = candles.at(-1)?.close ?? point.price;
    candles.push({
      timestamp: point.timestamp,
      open: previousClose,
      high: Math.max(previousClose, point.price),
      low: Math.min(previousClose, point.price),
      close: point.price,
      volume: LIVE_SYNTHETIC_CANDLE_VOLUME,
    });
  }

  return candles;
}

function buildPositionRuntime(position: LiveSessionPosition | undefined): BotlabStrategyContext['position'] {
  if (!hasOpenPaperPosition(position)) {
    return {
      side: 'flat',
      size: 0,
      entryPrice: null,
    };
  }

  return {
    side: position.side,
    size: position.shares ?? position.size,
    entryPrice: position.entryPrice,
  };
}

function snapshotVolume(snapshot: PaperMarketSnapshot): number {
  return typeof snapshot.volume === 'number' && Number.isFinite(snapshot.volume)
    ? snapshot.volume
    : LIVE_SYNTHETIC_CANDLE_VOLUME;
}

function buildRelatedMarkets(
  currentAsset: LiveSessionAsset,
  history: LiveSessionHistoryMap,
  snapshotsByAsset: Record<LiveSessionAsset, PaperMarketSnapshot>,
): BotlabRelatedMarketRuntime[] {
  const relatedAsset = currentAsset === 'BTC' ? 'ETH' : 'BTC';
  const snapshot = snapshotsByAsset[relatedAsset];
  const candles = buildSyntheticCandles(history[relatedAsset]);
  const price = requireSnapshotPrice(snapshot, 'upPrice');
  const upPrice = requireSnapshotPrice(snapshot, 'upPrice');
  const downPrice = requireSnapshotPrice(snapshot, 'downPrice');

  return [{
    asset: relatedAsset,
    symbol: snapshot.slug,
    timeframe: LIVE_TIMEFRAME,
    price,
    upPrice,
    downPrice,
    upAsk: snapshot.upAsk ?? undefined,
    downAsk: snapshot.downAsk ?? undefined,
    volume: snapshotVolume(snapshot),
    timestamp: snapshot.bucketStartTime,
    candles,
  }];
}

function buildMarketRuntime(snapshot: PaperMarketSnapshot, candles: BotlabCandle[]): BotlabMarketRuntime {
  const price = requireSnapshotPrice(snapshot, 'upPrice');
  const upPrice = requireSnapshotPrice(snapshot, 'upPrice');
  const downPrice = requireSnapshotPrice(snapshot, 'downPrice');

  return {
    asset: snapshot.asset,
    symbol: snapshot.slug,
    timeframe: LIVE_TIMEFRAME,
    price,
    upPrice,
    downPrice,
    upAsk: snapshot.upAsk ?? undefined,
    downAsk: snapshot.downAsk ?? undefined,
    changePct24h: 0,
    momentum: 0,
    volume: snapshotVolume(snapshot),
    timestamp: snapshot.bucketStartTime,
    candles,
  };
}

function buildStrategyContextForSnapshot(
  state: LiveSessionState,
  snapshot: PaperMarketSnapshot,
  history: LiveSessionHistoryMap,
  snapshotsByAsset: Record<LiveSessionAsset, PaperMarketSnapshot>,
  now: string,
): BotlabStrategyContext {
  const candles = buildSyntheticCandles(history[snapshot.asset]);
  const relatedMarkets = buildRelatedMarkets(snapshot.asset, history, snapshotsByAsset);

  return {
    mode: 'live',
    market: buildMarketRuntime(snapshot, candles),
    relatedMarkets,
    position: buildPositionRuntime(state.positions[snapshot.asset]),
    balance: state.cash,
    clock: { now },
  };
}

function toCycleTimestamp(snapshots: PaperMarketSnapshot[]): string {
  const latest = snapshots
    .map((snapshot) => Date.parse(snapshot.fetchedAt))
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => left - right)
    .at(-1);

  return typeof latest === 'number' ? new Date(latest).toISOString() : new Date().toISOString();
}

async function resolvePositionSnapshot(
  asset: LiveSessionAsset,
  position: LiveSessionPosition,
  currentSnapshotsBySlug: Map<string, PaperMarketSnapshot>,
  marketSource: LiveLoopMarketSource,
  cache: Map<string, PaperMarketSnapshot>,
): Promise<PaperMarketSnapshot> {
  const marketSlug = position.marketSlug;
  if (!marketSlug) {
    throw new Error(`Live position for ${asset} is missing marketSlug`);
  }

  const currentSnapshot = currentSnapshotsBySlug.get(marketSlug);
  if (currentSnapshot) {
    return currentSnapshot;
  }

  const cached = cache.get(marketSlug);
  if (cached) {
    return cached;
  }

  if (!marketSource.getSnapshotBySlug) {
    throw new Error(`Live loop needs getSnapshotBySlug to resume ${asset} position ${marketSlug}`);
  }

  const fetched = await marketSource.getSnapshotBySlug(marketSlug, asset);
  cache.set(marketSlug, fetched);
  return fetched;
}

function isSettledSnapshot(snapshot: PaperMarketSnapshot): boolean {
  return snapshot.closed;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function summarizeSnapshot(snapshot: PaperMarketSnapshot): Record<string, unknown> {
  return {
    asset: snapshot.asset,
    slug: snapshot.slug,
    bucketStartTime: snapshot.bucketStartTime,
    endDate: snapshot.endDate,
    active: snapshot.active,
    closed: snapshot.closed,
    acceptingOrders: snapshot.acceptingOrders,
    upPrice: snapshot.upPrice,
    downPrice: snapshot.downPrice,
    upAsk: snapshot.upAsk,
    downAsk: snapshot.downAsk,
    volume: snapshot.volume,
  };
}

function getEntryLiquidityLevels(snapshot: PaperMarketSnapshot, side: 'up' | 'down'): PaperOrderBookLevel[] {
  const orderBook = side === 'up' ? snapshot.upOrderBook : snapshot.downOrderBook;
  if (orderBook && orderBook.asks.length > 0) {
    return orderBook.asks;
  }

  const fallbackPrice = side === 'up'
    ? snapshot.upAsk ?? snapshot.upPrice ?? 0
    : snapshot.downAsk ?? snapshot.downPrice ?? 0;

  return isFinitePositiveNumber(fallbackPrice)
    ? [{ price: fallbackPrice, size: Number.MAX_SAFE_INTEGER }]
    : [];
}

function getExitLiquidityLevels(snapshot: PaperMarketSnapshot, side: 'up' | 'down'): PaperOrderBookLevel[] {
  const orderBook = side === 'up' ? snapshot.upOrderBook : snapshot.downOrderBook;
  if (orderBook && orderBook.bids.length > 0) {
    return orderBook.bids;
  }

  const fallbackPrice = side === 'up'
    ? snapshot.upPrice ?? 0
    : snapshot.downPrice ?? 0;

  return Number.isFinite(fallbackPrice) && fallbackPrice >= 0 && fallbackPrice <= 1
    ? [{ price: fallbackPrice, size: Number.MAX_SAFE_INTEGER }]
    : [];
}

function previewBuyExecution(
  snapshot: PaperMarketSnapshot,
  side: 'up' | 'down',
  requestedStake: number,
  feeModel: BacktestFeeModel,
): LiveBuyPreview | null {
  const levels = getEntryLiquidityLevels(snapshot, side);
  let remainingBudget = requestedStake;
  let totalShares = 0;
  let grossCost = 0;
  let totalFee = 0;
  const fills: LiveExecutionFillLevel[] = [];

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
    partialFill: requestedStake - (grossCost + totalFee) > 1e-9,
    levelsConsumed: fills.length,
    fills,
  };
}

function previewSellExecution(
  snapshot: PaperMarketSnapshot,
  side: 'up' | 'down',
  requestedShares: number,
  feeModel: BacktestFeeModel,
): LiveSellPreview | null {
  const levels = getExitLiquidityLevels(snapshot, side);
  let remainingShares = requestedShares;
  let totalShares = 0;
  let proceeds = 0;
  let totalFee = 0;
  const fills: LiveExecutionFillLevel[] = [];

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
    partialFill: remainingShares > 0,
    levelsConsumed: fills.length,
    fills,
  };
}

function clampBinaryPrice(price: number): number {
  if (!Number.isFinite(price)) {
    return 0;
  }

  return Math.min(1, Math.max(0, price));
}

function parseTickSize(tickSize: PaperMarketDetail['tickSize']): number | null {
  const parsed = Number.parseFloat(String(tickSize));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function countTickDecimals(tickSize: PaperMarketDetail['tickSize']): number {
  const normalized = String(tickSize).trim();
  if (!normalized.includes('.')) {
    return 0;
  }

  return normalized.split('.')[1]!.replace(/0+$/, '').length;
}

function roundPriceToTick(
  rawPrice: number,
  tickSize: PaperMarketDetail['tickSize'],
  direction: 'up' | 'down',
): number {
  const tick = parseTickSize(tickSize);
  const clamped = clampBinaryPrice(rawPrice);
  if (!tick) {
    return clamped;
  }

  const scaled = direction === 'down'
    ? Math.floor((clamped + 1e-9) / tick) * tick
    : Math.ceil((clamped - 1e-9) / tick) * tick;

  return clampBinaryPrice(Number(scaled.toFixed(countTickDecimals(tickSize))));
}

function withBuySlippageLimit(
  preview: LiveBuyPreview,
  tickSize: PaperMarketDetail['tickSize'],
  maxPriceSlippagePct: number,
): { priceLimit: number; preview: LiveBuyPreview } | null {
  const anchorPrice = preview.fills[0]?.price ?? preview.avgPrice;
  if (!isFinitePositiveNumber(anchorPrice)) {
    return null;
  }

  const priceLimit = roundPriceToTick(anchorPrice * (1 + maxPriceSlippagePct), tickSize, 'down');
  const fills = preview.fills.filter((fill) => fill.price <= priceLimit + 1e-9);
  const shares = fills.reduce((sum, fill) => sum + fill.shares, 0);
  if (!isFinitePositiveNumber(shares)) {
    return null;
  }

  const grossCost = fills.reduce((sum, fill) => sum + fill.grossAmount, 0);
  const totalFee = fills.reduce((sum, fill) => sum + fill.fee, 0);

  return {
    priceLimit,
    preview: {
      requestedStake: preview.requestedStake,
      shares,
      avgPrice: grossCost / shares,
      totalCost: grossCost + totalFee,
      totalFee,
      partialFill: preview.requestedStake - (grossCost + totalFee) > 1e-9,
      levelsConsumed: fills.length,
      fills,
    },
  };
}

function withSellSlippageLimit(
  preview: LiveSellPreview,
  tickSize: PaperMarketDetail['tickSize'],
  maxPriceSlippagePct: number,
): { priceLimit: number; preview: LiveSellPreview } | null {
  const anchorPrice = preview.fills[0]?.price ?? preview.avgPrice;
  if (!Number.isFinite(anchorPrice) || anchorPrice < 0) {
    return null;
  }

  const priceLimit = roundPriceToTick(anchorPrice * (1 - maxPriceSlippagePct), tickSize, 'up');
  const fills = preview.fills.filter((fill) => fill.price + 1e-9 >= priceLimit);
  const shares = fills.reduce((sum, fill) => sum + fill.shares, 0);
  if (!isFinitePositiveNumber(shares)) {
    return null;
  }

  const proceeds = fills.reduce((sum, fill) => sum + fill.grossAmount, 0);
  const totalFee = fills.reduce((sum, fill) => sum + fill.fee, 0);

  return {
    priceLimit,
    preview: {
      requestedShares: preview.requestedShares,
      shares,
      remainingShares: floorShares(Math.max(0, preview.requestedShares - shares)),
      avgPrice: proceeds / shares,
      proceeds,
      totalFee,
      partialFill: shares + 1e-9 < preview.requestedShares,
      levelsConsumed: fills.length,
      fills,
    },
  };
}

function applyLiveOpenFill(
  state: LiveSessionState,
  asset: LiveSessionAsset,
  snapshot: PaperMarketSnapshot,
  side: 'up' | 'down',
  fill: LiveBuyOrderResult,
  openedAt = snapshot.fetchedAt,
): LiveSessionPosition {
  const position: LiveSessionPosition = {
    asset,
    side: side === 'up' ? 'long' : 'short',
    predictionSide: side,
    size: fill.shares,
    shares: fill.shares,
    stake: fill.spentAmount,
    entryPrice: fill.averagePrice,
    entryFee: fill.feesPaid,
    marketSlug: snapshot.slug,
    openedAt,
    bucketStartTime: snapshot.bucketStartTime,
    endDate: snapshot.endDate,
  };

  state.cash -= fill.spentAmount;
  state.positions[asset] = position;
  state.tradeCount += 1;
  return position;
}

function applyLiveCloseFill(
  state: LiveSessionState,
  asset: LiveSessionAsset,
  position: LiveSessionPosition,
  fill: LiveSellOrderResult,
) {
  const requestedShares = position.shares ?? position.size;
  const entryPrice = position.entryPrice ?? 0;
  const totalEntryFee = position.entryFee ?? 0;
  const soldRatio = requestedShares > 0 ? fill.soldShares / requestedShares : 0;
  const entryFee = totalEntryFee * soldRatio;
  const remainingEntryFee = totalEntryFee - entryFee;
  const realizedPnl = fill.grossProceeds - fill.feesPaid - entryFee - (fill.soldShares * entryPrice);

  state.cash += fill.netProceeds;

  const remainingShares = floorShares(requestedShares - fill.soldShares);
  if (remainingShares > 0) {
    state.positions[asset] = {
      ...position,
      size: remainingShares,
      shares: remainingShares,
      stake: (remainingShares * entryPrice) + remainingEntryFee,
      entryFee: remainingEntryFee,
    };
  } else {
    delete state.positions[asset];
  }

  return { remainingShares, realizedPnl, entryFee };
}

function appendDecisionEvent(
  sessionName: string,
  asset: LiveSessionAsset,
  snapshot: PaperMarketSnapshot,
  decision: BotlabStrategyDecision,
  cwd: string | undefined,
): void {
  appendLiveSessionEvent(sessionName, {
    type: 'live-strategy-decision',
    timestamp: snapshot.fetchedAt,
    asset,
    action: decision.action,
    side: decision.side ?? 'flat',
    size: decision.size ?? null,
    reason: decision.reason,
    tags: decision.tags ?? [],
    snapshot: summarizeSnapshot(snapshot),
  }, cwd);
}

function appendCycleErrorEvent(sessionName: string, timestamp: string, error: unknown, cwd: string | undefined): void {
  appendLiveSessionEvent(sessionName, {
    type: 'live-cycle-error',
    timestamp,
    message: error instanceof Error ? error.message : String(error),
  }, cwd);
}

export async function runLiveLoop(input: RunLiveLoopInput): Promise<LiveLoopResult> {
  const strategyId = input.strategyId ?? DEFAULT_STRATEGY_ID;
  const feeModel = input.feeModel ?? DEFAULT_FEE_MODEL;
  const intervalMs = Math.max(0, input.intervalMs ?? 30_000);
  const sleepMs = input.sleepMs ?? defaultSleep;
  const stakeOverrideUsd = Math.max(0, input.stakeOverrideUsd ?? DEFAULT_STAKE_OVERRIDE_USD);
  const maxPriceSlippagePct = Number.isFinite(input.maxPriceSlippagePct) && input.maxPriceSlippagePct !== undefined
    ? Math.max(0, input.maxPriceSlippagePct)
    : DEFAULT_MAX_PRICE_SLIPPAGE_PCT;
  const registry = await createStrategyRegistry(input.strategyDir);
  const strategy = registry.getById(strategyId);
  const strategyParams = resolveStrategyParams(strategy.defaults, input.strategyParamOverrides);
  const state = resumeLiveSessionState(input.sessionName, input.cwd, { startingCash: input.startingCash });

  let cyclesCompleted = 0;
  let openedCount = 0;
  let settledCount = 0;

  while (input.maxCycles === undefined || cyclesCompleted < input.maxCycles) {
    let cycleTimestamp = new Date().toISOString();

    try {
      await syncLiveCashBalance(state, input.tradingClient);
      const currentSnapshots = await input.marketSource.getCurrentSnapshots();
      const { byAsset: snapshotsByAsset, bySlug: snapshotsBySlug } = createSnapshotMaps(currentSnapshots);
      cycleTimestamp = toCycleTimestamp(currentSnapshots);
      const snapshotCache = new Map<string, PaperMarketSnapshot>();
      const decisionSummaries: LiveCycleDecisionSummary[] = [];
      const openMarks: Partial<Record<LiveSessionAsset, PaperMarketSnapshot>> = {};
      const settledThisCycle: SettlePaperPositionResult[] = [];
      const openedEvents: LiveSessionEvent[] = [];
      const closedEvents: LiveSessionEvent[] = [];

      for (const asset of ['BTC', 'ETH'] as const) {
        const position = state.positions[asset];
        if (!hasOpenPaperPosition(position)) {
          continue;
        }

        const positionSnapshot = await resolvePositionSnapshot(asset, position, snapshotsBySlug, input.marketSource, snapshotCache);
        if (isSettledSnapshot(positionSnapshot)) {
          settledThisCycle.push(
            settlePaperPosition(state, asset, position, positionSnapshot, feeModel, positionSnapshot.fetchedAt),
          );
          continue;
        }

        openMarks[asset] = positionSnapshot;
      }

      state.history = mergeCurrentSnapshotsIntoHistory(state.history, snapshotsByAsset);

      for (const asset of ['BTC', 'ETH'] as const) {
        const snapshot = snapshotsByAsset[asset];
        const context = buildStrategyContextForSnapshot(state, snapshot, state.history, snapshotsByAsset, cycleTimestamp);
        const decision = strategy.evaluate(context, structuredClone(strategyParams));
        decisionSummaries.push({
          asset,
          action: decision.action,
          side: decision.side ?? 'flat',
          reason: decision.reason,
          marketSlug: snapshot.slug,
          upPrice: snapshot.upPrice,
          downPrice: snapshot.downPrice,
          upAsk: snapshot.upAsk,
          downAsk: snapshot.downAsk,
        });
        appendDecisionEvent(input.sessionName, asset, snapshot, decision, input.cwd);

        if (decision.action === 'sell') {
          const position = state.positions[asset];
          if (!hasOpenPaperPosition(position) || !position.predictionSide) {
            continue;
          }

          const preview = previewSellExecution(snapshot, position.predictionSide, position.shares ?? position.size, feeModel);
          if (!preview || preview.fills.length === 0) {
            if (hasOpenPaperPosition(state.positions[asset])) {
              openMarks[asset] = snapshot;
            }
            continue;
          }

          const detail = await input.marketSource.getMarketDetail(position.marketSlug ?? snapshot.slug, asset);
          const limitedSell = withSellSlippageLimit(preview, detail.tickSize, maxPriceSlippagePct);
          if (!limitedSell) {
            if (hasOpenPaperPosition(state.positions[asset])) {
              openMarks[asset] = snapshot;
            }
            continue;
          }
          const tokenId = position.predictionSide === 'up' ? detail.upTokenId : detail.downTokenId;
          const fill = await input.tradingClient.sellOutcome({
            tokenId,
            shares: limitedSell.preview.shares,
            priceLimit: limitedSell.priceLimit,
            tickSize: detail.tickSize,
            negRisk: detail.negRisk,
            expectedGrossProceeds: limitedSell.preview.proceeds,
            expectedAveragePrice: limitedSell.preview.avgPrice,
            expectedFeesPaid: limitedSell.preview.totalFee,
          });

          if (!fill) {
            openMarks[asset] = snapshot;
            continue;
          }

          const closeResult = applyLiveCloseFill(state, asset, position, fill);
          closedEvents.push({
            type: 'live-position-closed',
            timestamp: snapshot.fetchedAt,
            asset,
            marketSlug: position.marketSlug ?? snapshot.slug,
            side: position.predictionSide,
            shares: fill.soldShares,
            remainingShares: closeResult.remainingShares,
            entryPrice: position.entryPrice,
            exitPrice: fill.averagePrice,
            entryFee: closeResult.entryFee,
            closeFee: fill.feesPaid,
            feesPaid: closeResult.entryFee + fill.feesPaid,
            realizedPnl: closeResult.realizedPnl,
            orderId: fill.orderId,
            status: fill.status,
          });

          if (hasOpenPaperPosition(state.positions[asset])) {
            openMarks[asset] = snapshot;
          }
          continue;
        }

        if (decision.action !== 'buy') {
          if (hasOpenPaperPosition(state.positions[asset])) {
            openMarks[asset] = snapshot;
          }
          continue;
        }

        if (hasOpenPaperPosition(state.positions[asset])) {
          openMarks[asset] = snapshot;
          continue;
        }

        const side = decision.side;
        if (side !== 'up' && side !== 'down') {
          continue;
        }

        const requestedStake = Math.min(state.cash, stakeOverrideUsd);
        if (!isFinitePositiveNumber(requestedStake)) {
          continue;
        }

        const preview = previewBuyExecution(snapshot, side, requestedStake, feeModel);
        if (!preview || preview.fills.length === 0) {
          continue;
        }

        const detail = await input.marketSource.getMarketDetail(snapshot.slug, asset);
        const limitedBuy = withBuySlippageLimit(preview, detail.tickSize, maxPriceSlippagePct);
        if (!limitedBuy) {
          continue;
        }
        const tokenId = side === 'up' ? detail.upTokenId : detail.downTokenId;
        const fill = await input.tradingClient.buyOutcome({
          tokenId,
          amount: requestedStake,
          priceLimit: limitedBuy.priceLimit,
          tickSize: detail.tickSize,
          negRisk: detail.negRisk,
          expectedTotalCost: limitedBuy.preview.totalCost,
          expectedShares: limitedBuy.preview.shares,
          expectedAveragePrice: limitedBuy.preview.avgPrice,
          expectedFeesPaid: limitedBuy.preview.totalFee,
        });

        if (!fill) {
          continue;
        }

        applyLiveOpenFill(state, asset, snapshot, side, fill, cycleTimestamp);
        openedEvents.push({
          type: 'live-position-opened',
          timestamp: cycleTimestamp,
          asset,
          marketSlug: snapshot.slug,
          side,
          requestedStake,
          shares: fill.shares,
          stake: fill.spentAmount,
          entryPrice: fill.averagePrice,
          entryFee: fill.feesPaid,
          totalCost: fill.spentAmount,
          orderId: fill.orderId,
          status: fill.status,
        });
        openedCount += 1;
        openMarks[asset] = {
          ...snapshot,
          upPrice: side === 'up' ? fill.averagePrice : snapshot.upPrice,
          downPrice: side === 'down' ? fill.averagePrice : snapshot.downPrice,
        };
      }

      state.cycleCount += 1;
      settledCount += settledThisCycle.length;
      await syncLiveCashBalance(state, input.tradingClient);
      state.equity = calculatePaperSessionEquity(state, openMarks);

      saveLiveSessionState(state, input.cwd);
      for (const event of settledThisCycle) {
        appendLiveSessionEvent(input.sessionName, {
          type: 'live-position-settled',
          timestamp: event.settledAt,
          asset: event.asset,
          marketSlug: event.marketSlug,
          side: event.side,
          shares: event.shares,
          entryPrice: event.entryPrice,
          exitPrice: event.exitPrice,
          feesPaid: event.feesPaid,
          realizedPnl: event.realizedPnl,
        }, input.cwd);
      }
      for (const event of closedEvents) {
        appendLiveSessionEvent(input.sessionName, event, input.cwd);
      }
      for (const event of openedEvents) {
        appendLiveSessionEvent(input.sessionName, event, input.cwd);
      }
      appendLiveSessionEvent(input.sessionName, {
        type: 'live-cycle-complete',
        timestamp: cycleTimestamp,
        cycleCount: state.cycleCount,
        cash: state.cash,
        equity: state.equity,
        openPositionCount: Object.values(state.positions).filter((position) => hasOpenPaperPosition(position)).length,
        openedCount: openedEvents.length,
        closedCount: closedEvents.length,
        settledCount: settledThisCycle.length,
        snapshots: {
          BTC: summarizeSnapshot(snapshotsByAsset.BTC),
          ETH: summarizeSnapshot(snapshotsByAsset.ETH),
        },
      }, input.cwd);

      if (input.onCycleReport) {
        await input.onCycleReport({
          type: 'cycle',
          timestamp: cycleTimestamp,
          cycleCount: state.cycleCount,
          cash: state.cash,
          equity: state.equity,
          openedCount: openedEvents.length,
          closedCount: closedEvents.length,
          settledCount: settledThisCycle.length,
          decisions: decisionSummaries,
        });
      }
    } catch (error) {
      state.cycleCount += 1;
      saveLiveSessionState(state, input.cwd);
      appendCycleErrorEvent(input.sessionName, cycleTimestamp, error, input.cwd);
      if (input.onCycleReport) {
        await input.onCycleReport({
          type: 'error',
          timestamp: cycleTimestamp,
          cycleCount: state.cycleCount,
          cash: state.cash,
          equity: state.equity,
          openedCount: 0,
          closedCount: 0,
          settledCount: 0,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    cyclesCompleted += 1;
    if (input.maxCycles === undefined || cyclesCompleted < input.maxCycles) {
      await sleepMs(intervalMs);
    }
  }

  return {
    state,
    cyclesCompleted,
    openedCount,
    settledCount,
  };
}
