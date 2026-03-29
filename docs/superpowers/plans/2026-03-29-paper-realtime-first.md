# Paper Realtime-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make paper trading use realtime market updates by default, while automatically falling back to polling when realtime is unavailable.

**Architecture:** Keep the current paper loop, paper wallet, and CLI behavior intact. Replace only the market-input layer with a hybrid source that can read from realtime websocket snapshots first and drop back to the existing REST polling path when websocket data is missing, stale, or disconnected.

**Tech Stack:** TypeScript, Node.js built-in `fetch`, Node.js built-in `WebSocket`, existing Botlab paper loop and CLI.

---

## File Structure

### New files

- `D:\Mikoto\botlab\botlab\paper\realtime-market-source.ts`
  Owns websocket connection setup, message parsing, latest-snapshot cache, and reconnect logic for BTC / ETH 5m market data.

### Modified files

- `D:\Mikoto\botlab\botlab\paper\market-source.ts`
  Keeps the REST polling source, exposes market-ref helpers used by both polling and realtime, and adds any shared normalization helpers needed by both paths.
- `D:\Mikoto\botlab\botlab\commands\paper.ts`
  Switches the live paper command from polling-only input to the new realtime-first hybrid source.
- `D:\Mikoto\botlab\botlab\tests\paper-market-source.test.ts`
  Extends source coverage for hybrid fallback and market-ref refresh behavior.
- `D:\Mikoto\botlab\botlab\tests\cli-smoke.test.ts`
  Keeps smoke coverage for the paper command while avoiding accidental session reuse.
- `D:\Mikoto\botlab\botlab\README.md`
  Documents realtime-first behavior and polling fallback in plain usage notes.

## Task 1: Add Realtime Snapshot Cache And Message Normalization

**Files:**
- Create: `D:\Mikoto\botlab\botlab\paper\realtime-market-source.ts`
- Test: `D:\Mikoto\botlab\botlab\tests\paper-market-source.test.ts`

- [ ] **Step 1: Write the failing websocket normalization tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRealtimeSnapshotCache,
  ingestRealtimeBestBidAsk,
} from '../paper/realtime-market-source.js';

test('ingestRealtimeBestBidAsk updates the cached BTC snapshot from a realtime payload', () => {
  const cache = createRealtimeSnapshotCache();

  ingestRealtimeBestBidAsk(cache, {
    asset: 'BTC',
    slug: 'btc-updown-5m-1774781400',
    bucketStartEpoch: 1774781400,
    bucketStartTime: '2026-03-29T10:50:00.000Z',
    question: 'Bitcoin Up or Down - March 29, 10:50AM-10:55AM UTC',
    fetchedAt: '2026-03-29T10:53:27.000Z',
    upPrice: 0.53,
    downPrice: 0.47,
    upAsk: 0.54,
    downAsk: 0.48,
  });

  const snapshot = cache.latestByAsset.BTC;
  assert.ok(snapshot);
  assert.equal(snapshot.slug, 'btc-updown-5m-1774781400');
  assert.equal(snapshot.upAsk, 0.54);
  assert.equal(snapshot.downAsk, 0.48);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test botlab/tests/paper-market-source.test.ts --test-name-pattern "realtime"`

Expected: FAIL with module-not-found or missing export errors for `../paper/realtime-market-source.js`.

- [ ] **Step 3: Write the minimal realtime cache and update helper**

```ts
import type { PaperMarketAsset, PaperMarketSnapshot } from './market-source.js';

export interface RealtimeSnapshotCache {
  latestByAsset: Partial<Record<PaperMarketAsset, PaperMarketSnapshot>>;
}

export interface RealtimeBestBidAskInput {
  asset: PaperMarketAsset;
  slug: string;
  bucketStartEpoch: number;
  bucketStartTime: string;
  question: string;
  fetchedAt: string;
  upPrice: number;
  downPrice: number;
  upAsk: number;
  downAsk: number;
}

export function createRealtimeSnapshotCache(): RealtimeSnapshotCache {
  return {
    latestByAsset: {},
  };
}

export function ingestRealtimeBestBidAsk(
  cache: RealtimeSnapshotCache,
  input: RealtimeBestBidAskInput,
): void {
  cache.latestByAsset[input.asset] = {
    asset: input.asset,
    slug: input.slug,
    question: input.question,
    active: true,
    closed: false,
    acceptingOrders: true,
    eventStartTime: input.bucketStartTime,
    endDate: new Date((input.bucketStartEpoch + 300) * 1000).toISOString(),
    bucketStartTime: input.bucketStartTime,
    bucketStartEpoch: input.bucketStartEpoch,
    upPrice: input.upPrice,
    downPrice: input.downPrice,
    upAsk: input.upAsk,
    downAsk: input.downAsk,
    downAskDerivedFromBestBid: false,
    volume: null,
    fetchedAt: input.fetchedAt,
  };
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npx tsx --test botlab/tests/paper-market-source.test.ts --test-name-pattern "realtime"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add botlab/paper/realtime-market-source.ts botlab/tests/paper-market-source.test.ts
git commit -m "feat: add realtime paper snapshot cache"
```

## Task 2: Build The Hybrid Realtime-First Market Source

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\paper\realtime-market-source.ts`
- Modify: `D:\Mikoto\botlab\botlab\paper\market-source.ts`
- Modify: `D:\Mikoto\botlab\botlab\tests\paper-market-source.test.ts`

- [ ] **Step 1: Write the failing hybrid-source fallback tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHybridPaperMarketSource } from '../paper/realtime-market-source.js';

test('hybrid paper source falls back to polling when realtime is stale', async () => {
  const hybrid = createHybridPaperMarketSource({
    now: () => new Date('2026-03-29T10:53:40.000Z'),
    staleAfterMs: 5_000,
    pollingSource: {
      getCurrentSnapshots: async () => ([
        {
          asset: 'BTC',
          slug: 'btc-updown-5m-1774781400',
          question: 'Bitcoin Up or Down',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-03-29T10:50:00.000Z',
          endDate: '2026-03-29T10:55:00.000Z',
          bucketStartTime: '2026-03-29T10:50:00.000Z',
          bucketStartEpoch: 1774781400,
          upPrice: 0.52,
          downPrice: 0.48,
          upAsk: 0.53,
          downAsk: 0.49,
          downAskDerivedFromBestBid: false,
          volume: 25000,
          fetchedAt: '2026-03-29T10:53:40.000Z',
        },
        {
          asset: 'ETH',
          slug: 'eth-updown-5m-1774781400',
          question: 'Ethereum Up or Down',
          active: true,
          closed: false,
          acceptingOrders: true,
          eventStartTime: '2026-03-29T10:50:00.000Z',
          endDate: '2026-03-29T10:55:00.000Z',
          bucketStartTime: '2026-03-29T10:50:00.000Z',
          bucketStartEpoch: 1774781400,
          upPrice: 0.49,
          downPrice: 0.51,
          upAsk: 0.5,
          downAsk: 0.52,
          downAskDerivedFromBestBid: false,
          volume: 25000,
          fetchedAt: '2026-03-29T10:53:40.000Z',
        },
      ]),
    },
    realtimeSource: {
      getLatestSnapshots: async () => [],
      close: async () => {},
    },
  });

  const snapshots = await hybrid.getCurrentSnapshots();
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0]?.slug, 'btc-updown-5m-1774781400');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test botlab/tests/paper-market-source.test.ts --test-name-pattern "hybrid"`

Expected: FAIL with missing export or missing function errors for `createHybridPaperMarketSource`.

- [ ] **Step 3: Implement the hybrid source**

```ts
export interface HybridPaperMarketSource {
  getCurrentSnapshots: () => Promise<PaperMarketSnapshot[]>;
  getSnapshotBySlug: (slug: string, asset: PaperMarketAsset) => Promise<PaperMarketSnapshot>;
  close: () => Promise<void>;
}

export function createHybridPaperMarketSource(input: {
  now?: () => Date;
  staleAfterMs?: number;
  pollingSource: {
    getCurrentSnapshots: () => Promise<PaperMarketSnapshot[]>;
    getSnapshotBySlug: (slug: string, asset: PaperMarketAsset) => Promise<PaperMarketSnapshot>;
  };
  realtimeSource: {
    getLatestSnapshots: () => Promise<PaperMarketSnapshot[]>;
    close: () => Promise<void>;
  };
}): HybridPaperMarketSource {
  const now = input.now ?? (() => new Date());
  const staleAfterMs = input.staleAfterMs ?? 15_000;

  return {
    async getCurrentSnapshots() {
      const latest = await input.realtimeSource.getLatestSnapshots();
      const fresh = latest.length === 2 && latest.every((snapshot) => {
        return now().getTime() - Date.parse(snapshot.fetchedAt) <= staleAfterMs;
      });

      if (fresh) {
        return latest;
      }

      return input.pollingSource.getCurrentSnapshots();
    },
    getSnapshotBySlug(slug, asset) {
      return input.pollingSource.getSnapshotBySlug(slug, asset);
    },
    close() {
      return input.realtimeSource.close();
    },
  };
}
```

- [ ] **Step 4: Run the focused market-source tests**

Run: `npx tsx --test botlab/tests/paper-market-source.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add botlab/paper/realtime-market-source.ts botlab/paper/market-source.ts botlab/tests/paper-market-source.test.ts
git commit -m "feat: add hybrid realtime paper market source"
```

## Task 3: Wire The Paper Command To The Realtime-First Source

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\commands\paper.ts`
- Modify: `D:\Mikoto\botlab\botlab\tests\cli-smoke.test.ts`
- Modify: `D:\Mikoto\botlab\botlab\README.md`

- [ ] **Step 1: Write the failing smoke expectation for realtime-first behavior**

```ts
assert.match(result.stdout, /cycle \d+:/);
assert.match(result.stdout, /Paper Session Summary/);
```

Add one more assertion that the command still succeeds when run with a bounded live session name after the source swap.

- [ ] **Step 2: Run smoke coverage to verify the new expectation fails if the command is not wired**

Run: `npx tsx --test botlab/tests/cli-smoke.test.ts --test-name-pattern "paper command"`

Expected: FAIL if the paper command is still using the older polling-only source path.

- [ ] **Step 3: Switch the paper command to the hybrid source**

```ts
import {
  createHybridPaperMarketSource,
  createRealtimePaperMarketSource,
} from '../paper/realtime-market-source.js';

const pollingSource = {
  getCurrentSnapshots: createLivePaperMarketSource(),
  getSnapshotBySlug: async (slug: string, asset: PaperMarketAsset) => {
    return fetchPaperMarketSnapshot(buildRefFromSlug(asset, slug));
  },
};

const realtimeSource = createRealtimePaperMarketSource({
  pollingSource,
});

const marketSource = createHybridPaperMarketSource({
  pollingSource,
  realtimeSource,
});
```

Keep the fixture path behavior unchanged so offline smoke tests still run without live network access.

- [ ] **Step 4: Update README**

```md
Paper trading now prefers realtime market updates and automatically falls back to polling when realtime data is missing or disconnected.
```

- [ ] **Step 5: Run smoke tests**

Run: `npm run test:botlab:smoke`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add botlab/commands/paper.ts botlab/tests/cli-smoke.test.ts botlab/README.md
git commit -m "feat: wire paper trading to realtime-first source"
```

## Task 4: Verify The Realtime-First Paper Session

**Files:**
- Verify runtime behavior only

- [ ] **Step 1: Run focused paper tests**

Run: `npm run test:botlab -- --test-name-pattern "paper"`

Expected: PASS

- [ ] **Step 2: Run the full test suite**

Run: `npm run test:botlab`

Expected: PASS

- [ ] **Step 3: Run the build**

Run: `npm run build`

Expected: PASS

- [ ] **Step 4: Run a bounded realtime-first paper session**

Run: `npm run botlab -- paper --strategy=btc-eth-5m-multi-signal --session=realtime-check --interval=0 --max-cycles=1`

Expected:

- one readable cycle line in the terminal
- final paper summary prints
- `D:\Mikoto\botlab\botlab\paper-sessions\realtime-check\state.json` exists
- session files are updated without crashing even if realtime falls back to polling

- [ ] **Step 5: Run the same session again to verify resume still works**

Run: `npm run botlab -- paper --strategy=btc-eth-5m-multi-signal --session=realtime-check --interval=0 --max-cycles=1`

Expected:

- command succeeds again
- cycle count increases
- the same session directory is reused

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: verify realtime-first paper trading flow"
```
