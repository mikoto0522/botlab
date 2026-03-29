import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { BotlabStrategyContext, BotlabStrategyDefinition } from '../core/types.js';
import { discoverStrategies } from '../core/strategy-loader.js';
import { createStrategyRegistry, getStrategyById } from '../core/strategy-registry.js';

function writeStrategyFile(dir: string, fileName: string, source: string): string {
  const filePath = path.join(dir, fileName);

  fs.writeFileSync(filePath, source, 'utf-8');

  return filePath;
}

function createMomentumStrategyContext(momentum: number): BotlabStrategyContext {
  return {
    mode: 'dry-run',
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD',
      timeframe: '5m',
      price: 101.25,
      changePct24h: 3.2,
      momentum,
      volume: 275000,
      timestamp: '2026-03-26T09:45:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:25:00.000Z', open: 100.2, high: 100.8, low: 100.1, close: 100.7, volume: 980 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 100.7, high: 101.1, low: 100.6, close: 100.95, volume: 1020 },
        { timestamp: '2026-03-26T09:35:00.000Z', open: 100.95, high: 101.3, low: 100.9, close: 101.05, volume: 1050 },
        { timestamp: '2026-03-26T09:40:00.000Z', open: 101.05, high: 101.4, low: 101, close: 101.2, volume: 1090 },
        { timestamp: '2026-03-26T09:45:00.000Z', open: 101.2, high: 101.5, low: 101.1, close: 101.25, volume: 1120 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:45:00.000Z',
    },
  };
}

function createLongMomentumStrategyContext(momentum: number): BotlabStrategyContext {
  return {
    ...createMomentumStrategyContext(momentum),
    position: {
      side: 'long',
      size: 2,
      entryPrice: 99.5,
    },
  };
}

type ExampleMomentumStrategy = BotlabStrategyDefinition<{
  enterMomentum: number;
  exitMomentum: number;
  allocation: number;
}>;

test('discoverStrategies returns only valid strategy files from a directory', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polybot-strategies-'));

  writeStrategyFile(tempDir, 'alpha.strategy.ts', `export const strategy = {
  id: 'alpha',
  name: 'Alpha',
  description: 'Alpha strategy',
  defaults: {
    enterThreshold: 0.6,
    exitThreshold: 0.3,
    allocation: 0.25,
  },
  evaluate(context, params) {
    if (context.position.side === 'flat' && context.market.momentum >= params.enterThreshold) {
      return { action: 'buy', reason: 'momentum strong', size: params.allocation };
    }

    return { action: 'hold', reason: 'waiting' };
  },
};
`);
  fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'ignore me', 'utf-8');

  const strategies = await discoverStrategies(tempDir);

  assert.equal(strategies.length, 1);
  assert.equal(strategies[0]?.definition.id, 'alpha');
  assert.equal(path.basename(strategies[0]?.filePath ?? ''), 'alpha.strategy.ts');
});

test('getStrategyById returns a discovered strategy by id', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polybot-registry-'));

  writeStrategyFile(tempDir, 'alpha.strategy.ts', `export const strategy = {
  id: 'alpha',
  name: 'Alpha',
  description: 'Alpha strategy',
  defaults: {
    enterThreshold: 0.6,
    exitThreshold: 0.3,
    allocation: 0.25,
  },
  evaluate(context, params) {
    if (context.position.side === 'flat' && context.market.momentum >= params.enterThreshold) {
      return { action: 'buy', reason: 'momentum strong', size: params.allocation };
    }

    return { action: 'hold', reason: 'waiting' };
  },
};
`);

  const strategies = await discoverStrategies(tempDir);
  const strategy = getStrategyById(strategies, 'alpha');

  assert.equal(strategy.id, 'alpha');
  assert.equal(strategy.name, 'Alpha');
});

test('example-momentum strategy is discoverable and buys on strong momentum when flat', async () => {
  const registry = await createStrategyRegistry(path.resolve(process.cwd(), 'botlab/strategies'));
  const strategy = registry.getById('example-momentum') as unknown as ExampleMomentumStrategy;
  const decision = strategy.evaluate(createMomentumStrategyContext(0.9), strategy.defaults);

  assert.equal(strategy.id, 'example-momentum');
  assert.equal(strategy.name, 'Example Momentum');
  assert.equal(strategy.description, 'A simple starter strategy that buys strength and exits when momentum fades.');
  assert.equal(strategy.defaults.enterMomentum, 0.65);
  assert.equal(strategy.defaults.exitMomentum, 0.35);
  assert.equal(strategy.defaults.allocation, 0.1);
  assert.equal(decision.action, 'buy');
});

test('example-momentum strategy does not buy when momentum equals the enter threshold', async () => {
  const registry = await createStrategyRegistry(path.resolve(process.cwd(), 'botlab/strategies'));
  const strategy = registry.getById('example-momentum') as unknown as ExampleMomentumStrategy;
  const decision = strategy.evaluate(createMomentumStrategyContext(strategy.defaults.enterMomentum), strategy.defaults);

  assert.equal(decision.action, 'hold');
});

test('example-momentum strategy does not sell when momentum equals the exit threshold', async () => {
  const registry = await createStrategyRegistry(path.resolve(process.cwd(), 'botlab/strategies'));
  const strategy = registry.getById('example-momentum') as unknown as ExampleMomentumStrategy;
  const decision = strategy.evaluate(createLongMomentumStrategyContext(strategy.defaults.exitMomentum), strategy.defaults);

  assert.equal(decision.action, 'hold');
});

test('btc-eth-5m strategy buys on a strong BTC 5m candle sequence', async () => {
  const registry = await createStrategyRegistry(path.resolve(process.cwd(), 'botlab/strategies'));
  const strategy = registry.getById('btc-eth-5m');

  const decision = strategy.evaluate({
    mode: 'dry-run',
    balance: 1000,
    clock: { now: '2026-03-26T09:30:00.000Z' },
    position: { side: 'flat', size: 0, entryPrice: null },
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD',
      timeframe: '5m',
      price: 102.4,
      changePct24h: 2.2,
      momentum: 0.8,
      volume: 250000,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 100, high: 100.4, low: 99.9, close: 100.3, volume: 900 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 100.3, high: 100.9, low: 100.2, close: 100.8, volume: 1000 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 100.8, high: 101.5, low: 100.7, close: 101.3, volume: 1100 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 101.3, high: 102, low: 101.2, close: 101.8, volume: 1200 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 101.8, high: 102.5, low: 101.7, close: 102.4, volume: 1300 },
      ],
    },
  }, strategy.defaults);

  assert.equal(decision.action, 'buy');
});

test('getStrategyById throws for an unknown strategy id', () => {
  assert.throws(
    () => getStrategyById([], 'missing-strategy'),
    /Unknown strategy id: missing-strategy/,
  );
});
