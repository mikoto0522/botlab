# BTC ETH State Hedge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current one-regime BTC/ETH paired hedge with a state-based version that treats trend, mean-reversion, and noise periods differently, then verify whether the result is less dependent on a few outsized winners.

**Architecture:** Keep the paired hedge engine and analysis command. Change only the strategy logic so it first classifies the current BTC/ETH relationship into one of three states, then applies a state-specific paired trade rule or skips the opportunity entirely. Reuse the existing hedge analysis to judge stability.

**Tech Stack:** TypeScript, tsx, Node test runner

---

### Task 1: State Research

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\strategies\btc-eth-5m-true-hedge.strategy.ts`
- Modify: `D:\Mikoto\botlab\botlab\README.md`

- [ ] **Step 1: Replay the current true hedge strategy on both real datasets**

Run:
`npm run botlab -- backtest-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`
`npm run botlab -- backtest-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-ytd.csv`

Expected: capture the baseline return, drawdown, and trade count before changing anything

- [ ] **Step 2: Run a local research script to compare trend, mean-reversion, and noise slices**

Run a temporary tsx script that:
- derives short-window BTC/ETH features from the same combined CSVs
- labels candidate states from the recent history
- measures per-state returns on both last-month and YTD data

Expected: identify one simple state definition that is not obviously worse than the current baseline and ideally improves trimmed-return stability

### Task 2: Failing Tests For State Behavior

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\tests\engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that prove:
- the strategy takes the trend pair when both assets still support continuation
- the strategy takes the reversal pair when the relative move is stretched but slowing
- the strategy holds in noisy mixed conditions

- [ ] **Step 2: Run the focused tests to confirm they fail**

Run:
`npm run test:botlab -- --test-name-pattern="true hedge state"`

Expected: FAIL because the current strategy does not expose the new state logic yet

### Task 3: Minimal State-Based Implementation

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\strategies\btc-eth-5m-true-hedge.strategy.ts`

- [ ] **Step 1: Add minimal state classification**

Implement three buckets only:
- trend
- revert
- noise

Use recent closes and short-window move shape only. Keep the first version small and understandable.

- [ ] **Step 2: Add state-specific paired trade rules**

Apply:
- trend: follow the leader and fade the laggard
- revert: fade the leader and back the laggard
- noise: hold

- [ ] **Step 3: Run the focused tests again**

Run:
`npm run test:botlab -- --test-name-pattern="true hedge state"`

Expected: PASS

### Task 4: Full Verification And Stability Check

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

- [ ] **Step 3: Replay both real datasets**

Run:
`npm run botlab -- backtest-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`
`npm run botlab -- backtest-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-ytd.csv`
`npm run botlab -- analyze-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`
`npm run botlab -- analyze-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-ytd.csv`

Expected:
- both commands succeed
- report whether trimmed return is less negative than the current baseline
- report whether monthly dependence is reduced

- [ ] **Step 4: Update the README summary**

Document:
- the three market states
- the new hedge rule at a high level
- the verification commands
