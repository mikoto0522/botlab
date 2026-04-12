import assert from 'node:assert/strict';
import test from 'node:test';
import type { BotlabConfig } from '../core/types.js';
import { createLoopMarketSource } from '../commands/paper.js';
import type { PaperMarketAsset, PaperMarketRef, PaperMarketSnapshot } from '../paper/market-source.js';

function createConfig(): BotlabConfig {
  return {
    paths: {
      rootDir: 'D:/Mikoto/botlab/botlab',
      strategyDir: 'D:/Mikoto/botlab/botlab/strategies',
      templateDir: 'D:/Mikoto/botlab/botlab/templates',
      defaultConfigPath: 'D:/Mikoto/botlab/botlab/config/example.config.json',
    },
    runtime: {
      mode: 'paper',
      market: {
        asset: 'BTC',
        symbol: 'BTC-USD',
        timeframe: '5m',
        price: 100,
        changePct24h: 0,
        momentum: 0,
        volume: 0,
        timestamp: '2026-04-12T11:50:00.000Z',
        candles: [],
      },
      position: {
        side: 'flat',
        size: 0,
        entryPrice: null,
      },
      balance: 100,
      clock: {
        now: '2026-04-12T11:50:00.000Z',
      },
    },
  };
}

function createSnapshot(
  asset: PaperMarketAsset,
  overrides: Partial<PaperMarketSnapshot> = {},
): PaperMarketSnapshot {
  const slug = `${asset.toLowerCase()}-updown-5m-1775994600`;

  return {
    asset,
    slug,
    question: `${asset} up or down`,
    active: true,
    closed: false,
    acceptingOrders: true,
    eventStartTime: '2026-04-12T11:50:00.000Z',
    endDate: '2026-04-12T11:55:00.000Z',
    bucketStartTime: '2026-04-12T11:50:00.000Z',
    bucketStartEpoch: 1775994600,
    upPrice: 0.52,
    downPrice: 0.48,
    upAsk: 0.53,
    downAsk: 0.49,
    downAskDerivedFromBestBid: false,
    upOrderBook: {
      bids: [{ price: 0.51, size: 10 }],
      asks: [{ price: 0.53, size: 10 }],
    },
    downOrderBook: {
      bids: [{ price: 0.47, size: 10 }],
      asks: [{ price: 0.49, size: 10 }],
    },
    volume: 25000,
    fetchedAt: '2026-04-12T11:50:10.000Z',
    ...overrides,
  };
}

test('createLoopMarketSource falls back to polling snapshots when realtime prices are inconsistent', async () => {
  const realtimeSnapshots = [
    createSnapshot('BTC', {
      upPrice: 0.01,
      downPrice: 0.07,
      upAsk: 0.01,
      downAsk: 0.07,
    }),
    createSnapshot('ETH', {
      upPrice: 0.01,
      downPrice: 0.41,
      upAsk: 0.01,
      downAsk: 0.41,
    }),
  ];
  const pollingSnapshots = [
    createSnapshot('BTC', {
      upPrice: 0.52,
      downPrice: 0.48,
      fetchedAt: '2026-04-12T11:50:12.000Z',
    }),
    createSnapshot('ETH', {
      upPrice: 0.49,
      downPrice: 0.51,
      fetchedAt: '2026-04-12T11:50:12.000Z',
    }),
  ];
  let discoverCalls = 0;

  const source = createLoopMarketSource(createConfig(), 'paper-test', 'D:/Mikoto/botlab', undefined, {
    createRealtimeSource: () => ({
      getLatestSnapshots: async () => realtimeSnapshots,
      waitForNextSignal: async () => realtimeSnapshots[0]!,
      close: async () => {},
    }),
    discoverActiveRefs: async () => {
      discoverCalls += 1;
      return pollingSnapshots.map((snapshot) => ({
        asset: snapshot.asset,
        slug: snapshot.slug,
        bucketStartEpoch: snapshot.bucketStartEpoch,
        bucketStartTime: snapshot.bucketStartTime,
      })) satisfies PaperMarketRef[];
    },
    fetchSnapshot: async (ref) => {
      const match = pollingSnapshots.find((snapshot) => snapshot.asset === ref.asset && snapshot.slug === ref.slug);
      if (!match) {
        throw new Error(`Missing polling snapshot for ${ref.asset} ${ref.slug}`);
      }
      return match;
    },
  });

  try {
    const snapshots = await source.getCurrentSnapshots();

    assert.equal(discoverCalls, 1);
    assert.equal(snapshots[0]?.upPrice, 0.52);
    assert.equal(snapshots[0]?.downPrice, 0.48);
    assert.equal(snapshots[1]?.upPrice, 0.49);
    assert.equal(snapshots[1]?.downPrice, 0.51);
  } finally {
    await source.close();
  }
});

test('createLoopMarketSource falls back to polling for realtime single-asset signals with inconsistent prices', async () => {
  const realtimeSignal = createSnapshot('BTC', {
    upPrice: 0.01,
    downPrice: 0.07,
    upAsk: 0.01,
    downAsk: 0.07,
  });
  const pollingSnapshot = createSnapshot('BTC', {
    upPrice: 0.52,
    downPrice: 0.48,
    fetchedAt: '2026-04-12T11:50:12.000Z',
  });

  const source = createLoopMarketSource(createConfig(), 'paper-test', 'D:/Mikoto/botlab', undefined, {
    createRealtimeSource: () => ({
      getLatestSnapshots: async () => [pollingSnapshot, createSnapshot('ETH')],
      waitForNextSignal: async () => realtimeSignal,
      close: async () => {},
    }),
    discoverActiveRefs: async () => [
      {
        asset: pollingSnapshot.asset,
        slug: pollingSnapshot.slug,
        bucketStartEpoch: pollingSnapshot.bucketStartEpoch,
        bucketStartTime: pollingSnapshot.bucketStartTime,
      },
      {
        asset: 'ETH',
        slug: 'eth-updown-5m-1775994600',
        bucketStartEpoch: 1775994600,
        bucketStartTime: '2026-04-12T11:50:00.000Z',
      },
    ],
    fetchSnapshot: async (ref) => {
      if (ref.asset === 'BTC') {
        return pollingSnapshot;
      }
      return createSnapshot('ETH');
    },
  });

  try {
    const snapshot = await source.waitForNextSignal?.('2026-04-12T11:50:00.000Z', 0);

    assert.ok(snapshot);
    assert.equal(snapshot?.asset, 'BTC');
    assert.equal(snapshot?.upPrice, 0.52);
    assert.equal(snapshot?.downPrice, 0.48);
  } finally {
    await source.close();
  }
});
