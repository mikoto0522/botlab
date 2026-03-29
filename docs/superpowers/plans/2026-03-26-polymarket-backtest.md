# Polymarket Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `backtest` command that replays Polymarket-style CSV history with fees, slippage, equity curve tracking, and optional final settlement.

**Architecture:** Keep the existing strategy contract, but add a dedicated backtest layer that parses CSV rows, builds rolling strategy context, executes `buy` / `sell` / `hold` decisions against Polymarket `up` / `down` shares, and renders a readable summary. Separate CSV parsing, fee calculation, replay logic, and command output so future changes to data format or fee rules stay isolated.

**Tech Stack:** TypeScript, Node.js built-ins, `tsx`, `typescript`

---

## File Structure

- Create: `D:/Mikoto/botlab/botlab/backtest/csv.ts`
  - Parse and validate Polymarket CSV rows.
- Create: `D:/Mikoto/botlab/botlab/backtest/fees.ts`
  - Hold the fallback fee model and Polymarket fee calculator.
- Create: `D:/Mikoto/botlab/botlab/backtest/engine.ts`
  - Replay rows, apply slippage and fees, update trades, and build the equity curve.
- Create: `D:/Mikoto/botlab/botlab/commands/backtest.ts`
  - CLI-friendly command wrapper around the backtest engine.
- Create: `D:/Mikoto/botlab/botlab/data/polymarket-sample.csv`
  - Bundled sample data for smoke tests and demos.
- Modify: `D:/Mikoto/botlab/botlab/core/types.ts`
  - Add backtest result types and prediction-market position types.
- Modify: `D:/Mikoto/botlab/botlab/core/engine.ts`
  - Export helper utilities shared by the new command and keep rendering style consistent.
- Modify: `D:/Mikoto/botlab/botlab/cli.ts`
  - Register the `backtest` command and parse required flags.
- Modify: `D:/Mikoto/botlab/botlab/README.md`
  - Document the new command and CSV format.
- Modify: `D:/Mikoto/botlab/package.json`
  - Add a convenience script for smoke-running the backtest if needed.
- Modify: `D:/Mikoto/botlab/botlab/tests/engine.test.ts`
  - Add core backtest behavior tests.
- Modify: `D:/Mikoto/botlab/botlab/tests/cli-smoke.test.ts`
  - Add a real command smoke test for `backtest`.

### Task 1: Add CSV parsing and backtest data types

**Files:**
- Create: `D:/Mikoto/botlab/botlab/backtest/csv.ts`
- Modify: `D:/Mikoto/botlab/botlab/core/types.ts`
- Test: `D:/Mikoto/botlab/botlab/tests/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Add a parser-focused test to `D:/Mikoto/botlab/botlab/tests/engine.test.ts`:

```ts
test('loadBacktestRows parses polymarket csv rows and preserves outcome data', async () => {
  const { loadBacktestRows } = await import('../backtest/csv.js');
  const csvPath = path.resolve(process.cwd(), 'botlab/data/polymarket-sample.csv');

  const rows = loadBacktestRows(csvPath);

  assert.equal(rows.length > 5, true);
  assert.equal(rows[0]?.market, 'BTC-USD-5M');
  assert.equal(typeof rows[0]?.upPrice, 'number');
  assert.equal(rows.at(-1)?.outcome, 'up');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:botlab -- --test-name-pattern="loadBacktestRows parses polymarket csv rows"
```

Expected: FAIL because the parser module and sample CSV do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `D:/Mikoto/botlab/botlab/backtest/csv.ts` with row parsing and validation:

```ts
import fs from 'node:fs';

export interface BacktestRow {
  timestamp: string;
  market: string;
  timeframe: string;
  upPrice: number;
  downPrice: number;
  volume: number;
  outcome?: 'up' | 'down';
}

function parseNumber(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric field ${field}`);
  }
  return parsed;
}

export function loadBacktestRows(filePath: string): BacktestRow[] {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  const [headerLine, ...dataLines] = raw.split(/\r?\n/);
  const headers = headerLine.split(',');
  const required = ['timestamp', 'market', 'timeframe', 'up_price', 'down_price'];

  for (const column of required) {
    if (!headers.includes(column)) {
      throw new Error(`Missing required CSV column: ${column}`);
    }
  }

  return dataLines.filter(Boolean).map((line) => {
    const parts = line.split(',');
    const row = Object.fromEntries(headers.map((header, index) => [header, parts[index] ?? '']));
    const upPrice = parseNumber(row.up_price, 'up_price');
    const downPrice = parseNumber(row.down_price, 'down_price');
    if (upPrice < 0 || upPrice > 1 || downPrice < 0 || downPrice > 1) {
      throw new Error('CSV prices must stay inside the 0 to 1 range');
    }

    return {
      timestamp: row.timestamp,
      market: row.market,
      timeframe: row.timeframe,
      upPrice,
      downPrice,
      volume: row.volume ? parseNumber(row.volume, 'volume') : 0,
      outcome: row.outcome === 'up' || row.outcome === 'down' ? row.outcome : undefined,
    };
  });
}
```

Update `D:/Mikoto/botlab/botlab/core/types.ts` to add reusable backtest types:

```ts
export type PredictionSide = 'flat' | 'up' | 'down';

export interface BacktestTrade {
  side: Exclude<PredictionSide, 'flat'>;
  entryTimestamp: string;
  exitTimestamp: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  feesPaid: number;
  realizedPnl: number;
}

export interface BacktestEquityPoint {
  timestamp: string;
  cash: number;
  equity: number;
}
```

Create `D:/Mikoto/botlab/botlab/data/polymarket-sample.csv`:

```csv
timestamp,market,timeframe,up_price,down_price,volume,outcome
2026-03-26T09:00:00.000Z,BTC-USD-5M,5m,0.41,0.59,1200,up
2026-03-26T09:05:00.000Z,BTC-USD-5M,5m,0.44,0.56,1300,up
2026-03-26T09:10:00.000Z,BTC-USD-5M,5m,0.48,0.52,1450,up
2026-03-26T09:15:00.000Z,BTC-USD-5M,5m,0.53,0.47,1580,up
2026-03-26T09:20:00.000Z,BTC-USD-5M,5m,0.59,0.41,1660,up
2026-03-26T09:25:00.000Z,BTC-USD-5M,5m,0.64,0.36,1740,up
2026-03-26T09:30:00.000Z,BTC-USD-5M,5m,0.67,0.33,1810,up
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test:botlab -- --test-name-pattern="loadBacktestRows parses polymarket csv rows"
```

Expected: PASS and confirm the parser reads the sample rows.

- [ ] **Step 5: Record the checkpoint**

This directory is not a Git repository, so use a local verification checkpoint:

```bash
npm run test:botlab -- --test-name-pattern="loadBacktestRows parses polymarket csv rows|runStrategyById"
```

Expected: PASS with the new parser test plus existing engine tests.

### Task 2: Add fee calculation and replay engine

**Files:**
- Create: `D:/Mikoto/botlab/botlab/backtest/fees.ts`
- Create: `D:/Mikoto/botlab/botlab/backtest/engine.ts`
- Modify: `D:/Mikoto/botlab/botlab/core/types.ts`
- Test: `D:/Mikoto/botlab/botlab/tests/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Add a replay test to `D:/Mikoto/botlab/botlab/tests/engine.test.ts`:

```ts
test('runBacktest replays the sample market and returns equity, trades, fees, and settlement', async () => {
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

  assert.equal(result.summary.tradeCount >= 1, true);
  assert.equal(result.summary.feeTotal > 0, true);
  assert.equal(result.equityCurve.length, rows.length);
  assert.equal(result.summary.settled, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:botlab -- --test-name-pattern="runBacktest replays the sample market"
```

Expected: FAIL because the replay engine does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `D:/Mikoto/botlab/botlab/backtest/fees.ts`:

```ts
export type BacktestFeeModel = 'flat' | 'polymarket-2026-03-26';

export function calculateFee(
  model: BacktestFeeModel,
  shares: number,
  price: number,
): number {
  if (model === 'flat') {
    return shares * price * 0.01;
  }

  const feeRate = 0.072;
  const exponent = 1;
  return shares * price * feeRate * Math.pow(price * (1 - price), exponent);
}
```

Create `D:/Mikoto/botlab/botlab/backtest/engine.ts`:

```ts
import path from 'node:path';
import type { BacktestEquityPoint, BacktestTrade, PredictionSide } from '../core/types.js';
import { createStrategyRegistry } from '../core/strategy-registry.js';
import { calculateFee, type BacktestFeeModel } from './fees.js';
import type { BacktestRow } from './csv.js';

export interface RunBacktestInput {
  strategyId: string;
  strategyDir: string;
  startingBalance: number;
  signalSide: Exclude<PredictionSide, 'flat'>;
  slippage: number;
  feeModel: BacktestFeeModel;
  rows: BacktestRow[];
}

export interface BacktestSummary {
  tradeCount: number;
  feeTotal: number;
  endingEquity: number;
  returnPct: number;
  settled: boolean;
}

export interface BacktestResult {
  summary: BacktestSummary;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
}

function clampPrice(price: number): number {
  return Math.max(0, Math.min(1, price));
}
```

Then implement `runBacktest()` to:

- load the strategy by id
- maintain `cash`, `currentSide`, `currentShares`, `entryPrice`, `feeTotal`
- build a rolling candle window from rows
- when strategy says `buy` while flat, open `signalSide`
- when strategy says `sell`, close the open side
- mark equity at every row
- if the final row has `outcome`, settle any open position to `1` or `0`

Use this execution math:

```ts
const quotedOpen = signalSide === 'up' ? row.upPrice : row.downPrice;
const openPrice = clampPrice(quotedOpen + input.slippage);
const shares = Math.floor((cash * 100) / openPrice) / 100;
const openFee = calculateFee(input.feeModel, shares, openPrice);

const quotedClose = currentSide === 'up' ? row.upPrice : row.downPrice;
const closePrice = clampPrice(quotedClose - input.slippage);
const closeFee = calculateFee(input.feeModel, currentShares, closePrice);
```

Extend `D:/Mikoto/botlab/botlab/core/types.ts` with:

```ts
export interface BacktestSummary {
  tradeCount: number;
  winCount: number;
  lossCount: number;
  feeTotal: number;
  endingEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  settled: boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test:botlab -- --test-name-pattern="runBacktest replays the sample market"
```

Expected: PASS and the result contains trades, fee total, and an equity curve.

- [ ] **Step 5: Record the checkpoint**

Run:

```bash
npm run test:botlab -- --test-name-pattern="runBacktest replays the sample market|read command wrappers"
```

Expected: PASS for the new replay test and current engine command tests.

### Task 3: Add summary rendering and the `backtest` CLI entry

**Files:**
- Create: `D:/Mikoto/botlab/botlab/commands/backtest.ts`
- Modify: `D:/Mikoto/botlab/botlab/core/engine.ts`
- Modify: `D:/Mikoto/botlab/botlab/cli.ts`
- Modify: `D:/Mikoto/botlab/package.json`
- Test: `D:/Mikoto/botlab/botlab/tests/cli-smoke.test.ts`

- [ ] **Step 1: Write the failing test**

Add this smoke test to `D:/Mikoto/botlab/botlab/tests/cli-smoke.test.ts`:

```ts
test('botlab smoke flow can run the backtest command', async () => {
  const result = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'backtest',
    '--strategy=btc-eth-5m',
    '--data=botlab/data/polymarket-sample.csv',
  ], { cwd: repoRoot });

  assert.match(result.stdout, /Backtest Summary/);
  assert.match(result.stdout, /Trades:/);
  assert.match(result.stdout, /Ending Equity:/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:botlab:smoke
```

Expected: FAIL because the command does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `D:/Mikoto/botlab/botlab/commands/backtest.ts`:

```ts
import path from 'node:path';
import type { BotlabConfig } from '../core/types.js';
import { loadBacktestRows } from '../backtest/csv.js';
import { runBacktest } from '../backtest/engine.js';

export async function backtestCommand(
  strategyId: string,
  dataPath: string,
  config: BotlabConfig,
): Promise<string> {
  const rows = loadBacktestRows(path.resolve(process.cwd(), dataPath));
  const result = await runBacktest({
    strategyId,
    strategyDir: config.paths.strategyDir,
    startingBalance: config.runtime.balance,
    signalSide: 'up',
    slippage: 0.01,
    feeModel: 'polymarket-2026-03-26',
    rows,
  });

  return [
    'Backtest Summary',
    `Strategy: ${strategyId}`,
    `Rows: ${rows.length}`,
    `Trades: ${result.summary.tradeCount}`,
    `Fees: ${result.summary.feeTotal.toFixed(4)}`,
    `Ending Equity: ${result.summary.endingEquity.toFixed(2)}`,
    `Return: ${result.summary.returnPct.toFixed(2)}%`,
    `Max Drawdown: ${result.summary.maxDrawdownPct.toFixed(2)}%`,
    `Settled: ${result.summary.settled ? 'yes' : 'no'}`,
  ].join('\n');
}
```

Update `D:/Mikoto/botlab/botlab/cli.ts`:

```ts
if (command === 'backtest') {
  const strategyId = getFlagValue(argv, 'strategy');
  const dataPath = getFlagValue(argv, 'data');
  if (!strategyId) {
    throw new Error('Missing required flag --strategy=<id>.');
  }
  if (!dataPath) {
    throw new Error('Missing required flag --data=<csv path>.');
  }

  console.log(await backtestCommand(strategyId, dataPath, config));
  return;
}
```

Also update the missing-command text to mention `backtest`, and add to `D:/Mikoto/botlab/package.json`:

```json
"botlab:backtest": "tsx botlab/cli.ts backtest"
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test:botlab:smoke
```

Expected: PASS and the new smoke test prints the backtest summary.

- [ ] **Step 5: Record the checkpoint**

Run:

```bash
npm run test:botlab -- --test-name-pattern="runBacktest replays the sample market|botlab smoke flow can run the backtest command"
```

Expected: PASS for the engine and CLI command path.

### Task 4: Document the backtest flow and run final verification

**Files:**
- Modify: `D:/Mikoto/botlab/botlab/README.md`
- Modify: `D:/Mikoto/botlab/botlab/tests/engine.test.ts`
- Modify: `D:/Mikoto/botlab/botlab/tests/cli-smoke.test.ts`

- [ ] **Step 1: Write the failing test**

Add one more behavior test to `D:/Mikoto/botlab/botlab/tests/engine.test.ts`:

```ts
test('runBacktest reports drawdown and winning trades after settlement', async () => {
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

  assert.equal(result.summary.maxDrawdownPct >= 0, true);
  assert.equal(result.summary.winCount >= 1, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:botlab -- --test-name-pattern="runBacktest reports drawdown"
```

Expected: FAIL until summary stats are fully wired.

- [ ] **Step 3: Write the minimal implementation**

Update `D:/Mikoto/botlab/botlab/backtest/engine.ts` so it:

- counts winning and losing trades
- computes peak-to-trough drawdown from the equity curve
- includes those values in `summary`

Update `D:/Mikoto/botlab/botlab/README.md` to document:

- the new `backtest` command
- the expected CSV columns
- that the first version assumes Polymarket-style `up` positions for `btc-eth-5m`
- sample command lines

Use this command block:

```md
```bash
npm run botlab -- backtest --strategy=btc-eth-5m --data=botlab/data/polymarket-sample.csv
npm run botlab:backtest -- --strategy=btc-eth-5m --data=botlab/data/polymarket-sample.csv
```
```

- [ ] **Step 4: Run tests and final verification**

Run:

```bash
npm run test:botlab
npm run build
npm run botlab -- backtest --strategy=btc-eth-5m --data=botlab/data/polymarket-sample.csv
```

Expected:

- full test suite PASS
- build PASS
- backtest command prints a readable summary with trades, fees, ending equity, return, and drawdown

- [ ] **Step 5: Record the checkpoint**

This directory is not a Git repository, so record completion by saving the exact verification output in your task notes after running the commands above.
