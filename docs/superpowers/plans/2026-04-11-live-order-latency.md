# Live Order Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce live order latency by reacting to fresh realtime updates sooner and removing unnecessary pre-order round trips.

**Architecture:** Keep the current live loop shape, but let the market source wake the loop when a new realtime pair arrives. Reuse trusted current-cycle snapshots for execution when the source can prove they are fresh, cache repeated market-detail lookups, and stop blocking every quiet cycle on a balance fetch.

**Tech Stack:** TypeScript, Node.js, existing live/paper market-source and test harnesses.

---

### Task 1: Lock in latency-focused tests

**Files:**
- Modify: `botlab/tests/live-loop.test.ts`

- [ ] Add failing tests for event-driven wakeups, execution-snapshot reuse, quieter balance syncing, and repeated market-detail caching.

### Task 2: Add market-source wakeups and trusted execution reuse

**Files:**
- Modify: `botlab/paper/realtime-market-source.ts`
- Modify: `botlab/commands/live.ts`
- Modify: `botlab/live/loop.ts`

- [ ] Let the realtime source wait for the next usable update pair and expose that through the hybrid/live market source.
- [ ] Let the live market source reuse fresh current-cycle snapshots for execution when they came from realtime and still show visible depth.

### Task 3: Cut repeated detail and balance round trips

**Files:**
- Modify: `botlab/commands/live.ts`
- Modify: `botlab/live/loop.ts`

- [ ] Cache live market details by asset and slug for the current round.
- [ ] Sync live collateral on startup and after state-changing cycles, with a slower fallback cadence for quiet loops.

### Task 4: Verify end to end

**Files:**
- Modify: `botlab/tests/live-loop.test.ts`

- [ ] Run the focused live-loop test file and then the full botlab test suite.
- [ ] Confirm the new tests cover the latency paths and no existing live behavior regressed.
