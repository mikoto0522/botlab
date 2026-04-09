import path from 'node:path';
import type { BotlabConfig } from '../core/types.js';
import { getStrategyParamOverrides } from '../core/strategy-params.js';
import {
  createLivePaperMarketSource,
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
  type HybridPaperMarketSource,
} from '../paper/realtime-market-source.js';
import { formatBacktestNumber } from './backtest-common.js';
import { createPolymarketLiveTradingClient, loadPolymarketLiveCredentialsFromEnv } from '../live/client.js';
import { runLiveLoop, type LiveCycleReport } from '../live/loop.js';
import { loadLiveSessionState } from '../live/session-store.js';
import { resolveLiveSessionPaths } from '../live/types.js';

export interface LiveCommandOptions {
  sessionName: string;
  intervalSeconds: number;
  maxCycles?: number;
  stakeUsd?: number;
}

function formatDecisionSummary(report: {
  asset: string;
  action: string;
  side?: string;
  marketSlug?: string;
  upPrice: number | null;
  downPrice: number | null;
  upAsk?: number | null;
  downAsk?: number | null;
}): string {
  const prices = `price up=${report.upPrice ?? 'n/a'} down=${report.downPrice ?? 'n/a'}`;
  const asks = `ask up=${report.upAsk ?? 'n/a'} down=${report.downAsk ?? 'n/a'}`;
  const marketSlug = report.marketSlug ? ` ${report.marketSlug}` : '';
  const side = report.side === 'flat' ? '' : ` ${report.side}`;

  return `${report.asset}${marketSlug} ${report.action}${side} (${prices}; ${asks})`;
}

function logLiveCycle(report: LiveCycleReport): void {
  if (report.type === 'error') {
    console.log(`[${report.timestamp}] cycle ${report.cycleCount}: skipped (${report.errorMessage})`);
    return;
  }

  const decisions = (report.decisions ?? []).map(formatDecisionSummary).join(' | ');
  console.log(
    `[${report.timestamp}] cycle ${report.cycleCount}: ${decisions || 'no decisions'} | opened=${report.openedCount} closed=${report.closedCount} settled=${report.settledCount} | cash=${formatBacktestNumber(report.cash)} equity=${formatBacktestNumber(report.equity)}`,
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

type LoopMarketSourceWithClose = HybridPaperMarketSource & {
  getMarketDetail: (slug: string, asset: PaperMarketAsset) => ReturnType<typeof fetchPaperMarketDetail>;
};

function createLoopMarketSource(): LoopMarketSourceWithClose {
  const pollingSource = {
    getCurrentSnapshots: createLivePaperMarketSource(),
    getSnapshotBySlug: async (slug: string, asset: PaperMarketAsset): Promise<PaperMarketSnapshot> => {
      return fetchPaperMarketSnapshot(buildRefFromSlug(asset, slug));
    },
  };

  const realtimeSource = createRealtimePaperMarketSource();
  const hybridSource = createHybridPaperMarketSource({
    pollingSource,
    realtimeSource,
  });

  return {
    ...hybridSource,
    getMarketDetail: async (slug: string, asset: PaperMarketAsset) => {
      const activeRefs = await discoverActivePaperMarketRefs();
      const activeRef = activeRefs.find((ref) => ref.slug === slug && ref.asset === asset);
      const marketRef = activeRef ?? buildRefFromSlug(asset, slug);
      return fetchPaperMarketDetail(marketRef);
    },
  };
}

export async function liveCommand(
  strategyId: string,
  config: BotlabConfig,
  options: LiveCommandOptions,
): Promise<string> {
  const repoRoot = path.dirname(config.paths.rootDir);
  const intervalMs = Math.max(0, Math.round(options.intervalSeconds * 1000));
  const stakeUsd = Math.max(0, options.stakeUsd ?? 1);
  const marketSource = createLoopMarketSource();
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
