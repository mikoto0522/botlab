import path from 'node:path';
import type { BotlabConfig } from '../core/types.js';
import {
  createFixturePaperMarketSource,
  discoverActivePaperMarketRefs,
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
import { runPaperLoop, type PaperCycleReport } from '../paper/loop.js';
import { appendPaperSessionEvent } from '../paper/session-store.js';
import { loadPaperSessionState } from '../paper/session-store.js';
import { resolvePaperSessionPaths } from '../paper/types.js';
import { createQuietCycleLogger, createRealtimeConnectionReporter } from './realtime-logging.js';
import { formatBacktestNumber, resolveProjectRelativePath } from './backtest-common.js';
import { getStrategyParamOverrides } from '../core/strategy-params.js';

export interface PaperCommandOptions {
  sessionName: string;
  intervalSeconds: number;
  maxCycles?: number;
  fixturePath?: string;
}

function buildRefFromSlug(asset: PaperMarketAsset, slug: string): PaperMarketRef {
  const match = slug.match(/-(\d+)$/);
  if (!match) {
    throw new Error(`Cannot build a paper market ref from slug: ${slug}`);
  }

  const bucketStartEpoch = Number(match[1]);
  if (!Number.isFinite(bucketStartEpoch)) {
    throw new Error(`Cannot build a paper market ref from slug: ${slug}`);
  }

  return {
    asset,
    slug,
    bucketStartEpoch,
    bucketStartTime: new Date(bucketStartEpoch * 1000).toISOString(),
  };
}

type LoopMarketSourceWithClose = {
  getCurrentSnapshots: () => Promise<PaperMarketSnapshot[]>;
  getSnapshotBySlug: (slug: string, asset: PaperMarketAsset) => Promise<PaperMarketSnapshot>;
  waitForNextSignal?: (afterTimestamp: string, timeoutMs: number) => Promise<PaperMarketSnapshot>;
  close: () => Promise<void>;
};

interface PaperLoopMarketSourceDependencies {
  createRealtimeSource?: (options: Parameters<typeof createRealtimePaperMarketSource>[0]) => RealtimePaperMarketSource;
  discoverActiveRefs?: typeof discoverActivePaperMarketRefs;
  fetchSnapshot?: typeof fetchPaperMarketSnapshot;
}

export function createLoopMarketSource(
  config: BotlabConfig,
  sessionName: string,
  cwd: string,
  fixturePath?: string,
  dependencies: PaperLoopMarketSourceDependencies = {},
): LoopMarketSourceWithClose {
  if (fixturePath) {
    const resolvedFixturePath = resolveProjectRelativePath(config, fixturePath);
    const loadFixture = createFixturePaperMarketSource(resolvedFixturePath);

    return {
      getCurrentSnapshots: loadFixture,
      getSnapshotBySlug: async (slug: string, asset: PaperMarketAsset): Promise<PaperMarketSnapshot> => {
        const snapshots = await loadFixture();
        const match = snapshots.find((snapshot) => snapshot.slug === slug && snapshot.asset === asset);
        if (!match) {
          throw new Error(`Fixture file does not contain ${asset} snapshot ${slug}`);
        }

        return match;
      },
      close: async () => {},
    };
  }

  const createRealtimeSource = dependencies.createRealtimeSource ?? createRealtimePaperMarketSource;
  const discoverActiveRefs = dependencies.discoverActiveRefs ?? discoverActivePaperMarketRefs;
  const fetchSnapshot = dependencies.fetchSnapshot ?? fetchPaperMarketSnapshot;
  const realtimeSource = createRealtimeSource({
    reconnectDelayMs: 5_000,
    maxReconnectAttempts: 5,
    fatalOnReconnectExhausted: true,
    onConnectionEvent: createRealtimeConnectionReporter('paper', {
      appendEvent: (event) => {
        appendPaperSessionEvent(sessionName, event, cwd);
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

  return {
    getCurrentSnapshots: () => hybridSource.getCurrentSnapshots(),
    getSnapshotBySlug: hybridSource.getSnapshotBySlug,
    waitForNextSignal: async (afterTimestamp: string, timeoutMs: number) => {
      if (!realtimeSource.waitForNextSignal) {
        throw new Error('Realtime paper source does not support single-asset signal waits.');
      }

      const snapshot = await realtimeSource.waitForNextSignal(afterTimestamp, timeoutMs);
      if (isReliableRealtimeSnapshot(snapshot)) {
        return snapshot;
      }

      return fetchSnapshot(buildRefFromSlug(snapshot.asset, snapshot.slug));
    },
    close: () => realtimeSource.close(),
  };
}

export async function paperCommand(
  strategyId: string,
  config: BotlabConfig,
  options: PaperCommandOptions,
): Promise<string> {
  const repoRoot = path.dirname(config.paths.rootDir);
  const intervalMs = Math.max(0, Math.round(options.intervalSeconds * 1000));
  const marketSource = createLoopMarketSource(config, options.sessionName, repoRoot, options.fixturePath);
  const logPaperCycle = createQuietCycleLogger('paper') as (report: PaperCycleReport) => void;

  try {
    const result = await runPaperLoop({
      sessionName: options.sessionName,
      strategyDir: config.paths.strategyDir,
      strategyId,
      strategyParamOverrides: getStrategyParamOverrides(config.strategyParams, strategyId),
      cwd: repoRoot,
      startingCash: config.runtime.balance,
      intervalMs,
      maxCycles: options.maxCycles,
      onCycleReport: logPaperCycle,
      marketSource,
    });

    const state = loadPaperSessionState(options.sessionName, repoRoot, { startingCash: config.runtime.balance });
    const paths = resolvePaperSessionPaths(repoRoot, options.sessionName);

    return [
      'Paper Session Summary',
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
