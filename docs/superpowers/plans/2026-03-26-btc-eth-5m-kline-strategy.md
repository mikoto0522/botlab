# BTC / ETH 5m Kline Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Botlab to feed strategies generic candle data, then add a BTC / ETH 5m strategy that computes its own entry and exit logic from those candles.

**Architecture:** Keep the current Botlab flow intact, but expand the strategy input contract from a single simplified market snapshot into a candle-aware market context. Preserve the example strategy by keeping compatibility fields, and add a second strategy dedicated to BTC / ETH 5m that derives its own short-term trend signals from recent candles.

**Tech Stack:** TypeScript, Node.js built-ins, `tsx`, `typescript`

---

### Task 1: Add candle-aware strategy input and config support

**Files:**
- Modify: `D:/Mikoto/botlab/botlab/core/types.ts`
- Modify: `D:/Mikoto/botlab/botlab/config/default-config.ts`
- Modify: `D:/Mikoto/botlab/botlab/config/example.config.json`
- Modify: `D:/Mikoto/botlab/botlab/tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

Update `D:/Mikoto/botlab/botlab/tests/config.test.ts` with a candle-focused test:

```ts
test('loadBotlabConfig loads candle data from a real config file', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-candles-'));
  const configPath = path.join(cwd, 'botlab.config.json');

  fs.writeFileSync(configPath, JSON.stringify({
    runtime: {
      market: {
        asset: 'BTC',
        symbol: 'BTC-USD',
        timeframe: '5m',
        price: 104.5,
        candles: [
          { timestamp: '2026-03-26T09:00:00.000Z', open: 100, high: 101, low: 99.5, close: 100.8, volume: 1200 },
          { timestamp: '2026-03-26T09:05:00.000Z', open: 100.8, high: 102, low: 100.7, close: 101.7, volume: 1500 }
        ]
      }
    }
  }), 'utf-8');

  const config = loadBotlabConfig(configPath, cwd);

  assert.equal(config.runtime.market.asset, 'BTC');
  assert.equal(config.runtime.market.candles.length, 2);
  assert.equal(config.runtime.market.candles[1]?.close, 101.7);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:botlab -- --test-name-pattern="loads candle data"
```

Expected: FAIL because the current runtime market shape does not yet include candle support.

- [ ] **Step 3: Write the minimal implementation**

Update `D:/Mikoto/botlab/botlab/core/types.ts` so the shared market contract includes generic candles:

```ts
export interface BotlabCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BotlabMarketRuntime {
  asset: string;
  symbol: string;
  timeframe: string;
  price: number;
  changePct24h: number;
  momentum: number;
  volume: number;
  timestamp: string;
  candles: BotlabCandle[];
}
```

Update `D:/Mikoto/botlab/botlab/config/default-config.ts` so default runtime includes candles and config loading merges them safely:

```ts
const DEFAULT_RUNTIME: BotlabRuntimeConfig = {
  mode: 'dry-run',
  market: {
    asset: 'BTC',
    symbol: 'BTC-USD',
    timeframe: '5m',
    price: 100,
    changePct24h: 1.2,
    momentum: 0.72,
    volume: 250000,
    timestamp: '2026-03-26T09:30:00.000Z',
    candles: [
      { timestamp: '2026-03-26T09:10:00.000Z', open: 98.9, high: 99.8, low: 98.7, close: 99.6, volume: 1100 },
      { timestamp: '2026-03-26T09:15:00.000Z', open: 99.6, high: 100.4, low: 99.5, close: 100.1, volume: 1250 },
      { timestamp: '2026-03-26T09:20:00.000Z', open: 100.1, high: 100.9, low: 100.0, close: 100.6, volume: 1380 },
      { timestamp: '2026-03-26T09:25:00.000Z', open: 100.6, high: 101.0, low: 100.3, close: 100.8, volume: 1410 },
      { timestamp: '2026-03-26T09:30:00.000Z', open: 100.8, high: 101.4, low: 100.7, close: 101.2, volume: 1490 }
    ]
  },
  position: {
    side: 'flat',
    size: 0,
    entryPrice: null,
  },
  balance: 1000,
  clock: {
    now: '2026-03-26T09:30:00.000Z',
  },
};
```

Use a helper to validate candles:

```ts
function isValidCandle(value: unknown): value is BotlabCandle {
  return isRecord(value)
    && typeof value.timestamp === 'string'
    && typeof value.open === 'number'
    && typeof value.high === 'number'
    && typeof value.low === 'number'
    && typeof value.close === 'number'
    && typeof value.volume === 'number';
}
```

When merging runtime config, only accept `runtime.market.candles` if it is an array of valid candle objects:

```ts
if (Array.isArray(runtime.market.candles)) {
  const candles = runtime.market.candles.filter(isValidCandle).map((candle) => ({ ...candle }));
  if (candles.length > 0) {
    merged.market.candles = candles;
    const latest = candles[candles.length - 1];
    merged.market.price = latest.close;
    merged.market.timestamp = latest.timestamp;
  }
}
```

Update `D:/Mikoto/botlab/botlab/config/example.config.json` to include `asset`, `symbol`, and a recent 5-candle BTC sample.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test:botlab -- --test-name-pattern="loads candle data"
```

Expected: PASS and confirm candle array is loaded into runtime config.

- [ ] **Step 5: Record the checkpoint**

This directory is not a Git repository, so a normal commit is not available here. Record the checkpoint by rerunning the full config test file:

```bash
npm run test:botlab -- --test-name-pattern="loadBotlabConfig|resolveBotlabPaths"
```

Expected: PASS with the existing config tests plus the new candle-loading test.

### Task 2: Preserve the example strategy and add a BTC / ETH 5m candle strategy

**Files:**
- Modify: `D:/Mikoto/botlab/botlab/strategies/example-momentum.strategy.ts`
- Create: `D:/Mikoto/botlab/botlab/strategies/btc-eth-5m.strategy.ts`
- Modify: `D:/Mikoto/botlab/botlab/tests/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new test to `D:/Mikoto/botlab/botlab/tests/registry.test.ts`:

```ts
test('btc-eth-5m strategy buys on a strong BTC 5m candle sequence', async () => {
  const registry = await createStrategyRegistry(path.resolve(process.cwd(), 'botlab/strategies'));
  const strategy = registry.getById('btc-eth-5m');

  const decision = strategy.evaluate({
    mode: 'dry-run',
    balance: 1000,
    clock: { now: '2026-03-26T09:30:00.000Z' },
    position: { side: 'flat', size: 0, entryPrice: null },
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD',
      timeframe: '5m',
      price: 102.4,
      changePct24h: 2.2,
      momentum: 0.8,
      volume: 250000,
      timestamp: '2026-03-26T09:30:00.000Z',
      candles: [
        { timestamp: '2026-03-26T09:10:00.000Z', open: 100.0, high: 100.4, low: 99.9, close: 100.3, volume: 900 },
        { timestamp: '2026-03-26T09:15:00.000Z', open: 100.3, high: 100.9, low: 100.2, close: 100.8, volume: 1000 },
        { timestamp: '2026-03-26T09:20:00.000Z', open: 100.8, high: 101.5, low: 100.7, close: 101.3, volume: 1100 },
        { timestamp: '2026-03-26T09:25:00.000Z', open: 101.3, high: 102.0, low: 101.2, close: 101.8, volume: 1200 },
        { timestamp: '2026-03-26T09:30:00.000Z', open: 101.8, high: 102.5, low: 101.7, close: 102.4, volume: 1300 }
      ]
    }
  }, strategy.defaults);

  assert.equal(decision.action, 'buy');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:botlab -- --test-name-pattern="btc-eth-5m strategy buys"
```

Expected: FAIL because the new strategy file does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Keep `example-momentum` working by making it use candle-derived momentum when candles exist, but preserve its current behavior shape:

```ts
const latestClose = context.market.candles.at(-1)?.close ?? context.market.price;
const previousClose = context.market.candles.at(-2)?.close ?? latestClose;
const derivedMomentum = previousClose > 0 ? (latestClose - previousClose) / previousClose : context.market.momentum;
const momentum = context.market.candles.length >= 2 ? derivedMomentum : context.market.momentum;
```

Create `D:/Mikoto/botlab/botlab/strategies/btc-eth-5m.strategy.ts`:

```ts
import type { BotlabStrategyDefinition, BotlabCandle } from '../core/types.js';

interface BtcEth5mParams extends Record<string, unknown> {
  btcEntryChangePct: number;
  ethEntryChangePct: number;
  btcExitChangePct: number;
  ethExitChangePct: number;
  minBullishCandles: number;
  lookbackCandles: number;
  allocation: number;
}

function recentCandles(candles: BotlabCandle[], lookback: number): BotlabCandle[] {
  return candles.slice(-lookback);
}

function closeChangePct(candles: BotlabCandle[]): number {
  if (candles.length < 2) return 0;
  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  return first > 0 ? ((last - first) / first) * 100 : 0;
}

function bullishCount(candles: BotlabCandle[]): number {
  return candles.filter((candle) => candle.close > candle.open).length;
}

export const strategy: BotlabStrategyDefinition<BtcEth5mParams> = {
  id: 'btc-eth-5m',
  name: 'BTC / ETH 5m Trend',
  description: 'Trades BTC and ETH on 5m candles using short-term strength and weakness from recent candle structure.',
  defaults: {
    btcEntryChangePct: 1.0,
    ethEntryChangePct: 1.3,
    btcExitChangePct: -0.35,
    ethExitChangePct: -0.45,
    minBullishCandles: 3,
    lookbackCandles: 5,
    allocation: 0.15,
  },
  evaluate(context, params) {
    if (!['BTC', 'ETH'].includes(context.market.asset) || context.market.timeframe !== '5m') {
      return { action: 'hold', reason: 'strategy only supports BTC/ETH 5m candles' };
    }

    const candles = recentCandles(context.market.candles, params.lookbackCandles);
    if (candles.length < params.lookbackCandles) {
      return { action: 'hold', reason: 'not enough candles to evaluate the setup' };
    }

    const changePct = closeChangePct(candles);
    const bulls = bullishCount(candles);
    const entryThreshold = context.market.asset === 'BTC' ? params.btcEntryChangePct : params.ethEntryChangePct;
    const exitThreshold = context.market.asset === 'BTC' ? params.btcExitChangePct : params.ethExitChangePct;

    if (context.position.side === 'flat' && changePct > entryThreshold && bulls >= params.minBullishCandles) {
      return {
        action: 'buy',
        size: Number((context.balance * params.allocation).toFixed(2)),
        reason: `${context.market.asset} 5m candles show short-term strength`,
        tags: ['btc-eth-5m', 'entry'],
      };
    }

    if (context.position.side === 'long' && (changePct < exitThreshold || bulls < params.minBullishCandles - 1)) {
      return {
        action: 'sell',
        size: context.position.size,
        reason: `${context.market.asset} 5m candle strength has faded`,
        tags: ['btc-eth-5m', 'exit'],
      };
    }

    return {
      action: 'hold',
      reason: 'setup does not meet entry or exit rules',
      tags: ['btc-eth-5m', 'idle'],
    };
  },
};

export default strategy;
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test:botlab -- --test-name-pattern="btc-eth-5m strategy buys"
```

Expected: PASS and confirm the new strategy is discoverable and returns `buy`.

- [ ] **Step 5: Record the checkpoint**

Run:

```bash
npm run test:botlab -- --test-name-pattern="example-momentum strategy|btc-eth-5m strategy|getStrategyById"
```

Expected: PASS for both the old example strategy and the new BTC / ETH 5m strategy path.

### Task 3: Teach the runtime and command layer to expose and run candle-based strategies

**Files:**
- Modify: `D:/Mikoto/botlab/botlab/core/context.ts`
- Modify: `D:/Mikoto/botlab/botlab/core/engine.ts`
- Modify: `D:/Mikoto/botlab/botlab/core/runner.ts`
- Modify: `D:/Mikoto/botlab/botlab/tests/engine.test.ts`
- Modify: `D:/Mikoto/botlab/botlab/tests/cli-smoke.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `D:/Mikoto/botlab/botlab/tests/engine.test.ts`:

```ts
test('runStrategyById executes btc-eth-5m on candle-rich config and returns a buy decision', async () => {
  const config = loadBotlabConfig(path.resolve(process.cwd(), 'botlab/config/example.config.json'), process.cwd());
  const result = await runStrategyById('btc-eth-5m', config);

  assert.equal(result.strategy.id, 'btc-eth-5m');
  assert.equal(result.decision.action, 'buy');
  assert.match(result.rendered, /ACTION: buy/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:botlab -- --test-name-pattern="runStrategyById executes btc-eth-5m"
```

Expected: FAIL until the engine and example config support the new candle-driven path cleanly.

- [ ] **Step 3: Write the minimal implementation**

Update `D:/Mikoto/botlab/botlab/core/context.ts` to preserve candle arrays as isolated copies:

```ts
export function buildStrategyContext(config: BotlabConfig): BotlabStrategyContext {
  return {
    mode: config.runtime.mode,
    balance: config.runtime.balance,
    clock: { ...config.runtime.clock },
    position: { ...config.runtime.position },
    market: {
      ...config.runtime.market,
      candles: config.runtime.market.candles.map((candle) => ({ ...candle })),
    },
  };
}
```

Update `D:/Mikoto/botlab/botlab/core/runner.ts` so rendered output includes the strategy tags if present:

```ts
export function renderDecision(strategyId: string, decision: StrategyDecision): string {
  const lines = [
    `Strategy: ${strategyId}`,
    `ACTION: ${decision.action}`,
    `Reason: ${decision.reason}`,
  ];

  if (typeof decision.size === 'number') {
    lines.push(`Size: ${decision.size}`);
  }
  if (decision.tags && decision.tags.length > 0) {
    lines.push(`Tags: ${decision.tags.join(', ')}`);
  }

  return lines.join('\n');
}
```

Update `D:/Mikoto/botlab/botlab/core/engine.ts` so returned strategy summaries still isolate defaults while supporting the new strategy unchanged:

```ts
function cloneDefaults<T extends Record<string, unknown>>(defaults: T): T {
  return JSON.parse(JSON.stringify(defaults)) as T;
}
```

Use `cloneDefaults(strategy.definition.defaults)` in both describe/list responses and before `evaluate()`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test:botlab -- --test-name-pattern="runStrategyById executes btc-eth-5m"
```

Expected: PASS and rendered output contains `ACTION: buy`.

- [ ] **Step 5: Record the checkpoint**

Run:

```bash
npm run test:botlab -- --test-name-pattern="runStrategyById|read command wrappers|botlab smoke flow"
```

Expected: PASS for engine and CLI smoke tests with the new strategy available.

### Task 4: Update docs and smoke coverage for the new generic strategy model

**Files:**
- Modify: `D:/Mikoto/botlab/botlab/README.md`
- Modify: `D:/Mikoto/botlab/botlab/tests/cli-smoke.test.ts`

- [ ] **Step 1: Write the failing test**

Extend `D:/Mikoto/botlab/botlab/tests/cli-smoke.test.ts`:

```ts
test('botlab smoke flow can run the btc-eth-5m strategy', async () => {
  const result = await execFileAsync('npm', ['run', 'botlab', '--', 'run', '--strategy=btc-eth-5m'], {
    cwd: process.cwd(),
    shell: true,
  });

  assert.match(result.stdout, /btc-eth-5m/);
  assert.match(result.stdout, /ACTION: buy/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:botlab:smoke
```

Expected: FAIL until README/config/strategy wiring all reflect the new strategy.

- [ ] **Step 3: Write the minimal implementation**

Update `D:/Mikoto/botlab/botlab/README.md` so it explains:

- strategies now receive recent candles
- `example-momentum` remains as a starter
- `btc-eth-5m` is the first candle-driven strategy
- commands to list, describe, create, and run strategies

Include this command block:

````md
```bash
npm run botlab -- list-strategies
npm run botlab -- describe-strategy --strategy=btc-eth-5m
npm run botlab -- run --strategy=btc-eth-5m
npm run botlab -- create-strategy --name="My New Strategy"
```
````

Also update the strategy contract section to mention `market.candles`.

- [ ] **Step 4: Run tests and final verification**

Run:

```bash
npm run test:botlab
npm run build
npm run botlab -- list-strategies
npm run botlab -- describe-strategy --strategy=btc-eth-5m
npm run botlab -- run --strategy=btc-eth-5m
```

Expected:

- full Botlab test suite PASS
- build PASS
- `list-strategies` includes both `example-momentum` and `btc-eth-5m`
- `describe-strategy` prints the BTC / ETH 5m strategy details
- `run` prints a `buy` decision for the bundled example config

- [ ] **Step 5: Record the checkpoint**

This directory is not a Git repository, so a normal commit is not available. Record completion by saving the exact verification output in your task notes after running the commands above.
