import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BotlabConfig } from '../core/types.js';
import { formatBacktestNumber } from './backtest-common.js';
import {
  createPolymarketLiveTradingClient,
  loadPolymarketLiveCredentialsFromEnv,
  type LiveTradingClient,
} from '../live/client.js';
import { runLiveLoop, type LiveLoopMarketSource } from '../live/loop.js';
import { loadLiveSessionState } from '../live/session-store.js';
import { resolveLiveSessionPaths, type LiveSessionEvent } from '../live/types.js';
import { createLoopMarketSource, type LoopMarketSourceWithClose } from './live.js';
import type { PaperMarketAsset } from '../paper/market-source.js';

const MANUAL_STRATEGY_ID = 'manual-live-order';

export interface ManualLiveOrderCommandOptions {
  asset: PaperMarketAsset;
  side: 'up' | 'down';
  stakeUsd: number;
  sessionName?: string;
  cwd?: string;
  marketSource?: LiveLoopMarketSource & { close?: () => Promise<void> };
  tradingClient?: LiveTradingClient;
}

function createDefaultSessionName(asset: PaperMarketAsset, side: 'up' | 'down'): string {
  return `manual-live-${asset.toLowerCase()}-${side}-${Date.now()}`;
}

async function writeManualStrategyFile(
  asset: PaperMarketAsset,
  side: 'up' | 'down',
): Promise<{ strategyDir: string; cleanup: () => Promise<void> }> {
  const strategyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'botlab-manual-live-order-'));
  const strategyPath = path.join(strategyDir, 'manual-live-order.strategy.ts');
  const source = [
    'export const strategy = {',
    `  id: '${MANUAL_STRATEGY_ID}',`,
    "  name: 'Manual Live Order',",
    "  description: 'Places one manual live order for the selected asset and side.',",
    '  defaults: {},',
    '  evaluate(context) {',
    `    if (context.market.asset !== '${asset}') {`,
    "      return { action: 'hold', reason: 'manual order targets a different asset' };",
    '    }',
    "    if (context.position.side !== 'flat') {",
    "      return { action: 'hold', reason: 'manual order session already has an open position' };",
    '    }',
    `    return { action: 'buy', side: '${side}', size: 1, reason: 'manual live order' };`,
    '  },',
    '};',
    '',
  ].join('\n');

  await fs.writeFile(strategyPath, source, 'utf8');

  return {
    strategyDir,
    cleanup: async () => {
      await fs.rm(strategyDir, { recursive: true, force: true });
    },
  };
}

function parseEvents(raw: string): LiveSessionEvent[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LiveSessionEvent);
}

function findLatestOpenedEvent(events: LiveSessionEvent[], asset: PaperMarketAsset) {
  return [...events]
    .reverse()
    .find((event) => event.type === 'live-position-opened' && event.asset === asset);
}

function readEventString(event: LiveSessionEvent, field: string): string {
  const value = event[field];
  return typeof value === 'string' ? value : 'unknown';
}

function readEventNumber(event: LiveSessionEvent, field: string): number {
  const value = event[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function buildResultSummary(input: {
  sessionName: string;
  asset: PaperMarketAsset;
  side: 'up' | 'down';
  stakeUsd: number;
  event: ReturnType<typeof findLatestOpenedEvent>;
  cash: number;
  equity: number;
  paths: ReturnType<typeof resolveLiveSessionPaths>;
}): string {
  const lines = [
    'Manual Live Order Result',
    `Session: ${input.sessionName}`,
    `Asset: ${input.asset}`,
    `Side: ${input.side}`,
    `Stake: ${formatBacktestNumber(input.stakeUsd)}`,
  ];

  if (input.event) {
    lines.push(
      `Market: ${readEventString(input.event, 'marketSlug')}`,
      `Status: ${readEventString(input.event, 'status')}`,
      `Order ID: ${readEventString(input.event, 'orderId')}`,
      `Shares: ${formatBacktestNumber(readEventNumber(input.event, 'shares'))}`,
      `Average Price: ${formatBacktestNumber(readEventNumber(input.event, 'entryPrice'))}`,
      `Fee: ${formatBacktestNumber(readEventNumber(input.event, 'entryFee'))}`,
    );
  } else {
    lines.push('Status: no live order opened');
  }

  lines.push(
    `Cash: ${formatBacktestNumber(input.cash)}`,
    `Equity: ${formatBacktestNumber(input.equity)}`,
    `State File: ${input.paths.statePath}`,
    `Events File: ${input.paths.eventsPath}`,
  );

  return lines.join('\n');
}

export async function manualLiveOrderCommand(
  config: BotlabConfig,
  options: ManualLiveOrderCommandOptions,
): Promise<string> {
  const repoRoot = options.cwd ?? path.dirname(config.paths.rootDir);
  const sessionName = options.sessionName ?? createDefaultSessionName(options.asset, options.side);
  const marketSource = options.marketSource ?? createLoopMarketSource();
  const tradingClient = options.tradingClient
    ?? await createPolymarketLiveTradingClient(loadPolymarketLiveCredentialsFromEnv());
  const { strategyDir, cleanup } = await writeManualStrategyFile(options.asset, options.side);

  try {
    await runLiveLoop({
      sessionName,
      strategyDir,
      strategyId: MANUAL_STRATEGY_ID,
      cwd: repoRoot,
      startingCash: config.runtime.balance,
      intervalMs: 0,
      maxCycles: 1,
      stakeOverrideUsd: options.stakeUsd,
      marketSource,
      tradingClient,
    });

    const state = loadLiveSessionState(sessionName, repoRoot, { startingCash: config.runtime.balance });
    const paths = resolveLiveSessionPaths(repoRoot, sessionName);
    const rawEvents = await fs.readFile(paths.eventsPath, 'utf8').catch(() => '');
    const events = parseEvents(rawEvents);
    const openedEvent = findLatestOpenedEvent(events, options.asset);

    return buildResultSummary({
      sessionName,
      asset: options.asset,
      side: options.side,
      stakeUsd: options.stakeUsd,
      event: openedEvent,
      cash: state.cash,
      equity: state.equity,
      paths,
    });
  } finally {
    await cleanup();
    if (marketSource.close) {
      await marketSource.close();
    }
  }
}

export type ManualLiveOrderMarketSource = LoopMarketSourceWithClose;
