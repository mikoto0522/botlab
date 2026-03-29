# Paper Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a resumable paper-trading command for `btc-eth-5m-multi-signal` that runs continuously against live BTC and ETH 5m Polymarket markets using the same loop shape a later live mode will use.

**Architecture:** Add a shared long-running loop that separates market fetching, session persistence, strategy evaluation, and execution. Implement a paper-only execution sink first, store session state in local files, and wire a new `paper` CLI command that can resume named sessions and stop automatically during tests with a bounded cycle count.

**Tech Stack:** TypeScript, Node.js built-in `fetch`, local JSON/JSONL files, existing botlab CLI and strategy runtime.

---

## File Structure

### New files

- `D:\Mikoto\botlab\botlab\paper\types.ts`
  Defines paper-session state, rolling market history, event records, market snapshot shape, and loop options.
- `D:\Mikoto\botlab\botlab\paper\session-store.ts`
  Reads and writes `state.json`, `summary.json`, and `events.jsonl`.
- `D:\Mikoto\botlab\botlab\paper\market-source.ts`
  Fetches current BTC and ETH 5m markets, discovers active slugs, and normalizes snapshots.
- `D:\Mikoto\botlab\botlab\paper\executor.ts`
  Applies strategy decisions to paper wallet and open positions.
- `D:\Mikoto\botlab\botlab\paper\loop.ts`
  Runs the polling loop, composes the context, calls the strategy, and persists results.
- `D:\Mikoto\botlab\botlab\commands\paper.ts`
  User-facing command wrapper for the loop runner.
- `D:\Mikoto\botlab\botlab\tests\paper-session.test.ts`
  Tests session persistence and event logging.
- `D:\Mikoto\botlab\botlab\tests\paper-market-source.test.ts`
  Tests active-market discovery and snapshot normalization with mocked fetch responses.
- `D:\Mikoto\botlab\botlab\tests\paper-loop.test.ts`
  Tests end-to-end paper cycles, resume flow, and bounded runs.

### Modified files

- `D:\Mikoto\botlab\botlab\cli.ts`
  Add `paper` command parsing.
- `D:\Mikoto\botlab\botlab\README.md`
  Document paper session usage, resume behavior, and log file locations.
- `D:\Mikoto\botlab\botlab\tests\cli-smoke.test.ts`
  Add smoke coverage for the new CLI command with bounded cycles.

### Runtime output directory

- `D:\Mikoto\botlab\botlab\paper-sessions\<session-name>\`
  Stores one paper account per named session.

## Task 1: Define Paper Session Types And Storage Paths

**Files:**
- Create: `D:\Mikoto\botlab\botlab\paper\types.ts`
- Test: `D:\Mikoto\botlab\botlab\tests\paper-session.test.ts`

- [ ] **Step 1: Write the failing test for session path creation**

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolvePaperSessionPaths, createEmptyPaperState } from '../paper/types.js';

test('resolvePaperSessionPaths points at the expected files', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-root-'));
  const paths = resolvePaperSessionPaths(rootDir, 'demo-session');

  assert.equal(paths.sessionDir, path.join(rootDir, 'paper-sessions', 'demo-session'));
  assert.equal(paths.statePath, path.join(paths.sessionDir, 'state.json'));
  assert.equal(paths.summaryPath, path.join(paths.sessionDir, 'summary.json'));
  assert.equal(paths.eventsPath, path.join(paths.sessionDir, 'events.jsonl'));

  const state = createEmptyPaperState('demo-session', 1000);
  assert.equal(state.balance.cash, 1000);
  assert.equal(state.positions.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test botlab/tests/paper-session.test.ts --test-name-pattern "resolvePaperSessionPaths"`

Expected: FAIL with module-not-found for `../paper/types.js`.

- [ ] **Step 3: Write the minimal type and path helpers**

```ts
import path from 'node:path';

export interface PaperBalance {
  cash: number;
  equity: number;
}

export interface PaperPosition {
  asset: 'BTC' | 'ETH';
  marketSlug: string;
  side: 'up' | 'down';
  stake: number;
  entryPrice: number;
  openedAt: string;
}

export interface PaperHistoryPoint {
  asset: 'BTC' | 'ETH';
  timestamp: string;
  upPrice: number;
  downPrice: number;
  upAsk: number;
  downAsk: number;
  volume: number;
}

export interface PaperMarketSnapshot extends PaperHistoryPoint {
  slug: string;
  question: string;
  endDate: string;
}

export interface PaperSessionState {
  session: string;
  createdAt: string;
  updatedAt: string;
  balance: PaperBalance;
  positions: PaperPosition[];
  tradeCount: number;
  cycleCount: number;
  history: Record<'BTC' | 'ETH', PaperHistoryPoint[]>;
}

export interface PaperSessionPaths {
  sessionDir: string;
  statePath: string;
  summaryPath: string;
  eventsPath: string;
}

export function resolvePaperSessionPaths(rootDir: string, session: string): PaperSessionPaths {
  const sessionDir = path.join(rootDir, 'paper-sessions', session);
  return {
    sessionDir,
    statePath: path.join(sessionDir, 'state.json'),
    summaryPath: path.join(sessionDir, 'summary.json'),
    eventsPath: path.join(sessionDir, 'events.jsonl'),
  };
}

export function createEmptyPaperState(session: string, startingBalance: number): PaperSessionState {
  const now = new Date().toISOString();
  return {
    session,
    createdAt: now,
    updatedAt: now,
    balance: {
      cash: startingBalance,
      equity: startingBalance,
    },
    positions: [],
    tradeCount: 0,
    cycleCount: 0,
    history: {
      BTC: [],
      ETH: [],
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `tsx --test botlab/tests/paper-session.test.ts --test-name-pattern "resolvePaperSessionPaths"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add botlab/paper/types.ts botlab/tests/paper-session.test.ts
git commit -m "feat: add paper session types"
```

## Task 2: Build The Session Store

**Files:**
- Create: `D:\Mikoto\botlab\botlab\paper\session-store.ts`
- Modify: `D:\Mikoto\botlab\botlab\tests\paper-session.test.ts`

- [ ] **Step 1: Write the failing tests for create, append, and resume**

```ts
import { appendPaperEvent, loadPaperSession, savePaperSession } from '../paper/session-store.js';

test('savePaperSession creates state and summary files', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-store-'));
  const state = createEmptyPaperState('resume-me', 1000);

  savePaperSession(rootDir, state);

  const sessionDir = path.join(rootDir, 'paper-sessions', 'resume-me');
  assert.equal(fs.existsSync(path.join(sessionDir, 'state.json')), true);
  assert.equal(fs.existsSync(path.join(sessionDir, 'summary.json')), true);
});

test('loadPaperSession resumes a previously saved session', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-store-'));
  const state = createEmptyPaperState('resume-me', 1000);
  state.tradeCount = 3;

  savePaperSession(rootDir, state);
  const loaded = loadPaperSession(rootDir, 'resume-me', 500);

  assert.equal(loaded.tradeCount, 3);
  assert.equal(loaded.balance.cash, 1000);
});

test('appendPaperEvent writes jsonl events without overwriting older entries', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-store-'));
  const state = createEmptyPaperState('resume-me', 1000);

  savePaperSession(rootDir, state);
  appendPaperEvent(rootDir, 'resume-me', { type: 'cycle', timestamp: '2026-03-28T00:00:00.000Z' });
  appendPaperEvent(rootDir, 'resume-me', { type: 'cycle', timestamp: '2026-03-28T00:05:00.000Z' });

  const events = fs.readFileSync(path.join(rootDir, 'paper-sessions', 'resume-me', 'events.jsonl'), 'utf8').trim().split('\n');
  assert.equal(events.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `tsx --test botlab/tests/paper-session.test.ts`

Expected: FAIL with module-not-found for `../paper/session-store.js`.

- [ ] **Step 3: Implement the store**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { createEmptyPaperState, resolvePaperSessionPaths, type PaperSessionState } from './types.js';

export function loadPaperSession(rootDir: string, session: string, startingBalance: number): PaperSessionState {
  const paths = resolvePaperSessionPaths(rootDir, session);
  if (!fs.existsSync(paths.statePath)) {
    return createEmptyPaperState(session, startingBalance);
  }

  return JSON.parse(fs.readFileSync(paths.statePath, 'utf8')) as PaperSessionState;
}

export function savePaperSession(rootDir: string, state: PaperSessionState): void {
  const paths = resolvePaperSessionPaths(rootDir, state.session);
  fs.mkdirSync(paths.sessionDir, { recursive: true });
  fs.writeFileSync(paths.statePath, JSON.stringify(state, null, 2));
  fs.writeFileSync(paths.summaryPath, JSON.stringify({
    session: state.session,
    updatedAt: state.updatedAt,
    cash: state.balance.cash,
    equity: state.balance.equity,
    tradeCount: state.tradeCount,
    cycles: state.cycleCount,
    openPositions: state.positions.length,
  }, null, 2));
}

export function appendPaperEvent(rootDir: string, session: string, event: Record<string, unknown>): void {
  const paths = resolvePaperSessionPaths(rootDir, session);
  fs.mkdirSync(paths.sessionDir, { recursive: true });
  fs.appendFileSync(paths.eventsPath, `${JSON.stringify(event)}\n`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `tsx --test botlab/tests/paper-session.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add botlab/paper/session-store.ts botlab/tests/paper-session.test.ts
git commit -m "feat: add paper session store"
```

## Task 3: Add Live Market Discovery And Snapshot Fetching

**Files:**
- Create: `D:\Mikoto\botlab\botlab\paper\market-source.ts`
- Create: `D:\Mikoto\botlab\botlab\tests\paper-market-source.test.ts`

- [ ] **Step 1: Write the failing test for active-market discovery**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverActive5mMarkets } from '../paper/market-source.js';

test('discoverActive5mMarkets keeps one active BTC and one active ETH 5m market', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ([
      { slug: 'btc-updown-5m-1772850900', active: true, closed: false, question: 'Bitcoin Up or Down - March 6, 9:35PM-9:40PM ET' },
      { slug: 'eth-updown-5m-1772850900', active: true, closed: false, question: 'Ethereum Up or Down - March 6, 9:35PM-9:40PM ET' },
      { slug: 'btc-above-123456', active: true, closed: false, question: 'Bitcoin above 100k?' },
    ]),
  }) as Response;

  const markets = await discoverActive5mMarkets(fakeFetch);
  assert.deepEqual(markets.map((market) => market.asset), ['BTC', 'ETH']);
});
```

- [ ] **Step 2: Write the failing test for snapshot normalization**

```ts
import { fetchPaperMarketSnapshot } from '../paper/market-source.js';

test('fetchPaperMarketSnapshot normalizes up, down, ask, and timing fields', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      slug: 'btc-updown-5m-1772850900',
      question: 'Bitcoin Up or Down - March 6, 9:35PM-9:40PM ET',
      endDate: '2026-03-28T12:40:00.000Z',
      outcomePrices: '[0.52,0.48]',
      bestAsk: '[0.53,0.49]',
      volume: '25000',
    }),
  }) as Response;

  const snapshot = await fetchPaperMarketSnapshot(fakeFetch, { asset: 'BTC', slug: 'btc-updown-5m-1772850900' });
  assert.equal(snapshot.asset, 'BTC');
  assert.equal(snapshot.upPrice, 0.52);
  assert.equal(snapshot.upAsk, 0.53);
  assert.equal(snapshot.downAsk, 0.49);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `tsx --test botlab/tests/paper-market-source.test.ts`

Expected: FAIL with module-not-found for `../paper/market-source.js`.

- [ ] **Step 4: Implement the market source with injectable fetch**

```ts
import fs from 'node:fs';

const GAMMA_BASE_URL = 'https://gamma-api.polymarket.com';

export async function discoverActive5mMarkets(fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${GAMMA_BASE_URL}/markets`);
  const rows = await response.json() as Array<Record<string, unknown>>;

  return rows
    .filter((row) => row.active === true && row.closed !== true)
    .filter((row) => typeof row.slug === 'string')
    .filter((row) => row.slug.startsWith('btc-updown-5m-') || row.slug.startsWith('eth-updown-5m-'))
    .map((row) => ({
      asset: String(row.slug).startsWith('btc-') ? 'BTC' as const : 'ETH' as const,
      slug: String(row.slug),
    }))
    .slice(0, 2);
}

export async function fetchPaperMarketSnapshot(
  fetchImpl: typeof fetch = fetch,
  market: { asset: 'BTC' | 'ETH'; slug: string },
) {
  const response = await fetchImpl(`${GAMMA_BASE_URL}/markets/slug/${market.slug}`);
  const raw = await response.json() as Record<string, unknown>;
  const prices = JSON.parse(String(raw.outcomePrices ?? '[]')) as number[];
  const asks = JSON.parse(String(raw.bestAsk ?? '[]')) as number[];

  return {
    asset: market.asset,
    slug: market.slug,
    question: String(raw.question ?? ''),
    endDate: String(raw.endDate ?? ''),
    upPrice: prices[0] ?? 0,
    downPrice: prices[1] ?? 0,
    upAsk: asks[0] ?? prices[0] ?? 0,
    downAsk: asks[1] ?? prices[1] ?? 0,
    volume: Number(raw.volume ?? 0),
    timestamp: new Date().toISOString(),
  };
}

export function createLivePaperMarketSource(fetchImpl: typeof fetch = fetch) {
  return async () => {
    const active = await discoverActive5mMarkets(fetchImpl);
    return Promise.all(active.map((market) => fetchPaperMarketSnapshot(fetchImpl, market)));
  };
}

export function createFixturePaperMarketSource(fixturePath: string) {
  return async () => JSON.parse(await fs.promises.readFile(fixturePath, 'utf8')) as PaperMarketSnapshot[];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `tsx --test botlab/tests/paper-market-source.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add botlab/paper/market-source.ts botlab/tests/paper-market-source.test.ts
git commit -m "feat: add paper market source"
```

## Task 4: Implement Paper Execution And The Shared Loop

**Files:**
- Create: `D:\Mikoto\botlab\botlab\paper\executor.ts`
- Create: `D:\Mikoto\botlab\botlab\paper\loop.ts`
- Modify: `D:\Mikoto\botlab\botlab\tests\paper-loop.test.ts`
- Modify: `D:\Mikoto\botlab\botlab\paper\types.ts`

- [ ] **Step 1: Write the failing test for one bounded paper cycle**

```ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runPaperLoop } from '../paper/loop.js';

test('runPaperLoop executes bounded cycles and persists a resumed session', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-loop-'));

  const fakeMarketSource = async () => ([
    {
      asset: 'BTC',
      slug: 'btc-updown-5m-1772850900',
      question: 'Bitcoin Up or Down',
      endDate: '2026-03-28T12:40:00.000Z',
      upPrice: 0.49,
      downPrice: 0.51,
      upAsk: 0.5,
      downAsk: 0.52,
      volume: 25000,
      timestamp: '2026-03-28T12:36:00.000Z',
    },
    {
      asset: 'ETH',
      slug: 'eth-updown-5m-1772850900',
      question: 'Ethereum Up or Down',
      endDate: '2026-03-28T12:40:00.000Z',
      upPrice: 0.48,
      downPrice: 0.52,
      upAsk: 0.49,
      downAsk: 0.53,
      volume: 25000,
      timestamp: '2026-03-28T12:36:00.000Z',
    },
  ]);

  await runPaperLoop({
    rootDir,
    startingBalance: 1000,
    strategyId: 'btc-eth-5m-multi-signal',
    session: 'demo',
    intervalMs: 1,
    maxCycles: 2,
    marketSource: fakeMarketSource,
  });

  const summaryPath = path.join(rootDir, 'paper-sessions', 'demo', 'summary.json');
  assert.equal(fs.existsSync(summaryPath), true);
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as { cycles: number };
  assert.equal(summary.cycles, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test botlab/tests/paper-loop.test.ts`

Expected: FAIL with module-not-found for `../paper/loop.js`.

- [ ] **Step 3: Implement the paper executor**

```ts
import type { BotlabStrategyDecision } from '../core/types.js';
import type { PaperPosition, PaperSessionState, PaperMarketSnapshot } from './types.js';

export function applyPaperDecision(
  state: PaperSessionState,
  market: PaperMarketSnapshot,
  decision: BotlabStrategyDecision,
): PaperSessionState {
  if (decision.action !== 'buy' || !decision.side || typeof decision.size !== 'number') {
    return state;
  }

  const entryPrice = decision.side === 'up' ? market.upAsk : market.downAsk;
  if (!(entryPrice > 0) || !(state.balance.cash >= decision.size)) {
    return state;
  }

  const next = structuredClone(state);
  next.balance.cash -= decision.size;
  next.balance.equity = next.balance.cash;
  next.positions.push({
    asset: market.asset,
    marketSlug: market.slug,
    side: decision.side,
    stake: decision.size,
    entryPrice,
    openedAt: market.timestamp,
  });
  next.tradeCount += 1;
  next.updatedAt = market.timestamp;
  return next;
}
```

- [ ] **Step 4: Implement the loop runner**

```ts
import { loadBotlabConfig } from '../config/default-config.js';
import path from 'node:path';
import { appendPaperEvent, loadPaperSession, savePaperSession } from './session-store.js';
import { applyPaperDecision } from './executor.js';
import { runStrategyById } from '../core/engine.js';

export async function runPaperLoop(options: {
  rootDir: string;
  startingBalance: number;
  strategyId: string;
  session: string;
  intervalMs: number;
  maxCycles?: number;
  marketSource: () => Promise<PaperMarketSnapshot[]>;
}) {
  const projectRoot = path.resolve(options.rootDir, '..');
  let cycle = 0;
  while (options.maxCycles === undefined || cycle < options.maxCycles) {
    const state = loadPaperSession(options.rootDir, options.session, options.startingBalance);
    const markets = await options.marketSource();

    let nextState = state;
    for (const market of markets) {
      const config = loadBotlabConfig(undefined, projectRoot);
      const nextHistory = [...nextState.history[market.asset], {
        asset: market.asset,
        timestamp: market.timestamp,
        upPrice: market.upPrice,
        downPrice: market.downPrice,
        upAsk: market.upAsk,
        downAsk: market.downAsk,
        volume: market.volume,
      }].slice(-10);
      config.runtime.mode = 'paper';
      config.runtime.balance = nextState.balance.cash;
      config.runtime.market.asset = market.asset;
      config.runtime.market.symbol = `${market.asset}-USD`;
      config.runtime.market.timeframe = '5m';
      config.runtime.market.price = market.upPrice;
      config.runtime.market.upPrice = market.upPrice;
      config.runtime.market.downPrice = market.downPrice;
      config.runtime.market.upAsk = market.upAsk;
      config.runtime.market.downAsk = market.downAsk;
      config.runtime.market.volume = market.volume;
      config.runtime.market.timestamp = market.timestamp;
      config.runtime.market.candles = nextHistory.map((point) => ({
        timestamp: point.timestamp,
        open: point.upPrice,
        high: point.upPrice,
        low: point.upPrice,
        close: point.upPrice,
        volume: point.volume,
      }));
      config.runtime.relatedMarkets = markets
        .filter((other) => other.asset !== market.asset)
        .map((other) => ({
          asset: other.asset,
          symbol: `${other.asset}-USD`,
          timeframe: '5m',
          price: other.upPrice,
          upPrice: other.upPrice,
          downPrice: other.downPrice,
          upAsk: other.upAsk,
          downAsk: other.downAsk,
          volume: other.volume,
          timestamp: other.timestamp,
          candles: [...nextState.history[other.asset], {
            asset: other.asset,
            timestamp: other.timestamp,
            upPrice: other.upPrice,
            downPrice: other.downPrice,
            upAsk: other.upAsk,
            downAsk: other.downAsk,
            volume: other.volume,
          }].slice(-10).map((point) => ({
            timestamp: point.timestamp,
            open: point.upPrice,
            high: point.upPrice,
            low: point.upPrice,
            close: point.upPrice,
            volume: point.volume,
          })),
        }));

      const result = await runStrategyById(options.strategyId, config);
      nextState = applyPaperDecision(nextState, market, result.decision);
      nextState.history[market.asset] = nextHistory;
      appendPaperEvent(options.rootDir, options.session, {
        type: 'cycle',
        timestamp: market.timestamp,
        asset: market.asset,
        action: result.decision.action,
        side: result.decision.side ?? 'flat',
        reason: result.decision.reason,
        cash: nextState.balance.cash,
        equity: nextState.balance.equity,
      });
    }

    savePaperSession(options.rootDir, {
      ...nextState,
      updatedAt: new Date().toISOString(),
      cycleCount: nextState.cycleCount + 1,
    });

    cycle += 1;
    if (options.maxCycles !== undefined && cycle >= options.maxCycles) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}
```

- [ ] **Step 5: Run the loop tests to verify they pass**

Run: `tsx --test botlab/tests/paper-loop.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add botlab/paper/executor.ts botlab/paper/loop.ts botlab/paper/types.ts botlab/tests/paper-loop.test.ts
git commit -m "feat: add paper execution loop"
```

## Task 5: Wire The CLI Command And Smoke Coverage

**Files:**
- Create: `D:\Mikoto\botlab\botlab\commands\paper.ts`
- Modify: `D:\Mikoto\botlab\botlab\cli.ts`
- Modify: `D:\Mikoto\botlab\botlab\tests\cli-smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test for the paper command**

```ts
test('botlab smoke flow can run the paper command with bounded cycles', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-fixture-'));
  const fixturePath = path.join(fixtureDir, 'paper-fixture.json');
  fs.writeFileSync(fixturePath, JSON.stringify([
    {
      asset: 'BTC',
      slug: 'btc-updown-5m-1772850900',
      question: 'Bitcoin Up or Down',
      endDate: '2026-03-28T12:40:00.000Z',
      upPrice: 0.49,
      downPrice: 0.51,
      upAsk: 0.5,
      downAsk: 0.52,
      volume: 25000,
      timestamp: '2026-03-28T12:36:00.000Z',
    },
    {
      asset: 'ETH',
      slug: 'eth-updown-5m-1772850900',
      question: 'Ethereum Up or Down',
      endDate: '2026-03-28T12:40:00.000Z',
      upPrice: 0.48,
      downPrice: 0.52,
      upAsk: 0.49,
      downAsk: 0.53,
      volume: 25000,
      timestamp: '2026-03-28T12:36:00.000Z',
    },
  ], null, 2));

  const result = await execFileAsync(process.execPath, [
    tsxCli,
    'botlab/cli.ts',
    'paper',
    '--strategy=btc-eth-5m-multi-signal',
    '--session=smoke-paper',
    '--interval=1',
    '--max-cycles=1',
    `--fixture=${fixturePath}`,
  ], { cwd: repoRoot });

  assert.match(result.stdout, /Paper Session Summary/);
  assert.match(result.stdout, /Session: smoke-paper/);
});
```

- [ ] **Step 2: Run smoke test to verify it fails**

Run: `tsx --test botlab/tests/cli-smoke.test.ts --test-name-pattern "paper command"`

Expected: FAIL with `Unknown command: paper`.

- [ ] **Step 3: Add the command wrapper**

```ts
import type { BotlabConfig } from '../core/types.js';
import { runPaperLoop } from '../paper/loop.js';
import { loadPaperSession } from '../paper/session-store.js';
import { createFixturePaperMarketSource, createLivePaperMarketSource } from '../paper/market-source.js';

export async function paperCommand(
  strategyId: string,
  config: BotlabConfig,
  options: { session: string; intervalSeconds: number; maxCycles?: number; fixturePath?: string },
): Promise<string> {
  const marketSource = options.fixturePath
    ? createFixturePaperMarketSource(options.fixturePath)
    : createLivePaperMarketSource();

  await runPaperLoop({
    rootDir: config.paths.rootDir,
    startingBalance: config.runtime.balance,
    strategyId,
    session: options.session,
    intervalMs: options.intervalSeconds * 1000,
    maxCycles: options.maxCycles,
    marketSource,
  });

  const state = loadPaperSession(config.paths.rootDir, options.session, config.runtime.balance);
  return [
    'Paper Session Summary',
    `Strategy: ${strategyId}`,
    `Session: ${options.session}`,
    `Trades: ${state.tradeCount}`,
    `Cash: ${state.balance.cash.toFixed(2)}`,
    `Equity: ${state.balance.equity.toFixed(2)}`,
    `Open Positions: ${state.positions.length}`,
  ].join('\n');
}
```

- [ ] **Step 4: Wire the CLI parser**

```ts
if (command === 'paper') {
  const strategyId = getFlagValue(argv, 'strategy');
  if (!strategyId) {
    throw new Error('Missing required flag --strategy=<id>.');
  }

  const session = getFlagValue(argv, 'session') ?? 'default-paper';
  const intervalSeconds = Number(getFlagValue(argv, 'interval') ?? '30');
  const maxCyclesValue = getFlagValue(argv, 'max-cycles');
  const maxCycles = maxCyclesValue ? Number(maxCyclesValue) : undefined;
  const fixturePath = getFlagValue(argv, 'fixture');

  console.log(await paperCommand(strategyId, config, {
    session,
    intervalSeconds,
    maxCycles,
    fixturePath,
  }));
  return;
}
```

- [ ] **Step 5: Run smoke coverage to verify it passes**

Run: `tsx --test botlab/tests/cli-smoke.test.ts --test-name-pattern "paper command"`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add botlab/cli.ts botlab/commands/paper.ts botlab/tests/cli-smoke.test.ts
git commit -m "feat: add paper trading command"
```

## Task 6: Update Docs And Verify A Real Local Session

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\README.md`

- [ ] **Step 1: Update README usage and session file paths**

```md
## Paper Trading

Run a resumable paper session:

```bash
npm run botlab -- paper --strategy=btc-eth-5m-multi-signal --session=my-paper --interval=30
```

Bound a local test run:

```bash
npm run botlab -- paper --strategy=btc-eth-5m-multi-signal --session=my-paper --interval=1 --max-cycles=2
```

Paper session files are stored in:

- `botlab/paper-sessions/<session>/state.json`
- `botlab/paper-sessions/<session>/summary.json`
- `botlab/paper-sessions/<session>/events.jsonl`
```

- [ ] **Step 2: Run focused paper tests**

Run: `npm run test:botlab -- --test-name-pattern "paper"`

Expected: PASS for paper-session, paper-market-source, and paper-loop coverage.

- [ ] **Step 3: Run the full automated verification**

Run: `npm run test:botlab`
Expected: PASS

Run: `npm run test:botlab:smoke`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Run a real bounded paper session**

Run: `npm run botlab -- paper --strategy=btc-eth-5m-multi-signal --session=local-paper-check --interval=1 --max-cycles=2`

Expected:

- command prints `Paper Session Summary`
- `D:\Mikoto\botlab\botlab\paper-sessions\local-paper-check\state.json` exists
- `D:\Mikoto\botlab\botlab\paper-sessions\local-paper-check\summary.json` exists
- `D:\Mikoto\botlab\botlab\paper-sessions\local-paper-check\events.jsonl` exists

- [ ] **Step 5: Run the same session again to verify resume**

Run: `npm run botlab -- paper --strategy=btc-eth-5m-multi-signal --session=local-paper-check --interval=1 --max-cycles=1`

Expected:

- command succeeds again
- event count increases
- the same session directory is reused instead of being recreated elsewhere

- [ ] **Step 6: Commit**

```bash
git add botlab/README.md
git commit -m "docs: add paper trading usage"
```
