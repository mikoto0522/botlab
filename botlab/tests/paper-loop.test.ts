import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadPaperSessionState } from '../paper/session-store.js';
import type { PaperMarketSnapshot } from '../paper/market-source.js';
import { resolvePaperSessionPaths } from '../paper/types.js';

function writeLoopStrategy(): string {
  const strategyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-loop-strategy-'));
  const strategyPath = path.join(strategyDir, 'paper-loop-test.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'paper-loop-test',",
      "  name: 'Paper Loop Test',",
      "  description: 'Buys BTC once, then stays flat so loop behavior can be asserted.',",
      '  defaults: {},',
      '  evaluate(context) {',
      "    if (context.market.asset !== 'BTC') {",
      "      return { action: 'hold', reason: 'BTC only' };",
      '    }',
      "    if (context.position.side !== 'flat') {",
      "      return { action: 'hold', reason: 'already in position' };",
      '    }',
      '    if (context.market.candles.length === 1) {',
      "      return { action: 'buy', side: 'up', size: 100, reason: 'open first BTC bucket' };",
      '    }',
      "    return { action: 'hold', reason: 'history already seeded' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return strategyDir;
}

function writeSellStrategy(): string {
  const strategyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-sell-strategy-'));
  const strategyPath = path.join(strategyDir, 'paper-sell-test.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'paper-sell-test',",
      "  name: 'Paper Sell Test',",
      "  description: 'Buys the first BTC bucket, then sells on the next one.',",
      '  defaults: {},',
      '  evaluate(context) {',
      "    if (context.market.asset !== 'BTC') {",
      "      return { action: 'hold', reason: 'BTC only' };",
      '    }',
      '    if (context.position.side === "flat" && context.market.candles.length === 1) {',
      "      return { action: 'buy', side: 'up', size: 100, reason: 'open first BTC bucket' };",
      '    }',
      '    if (context.position.side !== "flat") {',
      "      return { action: 'sell', reason: 'close on the next bucket' };",
      '    }',
      "    return { action: 'hold', reason: 'wait for the first bucket' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return strategyDir;
}

function writeParametrizedPaperStrategy(): string {
  const strategyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-param-strategy-'));
  const strategyPath = path.join(strategyDir, 'paper-param-test.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'paper-param-test',",
      "  name: 'Paper Param Test',",
      "  description: 'Uses a configurable stake so paper-loop overrides can be asserted.',",
      '  defaults: {',
      '    stake: 100,',
      '  },',
      '  evaluate(context, params) {',
      "    if (context.market.asset !== 'BTC') {",
      "      return { action: 'hold', reason: 'BTC only' };",
      '    }',
      "    if (context.position.side !== 'flat') {",
      "      return { action: 'hold', reason: 'already in position' };",
      '    }',
      "    return { action: 'buy', side: 'up', size: params.stake, reason: 'use configured stake' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return strategyDir;
}

function writeAssetPaperStrategy(asset: 'BTC' | 'ETH'): string {
  const strategyDir = fs.mkdtempSync(path.join(os.tmpdir(), `botlab-paper-${asset.toLowerCase()}-strategy-`));
  const strategyPath = path.join(strategyDir, `paper-${asset.toLowerCase()}-test.strategy.ts`);
  const strategyId = `paper-${asset.toLowerCase()}-test`;

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      `  id: '${strategyId}',`,
      `  name: 'Paper ${asset} Test',`,
      `  description: 'Buys ${asset} once so realtime single-asset paper flow can be asserted.',`,
      '  defaults: {},',
      '  evaluate(context) {',
      `    if (context.market.asset !== '${asset}') {`,
      "      return { action: 'hold', reason: 'different asset' };",
      '    }',
      "    if (context.position.side !== 'flat') {",
      "      return { action: 'hold', reason: 'already in position' };",
      '    }',
      "    return { action: 'buy', side: 'up', size: 10, reason: 'single-asset realtime paper entry' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return strategyDir;
}

function createSnapshot(input: Partial<PaperMarketSnapshot> & Pick<PaperMarketSnapshot, 'asset' | 'slug' | 'bucketStartTime' | 'bucketStartEpoch'>): PaperMarketSnapshot {
  const upPrice = input.upPrice ?? 0.5;
  const downPrice = input.downPrice ?? 0.5;
  const upAsk = input.upAsk ?? upPrice;
  const downAsk = input.downAsk ?? downPrice;

  return {
    ...(input as Record<string, unknown>),
    asset: input.asset,
    slug: input.slug,
    question: input.question ?? `${input.asset} 5m up/down`,
    active: input.active ?? true,
    closed: input.closed ?? false,
    acceptingOrders: input.acceptingOrders ?? true,
    eventStartTime: input.eventStartTime ?? input.bucketStartTime,
    endDate: input.endDate ?? new Date((input.bucketStartEpoch + 300) * 1000).toISOString(),
    bucketStartTime: input.bucketStartTime,
    bucketStartEpoch: input.bucketStartEpoch,
    upPrice,
    downPrice,
    upAsk,
    downAsk,
    upOrderBook: input.upOrderBook ?? {
      bids: [{ price: upPrice, size: 10_000 }],
      asks: [{ price: upAsk, size: 10_000 }],
    },
    downOrderBook: input.downOrderBook ?? {
      bids: [{ price: downPrice, size: 10_000 }],
      asks: [{ price: downAsk, size: 10_000 }],
    },
    downAskDerivedFromBestBid: input.downAskDerivedFromBestBid ?? false,
    volume: input.volume ?? 25_000,
    fetchedAt: input.fetchedAt ?? input.bucketStartTime,
  } as PaperMarketSnapshot;
}

test('runPaperLoop respects maxCycles, updates same-bucket history in place, and persists the open position', async () => {
  const { runPaperLoop } = await import('../paper/loop.js');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-loop-'));
  const strategyDir = writeLoopStrategy();
  let cycleIndex = 0;

  const cycleSnapshots: PaperMarketSnapshot[][] = [
    [
      createSnapshot({
        asset: 'BTC',
        slug: 'btc-updown-5m-1711443600',
        bucketStartTime: '2026-03-26T09:00:00.000Z',
        bucketStartEpoch: 1711443600,
        upPrice: 0.4,
        downPrice: 0.6,
        upAsk: 0.42,
        downAsk: 0.62,
        fetchedAt: '2026-03-26T09:00:10.000Z',
      }),
      createSnapshot({
        asset: 'ETH',
        slug: 'eth-updown-5m-1711443600',
        bucketStartTime: '2026-03-26T09:00:00.000Z',
        bucketStartEpoch: 1711443600,
        upPrice: 0.55,
        downPrice: 0.45,
        upAsk: 0.57,
        downAsk: 0.47,
        fetchedAt: '2026-03-26T09:00:10.000Z',
      }),
    ],
    [
      createSnapshot({
        asset: 'BTC',
        slug: 'btc-updown-5m-1711443600',
        bucketStartTime: '2026-03-26T09:00:00.000Z',
        bucketStartEpoch: 1711443600,
        upPrice: 0.45,
        downPrice: 0.55,
        upAsk: 0.47,
        downAsk: 0.57,
        fetchedAt: '2026-03-26T09:02:00.000Z',
      }),
      createSnapshot({
        asset: 'ETH',
        slug: 'eth-updown-5m-1711443600',
        bucketStartTime: '2026-03-26T09:00:00.000Z',
        bucketStartEpoch: 1711443600,
        upPrice: 0.52,
        downPrice: 0.48,
        upAsk: 0.54,
        downAsk: 0.5,
        fetchedAt: '2026-03-26T09:02:00.000Z',
      }),
    ],
  ];

  const result = await runPaperLoop({
    sessionName: 'Loop Session',
    strategyId: 'paper-loop-test',
    strategyDir,
    cwd,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 2,
    marketSource: {
      getCurrentSnapshots: async () => {
        const snapshots = cycleSnapshots[cycleIndex];
        cycleIndex += 1;

        assert.ok(snapshots, 'expected the loop to stop before requesting another cycle');
        return snapshots.map((snapshot) => ({ ...snapshot }));
      },
      getSnapshotBySlug: async (slug) => {
        const match = cycleSnapshots.flat().find((snapshot) => snapshot.slug === slug);
        assert.ok(match, `unexpected settlement lookup for ${slug}`);
        return { ...match };
      },
    },
  });

  const state = loadPaperSessionState('Loop Session', cwd);
  const { eventsPath } = resolvePaperSessionPaths(cwd, 'Loop Session');
  const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(result.cyclesCompleted, 2);
  assert.equal(cycleIndex, 2);
  assert.equal(state.cycleCount, 2);
  assert.equal(state.tradeCount, 1);
  assert.equal(state.history.BTC.points.length, 1);
  assert.deepEqual(state.history.BTC.points[0], {
    timestamp: '2026-03-26T09:00:00.000Z',
    price: 0.45,
  });
  assert.equal(state.history.ETH.points.length, 1);
  assert.equal(state.positions.BTC?.marketSlug, 'btc-updown-5m-1711443600');
  assert.equal(state.positions.BTC?.predictionSide, 'up');
  assert.equal(state.positions.BTC?.shares, 233.99);
  assert.equal(state.cash, 900.00052108864);
  assert.equal(state.equity, 1005.2960210886399);
  assert.equal(events.length, 7);
  assert.equal(events[0]?.type, 'paper-strategy-decision');
  assert.equal(events[1]?.type, 'paper-strategy-decision');
  assert.equal(events[2]?.type, 'paper-position-opened');
  assert.equal(events[3]?.type, 'paper-cycle-complete');
  assert.equal(events[6]?.type, 'paper-cycle-complete');
});

test('runPaperLoop resumes a stored position and settles it when the saved market closes', async () => {
  const { runPaperLoop } = await import('../paper/loop.js');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-resume-'));
  const strategyDir = writeLoopStrategy();
  const sessionName = 'Resume Session';
  let slugLookupCount = 0;

  await runPaperLoop({
    sessionName,
    strategyId: 'paper-loop-test',
    strategyDir,
    cwd,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 1,
    marketSource: {
      getCurrentSnapshots: async () => [
        createSnapshot({
          asset: 'BTC',
          slug: 'btc-updown-5m-1711443600',
          bucketStartTime: '2026-03-26T09:00:00.000Z',
          bucketStartEpoch: 1711443600,
          upPrice: 0.4,
          downPrice: 0.6,
          upAsk: 0.42,
          downAsk: 0.62,
          fetchedAt: '2026-03-26T09:00:10.000Z',
        }),
        createSnapshot({
          asset: 'ETH',
          slug: 'eth-updown-5m-1711443600',
          bucketStartTime: '2026-03-26T09:00:00.000Z',
          bucketStartEpoch: 1711443600,
          upPrice: 0.55,
          downPrice: 0.45,
          upAsk: 0.57,
          downAsk: 0.47,
          fetchedAt: '2026-03-26T09:00:10.000Z',
        }),
      ],
      getSnapshotBySlug: async (slug) => {
        slugLookupCount += 1;
        const match = slug === 'btc-updown-5m-1711443600'
          ? createSnapshot({
              asset: 'BTC',
              slug,
              bucketStartTime: '2026-03-26T09:00:00.000Z',
              bucketStartEpoch: 1711443600,
              upPrice: 0.4,
              downPrice: 0.6,
              upAsk: 0.42,
              downAsk: 0.62,
              fetchedAt: '2026-03-26T09:00:10.000Z',
            })
          : undefined;

        assert.ok(match, `unexpected slug lookup for ${slug}`);
        return match;
      },
    },
  });

  const result = await runPaperLoop({
    sessionName,
    strategyId: 'paper-loop-test',
    strategyDir,
    cwd,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 1,
    marketSource: {
      getCurrentSnapshots: async () => [
        createSnapshot({
          asset: 'BTC',
          slug: 'btc-updown-5m-1711443900',
          bucketStartTime: '2026-03-26T09:05:00.000Z',
          bucketStartEpoch: 1711443900,
          upPrice: 0.51,
          downPrice: 0.49,
          upAsk: 0.53,
          downAsk: 0.51,
          fetchedAt: '2026-03-26T09:05:10.000Z',
        }),
        createSnapshot({
          asset: 'ETH',
          slug: 'eth-updown-5m-1711443900',
          bucketStartTime: '2026-03-26T09:05:00.000Z',
          bucketStartEpoch: 1711443900,
          upPrice: 0.48,
          downPrice: 0.52,
          upAsk: 0.5,
          downAsk: 0.54,
          fetchedAt: '2026-03-26T09:05:10.000Z',
        }),
      ],
      getSnapshotBySlug: async (slug) => {
        slugLookupCount += 1;
        assert.equal(slug, 'btc-updown-5m-1711443600');

        return createSnapshot({
          asset: 'BTC',
          slug,
          bucketStartTime: '2026-03-26T09:00:00.000Z',
          bucketStartEpoch: 1711443600,
          upPrice: 1,
          downPrice: 0,
          upAsk: 1,
          downAsk: 0,
          closed: true,
          active: false,
          acceptingOrders: false,
          fetchedAt: '2026-03-26T09:05:03.000Z',
        });
      },
    },
  });

  const state = loadPaperSessionState(sessionName, cwd);
  const { eventsPath } = resolvePaperSessionPaths(cwd, sessionName);
  const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(result.cyclesCompleted, 1);
  assert.equal(state.cycleCount, 2);
  assert.equal(state.tradeCount, 1);
  assert.equal(state.positions.BTC, undefined);
  assert.equal(state.cash, 1133.99052108864);
  assert.equal(state.equity, 1133.99052108864);
  assert.equal(state.history.BTC.points.length, 2);
  assert.equal(state.history.BTC.points[1]?.timestamp, '2026-03-26T09:05:00.000Z');
  assert.equal(state.history.BTC.points[1]?.price, 0.51);
  assert.equal(slugLookupCount, 1);
  assert.equal(events.some((event) => event.type === 'paper-position-opened'), true);
  assert.equal(events.some((event) => event.type === 'paper-position-settled'), true);
});

test('runPaperLoop closes an open position when the strategy returns sell on a later cycle', async () => {
  const { runPaperLoop } = await import('../paper/loop.js');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-close-'));
  const strategyDir = writeSellStrategy();
  let cycleIndex = 0;

  const cycleSnapshots: PaperMarketSnapshot[][] = [
    [
      createSnapshot({
        asset: 'BTC',
        slug: 'btc-updown-5m-1711443600',
        bucketStartTime: '2026-03-26T09:00:00.000Z',
        bucketStartEpoch: 1711443600,
        upPrice: 0.4,
        downPrice: 0.6,
        upAsk: 0.42,
        downAsk: 0.62,
        fetchedAt: '2026-03-26T09:00:10.000Z',
      }),
      createSnapshot({
        asset: 'ETH',
        slug: 'eth-updown-5m-1711443600',
        bucketStartTime: '2026-03-26T09:00:00.000Z',
        bucketStartEpoch: 1711443600,
        upPrice: 0.52,
        downPrice: 0.48,
        upAsk: 0.54,
        downAsk: 0.5,
        fetchedAt: '2026-03-26T09:00:10.000Z',
      }),
    ],
    [
      createSnapshot({
        asset: 'BTC',
        slug: 'btc-updown-5m-1711443900',
        bucketStartTime: '2026-03-26T09:05:00.000Z',
        bucketStartEpoch: 1711443900,
        upPrice: 0.61,
        downPrice: 0.39,
        upAsk: 0.63,
        downAsk: 0.41,
        fetchedAt: '2026-03-26T09:05:10.000Z',
      }),
      createSnapshot({
        asset: 'ETH',
        slug: 'eth-updown-5m-1711443900',
        bucketStartTime: '2026-03-26T09:05:00.000Z',
        bucketStartEpoch: 1711443900,
        upPrice: 0.49,
        downPrice: 0.51,
        upAsk: 0.51,
        downAsk: 0.53,
        fetchedAt: '2026-03-26T09:05:10.000Z',
      }),
    ],
  ];

  await runPaperLoop({
    sessionName: 'Sell Session',
    strategyId: 'paper-sell-test',
    strategyDir,
    cwd,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 2,
    marketSource: {
      getCurrentSnapshots: async () => cycleSnapshots[cycleIndex++]!.map((snapshot) => ({ ...snapshot })),
      getSnapshotBySlug: async (slug) => {
        const match = cycleSnapshots.flat().find((snapshot) => snapshot.slug === slug);
        assert.ok(match, `unexpected slug lookup for ${slug}`);
        return { ...match };
      },
    },
  });

  const state = loadPaperSessionState('Sell Session', cwd);
  const { eventsPath } = resolvePaperSessionPaths(cwd, 'Sell Session');
  const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(state.positions.BTC, undefined);
  assert.equal(state.tradeCount, 1);
  assert.equal(events.some((event) => event.type === 'paper-position-closed'), true);
  assert.equal(events.some((event) => event.type === 'paper-strategy-decision' && event.action === 'sell'), true);
});

test('runPaperLoop logs a failed cycle, keeps the session, and waits before retrying', async () => {
  const { runPaperLoop } = await import('../paper/loop.js');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-error-'));
  const strategyDir = writeLoopStrategy();
  const sleepCalls: number[] = [];
  let requestCount = 0;

  await runPaperLoop({
    sessionName: 'Retry Session',
    strategyId: 'paper-loop-test',
    strategyDir,
    cwd,
    intervalMs: 7,
    maxCycles: 2,
    sleepMs: async (delayMs) => {
      sleepCalls.push(delayMs);
    },
    marketSource: {
      getCurrentSnapshots: async () => {
        requestCount += 1;
        if (requestCount === 1) {
          throw new Error('temporary fetch failure');
        }

        return [
          createSnapshot({
            asset: 'BTC',
            slug: 'btc-updown-5m-1711443600',
            bucketStartTime: '2026-03-26T09:00:00.000Z',
            bucketStartEpoch: 1711443600,
            upPrice: 0.4,
            downPrice: 0.6,
            upAsk: 0.42,
            downAsk: 0.62,
            fetchedAt: '2026-03-26T09:00:10.000Z',
          }),
          createSnapshot({
            asset: 'ETH',
            slug: 'eth-updown-5m-1711443600',
            bucketStartTime: '2026-03-26T09:00:00.000Z',
            bucketStartEpoch: 1711443600,
            upPrice: 0.52,
            downPrice: 0.48,
            upAsk: 0.54,
            downAsk: 0.5,
            fetchedAt: '2026-03-26T09:00:10.000Z',
          }),
        ];
      },
      getSnapshotBySlug: async (slug) => {
        assert.fail(`unexpected slug lookup for ${slug}`);
      },
    },
  });

  const state = loadPaperSessionState('Retry Session', cwd);
  const { eventsPath } = resolvePaperSessionPaths(cwd, 'Retry Session');
  const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(state.cycleCount, 2);
  assert.equal(state.tradeCount, 1);
  assert.deepEqual(sleepCalls, [7]);
  assert.equal(events.some((event) => event.type === 'paper-cycle-error' && event.message === 'temporary fetch failure'), true);
  assert.equal(events.some((event) => event.type === 'paper-cycle-complete'), true);
});

test('runPaperLoop stops immediately when realtime reconnect attempts are exhausted', async () => {
  const { runPaperLoop } = await import('../paper/loop.js');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-fatal-error-'));
  const strategyDir = writeAssetPaperStrategy('BTC');
  const reports: Array<{ type: string; message?: string }> = [];

  await assert.rejects(
    () => runPaperLoop({
      sessionName: 'Fatal Retry Session',
      strategyId: 'paper-btc-test',
      strategyDir,
      cwd,
      intervalMs: 30_000,
      maxCycles: 3,
      sleepMs: async () => {
        assert.fail('paper realtime loop should not sleep after a fatal realtime disconnect');
      },
      onCycleReport: async (report) => {
        reports.push({
          type: report.type,
          message: report.type === 'error' ? report.errorMessage : undefined,
        });
      },
      marketSource: {
        getCurrentSnapshots: async () => [],
        waitForNextSignal: async () => {
          const error = new Error('Realtime market connection exhausted 5 reconnect attempts.');
          error.name = 'RealtimeConnectionExhaustedError';
          throw error;
        },
        getSnapshotBySlug: async (slug) => {
          assert.fail(`unexpected slug lookup for ${slug}`);
        },
      },
    }),
    /Realtime market connection exhausted 5 reconnect attempts\./,
  );

  const state = loadPaperSessionState('Fatal Retry Session', cwd);
  const { eventsPath } = resolvePaperSessionPaths(cwd, 'Fatal Retry Session');
  const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(state.cycleCount, 1);
  assert.deepEqual(reports, [{
    type: 'error',
    message: 'Realtime market connection exhausted 5 reconnect attempts.',
  }]);
  assert.equal(events.some((event) => event.type === 'paper-cycle-error' && event.message === 'Realtime market connection exhausted 5 reconnect attempts.'), true);
});

test('runPaperLoop applies configured strategy parameter overrides to position sizing', async () => {
  const { runPaperLoop } = await import('../paper/loop.js');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-param-'));
  const strategyDir = writeParametrizedPaperStrategy();

  await runPaperLoop({
    sessionName: 'Param Session',
    strategyId: 'paper-param-test',
    strategyDir,
    cwd,
    startingCash: 100,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 1,
    strategyParamOverrides: {
      stake: 5,
    },
    marketSource: {
      getCurrentSnapshots: async () => [
        createSnapshot({
          asset: 'BTC',
          slug: 'btc-updown-5m-1711443600',
          bucketStartTime: '2026-03-26T09:00:00.000Z',
          bucketStartEpoch: 1711443600,
          upPrice: 0.4,
          downPrice: 0.6,
          upAsk: 0.42,
          downAsk: 0.62,
          fetchedAt: '2026-03-26T09:00:10.000Z',
        }),
        createSnapshot({
          asset: 'ETH',
          slug: 'eth-updown-5m-1711443600',
          bucketStartTime: '2026-03-26T09:00:00.000Z',
          bucketStartEpoch: 1711443600,
          upPrice: 0.55,
          downPrice: 0.45,
          upAsk: 0.57,
          downAsk: 0.47,
          fetchedAt: '2026-03-26T09:00:10.000Z',
        }),
      ],
      getSnapshotBySlug: async (slug) => {
        assert.fail(`unexpected slug lookup for ${slug}`);
      },
    },
  });

  const state = loadPaperSessionState('Param Session', cwd, { startingCash: 100 });

  assert.equal(state.tradeCount, 1);
  assert.equal(state.positions.BTC?.shares, 11.69);
  assert.equal(state.cash < 95.1 && state.cash > 94.9, true);
});

test('runPaperLoop partially fills an entry when the order book cannot satisfy the requested stake', async () => {
  const { runPaperLoop } = await import('../paper/loop.js');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-partial-open-'));
  const strategyDir = writeParametrizedPaperStrategy();

  await runPaperLoop({
    sessionName: 'Partial Open Session',
    strategyId: 'paper-param-test',
    strategyDir,
    cwd,
    startingCash: 100,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 1,
    strategyParamOverrides: {
      stake: 100,
    },
    marketSource: {
      getCurrentSnapshots: async () => [
        createSnapshot({
          asset: 'BTC',
          slug: 'btc-updown-5m-1711443600',
          bucketStartTime: '2026-03-26T09:00:00.000Z',
          bucketStartEpoch: 1711443600,
          upPrice: 0.42,
          downPrice: 0.58,
          upAsk: 0.43,
          downAsk: 0.59,
          fetchedAt: '2026-03-26T09:00:10.000Z',
          upOrderBook: {
            bids: [{ price: 0.41, size: 30 }],
            asks: [
              { price: 0.43, size: 5 },
              { price: 0.45, size: 4 },
            ],
          },
          downOrderBook: {
            bids: [{ price: 0.57, size: 30 }],
            asks: [{ price: 0.59, size: 30 }],
          },
        }),
        createSnapshot({
          asset: 'ETH',
          slug: 'eth-updown-5m-1711443600',
          bucketStartTime: '2026-03-26T09:00:00.000Z',
          bucketStartEpoch: 1711443600,
          upPrice: 0.55,
          downPrice: 0.45,
          upAsk: 0.57,
          downAsk: 0.47,
          fetchedAt: '2026-03-26T09:00:10.000Z',
        }),
      ],
      getSnapshotBySlug: async (slug) => {
        assert.fail(`unexpected slug lookup for ${slug}`);
      },
    },
  });

  const state = loadPaperSessionState('Partial Open Session', cwd, { startingCash: 100 });
  const { eventsPath } = resolvePaperSessionPaths(cwd, 'Partial Open Session');
  const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  const openEvent = events.find((event) => event.type === 'paper-position-opened');

  assert.equal(state.positions.BTC?.shares, 9);
  assert.equal(state.positions.BTC?.size, 9);
  assert.equal(state.positions.BTC?.entryPrice, 0.4388888888888889);
  assert.equal(state.cash > 95.97 && state.cash < 95.98, true);
  assert.equal(openEvent?.requestedStake, 100);
  assert.equal(typeof openEvent?.stake === 'number' && openEvent.stake > 4.02 && openEvent.stake < 4.03, true);
  assert.equal(openEvent?.partialFill, true);
  assert.equal(openEvent?.levelsConsumed, 2);
});

test('runPaperLoop skips an entry when visible ask depth is missing', async () => {
  const { runPaperLoop } = await import('../paper/loop.js');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-no-depth-open-'));
  const strategyDir = writeParametrizedPaperStrategy();

  await runPaperLoop({
    sessionName: 'No Depth Open Session',
    strategyId: 'paper-param-test',
    strategyDir,
    cwd,
    startingCash: 100,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 1,
    strategyParamOverrides: {
      stake: 5,
    },
    marketSource: {
      getCurrentSnapshots: async () => [
        createSnapshot({
          asset: 'BTC',
          slug: 'btc-updown-5m-1711444200',
          bucketStartTime: '2026-03-26T09:10:00.000Z',
          bucketStartEpoch: 1711444200,
          upPrice: 0.41,
          downPrice: 0.59,
          upAsk: 0.43,
          downAsk: 0.61,
          fetchedAt: '2026-03-26T09:10:10.000Z',
          upOrderBook: {
            bids: [{ price: 0.41, size: 30 }],
            asks: [],
          },
          downOrderBook: {
            bids: [{ price: 0.59, size: 30 }],
            asks: [{ price: 0.61, size: 30 }],
          },
        }),
        createSnapshot({
          asset: 'ETH',
          slug: 'eth-updown-5m-1711444200',
          bucketStartTime: '2026-03-26T09:10:00.000Z',
          bucketStartEpoch: 1711444200,
          upPrice: 0.55,
          downPrice: 0.45,
          upAsk: 0.57,
          downAsk: 0.47,
          fetchedAt: '2026-03-26T09:10:10.000Z',
        }),
      ],
      getSnapshotBySlug: async (slug) => {
        assert.fail(`unexpected slug lookup for ${slug}`);
      },
    },
  });

  const state = loadPaperSessionState('No Depth Open Session', cwd, { startingCash: 100 });
  const { eventsPath } = resolvePaperSessionPaths(cwd, 'No Depth Open Session');
  const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(state.tradeCount, 0);
  assert.equal(state.positions.BTC, undefined);
  assert.equal(events.some((event) => event.type === 'paper-position-opened'), false);
});

test('runPaperLoop partially closes a position when the order book cannot absorb all held shares', async () => {
  const { runPaperLoop } = await import('../paper/loop.js');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-partial-close-'));
  const strategyDir = writeSellStrategy();
  let cycleIndex = 0;

  const cycleSnapshots: PaperMarketSnapshot[][] = [
    [
      createSnapshot({
        asset: 'BTC',
        slug: 'btc-updown-5m-1711443600',
        bucketStartTime: '2026-03-26T09:00:00.000Z',
        bucketStartEpoch: 1711443600,
        upPrice: 0.42,
        downPrice: 0.58,
        upAsk: 0.43,
        downAsk: 0.59,
        fetchedAt: '2026-03-26T09:00:10.000Z',
        upOrderBook: {
          bids: [{ price: 0.41, size: 30 }],
          asks: [
            { price: 0.43, size: 5 },
            { price: 0.45, size: 4 },
          ],
        },
        downOrderBook: {
          bids: [{ price: 0.57, size: 30 }],
          asks: [{ price: 0.59, size: 30 }],
        },
      }),
      createSnapshot({
        asset: 'ETH',
        slug: 'eth-updown-5m-1711443600',
        bucketStartTime: '2026-03-26T09:00:00.000Z',
        bucketStartEpoch: 1711443600,
        upPrice: 0.52,
        downPrice: 0.48,
        upAsk: 0.54,
        downAsk: 0.5,
        fetchedAt: '2026-03-26T09:00:10.000Z',
      }),
    ],
    [
      createSnapshot({
        asset: 'BTC',
        slug: 'btc-updown-5m-1711443900',
        bucketStartTime: '2026-03-26T09:05:00.000Z',
        bucketStartEpoch: 1711443900,
        upPrice: 0.61,
        downPrice: 0.39,
        upAsk: 0.63,
        downAsk: 0.41,
        fetchedAt: '2026-03-26T09:05:10.000Z',
        upOrderBook: {
          bids: [{ price: 0.61, size: 4 }],
          asks: [{ price: 0.63, size: 30 }],
        },
        downOrderBook: {
          bids: [{ price: 0.39, size: 30 }],
          asks: [{ price: 0.41, size: 30 }],
        },
      }),
      createSnapshot({
        asset: 'ETH',
        slug: 'eth-updown-5m-1711443900',
        bucketStartTime: '2026-03-26T09:05:00.000Z',
        bucketStartEpoch: 1711443900,
        upPrice: 0.49,
        downPrice: 0.51,
        upAsk: 0.51,
        downAsk: 0.53,
        fetchedAt: '2026-03-26T09:05:10.000Z',
      }),
    ],
  ];

  await runPaperLoop({
    sessionName: 'Partial Close Session',
    strategyId: 'paper-sell-test',
    strategyDir,
    cwd,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 2,
    marketSource: {
      getCurrentSnapshots: async () => cycleSnapshots[cycleIndex++]!.map((snapshot) => ({ ...snapshot })),
      getSnapshotBySlug: async (slug) => {
        const match = cycleSnapshots.flat().find((snapshot) => snapshot.slug === slug);
        assert.ok(match, `unexpected slug lookup for ${slug}`);
        return { ...match };
      },
    },
  });

  const state = loadPaperSessionState('Partial Close Session', cwd);
  const { eventsPath } = resolvePaperSessionPaths(cwd, 'Partial Close Session');
  const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  const closeEvent = events.find((event) => event.type === 'paper-position-closed');

  assert.equal(state.positions.BTC?.shares, 5);
  assert.equal(state.positions.BTC?.size, 5);
  assert.equal((state.positions.BTC?.entryFee ?? 0) > 0.0388 && (state.positions.BTC?.entryFee ?? 0) < 0.039, true);
  assert.equal(state.tradeCount, 1);
  assert.equal(closeEvent?.shares, 4);
  assert.equal(closeEvent?.partialFill, true);
  assert.equal(closeEvent?.remainingShares, 5);
  assert.equal(closeEvent?.levelsConsumed, 1);
});

test('runPaperLoop reacts to a single-asset realtime signal without waiting for the paired asset', async () => {
  const { runPaperLoop } = await import('../paper/loop.js');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-single-asset-signal-'));
  const strategyDir = writeAssetPaperStrategy('ETH');
  let waitForNextSignalCalls = 0;

  await runPaperLoop({
    sessionName: 'Paper Single Asset Signal Session',
    strategyId: 'paper-eth-test',
    strategyDir,
    cwd,
    intervalMs: 30_000,
    maxCycles: 1,
    sleepMs: async () => {
      assert.fail('paper loop should not sleep when a realtime signal source is available');
    },
    marketSource: {
      getCurrentSnapshots: async () => [],
      waitForNextSignal: async () => {
        waitForNextSignalCalls += 1;
        return createSnapshot({
          asset: 'ETH',
          slug: 'eth-updown-5m-1711444500',
          bucketStartTime: '2026-03-26T09:15:00.000Z',
          bucketStartEpoch: 1711444500,
          upPrice: 0.55,
          downPrice: 0.45,
          upAsk: 0.57,
          downAsk: 0.47,
          fetchedAt: '2026-03-26T09:15:10.000Z',
        });
      },
      getSnapshotBySlug: async (slug) => {
        assert.fail(`unexpected slug lookup for ${slug}`);
      },
    },
  });

  const state = loadPaperSessionState('Paper Single Asset Signal Session', cwd);

  assert.equal(waitForNextSignalCalls, 1);
  assert.equal(state.tradeCount, 1);
  assert.equal(state.positions.ETH?.predictionSide, 'up');
  assert.equal(state.positions.BTC, undefined);
});
