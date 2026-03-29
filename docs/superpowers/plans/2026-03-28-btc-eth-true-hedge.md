# BTC ETH True Hedge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real two-leg BTC/ETH hedge backtest flow, ship a first hedge strategy, and verify whether the result is stable or only carried by a few lucky trades.

**Architecture:** Keep the existing single-market batch backtest intact. Add a separate hedge batch path that evaluates one timestamp group at a time, lets a strategy open up to two legs together, and settles both legs as one paired trade. Add a simple analysis command that replays the same data and prints stability slices.

**Tech Stack:** TypeScript, tsx, Node test runner

---

### Task 1: Hedge Backtest Types And CLI Surface

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\core\types.ts`
- Modify: `D:\Mikoto\botlab\botlab\cli.ts`
- Modify: `D:\Mikoto\botlab\botlab\tests\engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('describe-strategy lists the true hedge strategy', async () => {
  const details = await describeStrategyById('btc-eth-5m-true-hedge', config.paths.strategyDir);
  assert.match(details, /BTC \/ ETH 5m True Hedge/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:botlab -- --test-name-pattern="true hedge strategy"`
Expected: FAIL because the new strategy id does not exist yet

- [ ] **Step 3: Write minimal implementation**

Add the new strategy id later in the strategy task, and extend CLI command parsing so a new `backtest-hedge` and `analyze-hedge` command can be wired in without changing the existing batch flow.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:botlab -- --test-name-pattern="true hedge strategy"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add botlab/core/types.ts botlab/cli.ts botlab/tests/engine.test.ts
git commit -m "feat: add hedge backtest command surface"
```

### Task 2: Hedge Batch Engine

**Files:**
- Create: `D:\Mikoto\botlab\botlab\backtest\hedge-engine.ts`
- Modify: `D:\Mikoto\botlab\botlab\backtest\csv.ts`
- Modify: `D:\Mikoto\botlab\botlab\tests\engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('hedge engine settles both legs from one timestamp group', async () => {
  const result = await runHedgeBacktest({
    strategyId: 'test-hedge',
    strategyDir,
    startingBalance: 1000,
    slippage: 0,
    feeModel: { makerPct: 0, takerPct: 0 },
    rows: [
      { timestamp: '2026-03-26T09:00:00.000Z', market: 'BTC-USD-5M', timeframe: '5m', upPrice: 0.62, downPrice: 0.38, volume: 1000, outcome: 'up' },
      { timestamp: '2026-03-26T09:00:00.000Z', market: 'ETH-USD-5M', timeframe: '5m', upPrice: 0.41, downPrice: 0.59, volume: 1000, outcome: 'down' },
    ],
  });

  assert.equal(result.summary.tradeCount, 1);
  assert.equal(result.summary.legCount, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:botlab -- --test-name-pattern="hedge engine settles both legs"`
Expected: FAIL because `runHedgeBacktest` does not exist

- [ ] **Step 3: Write minimal implementation**

Create a hedge engine that:
- groups rows by timestamp
- builds prior history per asset
- asks the strategy for 0-2 legs
- buys each leg from ask or display price plus slippage
- settles both legs from the row outcomes
- records one paired trade entry and summary counts

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:botlab -- --test-name-pattern="hedge engine settles both legs"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add botlab/backtest/hedge-engine.ts botlab/backtest/csv.ts botlab/tests/engine.test.ts
git commit -m "feat: add paired hedge backtest engine"
```

### Task 3: Hedge Strategy

**Files:**
- Create: `D:\Mikoto\botlab\botlab\strategies\btc-eth-5m-true-hedge.strategy.ts`
- Modify: `D:\Mikoto\botlab\botlab\tests\engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('true hedge strategy opens BTC and ETH legs together when the gap is stretched', async () => {
  const result = await runStrategyById('btc-eth-5m-true-hedge', configWithRelatedMarkets);
  assert.match(result, /buy BTC and ETH together/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:botlab -- --test-name-pattern="true hedge strategy opens BTC and ETH legs together"`
Expected: FAIL because the strategy does not exist

- [ ] **Step 3: Write minimal implementation**

Add a first strategy that:
- only works on 5m BTC/ETH pairs
- compares recent BTC and ETH deviations against their recent averages
- opens one BTC leg and one ETH leg together when the spread is stretched
- keeps each leg capped with fixed stake limits

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:botlab -- --test-name-pattern="true hedge strategy opens BTC and ETH legs together"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add botlab/strategies/btc-eth-5m-true-hedge.strategy.ts botlab/tests/engine.test.ts
git commit -m "feat: add btc eth true hedge strategy"
```

### Task 4: Hedge Commands And Documentation

**Files:**
- Create: `D:\Mikoto\botlab\botlab\commands\backtest-hedge.ts`
- Create: `D:\Mikoto\botlab\botlab\commands\analyze-hedge.ts`
- Modify: `D:\Mikoto\botlab\botlab\cli.ts`
- Modify: `D:\Mikoto\botlab\botlab\README.md`
- Modify: `D:\Mikoto\botlab\package.json`

- [ ] **Step 1: Write the failing test**

```ts
test('hedge analysis prints return and stability slices', async () => {
  const output = await analyzeHedgeCommand('btc-eth-5m-true-hedge', dataPath, config);
  assert.match(output, /Stability Check/);
  assert.match(output, /Trimmed Return/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:botlab -- --test-name-pattern="hedge analysis prints return"`
Expected: FAIL because the command does not exist

- [ ] **Step 3: Write minimal implementation**

Add:
- `backtest-hedge` command for paired backtests
- `analyze-hedge` command that reports total return, monthly slices, win/loss counts, trimmed return after dropping the top winners, and concentration warnings
- README usage examples
- package script aliases

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:botlab -- --test-name-pattern="hedge analysis prints return"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add botlab/commands/backtest-hedge.ts botlab/commands/analyze-hedge.ts botlab/cli.ts botlab/README.md package.json botlab/tests/engine.test.ts
git commit -m "feat: add hedge backtest commands"
```

### Task 5: Real Data Verification

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\README.md`

- [ ] **Step 1: Run the full botlab test suite**

Run: `npm run test:botlab`
Expected: PASS

- [ ] **Step 2: Run build verification**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Run the paired hedge backtest on last-month data**

Run: `npm run botlab -- backtest-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`
Expected: command succeeds and prints paired trade summary

- [ ] **Step 4: Run the paired hedge backtest on YTD data**

Run: `npm run botlab -- backtest-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-ytd.csv`
Expected: command succeeds and prints paired trade summary

- [ ] **Step 5: Run the stability analysis on both ranges**

Run: `npm run botlab -- analyze-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`
Run: `npm run botlab -- analyze-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-ytd.csv`
Expected: commands succeed and show whether the result depends on a few outsized trades

- [ ] **Step 6: Commit**

```bash
git add botlab/README.md
git commit -m "docs: record hedge backtest usage"
```
