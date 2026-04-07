import type { BacktestFeeModel } from '../backtest/fees.js';
import { createStrategyRegistry } from '../core/strategy-registry.js';
import { resolveStrategyParams } from '../core/strategy-params.js';
import type {
  BotlabCandle,
  BotlabMarketRuntime,
  BotlabRelatedMarketRuntime,
  BotlabStrategyDecision,
  BotlabStrategyContext,
} from '../core/types.js';
import type { PaperMarketSnapshot } from './market-source.js';
import {
  calculatePaperSessionEquity,
  closePaperPosition,
  hasOpenPaperPosition,
  openPaperPosition,
  settlePaperPosition,
  type ClosePaperPositionResult,
  type OpenPaperPositionResult,
  type SettlePaperPositionResult,
} from './executor.js';
import {
  appendPaperSessionEvent,
  resumePaperSessionState,
  savePaperSessionState,
} from './session-store.js';
import {
  PAPER_SYNTHETIC_CANDLE_VOLUME,
  type PaperSessionAsset,
  type PaperSessionHistoryMap,
  type PaperSessionPosition,
  type PaperSessionState,
} from './types.js';

const DEFAULT_STRATEGY_ID = 'btc-eth-5m-multi-signal';
const DEFAULT_FEE_MODEL: BacktestFeeModel = 'polymarket-2026-03-26';
const MAX_CONTEXT_CANDLES = 128;
const PAPER_TIMEFRAME = '5m';

export interface PaperLoopMarketSource {
  getCurrentSnapshots: () => Promise<PaperMarketSnapshot[]>;
  getSnapshotBySlug?: (slug: string, asset: PaperSessionAsset) => Promise<PaperMarketSnapshot>;
}

export interface RunPaperLoopInput {
  sessionName: string;
  strategyDir: string;
  strategyId?: string;
  strategyParamOverrides?: Record<string, unknown>;
  cwd?: string;
  startingCash?: number;
  feeModel?: BacktestFeeModel;
  intervalMs?: number;
  maxCycles?: number;
  sleepMs?: (delayMs: number) => Promise<void>;
  onCycleReport?: (report: PaperCycleReport) => void | Promise<void>;
  marketSource: PaperLoopMarketSource;
}

export interface PaperLoopResult {
  state: PaperSessionState;
  cyclesCompleted: number;
  openedCount: number;
  settledCount: number;
}

export interface PaperCycleDecisionSummary {
  asset: PaperSessionAsset;
  action: BotlabStrategyDecision['action'];
  side: BotlabStrategyDecision['side'] | 'flat';
  reason: string;
  marketSlug: string;
  upPrice: number | null;
  downPrice: number | null;
}

export interface PaperCycleReport {
  type: 'cycle' | 'error';
  timestamp: string;
  cycleCount: number;
  cash: number;
  equity: number;
  openedCount: number;
  closedCount: number;
  settledCount: number;
  decisions?: PaperCycleDecisionSummary[];
  snapshots?: Record<PaperSessionAsset, Record<string, unknown>>;
  errorMessage?: string;
}

function cloneHistoryMap(history: PaperSessionHistoryMap): PaperSessionHistoryMap {
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
  byAsset: Record<PaperSessionAsset, PaperMarketSnapshot>;
  bySlug: Map<string, PaperMarketSnapshot>;
} {
  const bySlug = new Map<string, PaperMarketSnapshot>();
  const byAsset = {} as Record<PaperSessionAsset, PaperMarketSnapshot>;

  for (const snapshot of snapshots) {
    if (snapshot.asset !== 'BTC' && snapshot.asset !== 'ETH') {
      throw new Error(`Paper loop received unsupported asset ${snapshot.asset}`);
    }
    if (byAsset[snapshot.asset]) {
      throw new Error(`Paper loop received duplicate ${snapshot.asset} snapshot for the same cycle`);
    }

    byAsset[snapshot.asset] = snapshot;
    bySlug.set(snapshot.slug, snapshot);
  }

  if (!byAsset.BTC || !byAsset.ETH) {
    throw new Error('Paper loop requires both BTC and ETH snapshots in every cycle');
  }

  return { byAsset, bySlug };
}

function requireSnapshotPrice(
  snapshot: PaperMarketSnapshot,
  field: 'upPrice' | 'downPrice',
): number {
  const value = snapshot[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Paper loop snapshot ${snapshot.slug} is missing ${field}`);
  }

  return value;
}

function upsertHistoryPoint(
  history: PaperSessionHistoryMap[PaperSessionAsset],
  snapshot: PaperMarketSnapshot,
): PaperSessionHistoryMap[PaperSessionAsset] {
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
  history: PaperSessionHistoryMap,
  snapshotsByAsset: Record<PaperSessionAsset, PaperMarketSnapshot>,
): PaperSessionHistoryMap {
  const nextHistory = cloneHistoryMap(history);

  nextHistory.BTC = upsertHistoryPoint(nextHistory.BTC, snapshotsByAsset.BTC);
  nextHistory.ETH = upsertHistoryPoint(nextHistory.ETH, snapshotsByAsset.ETH);

  return nextHistory;
}

function buildSyntheticCandles(history: PaperSessionHistoryMap[PaperSessionAsset]): BotlabCandle[] {
  const candles: BotlabCandle[] = [];

  for (const point of history.points.slice(-MAX_CONTEXT_CANDLES)) {
    const previousClose = candles.at(-1)?.close ?? point.price;

    candles.push({
      timestamp: point.timestamp,
      open: previousClose,
      high: Math.max(previousClose, point.price),
      low: Math.min(previousClose, point.price),
      close: point.price,
      volume: PAPER_SYNTHETIC_CANDLE_VOLUME,
    });
  }

  return candles;
}

function buildPositionRuntime(position: PaperSessionPosition | undefined): BotlabStrategyContext['position'] {
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
    : PAPER_SYNTHETIC_CANDLE_VOLUME;
}

function buildRelatedMarkets(
  currentAsset: PaperSessionAsset,
  history: PaperSessionHistoryMap,
  snapshotsByAsset: Record<PaperSessionAsset, PaperMarketSnapshot>,
): BotlabRelatedMarketRuntime[] {
  const relatedAsset = currentAsset === 'BTC' ? 'ETH' : 'BTC';
  const snapshot = snapshotsByAsset[relatedAsset];
  const candles = buildSyntheticCandles(history[relatedAsset]);
  const price = requireSnapshotPrice(snapshot, 'upPrice');
  const upPrice = requireSnapshotPrice(snapshot, 'upPrice');
  const downPrice = requireSnapshotPrice(snapshot, 'downPrice');

  return [
    {
      asset: relatedAsset,
      symbol: snapshot.slug,
      timeframe: PAPER_TIMEFRAME,
      price,
      upPrice,
      downPrice,
      upAsk: snapshot.upAsk ?? undefined,
      downAsk: snapshot.downAsk ?? undefined,
      volume: snapshotVolume(snapshot),
      timestamp: snapshot.bucketStartTime,
      candles,
    },
  ];
}

function buildMarketRuntime(
  snapshot: PaperMarketSnapshot,
  candles: BotlabCandle[],
): BotlabMarketRuntime {
  const price = requireSnapshotPrice(snapshot, 'upPrice');
  const upPrice = requireSnapshotPrice(snapshot, 'upPrice');
  const downPrice = requireSnapshotPrice(snapshot, 'downPrice');

  return {
    asset: snapshot.asset,
    symbol: snapshot.slug,
    timeframe: PAPER_TIMEFRAME,
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
  state: PaperSessionState,
  snapshot: PaperMarketSnapshot,
  history: PaperSessionHistoryMap,
  snapshotsByAsset: Record<PaperSessionAsset, PaperMarketSnapshot>,
  now: string,
): BotlabStrategyContext {
  const candles = buildSyntheticCandles(history[snapshot.asset]);
  const relatedMarkets = buildRelatedMarkets(snapshot.asset, history, snapshotsByAsset);

  return {
    mode: 'paper',
    market: buildMarketRuntime(snapshot, candles),
    relatedMarkets,
    position: buildPositionRuntime(state.positions[snapshot.asset]),
    balance: state.cash,
    clock: {
      now,
    },
  };
}

function toCycleTimestamp(snapshots: PaperMarketSnapshot[]): string {
  const latest = snapshots
    .map((snapshot) => Date.parse(snapshot.fetchedAt))
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => left - right)
    .at(-1);

  return typeof latest === 'number'
    ? new Date(latest).toISOString()
    : new Date().toISOString();
}

async function resolvePositionSnapshot(
  asset: PaperSessionAsset,
  position: PaperSessionPosition,
  currentSnapshotsBySlug: Map<string, PaperMarketSnapshot>,
  marketSource: PaperLoopMarketSource,
  cache: Map<string, PaperMarketSnapshot>,
): Promise<PaperMarketSnapshot> {
  const marketSlug = position.marketSlug;
  if (!marketSlug) {
    throw new Error(`Paper position for ${asset} is missing marketSlug`);
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
    throw new Error(`Paper loop needs getSnapshotBySlug to resume ${asset} position ${marketSlug}`);
  }

  const fetched = await marketSource.getSnapshotBySlug(marketSlug, asset);
  cache.set(marketSlug, fetched);

  return fetched;
}

function isSettledSnapshot(snapshot: PaperMarketSnapshot): boolean {
  return snapshot.closed;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
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

function appendOpenEvents(
  sessionName: string,
  opened: OpenPaperPositionResult[],
  cwd: string | undefined,
): void {
  for (const item of opened) {
    appendPaperSessionEvent(sessionName, {
      type: 'paper-position-opened',
      timestamp: item.openedAt,
      asset: item.asset,
      marketSlug: item.marketSlug,
      side: item.side,
      requestedStake: item.requestedStake,
      shares: item.shares,
      stake: item.stake,
      entryPrice: item.entryPrice,
      entryFee: item.entryFee,
      totalCost: item.totalCost,
      partialFill: item.partialFill,
      levelsConsumed: item.levelsConsumed,
      fills: item.fills,
    }, cwd);
  }
}

function appendCloseEvents(
  sessionName: string,
  closed: ClosePaperPositionResult[],
  cwd: string | undefined,
): void {
  for (const item of closed) {
    appendPaperSessionEvent(sessionName, {
      type: 'paper-position-closed',
      timestamp: item.closedAt,
      asset: item.asset,
      marketSlug: item.marketSlug,
      side: item.side,
      requestedShares: item.requestedShares,
      shares: item.shares,
      remainingShares: item.remainingShares,
      entryPrice: item.entryPrice,
      exitPrice: item.exitPrice,
      feesPaid: item.feesPaid,
      realizedPnl: item.realizedPnl,
      partialFill: item.partialFill,
      levelsConsumed: item.levelsConsumed,
      fills: item.fills,
    }, cwd);
  }
}

function appendDecisionEvent(
  sessionName: string,
  asset: PaperSessionAsset,
  snapshot: PaperMarketSnapshot,
  decision: BotlabStrategyDecision,
  cwd: string | undefined,
): void {
  appendPaperSessionEvent(sessionName, {
    type: 'paper-strategy-decision',
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

function appendCycleErrorEvent(
  sessionName: string,
  timestamp: string,
  error: unknown,
  cwd: string | undefined,
): void {
  appendPaperSessionEvent(sessionName, {
    type: 'paper-cycle-error',
    timestamp,
    message: error instanceof Error ? error.message : String(error),
  }, cwd);
}

function appendSettlementEvents(
  sessionName: string,
  settled: SettlePaperPositionResult[],
  cwd: string | undefined,
): void {
  for (const item of settled) {
    appendPaperSessionEvent(sessionName, {
      type: 'paper-position-settled',
      timestamp: item.settledAt,
      asset: item.asset,
      marketSlug: item.marketSlug,
      side: item.side,
      shares: item.shares,
      entryPrice: item.entryPrice,
      exitPrice: item.exitPrice,
      feesPaid: item.feesPaid,
      realizedPnl: item.realizedPnl,
    }, cwd);
  }
}

export async function runPaperLoop(input: RunPaperLoopInput): Promise<PaperLoopResult> {
  const strategyId = input.strategyId ?? DEFAULT_STRATEGY_ID;
  const feeModel = input.feeModel ?? DEFAULT_FEE_MODEL;
  const intervalMs = Math.max(0, input.intervalMs ?? 30_000);
  const sleepMs = input.sleepMs ?? defaultSleep;
  const registry = await createStrategyRegistry(input.strategyDir);
  const strategy = registry.getById(strategyId);
  const strategyParams = resolveStrategyParams(strategy.defaults, input.strategyParamOverrides);
  const state = resumePaperSessionState(input.sessionName, input.cwd, { startingCash: input.startingCash });

  let cyclesCompleted = 0;
  let openedCount = 0;
  let settledCount = 0;

  while (input.maxCycles === undefined || cyclesCompleted < input.maxCycles) {
    let cycleTimestamp = new Date().toISOString();

    try {
      const currentSnapshots = await input.marketSource.getCurrentSnapshots();
      const { byAsset: snapshotsByAsset, bySlug: snapshotsBySlug } = createSnapshotMaps(currentSnapshots);
      cycleTimestamp = toCycleTimestamp(currentSnapshots);
      const snapshotCache = new Map<string, PaperMarketSnapshot>();
      const settledThisCycle: SettlePaperPositionResult[] = [];
      const closedThisCycle: ClosePaperPositionResult[] = [];
      const openedThisCycle: OpenPaperPositionResult[] = [];
      const openMarks: Partial<Record<PaperSessionAsset, PaperMarketSnapshot>> = {};
      const decisionSummaries: PaperCycleDecisionSummary[] = [];

      for (const asset of ['BTC', 'ETH'] as const) {
        const position = state.positions[asset];
        if (!hasOpenPaperPosition(position)) {
          continue;
        }

        const positionSnapshot = await resolvePositionSnapshot(
          asset,
          position,
          snapshotsBySlug,
          input.marketSource,
          snapshotCache,
        );

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
        });

        appendDecisionEvent(input.sessionName, asset, snapshot, decision, input.cwd);

        if (decision.action === 'sell') {
          const position = state.positions[asset];
          if (hasOpenPaperPosition(position)) {
            const closed = closePaperPosition(state, asset, position, snapshot, feeModel, cycleTimestamp);
            if (closed) {
              closedThisCycle.push(closed);
            }
            if (hasOpenPaperPosition(state.positions[asset])) {
              openMarks[asset] = snapshot;
            }
          }
          continue;
        }

        const opened = openPaperPosition(state, asset, snapshot, decision, feeModel, cycleTimestamp);
        if (!opened) {
          if (hasOpenPaperPosition(state.positions[asset])) {
            openMarks[asset] = snapshot;
          }
          continue;
        }

        openedThisCycle.push(opened);
        openMarks[asset] = snapshot;
        openedCount += 1;
      }

      state.cycleCount += 1;
      settledCount += settledThisCycle.length;
      settledCount += closedThisCycle.length;
      state.equity = calculatePaperSessionEquity(state, openMarks);

      savePaperSessionState(state, input.cwd);
      appendSettlementEvents(input.sessionName, settledThisCycle, input.cwd);
      appendCloseEvents(input.sessionName, closedThisCycle, input.cwd);
      appendOpenEvents(input.sessionName, openedThisCycle, input.cwd);
      appendPaperSessionEvent(input.sessionName, {
        type: 'paper-cycle-complete',
        timestamp: cycleTimestamp,
        cycleCount: state.cycleCount,
        cash: state.cash,
        equity: state.equity,
        openPositionCount: Object.values(state.positions).filter((position) => hasOpenPaperPosition(position)).length,
        openedCount: openedThisCycle.length,
        closedCount: closedThisCycle.length,
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
          openedCount: openedThisCycle.length,
          closedCount: closedThisCycle.length,
          settledCount: settledThisCycle.length,
          decisions: decisionSummaries,
          snapshots: {
            BTC: summarizeSnapshot(snapshotsByAsset.BTC),
            ETH: summarizeSnapshot(snapshotsByAsset.ETH),
          },
        });
      }
    } catch (error) {
      state.cycleCount += 1;
      savePaperSessionState(state, input.cwd);
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
