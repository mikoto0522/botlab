# Extreme Reversal Paper Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new BTC/ETH 5m extreme-reversal strategy that can be launched in paper mode and only enters after an extreme quoted price, a local turn, and related-market confirmation.

**Architecture:** Add one standalone strategy file that reuses the current botlab market context, then extend engine tests to lock the new entry/hold behaviors and update the README so paper usage is obvious. No framework changes are required because the existing paper flow already loads any normal strategy.

**Tech Stack:** TypeScript, Node test runner, existing botlab CLI/paper flow

---

### Task 1: Lock the new strategy behavior with tests

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\tests\engine.test.ts`

- [ ] **Step 1: Write a failing helper for the new strategy**

Add a helper beside the other strategy loaders:

```ts
async function loadExtremeReversalResult(runtime: TempConfigRuntime) {
  return loadStrategyResult('extreme-reversal-5m', runtime);
}
```

- [ ] **Step 2: Write the failing up-reversal test**

Add a test that expects a buy-up decision when BTC is at an extreme low quoted entry, the last move turns up, and ETH also supports the turn.

- [ ] **Step 3: Run the single test and verify it fails for the missing strategy**

Run:

```bash
npm run test:botlab -- --test-name-pattern="extreme reversal buys up"
```

Expected: fail because `extreme-reversal-5m` is unknown.

- [ ] **Step 4: Write the failing down-reversal and hold tests**

Add:

- a symmetric buy-down test,
- a hold test when the related market disagrees,
- a hold test when the quoted entry is not extreme enough.

- [ ] **Step 5: Run the grouped tests and verify they fail for the expected reason**

Run:

```bash
npm run test:botlab -- --test-name-pattern="extreme reversal"
```

Expected: fail because the strategy does not exist yet.

### Task 2: Implement the new strategy

**Files:**
- Create: `D:\Mikoto\botlab\botlab\strategies\extreme-reversal-5m.strategy.ts`

- [ ] **Step 1: Add the new strategy file with defaults and market guards**

Create the strategy with:

- id `extreme-reversal-5m`
- BTC/ETH 5m only
- flat-state only
- low-volume hold

- [ ] **Step 2: Implement the extreme-price gate**

Use actual quoted entry price:

- `up` entry price for upside reversal
- `down` entry price for downside reversal

and compare it against low/high thresholds.

- [ ] **Step 3: Implement self-turn confirmation**

Use recent candles to detect:

- downside exhaustion plus first positive turn for `up`
- upside exhaustion plus first negative turn for `down`

- [ ] **Step 4: Implement related-market confirmation**

Read the opposite asset from `relatedMarkets` and require it to stop pushing against the reversal.

- [ ] **Step 5: Return small fixed-size entries and clear hold reasons**

Cap stake by balance and return simple reasons mentioning the passed or failed gate.

### Task 3: Make the strategy visible and usable

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\README.md`

- [ ] **Step 1: Add the strategy to bundled strategy docs**

Add one short line describing the new strategy.

- [ ] **Step 2: Add direct command examples**

Add:

```bash
npm run botlab -- describe-strategy --strategy=extreme-reversal-5m
npm run botlab -- paper --strategy=extreme-reversal-5m --session=my-paper --interval=30 --config=botlab/config/paper-100u-5u.json
```

### Task 4: Verify the new strategy end to end

**Files:**
- No code changes expected

- [ ] **Step 1: Run the focused extreme-reversal tests**

Run:

```bash
npm run test:botlab -- --test-name-pattern="extreme reversal"
```

Expected: PASS

- [ ] **Step 2: Run the full botlab tests**

Run:

```bash
npm run test:botlab
npm run test:botlab:smoke
```

Expected: PASS

- [ ] **Step 3: Run the build**

Run:

```bash
npm run build
```

Expected: PASS

- [ ] **Step 4: Run a paper smoke session with the new strategy**

Run:

```bash
npm run botlab -- paper --strategy=extreme-reversal-5m --session=extreme-reversal-smoke --interval=0 --max-cycles=1 --config=botlab/config/paper-100u-5u.json
```

Expected: command starts successfully, prints one cycle, and creates a session folder.
