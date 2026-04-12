import path from 'node:path';
import type { BotlabConfig } from '../core/types.js';
import { getStrategyParamOverrides } from '../core/strategy-params.js';
import {
  discoverActivePaperMarketRefs,
  fetchPaperMarketDetail,
  fetchPaperMarketSnapshot,
  type PaperMarketAsset,
  type PaperMarketRef,
  type PaperMarketSnapshot,
} from '../paper/market-source.js';
import {
  createHybridPaperMarketSource,
  createRealtimePaperMarketSource,
  isReliableRealtimeSnapshot,
  type RealtimePaperMarketSource,
} from '../paper/realtime-market-source.js';
import { createQuietCycleLogger, createRealtimeConnectionReporter } from './realtime-logging.js';
import { formatBacktestNumber } from './backtest-common.js';
import { createPolymarketLiveTradingClient, loadPolymarketLiveCredentialsFromEnv } from '../live/client.js';
import { runLiveLoop, type LiveCycleReport } from '../live/loop.js';
import { appendLiveSessionEvent, loadLiveSessionState } from '../live/session-store.js';
import { resolveLiveSessionPaths } from '../live/types.js';

export interface LiveCommandOptions {
  sessionName: string;
  intervalSeconds: number;
  maxCycles?: number;
  stakeUsd?: number;
}

export const SUPPORTED_REALTIME_LIVE_STRATEGY_IDS = new Set([
  'btc-eth-5m',
  'btc-eth-5m-aggressive',
  'polybot-ported-v4-single-asset',
]);

export function assertRealtimeCompatibleLiveStrategy(strategyId: string): void {
  if (SUPPORTED_REALTIME_LIVE_STRATEGY_IDS.has(strategyId)) {
    return;
  }

  throw new Error(
    'Realtime live mode only supports btc-eth-5m, btc-eth-5m-aggressive, and polybot-ported-v4-single-asset.'
    + ` Received ${strategyId}.`,
  );
}

function buildRefFromSlug(asset: PaperMarketAsset, slug: string): PaperMarketRef {
  const match = slug.match(/-(\d+)$/);
  if (!match) {
    throw new Error(`Cannot build a live market ref from slug: ${slug}`);
  }

  const bucketStartEpoch = Number(match[1]);
  if (!Number.isFinite(bucketStartEpoch)) {
    throw new Error(`Cannot build a live market ref from slug: ${slug}`);
  }

  return {
    asset,
    slug,
    bucketStartEpoch,
    bucketStartTime: new Date(bucketStartEpoch * 1000).toISOString(),
  };
}

export type LoopMarketSourceWithClose = {
  getCurrentSnapshots: () => Promise<PaperMarketSnapshot[]>;
  getSnapshotBySlug: (slug: string, asset: PaperMarketAsset) => Promise<PaperMarketSnapshot>;
  waitForNextSignal?: (afterTimestamp: string, timeoutMs: number) => Promise<PaperMarketSnapshot>;
  close: () => Promise<void>;
  getMarketDetail: (slug: string, asset: PaperMarketAsset) => ReturnType<typeof fetchPaperMarketDetail>;
  getExecutionSnapshot?: (
    snapshot: PaperMarketSnapshot,
    asset: PaperMarketAsset,
    side: 'up' | 'down',
    action: 'buy' | 'sell',
  ) => Promise<PaperMarketSnapshot>;
};

interface LiveLoopMarketSourceDependencies {
  createRealtimeSource?: (options: Parameters<typeof createRealtimePaperMarketSource>[0]) => RealtimePaperMarketSource;
  discoverActiveRefs?: typeof discoverActivePaperMarketRefs;
  fetchSnapshot?: typeof fetchPaperMarketSnapshot;
  fetchMarketDetail?: typeof fetchPaperMarketDetail;
}

export function createLoopMarketSource(
  sessionName?: string,
  cwd?: string,
  dependencies: LiveLoopMarketSourceDependencies = {},
): LoopMarketSourceWithClose {
  const marketDetailCache = new Map<string, Awaited<ReturnType<typeof fetchPaperMarketDetail>>>();
  const currentSnapshots = new Map<string, PaperMarketSnapshot>();
  const createRealtimeSource = dependencies.createRealtimeSource ?? createRealtimePaperMarketSource;
  const discoverActiveRefs = dependencies.discoverActiveRefs ?? discoverActivePaperMarketRefs;
  const fetchSnapshot = dependencies.fetchSnapshot ?? fetchPaperMarketSnapshot;
  const fetchMarketDetailImpl = dependencies.fetchMarketDetail ?? fetchPaperMarketDetail;

  function toCacheKey(asset: PaperMarketAsset, slug: string): string {
    return `${asset}:${slug}`;
  }

  function hasVisibleExecutionLiquidity(
    snapshot: PaperMarketSnapshot,
    side: 'up' | 'down',
    action: 'buy' | 'sell',
  ): boolean {
    if (action === 'buy') {
      const asks = side === 'up' ? snapshot.upOrderBook?.asks : snapshot.downOrderBook?.asks;
      return Boolean(asks && asks.length > 0);
    }

    const bids = side === 'up' ? snapshot.upOrderBook?.bids : snapshot.downOrderBook?.bids;
    return Boolean(bids && bids.length > 0);
  }

  const realtimeSource = createRealtimeSource({
    reconnectDelayMs: 5_000,
    maxReconnectAttempts: 5,
    fatalOnReconnectExhausted: true,
    onConnectionEvent: createRealtimeConnectionReporter('live', {
      appendEvent: (event) => {
        if (sessionName && cwd) {
          appendLiveSessionEvent(sessionName, event, cwd);
        }
      },
    }),
  });
  const hybridSource = createHybridPaperMarketSource({
    pollingSource: {
      getCurrentSnapshots: async (): Promise<PaperMarketSnapshot[]> => {
        const refs = await discoverActiveRefs();
        return Promise.all(refs.map((ref) => fetchSnapshot(ref)));
      },
      getSnapshotBySlug: async (slug: string, asset: PaperMarketAsset): Promise<PaperMarketSnapshot> => {
        return fetchSnapshot(buildRefFromSlug(asset, slug));
      },
    },
    realtimeSource,
  });

  const getCurrentSnapshots = async () => {
    const snapshots = await hybridSource.getCurrentSnapshots();
    for (const snapshot of snapshots) {
      currentSnapshots.set(toCacheKey(snapshot.asset, snapshot.slug), snapshot);
    }
    return snapshots;
  };

  const getSnapshotBySlug = async (slug: string, asset: PaperMarketAsset): Promise<PaperMarketSnapshot> => {
    return hybridSource.getSnapshotBySlug(slug, asset);
  };

  const waitForNextSignal = async (afterTimestamp: string, timeoutMs: number): Promise<PaperMarketSnapshot> => {
    const snapshot = await realtimeSource.waitForNextSignal?.(afterTimestamp, timeoutMs);
    if (!snapshot) {
      throw new Error('Realtime live loop expected a realtime signal but none arrived.');
    }
    const resolvedSnapshot = isReliableRealtimeSnapshot(snapshot)
      ? snapshot
      : await fetchSnapshot(buildRefFromSlug(snapshot.asset, snapshot.slug));
    currentSnapshots.set(toCacheKey(resolvedSnapshot.asset, resolvedSnapshot.slug), resolvedSnapshot);
    return resolvedSnapshot;
  };

  return {
    getCurrentSnapshots,
    getSnapshotBySlug,
    waitForNextSignal,
    close: () => realtimeSource.close(),
    getExecutionSnapshot: async (snapshot, asset, side, action) => {
      const cachedSnapshot = currentSnapshots.get(toCacheKey(asset, snapshot.slug));
      if (cachedSnapshot && hasVisibleExecutionLiquidity(cachedSnapshot, side, action)) {
        return cachedSnapshot;
      }

      return fetchPaperMarketSnapshot(buildRefFromSlug(asset, snapshot.slug));
    },
    getMarketDetail: async (slug: string, asset: PaperMarketAsset) => {
      const cacheKey = toCacheKey(asset, slug);
      const cachedDetail = marketDetailCache.get(cacheKey);
      if (cachedDetail) {
        return cachedDetail;
      }

      const activeRefs = await discoverActiveRefs();
      const activeRef = activeRefs.find((ref) => ref.slug === slug && ref.asset === asset);
      const marketRef = activeRef ?? buildRefFromSlug(asset, slug);
      const detail = await fetchMarketDetailImpl(marketRef);
      marketDetailCache.set(cacheKey, detail);
      return detail;
    },
  };
}

export async function liveCommand(
  strategyId: string,
  config: BotlabConfig,
  options: LiveCommandOptions,
): Promise<string> {
  assertRealtimeCompatibleLiveStrategy(strategyId);
  const repoRoot = path.dirname(config.paths.rootDir);
  const intervalMs = Math.max(0, Math.round(options.intervalSeconds * 1000));
  const stakeUsd = Math.max(0, options.stakeUsd ?? 1);
  const marketSource = createLoopMarketSource(options.sessionName, repoRoot);
  const logLiveCycle = createQuietCycleLogger('live') as (report: LiveCycleReport) => void;
  const credentials = loadPolymarketLiveCredentialsFromEnv();
  const tradingClient = await createPolymarketLiveTradingClient(credentials);

  try {
    const result = await runLiveLoop({
      sessionName: options.sessionName,
      strategyDir: config.paths.strategyDir,
      strategyId,
      strategyParamOverrides: getStrategyParamOverrides(config.strategyParams, strategyId),
      cwd: repoRoot,
      startingCash: config.runtime.balance,
      intervalMs,
      maxCycles: options.maxCycles,
      stakeOverrideUsd: stakeUsd,
      onCycleReport: logLiveCycle,
      marketSource,
      tradingClient,
    });

    const state = loadLiveSessionState(options.sessionName, repoRoot, { startingCash: config.runtime.balance });
    const paths = resolveLiveSessionPaths(repoRoot, options.sessionName);

    return [
      'Live Session Summary',
      `Strategy: ${strategyId}`,
      `Session: ${options.sessionName}`,
      `Cycles This Run: ${result.cyclesCompleted}`,
      `Cycles Total: ${state.cycleCount}`,
      `Trades Opened: ${state.tradeCount}`,
      `Cash: ${formatBacktestNumber(state.cash)}`,
      `Equity: ${formatBacktestNumber(state.equity)}`,
      `Open Positions: ${Object.keys(state.positions).length}`,
      `State File: ${paths.statePath}`,
      `Summary File: ${paths.summaryPath}`,
      `Events File: ${paths.eventsPath}`,
    ].join('\n');
  } finally {
    await marketSource.close();
  }
}
