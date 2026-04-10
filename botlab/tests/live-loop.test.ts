import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { PaperMarketSnapshot } from '../paper/market-source.js';

function writeLiveBuyStrategy(): string {
  const strategyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-live-buy-strategy-'));
  const strategyPath = path.join(strategyDir, 'live-buy.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'live-buy-test',",
      "  name: 'Live Buy Test',",
      "  description: 'Buys BTC once so the live loop can be asserted.',",
      '  defaults: {},',
      '  evaluate(context) {',
      "    if (context.market.asset !== 'BTC') {",
      "      return { action: 'hold', reason: 'BTC only' };",
      '    }',
      "    if (context.position.side !== 'flat') {",
      "      return { action: 'hold', reason: 'already in position' };",
      '    }',
      "    return { action: 'buy', side: 'up', size: 3, reason: 'open live BTC position' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return strategyDir;
}

function writeLiveSellStrategy(): string {
  const strategyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-live-sell-strategy-'));
  const strategyPath = path.join(strategyDir, 'live-sell.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'live-sell-test',",
      "  name: 'Live Sell Test',",
      "  description: 'Buys first, then sells on the next cycle.',",
      '  defaults: {},',
      '  evaluate(context) {',
      "    if (context.market.asset !== 'BTC') {",
      "      return { action: 'hold', reason: 'BTC only' };",
      '    }',
      '    if (context.position.side === "flat") {',
      "      return { action: 'buy', side: 'up', size: 3, reason: 'open live BTC position' };",
      '    }',
      "    return { action: 'sell', reason: 'close the live BTC position' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return strategyDir;
}

function writeLiveHoldStrategy(): string {
  const strategyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-live-hold-strategy-'));
  const strategyPath = path.join(strategyDir, 'live-hold.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'live-hold-test',",
      "  name: 'Live Hold Test',",
      "  description: 'Never trades so the live balance sync can be asserted.',",
      '  defaults: {},',
      '  evaluate() {',
      "    return { action: 'hold', reason: 'do nothing' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return strategyDir;
}

test('runLiveLoop syncs the live collateral balance instead of keeping the configured starting cash', async () => {
  const { runLiveLoop } = await import('../live/loop.js');
  const { loadLiveSessionState } = await import('../live/session-store.js');
  const strategyDir = writeLiveHoldStrategy();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-live-balance-'));

  await runLiveLoop({
    sessionName: 'Live Balance Session',
    strategyId: 'live-hold-test',
    strategyDir,
    cwd,
    startingCash: 100,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 1,
    marketSource: {
      getCurrentSnapshots: async () => [
        {
          asset: 'BTC',
          slug: 'btc-updown-5m-1775649600',
          question: 'Bitcoin Up or Down - live balance',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-04-08T12:00:00.000Z',
          endDate: '2026-04-08T12:05:00.000Z',
          bucketStartTime: '2026-04-08T12:00:00.000Z',
          bucketStartEpoch: 1775649600,
          upPrice: 0.52,
          downPrice: 0.48,
          upAsk: 0.53,
          downAsk: 0.49,
          upOrderBook: {
            bids: [{ price: 0.52, size: 50 }],
            asks: [{ price: 0.53, size: 50 }],
          },
          downOrderBook: {
            bids: [{ price: 0.48, size: 50 }],
            asks: [{ price: 0.49, size: 50 }],
          },
          volume: 1500,
          fetchedAt: '2026-04-08T12:01:00.000Z',
          downAskDerivedFromBestBid: false,
        },
        {
          asset: 'ETH',
          slug: 'eth-updown-5m-1775649600',
          question: 'Ethereum Up or Down - live balance',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-04-08T12:00:00.000Z',
          endDate: '2026-04-08T12:05:00.000Z',
          bucketStartTime: '2026-04-08T12:00:00.000Z',
          bucketStartEpoch: 1775649600,
          upPrice: 0.5,
          downPrice: 0.5,
          upAsk: 0.51,
          downAsk: 0.51,
          upOrderBook: {
            bids: [{ price: 0.5, size: 50 }],
            asks: [{ price: 0.51, size: 50 }],
          },
          downOrderBook: {
            bids: [{ price: 0.5, size: 50 }],
            asks: [{ price: 0.51, size: 50 }],
          },
          volume: 1500,
          fetchedAt: '2026-04-08T12:01:00.000Z',
          downAskDerivedFromBestBid: false,
        },
      ],
      getSnapshotBySlug: async () => {
        throw new Error('unexpected snapshot lookup');
      },
      getMarketDetail: async (slug, asset) => ({
        asset,
        slug,
        question: `${asset} detail`,
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:00:00.000Z',
        endDate: '2026-04-08T12:05:00.000Z',
        bucketStartTime: '2026-04-08T12:00:00.000Z',
        bucketStartEpoch: 1775649600,
        upLabel: 'Up',
        downLabel: 'Down',
        upTokenId: `${asset.toLowerCase()}-up-token`,
        downTokenId: `${asset.toLowerCase()}-down-token`,
        volume: 1500,
        tickSize: '0.01',
        negRisk: false,
      }),
    },
    tradingClient: {
      getCollateralBalance: async () => 30.25,
      buyOutcome: async () => {
        throw new Error('unexpected buy call');
      },
      sellOutcome: async () => {
        throw new Error('unexpected sell call');
      },
    },
  });

  const state = loadLiveSessionState('Live Balance Session', cwd, { startingCash: 100 });

  assert.equal(state.cash, 30.25);
  assert.equal(state.equity, 30.25);
});

test('runLiveLoop opens a live position and records the real fill', async () => {
  const { runLiveLoop } = await import('../live/loop.js');
  const { loadLiveSessionState } = await import('../live/session-store.js');
  const { resolveLiveSessionPaths } = await import('../live/types.js');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-live-open-'));
  const strategyDir = writeLiveBuyStrategy();
  const buyCalls: Array<Record<string, unknown>> = [];
  const balances = [10, 9];

  const result = await runLiveLoop({
    sessionName: 'Live Open Session',
    strategyId: 'live-buy-test',
    strategyDir,
    cwd,
    startingCash: 10,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 1,
    stakeOverrideUsd: 1,
    marketSource: {
      getCurrentSnapshots: async () => [
        {
          asset: 'BTC',
          slug: 'btc-updown-5m-1775649600',
          question: 'Bitcoin Up or Down - live open',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-04-08T12:00:00.000Z',
          endDate: '2026-04-08T12:05:00.000Z',
          bucketStartTime: '2026-04-08T12:00:00.000Z',
          bucketStartEpoch: 1775649600,
          upPrice: 0.52,
          downPrice: 0.48,
          upAsk: 0.53,
          downAsk: 0.49,
          upOrderBook: {
            bids: [{ price: 0.52, size: 50 }],
            asks: [{ price: 0.53, size: 50 }],
          },
          downOrderBook: {
            bids: [{ price: 0.48, size: 50 }],
            asks: [{ price: 0.49, size: 50 }],
          },
          volume: 1500,
          fetchedAt: '2026-04-08T12:01:00.000Z',
          downAskDerivedFromBestBid: false,
        },
        {
          asset: 'ETH',
          slug: 'eth-updown-5m-1775649600',
          question: 'Ethereum Up or Down - live open',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-04-08T12:00:00.000Z',
          endDate: '2026-04-08T12:05:00.000Z',
          bucketStartTime: '2026-04-08T12:00:00.000Z',
          bucketStartEpoch: 1775649600,
          upPrice: 0.5,
          downPrice: 0.5,
          upAsk: 0.51,
          downAsk: 0.51,
          upOrderBook: {
            bids: [{ price: 0.5, size: 50 }],
            asks: [{ price: 0.51, size: 50 }],
          },
          downOrderBook: {
            bids: [{ price: 0.5, size: 50 }],
            asks: [{ price: 0.51, size: 50 }],
          },
          volume: 1500,
          fetchedAt: '2026-04-08T12:01:00.000Z',
          downAskDerivedFromBestBid: false,
        },
      ],
      getSnapshotBySlug: async () => {
        throw new Error('unexpected snapshot lookup');
      },
      getMarketDetail: async (slug, asset) => ({
        asset,
        slug,
        question: `${asset} detail`,
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:00:00.000Z',
        endDate: '2026-04-08T12:05:00.000Z',
        bucketStartTime: '2026-04-08T12:00:00.000Z',
        bucketStartEpoch: 1775649600,
        upLabel: 'Up',
        downLabel: 'Down',
        upTokenId: `${asset.toLowerCase()}-up-token`,
        downTokenId: `${asset.toLowerCase()}-down-token`,
        volume: 1500,
        tickSize: '0.01',
        negRisk: false,
      }),
    },
    tradingClient: {
      getCollateralBalance: async () => balances.shift() ?? 9,
      buyOutcome: async (input) => {
        buyCalls.push(input as unknown as Record<string, unknown>);
        return {
          orderId: 'buy-order-1',
          status: 'matched',
          tokenId: String(input.tokenId),
          requestedAmount: Number(input.amount),
          spentAmount: 1,
          shares: 1.88,
          averagePrice: 0.53,
          feesPaid: 0.01,
        };
      },
      sellOutcome: async () => {
        throw new Error('unexpected sell call');
      },
    },
  });

  const state = loadLiveSessionState('Live Open Session', cwd, { startingCash: 10 });
  const { eventsPath } = resolveLiveSessionPaths(cwd, 'Live Open Session');
  const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(result.cyclesCompleted, 1);
  assert.equal(buyCalls.length, 1);
  assert.equal(buyCalls[0]?.amount, 1);
  assert.equal(buyCalls[0]?.priceLimit, 0.55);
  assert.equal(state.tradeCount, 1);
  assert.equal(state.positions.BTC?.predictionSide, 'up');
  assert.equal(state.positions.BTC?.shares, 1.88);
  assert.equal(state.positions.BTC?.marketSlug, 'btc-updown-5m-1775649600');
  assert.equal(events.some((event) => event.type === 'live-position-opened'), true);
  assert.equal(events.some((event) => event.type === 'live-cycle-complete'), true);
});

test('runLiveLoop closes a live position through the trading client on a later cycle', async () => {
  const { runLiveLoop } = await import('../live/loop.js');
  const { loadLiveSessionState } = await import('../live/session-store.js');
  const { resolveLiveSessionPaths } = await import('../live/types.js');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-live-close-'));
  const strategyDir = writeLiveSellStrategy();
  const sellCalls: Array<Record<string, unknown>> = [];
  const balances = [10, 9, 9, 10.2308];
  let cycleIndex = 0;

  const cycleSnapshots: PaperMarketSnapshot[][] = [
    [
      {
        asset: 'BTC',
        slug: 'btc-updown-5m-1775649600',
        question: 'Bitcoin Up or Down - live close',
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:00:00.000Z',
        endDate: '2026-04-08T12:05:00.000Z',
        bucketStartTime: '2026-04-08T12:00:00.000Z',
        bucketStartEpoch: 1775649600,
        upPrice: 0.52,
        downPrice: 0.48,
        upAsk: 0.53,
        downAsk: 0.49,
        upOrderBook: {
          bids: [{ price: 0.52, size: 50 }],
          asks: [{ price: 0.53, size: 50 }],
        },
        downOrderBook: {
          bids: [{ price: 0.48, size: 50 }],
          asks: [{ price: 0.49, size: 50 }],
        },
        volume: 1500,
        fetchedAt: '2026-04-08T12:01:00.000Z',
        downAskDerivedFromBestBid: false,
      },
      {
        asset: 'ETH',
        slug: 'eth-updown-5m-1775649600',
        question: 'Ethereum Up or Down - live close',
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:00:00.000Z',
        endDate: '2026-04-08T12:05:00.000Z',
        bucketStartTime: '2026-04-08T12:00:00.000Z',
        bucketStartEpoch: 1775649600,
        upPrice: 0.5,
        downPrice: 0.5,
        upAsk: 0.51,
        downAsk: 0.51,
        upOrderBook: {
          bids: [{ price: 0.5, size: 50 }],
          asks: [{ price: 0.51, size: 50 }],
        },
        downOrderBook: {
          bids: [{ price: 0.5, size: 50 }],
          asks: [{ price: 0.51, size: 50 }],
        },
        volume: 1500,
        fetchedAt: '2026-04-08T12:01:00.000Z',
        downAskDerivedFromBestBid: false,
      },
    ],
    [
      {
        asset: 'BTC',
        slug: 'btc-updown-5m-1775649900',
        question: 'Bitcoin Up or Down - live close next',
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:05:00.000Z',
        endDate: '2026-04-08T12:10:00.000Z',
        bucketStartTime: '2026-04-08T12:05:00.000Z',
        bucketStartEpoch: 1775649900,
        upPrice: 0.66,
        downPrice: 0.34,
        upAsk: 0.67,
        downAsk: 0.35,
        upOrderBook: {
          bids: [{ price: 0.66, size: 50 }],
          asks: [{ price: 0.67, size: 50 }],
        },
        downOrderBook: {
          bids: [{ price: 0.34, size: 50 }],
          asks: [{ price: 0.35, size: 50 }],
        },
        volume: 1800,
        fetchedAt: '2026-04-08T12:06:00.000Z',
        downAskDerivedFromBestBid: false,
      },
      {
        asset: 'ETH',
        slug: 'eth-updown-5m-1775649900',
        question: 'Ethereum Up or Down - live close next',
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:05:00.000Z',
        endDate: '2026-04-08T12:10:00.000Z',
        bucketStartTime: '2026-04-08T12:05:00.000Z',
        bucketStartEpoch: 1775649900,
        upPrice: 0.5,
        downPrice: 0.5,
        upAsk: 0.51,
        downAsk: 0.51,
        upOrderBook: {
          bids: [{ price: 0.5, size: 50 }],
          asks: [{ price: 0.51, size: 50 }],
        },
        downOrderBook: {
          bids: [{ price: 0.5, size: 50 }],
          asks: [{ price: 0.51, size: 50 }],
        },
        volume: 1800,
        fetchedAt: '2026-04-08T12:06:00.000Z',
        downAskDerivedFromBestBid: false,
      },
    ],
  ];

  await runLiveLoop({
    sessionName: 'Live Close Session',
    strategyId: 'live-sell-test',
    strategyDir,
    cwd,
    startingCash: 10,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 2,
    stakeOverrideUsd: 1,
    marketSource: {
      getCurrentSnapshots: async () => cycleSnapshots[cycleIndex++]!.map((snapshot) => ({ ...snapshot })),
      getSnapshotBySlug: async (slug) => {
        const match = cycleSnapshots.flat().find((snapshot) => snapshot.slug === slug);
        assert.ok(match);
        return { ...match };
      },
      getMarketDetail: async (slug, asset) => ({
        asset,
        slug,
        question: `${asset} detail`,
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:00:00.000Z',
        endDate: '2026-04-08T12:05:00.000Z',
        bucketStartTime: '2026-04-08T12:00:00.000Z',
        bucketStartEpoch: 1775649600,
        upLabel: 'Up',
        downLabel: 'Down',
        upTokenId: `${asset.toLowerCase()}-up-token`,
        downTokenId: `${asset.toLowerCase()}-down-token`,
        volume: 1500,
        tickSize: '0.01',
        negRisk: false,
      }),
    },
    tradingClient: {
      getCollateralBalance: async () => balances.shift() ?? 10.2308,
      buyOutcome: async (input) => ({
        orderId: 'buy-order-2',
        status: 'matched',
        tokenId: String(input.tokenId),
        requestedAmount: Number(input.amount),
        spentAmount: 1,
        shares: 1.88,
        averagePrice: 0.53,
        feesPaid: 0.01,
      }),
      sellOutcome: async (input) => {
        sellCalls.push(input as unknown as Record<string, unknown>);
        return {
          orderId: 'sell-order-1',
          status: 'matched',
          tokenId: String(input.tokenId),
          requestedShares: Number(input.shares),
          soldShares: Number(input.shares),
          averagePrice: 0.66,
          grossProceeds: 1.2408,
          feesPaid: 0.01,
          netProceeds: 1.2308,
        };
      },
    },
  });

  const state = loadLiveSessionState('Live Close Session', cwd, { startingCash: 10 });
  const { eventsPath } = resolveLiveSessionPaths(cwd, 'Live Close Session');
  const events = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(sellCalls.length, 1);
  assert.equal(sellCalls[0]?.shares, 1.88);
  assert.equal(sellCalls[0]?.priceLimit, 0.5);
  assert.equal(state.positions.BTC, undefined);
  assert.equal(events.some((event) => event.type === 'live-position-closed'), true);
  assert.equal(state.cash > 10.22, true);
});

test('runLiveLoop refreshes the execution snapshot before a live buy and prices from the refreshed book', async () => {
  const { runLiveLoop } = await import('../live/loop.js');
  const strategyDir = writeLiveBuyStrategy();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-live-refresh-buy-'));
  const buyCalls: Array<Record<string, unknown>> = [];
  const refreshedSlugs: string[] = [];
  const balances = [10, 9];

  await runLiveLoop({
    sessionName: 'Live Refresh Buy Session',
    strategyId: 'live-buy-test',
    strategyDir,
    cwd,
    startingCash: 10,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 1,
    stakeOverrideUsd: 1,
    marketSource: {
      getCurrentSnapshots: async () => [
        {
          asset: 'BTC',
          slug: 'btc-updown-5m-1775650200',
          question: 'Bitcoin Up or Down - stale buy snapshot',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-04-08T12:10:00.000Z',
          endDate: '2026-04-08T12:15:00.000Z',
          bucketStartTime: '2026-04-08T12:10:00.000Z',
          bucketStartEpoch: 1775650200,
          upPrice: 0.44,
          downPrice: 0.56,
          upAsk: 0.44,
          downAsk: 0.57,
          upOrderBook: {
            bids: [{ price: 0.43, size: 50 }],
            asks: [{ price: 0.44, size: 50 }],
          },
          downOrderBook: {
            bids: [{ price: 0.56, size: 50 }],
            asks: [{ price: 0.57, size: 50 }],
          },
          volume: 1500,
          fetchedAt: '2026-04-08T12:11:00.000Z',
          downAskDerivedFromBestBid: false,
        },
        {
          asset: 'ETH',
          slug: 'eth-updown-5m-1775650200',
          question: 'Ethereum Up or Down - stale buy snapshot',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-04-08T12:10:00.000Z',
          endDate: '2026-04-08T12:15:00.000Z',
          bucketStartTime: '2026-04-08T12:10:00.000Z',
          bucketStartEpoch: 1775650200,
          upPrice: 0.5,
          downPrice: 0.5,
          upAsk: 0.51,
          downAsk: 0.51,
          upOrderBook: {
            bids: [{ price: 0.5, size: 50 }],
            asks: [{ price: 0.51, size: 50 }],
          },
          downOrderBook: {
            bids: [{ price: 0.5, size: 50 }],
            asks: [{ price: 0.51, size: 50 }],
          },
          volume: 1500,
          fetchedAt: '2026-04-08T12:11:00.000Z',
          downAskDerivedFromBestBid: false,
        },
      ],
      getSnapshotBySlug: async (slug, asset) => {
        refreshedSlugs.push(slug);
        if (asset === 'BTC') {
          return {
            asset: 'BTC',
            slug,
            question: 'Bitcoin Up or Down - refreshed buy snapshot',
            active: true,
            closed: false,
            acceptingOrders: true,
            eventStartTime: '2026-04-08T12:10:00.000Z',
            endDate: '2026-04-08T12:15:00.000Z',
            bucketStartTime: '2026-04-08T12:10:00.000Z',
            bucketStartEpoch: 1775650200,
            upPrice: 0.55,
            downPrice: 0.45,
            upAsk: 0.55,
            downAsk: 0.46,
            upOrderBook: {
              bids: [{ price: 0.54, size: 50 }],
              asks: [{ price: 0.55, size: 50 }],
            },
            downOrderBook: {
              bids: [{ price: 0.45, size: 50 }],
              asks: [{ price: 0.46, size: 50 }],
            },
            volume: 1500,
            fetchedAt: '2026-04-08T12:11:02.000Z',
            downAskDerivedFromBestBid: false,
          };
        }

        throw new Error(`unexpected refresh for ${asset} ${slug}`);
      },
      getMarketDetail: async (slug, asset) => ({
        asset,
        slug,
        question: `${asset} detail`,
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:10:00.000Z',
        endDate: '2026-04-08T12:15:00.000Z',
        bucketStartTime: '2026-04-08T12:10:00.000Z',
        bucketStartEpoch: 1775650200,
        upLabel: 'Up',
        downLabel: 'Down',
        upTokenId: `${asset.toLowerCase()}-up-token`,
        downTokenId: `${asset.toLowerCase()}-down-token`,
        volume: 1500,
        tickSize: '0.01',
        negRisk: false,
      }),
    },
    tradingClient: {
      getCollateralBalance: async () => balances.shift() ?? 9,
      buyOutcome: async (input) => {
        buyCalls.push(input as unknown as Record<string, unknown>);
        return {
          orderId: 'buy-order-refresh',
          status: 'matched',
          tokenId: String(input.tokenId),
          requestedAmount: Number(input.amount),
          spentAmount: 1,
          shares: 1.8,
          averagePrice: 0.55,
          feesPaid: 0.01,
        };
      },
      sellOutcome: async () => {
        throw new Error('unexpected sell call');
      },
    },
  });

  assert.deepEqual(refreshedSlugs, ['btc-updown-5m-1775650200']);
  assert.equal(buyCalls.length, 1);
  assert.equal(buyCalls[0]?.priceLimit, 0.57);
});

test('runLiveLoop rounds a buy slippage cap up to the next tick when the percentage lands between ticks', async () => {
  const { runLiveLoop } = await import('../live/loop.js');
  const strategyDir = writeLiveBuyStrategy();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-live-buy-tick-'));
  const buyCalls: Array<Record<string, unknown>> = [];
  const balances = [10, 9];

  await runLiveLoop({
    sessionName: 'Live Buy Tick Session',
    strategyId: 'live-buy-test',
    strategyDir,
    cwd,
    startingCash: 10,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 1,
    stakeOverrideUsd: 1,
    marketSource: {
      getCurrentSnapshots: async () => [
        {
          asset: 'BTC',
          slug: 'btc-updown-5m-1775650500',
          question: 'Bitcoin Up or Down - tick buy',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-04-08T12:15:00.000Z',
          endDate: '2026-04-08T12:20:00.000Z',
          bucketStartTime: '2026-04-08T12:15:00.000Z',
          bucketStartEpoch: 1775650500,
          upPrice: 0.44,
          downPrice: 0.56,
          upAsk: 0.44,
          downAsk: 0.57,
          upOrderBook: {
            bids: [{ price: 0.43, size: 50 }],
            asks: [{ price: 0.44, size: 50 }],
          },
          downOrderBook: {
            bids: [{ price: 0.56, size: 50 }],
            asks: [{ price: 0.57, size: 50 }],
          },
          volume: 1500,
          fetchedAt: '2026-04-08T12:16:00.000Z',
          downAskDerivedFromBestBid: false,
        },
        {
          asset: 'ETH',
          slug: 'eth-updown-5m-1775650500',
          question: 'Ethereum Up or Down - tick buy',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-04-08T12:15:00.000Z',
          endDate: '2026-04-08T12:20:00.000Z',
          bucketStartTime: '2026-04-08T12:15:00.000Z',
          bucketStartEpoch: 1775650500,
          upPrice: 0.5,
          downPrice: 0.5,
          upAsk: 0.51,
          downAsk: 0.51,
          upOrderBook: {
            bids: [{ price: 0.5, size: 50 }],
            asks: [{ price: 0.51, size: 50 }],
          },
          downOrderBook: {
            bids: [{ price: 0.5, size: 50 }],
            asks: [{ price: 0.51, size: 50 }],
          },
          volume: 1500,
          fetchedAt: '2026-04-08T12:16:00.000Z',
          downAskDerivedFromBestBid: false,
        },
      ],
      getSnapshotBySlug: async () => {
        throw new Error('unexpected snapshot lookup');
      },
      getMarketDetail: async (slug, asset) => ({
        asset,
        slug,
        question: `${asset} detail`,
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:15:00.000Z',
        endDate: '2026-04-08T12:20:00.000Z',
        bucketStartTime: '2026-04-08T12:15:00.000Z',
        bucketStartEpoch: 1775650500,
        upLabel: 'Up',
        downLabel: 'Down',
        upTokenId: `${asset.toLowerCase()}-up-token`,
        downTokenId: `${asset.toLowerCase()}-down-token`,
        volume: 1500,
        tickSize: '0.01',
        negRisk: false,
      }),
    },
    tradingClient: {
      getCollateralBalance: async () => balances.shift() ?? 9,
      buyOutcome: async (input) => {
        buyCalls.push(input as unknown as Record<string, unknown>);
        return {
          orderId: 'buy-order-tick',
          status: 'matched',
          tokenId: String(input.tokenId),
          requestedAmount: Number(input.amount),
          spentAmount: 1,
          shares: 2.25,
          averagePrice: 0.44,
          feesPaid: 0.01,
        };
      },
      sellOutcome: async () => {
        throw new Error('unexpected sell call');
      },
    },
  });

  assert.equal(buyCalls.length, 1);
  assert.equal(buyCalls[0]?.priceLimit, 0.45);
});

test('runLiveLoop rounds a sell slippage floor down to the next tick when the percentage lands between ticks', async () => {
  const { runLiveLoop } = await import('../live/loop.js');
  const strategyDir = writeLiveSellStrategy();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-live-sell-tick-'));
  const sellCalls: Array<Record<string, unknown>> = [];
  const balances = [10, 9, 9, 9.82];
  let cycleIndex = 0;

  const cycleSnapshots: PaperMarketSnapshot[][] = [
    [
      {
        asset: 'BTC',
        slug: 'btc-updown-5m-1775650800',
        question: 'Bitcoin Up or Down - tick sell open',
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:20:00.000Z',
        endDate: '2026-04-08T12:25:00.000Z',
        bucketStartTime: '2026-04-08T12:20:00.000Z',
        bucketStartEpoch: 1775650800,
        upPrice: 0.53,
        downPrice: 0.47,
        upAsk: 0.53,
        downAsk: 0.48,
        upOrderBook: {
          bids: [{ price: 0.52, size: 50 }],
          asks: [{ price: 0.53, size: 50 }],
        },
        downOrderBook: {
          bids: [{ price: 0.47, size: 50 }],
          asks: [{ price: 0.48, size: 50 }],
        },
        volume: 1500,
        fetchedAt: '2026-04-08T12:21:00.000Z',
        downAskDerivedFromBestBid: false,
      },
      {
        asset: 'ETH',
        slug: 'eth-updown-5m-1775650800',
        question: 'Ethereum Up or Down - tick sell open',
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:20:00.000Z',
        endDate: '2026-04-08T12:25:00.000Z',
        bucketStartTime: '2026-04-08T12:20:00.000Z',
        bucketStartEpoch: 1775650800,
        upPrice: 0.5,
        downPrice: 0.5,
        upAsk: 0.51,
        downAsk: 0.51,
        upOrderBook: {
          bids: [{ price: 0.5, size: 50 }],
          asks: [{ price: 0.51, size: 50 }],
        },
        downOrderBook: {
          bids: [{ price: 0.5, size: 50 }],
          asks: [{ price: 0.51, size: 50 }],
        },
        volume: 1500,
        fetchedAt: '2026-04-08T12:21:00.000Z',
        downAskDerivedFromBestBid: false,
      },
    ],
    [
      {
        asset: 'BTC',
        slug: 'btc-updown-5m-1775650800',
        question: 'Bitcoin Up or Down - tick sell close',
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:20:00.000Z',
        endDate: '2026-04-08T12:25:00.000Z',
        bucketStartTime: '2026-04-08T12:20:00.000Z',
        bucketStartEpoch: 1775650800,
        upPrice: 0.44,
        downPrice: 0.56,
        upAsk: 0.45,
        downAsk: 0.57,
        upOrderBook: {
          bids: [{ price: 0.44, size: 50 }],
          asks: [{ price: 0.45, size: 50 }],
        },
        downOrderBook: {
          bids: [{ price: 0.56, size: 50 }],
          asks: [{ price: 0.57, size: 50 }],
        },
        volume: 1800,
        fetchedAt: '2026-04-08T12:26:00.000Z',
        downAskDerivedFromBestBid: false,
      },
      {
        asset: 'ETH',
        slug: 'eth-updown-5m-1775650800',
        question: 'Ethereum Up or Down - tick sell close',
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:20:00.000Z',
        endDate: '2026-04-08T12:25:00.000Z',
        bucketStartTime: '2026-04-08T12:20:00.000Z',
        bucketStartEpoch: 1775650800,
        upPrice: 0.5,
        downPrice: 0.5,
        upAsk: 0.51,
        downAsk: 0.51,
        upOrderBook: {
          bids: [{ price: 0.5, size: 50 }],
          asks: [{ price: 0.51, size: 50 }],
        },
        downOrderBook: {
          bids: [{ price: 0.5, size: 50 }],
          asks: [{ price: 0.51, size: 50 }],
        },
        volume: 1800,
        fetchedAt: '2026-04-08T12:26:00.000Z',
        downAskDerivedFromBestBid: false,
      },
    ],
  ];

  await runLiveLoop({
    sessionName: 'Live Sell Tick Session',
    strategyId: 'live-sell-test',
    strategyDir,
    cwd,
    startingCash: 10,
    intervalMs: 0,
    sleepMs: async () => {},
    maxCycles: 2,
    stakeOverrideUsd: 1,
    marketSource: {
      getCurrentSnapshots: async () => cycleSnapshots[cycleIndex++]!.map((snapshot) => ({ ...snapshot })),
      getSnapshotBySlug: async (slug) => {
        const match = [...cycleSnapshots.flat()].reverse().find((snapshot) => snapshot.slug === slug);
        assert.ok(match);
        return { ...match };
      },
      getMarketDetail: async (slug, asset) => ({
        asset,
        slug,
        question: `${asset} detail`,
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:20:00.000Z',
        endDate: '2026-04-08T12:25:00.000Z',
        bucketStartTime: '2026-04-08T12:20:00.000Z',
        bucketStartEpoch: 1775650800,
        upLabel: 'Up',
        downLabel: 'Down',
        upTokenId: `${asset.toLowerCase()}-up-token`,
        downTokenId: `${asset.toLowerCase()}-down-token`,
        volume: 1500,
        tickSize: '0.01',
        negRisk: false,
      }),
    },
    tradingClient: {
      getCollateralBalance: async () => balances.shift() ?? 9.82,
      buyOutcome: async (input) => ({
        orderId: 'buy-order-sell-tick',
        status: 'matched',
        tokenId: String(input.tokenId),
        requestedAmount: Number(input.amount),
        spentAmount: 1,
        shares: 1.88,
        averagePrice: 0.53,
        feesPaid: 0.01,
      }),
      sellOutcome: async (input) => {
        sellCalls.push(input as unknown as Record<string, unknown>);
        return {
          orderId: 'sell-order-tick',
          status: 'matched',
          tokenId: String(input.tokenId),
          requestedShares: Number(input.shares),
          soldShares: Number(input.shares),
          averagePrice: 0.44,
          grossProceeds: 0.8272,
          feesPaid: 0.01,
          netProceeds: 0.8172,
        };
      },
    },
  });

  assert.equal(sellCalls.length, 1);
  assert.equal(sellCalls[0]?.priceLimit, 0.43);
});
