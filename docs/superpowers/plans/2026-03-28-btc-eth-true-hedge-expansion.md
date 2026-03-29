# BTC ETH True Hedge Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the current BTC/ETH true hedge so it opens clearly more paired trades and improves return on both real datasets without falling back to a negative trimmed-return profile.

**Architecture:** Keep the existing hedge engine and analysis flow unchanged. Only widen the current `btc-eth-5m-true-hedge` entry gates, adjust the paired position size, and update the tests plus README so the looser behavior is still explicit and verifiable.

**Tech Stack:** TypeScript, tsx, Node test runner

---

### Task 1: Capture The Baseline And Pick The Relaxation Targets

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\strategies\btc-eth-5m-true-hedge.strategy.ts`
- Modify: `D:\Mikoto\botlab\botlab\README.md`

- [ ] **Step 1: Replay the current true hedge strategy on both real datasets**

Run:
`npm run botlab -- backtest-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`
`npm run botlab -- backtest-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-ytd.csv`
`npm run botlab -- analyze-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`
`npm run botlab -- analyze-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-ytd.csv`

Expected: confirm the current baseline of `4` trades and `+4.65%` on last-month data, plus `13` trades and `+26.27%` on year-to-date data, with positive trimmed return on both files.

- [ ] **Step 2: Identify the most restrictive gates to relax**

Review the current defaults in `btc-eth-5m-true-hedge.strategy.ts` and target these first:
- `gapMin`
- `revertGap`
- `leaderAlignMin`
- `followerAlignMin`
- `minBinaryPrice`
- `maxBinaryPrice`
- `maxStakePerLeg`

Expected: choose a smaller edge-gap requirement, a slightly wider price zone, slightly lower alignment requirements, and a higher per-leg cap so the strategy can accept more mid-quality opportunities without removing the basic safety floor.

### Task 2: Lock In The New Behavior With Tests

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\tests\engine.test.ts`

- [ ] **Step 1: Add or tighten tests for the looser trend behavior**

Add a case that proves the true hedge can now open on a setup that was previously borderline but still directionally clean enough to trust.

- [ ] **Step 2: Add or tighten tests for the looser reversion behavior**

Add a case that proves the true hedge can now open a reversion pair on a stretched setup that does not meet the older, stricter thresholds but does meet the new relaxed thresholds.

- [ ] **Step 3: Keep the noisy hold protection covered**

Preserve a case where mixed BTC/ETH history still returns `hold`, so widening the gates does not silently turn the strategy into a noise chaser.

- [ ] **Step 4: Run the focused tests before implementation changes**

Run:
`npm run test:botlab -- --test-name-pattern="true hedge state"`

Expected: FAIL until the strategy defaults and classification thresholds are updated to match the new tests.

### Task 3: Relax The State Gates And Increase Participation

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\strategies\btc-eth-5m-true-hedge.strategy.ts`

- [ ] **Step 1: Loosen the tradability thresholds**

Update the defaults so the strategy:
- accepts a smaller BTC/ETH gap before calling the setup tradable
- tolerates slightly less perfect recent alignment
- accepts a somewhat wider safe middle price zone

Expected: more groups classify as `trend` or `revert` instead of `noise`.

- [ ] **Step 2: Increase the per-leg size cap**

Raise `maxStakePerLeg` so added opportunities have more impact on total return while still respecting available balance.

Expected: when a paired trade opens, each leg can deploy more capital than the current `20` cap.

- [ ] **Step 3: Re-run the focused state tests**

Run:
`npm run test:botlab -- --test-name-pattern="true hedge state"`

Expected: PASS

### Task 4: Full Verification And Result Check

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

- [ ] **Step 3: Replay both real datasets and compare against the baseline**

Run:
`npm run botlab -- backtest-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`
`npm run botlab -- backtest-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-ytd.csv`
`npm run botlab -- analyze-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv`
`npm run botlab -- analyze-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-ytd.csv`

Expected:
- paired trade count is higher than `4` on last-month data and higher than `13` on year-to-date data
- return is higher than `+4.65%` on last-month data and higher than `+26.27%` on year-to-date data
- trimmed return stays positive on both datasets
- if return rises but trimmed return turns negative, reject that parameter set and tighten the strategy again

- [ ] **Step 4: Update the README summary**

Document:
- that the true hedge now uses looser state gates than the earlier state-based version
- that it intentionally accepts more mid-quality BTC/ETH setups
- the verification commands used for the real datasets
