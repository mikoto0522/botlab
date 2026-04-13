import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBuySlippageLimit,
  applySellSlippageLimit,
  DEFAULT_MAX_PRICE_SLIPPAGE_PCT,
  guardBuyExecution,
  guardSellExecution,
  hasOnlyPlaceholderOutcomeAsks,
  previewBuyExecution,
  previewSellExecution,
  readBestOutcomeAsk,
} from '../execution/order-book.js';
import type { PaperMarketSnapshot } from '../paper/market-source.js';

function createSnapshot(overrides: Partial<PaperMarketSnapshot> = {}): PaperMarketSnapshot {
  return {
    asset: 'BTC',
    slug: 'btc-updown-5m-1775649600',
    question: 'BTC up or down',
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
    ...overrides,
  };
}

test('shared order-book preview refuses entry when visible asks are missing', () => {
  const snapshot = createSnapshot({
    upOrderBook: {
      bids: [{ price: 0.52, size: 50 }],
      asks: [],
    },
  });

  const preview = previewBuyExecution(snapshot, 'up', 1, 'polymarket-2026-03-26');

  assert.equal(preview, null);
  assert.equal(readBestOutcomeAsk(snapshot, 'up'), 0.53);
});

test('shared order-book preview spots placeholder dual 0.99 asks', () => {
  const snapshot = createSnapshot({
    upPrice: 0.47,
    downPrice: 0.53,
    upAsk: 0.99,
    downAsk: 0.99,
    upOrderBook: {
      bids: [{ price: 0.47, size: 50 }],
      asks: [{ price: 0.99, size: 50 }],
    },
    downOrderBook: {
      bids: [{ price: 0.53, size: 50 }],
      asks: [{ price: 0.99, size: 50 }],
    },
  });

  assert.equal(hasOnlyPlaceholderOutcomeAsks(snapshot), true);
  assert.equal(previewBuyExecution(snapshot, 'up', 1, 'polymarket-2026-03-26'), null);
});

test('shared order-book preview refuses exit when visible bids are missing', () => {
  const snapshot = createSnapshot({
    upOrderBook: {
      bids: [],
      asks: [{ price: 0.53, size: 50 }],
    },
  });

  const preview = previewSellExecution(snapshot, 'up', 2, 'polymarket-2026-03-26');

  assert.equal(preview, null);
});

test('shared order-book buy slippage limit keeps only fills within 5% of the front ask', () => {
  const preview = previewBuyExecution(createSnapshot({
    upOrderBook: {
      bids: [{ price: 0.52, size: 50 }],
      asks: [
        { price: 0.53, size: 1 },
        { price: 0.57, size: 10 },
      ],
    },
  }), 'up', 2, 'polymarket-2026-03-26');

  assert.ok(preview);

  const limited = applyBuySlippageLimit(preview, 0.05);

  assert.ok(limited);
  assert.equal(limited.shares, 1);
  assert.equal(limited.avgPrice, 0.53);
  assert.equal(limited.fills.length, 1);
});

test('shared order-book sell slippage limit keeps only fills within 5% of the front bid', () => {
  const preview = previewSellExecution(createSnapshot({
    upOrderBook: {
      bids: [
        { price: 0.52, size: 1 },
        { price: 0.48, size: 10 },
      ],
      asks: [{ price: 0.53, size: 50 }],
    },
  }), 'up', 2, 'polymarket-2026-03-26');

  assert.ok(preview);

  const limited = applySellSlippageLimit(preview, 0.05);

  assert.ok(limited);
  assert.equal(limited.shares, 1);
  assert.equal(limited.avgPrice, 0.52);
  assert.equal(limited.fills.length, 1);
});

test('shared order-book guard uses one default slippage rule for buy and sell', () => {
  assert.equal(DEFAULT_MAX_PRICE_SLIPPAGE_PCT, 0.05);

  const buyPreview = previewBuyExecution(createSnapshot({
    upOrderBook: {
      bids: [{ price: 0.52, size: 50 }],
      asks: [
        { price: 0.53, size: 1 },
        { price: 0.57, size: 10 },
      ],
    },
  }), 'up', 2, 'polymarket-2026-03-26');

  const sellPreview = previewSellExecution(createSnapshot({
    upOrderBook: {
      bids: [
        { price: 0.52, size: 1 },
        { price: 0.48, size: 10 },
      ],
      asks: [{ price: 0.53, size: 50 }],
    },
  }), 'up', 2, 'polymarket-2026-03-26');

  assert.ok(buyPreview);
  assert.ok(sellPreview);
  assert.equal(guardBuyExecution(buyPreview, DEFAULT_MAX_PRICE_SLIPPAGE_PCT), null);
  assert.equal(guardSellExecution(sellPreview, DEFAULT_MAX_PRICE_SLIPPAGE_PCT), null);
});

test('shared order-book preview sorts scrambled asks before buying through multiple levels', () => {
  const preview = previewBuyExecution(createSnapshot({
    downOrderBook: {
      bids: [{ price: 0.48, size: 50 }],
      asks: [
        { price: 0.99, size: 5.04 },
        { price: 0.67, size: 0.01 },
        { price: 0.72, size: 10 },
      ],
    },
    downAsk: 0.99,
  }), 'down', 5, 'polymarket-2026-03-26');

  assert.ok(preview);
  assert.equal(preview.fills[0]?.price, 0.67);
  assert.equal(preview.fills[1]?.price, 0.72);
  assert.equal(preview.quotedPrice, 0.67);
});
