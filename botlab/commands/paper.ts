import path from 'node:path';
import type { BotlabConfig } from '../core/types.js';
import {
  createFixturePaperMarketSource,
  createLivePaperMarketSource,
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
import { runPaperLoop, type PaperCycleReport } from '../paper/loop.js';
import { loadPaperSessionState } from '../paper/session-store.js';
import { resolvePaperSessionPaths } from '../paper/types.js';
import { formatBacktestNumber, resolveProjectRelativePath } from './backtest-common.js';
import { getStrategyParamOverrides } from '../core/strategy-params.js';

export interface PaperCommandOptions {
  sessionName: string;
  intervalSeconds: number;
  maxCycles?: number;
  fixturePath?: string;
}

function formatDecisionSummary(report: {
  asset: string;
  action: string;
  side?: string;
  marketSlug?: string;
  upPrice: number | null;
  downPrice: number | null;
}): string {
  const prices = `price up=${report.upPrice ?? 'n/a'} down=${report.downPrice ?? 'n/a'}`;
  const marketSlug = report.marketSlug ? ` ${report.marketSlug}` : '';
  const side = report.side === 'flat' ? '' : ` ${report.side}`;

  return `${report.asset}${marketSlug} ${report.action}${side} (${prices})`;
}

function logPaperCycle(report: PaperCycleReport): void {
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

type LoopMarketSourceWithClose = HybridPaperMarketSource;

function createLoopMarketSource(config: BotlabConfig, fixturePath?: string): LoopMarketSourceWithClose {
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

  const pollingSource = {
    getCurrentSnapshots: createLivePaperMarketSource(),
    getSnapshotBySlug: async (slug: string, asset: PaperMarketAsset): Promise<PaperMarketSnapshot> => {
      return fetchPaperMarketSnapshot(buildRefFromSlug(asset, slug));
    },
  };

  const realtimeSource = createRealtimePaperMarketSource();

  return createHybridPaperMarketSource({
    pollingSource,
    realtimeSource,
  });
}

export async function paperCommand(
  strategyId: string,
  config: BotlabConfig,
  options: PaperCommandOptions,
): Promise<string> {
  const repoRoot = path.dirname(config.paths.rootDir);
  const intervalMs = Math.max(0, Math.round(options.intervalSeconds * 1000));
  const marketSource = createLoopMarketSource(config, options.fixturePath);

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
