import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadBotlabConfig } from '../config/default-config.js';
import {
  describeStrategyById,
  listAvailableStrategies,
  runStrategyById,
} from '../core/engine.js';
import { listStrategiesCommand } from '../commands/list-strategies.js';
import { describeStrategyCommand } from '../commands/describe-strategy.js';
import { runStrategyCommand } from '../commands/run-strategy.js';

type TempConfigRuntime = {
  market: {
    asset: string;
    symbol: string;
    timeframe: string;
    price?: number;
    upPrice?: number;
    downPrice?: number;
    upAsk?: number;
    downAsk?: number;
    volume?: number;
    timestamp?: string;
    candles: Array<{
      timestamp: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;
  };
  relatedMarkets?: Array<{
    asset: string;
    symbol: string;
    timeframe: string;
    price?: number;
    volume: number;
    timestamp: string;
    candles: Array<{
      timestamp: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;
  }>;
  position: {
    side: 'flat' | 'long' | 'short';
    size: number;
    entryPrice: number | null;
  };
  balance: number;
  clock: {
    now: string;
  };
};

function writeTempConfig(runtime: TempConfigRuntime): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-config-'));
  const configPath = path.join(tempDir, 'config.json');

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        runtime,
      },
      null,
      2,
    ),
  );

  return configPath;
}

function assertCloseTo(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function writeTempBatchStrategy(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-batch-strategy-'));
  const strategyPath = path.join(tempDir, 'batch-directional.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'batch-directional',",
      "  name: 'Batch Directional',",
      "  description: 'Chooses up or down from prior same-asset history, and holds when there is no history.',",
      '  defaults: {},',
      '  evaluate(context) {',
      '    const candles = context.market.candles;',
      "    if (candles.length === 0) {",
      "      return { action: 'hold', reason: 'need prior history' };",
      '    }',
      '    const current = candles.at(-1).close;',
      '    if (current > 0.5) {',
      "      return { action: 'buy', side: 'up', size: 50, reason: 'history is rising' };",
      '    }',
      '    if (current < 0.5) {',
      "      return { action: 'buy', side: 'down', size: 50, reason: 'history is falling' };",
      '    }',
      "    return { action: 'hold', reason: 'history is flat' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return tempDir;
}

function writeTempPriceStrategy(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-batch-price-strategy-'));
  const strategyPath = path.join(tempDir, 'batch-price.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'batch-price',",
      "  name: 'Batch Price',",
      "  description: 'Trades from the current row price only.',",
      '  defaults: {},',
      '  evaluate(context) {',
      "    if (context.market.price > 0.6) {",
      "      return { action: 'buy', side: 'up', size: 50, reason: 'current price is high enough' };",
      '    }',
      "    return { action: 'hold', reason: 'current price is too low' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return tempDir;
}

function writeTempRelatedMarketStrategy(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-batch-related-market-'));
  const strategyPath = path.join(tempDir, 'batch-related-market.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'batch-related-market',",
      "  name: 'Batch Related Market',",
      "  description: 'Trades only when prior related-market context is available.',",
      '  defaults: {},',
      '  evaluate(context) {',
      "    const related = context.relatedMarkets?.find((market) => market.asset !== context.market.asset);",
      "    if (!related || related.candles.length === 0) {",
      "      return { action: 'hold', reason: 'need prior related market history' };",
      '    }',
      "    if (related.price > 0.5) {",
      "      return { action: 'buy', side: 'up', size: 50, reason: 'related market was rich' };",
      '    }',
      "    return { action: 'buy', side: 'down', size: 50, reason: 'related market was cheap' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return tempDir;
}

function writeTempFixedBuyStrategy(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-backtest-fixed-buy-'));
  const strategyPath = path.join(tempDir, 'fixed-buy.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'fixed-buy',",
      "  name: 'Fixed Buy',",
      "  description: 'Buys once with a fixed budget and then waits for settlement.',",
      '  defaults: {},',
      '  evaluate(context) {',
      "    if (context.position.side !== 'flat') {",
      "      return { action: 'hold', reason: 'already in position' };",
      '    }',
      "    return { action: 'buy', side: 'up', size: 100, reason: 'fixed entry budget' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return tempDir;
}

function writeTempInvalidSizeStrategy(mode: 'zero' | 'nan' | 'infinite'): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-batch-invalid-size-'));
  const strategyPath = path.join(tempDir, `batch-invalid-size-${mode}.strategy.ts`);
  const sizeExpression = mode === 'zero'
    ? '0'
    : mode === 'nan'
      ? 'Number.NaN'
      : 'Number.POSITIVE_INFINITY';

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      `  id: 'batch-invalid-size-${mode}',`,
      "  name: 'Batch Invalid Size',",
      "  description: 'Returns an invalid size to test batch validation.',",
      '  defaults: {},',
      '  evaluate() {',
      "    return { action: 'buy', side: 'up', size: " + sizeExpression + ", reason: 'invalid size' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return tempDir;
}

function writeTempSellStrategy(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-batch-sell-strategy-'));
  const strategyPath = path.join(tempDir, 'batch-sell.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'batch-sell',",
      "  name: 'Batch Sell',",
      "  description: 'Returns sell so batch mode can reject it clearly.',",
      '  defaults: {},',
      '  evaluate() {',
      "    return { action: 'sell', reason: 'sell is not supported in batch mode' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return tempDir;
}

function writeTempHistoryMutationStrategy(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-batch-history-mutation-'));
  const strategyPath = path.join(tempDir, 'batch-history-mutation.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'let callCount = 0;',
      'export const strategy = {',
      "  id: 'batch-history-mutation',",
      "  name: 'Batch History Mutation',",
      "  description: 'Mutates its local candles array to ensure batch history is copied per row.',",
      '  defaults: {},',
      '  evaluate(context) {',
      '    callCount += 1;',
      '    if (callCount === 1) {',
      '      context.market.candles.push({',
      "        timestamp: '2026-03-26T08:55:00.000Z',",
      '        open: 0.9,',
      '        high: 0.9,',
      '        low: 0.9,',
      '        close: 0.9,',
      '        volume: 1,',
      '      });',
      "      return { action: 'hold', reason: 'seed a local mutation' };",
      '    }',
      "    if (context.market.candles.length > 1) {",
      "      return { action: 'buy', side: 'up', size: 50, reason: 'history leaked across rows' };",
      '    }',
      "    return { action: 'hold', reason: 'history stayed isolated' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return tempDir;
}

function writeTempHedgeStrategy(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-hedge-strategy-'));
  const strategyPath = path.join(tempDir, 'test-hedge.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'test-hedge',",
      "  name: 'Test Hedge',",
      "  description: 'Opens one BTC leg and one ETH leg together when both are present.',",
      '  defaults: {},',
      '  evaluate() {',
      "    return { action: 'hold', reason: 'single-market mode not used' };",
      '  },',
      '  evaluateHedge(context) {',
      "    const btc = context.markets.find((market) => market.asset === 'BTC');",
      "    const eth = context.markets.find((market) => market.asset === 'ETH');",
      '    if (!btc || !eth) {',
      "      return { action: 'hold', reason: 'need both legs' };",
      '    }',
      '    return {',
      "      action: 'hedge',",
      "      reason: 'buy BTC and ETH together',",
      '      legs: [',
      "        { asset: 'BTC', side: 'up', size: 40 },",
      "        { asset: 'ETH', side: 'down', size: 40 },",
      '      ],',
      '    };',
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return tempDir;
}

function makeBatchRows() {
  return [
    {
      timestamp: '2026-03-26T09:00:00.000Z',
      market: 'BTC-USD-5M',
      timeframe: '5m',
      upPrice: 0.6,
      downPrice: 0.4,
      volume: 100,
      outcome: 'up' as const,
    },
    {
      timestamp: '2026-03-26T09:00:00.000Z',
      market: 'ETH-USD-5M',
      timeframe: '5m',
      upPrice: 0.4,
      downPrice: 0.6,
      volume: 100,
      outcome: 'down' as const,
    },
    {
      timestamp: '2026-03-26T09:05:00.000Z',
      market: 'BTC-USD-1H',
      timeframe: '1h',
      upPrice: 0.4,
      downPrice: 0.6,
      volume: 100,
      outcome: 'up' as const,
    },
    {
      timestamp: '2026-03-26T09:05:00.000Z',
      market: 'ETH-USD-1H',
      timeframe: '1h',
      upPrice: 0.7,
      downPrice: 0.3,
      volume: 100,
      outcome: 'up' as const,
    },
    {
      timestamp: '2026-03-26T09:10:00.000Z',
      market: 'BTC-USD-5M',
      timeframe: '5m',
      upPrice: 0.35,
      downPrice: 0.65,
      volume: 100,
      outcome: 'down' as const,
    },
  ];
}

function makeDuplicateTimestampRows() {
  return [
    {
      timestamp: '2026-03-26T09:00:00.000Z',
      market: 'BTC-USD-5M',
      timeframe: '5m',
      upPrice: 0.4,
      downPrice: 0.6,
      volume: 100,
      outcome: 'up' as const,
    },
    {
      timestamp: '2026-03-26T09:00:00.000Z',
      market: 'BTC-USD-5M',
      timeframe: '5m',
      upPrice: 0.8,
      downPrice: 0.2,
      volume: 100,
      outcome: 'up' as const,
    },
  ];
}

async function loadStrategyResult(strategyId: string, runtime: TempConfigRuntime) {
  const configPath = writeTempConfig(runtime);
  const config = loadBotlabConfig(configPath, process.cwd());

  return runStrategyById(strategyId, config);
}

async function loadBtcEth5mResult(runtime: TempConfigRuntime) {
  return loadStrategyResult('btc-eth-5m', runtime);
}

async function loadMultiSignalResult(runtime: TempConfigRuntime) {
  return loadStrategyResult('btc-eth-5m-multi-signal', runtime);
}

async function loadDirectStrategyDecision(strategyId: string, runtime: TempConfigRuntime) {
  const { createStrategyRegistry } = await import('../core/strategy-registry.js');
  const registry = await createStrategyRegistry(path.resolve(process.cwd(), 'botlab/strategies'));
  const strategy = registry.getById(strategyId);

  return strategy.evaluate(runtime as unknown as Parameters<typeof strategy.evaluate>[0], structuredClone(strategy.defaults));
}

async function loadHedgeDecision(
  strategyId: string,
  markets: Array<{
    asset: string;
    symbol: string;
    timeframe: string;
    price: number;
    volume: number;
    timestamp: string;
    candles: Array<{
      timestamp: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;
  }>,
  balance = 1000,
) {
  const { createStrategyRegistry } = await import('../core/strategy-registry.js');
  const registry = await createStrategyRegistry(path.resolve(process.cwd(), 'botlab/strategies'));
  const strategy = registry.getById(strategyId);

  if (typeof strategy.evaluateHedge !== 'function') {
    throw new Error(`Strategy ${strategyId} does not support hedge evaluation in tests`);
  }

  return strategy.evaluateHedge({
    mode: 'dry-run',
    markets,
    balance,
    clock: {
      now: markets[0]?.timestamp ?? '2026-03-26T09:00:00.000Z',
    },
  }, structuredClone(strategy.defaults));
}

test('runStrategyById executes the example strategy and renders a buy decision', async () => {
  const config = loadBotlabConfig(undefined, process.cwd());

  const result = await runStrategyById('example-momentum', config);

  assert.equal(result.strategyId, 'example-momentum');
  assert.equal(result.decision.action, 'buy');
  assert.match(result.renderedOutput, /ACTION:\s*buy/);
});

test('returned strategy defaults do not leak into later runs', async () => {
  const config = loadBotlabConfig(undefined, process.cwd());

  const firstResult = await runStrategyById('example-momentum', config);

  firstResult.strategy.defaults.enterMomentum = 0.99;

  const secondResult = await runStrategyById('example-momentum', config);

  assert.equal(secondResult.decision.action, 'buy');
  assert.deepEqual(secondResult.strategy.defaults, {
    enterMomentum: 0.65,
    exitMomentum: 0.35,
    allocation: 0.1,
  });
});

test('listAvailableStrategies returns the discovered strategy metadata', async () => {
  const config = loadBotlabConfig(undefined, process.cwd());

  const strategies = await listAvailableStrategies(config);

  assert.ok(strategies.some((strategy) => strategy.id === 'example-momentum'));
  assert.ok(strategies.some((strategy) => strategy.id === 'btc-eth-5m-aggressive'));
  assert.equal(
    strategies.find((strategy) => strategy.id === 'example-momentum')?.name,
    'Example Momentum',
  );
});

test('describeStrategyById returns the example strategy details', async () => {
  const config = loadBotlabConfig(undefined, process.cwd());

  const strategy = await describeStrategyById('example-momentum', config);

  assert.equal(strategy.id, 'example-momentum');
  assert.equal(strategy.name, 'Example Momentum');
  assert.equal(strategy.description, 'A simple starter strategy that buys strength and exits when momentum fades.');
  assert.deepEqual(strategy.defaults, {
    enterMomentum: 0.65,
    exitMomentum: 0.35,
    allocation: 0.1,
  });
});

test('describeStrategyById returns the aggressive btc/eth strategy details', async () => {
  const config = loadBotlabConfig(undefined, process.cwd());

  const strategy = await describeStrategyById('btc-eth-5m-aggressive', config);

  assert.equal(strategy.id, 'btc-eth-5m-aggressive');
  assert.equal(strategy.name, 'BTC / ETH 5m Binary Pattern Aggressive');
});

test('describeStrategyById returns the BTC/ETH pair-model strategy details', async () => {
  const config = loadBotlabConfig(undefined, process.cwd());

  const strategy = await describeStrategyById('btc-eth-5m-pair-model', config);

  assert.equal(strategy.id, 'btc-eth-5m-pair-model');
  assert.equal(strategy.name, 'BTC / ETH 5m Pair Model');
});

test('describeStrategyById returns the BTC/ETH true hedge strategy details', async () => {
  const config = loadBotlabConfig(undefined, process.cwd());

  const strategy = await describeStrategyById('btc-eth-5m-true-hedge', config);

  assert.equal(strategy.id, 'btc-eth-5m-true-hedge');
  assert.equal(strategy.name, 'BTC / ETH 5m True Hedge');
});

test('read command wrappers return human-friendly text', async () => {
  const config = loadBotlabConfig(undefined, process.cwd());

  const listOutput = await listStrategiesCommand(config);
  const describeOutput = await describeStrategyCommand('example-momentum', config);
  const runOutput = await runStrategyCommand('example-momentum', config);

  assert.match(listOutput, /example-momentum/);
  assert.match(describeOutput, /Example Momentum/);
  assert.match(describeOutput, /"enterMomentum": 0.65/);
  assert.match(runOutput, /ACTION:\s*buy/);
});

test('btc-eth-5m can return a buy decision with side up on a bullish setup', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 99, high: 100.2, low: 98.9, close: 99.8, volume: 1100 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 99.8, high: 101.2, low: 99.7, close: 100.9, volume: 1250 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 100.9, high: 102.3, low: 100.8, close: 102.1, volume: 1380 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 102.1, high: 103.2, low: 102, close: 103.1, volume: 1410 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 103.1, high: 104.5, low: 103, close: 104.3, volume: 1490 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.strategy.id, 'btc-eth-5m');
  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'up');
  assert.match(result.renderedOutput, /ACTION:\s*buy/);
});

test('btc-eth-5m can return a buy decision with side up on a mostly bullish setup with one pullback', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 199, high: 200.4, low: 198.8, close: 200.1, volume: 1100 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 200.1, high: 201.3, low: 199.9, close: 201, volume: 1250 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 201, high: 201.2, low: 200.2, close: 200.6, volume: 1180 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 200.6, high: 202.1, low: 200.5, close: 201.8, volume: 1410 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 201.8, high: 203.2, low: 201.7, close: 202.9, volume: 1490 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.strategy.id, 'btc-eth-5m');
  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'up');
});

test('btc-eth-5m can return a buy decision with side down on a bearish setup', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 104.5, high: 104.6, low: 103.4, close: 104, volume: 1100 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 104, high: 104.1, low: 102.9, close: 103, volume: 1250 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 103, high: 103.2, low: 101.8, close: 102, volume: 1380 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 102, high: 102.1, low: 100.9, close: 101, volume: 1410 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 101, high: 101.1, low: 99.8, close: 100, volume: 1490 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.strategy.id, 'btc-eth-5m');
  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'down');
  assert.match(result.renderedOutput, /ACTION:\s*buy/);
});

test('btc-eth-5m can return a buy decision with side down on a mostly bearish setup with one rebound', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 205, high: 205.2, low: 203.9, close: 204.1, volume: 1100 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 204.1, high: 204.3, low: 202.8, close: 203, volume: 1250 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 203, high: 203.7, low: 202.6, close: 203.3, volume: 1180 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 203.3, high: 203.4, low: 201.7, close: 202, volume: 1410 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 202, high: 202.1, low: 200.4, close: 200.9, volume: 1490 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.strategy.id, 'btc-eth-5m');
  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'down');
});

test('btc-eth-5m holds on a balanced and noisy 5m window', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 100, high: 100.6, low: 99.4, close: 99.8, volume: 1100 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 99.8, high: 100.7, low: 99.7, close: 100.4, volume: 1250 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 100.4, high: 100.5, low: 99.6, close: 99.9, volume: 1380 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 99.9, high: 100.8, low: 99.8, close: 100.3, volume: 1410 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 100.3, high: 100.4, low: 99.7, close: 100.1, volume: 1490 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.strategy.id, 'btc-eth-5m');
  assert.equal(result.decision.action, 'hold');
  assert.equal(result.decision.side, undefined);
  assert.match(result.renderedOutput, /ACTION:\s*hold/);
});

test('btc-eth-5m holds when recent BTC binary history is too mixed for the fade setup', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.72, high: 0.76, low: 0.71, close: 0.75, volume: 1100 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.75, high: 0.79, low: 0.74, close: 0.78, volume: 1250 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.78, high: 0.79, low: 0.73, close: 0.74, volume: 1380 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.74, high: 0.81, low: 0.73, close: 0.8, volume: 1410 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 0.8, high: 0.83, low: 0.78, close: 0.82, volume: 1490 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
  assert.equal(result.decision.side, undefined);
});

test('btc-eth-5m buys BTC down when recent binary closes keep stepping higher across the full range', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.12, high: 0.16, low: 0.11, close: 0.15, volume: 1600 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.15, high: 0.24, low: 0.14, close: 0.23, volume: 1620 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.23, high: 0.34, low: 0.22, close: 0.33, volume: 1650 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.33, high: 0.45, low: 0.32, close: 0.44, volume: 1710 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.44, high: 0.57, low: 0.43, close: 0.56, volume: 1740 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'down');
});

test('btc-eth-5m buys BTC up when recent binary closes keep stepping lower across the full range', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.59, high: 0.6, low: 0.52, close: 0.54, volume: 1600 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.54, high: 0.55, low: 0.45, close: 0.47, volume: 1620 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.47, high: 0.48, low: 0.38, close: 0.4, volume: 1650 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.4, high: 0.41, low: 0.31, close: 0.33, volume: 1710 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.33, high: 0.34, low: 0.24, close: 0.26, volume: 1740 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'up');
});

test('btc-eth-5m holds when BTC has already pushed beyond the safer fade zone', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.18, high: 0.23, low: 0.17, close: 0.22, volume: 1600 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.22, high: 0.31, low: 0.21, close: 0.3, volume: 1620 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.3, high: 0.42, low: 0.29, close: 0.41, volume: 1650 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.41, high: 0.57, low: 0.4, close: 0.56, volume: 1710 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.56, high: 0.73, low: 0.55, close: 0.71, volume: 1740 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
  assert.equal(result.decision.side, undefined);
});

test('btc-eth-5m-aggressive still buys BTC down after the streak pushes beyond the safer balanced zone', async () => {
  const result = await loadStrategyResult('btc-eth-5m-aggressive', {
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.18, high: 0.23, low: 0.17, close: 0.22, volume: 1600 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.22, high: 0.31, low: 0.21, close: 0.3, volume: 1620 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.3, high: 0.42, low: 0.29, close: 0.41, volume: 1650 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.41, high: 0.57, low: 0.4, close: 0.56, volume: 1710 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.56, high: 0.73, low: 0.55, close: 0.71, volume: 1740 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'down');
});

test('btc-eth-5m-aggressive widens ETH enough to fade a higher middle-zone stretch', async () => {
  const result = await loadStrategyResult('btc-eth-5m-aggressive', {
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.31, high: 0.35, low: 0.3, close: 0.34, volume: 1400 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.34, high: 0.41, low: 0.33, close: 0.4, volume: 1450 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.4, high: 0.47, low: 0.39, close: 0.46, volume: 1500 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.46, high: 0.53, low: 0.45, close: 0.52, volume: 1520 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.52, high: 0.59, low: 0.51, close: 0.58, volume: 1560 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.58, high: 0.63, low: 0.57, close: 0.62, volume: 1600 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 0.62, high: 0.64, low: 0.6, close: 0.63, volume: 1620 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'down');
});

test('btc-eth-5m-pair-model buys ETH up when ETH sits in the calibrated mid zone with a strong positive gap', async () => {
  const result = await loadStrategyResult('btc-eth-5m-pair-model', {
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.24, high: 0.27, low: 0.23, close: 0.25, volume: 1400 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.25, high: 0.29, low: 0.24, close: 0.28, volume: 1450 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.28, high: 0.33, low: 0.27, close: 0.31, volume: 1500 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.31, high: 0.36, low: 0.3, close: 0.35, volume: 1550 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 0.35, high: 0.41, low: 0.34, close: 0.4, volume: 1600 },
      ],
    },
    relatedMarkets: [
      {
        asset: 'BTC',
        symbol: 'BTC-USD-5M',
        timeframe: '5m',
        volume: 1600,
        timestamp: '2026-03-26T09:30:00.000Z',
        candles: [
          { timestamp: '2026-03-26T09:10:00.000Z', open: 0.89, high: 0.91, low: 0.88, close: 0.9, volume: 1400 },
          { timestamp: '2026-03-26T09:15:00.000Z', open: 0.9, high: 0.91, low: 0.84, close: 0.85, volume: 1450 },
          { timestamp: '2026-03-26T09:20:00.000Z', open: 0.85, high: 0.86, low: 0.79, close: 0.8, volume: 1500 },
          { timestamp: '2026-03-26T09:25:00.000Z', open: 0.8, high: 0.81, low: 0.64, close: 0.65, volume: 1550 },
          { timestamp: '2026-03-26T09:30:00.000Z', open: 0.65, high: 0.66, low: 0.19, close: 0.2, volume: 1600 },
        ],
      },
    ],
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'up');
});

test('btc-eth-5m-pair-model buys ETH down when ETH sits in the calibrated mid zone with a strong negative gap', async () => {
  const result = await loadStrategyResult('btc-eth-5m-pair-model', {
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.62, high: 0.63, low: 0.58, close: 0.6, volume: 1400 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.6, high: 0.61, low: 0.54, close: 0.56, volume: 1450 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.56, high: 0.57, low: 0.49, close: 0.5, volume: 1500 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.5, high: 0.51, low: 0.43, close: 0.44, volume: 1550 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 0.44, high: 0.45, low: 0.35, close: 0.36, volume: 1600 },
      ],
    },
    relatedMarkets: [
      {
        asset: 'BTC',
        symbol: 'BTC-USD-5M',
        timeframe: '5m',
        volume: 1600,
        timestamp: '2026-03-26T09:30:00.000Z',
        candles: [
          { timestamp: '2026-03-26T09:10:00.000Z', open: 0.12, high: 0.13, low: 0.11, close: 0.12, volume: 1400 },
          { timestamp: '2026-03-26T09:15:00.000Z', open: 0.12, high: 0.16, low: 0.11, close: 0.15, volume: 1450 },
          { timestamp: '2026-03-26T09:20:00.000Z', open: 0.15, high: 0.19, low: 0.14, close: 0.18, volume: 1500 },
          { timestamp: '2026-03-26T09:25:00.000Z', open: 0.18, high: 0.25, low: 0.17, close: 0.24, volume: 1550 },
          { timestamp: '2026-03-26T09:30:00.000Z', open: 0.24, high: 0.41, low: 0.23, close: 0.4, volume: 1600 },
        ],
      },
    ],
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'down');
});

test('btc-eth-5m-pair-model holds when the related market context is missing', async () => {
  const result = await loadStrategyResult('btc-eth-5m-pair-model', {
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.44, high: 0.46, low: 0.43, close: 0.45, volume: 1400 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.45, high: 0.47, low: 0.44, close: 0.46, volume: 1450 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.46, high: 0.48, low: 0.45, close: 0.47, volume: 1500 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.47, high: 0.49, low: 0.46, close: 0.48, volume: 1550 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 0.48, high: 0.64, low: 0.47, close: 0.62, volume: 1600 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
  assert.equal(result.decision.side, undefined);
});

test('true hedge state opens the trend pair when BTC cleanly leads inside the safer zone', async () => {
  const decision = await loadHedgeDecision('btc-eth-5m-true-hedge', [
    {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.71,
      volume: 1800,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T08:50:00.000Z', open: 0.21, high: 0.23, low: 0.2, close: 0.22, volume: 1500 },
        { timestamp: '2026-03-26T08:55:00.000Z', open: 0.22, high: 0.25, low: 0.21, close: 0.24, volume: 1520 },
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.24, high: 0.28, low: 0.23, close: 0.27, volume: 1550 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.27, high: 0.33, low: 0.26, close: 0.32, volume: 1580 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.32, high: 0.39, low: 0.31, close: 0.38, volume: 1610 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.38, high: 0.47, low: 0.37, close: 0.46, volume: 1660 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.46, high: 0.57, low: 0.45, close: 0.55, volume: 1710 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.55, high: 0.64, low: 0.54, close: 0.63, volume: 1760 },
      ],
    },
    {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      price: 0.16,
      volume: 1700,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T08:50:00.000Z', open: 0.28, high: 0.29, low: 0.26, close: 0.27, volume: 1450 },
        { timestamp: '2026-03-26T08:55:00.000Z', open: 0.27, high: 0.28, low: 0.25, close: 0.26, volume: 1460 },
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.26, high: 0.27, low: 0.24, close: 0.25, volume: 1480 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.25, high: 0.26, low: 0.23, close: 0.24, volume: 1500 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.24, high: 0.25, low: 0.22, close: 0.23, volume: 1530 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.23, high: 0.24, low: 0.21, close: 0.22, volume: 1560 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.22, high: 0.23, low: 0.2, close: 0.21, volume: 1600 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.21, high: 0.22, low: 0.19, close: 0.2, volume: 1640 },
      ],
    },
  ]);

  assert.equal(decision.action, 'hedge');
  assert.equal(decision.legs?.[0]?.asset, 'BTC');
  assert.equal(decision.legs?.[0]?.side, 'up');
  assert.equal(decision.legs?.[0]?.size, 35);
  assert.equal(decision.legs?.[1]?.asset, 'ETH');
  assert.equal(decision.legs?.[1]?.side, 'down');
  assert.equal(decision.legs?.[1]?.size, 35);
});

test('true hedge state now accepts a clean trend setup slightly above the older upper price ceiling', async () => {
  const decision = await loadHedgeDecision('btc-eth-5m-true-hedge', [
    {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.81,
      volume: 1800,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T08:50:00.000Z', open: 0.21, high: 0.23, low: 0.2, close: 0.22, volume: 1500 },
        { timestamp: '2026-03-26T08:55:00.000Z', open: 0.22, high: 0.25, low: 0.21, close: 0.24, volume: 1520 },
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.24, high: 0.28, low: 0.23, close: 0.27, volume: 1550 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.27, high: 0.33, low: 0.26, close: 0.32, volume: 1580 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.32, high: 0.39, low: 0.31, close: 0.38, volume: 1610 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.38, high: 0.47, low: 0.37, close: 0.46, volume: 1660 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.46, high: 0.57, low: 0.45, close: 0.55, volume: 1710 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.55, high: 0.64, low: 0.54, close: 0.63, volume: 1760 },
      ],
    },
    {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      price: 0.16,
      volume: 1700,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T08:50:00.000Z', open: 0.28, high: 0.29, low: 0.26, close: 0.27, volume: 1450 },
        { timestamp: '2026-03-26T08:55:00.000Z', open: 0.27, high: 0.28, low: 0.25, close: 0.26, volume: 1460 },
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.26, high: 0.27, low: 0.24, close: 0.25, volume: 1480 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.25, high: 0.26, low: 0.23, close: 0.24, volume: 1500 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.24, high: 0.25, low: 0.22, close: 0.23, volume: 1530 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.23, high: 0.24, low: 0.21, close: 0.22, volume: 1560 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.22, high: 0.23, low: 0.2, close: 0.21, volume: 1600 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.21, high: 0.22, low: 0.19, close: 0.2, volume: 1640 },
      ],
    },
  ]);

  assert.equal(decision.action, 'hedge');
  assert.equal(decision.legs?.[0]?.asset, 'BTC');
  assert.equal(decision.legs?.[0]?.side, 'up');
  assert.equal(decision.legs?.[0]?.size, 35);
  assert.equal(decision.legs?.[1]?.asset, 'ETH');
  assert.equal(decision.legs?.[1]?.side, 'down');
  assert.equal(decision.legs?.[1]?.size, 35);
});

test('true hedge state opens the revert pair when ETH is stretched but the latest move snaps back', async () => {
  const decision = await loadHedgeDecision('btc-eth-5m-true-hedge', [
    {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.32,
      volume: 1700,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T08:50:00.000Z', open: 0.62, high: 0.63, low: 0.58, close: 0.6, volume: 1450 },
        { timestamp: '2026-03-26T08:55:00.000Z', open: 0.6, high: 0.61, low: 0.55, close: 0.56, volume: 1460 },
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.56, high: 0.57, low: 0.5, close: 0.51, volume: 1490 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.51, high: 0.52, low: 0.45, close: 0.46, volume: 1510 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.46, high: 0.47, low: 0.39, close: 0.4, volume: 1540 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.4, high: 0.41, low: 0.33, close: 0.34, volume: 1580 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.34, high: 0.35, low: 0.28, close: 0.29, volume: 1620 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.29, high: 0.31, low: 0.27, close: 0.31, volume: 1650 },
      ],
    },
    {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      price: 0.74,
      volume: 1800,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T08:50:00.000Z', open: 0.25, high: 0.28, low: 0.24, close: 0.27, volume: 1500 },
        { timestamp: '2026-03-26T08:55:00.000Z', open: 0.27, high: 0.32, low: 0.26, close: 0.31, volume: 1520 },
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.31, high: 0.38, low: 0.3, close: 0.37, volume: 1540 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.37, high: 0.46, low: 0.36, close: 0.45, volume: 1570 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.45, high: 0.56, low: 0.44, close: 0.54, volume: 1600 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.54, high: 0.67, low: 0.53, close: 0.65, volume: 1640 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.65, high: 0.79, low: 0.64, close: 0.78, volume: 1700 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.78, high: 0.79, low: 0.63, close: 0.66, volume: 1750 },
      ],
    },
  ]);

  assert.equal(decision.action, 'hedge');
  assert.equal(decision.legs?.[0]?.asset, 'BTC');
  assert.equal(decision.legs?.[0]?.side, 'up');
  assert.equal(decision.legs?.[0]?.size, 35);
  assert.equal(decision.legs?.[1]?.asset, 'ETH');
  assert.equal(decision.legs?.[1]?.side, 'down');
  assert.equal(decision.legs?.[1]?.size, 35);
});

test('true hedge state now accepts a stretched revert setup slightly above the older upper price ceiling', async () => {
  const decision = await loadHedgeDecision('btc-eth-5m-true-hedge', [
    {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.32,
      volume: 1700,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T08:50:00.000Z', open: 0.62, high: 0.63, low: 0.58, close: 0.6, volume: 1450 },
        { timestamp: '2026-03-26T08:55:00.000Z', open: 0.6, high: 0.61, low: 0.55, close: 0.56, volume: 1460 },
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.56, high: 0.57, low: 0.5, close: 0.51, volume: 1490 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.51, high: 0.52, low: 0.45, close: 0.46, volume: 1510 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.46, high: 0.47, low: 0.39, close: 0.4, volume: 1540 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.4, high: 0.41, low: 0.33, close: 0.34, volume: 1580 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.34, high: 0.35, low: 0.28, close: 0.29, volume: 1620 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.29, high: 0.31, low: 0.27, close: 0.31, volume: 1650 },
      ],
    },
    {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      price: 0.81,
      volume: 1800,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T08:50:00.000Z', open: 0.25, high: 0.28, low: 0.24, close: 0.27, volume: 1500 },
        { timestamp: '2026-03-26T08:55:00.000Z', open: 0.27, high: 0.32, low: 0.26, close: 0.31, volume: 1520 },
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.31, high: 0.38, low: 0.3, close: 0.37, volume: 1540 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.37, high: 0.46, low: 0.36, close: 0.45, volume: 1570 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.45, high: 0.56, low: 0.44, close: 0.54, volume: 1600 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.54, high: 0.67, low: 0.53, close: 0.65, volume: 1640 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.65, high: 0.79, low: 0.64, close: 0.78, volume: 1700 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.78, high: 0.79, low: 0.63, close: 0.66, volume: 1750 },
      ],
    },
  ]);

  assert.equal(decision.action, 'hedge');
  assert.equal(decision.legs?.[0]?.asset, 'BTC');
  assert.equal(decision.legs?.[0]?.side, 'up');
  assert.equal(decision.legs?.[0]?.size, 35);
  assert.equal(decision.legs?.[1]?.asset, 'ETH');
  assert.equal(decision.legs?.[1]?.side, 'down');
  assert.equal(decision.legs?.[1]?.size, 35);
});

test('true hedge state holds when the recent BTC and ETH history is too mixed to trust', async () => {
  const decision = await loadHedgeDecision('btc-eth-5m-true-hedge', [
    {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.58,
      volume: 1700,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T08:50:00.000Z', open: 0.52, high: 0.58, low: 0.51, close: 0.57, volume: 1450 },
        { timestamp: '2026-03-26T08:55:00.000Z', open: 0.57, high: 0.58, low: 0.49, close: 0.5, volume: 1460 },
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.5, high: 0.56, low: 0.49, close: 0.55, volume: 1490 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.55, high: 0.56, low: 0.47, close: 0.48, volume: 1510 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.48, high: 0.54, low: 0.47, close: 0.53, volume: 1540 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.53, high: 0.54, low: 0.45, close: 0.46, volume: 1580 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.46, high: 0.53, low: 0.45, close: 0.52, volume: 1620 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.52, high: 0.53, low: 0.44, close: 0.45, volume: 1650 },
      ],
    },
    {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      price: 0.42,
      volume: 1750,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T08:50:00.000Z', open: 0.41, high: 0.47, low: 0.4, close: 0.46, volume: 1450 },
        { timestamp: '2026-03-26T08:55:00.000Z', open: 0.46, high: 0.47, low: 0.38, close: 0.39, volume: 1460 },
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.39, high: 0.45, low: 0.38, close: 0.44, volume: 1490 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.44, high: 0.45, low: 0.36, close: 0.37, volume: 1510 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.37, high: 0.43, low: 0.36, close: 0.42, volume: 1540 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.42, high: 0.43, low: 0.34, close: 0.35, volume: 1580 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.35, high: 0.41, low: 0.34, close: 0.4, volume: 1620 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.4, high: 0.41, low: 0.32, close: 0.33, volume: 1650 },
      ],
    },
  ]);

  assert.equal(decision.action, 'hold');
});

test('multi signal continuation buys up when BTC keeps carrying cleanly through the middle zone', async () => {
  const result = await loadMultiSignalResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.61,
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.34, high: 0.37, low: 0.33, close: 0.36, volume: 1500 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.36, high: 0.41, low: 0.35, close: 0.4, volume: 1540 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.4, high: 0.46, low: 0.39, close: 0.45, volume: 1580 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.45, high: 0.52, low: 0.44, close: 0.5, volume: 1610 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.5, high: 0.58, low: 0.49, close: 0.56, volume: 1660 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.56, high: 0.62, low: 0.55, close: 0.6, volume: 1710 },
      ],
    },
    relatedMarkets: [
      {
        asset: 'ETH',
        symbol: 'ETH-USD-5M',
        timeframe: '5m',
        price: 0.49,
        volume: 1600,
        timestamp: '2026-03-26T09:25:00.000Z',
        candles: [
          { timestamp: '2026-03-26T09:00:00.000Z', open: 0.44, high: 0.46, low: 0.43, close: 0.45, volume: 1450 },
          { timestamp: '2026-03-26T09:05:00.000Z', open: 0.45, high: 0.47, low: 0.44, close: 0.46, volume: 1480 },
          { timestamp: '2026-03-26T09:10:00.000Z', open: 0.46, high: 0.48, low: 0.45, close: 0.47, volume: 1500 },
          { timestamp: '2026-03-26T09:15:00.000Z', open: 0.47, high: 0.49, low: 0.46, close: 0.48, volume: 1530 },
          { timestamp: '2026-03-26T09:20:00.000Z', open: 0.48, high: 0.5, low: 0.47, close: 0.49, volume: 1560 },
          { timestamp: '2026-03-26T09:25:00.000Z', open: 0.49, high: 0.5, low: 0.48, close: 0.49, volume: 1600 },
        ],
      },
    ],
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'up');
});

test('multi signal reversion buys down when ETH looks stretched and starts fading back', async () => {
  const result = await loadMultiSignalResult({
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      price: 0.72,
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.3, high: 0.34, low: 0.29, close: 0.33, volume: 1500 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.33, high: 0.4, low: 0.32, close: 0.39, volume: 1550 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.39, high: 0.49, low: 0.38, close: 0.48, volume: 1600 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.48, high: 0.61, low: 0.47, close: 0.59, volume: 1660 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.59, high: 0.76, low: 0.58, close: 0.74, volume: 1720 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.74, high: 0.75, low: 0.68, close: 0.69, volume: 1770 },
      ],
    },
    relatedMarkets: [
      {
        asset: 'BTC',
        symbol: 'BTC-USD-5M',
        timeframe: '5m',
        price: 0.52,
        volume: 1650,
        timestamp: '2026-03-26T09:25:00.000Z',
        candles: [
          { timestamp: '2026-03-26T09:00:00.000Z', open: 0.44, high: 0.46, low: 0.43, close: 0.45, volume: 1450 },
          { timestamp: '2026-03-26T09:05:00.000Z', open: 0.45, high: 0.47, low: 0.44, close: 0.46, volume: 1480 },
          { timestamp: '2026-03-26T09:10:00.000Z', open: 0.46, high: 0.49, low: 0.45, close: 0.48, volume: 1510 },
          { timestamp: '2026-03-26T09:15:00.000Z', open: 0.48, high: 0.5, low: 0.47, close: 0.49, volume: 1540 },
          { timestamp: '2026-03-26T09:20:00.000Z', open: 0.49, high: 0.52, low: 0.48, close: 0.51, volume: 1590 },
          { timestamp: '2026-03-26T09:25:00.000Z', open: 0.51, high: 0.53, low: 0.5, close: 0.52, volume: 1650 },
        ],
      },
    ],
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'down');
});

test('multi signal replay model buys ETH down after an upper-band wobble that kept paying in backtests', async () => {
  const decision = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', {
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      price: 0.82,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.54, high: 0.57, low: 0.53, close: 0.55, volume: 1500 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.78, high: 0.84, low: 0.77, close: 0.83, volume: 1550 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.83, high: 0.86, low: 0.82, close: 0.85, volume: 1520 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.85, high: 0.86, low: 0.8, close: 0.81, volume: 1580 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.81, high: 0.87, low: 0.8, close: 0.86, volume: 1490 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.86, high: 0.87, low: 0.81, close: 0.82, volume: 1510 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(decision.action, 'buy');
  assert.equal(decision.side, 'down');
});

test('multi signal replay model skips the upper-band ETH wobble when the lead-in move was too weak', async () => {
  const decision = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', {
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      price: 0.82,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.76, high: 0.79, low: 0.75, close: 0.78, volume: 1500 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.78, high: 0.84, low: 0.77, close: 0.83, volume: 1550 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.83, high: 0.86, low: 0.82, close: 0.85, volume: 1520 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.85, high: 0.86, low: 0.8, close: 0.81, volume: 1580 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.81, high: 0.87, low: 0.8, close: 0.86, volume: 1490 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.86, high: 0.87, low: 0.81, close: 0.82, volume: 1510 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(decision.action, 'hold');
});

test('multi signal replay model keeps the stronger BTC upper-band slip that still deserves a downside entry', async () => {
  const decision = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', {
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.82,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.64, high: 0.65, low: 0.63, close: 0.64, volume: 1500 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.64, high: 0.65, low: 0.59, close: 0.6, volume: 1510 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.6, high: 0.61, low: 0.55, close: 0.56, volume: 1520 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.56, high: 0.57, low: 0.53, close: 0.54, volume: 1530 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.54, high: 0.69, low: 0.53, close: 0.68, volume: 1540 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.82, high: 0.83, low: 0.81, close: 0.82, volume: 1550 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(decision.action, 'buy');
  assert.equal(decision.side, 'down');
});

test('multi signal replay model skips the weaker BTC upper-band slip when the lead-in move was too soft', async () => {
  const decision = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', {
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.82,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.79, high: 0.8, low: 0.78, close: 0.79, volume: 1500 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.79, high: 0.8, low: 0.75, close: 0.76, volume: 1510 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.76, high: 0.77, low: 0.73, close: 0.74, volume: 1520 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.74, high: 0.75, low: 0.72, close: 0.73, volume: 1530 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.73, high: 0.79, low: 0.72, close: 0.78, volume: 1540 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.82, high: 0.83, low: 0.81, close: 0.82, volume: 1550 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(decision.action, 'hold');
});

test('multi signal sizes ordinary BTC continuation entries below the stronger BTC replay entries', async () => {
  const strongReplay = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', {
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.82,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.64, high: 0.65, low: 0.63, close: 0.64, volume: 1500 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.64, high: 0.65, low: 0.59, close: 0.6, volume: 1510 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.6, high: 0.61, low: 0.55, close: 0.56, volume: 1520 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.56, high: 0.57, low: 0.53, close: 0.54, volume: 1530 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.54, high: 0.69, low: 0.53, close: 0.68, volume: 1540 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.82, high: 0.83, low: 0.81, close: 0.82, volume: 1550 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  const ordinaryContinuation = await loadMultiSignalResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.61,
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.34, high: 0.37, low: 0.33, close: 0.36, volume: 1500 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.36, high: 0.41, low: 0.35, close: 0.4, volume: 1540 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.4, high: 0.46, low: 0.39, close: 0.45, volume: 1580 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.45, high: 0.51, low: 0.44, close: 0.5, volume: 1620 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.5, high: 0.57, low: 0.49, close: 0.56, volume: 1660 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.56, high: 0.63, low: 0.55, close: 0.62, volume: 1700 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(strongReplay.action, 'buy');
  assert.equal(ordinaryContinuation.decision.action, 'buy');
  assert.ok((ordinaryContinuation.decision.size ?? 0) < (strongReplay.size ?? 0));
});

test('multi signal skips a BTC up entry when the real yes-side ask is already too expensive', async () => {
  const decision = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', {
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.92,
      upPrice: 0.92,
      downPrice: 0.08,
      upAsk: 0.98,
      downAsk: 0.03,
      volume: 1700,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.34, high: 0.37, low: 0.33, close: 0.36, volume: 1500 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.36, high: 0.41, low: 0.35, close: 0.4, volume: 1540 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.4, high: 0.46, low: 0.39, close: 0.45, volume: 1580 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.45, high: 0.51, low: 0.44, close: 0.5, volume: 1620 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.5, high: 0.57, low: 0.49, close: 0.56, volume: 1660 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.56, high: 0.63, low: 0.55, close: 0.62, volume: 1700 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(decision.action, 'hold');
});

test('multi signal skips a BTC up entry when the real yes-side ask is too cheap to be worth the wipeout risk', async () => {
  const decision = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', {
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.04,
      upPrice: 0.04,
      downPrice: 0.96,
      upAsk: 0.02,
      downAsk: 0.98,
      volume: 1700,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.34, high: 0.37, low: 0.33, close: 0.36, volume: 1500 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.36, high: 0.41, low: 0.35, close: 0.4, volume: 1540 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.4, high: 0.46, low: 0.39, close: 0.45, volume: 1580 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.45, high: 0.51, low: 0.44, close: 0.5, volume: 1620 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.5, high: 0.57, low: 0.49, close: 0.56, volume: 1660 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.56, high: 0.63, low: 0.55, close: 0.62, volume: 1700 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(decision.action, 'hold');
});

test('multi signal relative value opens a paired trade when BTC and ETH diverge enough', async () => {
  const decision = await loadHedgeDecision('btc-eth-5m-multi-signal', [
    {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.66,
      volume: 1800,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T08:50:00.000Z', open: 0.28, high: 0.31, low: 0.27, close: 0.3, volume: 1500 },
        { timestamp: '2026-03-26T08:55:00.000Z', open: 0.3, high: 0.34, low: 0.29, close: 0.33, volume: 1520 },
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.33, high: 0.38, low: 0.32, close: 0.37, volume: 1550 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.37, high: 0.43, low: 0.36, close: 0.42, volume: 1580 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.42, high: 0.49, low: 0.41, close: 0.48, volume: 1610 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.48, high: 0.56, low: 0.47, close: 0.54, volume: 1660 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.54, high: 0.61, low: 0.53, close: 0.59, volume: 1710 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.59, high: 0.65, low: 0.58, close: 0.64, volume: 1760 },
      ],
    },
    {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      price: 0.36,
      volume: 1750,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T08:50:00.000Z', open: 0.44, high: 0.45, low: 0.41, close: 0.42, volume: 1450 },
        { timestamp: '2026-03-26T08:55:00.000Z', open: 0.42, high: 0.43, low: 0.39, close: 0.4, volume: 1470 },
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.4, high: 0.41, low: 0.37, close: 0.38, volume: 1490 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.38, high: 0.39, low: 0.35, close: 0.36, volume: 1510 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.36, high: 0.37, low: 0.33, close: 0.34, volume: 1540 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.34, high: 0.35, low: 0.31, close: 0.32, volume: 1580 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.32, high: 0.33, low: 0.29, close: 0.3, volume: 1630 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.3, high: 0.31, low: 0.27, close: 0.28, volume: 1690 },
      ],
    },
  ]);

  assert.equal(decision.action, 'hedge');
  assert.equal(decision.legs?.[0]?.asset, 'BTC');
  assert.equal(decision.legs?.[1]?.asset, 'ETH');
});

test('multi signal holds when BTC 5m history is too noisy to trust', async () => {
  const result = await loadMultiSignalResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.52,
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.49, high: 0.53, low: 0.48, close: 0.52, volume: 1500 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.52, high: 0.53, low: 0.47, close: 0.48, volume: 1520 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.48, high: 0.54, low: 0.47, close: 0.53, volume: 1550 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.53, high: 0.54, low: 0.46, close: 0.47, volume: 1580 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.47, high: 0.55, low: 0.46, close: 0.54, volume: 1610 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.54, high: 0.55, low: 0.45, close: 0.46, volume: 1660 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
});

test('multi signal holds when ETH volume is too thin', async () => {
  const result = await loadMultiSignalResult({
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      price: 0.57,
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.4, high: 0.44, low: 0.39, close: 0.43, volume: 200 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.43, high: 0.48, low: 0.42, close: 0.47, volume: 220 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.47, high: 0.52, low: 0.46, close: 0.51, volume: 240 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.51, high: 0.55, low: 0.5, close: 0.54, volume: 260 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.54, high: 0.58, low: 0.53, close: 0.57, volume: 280 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.57, high: 0.59, low: 0.55, close: 0.58, volume: 300 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
});

test('multi signal holds when BTC price is already too close to the upper extreme', async () => {
  const result = await loadMultiSignalResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.94,
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.54, high: 0.6, low: 0.53, close: 0.59, volume: 1500 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.59, high: 0.66, low: 0.58, close: 0.65, volume: 1540 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.65, high: 0.73, low: 0.64, close: 0.72, volume: 1580 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.72, high: 0.81, low: 0.71, close: 0.8, volume: 1620 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.8, high: 0.89, low: 0.79, close: 0.88, volume: 1670 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.88, high: 0.95, low: 0.87, close: 0.93, volume: 1720 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
});

test('multi signal buys BTC down after a mid-band pop-and-slip wobble when the downside entry still pays', async () => {
  const decision = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', {
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.55,
      upPrice: 0.46,
      downPrice: 0.54,
      volume: 2600,
      timestamp: '2026-03-26T09:35:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.62, high: 0.63, low: 0.6, close: 0.61, volume: 2200 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.61, high: 0.62, low: 0.58, close: 0.58, volume: 2250 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.58, high: 0.59, low: 0.55, close: 0.55, volume: 2300 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.55, high: 0.56, low: 0.52, close: 0.52, volume: 2350 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.52, high: 0.53, low: 0.49, close: 0.49, volume: 2400 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.49, high: 0.56, low: 0.48, close: 0.55, volume: 2450 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:35:00.000Z',
    },
  });

  assert.equal(decision.action, 'buy');
  assert.equal(decision.side, 'down');
});

test('multi signal buys BTC down after a lower-mid rebound rolls back over', async () => {
  const decision = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', {
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.43,
      upPrice: 0.35,
      downPrice: 0.65,
      volume: 2800,
      timestamp: '2026-03-26T09:35:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.34, high: 0.36, low: 0.33, close: 0.35, volume: 2200 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.35, high: 0.38, low: 0.34, close: 0.37, volume: 2300 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.37, high: 0.4, low: 0.36, close: 0.39, volume: 2400 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.39, high: 0.43, low: 0.38, close: 0.42, volume: 2500 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.42, high: 0.46, low: 0.41, close: 0.45, volume: 2600 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.45, high: 0.46, low: 0.42, close: 0.43, volume: 2700 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:35:00.000Z',
    },
  });

  assert.equal(decision.action, 'buy');
  assert.equal(decision.side, 'down');
});

test('multi signal skips a BTC replay-rescue down entry when the no-side quote is too cheap to trust', async () => {
  const decision = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', {
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.43,
      upPrice: 0.99,
      downPrice: 0.01,
      volume: 2800,
      timestamp: '2026-03-26T09:35:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.34, high: 0.36, low: 0.33, close: 0.35, volume: 2200 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.35, high: 0.38, low: 0.34, close: 0.37, volume: 2300 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.37, high: 0.4, low: 0.36, close: 0.39, volume: 2400 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.39, high: 0.43, low: 0.38, close: 0.42, volume: 2500 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.42, high: 0.46, low: 0.41, close: 0.45, volume: 2600 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.45, high: 0.46, low: 0.42, close: 0.43, volume: 2700 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:35:00.000Z',
    },
  });

  assert.equal(decision.action, 'hold');
});

test('btc-eth-5m buys ETH down when recent binary closes overextend higher in the entry zone', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.11, high: 0.13, low: 0.1, close: 0.12, volume: 1400 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.12, high: 0.19, low: 0.11, close: 0.18, volume: 1450 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.18, high: 0.25, low: 0.17, close: 0.24, volume: 1500 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.24, high: 0.31, low: 0.23, close: 0.3, volume: 1520 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.3, high: 0.37, low: 0.29, close: 0.36, volume: 1560 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.36, high: 0.43, low: 0.35, close: 0.42, volume: 1600 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 0.42, high: 0.45, low: 0.4, close: 0.44, volume: 1620 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'down');
});

test('btc-eth-5m still buys ETH down near the top of the allowed entry zone', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.24, high: 0.29, low: 0.23, close: 0.28, volume: 1400 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.28, high: 0.35, low: 0.27, close: 0.34, volume: 1450 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.34, high: 0.41, low: 0.33, close: 0.4, volume: 1500 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.4, high: 0.47, low: 0.39, close: 0.46, volume: 1520 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.46, high: 0.53, low: 0.45, close: 0.52, volume: 1560 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.52, high: 0.57, low: 0.51, close: 0.56, volume: 1600 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 0.56, high: 0.59, low: 0.55, close: 0.58, volume: 1620 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'down');
});

test('btc-eth-5m buys ETH up when recent binary closes overextend lower in the entry zone', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:00:00.000Z', open: 0.56, high: 0.57, low: 0.51, close: 0.52, volume: 1400 },
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.52, high: 0.53, low: 0.45, close: 0.46, volume: 1450 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.46, high: 0.47, low: 0.39, close: 0.4, volume: 1500 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.4, high: 0.41, low: 0.33, close: 0.34, volume: 1520 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.34, high: 0.35, low: 0.27, close: 0.28, volume: 1560 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.28, high: 0.29, low: 0.21, close: 0.22, volume: 1600 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 0.22, high: 0.45, low: 0.21, close: 0.44, volume: 1620 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'up');
});

test('btc-eth-5m skips a binary setup when there is not enough consistent history behind it', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:05:00.000Z', open: 0.3, high: 0.35, low: 0.29, close: 0.34, volume: 1600 },
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.34, high: 0.38, low: 0.33, close: 0.37, volume: 1620 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.37, high: 0.38, low: 0.34, close: 0.35, volume: 1650 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.35, high: 0.41, low: 0.34, close: 0.4, volume: 1710 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.4, high: 0.46, low: 0.39, close: 0.45, volume: 1740 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
  assert.equal(result.decision.side, undefined);
});

test('btc-eth-5m holds on unsupported asset', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'SOL',
      symbol: 'SOL-USD',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 99, high: 100.2, low: 98.9, close: 99.8, volume: 1100 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 99.8, high: 101.2, low: 99.7, close: 100.9, volume: 1250 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 100.9, high: 102.3, low: 100.8, close: 102.1, volume: 1380 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 102.1, high: 103.2, low: 102, close: 103.1, volume: 1410 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 103.1, high: 104.5, low: 103, close: 104.3, volume: 1490 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
  assert.equal(result.decision.side, undefined);
});

test('btc-eth-5m holds on unsupported timeframe', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD',
      timeframe: '1h',
      candles: [
        { timestamp: '2026-03-26T08:10:00.000Z', open: 99, high: 100.2, low: 98.9, close: 99.8, volume: 1100 },
        { timestamp: '2026-03-26T08:15:00.000Z', open: 99.8, high: 101.2, low: 99.7, close: 100.9, volume: 1250 },
        { timestamp: '2026-03-26T08:20:00.000Z', open: 100.9, high: 102.3, low: 100.8, close: 102.1, volume: 1380 },
        { timestamp: '2026-03-26T08:25:00.000Z', open: 102.1, high: 103.2, low: 102, close: 103.1, volume: 1410 },
        { timestamp: '2026-03-26T08:30:00.000Z', open: 103.1, high: 104.5, low: 103, close: 104.3, volume: 1490 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
  assert.equal(result.decision.side, undefined);
});

test('btc-eth-5m holds when there are insufficient candles', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:20:00.000Z', open: 100.9, high: 101.5, low: 100.8, close: 101.2, volume: 1380 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 101.2, high: 102.1, low: 101, close: 101.9, volume: 1490 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
  assert.equal(result.decision.side, undefined);
});

test('btc-eth-5m holds while already in a position', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 99, high: 100.2, low: 98.9, close: 99.8, volume: 1100 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 99.8, high: 101.2, low: 99.7, close: 100.9, volume: 1250 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 100.9, high: 102.3, low: 100.8, close: 102.1, volume: 1380 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 102.1, high: 103.2, low: 102, close: 103.1, volume: 1410 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 103.1, high: 104.5, low: 103, close: 104.3, volume: 1490 },
      ],
    },
    position: {
      side: 'long',
      size: 25,
      entryPrice: 101,
    },
    balance: 1000,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
  assert.equal(result.decision.side, undefined);
});

test('btc-eth-5m holds when the account is too small to open a new position', async () => {
  const result = await loadBtcEth5mResult({
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 0.78, high: 0.92, low: 0.76, close: 0.9, volume: 1600 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 0.9, high: 0.92, low: 0.83, close: 0.85, volume: 1650 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 0.85, high: 0.95, low: 0.84, close: 0.93, volume: 1710 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 0.93, high: 0.94, low: 0.88, close: 0.89, volume: 1680 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 0.89, high: 0.99, low: 0.88, close: 0.98, volume: 1740 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 0.01,
    clock: {
      now: '2026-03-26T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
  assert.equal(result.decision.side, undefined);
});

test('runStrategyById executes btc-eth-5m on candle-rich config and returns a buy decision', async () => {
  const config = loadBotlabConfig(path.resolve(process.cwd(), 'botlab/config/example.config.json'), process.cwd());

  const result = await runStrategyById('btc-eth-5m', config);

  assert.equal(result.strategy.id, 'btc-eth-5m');
  assert.equal(result.decision.action, 'buy');
  assert.match(result.renderedOutput, /ACTION:\s*buy/);
});

test('loadBacktestRows parses polymarket csv rows and preserves outcome data', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const testFileDir = path.dirname(fileURLToPath(import.meta.url));
  const csvPath = path.resolve(testFileDir, '..', 'data', 'polymarket-sample.csv');
  const rows = loadBacktestRows(csvPath);

  assert.equal(rows.length > 5, true);
  assert.equal(rows[0]?.market, 'BTC-USD-5M');
  assert.equal(typeof rows[0]?.upPrice, 'number');
  assert.equal(rows.at(-1)?.outcome, 'up');
});

test('loadBacktestRows parses optional bid and ask columns when they are present', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-backtest-'));
  const csvPath = path.join(tempDir, 'with-book.csv');

  fs.writeFileSync(
    csvPath,
    [
      'timestamp,market,timeframe,up_price,down_price,up_bid,up_ask,down_bid,down_ask,volume,outcome',
      '2026-03-26T09:00:00.000Z,BTC-USD-5M,5m,0.41,0.59,0.40,0.42,0.58,0.60,1200,up',
    ].join('\n'),
  );

  const rows = loadBacktestRows(csvPath);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.upBid, 0.4);
  assert.equal(rows[0]?.upAsk, 0.42);
  assert.equal(rows[0]?.downBid, 0.58);
  assert.equal(rows[0]?.downAsk, 0.6);
});

test('loadBacktestRows rejects missing numeric values instead of treating them as zero', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-backtest-'));
  const csvPath = path.join(tempDir, 'missing-volume.csv');

  fs.writeFileSync(
    csvPath,
    [
      'timestamp,market,timeframe,up_price,down_price,volume,outcome',
      '2026-03-26T09:00:00.000Z,BTC-USD-5M,5m,0.41,0.59,,up',
    ].join('\n'),
  );

  assert.throws(
    () => loadBacktestRows(csvPath),
    /Invalid number for volume|Missing required numeric value for volume/,
  );
});

test('loadBacktestRows normalizes NaN volume values to zero for real polymarket exports', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-backtest-'));
  const csvPath = path.join(tempDir, 'nan-volume.csv');

  fs.writeFileSync(
    csvPath,
    [
      'timestamp,market,timeframe,up_price,down_price,volume,outcome',
      '2026-03-26T09:00:00.000Z,BTC-USD-5M,5m,0.41,0.59,NaN,up',
    ].join('\n'),
  );

  const rows = loadBacktestRows(csvPath);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.volume, 0);
  assert.equal(rows[0]?.upPrice, 0.41);
  assert.equal(rows[0]?.downPrice, 0.59);
  assert.equal(rows[0]?.outcome, 'up');
});

test('loadBacktestRows rejects CSV headers that omit volume', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-backtest-'));
  const csvPath = path.join(tempDir, 'missing-volume-header.csv');

  fs.writeFileSync(
    csvPath,
    [
      'timestamp,market,timeframe,up_price,down_price,outcome',
      '2026-03-26T09:00:00.000Z,BTC-USD-5M,5m,0.41,0.59,up',
    ].join('\n'),
  );

  assert.throws(
    () => loadBacktestRows(csvPath),
    /Missing required CSV column: volume/,
  );
});

test('loadBacktestRows rejects unsupported outcome values', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-backtest-'));
  const csvPath = path.join(tempDir, 'bad-outcome.csv');

  fs.writeFileSync(
    csvPath,
    [
      'timestamp,market,timeframe,up_price,down_price,volume,outcome',
      '2026-03-26T09:00:00.000Z,BTC-USD-5M,5m,0.41,0.59,1200,sideways',
    ].join('\n'),
  );

  assert.throws(
    () => loadBacktestRows(csvPath),
    /Invalid outcome value: sideways/,
  );
});

test('loadBacktestRows rejects negative volume values', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-backtest-'));
  const csvPath = path.join(tempDir, 'negative-volume.csv');

  fs.writeFileSync(
    csvPath,
    [
      'timestamp,market,timeframe,up_price,down_price,volume,outcome',
      '2026-03-26T09:00:00.000Z,BTC-USD-5M,5m,0.41,0.59,-1,up',
    ].join('\n'),
  );

  assert.throws(
    () => loadBacktestRows(csvPath),
    /volume must be non-negative|Invalid number for volume/,
  );
});

test('runBacktest replays the sample market and returns equity, trades, fees, and settlement', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const { runBacktest } = await import('../backtest/engine.js');
  const rows = loadBacktestRows(path.resolve(process.cwd(), 'botlab/data/polymarket-sample.csv'));
  const strategyDir = writeTempFixedBuyStrategy();
  const result = await runBacktest({
    strategyId: 'fixed-buy',
    strategyDir,
    startingBalance: 1000,
    signalSide: 'up',
    slippage: 0.01,
    feeModel: 'polymarket-2026-03-26',
    rows,
  });

  assert.equal(result.summary.tradeCount, 1);
  assert.equal(result.summary.winCount, 1);
  assert.equal(result.summary.lossCount, 0);
  assert.equal(result.summary.feeTotal > 0, true);
  assert.equal(result.summary.endingEquity > 1000, true);
  assert.equal(result.summary.returnPct > 0, true);
  assert.equal(result.summary.maxDrawdownPct >= 0, true);
  assert.equal(result.equityCurve.length, rows.length);
  assert.equal(result.summary.settled, true);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0]?.side, 'up');
  assert.equal(result.trades[0]?.entryTimestamp, '2026-03-26T09:00:00.000Z');
  assert.equal(result.trades[0]?.exitTimestamp, '2026-03-26T09:30:00.000Z');
  assertCloseTo(result.trades[0]?.entryPrice ?? 0, 0.46);
  assertCloseTo(result.trades[0]?.exitPrice ?? 0, 1);
  assert.equal((result.trades[0]?.shares ?? 0) > 0, true);
  assert.equal((result.trades[0]?.feesPaid ?? 0) > 0, true);
  assert.equal((result.trades[0]?.realizedPnl ?? 0) > 0, true);
});

test('runBacktest sizes the bundled sample buy from the strategy budget instead of spending nearly all cash', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const { runBacktest } = await import('../backtest/engine.js');
  const rows = loadBacktestRows(path.resolve(process.cwd(), 'botlab/data/polymarket-sample.csv'));
  const strategyDir = writeTempFixedBuyStrategy();

  const result = await runBacktest({
    strategyId: 'fixed-buy',
    strategyDir,
    startingBalance: 1000,
    signalSide: 'up',
    slippage: 0.01,
    feeModel: 'polymarket-2026-03-26',
    rows,
  });

  assert.equal(result.trades.length, 1);
  assert.equal((result.trades[0]?.shares ?? 0) * (result.trades[0]?.entryPrice ?? 0) < 100, true);
  assert.equal(result.summary.feeTotal > 0, true);
  assert.equal(result.summary.endingEquity > 1000, true);
});

test('runBacktest reports drawdown and winning trades after settlement', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const { runBacktest } = await import('../backtest/engine.js');
  const rows = loadBacktestRows(path.resolve(process.cwd(), 'botlab/data/polymarket-sample.csv'));
  const strategyDir = writeTempFixedBuyStrategy();
  const result = await runBacktest({
    strategyId:'fixed-buy',
    strategyDir,
    startingBalance:1000,
    signalSide:'up',
    slippage:0.01,
    feeModel:'polymarket-2026-03-26',
    rows,
  });

  assert.equal(result.summary.maxDrawdownPct >= 0, true);
  assert.equal(result.summary.winCount >= 1, true);
});

test('runBacktest settles the bundled sample cleanly for the down side', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const { runBacktest } = await import('../backtest/engine.js');
  const rows = loadBacktestRows(path.resolve(process.cwd(), 'botlab/data/polymarket-sample.csv'));
  const strategyDir = writeTempFixedBuyStrategy();
  const result = await runBacktest({
    strategyId: 'fixed-buy',
    strategyDir,
    startingBalance: 1000,
    signalSide: 'down',
    slippage: 0.01,
    feeModel: 'polymarket-2026-03-26',
    rows,
  });

  assert.equal(result.summary.tradeCount, 1);
  assert.equal(result.summary.winCount, 0);
  assert.equal(result.summary.lossCount, 1);
  assert.equal(result.summary.feeTotal > 0, true);
  assert.equal(result.summary.endingEquity < 1000, true);
  assert.equal(result.summary.returnPct < 0, true);
  assert.equal(result.summary.maxDrawdownPct > 0, true);
  assert.equal(result.summary.settled, true);
  assert.equal(result.trades.length, 1);
});

test('runBacktest reserves entry fees so cash never goes negative after a buy', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const { runBacktest } = await import('../backtest/engine.js');
  const rows = loadBacktestRows(path.resolve(process.cwd(), 'botlab/data/polymarket-sample.csv'));

  const result = await runBacktest({
    strategyId: 'btc-eth-5m',
    strategyDir: path.resolve(process.cwd(), 'botlab/strategies'),
    startingBalance: 1000,
    signalSide: 'up',
    slippage: 0.01,
    feeModel: 'polymarket-2026-03-26',
    rows,
  });

  assert.equal(result.equityCurve.every((point) => point.cash >= 0), true);
});

test('runBacktest stores full per-trade fees and realized pnl after open and close fees', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const { runBacktest } = await import('../backtest/engine.js');
  const rows = loadBacktestRows(path.resolve(process.cwd(), 'botlab/data/polymarket-sample.csv'));
  const strategyDir = writeTempFixedBuyStrategy();

  const result = await runBacktest({
    strategyId: 'fixed-buy',
    strategyDir,
    startingBalance: 1000,
    signalSide: 'up',
    slippage: 0.01,
    feeModel: 'flat',
    rows,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0]?.feesPaid, result.summary.feeTotal);
  assert.equal(
    Math.abs((result.trades[0]?.realizedPnl ?? 0) - (result.summary.endingEquity - 1000)) < 1e-9,
    true,
  );
});

test('runBacktest settles an open position on the final outcome row before honoring a sell signal', async () => {
  const { runBacktest } = await import('../backtest/engine.js');
  const strategyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-strategy-'));
  const strategyPath = path.join(strategyDir, 'settlement-priority.strategy.ts');

  fs.writeFileSync(
    strategyPath,
    [
      'export const strategy = {',
      "  id: 'settlement-priority',",
      "  name: 'Settlement Priority',",
      "  description: 'Buys once and emits a sell on the final row.',",
      '  defaults: {},',
      '  evaluate(context) {',
      "    if (context.position.side === 'flat') {",
      "      return { action: 'buy', size: 50, reason: 'open a small test position' };",
      '    }',
      "    if (context.clock.now === '2026-03-26T09:10:00.000Z') {",
      "      return { action: 'sell', size: context.position.size, reason: 'final row sell signal' };",
      '    }',
      "    return { action: 'hold', reason: 'wait for the final row' };",
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  const rows = [
    {
      timestamp: '2026-03-26T09:00:00.000Z',
      market: 'BTC-USD-5M',
      timeframe: '5m',
      upPrice: 0.5,
      downPrice: 0.5,
      volume: 100,
    },
    {
      timestamp: '2026-03-26T09:05:00.000Z',
      market: 'BTC-USD-5M',
      timeframe: '5m',
      upPrice: 0.6,
      downPrice: 0.4,
      volume: 100,
    },
    {
      timestamp: '2026-03-26T09:10:00.000Z',
      market: 'BTC-USD-5M',
      timeframe: '5m',
      upPrice: 0.8,
      downPrice: 0.2,
      volume: 100,
      outcome: 'up' as const,
    },
  ];

  const result = await runBacktest({
    strategyId: 'settlement-priority',
    strategyDir,
    startingBalance: 100,
    signalSide: 'up',
    slippage: 0.01,
    feeModel: 'flat',
    rows,
  });

  assert.equal(result.summary.tradeCount, 1);
  assert.equal(result.summary.settled, true);
  assert.equal(result.summary.endingEquity, 146.093794);
  assert.deepEqual(result.trades[0], {
    side: 'up',
    entryTimestamp: '2026-03-26T09:00:00.000Z',
    exitTimestamp: '2026-03-26T09:10:00.000Z',
    entryPrice: 0.51,
    exitPrice: 1,
    shares: 97.06,
    feesPaid: 1.465606,
    realizedPnl: 46.09379400000001,
  });
});

test('runBatchBacktest settles mixed up and down trades using same-asset history only', async () => {
  const { runBatchBacktest } = await import('../backtest/batch-engine.js');
  const strategyDir = writeTempBatchStrategy();

  const result = await runBatchBacktest({
    strategyId: 'batch-directional',
    strategyDir,
    startingBalance: 1000,
    slippage: 0.01,
    feeModel: 'flat',
    rows: makeBatchRows(),
  });

  assert.equal(result.trades.length, 3);
  assert.equal(result.trades[0]?.side, 'up');
  assert.equal(result.trades[1]?.side, 'down');
  assert.equal(result.trades[2]?.side, 'down');
  assert.equal(result.trades[0]?.entryPrice, 0.41);
  assert.equal(result.trades[1]?.entryPrice, 0.31);
  assert.equal(result.trades[2]?.entryPrice, 0.66);
});

test('runBatchBacktest skips rows when the strategy holds', async () => {
  const { runBatchBacktest } = await import('../backtest/batch-engine.js');
  const strategyDir = writeTempBatchStrategy();

  const result = await runBatchBacktest({
    strategyId: 'batch-directional',
    strategyDir,
    startingBalance: 1000,
    slippage: 0.01,
    feeModel: 'flat',
    rows: makeBatchRows(),
  });

  assert.equal(result.summary.skippedCount, 2);
  assert.equal(result.summary.tradeCount, 3);
  assert.equal(result.equityCurve.length, 5);
});

test('runBatchBacktest only lets the strategy react on the next row instead of the same row', async () => {
  const { runBatchBacktest } = await import('../backtest/batch-engine.js');
  const strategyDir = writeTempPriceStrategy();

  const result = await runBatchBacktest({
    strategyId: 'batch-price',
    strategyDir,
    startingBalance: 1000,
    slippage: 0.01,
    feeModel: 'flat',
    rows: [
      {
        timestamp: '2026-03-26T09:00:00.000Z',
        market: 'BTC-USD-5M',
        timeframe: '5m',
        upPrice: 0.4,
        downPrice: 0.6,
        upBid: 0.39,
        upAsk: 0.41,
        downBid: 0.59,
        downAsk: 0.61,
        volume: 100,
        outcome: 'up' as const,
      },
      {
        timestamp: '2026-03-26T09:05:00.000Z',
        market: 'BTC-USD-5M',
        timeframe: '5m',
        upPrice: 0.8,
        downPrice: 0.2,
        upBid: 0.79,
        upAsk: 0.81,
        downBid: 0.19,
        downAsk: 0.21,
        volume: 100,
        outcome: 'up' as const,
      },
      {
        timestamp: '2026-03-26T09:10:00.000Z',
        market: 'BTC-USD-5M',
        timeframe: '5m',
        upPrice: 0.3,
        downPrice: 0.7,
        upBid: 0.29,
        upAsk: 0.31,
        downBid: 0.69,
        downAsk: 0.71,
        volume: 100,
        outcome: 'up' as const,
      },
    ],
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0]?.entryTimestamp, '2026-03-26T09:10:00.000Z');
  assert.equal(result.trades[0]?.entryPrice, 0.32);
  assert.equal(result.summary.tradeCount, 1);
});

test('runBatchBacktest only exposes prior related-market history from earlier timestamps', async () => {
  const { runBatchBacktest } = await import('../backtest/batch-engine.js');
  const strategyDir = writeTempRelatedMarketStrategy();

  const result = await runBatchBacktest({
    strategyId: 'batch-related-market',
    strategyDir,
    startingBalance: 1000,
    slippage: 0.01,
    feeModel: 'flat',
    rows: [
      {
        timestamp: '2026-03-26T09:00:00.000Z',
        market: 'BTC-USD-5M',
        timeframe: '5m',
        upPrice: 0.4,
        downPrice: 0.6,
        volume: 100,
        outcome: 'up' as const,
      },
      {
        timestamp: '2026-03-26T09:00:00.000Z',
        market: 'ETH-USD-5M',
        timeframe: '5m',
        upPrice: 0.8,
        downPrice: 0.2,
        volume: 100,
        outcome: 'up' as const,
      },
      {
        timestamp: '2026-03-26T09:05:00.000Z',
        market: 'BTC-USD-5M',
        timeframe: '5m',
        upPrice: 0.45,
        downPrice: 0.55,
        volume: 100,
        outcome: 'up' as const,
      },
      {
        timestamp: '2026-03-26T09:05:00.000Z',
        market: 'ETH-USD-5M',
        timeframe: '5m',
        upPrice: 0.35,
        downPrice: 0.65,
        volume: 100,
        outcome: 'down' as const,
      },
    ],
  });

  assert.equal(result.summary.tradeCount, 2);
  assert.equal(result.summary.skippedCount, 2);
  assert.equal(result.trades[0]?.entryTimestamp, '2026-03-26T09:05:00.000Z');
  assert.equal(result.trades[0]?.side, 'up');
  assert.equal(result.trades[1]?.entryTimestamp, '2026-03-26T09:05:00.000Z');
  assert.equal(result.trades[1]?.side, 'down');
});

test('runHedgeBacktest settles both legs from one timestamp group', async () => {
  const { runHedgeBacktest } = await import('../backtest/hedge-engine.js');
  const strategyDir = writeTempHedgeStrategy();

  const result = await runHedgeBacktest({
    strategyId: 'test-hedge',
    strategyDir,
    startingBalance: 1000,
    slippage: 0,
    feeModel: 'flat',
    rows: [
      {
        timestamp: '2026-03-26T09:00:00.000Z',
        market: 'BTC-USD-5M',
        timeframe: '5m',
        upPrice: 0.62,
        downPrice: 0.38,
        volume: 1200,
        outcome: 'up' as const,
      },
      {
        timestamp: '2026-03-26T09:00:00.000Z',
        market: 'ETH-USD-5M',
        timeframe: '5m',
        upPrice: 0.41,
        downPrice: 0.59,
        volume: 1250,
        outcome: 'down' as const,
      },
    ],
  });

  assert.equal(result.summary.tradeCount, 1);
  assert.equal(result.summary.legCount, 2);
  assert.equal(result.summary.winCount, 2);
  assert.equal(result.summary.lossCount, 0);
});

test('analyzeHedgeCommand prints stability slices and trimmed return', async () => {
  const { analyzeHedgeCommand } = await import('../commands/analyze-hedge.js');
  const config = loadBotlabConfig(undefined, process.cwd());

  const output = await analyzeHedgeCommand(
    'btc-eth-5m-true-hedge',
    'botlab/data/polymarket-btc-eth-5m-last-month.csv',
    config,
  );

  assert.match(output, /Stability Check/);
  assert.match(output, /Trimmed Return/);
  assert.match(output, /Monthly Slices/);
});

test('runBacktest uses the ask price instead of the display price when book data is available', async () => {
  const { runBacktest } = await import('../backtest/engine.js');
  const rows = [
    {
      timestamp: '2026-03-26T09:00:00.000Z',
      market: 'BTC-USD-5M',
      timeframe: '5m',
      upPrice: 0.4,
      downPrice: 0.6,
      upBid: 0.39,
      upAsk: 0.42,
      downBid: 0.58,
      downAsk: 0.61,
      volume: 100,
    },
    {
      timestamp: '2026-03-26T09:05:00.000Z',
      market: 'BTC-USD-5M',
      timeframe: '5m',
      upPrice: 0.8,
      downPrice: 0.2,
      upBid: 0.79,
      upAsk: 0.81,
      downBid: 0.19,
      downAsk: 0.21,
      volume: 100,
      outcome: 'up' as const,
    },
  ];

  const result = await runBacktest({
    strategyId: 'example-momentum',
    strategyDir: path.resolve(process.cwd(), 'botlab/strategies'),
    startingBalance: 1000,
    signalSide: 'up',
    slippage: 0.01,
    feeModel: 'flat',
    rows,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0]?.entryPrice, 0.82);
});

test('runBatchBacktest rejects rows that go backwards in time for the same asset', async () => {
  const { runBatchBacktest } = await import('../backtest/batch-engine.js');
  const strategyDir = writeTempPriceStrategy();

  await assert.rejects(
    () => runBatchBacktest({
      strategyId: 'batch-price',
      strategyDir,
      startingBalance: 1000,
      slippage: 0.01,
      feeModel: 'flat',
      rows: [
        {
          timestamp: '2026-03-26T09:05:00.000Z',
          market: 'BTC-USD-5M',
          timeframe: '5m',
          upPrice: 0.4,
          downPrice: 0.6,
          volume: 100,
          outcome: 'up' as const,
        },
        {
          timestamp: '2026-03-26T09:00:00.000Z',
          market: 'BTC-USD-5M',
          timeframe: '5m',
          upPrice: 0.8,
          downPrice: 0.2,
          volume: 100,
          outcome: 'up' as const,
        },
      ],
    }),
    /chronological order/i,
  );
});

test('runBatchBacktest rejects same-asset rows with the same timestamp', async () => {
  const { runBatchBacktest } = await import('../backtest/batch-engine.js');
  const strategyDir = writeTempPriceStrategy();

  await assert.rejects(
    () => runBatchBacktest({
      strategyId: 'batch-price',
      strategyDir,
      startingBalance: 1000,
      slippage: 0.01,
      feeModel: 'flat',
      rows: makeDuplicateTimestampRows(),
    }),
    /same timestamp|chronological order/i,
  );
});

test('runBatchBacktest rejects non-positive and non-finite strategy sizes', async () => {
  const { runBatchBacktest } = await import('../backtest/batch-engine.js');
  const zeroStrategyDir = writeTempInvalidSizeStrategy('zero');
  const nanStrategyDir = writeTempInvalidSizeStrategy('nan');
  const infiniteStrategyDir = writeTempInvalidSizeStrategy('infinite');
  const rows = [
    {
      timestamp: '2026-03-26T09:00:00.000Z',
      market: 'BTC-USD-5M',
      timeframe: '5m',
      upPrice: 0.8,
      downPrice: 0.2,
      volume: 100,
      outcome: 'up' as const,
    },
  ];

  await assert.rejects(
    () => runBatchBacktest({
      strategyId: 'batch-invalid-size-zero',
      strategyDir: zeroStrategyDir,
      startingBalance: 1000,
      slippage: 0.01,
      feeModel: 'flat',
      rows,
    }),
    /invalid size/i,
  );

  await assert.rejects(
    () => runBatchBacktest({
      strategyId: 'batch-invalid-size-nan',
      strategyDir: nanStrategyDir,
      startingBalance: 1000,
      slippage: 0.01,
      feeModel: 'flat',
      rows,
    }),
    /invalid size/i,
  );

  await assert.rejects(
    () => runBatchBacktest({
      strategyId: 'batch-invalid-size-infinite',
      strategyDir: infiniteStrategyDir,
      startingBalance: 1000,
      slippage: 0.01,
      feeModel: 'flat',
      rows,
    }),
    /invalid size/i,
  );
});

test('runBatchBacktest does not let a strategy mutation leak into later rows', async () => {
  const { runBatchBacktest } = await import('../backtest/batch-engine.js');
  const strategyDir = writeTempHistoryMutationStrategy();
  const result = await runBatchBacktest({
    strategyId: 'batch-history-mutation',
    strategyDir,
    startingBalance: 1000,
    slippage: 0.01,
    feeModel: 'flat',
    rows: [
      {
        timestamp: '2026-03-26T09:00:00.000Z',
        market: 'BTC-USD-5M',
        timeframe: '5m',
        upPrice: 0.4,
        downPrice: 0.6,
        volume: 100,
        outcome: 'up' as const,
      },
      {
        timestamp: '2026-03-26T09:05:00.000Z',
        market: 'BTC-USD-5M',
        timeframe: '5m',
        upPrice: 0.8,
        downPrice: 0.2,
        volume: 100,
        outcome: 'up' as const,
      },
    ],
  });

  assert.equal(result.summary.tradeCount, 0);
  assert.equal(result.summary.skippedCount, 2);
});

test('runBatchBacktest rejects sell decisions in batch mode', async () => {
  const { runBatchBacktest } = await import('../backtest/batch-engine.js');
  const strategyDir = writeTempSellStrategy();

  await assert.rejects(
    () => runBatchBacktest({
      strategyId: 'batch-sell',
      strategyDir,
      startingBalance: 1000,
      slippage: 0.01,
      feeModel: 'flat',
      rows: [
        {
          timestamp: '2026-03-26T09:00:00.000Z',
          market: 'BTC-USD-5M',
          timeframe: '5m',
          upPrice: 0.8,
          downPrice: 0.2,
          volume: 100,
          outcome: 'up' as const,
        },
      ],
    }),
    /sell/i,
  );
});

test('runBatchBacktest reports trade, skip, win, and loss counts in the summary', async () => {
  const { runBatchBacktest } = await import('../backtest/batch-engine.js');
  const strategyDir = writeTempBatchStrategy();

  const result = await runBatchBacktest({
    strategyId: 'batch-directional',
    strategyDir,
    startingBalance: 1000,
    slippage: 0.01,
    feeModel: 'flat',
    rows: makeBatchRows(),
  });

  assert.deepEqual(
    {
      tradeCount: result.summary.tradeCount,
      upTradeCount: result.summary.upTradeCount,
      downTradeCount: result.summary.downTradeCount,
      skippedCount: result.summary.skippedCount,
      winCount: result.summary.winCount,
      lossCount: result.summary.lossCount,
      settled: result.summary.settled,
    },
    {
      tradeCount: 3,
      upTradeCount: 1,
      downTradeCount: 2,
      skippedCount: 2,
      winCount: 2,
      lossCount: 1,
      settled: true,
    },
  );
});

test('runBatchBacktest fails clearly when a row is missing outcome', async () => {
  const { runBatchBacktest } = await import('../backtest/batch-engine.js');
  const strategyDir = writeTempBatchStrategy();

  await assert.rejects(
    () => runBatchBacktest({
      strategyId: 'batch-directional',
      strategyDir,
      startingBalance: 1000,
      slippage: 0.01,
      feeModel: 'flat',
      rows: [
        {
          timestamp: '2026-03-26T09:00:00.000Z',
          market: 'BTC-USD-5M',
          timeframe: '5m',
          upPrice: 0.5,
          downPrice: 0.5,
          volume: 100,
        },
      ],
    }),
    /missing outcome/i,
  );
});
