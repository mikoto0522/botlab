# Polymarket Bilateral Batch Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class month-style batch backtest for Polymarket BTC / ETH 5-minute markets, and upgrade the bundled strategy so it can choose `up`, `down`, or skip on each market.

**Architecture:** Keep the existing single-stream `backtest` flow intact, then add a separate batch path that treats each CSV row as one independent settled market and builds recent history from prior same-asset rows. Extend the shared strategy decision shape with an optional side field so old commands still work while the new batch engine can honor strategy-selected `up` or `down` trades.

**Tech Stack:** TypeScript, Node.js built-in test runner, tsx CLI, existing Botlab CSV and fee modules

---

### Task 1: Extend the shared strategy decision contract

**Files:**
- Modify: `D:/Mikoto/botlab/botlab/core/types.ts`
- Test: `D:/Mikoto/botlab/botlab/tests/engine.test.ts`

- [ ] **Step 1: Write the failing tests for bilateral strategy decisions**

```ts
test('btc-eth-5m can return a buy decision with side up', async () => {
  const result = await runStrategyById('btc-eth-5m', bullishConfig);
  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'up');
});

test('btc-eth-5m can return a buy decision with side down', async () => {
  const result = await runStrategyById('btc-eth-5m', bearishConfig);
  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'down');
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail for the expected reason**

Run: `npm run test:botlab -- --test-name-pattern="btc-eth-5m can return a buy decision"`

Expected: FAIL because `decision.side` does not exist yet or the current strategy does not emit it.

- [ ] **Step 3: Add the optional side field to the shared decision types**

```ts
export interface BotlabStrategyDecision {
  action: StrategyAction;
  side?: Exclude<PredictionSide, 'flat'>;
  reason: string;
  size?: number;
  tags?: string[];
}
```

- [ ] **Step 4: Re-run the targeted tests and confirm the remaining failure is now only strategy logic**

Run: `npm run test:botlab -- --test-name-pattern="btc-eth-5m can return a buy decision"`

Expected: FAIL because the strategy still needs to emit `side`, but type errors are gone.

- [ ] **Step 5: Commit the type contract change**

```bash
git add D:/Mikoto/botlab/botlab/core/types.ts D:/Mikoto/botlab/botlab/tests/engine.test.ts
git commit -m "feat: add bilateral strategy decision side"
```

### Task 2: Add a dedicated batch backtest engine

**Files:**
- Create: `D:/Mikoto/botlab/botlab/backtest/batch-engine.ts`
- Modify: `D:/Mikoto/botlab/botlab/core/types.ts`
- Test: `D:/Mikoto/botlab/botlab/tests/engine.test.ts`

- [ ] **Step 1: Write failing tests for batch settlement, skipping, and mixed up/down trades**

```ts
test('runBatchBacktest records both up and down trades across independent rows', async () => {
  const result = await runBatchBacktest({
    strategyId: 'btc-eth-5m',
    strategyDir,
    startingBalance: 1000,
    slippage: 0.01,
    feeModel: 'polymarket-2026-03-26',
    rows,
  });

  assert.equal(result.summary.upTradeCount > 0, true);
  assert.equal(result.summary.downTradeCount > 0, true);
});

test('runBatchBacktest skips rows when the strategy returns hold', async () => {
  assert.equal(result.summary.skippedCount > 0, true);
});
```

- [ ] **Step 2: Run the targeted batch tests and verify they fail because the batch engine does not exist**

Run: `npm run test:botlab -- --test-name-pattern="runBatchBacktest"`

Expected: FAIL with missing import or missing function errors.

- [ ] **Step 3: Implement the minimal batch engine**

```ts
export async function runBatchBacktest(input: RunBatchBacktestInput): Promise<RunBatchBacktestResult> {
  const assetHistory = new Map<string, BacktestRow[]>();
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];
  let cash = input.startingBalance;

  for (const row of input.rows) {
    const assetKey = `${parseAsset(row.market)}:${row.timeframe}`;
    const history = assetHistory.get(assetKey) ?? [];
    const candles = buildIndependentMarketCandles([...history, row]);
    const context = buildBatchContext(row, candles, cash);
    const decision = strategy.evaluate(context, structuredClone(strategy.defaults));

    if (decision.action === 'buy' && decision.side) {
      const trade = settleIndependentMarket(row, decision.side, decision.size ?? cash, input);
      cash += trade.realizedPnl;
      trades.push(trade);
    }

    history.push(row);
    assetHistory.set(assetKey, history);
    equityCurve.push({ timestamp: row.timestamp, cash, equity: cash });
  }

  return summarizeBatchResult(trades, equityCurve, input.startingBalance);
}
```

- [ ] **Step 4: Re-run the targeted batch tests and confirm they pass**

Run: `npm run test:botlab -- --test-name-pattern="runBatchBacktest"`

Expected: PASS

- [ ] **Step 5: Commit the batch engine**

```bash
git add D:/Mikoto/botlab/botlab/backtest/batch-engine.ts D:/Mikoto/botlab/botlab/core/types.ts D:/Mikoto/botlab/botlab/tests/engine.test.ts
git commit -m "feat: add polymarket batch backtest engine"
```

### Task 3: Add a CLI command for real month-style batch backtests

**Files:**
- Create: `D:/Mikoto/botlab/botlab/commands/backtest-batch.ts`
- Modify: `D:/Mikoto/botlab/botlab/cli.ts`
- Test: `D:/Mikoto/botlab/botlab/tests/cli-smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test for the new command**

```ts
test('botlab smoke flow can run the batch backtest command', async () => {
  const result = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'backtest-batch',
    '--strategy=btc-eth-5m',
    '--data=botlab/data/polymarket-sample.csv',
  ], { cwd: repoRoot });

  assert.match(result.stdout, /Batch Backtest Summary/);
});
```

- [ ] **Step 2: Run the smoke test and verify it fails because the command is unknown**

Run: `npm run test:botlab -- --test-name-pattern="batch backtest command"`

Expected: FAIL with `Unknown command: backtest-batch`.

- [ ] **Step 3: Implement the CLI command and output formatter**

```ts
if (command === 'backtest-batch') {
  const strategyId = getFlagValue(argv, 'strategy');
  const dataPath = getFlagValue(argv, 'data');
  if (!strategyId || !dataPath) {
    throw new Error('Missing required flags for backtest-batch.');
  }

  console.log(await backtestBatchCommand(strategyId, dataPath, config));
  return;
}
```

- [ ] **Step 4: Re-run the smoke test and confirm it passes with stable summary text**

Run: `npm run test:botlab -- --test-name-pattern="batch backtest command"`

Expected: PASS

- [ ] **Step 5: Commit the CLI batch command**

```bash
git add D:/Mikoto/botlab/botlab/commands/backtest-batch.ts D:/Mikoto/botlab/botlab/cli.ts D:/Mikoto/botlab/botlab/tests/cli-smoke.test.ts
git commit -m "feat: add batch backtest cli command"
```

### Task 4: Replace the bundled BTC / ETH strategy with a bilateral aggressive version

**Files:**
- Modify: `D:/Mikoto/botlab/botlab/strategies/btc-eth-5m.strategy.ts`
- Test: `D:/Mikoto/botlab/botlab/tests/engine.test.ts`

- [ ] **Step 1: Write failing tests for bullish buy-up, bearish buy-down, and weak-signal hold**

```ts
test('btc-eth-5m chooses up on a strong bullish window', async () => {
  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'up');
});

test('btc-eth-5m chooses down on a strong bearish window', async () => {
  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'down');
});

test('btc-eth-5m holds on mixed recent history', async () => {
  assert.equal(result.decision.action, 'hold');
});
```

- [ ] **Step 2: Run the targeted strategy tests and verify they fail for the old one-sided logic**

Run: `npm run test:botlab -- --test-name-pattern="btc-eth-5m chooses"`

Expected: FAIL because the current strategy only emits one-sided momentum entries.

- [ ] **Step 3: Implement the new bilateral scoring logic with higher default allocation**

```ts
if (directionScore >= params.longScoreThreshold) {
  return {
    action: 'buy',
    side: 'up',
    size: Number((context.balance * params.allocation).toFixed(2)),
    reason: 'recent window strongly favors up',
  };
}

if (directionScore <= params.shortScoreThreshold) {
  return {
    action: 'buy',
    side: 'down',
    size: Number((context.balance * params.allocation).toFixed(2)),
    reason: 'recent window strongly favors down',
  };
}

return { action: 'hold', reason: 'signal is mixed' };
```

- [ ] **Step 4: Re-run the targeted strategy tests and confirm they pass**

Run: `npm run test:botlab -- --test-name-pattern="btc-eth-5m chooses|mixed recent history"`

Expected: PASS

- [ ] **Step 5: Commit the bilateral strategy rewrite**

```bash
git add D:/Mikoto/botlab/botlab/strategies/btc-eth-5m.strategy.ts D:/Mikoto/botlab/botlab/tests/engine.test.ts
git commit -m "feat: add bilateral btc eth polymarket strategy"
```

### Task 5: Document the new flow and verify it on the downloaded month data

**Files:**
- Modify: `D:/Mikoto/botlab/botlab/README.md`
- Test: `D:/Mikoto/botlab/botlab/tests/cli-smoke.test.ts`

- [ ] **Step 1: Add or update smoke coverage for the real-data batch command**

```ts
test('botlab smoke flow prints batch summary fields', async () => {
  assert.match(result.stdout, /Batch Backtest Summary/);
  assert.match(result.stdout, /Up Trades:/);
  assert.match(result.stdout, /Down Trades:/);
  assert.match(result.stdout, /Skipped:/);
});
```

- [ ] **Step 2: Run the full test suite before touching docs**

Run: `npm run test:botlab`

Expected: PASS

- [ ] **Step 3: Update README with the new command and the real last-month data paths**

```md
npm run botlab -- backtest-batch --strategy=btc-eth-5m --data=botlab/data/polymarket-btc-5m-last-month.csv
npm run botlab -- backtest-batch --strategy=btc-eth-5m --data=botlab/data/polymarket-eth-5m-last-month.csv
```

- [ ] **Step 4: Run the complete verification commands**

Run: `npm run test:botlab`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run: `npm run botlab -- backtest-batch --strategy=btc-eth-5m --data=botlab/data/polymarket-btc-5m-last-month.csv`
Expected: command exits successfully and prints batch summary

Run: `npm run botlab -- backtest-batch --strategy=btc-eth-5m --data=botlab/data/polymarket-eth-5m-last-month.csv`
Expected: command exits successfully and prints batch summary

- [ ] **Step 5: Commit the docs and verification-backed final state**

```bash
git add D:/Mikoto/botlab/botlab/README.md D:/Mikoto/botlab/botlab/tests/cli-smoke.test.ts
git commit -m "docs: explain polymarket batch backtest flow"
```
