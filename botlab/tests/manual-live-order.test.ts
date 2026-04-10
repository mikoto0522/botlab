import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { PaperMarketSnapshot } from '../paper/market-source.js';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

test('manualLiveOrderCommand submits one current-round live buy and reports the fill summary', async () => {
  const { manualLiveOrderCommand } = await import('../commands/manual-live-order.js');
  const { loadBotlabConfig } = await import('../config/default-config.js');
  const config = loadBotlabConfig(undefined, repoRoot);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-manual-live-order-'));
  const buyCalls: Array<Record<string, unknown>> = [];
  const balances = [10, 9.49];

  const snapshots: PaperMarketSnapshot[] = [
    {
      asset: 'BTC',
      slug: 'btc-updown-5m-1775651400',
      question: 'Bitcoin Up or Down - manual live order',
      active: true,
      closed: false,
      acceptingOrders: true,
      eventStartTime: '2026-04-08T12:30:00.000Z',
      endDate: '2026-04-08T12:35:00.000Z',
      bucketStartTime: '2026-04-08T12:30:00.000Z',
      bucketStartEpoch: 1775651400,
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
      fetchedAt: '2026-04-08T12:31:00.000Z',
      downAskDerivedFromBestBid: false,
    },
    {
      asset: 'ETH',
      slug: 'eth-updown-5m-1775651400',
      question: 'Ethereum Up or Down - manual live order',
      active: true,
      closed: false,
      acceptingOrders: true,
      eventStartTime: '2026-04-08T12:30:00.000Z',
      endDate: '2026-04-08T12:35:00.000Z',
      bucketStartTime: '2026-04-08T12:30:00.000Z',
      bucketStartEpoch: 1775651400,
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
      fetchedAt: '2026-04-08T12:31:00.000Z',
      downAskDerivedFromBestBid: false,
    },
  ];

  const output = await manualLiveOrderCommand(config, {
    asset: 'BTC',
    side: 'up',
    stakeUsd: 0.5,
    sessionName: 'manual-live-test',
    cwd,
    marketSource: {
      getCurrentSnapshots: async () => snapshots.map((snapshot) => ({ ...snapshot })),
      getSnapshotBySlug: async (slug) => {
        const match = snapshots.find((snapshot) => snapshot.slug === slug);
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
        eventStartTime: '2026-04-08T12:30:00.000Z',
        endDate: '2026-04-08T12:35:00.000Z',
        bucketStartTime: '2026-04-08T12:30:00.000Z',
        bucketStartEpoch: 1775651400,
        upLabel: 'Up',
        downLabel: 'Down',
        upTokenId: `${asset.toLowerCase()}-up-token`,
        downTokenId: `${asset.toLowerCase()}-down-token`,
        volume: 1500,
        tickSize: '0.01',
        negRisk: false,
      }),
      close: async () => {},
    },
    tradingClient: {
      getCollateralBalance: async () => balances.shift() ?? 9.49,
      buyOutcome: async (input) => {
        buyCalls.push(input as unknown as Record<string, unknown>);
        return {
          orderId: 'manual-order-1',
          status: 'matched',
          tokenId: String(input.tokenId),
          requestedAmount: Number(input.amount),
          spentAmount: 0.5,
          shares: 0.94,
          averagePrice: 0.53,
          feesPaid: 0.01,
        };
      },
      sellOutcome: async () => {
        throw new Error('unexpected sell call');
      },
    },
  });

  assert.equal(buyCalls.length, 1);
  assert.equal(buyCalls[0]?.amount, 0.5);
  assert.equal(buyCalls[0]?.priceLimit, 0.55);
  assert.match(output, /Manual Live Order Result/);
  assert.match(output, /Asset: BTC/);
  assert.match(output, /Side: up/);
  assert.match(output, /Stake: 0.5/);
  assert.match(output, /Status: matched/);
  assert.match(output, /Order ID: manual-order-1/);
  assert.match(output, /Shares: 0.94/);
  assert.match(output, /Average Price: 0.53/);
});

test('manualLiveOrderCommand stops before submission when the current round only shows placeholder 0.99 asks', async () => {
  const { manualLiveOrderCommand } = await import('../commands/manual-live-order.js');
  const { loadBotlabConfig } = await import('../config/default-config.js');
  const config = loadBotlabConfig(undefined, repoRoot);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-manual-live-error-'));

  const output = await manualLiveOrderCommand(config, {
    asset: 'BTC',
    side: 'up',
    stakeUsd: 0.5,
    sessionName: 'manual-live-error-test',
    cwd,
    marketSource: {
      getCurrentSnapshots: async () => [
        {
          asset: 'BTC',
          slug: 'btc-updown-5m-1775651700',
          question: 'Bitcoin Up or Down - manual live error',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-04-08T12:35:00.000Z',
          endDate: '2026-04-08T12:40:00.000Z',
          bucketStartTime: '2026-04-08T12:35:00.000Z',
          bucketStartEpoch: 1775651700,
          upPrice: 0.475,
          downPrice: 0.525,
          upAsk: 0.99,
          downAsk: 0.99,
          volume: 130,
          fetchedAt: '2026-04-08T12:36:00.000Z',
          downAskDerivedFromBestBid: false,
        },
        {
          asset: 'ETH',
          slug: 'eth-updown-5m-1775651700',
          question: 'Ethereum Up or Down - manual live error',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-04-08T12:35:00.000Z',
          endDate: '2026-04-08T12:40:00.000Z',
          bucketStartTime: '2026-04-08T12:35:00.000Z',
          bucketStartEpoch: 1775651700,
          upPrice: 0.5,
          downPrice: 0.5,
          upAsk: 0.51,
          downAsk: 0.51,
          volume: 1500,
          fetchedAt: '2026-04-08T12:36:00.000Z',
          downAskDerivedFromBestBid: false,
        },
      ],
      getSnapshotBySlug: async (slug) => ({
        asset: 'BTC',
        slug,
        question: 'Bitcoin Up or Down - manual live error',
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:35:00.000Z',
        endDate: '2026-04-08T12:40:00.000Z',
        bucketStartTime: '2026-04-08T12:35:00.000Z',
        bucketStartEpoch: 1775651700,
        upPrice: 0.475,
        downPrice: 0.525,
        upAsk: 0.99,
        downAsk: 0.99,
        volume: 130,
        fetchedAt: '2026-04-08T12:36:00.000Z',
        downAskDerivedFromBestBid: false,
      }),
      getMarketDetail: async (slug, asset) => ({
        asset,
        slug,
        question: `${asset} detail`,
        active: true,
        closed: false,
        acceptingOrders: true,
        eventStartTime: '2026-04-08T12:35:00.000Z',
        endDate: '2026-04-08T12:40:00.000Z',
        bucketStartTime: '2026-04-08T12:35:00.000Z',
        bucketStartEpoch: 1775651700,
        upLabel: 'Up',
        downLabel: 'Down',
        upTokenId: `${asset.toLowerCase()}-up-token`,
        downTokenId: `${asset.toLowerCase()}-down-token`,
        volume: 130,
        tickSize: '0.01',
        negRisk: false,
      }),
      close: async () => {},
    },
    tradingClient: {
      getCollateralBalance: async () => 30.01,
      buyOutcome: async () => {
        throw new Error('buy should not be attempted');
      },
      sellOutcome: async () => {
        throw new Error('unexpected sell call');
      },
    },
  });

  assert.match(output, /Status: no live order opened/);
  assert.doesNotMatch(output, /invalid price/);
});
