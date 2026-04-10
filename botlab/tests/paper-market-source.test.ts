import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createFixturePaperMarketSource,
  discoverActivePaperMarketRefs,
  fetchPaperMarketSnapshot,
  resolveCurrentPaperMarketRefs,
} from '../paper/market-source.js';
import {
  createHybridPaperMarketSource,
  createRealtimePaperMarketSource,
  createRealtimeSnapshotCache,
  ingestRealtimeBestBidAsk,
} from '../paper/realtime-market-source.js';

test('resolveCurrentPaperMarketRefs builds the current BTC and ETH 5m slugs from a clock time', () => {
  const refs = resolveCurrentPaperMarketRefs('2026-03-29T10:53:27.000Z');

  assert.deepEqual(refs.map((ref) => ref.asset), ['BTC', 'ETH']);
  assert.deepEqual(refs.map((ref) => ref.slug), [
    'btc-updown-5m-1774781400',
    'eth-updown-5m-1774781400',
  ]);
  assert.deepEqual(refs.map((ref) => ref.bucketStartTime), [
    '2026-03-29T10:50:00.000Z',
    '2026-03-29T10:50:00.000Z',
  ]);
});

test('discoverActivePaperMarketRefs keeps one active BTC and one active ETH 5m market', async () => {
  const fakeFetch: typeof fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ([
        {
          slug: 'btc-updown-5m-1774781100',
          active: true,
          closed: false,
        },
        {
          slug: 'btc-updown-5m-1774781400',
          active: true,
          closed: false,
        },
        {
          slug: 'eth-updown-5m-1774781400',
          active: true,
          closed: false,
        },
        {
          slug: 'btc-above-200k',
          active: true,
          closed: false,
        },
      ]),
    }) as Response) as typeof fetch;

  const refs = await discoverActivePaperMarketRefs({
    fetchImpl: fakeFetch,
    now: '2026-03-29T10:53:27.000Z',
  });

  assert.deepEqual(refs.map((ref) => ref.asset), ['BTC', 'ETH']);
  assert.deepEqual(refs.map((ref) => ref.slug), [
    'btc-updown-5m-1774781400',
    'eth-updown-5m-1774781400',
  ]);
});

test('discoverActivePaperMarketRefs prefers the current 5m bucket instead of a newer future bucket that is already active', async () => {
  const fakeFetch: typeof fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ([
        {
          slug: 'btc-updown-5m-1774781400',
          active: true,
          closed: false,
        },
        {
          slug: 'btc-updown-5m-1774781700',
          active: true,
          closed: false,
        },
        {
          slug: 'eth-updown-5m-1774781400',
          active: true,
          closed: false,
        },
        {
          slug: 'eth-updown-5m-1774781700',
          active: true,
          closed: false,
        },
      ]),
    }) as Response) as typeof fetch;

  const refs = await discoverActivePaperMarketRefs({
    fetchImpl: fakeFetch,
    now: '2026-03-29T10:53:27.000Z',
  });

  assert.deepEqual(refs.map((ref) => ref.slug), [
    'btc-updown-5m-1774781400',
    'eth-updown-5m-1774781400',
  ]);
});

test('fetchPaperMarketSnapshot normalizes string prices and asks into numbers', async () => {
  const fakeFetch: typeof fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        slug: 'btc-updown-5m-1774781400',
        question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
        active: true,
        closed: false,
        acceptingOrders: 'true',
        outcomes: ['Up', 'Down'],
        endDate: '2026-03-29T10:55:00.000Z',
        eventStartTime: '2026-03-29T10:50:00.000Z',
        outcomePrices: '["0.52","0.48"]',
        bestAsk: '["0.53","0.49"]',
        fetchedAt: '2026-03-29T10:53:27.000Z',
      }),
    }) as Response) as typeof fetch;

  const snapshot = await fetchPaperMarketSnapshot(
    {
      asset: 'BTC',
      slug: 'btc-updown-5m-1774781400',
      bucketStartTime: '2026-03-29T10:50:00.000Z',
      bucketStartEpoch: 1774781400,
    },
    {
      fetchImpl: fakeFetch,
      now: '2026-03-29T10:53:27.000Z',
    },
  );

  assert.deepEqual(snapshot, {
    asset: 'BTC',
    slug: 'btc-updown-5m-1774781400',
    question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
    active: true,
    closed: false,
    acceptingOrders: true,
    eventStartTime: '2026-03-29T10:50:00.000Z',
    endDate: '2026-03-29T10:55:00.000Z',
    bucketStartTime: '2026-03-29T10:50:00.000Z',
    bucketStartEpoch: 1774781400,
    upPrice: 0.52,
    downPrice: 0.48,
    upAsk: 0.53,
    downAsk: 0.49,
    downAskDerivedFromBestBid: false,
    volume: null,
    fetchedAt: '2026-03-29T10:53:27.000Z',
  });
});

test('fetchPaperMarketSnapshot uses outcomes to map reversed order correctly', async () => {
  const fakeFetch: typeof fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        slug: 'eth-updown-5m-1774781400',
        question: 'Ethereum Up or Down - March 29, 10:50AM-10:55AM UTC',
        active: true,
        closed: false,
        acceptingOrders: true,
        outcomes: ['Down', 'Up'],
        endDate: '2026-03-29T10:55:00.000Z',
        eventStartTime: '2026-03-29T10:50:00.000Z',
        outcomePrices: '["0.47","0.53"]',
        bestAsk: '["0.48","0.54"]',
      }),
    }) as Response) as typeof fetch;

  const snapshot = await fetchPaperMarketSnapshot(
    {
      asset: 'ETH',
      slug: 'eth-updown-5m-1774781400',
      bucketStartTime: '2026-03-29T10:50:00.000Z',
      bucketStartEpoch: 1774781400,
    },
    {
      fetchImpl: fakeFetch,
      now: '2026-03-29T10:53:27.000Z',
    },
  );

  assert.equal(snapshot.upPrice, 0.53);
  assert.equal(snapshot.downPrice, 0.47);
  assert.equal(snapshot.upAsk, 0.54);
  assert.equal(snapshot.downAsk, 0.48);
  assert.equal(snapshot.downAskDerivedFromBestBid, false);
});

test('fetchPaperMarketSnapshot handles scalar bestAsk and bestBid on live responses', async () => {
  const fakeFetch: typeof fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        slug: 'btc-updown-5m-1774781400',
        question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
        active: true,
        closed: false,
        acceptingOrders: true,
        outcomes: ['Up', 'Down'],
        endDate: '2026-03-29T10:55:00.000Z',
        eventStartTime: '2026-03-29T10:50:00.000Z',
        outcomePrices: '["0.53","0.47"]',
        bestAsk: 0.54,
        bestBid: 0.45,
      }),
    }) as Response) as typeof fetch;

  const snapshot = await fetchPaperMarketSnapshot(
    {
      asset: 'BTC',
      slug: 'btc-updown-5m-1774781400',
      bucketStartTime: '2026-03-29T10:50:00.000Z',
      bucketStartEpoch: 1774781400,
    },
    {
      fetchImpl: fakeFetch,
      now: '2026-03-29T10:53:27.000Z',
    },
  );

  assert.equal(snapshot.upAsk, 0.54);
  assert.equal(snapshot.downAsk, 0.55);
  assert.equal(snapshot.downAskDerivedFromBestBid, true);
});

test('fetchPaperMarketSnapshot drops obviously placeholder 0.99 asks when order-book enrichment fails', async () => {
  const fakeFetch: typeof fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.endsWith('/markets/slug/btc-updown-5m-1774781400')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          slug: 'btc-updown-5m-1774781400',
          question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
          active: true,
          closed: false,
          acceptingOrders: true,
          outcomes: ['Up', 'Down'],
          clobTokenIds: ['btc-up-token', 'btc-down-token'],
          endDate: '2026-03-29T10:55:00.000Z',
          eventStartTime: '2026-03-29T10:50:00.000Z',
          outcomePrices: '["0.475","0.525"]',
          bestAsk: '["0.99","0.99"]',
          fetchedAt: '2026-03-29T10:53:27.000Z',
        }),
      } as Response;
    }

    if (url.endsWith('/books')) {
      throw new Error('book fetch failed');
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  const snapshot = await fetchPaperMarketSnapshot(
    {
      asset: 'BTC',
      slug: 'btc-updown-5m-1774781400',
      bucketStartTime: '2026-03-29T10:50:00.000Z',
      bucketStartEpoch: 1774781400,
    },
    {
      fetchImpl: fakeFetch,
      now: '2026-03-29T10:53:27.000Z',
    },
  );

  assert.equal(snapshot.upPrice, 0.475);
  assert.equal(snapshot.downPrice, 0.525);
  assert.equal(snapshot.upAsk, null);
  assert.equal(snapshot.downAsk, null);
  assert.equal(snapshot.downAskDerivedFromBestBid, false);
});

test('fetchPaperMarketSnapshot enriches the snapshot with full order book depth when clob books are available', async () => {
  const fakeFetch: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith('/markets/slug/btc-updown-5m-1774781400')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          slug: 'btc-updown-5m-1774781400',
          question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
          active: true,
          closed: false,
          acceptingOrders: true,
          outcomes: ['Up', 'Down'],
          clobTokenIds: ['btc-up-token', 'btc-down-token'],
          endDate: '2026-03-29T10:55:00.000Z',
          eventStartTime: '2026-03-29T10:50:00.000Z',
          outcomePrices: '["0.52","0.48"]',
          bestAsk: '["0.53","0.49"]',
          fetchedAt: '2026-03-29T10:53:27.000Z',
        }),
      } as Response;
    }

    if (url.endsWith('/books')) {
      assert.equal(init?.method, 'POST');
      assert.equal(init?.headers && (init.headers as Record<string, string>)['Content-Type'], 'application/json');

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ([
          {
            asset_id: 'btc-up-token',
            bids: [{ price: '0.51', size: '12.5' }],
            asks: [
              { price: '0.53', size: '8' },
              { price: '0.55', size: '4' },
            ],
          },
          {
            asset_id: 'btc-down-token',
            bids: [{ price: '0.47', size: '9' }],
            asks: [{ price: '0.49', size: '7' }],
          },
        ]),
      } as Response;
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  const snapshot = await fetchPaperMarketSnapshot(
    {
      asset: 'BTC',
      slug: 'btc-updown-5m-1774781400',
      bucketStartTime: '2026-03-29T10:50:00.000Z',
      bucketStartEpoch: 1774781400,
    },
    {
      fetchImpl: fakeFetch,
      now: '2026-03-29T10:53:27.000Z',
    },
  );

  assert.deepEqual(snapshot.upOrderBook, {
    bids: [{ price: 0.51, size: 12.5 }],
    asks: [
      { price: 0.53, size: 8 },
      { price: 0.55, size: 4 },
    ],
    lastTradePrice: null,
  });
  assert.deepEqual(snapshot.downOrderBook, {
    bids: [{ price: 0.47, size: 9 }],
    asks: [{ price: 0.49, size: 7 }],
    lastTradePrice: null,
  });
});

test('fetchPaperMarketSnapshot prefers the latest real trade from the order book feed when the market snapshot is stale', async () => {
  const fakeFetch: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith('/markets/slug/btc-updown-5m-1774781400')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          slug: 'btc-updown-5m-1774781400',
          question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
          active: true,
          closed: false,
          acceptingOrders: true,
          outcomes: ['Up', 'Down'],
          clobTokenIds: ['btc-up-token', 'btc-down-token'],
          endDate: '2026-03-29T10:55:00.000Z',
          eventStartTime: '2026-03-29T10:50:00.000Z',
          outcomePrices: '["0.50","0.50"]',
          bestAsk: '["0.99","0.99"]',
          fetchedAt: '2026-03-29T10:53:27.000Z',
        }),
      } as Response;
    }

    if (url.endsWith('/books')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ([
          {
            asset_id: 'btc-up-token',
            bids: [],
            asks: [],
            last_trade_price: '0.04',
          },
          {
            asset_id: 'btc-down-token',
            bids: [],
            asks: [],
            last_trade_price: '0.96',
          },
        ]),
      } as Response;
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  const snapshot = await fetchPaperMarketSnapshot(
    {
      asset: 'BTC',
      slug: 'btc-updown-5m-1774781400',
      bucketStartTime: '2026-03-29T10:50:00.000Z',
      bucketStartEpoch: 1774781400,
    },
    {
      fetchImpl: fakeFetch,
      now: '2026-03-29T10:53:27.000Z',
    },
  );

  assert.equal(snapshot.upPrice, 0.04);
  assert.equal(snapshot.downPrice, 0.96);
});

test('fetchPaperMarketSnapshot uses the official midpoint display rule before falling back to stale last trades', async () => {
  const fakeFetch: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith('/markets/slug/btc-updown-5m-1774781400')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          slug: 'btc-updown-5m-1774781400',
          question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
          active: true,
          closed: false,
          acceptingOrders: true,
          outcomes: ['Up', 'Down'],
          clobTokenIds: ['btc-up-token', 'btc-down-token'],
          endDate: '2026-03-29T10:55:00.000Z',
          eventStartTime: '2026-03-29T10:50:00.000Z',
          outcomePrices: '["0.50","0.50"]',
          bestAsk: '["0.99","0.99"]',
          fetchedAt: '2026-03-29T10:53:27.000Z',
        }),
      } as Response;
    }

    if (url.endsWith('/books')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ([
          {
            asset_id: 'btc-up-token',
            bids: [],
            asks: [{ price: '0.99', size: '50' }],
            last_trade_price: '0.69',
          },
          {
            asset_id: 'btc-down-token',
            bids: [],
            asks: [{ price: '0.99', size: '50' }],
            last_trade_price: '0.69',
          },
        ]),
      } as Response;
    }

    if (url.endsWith('/midpoints')) {
      assert.equal(init?.method, 'POST');
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          'btc-up-token': '0.04',
          'btc-down-token': '0.96',
        }),
      } as Response;
    }

    if (url.endsWith('/spreads')) {
      assert.equal(init?.method, 'POST');
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          'btc-up-token': '0.02',
          'btc-down-token': '0.02',
        }),
      } as Response;
    }

    if (url.endsWith('/last-trades-prices')) {
      assert.equal(init?.method, 'POST');
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ([
          { token_id: 'btc-up-token', price: '0.69', side: 'BUY' },
          { token_id: 'btc-down-token', price: '0.69', side: 'BUY' },
        ]),
      } as Response;
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  const snapshot = await fetchPaperMarketSnapshot(
    {
      asset: 'BTC',
      slug: 'btc-updown-5m-1774781400',
      bucketStartTime: '2026-03-29T10:50:00.000Z',
      bucketStartEpoch: 1774781400,
    },
    {
      fetchImpl: fakeFetch,
      now: '2026-03-29T10:53:27.000Z',
    },
  );

  assert.equal(snapshot.upPrice, 0.04);
  assert.equal(snapshot.downPrice, 0.96);
});

test('fetchPaperMarketSnapshot rejects bad live snapshots missing outcomes', async () => {
  const fakeFetch: typeof fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        slug: 'btc-updown-5m-1774781400',
        question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
        active: true,
        closed: false,
        acceptingOrders: true,
        endDate: '2026-03-29T10:55:00.000Z',
        eventStartTime: '2026-03-29T10:50:00.000Z',
        outcomePrices: '["0.53","0.47"]',
        bestAsk: 0.54,
        bestBid: 0.45,
      }),
    }) as Response) as typeof fetch;

  await assert.rejects(
    () => fetchPaperMarketSnapshot(
      {
        asset: 'BTC',
        slug: 'btc-updown-5m-1774781400',
        bucketStartTime: '2026-03-29T10:50:00.000Z',
        bucketStartEpoch: 1774781400,
      },
      {
        fetchImpl: fakeFetch,
        now: '2026-03-29T10:53:27.000Z',
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /outcomes must be a 2-item array/i);
      return true;
    },
  );
});

test('fetchPaperMarketSnapshot rejects bad live snapshots with out-of-range binary values', async () => {
  const fakeFetch: typeof fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        slug: 'btc-updown-5m-1774781400',
        question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
        active: true,
        closed: false,
        acceptingOrders: true,
        outcomes: ['Up', 'Down'],
        endDate: '2026-03-29T10:55:00.000Z',
        eventStartTime: '2026-03-29T10:50:00.000Z',
        outcomePrices: '["1.2","-0.2"]',
        bestAsk: 0.54,
        bestBid: 0.45,
      }),
    }) as Response) as typeof fetch;

  await assert.rejects(
    () => fetchPaperMarketSnapshot(
      {
        asset: 'BTC',
        slug: 'btc-updown-5m-1774781400',
        bucketStartTime: '2026-03-29T10:50:00.000Z',
        bucketStartEpoch: 1774781400,
      },
      {
        fetchImpl: fakeFetch,
        now: '2026-03-29T10:53:27.000Z',
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /outcomePrices upPrice must be within 0\.\.1/i);
      return true;
    },
  );
});

test('fetchPaperMarketSnapshot rejects live snapshots whose slug does not match the requested slug', async () => {
  const fakeFetch: typeof fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        slug: 'btc-updown-5m-1774781700',
        question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
        active: true,
        closed: false,
        acceptingOrders: true,
        outcomes: ['Up', 'Down'],
        endDate: '2026-03-29T10:55:00.000Z',
        eventStartTime: '2026-03-29T10:50:00.000Z',
        outcomePrices: '["0.53","0.47"]',
        bestAsk: '["0.54","0.48"]',
      }),
    }) as Response) as typeof fetch;

  await assert.rejects(
    () => fetchPaperMarketSnapshot(
      {
        asset: 'BTC',
        slug: 'btc-updown-5m-1774781400',
        bucketStartTime: '2026-03-29T10:50:00.000Z',
        bucketStartEpoch: 1774781400,
      },
      {
        fetchImpl: fakeFetch,
        now: '2026-03-29T10:53:27.000Z',
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /response slug .* does not match requested slug/i);
      return true;
    },
  );
});

test('createFixturePaperMarketSource loads normalized snapshots from disk', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-market-fixture-'));
  const fixturePath = path.join(fixtureDir, 'markets.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify([
      {
        asset: 'ETH',
        slug: 'eth-updown-5m-1774781400',
        question: 'Ethereum Up or Down - March 29, 10:50AM-10:55AM UTC',
        active: true,
        closed: false,
        acceptingOrders: true,
        bucketStartEpoch: 1774781400,
        bucketStartTime: '2026-03-29T10:50:00.000Z',
        outcomes: ['Up', 'Down'],
        eventStartTime: '2026-03-29T10:50:00.000Z',
        endDate: '2026-03-29T10:55:00.000Z',
        outcomePrices: '["0.41","0.59"]',
        bestAsk: '["0.42","0.60"]',
        fetchedAt: '2026-03-29T10:53:27.000Z',
      },
    ], null, 2),
    'utf-8',
  );

  const loadFixture = createFixturePaperMarketSource(fixturePath);
  const snapshots = await loadFixture();

  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0], {
    asset: 'ETH',
    slug: 'eth-updown-5m-1774781400',
    question: 'Ethereum Up or Down - March 29, 10:50AM-10:55AM UTC',
    active: true,
    closed: false,
    acceptingOrders: true,
    eventStartTime: '2026-03-29T10:50:00.000Z',
    endDate: '2026-03-29T10:55:00.000Z',
    bucketStartTime: '2026-03-29T10:50:00.000Z',
    bucketStartEpoch: 1774781400,
    upPrice: 0.41,
    downPrice: 0.59,
    upAsk: 0.42,
    downAsk: 0.6,
    downAskDerivedFromBestBid: false,
    volume: null,
    fetchedAt: '2026-03-29T10:53:27.000Z',
  });
});

test('realtime cache ingests a best bid ask update into the latest BTC snapshot', () => {
  const cache = createRealtimeSnapshotCache();

  ingestRealtimeBestBidAsk(cache, {
    asset: 'BTC',
    slug: 'btc-updown-5m-1774781400',
    question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
    bucketStartEpoch: 1774781400,
    bucketStartTime: '2026-03-29T10:50:00.000Z',
    fetchedAt: '2026-03-29T10:53:27.000Z',
    upPrice: 0.53,
    downPrice: 0.47,
    upAsk: 0.54,
    downAsk: 0.48,
    volume: 25000,
  });

  const snapshot = cache.latestByAsset.BTC;
  assert.ok(snapshot);
  assert.equal(snapshot.slug, 'btc-updown-5m-1774781400');
  assert.equal(snapshot.upPrice, 0.53);
  assert.equal(snapshot.downPrice, 0.47);
  assert.equal(snapshot.upAsk, 0.54);
  assert.equal(snapshot.downAsk, 0.48);
  assert.equal(snapshot.volume, 25000);
});

test('hybrid paper market source prefers fresh realtime snapshots', async () => {
  const hybrid = createHybridPaperMarketSource({
    now: () => new Date('2026-03-29T10:53:30.000Z'),
    staleAfterMs: 5_000,
    pollingSource: {
      getCurrentSnapshots: async () => {
        throw new Error('polling source should not be used when realtime is fresh');
      },
      getSnapshotBySlug: async () => {
        throw new Error('not needed');
      },
    },
    realtimeSource: {
      getLatestSnapshots: async () => ([
        {
          asset: 'BTC',
          slug: 'btc-updown-5m-1774781400',
          question: 'Bitcoin Up or Down',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-03-29T10:50:00.000Z',
          endDate: '2026-03-29T10:55:00.000Z',
          bucketStartTime: '2026-03-29T10:50:00.000Z',
          bucketStartEpoch: 1774781400,
          upPrice: 0.52,
          downPrice: 0.48,
          upAsk: 0.53,
          downAsk: 0.49,
          upOrderBook: {
            bids: [{ price: 0.51, size: 10 }],
            asks: [{ price: 0.53, size: 10 }],
          },
          downOrderBook: {
            bids: [{ price: 0.47, size: 10 }],
            asks: [{ price: 0.49, size: 10 }],
          },
          downAskDerivedFromBestBid: false,
          volume: 25000,
          fetchedAt: '2026-03-29T10:53:27.000Z',
        },
        {
          asset: 'ETH',
          slug: 'eth-updown-5m-1774781400',
          question: 'Ethereum Up or Down',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-03-29T10:50:00.000Z',
          endDate: '2026-03-29T10:55:00.000Z',
          bucketStartTime: '2026-03-29T10:50:00.000Z',
          bucketStartEpoch: 1774781400,
          upPrice: 0.49,
          downPrice: 0.51,
          upAsk: 0.5,
          downAsk: 0.52,
          upOrderBook: {
            bids: [{ price: 0.49, size: 10 }],
            asks: [{ price: 0.5, size: 10 }],
          },
          downOrderBook: {
            bids: [{ price: 0.48, size: 10 }],
            asks: [{ price: 0.52, size: 10 }],
          },
          downAskDerivedFromBestBid: false,
          volume: 25000,
          fetchedAt: '2026-03-29T10:53:29.000Z',
        },
      ]),
      close: async () => {},
    },
  });

  const snapshots = await hybrid.getCurrentSnapshots();

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0]?.slug, 'btc-updown-5m-1774781400');
  assert.equal(snapshots[1]?.slug, 'eth-updown-5m-1774781400');
});

test('hybrid paper market source falls back to polling when realtime is stale', async () => {
  let pollingCalls = 0;
  const hybrid = createHybridPaperMarketSource({
    now: () => new Date('2026-03-29T10:53:40.000Z'),
    staleAfterMs: 5_000,
    pollingSource: {
      getCurrentSnapshots: async () => {
        pollingCalls += 1;
        return [
          {
            asset: 'BTC',
            slug: 'btc-updown-5m-1774781400',
            question: 'Bitcoin Up or Down',
            active: true,
            closed: false,
            acceptingOrders: true,
            eventStartTime: '2026-03-29T10:50:00.000Z',
            endDate: '2026-03-29T10:55:00.000Z',
            bucketStartTime: '2026-03-29T10:50:00.000Z',
            bucketStartEpoch: 1774781400,
            upPrice: 0.52,
            downPrice: 0.48,
            upAsk: 0.53,
            downAsk: 0.49,
            downAskDerivedFromBestBid: false,
            volume: 25000,
            fetchedAt: '2026-03-29T10:53:40.000Z',
          },
          {
            asset: 'ETH',
            slug: 'eth-updown-5m-1774781400',
            question: 'Ethereum Up or Down',
            active: true,
            closed: false,
            acceptingOrders: true,
            eventStartTime: '2026-03-29T10:50:00.000Z',
            endDate: '2026-03-29T10:55:00.000Z',
            bucketStartTime: '2026-03-29T10:50:00.000Z',
            bucketStartEpoch: 1774781400,
            upPrice: 0.49,
            downPrice: 0.51,
            upAsk: 0.5,
            downAsk: 0.52,
            downAskDerivedFromBestBid: false,
            volume: 25000,
            fetchedAt: '2026-03-29T10:53:40.000Z',
          },
        ];
      },
      getSnapshotBySlug: async () => {
        throw new Error('not needed');
      },
    },
    realtimeSource: {
      getLatestSnapshots: async () => ([
        {
          asset: 'BTC',
          slug: 'btc-updown-5m-1774781400',
          question: 'Bitcoin Up or Down',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-03-29T10:50:00.000Z',
          endDate: '2026-03-29T10:55:00.000Z',
          bucketStartTime: '2026-03-29T10:50:00.000Z',
          bucketStartEpoch: 1774781400,
          upPrice: 0.52,
          downPrice: 0.48,
          upAsk: 0.53,
          downAsk: 0.49,
          downAskDerivedFromBestBid: false,
          volume: 25000,
          fetchedAt: '2026-03-29T10:53:20.000Z',
        },
        {
          asset: 'ETH',
          slug: 'eth-updown-5m-1774781400',
          question: 'Ethereum Up or Down',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-03-29T10:50:00.000Z',
          endDate: '2026-03-29T10:55:00.000Z',
          bucketStartTime: '2026-03-29T10:50:00.000Z',
          bucketStartEpoch: 1774781400,
          upPrice: 0.49,
          downPrice: 0.51,
          upAsk: 0.5,
          downAsk: 0.52,
          downAskDerivedFromBestBid: false,
          volume: 25000,
          fetchedAt: '2026-03-29T10:53:20.000Z',
        },
      ]),
      close: async () => {},
    },
  });

  const snapshots = await hybrid.getCurrentSnapshots();

  assert.equal(pollingCalls, 1);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0]?.fetchedAt, '2026-03-29T10:53:40.000Z');
});

test('hybrid paper market source falls back to polling when realtime prices are internally inconsistent', async () => {
  let pollingCalls = 0;
  const hybrid = createHybridPaperMarketSource({
    now: () => new Date('2026-03-29T10:53:30.000Z'),
    staleAfterMs: 5_000,
    pollingSource: {
      getCurrentSnapshots: async () => {
        pollingCalls += 1;
        return [
          {
            asset: 'BTC',
            slug: 'btc-updown-5m-1774781400',
            question: 'Bitcoin Up or Down',
            active: true,
            closed: false,
            acceptingOrders: true,
            eventStartTime: '2026-03-29T10:50:00.000Z',
            endDate: '2026-03-29T10:55:00.000Z',
            bucketStartTime: '2026-03-29T10:50:00.000Z',
            bucketStartEpoch: 1774781400,
            upPrice: 0.52,
            downPrice: 0.48,
            upAsk: 0.53,
            downAsk: 0.49,
            downAskDerivedFromBestBid: false,
            volume: 25000,
            fetchedAt: '2026-03-29T10:53:30.000Z',
          },
          {
            asset: 'ETH',
            slug: 'eth-updown-5m-1774781400',
            question: 'Ethereum Up or Down',
            active: true,
            closed: false,
            acceptingOrders: true,
            eventStartTime: '2026-03-29T10:50:00.000Z',
            endDate: '2026-03-29T10:55:00.000Z',
            bucketStartTime: '2026-03-29T10:50:00.000Z',
            bucketStartEpoch: 1774781400,
            upPrice: 0.49,
            downPrice: 0.51,
            upAsk: 0.5,
            downAsk: 0.52,
            downAskDerivedFromBestBid: false,
            volume: 25000,
            fetchedAt: '2026-03-29T10:53:30.000Z',
          },
        ];
      },
      getSnapshotBySlug: async () => {
        throw new Error('not needed');
      },
    },
    realtimeSource: {
      getLatestSnapshots: async () => ([
        {
          asset: 'BTC',
          slug: 'btc-updown-5m-1774781400',
          question: 'Bitcoin Up or Down',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-03-29T10:50:00.000Z',
          endDate: '2026-03-29T10:55:00.000Z',
          bucketStartTime: '2026-03-29T10:50:00.000Z',
          bucketStartEpoch: 1774781400,
          upPrice: 0.53,
          downPrice: 0.53,
          upAsk: 0.99,
          downAsk: 0.99,
          downAskDerivedFromBestBid: false,
          volume: 25000,
          fetchedAt: '2026-03-29T10:53:29.000Z',
        },
        {
          asset: 'ETH',
          slug: 'eth-updown-5m-1774781400',
          question: 'Ethereum Up or Down',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-03-29T10:50:00.000Z',
          endDate: '2026-03-29T10:55:00.000Z',
          bucketStartTime: '2026-03-29T10:50:00.000Z',
          bucketStartEpoch: 1774781400,
          upPrice: 0.47,
          downPrice: 0.47,
          upAsk: 0.99,
          downAsk: 0.99,
          downAskDerivedFromBestBid: false,
          volume: 25000,
          fetchedAt: '2026-03-29T10:53:29.000Z',
        },
      ]),
      close: async () => {},
    },
  });

  const snapshots = await hybrid.getCurrentSnapshots();

  assert.equal(pollingCalls, 1);
  assert.equal(snapshots[0]?.upPrice, 0.52);
  assert.equal(snapshots[1]?.downPrice, 0.51);
});

test('realtime paper market source normalizes websocket updates into live snapshots', async () => {
  class FakeWebSocket {
    public static readonly OPEN = 1;
    public readyState = FakeWebSocket.OPEN;
    private readonly listeners: Record<string, Array<(event?: { data?: unknown }) => void>> = {
      open: [],
      close: [],
      error: [],
      message: [],
    };

    constructor() {
      setTimeout(() => {
        this.emit('open');
      }, 0);
    }

    addEventListener(type: 'open', listener: () => void): void;
    addEventListener(type: 'close', listener: () => void): void;
    addEventListener(type: 'error', listener: () => void): void;
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    addEventListener(
      type: 'open' | 'close' | 'error' | 'message',
      listener: (() => void) | ((event: { data: unknown }) => void),
    ): void {
      this.listeners[type].push(listener as (event?: { data?: unknown }) => void);
    }

    send(data: string): void {
      if (data.startsWith('{')) {
        setTimeout(() => {
          this.emit('message', {
            data: JSON.stringify([
              {
                event_type: 'book',
                asset_id: 'btc-up-token',
                timestamp: '2026-03-29T10:53:27.000Z',
                bids: [{ price: '0.52', size: '100' }],
                asks: [{ price: '0.54', size: '100' }],
                last_trade_price: '0.53',
              },
              {
                event_type: 'book',
                asset_id: 'btc-down-token',
                timestamp: '2026-03-29T10:53:27.000Z',
                bids: [{ price: '0.46', size: '100' }],
                asks: [{ price: '0.48', size: '100' }],
                last_trade_price: '0.47',
              },
              {
                event_type: 'book',
                asset_id: 'eth-up-token',
                timestamp: '2026-03-29T10:53:27.000Z',
                bids: [{ price: '0.49', size: '100' }],
                asks: [{ price: '0.51', size: '100' }],
                last_trade_price: '0.50',
              },
              {
                event_type: 'book',
                asset_id: 'eth-down-token',
                timestamp: '2026-03-29T10:53:27.000Z',
                bids: [{ price: '0.49', size: '100' }],
                asks: [{ price: '0.51', size: '100' }],
                last_trade_price: '0.50',
              },
            ]),
          });
        }, 0);
      }
    }

    close(): void {
      this.emit('close');
    }

    private emit(type: 'open' | 'close' | 'error' | 'message', event?: { data?: unknown }) {
      for (const listener of this.listeners[type]) {
        listener(event);
      }
    }
  }

  const fakeFetch: typeof fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.endsWith('/markets')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ([
          {
            slug: 'btc-updown-5m-1774781400',
            active: true,
            closed: false,
          },
          {
            slug: 'eth-updown-5m-1774781400',
            active: true,
            closed: false,
          },
        ]),
      } as Response;
    }

    if (url.endsWith('/markets/slug/btc-updown-5m-1774781400')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          slug: 'btc-updown-5m-1774781400',
          question: 'Bitcoin Up or Down',
          active: true,
          closed: false,
          acceptingOrders: true,
          outcomes: ['Up', 'Down'],
          clobTokenIds: ['btc-up-token', 'btc-down-token'],
          eventStartTime: '2026-03-29T10:50:00.000Z',
          endDate: '2026-03-29T10:55:00.000Z',
          volume: 25000,
        }),
      } as Response;
    }

    if (url.endsWith('/markets/slug/eth-updown-5m-1774781400')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          slug: 'eth-updown-5m-1774781400',
          question: 'Ethereum Up or Down',
          active: true,
          closed: false,
          acceptingOrders: true,
          outcomes: ['Up', 'Down'],
          clobTokenIds: ['eth-up-token', 'eth-down-token'],
          eventStartTime: '2026-03-29T10:50:00.000Z',
          endDate: '2026-03-29T10:55:00.000Z',
          volume: 26000,
        }),
      } as Response;
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  const realtimeSource = createRealtimePaperMarketSource({
    fetchImpl: fakeFetch,
    websocketFactory: () => new FakeWebSocket(),
    now: () => new Date('2026-03-29T10:53:27.000Z'),
    initialWaitMs: 50,
  });

  const snapshots = await realtimeSource.getLatestSnapshots();
  await realtimeSource.close();

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0]?.asset, 'BTC');
  assert.equal(snapshots[0]?.upAsk, 0.54);
  assert.equal(snapshots[0]?.downAsk, 0.48);
  assert.equal(snapshots[1]?.asset, 'ETH');
  assert.equal(snapshots[1]?.upPrice, 0.5);
  assert.equal(snapshots[1]?.downPrice, 0.5);
});

test('realtime paper market source degrades cleanly when websocket support is unavailable', async () => {
  const webSocketGlobal = globalThis as unknown as { WebSocket?: unknown };
  const originalWebSocket = webSocketGlobal.WebSocket;
  webSocketGlobal.WebSocket = undefined;

  const fakeFetch: typeof fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.endsWith('/markets')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ([
          {
            slug: 'btc-updown-5m-1774781400',
            active: true,
            closed: false,
          },
          {
            slug: 'eth-updown-5m-1774781400',
            active: true,
            closed: false,
          },
        ]),
      } as Response;
    }

    if (url.endsWith('/markets/slug/btc-updown-5m-1774781400')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          slug: 'btc-updown-5m-1774781400',
          question: 'Bitcoin Up or Down',
          active: true,
          closed: false,
          acceptingOrders: true,
          outcomes: ['Up', 'Down'],
          clobTokenIds: ['btc-up-token', 'btc-down-token'],
          eventStartTime: '2026-03-29T10:50:00.000Z',
          endDate: '2026-03-29T10:55:00.000Z',
          volume: 25000,
        }),
      } as Response;
    }

    if (url.endsWith('/markets/slug/eth-updown-5m-1774781400')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          slug: 'eth-updown-5m-1774781400',
          question: 'Ethereum Up or Down',
          active: true,
          closed: false,
          acceptingOrders: true,
          outcomes: ['Up', 'Down'],
          clobTokenIds: ['eth-up-token', 'eth-down-token'],
          eventStartTime: '2026-03-29T10:50:00.000Z',
          endDate: '2026-03-29T10:55:00.000Z',
          volume: 26000,
        }),
      } as Response;
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  try {
    const realtimeSource = createRealtimePaperMarketSource({
      fetchImpl: fakeFetch,
      now: () => new Date('2026-03-29T10:53:27.000Z'),
      initialWaitMs: 10,
    });

    const snapshots = await realtimeSource.getLatestSnapshots();
    await realtimeSource.close();

    assert.deepEqual(snapshots, []);
  } finally {
    webSocketGlobal.WebSocket = originalWebSocket;
  }
});
