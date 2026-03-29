# Prediction Market Multi-Signal Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current low-frequency BTC/ETH hedge idea with a multi-signal prediction-market strategy that can reach `100+` recent-month trades while keeping return and trimmed-return positive.

**Architecture:** Reuse the existing backtest engines and analysis command. Build a new strategy that can evaluate continuation, mean-reversion, and relative-value opportunities on BTC and ETH 5m data, then choose between a single-leg trade and a paired trade from one shared scoring flow.

**Tech Stack:** TypeScript, tsx, Node test runner

---

### Task 1: Freeze The Baseline And Create The New Strategy Slot

**Files:**
- Create: `D:\Mikoto\botlab\botlab\strategies\btc-eth-5m-multi-signal.strategy.ts`
- Modify: `D:\Mikoto\botlab\botlab\README.md`

- [ ] **Step 1: Capture the real-data baseline from the current strategies**

Run:
`npm run botlab -- backtest-batch --strategy=btc-eth-5m --data=botlab/data/polymarket-btc-5m-last-month.csv`
`npm run botlab -- backtest-batch --strategy=btc-eth-5m --data=botlab/data/polymarket-eth-5m-last-month.csv`
`npm run botlab -- backtest-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`
`npm run botlab -- analyze-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`

Expected: record the current low-frequency behavior so the new strategy is compared against actual project baselines instead of guesses.

- [ ] **Step 2: Add the new strategy file without changing any existing strategy ids**

Create `btc-eth-5m-multi-signal.strategy.ts` as the new home for the redesign.

Expected: the project keeps the earlier strategies for comparison, but the new work happens in a clean strategy file instead of repeatedly mutating the old hedge design.

### Task 2: Define The Signal Contracts With Failing Tests

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\tests\engine.test.ts`

- [ ] **Step 1: Add a failing continuation test**

Add a case where BTC or ETH shows a clean short continuation pattern in the middle zone and the new strategy should return a single-leg continuation trade.

- [ ] **Step 2: Add a failing mean-reversion test**

Add a case where BTC or ETH has clearly stretched and the latest movement suggests slowing, and the new strategy should return a single-leg reversal trade.

- [ ] **Step 3: Add a failing relative-value pair test**

Add a case where BTC and ETH diverge enough that the new strategy should return a paired trade rather than a single-leg trade.

- [ ] **Step 4: Add failing protection tests**

Add hold cases for:
- noisy mixed recent movement
- very low volume
- clearly extreme prices near the ends

- [ ] **Step 5: Run the focused tests and verify they fail**

Run:
`npm run test:botlab -- --test-name-pattern="multi signal"`

Expected: FAIL because the new strategy is not implemented yet.

### Task 3: Implement The New Multi-Signal Strategy

**Files:**
- Create: `D:\Mikoto\botlab\botlab\strategies\btc-eth-5m-multi-signal.strategy.ts`

- [ ] **Step 1: Implement shared market helpers**

Add small helpers inside the strategy file for:
- recent movement measurement
- short-window stretch detection
- BTC/ETH relative-value gap detection
- quality filtering for noisy or extreme conditions

Expected: each signal family uses the same underlying market view instead of duplicating logic.

- [ ] **Step 2: Implement continuation scoring**

Use the recent candle shape and current binary price zone to identify short continuation opportunities and produce a confidence score plus preferred side.

- [ ] **Step 3: Implement mean-reversion scoring**

Use short-window stretch and latest-move slowdown to identify fade opportunities and produce a confidence score plus preferred side.

- [ ] **Step 4: Implement relative-value scoring**

Compare BTC and ETH recent behavior and identify when one side is rich or cheap enough to justify a paired trade.

- [ ] **Step 5: Combine the three signal families into one final decision**

Add one decision flow that:
- checks which signal families are active
- combines their scores
- rejects weak setups
- chooses either:
  - a single-leg trade for ordinary continuation or reversion
  - a paired trade for stronger relative-value opportunities

- [ ] **Step 6: Add capped size tiers**

Use a small number of stake tiers tied to the final confidence level, so weak but valid trades are smaller and stronger trades are larger.

- [ ] **Step 7: Re-run the focused tests**

Run:
`npm run test:botlab -- --test-name-pattern="multi signal"`

Expected: PASS

### Task 4: Use Real Data To Tune Toward The Hard Acceptance Target

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\strategies\btc-eth-5m-multi-signal.strategy.ts`

- [ ] **Step 1: Replay the real recent-month file and check trade count**

Run:
`npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-5m-last-month.csv`
`npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-eth-5m-last-month.csv`

Expected: the combined BTC plus ETH recent-month trade count should move toward `100+`. If the first pass is below target, adjust signal thresholds and rerun immediately.

- [ ] **Step 2: Replay the year-to-date files**

Run:
`npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-5m-ytd.csv`
`npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-eth-5m-ytd.csv`

Expected: year-to-date return stays positive while the strategy remains materially more active than the older low-frequency designs.

- [ ] **Step 3: If the paired path is used, replay the combined hedge file**

Run:
`npm run botlab -- backtest-hedge --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`
`npm run botlab -- analyze-hedge --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`

Expected: paired behavior is additive and not the only thing carrying the full strategy.

- [ ] **Step 4: Reject any version that meets frequency by breaking stability**

Use the real-data results to reject parameter sets where:
- recent-month trade count reaches `100+` but return turns negative
- return is positive but trimmed return turns negative
- one tiny slice of trades clearly carries the full result

Expected: only keep a version that improves all three dimensions together.

### Task 5: Final Verification And Documentation

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\README.md`

- [ ] **Step 1: Run the full test suite**

Run:
`npm run test:botlab`
`npm run test:botlab:smoke`

Expected: PASS

- [ ] **Step 2: Run the build**

Run:
`npm run build`

Expected: PASS

- [ ] **Step 3: Run the final accepted real-data command set**

Run the exact commands used to support the accepted final result, covering:
- recent-month BTC batch replay
- recent-month ETH batch replay
- year-to-date BTC replay
- year-to-date ETH replay
- paired replay if the final strategy still uses it
- stability analysis on the paired path if present

Expected:
- combined recent-month trade count reaches at least `100`
- recent-month return stays positive
- year-to-date return stays positive
- trimmed return stays positive on the checked paths

- [ ] **Step 4: Update the README summary**

Document:
- that the new strategy is multi-signal
- that it mixes continuation, reversion, and relative-value logic
- that it can choose single-leg or paired entries
- the real-data verification commands used for acceptance
