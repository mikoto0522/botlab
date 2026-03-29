# BTC Curve Smoothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the BTC side of `btc-eth-5m-multi-signal` clearly profitable while reducing year-to-date drawdown and lowering dependence on a tiny handful of outsized winners.

**Architecture:** Tighten the most unstable BTC signal buckets instead of flattening the whole strategy. Preserve the strongest BTC large-winner paths, downsize weaker BTC entries, and leave ETH behavior unchanged. Verify with the real BTC month and year-to-date datasets plus a fresh concentration check.

**Tech Stack:** TypeScript, tsx test runner, existing botlab strategy and batch backtest commands

---

### Task 1: Lock the BTC baseline and identify the unstable paths

**Files:**
- Modify: `D:/Mikoto/botlab/docs/superpowers/plans/2026-03-28-btc-smoother-curve.md`
- Read: `D:/Mikoto/botlab/botlab/strategies/btc-eth-5m-multi-signal.strategy.ts`

- [ ] **Step 1: Re-run the BTC real-data baseline**

Run:

```bash
npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-5m-last-month.csv
npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-5m-ytd.csv
```

Expected:
- last month stays near `30` trades, `+221.56%`, drawdown `7.89%`
- year to date stays near `98` trades, `+179.55%`, drawdown `50.94%`

- [ ] **Step 2: Recompute BTC concentration**

Run a temporary `tsx` analysis that reports:
- top winner concentration
- adjusted return after removing top winners
- monthly PnL split

Expected:
- top winners still dominate BTC
- adjusted BTC result remains much weaker than the headline result

- [ ] **Step 3: Write the baseline into working notes**

Record:
- which BTC setups still deserve full size
- which BTC setups should be downsized
- which BTC setups should be skipped

### Task 2: Add failing tests for the BTC paths we want to keep and the noisy ones we want to cut

**Files:**
- Modify: `D:/Mikoto/botlab/botlab/tests/engine.test.ts`
- Read: `D:/Mikoto/botlab/botlab/strategies/btc-eth-5m-multi-signal.strategy.ts`

- [ ] **Step 1: Write a failing test that preserves a strong BTC large-winner setup**

Add a test shaped like:

```ts
test('multi signal still buys the stronger BTC upper-band downside replay when the lead-in is clean enough', async () => {
  const result = await loadMultiSignalResult({
    market: {
      asset: 'BTC',
      price: 0.82,
      candles: /* strong lead-in candles */,
    },
  });

  assert.equal(result.action, 'buy');
  assert.equal(result.side, 'down');
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the expected reason**

Run:

```bash
npm run test:botlab -- --test-name-pattern="stronger BTC upper-band downside replay"
```

Expected:
- FAIL because the new BTC filter is not implemented yet

- [ ] **Step 3: Write a failing test that rejects a weaker BTC noisy setup**

Add a test shaped like:

```ts
test('multi signal skips the weaker BTC upper-band downside replay when the lead-in move is too soft', async () => {
  const result = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', {
    market: {
      asset: 'BTC',
      price: 0.82,
      candles: /* softer lead-in candles */,
    },
  });

  assert.equal(result.action, 'hold');
});
```

- [ ] **Step 4: Run the focused test and verify it fails for the expected reason**

Run:

```bash
npm run test:botlab -- --test-name-pattern="weaker BTC upper-band downside replay"
```

Expected:
- FAIL because the strategy still buys that weaker BTC path

- [ ] **Step 5: If sizing changes, add a failing test for smaller BTC size on weaker signals**

Add a test shaped like:

```ts
test('multi signal sizes weaker BTC entries below the strongest BTC entries', async () => {
  const strong = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', strongRuntime);
  const weak = await loadDirectStrategyDecision('btc-eth-5m-multi-signal', weakRuntime);

  assert.equal(strong.action, 'buy');
  assert.equal(weak.action, 'buy');
  assert.ok((weak.size ?? 0) < (strong.size ?? 0));
});
```

### Task 3: Implement the BTC smoothing change with the smallest code edit that satisfies the tests

**Files:**
- Modify: `D:/Mikoto/botlab/botlab/strategies/btc-eth-5m-multi-signal.strategy.ts`
- Modify: `D:/Mikoto/botlab/botlab/README.md`

- [ ] **Step 1: Tighten the unstable BTC replay rule instead of removing it**

Update the BTC replay rules to require stronger prior movement quality for the unstable upper-band BTC downside replay and any other BTC bucket proven to create drawdown without enough follow-through.

- [ ] **Step 2: If needed, add BTC-only weaker-entry sizing**

Implement the smallest sizing split that keeps stronger BTC setups near their current size while reducing weaker BTC entries.

- [ ] **Step 3: Keep ETH behavior untouched**

Do not change ETH thresholds or ETH replay filters during this task unless a shared helper needs a neutral refactor.

- [ ] **Step 4: Update the README baseline numbers only after fresh verification**

Replace the BTC numbers in the readme with the new real-data results once the full verification pass succeeds.

### Task 4: Verify with real BTC data and concentration checks

**Files:**
- Modify: `D:/Mikoto/botlab/botlab/README.md`
- Read: `D:/Mikoto/botlab/botlab/data/polymarket-btc-5m-last-month.csv`
- Read: `D:/Mikoto/botlab/botlab/data/polymarket-btc-5m-ytd.csv`

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm run test:botlab
npm run test:botlab:smoke
```

Expected:
- both commands pass cleanly

- [ ] **Step 2: Run the build**

Run:

```bash
npm run build
```

Expected:
- build exits 0

- [ ] **Step 3: Re-run the real BTC backtests**

Run:

```bash
npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-5m-last-month.csv
npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-5m-ytd.csv
```

Expected:
- BTC remains clearly positive
- BTC drawdown is lower than the current `50.94%` year-to-date baseline
- BTC month and year-to-date returns do not collapse into something trivial

- [ ] **Step 4: Re-run the BTC concentration check**

Run a temporary `tsx` analysis again and compare against the old BTC baseline.

Expected:
- top-winner concentration is lower than before
- adjusted BTC return is less fragile than before

- [ ] **Step 5: Sanity check the outcome against the design**

Confirm all of the following before reporting:
- large BTC trades still exist
- BTC curve is smoother
- BTC drawdown improved
- BTC result is less dependent on a tiny handful of trades
