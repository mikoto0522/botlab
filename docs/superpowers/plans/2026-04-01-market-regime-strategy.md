# Market Regime Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the BTC/ETH prediction-market strategy around explicit market regimes so continuation, reversion, and relative-value logic stop firing in the wrong environments.

**Architecture:** Keep the existing strategy engine and paper/backtest flow. Refactor the current multi-signal strategy into a two-layer system: first classify the market as directional, ranging, or noisy, then only allow the matching trade families for that regime.

**Tech Stack:** TypeScript, tsx, Node test runner

---

### Task 1: Freeze The Paper Failure Baseline

**Files:**
- Reference only: `C:\Users\Mikoto\Desktop\fsdownload\events.jsonl`
- Reference only: `C:\Users\Mikoto\Desktop\fsdownload\summary.json`
- Reference only: `C:\Users\Mikoto\Desktop\fsdownload\state.json`

- [ ] **Step 1: Record the live paper failure baseline**

Capture the current known baseline from the paper session:

- starting balance `100`
- ending balance `37.12`
- settled trades `193`
- realized result `-62.88`

Expected: the redesign is anchored to the real paper failure instead of only historical replay.

- [ ] **Step 2: Record the worst slices that must be addressed**

Use the paper session analysis to lock the main failure slices:

- `BTC up` middle-zone losses
- `ETH down` middle-zone losses
- weak `ETH up` slices
- the general pattern of frequent wins but still negative expectancy

Expected: later tuning is judged against these known failure slices, not against vague impressions.

### Task 2: Add Regime Routing Tests First

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\tests\engine.test.ts`

- [ ] **Step 1: Add a failing directional-regime continuation test**

Add a case where BTC or ETH is clearly directional and the strategy should allow a continuation entry.

- [ ] **Step 2: Add a failing ranging-regime reversion test**

Add a case where BTC or ETH is clearly ranging and the strategy should allow a reversion entry instead of a continuation entry.

- [ ] **Step 3: Add a failing noisy-regime hold test**

Add a case where movement is mixed enough that the strategy must stay flat.

- [ ] **Step 4: Add regime mismatch protection tests**

Add cases that prove:

- continuation does not fire inside a ranging setup
- reversion does not fire inside a directional setup
- relative-value logic does not override a noisy market state

- [ ] **Step 5: Run the focused tests and verify they fail**

Run:
`npm run test:botlab -- --test-name-pattern="regime|multi signal"`

Expected: FAIL before implementation changes.

### Task 3: Refactor The Strategy Into Two Layers

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\strategies\btc-eth-5m-multi-signal.strategy.ts`

- [ ] **Step 1: Introduce a shared regime summary**

Add a small shared market-state summary that measures:

- short net movement
- move alignment
- reversal frequency
- distance from the ends
- recent volume quality

Expected: all later decisions use one common state view.

- [ ] **Step 2: Implement explicit regime classification**

Classify each opportunity as:

- directional
- ranging
- noisy

Expected: every later signal decision is routed through a clear regime label instead of a mixed score soup.

- [ ] **Step 3: Restrict continuation logic to directional regimes**

Continuation logic must only be allowed when the classifier says the market is directional.

- [ ] **Step 4: Restrict reversion logic to ranging regimes**

Reversion logic must only be allowed when the classifier says the market is ranging.

- [ ] **Step 5: Force noise regimes to stay flat**

No trade family should be allowed to open in a noisy regime.

- [ ] **Step 6: Keep the cross-market path, but make it subordinate**

Relative-value logic may still exist, but only when both markets are in non-noisy compatible states.

- [ ] **Step 7: Re-run the focused tests**

Run:
`npm run test:botlab -- --test-name-pattern="regime|multi signal"`

Expected: PASS

### Task 4: Remove The Worst Paper-Proven Slices

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\strategies\btc-eth-5m-multi-signal.strategy.ts`

- [ ] **Step 1: Disable the paper-proven weakest asset-side / price-zone slices**

Start by blocking the combinations that clearly failed in the paper session unless the new regime routing gives them a strong structural reason to stay.

Expected: the first live-paper failure slices are no longer allowed by default.

- [ ] **Step 2: Keep only the direction families that match each regime**

Tune which sides remain legal per:

- asset
- regime
- price zone

Expected: the strategy no longer treats all sides as equally viable in all conditions.

- [ ] **Step 3: Leave size tuning for last**

Do not use stake changes as the primary fix.

Expected: the wrong trades are removed before trade size is revisited.

### Task 5: Verify On Historical Files Before Returning To Paper

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\README.md`

- [ ] **Step 1: Replay the BTC and ETH real-data files**

Run:
`npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-5m-last-month.csv`
`npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-eth-5m-last-month.csv`
`npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-5m-ytd.csv`
`npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-eth-5m-ytd.csv`

Expected: the redesign should not simply destroy activity or flip the whole strategy negative.

- [ ] **Step 2: Check the main diagnostic slices**

Review:

- asset / side breakdown
- entry-price-zone breakdown
- concentration of top winners

Expected: the strategy should no longer rely on the exact same bad slices that broke the paper run.

### Task 6: Final Verification And Documentation

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

- [ ] **Step 3: Record the accepted historical verification commands**

Expected: the final version has a clear evidence trail before it is put back into paper trading.

- [ ] **Step 4: Update the README summary**

Document:

- that the strategy is now regime-aware
- that it first classifies directional, ranging, and noisy states
- that continuation and reversion are now gated by regime
- which commands were used to verify the accepted version
