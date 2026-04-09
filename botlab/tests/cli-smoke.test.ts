import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const testFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFilePath), '..', '..');
const tsxCli = path.resolve(repoRoot, 'node_modules/tsx/dist/cli.mjs');
const exampleConfigPath = path.resolve(repoRoot, 'botlab/config/example.config.json');
const bundledExampleConfig = JSON.parse(fs.readFileSync(exampleConfigPath, 'utf8')) as {
  runtime?: {
    market?: {
      momentum?: number;
    };
  };
};

test('botlab smoke flow uses the bundled example config and renders the example strategy', async () => {
  assert.equal(fs.existsSync(exampleConfigPath), true, 'expected botlab/config/example.config.json to exist');
  assert.equal(bundledExampleConfig.runtime?.market?.momentum, 0.72, 'expected bundled config momentum to match the sample runtime');

  const listResult = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'list-strategies',
  ], { cwd: repoRoot });

  assert.match(listResult.stdout, /example-momentum/);

  const runResult = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'run',
    '--strategy=example-momentum',
    '--config=botlab/config/example.config.json',
  ], { cwd: repoRoot });

  assert.match(runResult.stdout, /ACTION: buy/);
  assert.match(runResult.stdout, /Reason: momentum is strong enough to open a position/);
  assert.match(runResult.stdout, /Size: 0.1/);
});

test('botlab smoke flow can run the btc-eth-5m strategy', async () => {
  const result = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'run',
    '--strategy=btc-eth-5m',
  ], { cwd: repoRoot });

  assert.match(result.stdout, /btc-eth-5m/);
  assert.match(result.stdout, /ACTION: buy/);
});

test('botlab smoke flow can run the paper command with a bounded fixture session', async () => {
  const sessionName = `smoke-paper-${Date.now()}-${Math.round(Math.random() * 10000)}`;
  const fixtureDir = fs.mkdtempSync(path.join(repoRoot, 'botlab-paper-fixture-'));
  const fixturePath = path.join(fixtureDir, 'paper-fixture.json');
  fs.writeFileSync(fixturePath, JSON.stringify([
    {
      asset: 'BTC',
      slug: 'btc-updown-5m-1774781400',
      question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
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
      volume: 25000,
      fetchedAt: '2026-03-29T10:53:27.000Z',
    },
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
      outcomePrices: '["0.58","0.42"]',
      bestAsk: '["0.59","0.43"]',
      volume: 25000,
      fetchedAt: '2026-03-29T10:53:27.000Z',
    },
  ], null, 2), 'utf8');

  const result = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'paper',
    '--strategy=btc-eth-5m-multi-signal',
    `--session=${sessionName}`,
    '--interval=0',
    '--max-cycles=1',
    `--fixture=${fixturePath}`,
  ], { cwd: repoRoot });

  assert.match(result.stdout, /Paper Session Summary/);
  assert.match(result.stdout, new RegExp(`Session: ${sessionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(result.stdout, /cycle \d+:/);
  assert.match(result.stdout, /btc-updown-5m-1774781400/);
  assert.doesNotMatch(result.stdout, /ask up=/);
  assert.match(result.stdout, /Cycles This Run: 1/);
  assert.match(result.stdout, /State File: /);
  assert.match(result.stdout, /Events File: /);
});

test('botlab smoke flow can run the backtest command', async () => {
  const result = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'backtest',
    '--strategy=btc-eth-5m',
    '--data=botlab/data/polymarket-sample.csv',
  ], { cwd: repoRoot });

  assert.match(result.stdout, /Backtest Summary/);
  assert.match(result.stdout, /Strategy: btc-eth-5m/);
  assert.match(result.stdout, /Trades: \d+/);
  assert.match(result.stdout, /Fees: /);
  assert.match(result.stdout, /Ending Equity: /);
  assert.match(result.stdout, /Return: /);
  assert.match(result.stdout, /Max Drawdown: /);
  assert.match(result.stdout, /Settled: yes/);
});

test('botlab smoke flow can run the backtest command for the down side', async () => {
  const result = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'backtest',
    '--strategy=btc-eth-5m',
    '--data=botlab/data/polymarket-sample.csv',
    '--side=down',
  ], { cwd: repoRoot });

  assert.match(result.stdout, /Strategy: btc-eth-5m/);
  assert.match(result.stdout, /Trades: \d+/);
  assert.match(result.stdout, /Fees: /);
  assert.match(result.stdout, /Ending Equity: /);
  assert.match(result.stdout, /Return: /);
  assert.match(result.stdout, /Max Drawdown: /);
  assert.match(result.stdout, /Settled: yes/);
});

test('botlab smoke flow rejects an invalid backtest side flag', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      tsxCli,
      'botlab/cli.ts',
      'backtest',
      '--strategy=btc-eth-5m',
      '--data=botlab/data/polymarket-sample.csv',
      '--side=sideways',
    ], { cwd: repoRoot }),
    /Invalid --side value\. Use --side=up or --side=down\./,
  );
});

test('botlab smoke flow can run the batch backtest command', async () => {
  const result = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'backtest-batch',
    '--strategy=btc-eth-5m',
    '--data=botlab/data/polymarket-sample.csv',
  ], { cwd: repoRoot });

  assert.match(result.stdout, /Batch Backtest Summary/);
  assert.match(result.stdout, /Strategy: btc-eth-5m/);
  assert.match(result.stdout, /Rows: 7/);
  assert.match(result.stdout, /Trades: \d+/);
  assert.match(result.stdout, /Up Trades: \d+/);
  assert.match(result.stdout, /Down Trades: \d+/);
  assert.match(result.stdout, /Skipped Inputs: \d+/);
  assert.match(result.stdout, /Fees: /);
  assert.match(result.stdout, /Ending Equity: /);
  assert.match(result.stdout, /Return: /);
  assert.match(result.stdout, /Max Drawdown: /);
  assert.match(result.stdout, /Settled: yes/);
});

test('botlab smoke flow rejects --side for the batch backtest command', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      tsxCli,
      'botlab/cli.ts',
      'backtest-batch',
      '--strategy=btc-eth-5m',
      '--data=botlab/data/polymarket-sample.csv',
      '--side=down',
    ], { cwd: repoRoot }),
    /The backtest-batch command does not accept --side\. Use --strategy and --data only\./,
  );
});

test('botlab smoke flow can run the batch backtest command from outside the project root', async () => {
  const outsideRoot = path.resolve(repoRoot, '..');
  const cliPath = path.resolve(repoRoot, 'botlab/cli.ts');
  const result = await execFileAsync(process.execPath, [
    tsxCli,
    cliPath,
    'backtest-batch',
    '--strategy=btc-eth-5m',
    '--data=botlab/data/polymarket-sample.csv',
  ], { cwd: outsideRoot });

  assert.match(result.stdout, /Batch Backtest Summary/);
  assert.match(result.stdout, /Strategy: btc-eth-5m/);
  assert.match(result.stdout, /Rows: 7/);
  assert.match(result.stdout, /Trades: \d+/);
  assert.match(result.stdout, /Fees: /);
  assert.match(result.stdout, /Settled: yes/);
});

test('botlab smoke flow can run the hedge backtest command', async () => {
  const result = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'backtest-hedge',
    '--strategy=btc-eth-5m-true-hedge',
    '--data=botlab/data/polymarket-btc-eth-5m-last-month.csv',
  ], { cwd: repoRoot });

  assert.match(result.stdout, /Hedge Backtest Summary/);
  assert.match(result.stdout, /Strategy: btc-eth-5m-true-hedge/);
  assert.match(result.stdout, /Paired Trades: \d+/);
  assert.match(result.stdout, /Legs: \d+/);
  assert.match(result.stdout, /Fees: /);
  assert.match(result.stdout, /Settled: yes/);
});

test('botlab smoke flow can run the hedge analysis command', async () => {
  const result = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'analyze-hedge',
    '--strategy=btc-eth-5m-true-hedge',
    '--data=botlab/data/polymarket-btc-eth-5m-last-month.csv',
  ], { cwd: repoRoot });

  assert.match(result.stdout, /Hedge Analysis/);
  assert.match(result.stdout, /Stability Check/);
  assert.match(result.stdout, /Trimmed Return: /);
  assert.match(result.stdout, /Monthly Slices/);
});
