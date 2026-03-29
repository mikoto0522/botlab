import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { loadBotlabConfig, resolveBotlabPaths } from '../config/default-config.js';

const execFileAsync = promisify(execFile);

test('resolveBotlabPaths returns botlab folders under the repo root', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'polybot-paths-'));
  const paths = resolveBotlabPaths(cwd);

  assert.equal(paths.rootDir, path.resolve(cwd, 'botlab'));
  assert.equal(paths.strategyDir, path.resolve(cwd, 'botlab/strategies'));
  assert.equal(paths.templateDir, path.resolve(cwd, 'botlab/templates'));
  assert.equal(paths.defaultConfigPath, path.resolve(cwd, 'botlab/config/example.config.json'));
});

test('loadBotlabConfig falls back to built-in defaults when config is missing', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'polybot-config-'));
  const config = loadBotlabConfig(undefined, cwd);

  assert.equal(config.runtime.mode, 'dry-run');
  assert.equal(config.runtime.market.asset, 'BTC');
  assert.equal(config.runtime.market.symbol, 'BTC-USD');
  assert.equal(config.runtime.market.timeframe, '5m');
  assert.equal(config.runtime.market.price, 100);
  assert.equal(config.runtime.market.changePct24h, 1.2);
  assert.equal(config.runtime.market.momentum, 0.72);
  assert.equal(config.runtime.market.volume, 250000);
  assert.equal(config.runtime.clock.now, '2026-03-26T09:30:00.000Z');
  assert.equal(config.runtime.market.timestamp, config.runtime.clock.now);
  assert.equal(config.runtime.market.candles.length, 5);
  assert.equal(config.runtime.market.candles.at(-1)?.close, 101.2);
  assert.equal(config.runtime.position.side, 'flat');
  assert.equal(config.runtime.balance, 1000);
  assert.equal(config.paths.strategyDir, path.resolve(cwd, 'botlab/strategies'));
});

test('loadBotlabConfig falls back to built-in defaults for an explicitly missing config file', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'polybot-config-explicit-'));
  const configPath = path.join(cwd, 'missing.config.json');

  const config = loadBotlabConfig(configPath, cwd);

  assert.equal(config.runtime.mode, 'dry-run');
  assert.equal(config.runtime.market.symbol, 'BTC-USD');
  assert.equal(config.runtime.position.side, 'flat');
  assert.equal(config.runtime.balance, 1000);
});

test('loadBotlabConfig merges runtime values from a real config file', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'polybot-config-file-'));
  const configPath = path.join(cwd, 'botlab.config.json');

  fs.writeFileSync(configPath, JSON.stringify({
    runtime: {
      mode: 'paper',
      market: {
        symbol: 'ETH-15M',
        timeframe: '15m',
        price: 234.56,
        changePct24h: 2.5,
        momentum: 0.81,
        volume: 420000,
        timestamp: '2026-03-26T10:15:00.000Z',
      },
      position: {
        side: 'long',
        size: 3,
        entryPrice: 222.22,
      },
      balance: 4321,
      clock: {
        now: '2026-03-26T11:11:11.000Z',
      },
    },
  }), 'utf-8');

  const config = loadBotlabConfig(configPath, cwd);

  assert.equal(config.runtime.mode, 'paper');
  assert.equal(config.runtime.market.asset, 'BTC');
  assert.equal(config.runtime.market.symbol, 'ETH-15M');
  assert.equal(config.runtime.market.timeframe, '15m');
  assert.equal(config.runtime.market.price, 234.56);
  assert.equal(config.runtime.market.changePct24h, 2.5);
  assert.equal(config.runtime.market.momentum, 0.81);
  assert.equal(config.runtime.market.volume, 420000);
  assert.equal(config.runtime.market.timestamp, '2026-03-26T10:15:00.000Z');
  assert.equal(config.runtime.position.side, 'long');
  assert.equal(config.runtime.position.size, 3);
  assert.equal(config.runtime.position.entryPrice, 222.22);
  assert.equal(config.runtime.balance, 4321);
  assert.equal(config.runtime.clock.now, '2026-03-26T11:11:11.000Z');
});

test('loadBotlabConfig loads candle data from a real config file', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-candles-'));
  const configPath = path.join(cwd, 'botlab.config.json');

  fs.writeFileSync(configPath, JSON.stringify({
    runtime: {
      market: {
        asset: 'BTC',
        symbol: 'BTC-USD',
        timeframe: '5m',
        price: 104.5,
        candles: [
          { timestamp: '2026-03-26T09:00:00.000Z', open: 100, high: 101, low: 99.5, close: 100.8, volume: 1200 },
          { timestamp: '2026-03-26T09:05:00.000Z', open: 100.8, high: 102, low: 100.7, close: 101.7, volume: 1500 },
        ],
      },
    },
  }), 'utf-8');

  const config = loadBotlabConfig(configPath, cwd);

  assert.equal(config.runtime.market.asset, 'BTC');
  assert.equal(config.runtime.market.candles.length, 2);
  assert.equal(config.runtime.market.candles[1]?.close, 101.7);
});

test('loadBotlabConfig reads per-strategy parameter overrides from a real config file', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-strategy-params-'));
  const configPath = path.join(cwd, 'botlab.config.json');

  fs.writeFileSync(configPath, JSON.stringify({
    runtime: {
      balance: 100,
    },
    strategyParams: {
      'btc-eth-5m-multi-signal': {
        btcGuardrailStake: 5,
        lowConfidenceStake: 5,
        mediumConfidenceStake: 5,
        highConfidenceStake: 5,
        hedgeStakePerLeg: 5,
      },
    },
  }), 'utf-8');

  const config = loadBotlabConfig(configPath, cwd);

  assert.equal(config.runtime.balance, 100);
  assert.deepEqual(config.strategyParams?.['btc-eth-5m-multi-signal'], {
    btcGuardrailStake: 5,
    lowConfidenceStake: 5,
    mediumConfidenceStake: 5,
    highConfidenceStake: 5,
    hedgeStakePerLeg: 5,
  });
});

test('botlab cli describe-strategy prints strategy details', async () => {
  const tsxCli = path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');

  const result = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'describe-strategy',
    '--strategy=example-momentum',
  ], { cwd: process.cwd() });

  assert.match(result.stdout, /Example Momentum/);
  assert.match(result.stdout, /example-momentum/);
});

test('build config preserves the legacy src output layout', async () => {
  const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polybot-build-'));
  const buildConfig = path.resolve(process.cwd(), 'tsconfig.build.json');
  const tscBin = path.resolve(process.cwd(), 'node_modules/typescript/bin/tsc');

  await execFileAsync(process.execPath, [tscBin, '-p', buildConfig, '--outDir', tempOutDir], { cwd: process.cwd() });

  assert.equal(fs.existsSync(path.join(tempOutDir, 'index.js')), true);
  assert.equal(fs.existsSync(path.join(tempOutDir, 'src', 'index.js')), false);
  assert.equal(fs.existsSync(path.join(tempOutDir, 'botlab', 'tests', 'config.test.js')), false);
});
