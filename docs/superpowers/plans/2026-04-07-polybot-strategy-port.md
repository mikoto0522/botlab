# Polybot Strategy Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `botlab` strategy that carries over the main decision shape from `polybot-intraday` and works in replay, backtest, and paper modes.

**Architecture:** Build one new standalone strategy file that reuses `botlab`'s current market inputs. The strategy will follow the original project's shape: choose direction, require enough strength, reject bad entry prices, and size by confidence tiers. Verification will compare the new strategy against the existing bundled strategies through tests and real-data replays.

**Tech Stack:** TypeScript, Node test runner, existing `botlab` strategy loader, bundled CSV backtests, paper command

---

## File Map

- Create: `D:\Mikoto\botlab\botlab\strategies\polybot-ported.strategy.ts`
  - New standalone strategy that mirrors the original project’s decision flow using existing `botlab` inputs.
- Modify: `D:\Mikoto\botlab\botlab\tests\engine.test.ts`
  - Add focused behavior tests for direction choice, strength gating, bad-price rejection, and confidence sizing.
- Modify: `D:\Mikoto\botlab\botlab\README.md`
  - Document the new strategy and how to run it in replay and paper mode.

### Task 1: Add The Failing Strategy Tests

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\tests\engine.test.ts`
- Test: `D:\Mikoto\botlab\botlab\tests\engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests near the other strategy-specific tests so the new strategy is pinned before implementation:

```ts
test('polybot-ported buys up on a clean carrying BTC setup', async () => {
  const result = await loadStrategyResult('polybot-ported', {
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.41,
      upPrice: 0.41,
      downPrice: 0.59,
      upAsk: 0.42,
      downAsk: 0.6,
      volume: 1800,
      timestamp: '2026-04-07T09:30:00.000Z',
      candles: [
        { timestamp: '2026-04-07T09:05:00.000Z', open: 0.22, high: 0.26, low: 0.21, close: 0.25, volume: 1500 },
        { timestamp: '2026-04-07T09:10:00.000Z', open: 0.25, high: 0.29, low: 0.24, close: 0.28, volume: 1550 },
        { timestamp: '2026-04-07T09:15:00.000Z', open: 0.28, high: 0.33, low: 0.27, close: 0.32, volume: 1620 },
        { timestamp: '2026-04-07T09:20:00.000Z', open: 0.32, high: 0.36, low: 0.31, close: 0.35, volume: 1700 },
        { timestamp: '2026-04-07T09:25:00.000Z', open: 0.35, high: 0.4, low: 0.34, close: 0.39, volume: 1780 },
        { timestamp: '2026-04-07T09:30:00.000Z', open: 0.39, high: 0.42, low: 0.38, close: 0.41, volume: 1800 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 100,
    clock: {
      now: '2026-04-07T09:30:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'buy');
  assert.equal(result.decision.side, 'up');
});

test('polybot-ported holds when the chosen side is too expensive', async () => {
  const result = await loadStrategyResult('polybot-ported', {
    market: {
      asset: 'ETH',
      symbol: 'ETH-USD-5M',
      timeframe: '5m',
      price: 0.82,
      upPrice: 0.82,
      downPrice: 0.18,
      upAsk: 0.84,
      downAsk: 0.2,
      volume: 1700,
      timestamp: '2026-04-07T10:00:00.000Z',
      candles: [
        { timestamp: '2026-04-07T09:35:00.000Z', open: 0.58, high: 0.62, low: 0.57, close: 0.61, volume: 1480 },
        { timestamp: '2026-04-07T09:40:00.000Z', open: 0.61, high: 0.67, low: 0.6, close: 0.66, volume: 1500 },
        { timestamp: '2026-04-07T09:45:00.000Z', open: 0.66, high: 0.72, low: 0.65, close: 0.71, volume: 1560 },
        { timestamp: '2026-04-07T09:50:00.000Z', open: 0.71, high: 0.77, low: 0.7, close: 0.76, volume: 1610 },
        { timestamp: '2026-04-07T09:55:00.000Z', open: 0.76, high: 0.81, low: 0.75, close: 0.8, volume: 1680 },
        { timestamp: '2026-04-07T10:00:00.000Z', open: 0.8, high: 0.83, low: 0.79, close: 0.82, volume: 1700 },
      ],
    },
    position: {
      side: 'flat',
      size: 0,
      entryPrice: null,
    },
    balance: 100,
    clock: {
      now: '2026-04-07T10:00:00.000Z',
    },
  });

  assert.equal(result.decision.action, 'hold');
  assert.match(result.decision.reason, /expensive|too close|price/i);
});

test('polybot-ported sizes stronger setups larger than weaker ones', async () => {
  const weak = await loadDirectStrategyDecision('polybot-ported', {
    mode: 'dry-run',
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.34,
      upPrice: 0.34,
      downPrice: 0.66,
      upAsk: 0.35,
      downAsk: 0.67,
      volume: 1100,
      timestamp: '2026-04-07T10:30:00.000Z',
      candles: [
        { timestamp: '2026-04-07T10:05:00.000Z', open: 0.24, high: 0.25, low: 0.23, close: 0.25, volume: 900 },
        { timestamp: '2026-04-07T10:10:00.000Z', open: 0.25, high: 0.27, low: 0.24, close: 0.27, volume: 950 },
        { timestamp: '2026-04-07T10:15:00.000Z', open: 0.27, high: 0.29, low: 0.26, close: 0.28, volume: 1000 },
        { timestamp: '2026-04-07T10:20:00.000Z', open: 0.28, high: 0.31, low: 0.27, close: 0.3, volume: 1040 },
        { timestamp: '2026-04-07T10:25:00.000Z', open: 0.3, high: 0.33, low: 0.29, close: 0.32, volume: 1080 },
        { timestamp: '2026-04-07T10:30:00.000Z', open: 0.32, high: 0.35, low: 0.31, close: 0.34, volume: 1100 },
      ],
    },
    position: { side: 'flat', size: 0, entryPrice: null },
    balance: 100,
    clock: { now: '2026-04-07T10:30:00.000Z' },
  } as TempConfigRuntime);

  const strong = await loadDirectStrategyDecision('polybot-ported', {
    mode: 'dry-run',
    market: {
      asset: 'BTC',
      symbol: 'BTC-USD-5M',
      timeframe: '5m',
      price: 0.44,
      upPrice: 0.44,
      downPrice: 0.56,
      upAsk: 0.45,
      downAsk: 0.57,
      volume: 2200,
      timestamp: '2026-04-07T10:30:00.000Z',
      candles: [
        { timestamp: '2026-04-07T10:05:00.000Z', open: 0.18, high: 0.22, low: 0.17, close: 0.21, volume: 1600 },
        { timestamp: '2026-04-07T10:10:00.000Z', open: 0.21, high: 0.27, low: 0.2, close: 0.26, volume: 1750 },
        { timestamp: '2026-04-07T10:15:00.000Z', open: 0.26, high: 0.33, low: 0.25, close: 0.31, volume: 1880 },
        { timestamp: '2026-04-07T10:20:00.000Z', open: 0.31, high: 0.38, low: 0.3, close: 0.36, volume: 2010 },
        { timestamp: '2026-04-07T10:25:00.000Z', open: 0.36, high: 0.42, low: 0.35, close: 0.4, volume: 2140 },
        { timestamp: '2026-04-07T10:30:00.000Z', open: 0.4, high: 0.45, low: 0.39, close: 0.44, volume: 2200 },
      ],
    },
    position: { side: 'flat', size: 0, entryPrice: null },
    balance: 100,
    clock: { now: '2026-04-07T10:30:00.000Z' },
  } as TempConfigRuntime);

  assert.equal(weak.action, 'buy');
  assert.equal(strong.action, 'buy');
  assert.ok((strong.size ?? 0) > (weak.size ?? 0));
});
```

- [ ] **Step 2: Run the targeted test file to confirm failure**

Run:

```bash
cd D:\Mikoto\botlab
npm run test:botlab
```

Expected:

- the suite fails with an unknown strategy id such as `polybot-ported`

- [ ] **Step 3: Commit the failing test checkpoint**

```bash
cd D:\Mikoto\botlab
git add botlab/tests/engine.test.ts
git commit -m "test: cover polybot strategy port behavior"
```

### Task 2: Implement The New Ported Strategy

**Files:**
- Create: `D:\Mikoto\botlab\botlab\strategies\polybot-ported.strategy.ts`
- Modify: `D:\Mikoto\botlab\botlab\tests\engine.test.ts`

- [ ] **Step 1: Create the strategy file with a focused structure**

Create the new strategy file with:

```ts
import type {
  BotlabCandle,
  BotlabRelatedMarketRuntime,
  BotlabStrategyContext,
  BotlabStrategyDecision,
  BotlabStrategyDefinition,
} from '../core/types.js';

interface PolybotPortedParams extends Record<string, unknown> {
  lookbackCandles: number;
  minimumVolume: number;
  continuationAlignmentMin: number;
  continuationMoveMin: number;
  reversionStretchMin: number;
  relativeGapMin: number;
  minEntryPrice: number;
  maxEntryPrice: number;
  minSignalScore: number;
  lowConfidenceStake: number;
  mediumConfidenceStake: number;
  highConfidenceStake: number;
}

type PredictionSide = 'up' | 'down';
type SignalFamily = 'continuation' | 'reversion' | 'relative-value';

interface MarketSummary {
  asset: 'BTC' | 'ETH';
  price: number;
  quotedUp: number;
  quotedDown: number;
  averageClose: number;
  netMove: number;
  lastMove: number;
  previousMove: number;
  acceleration: number;
  alignment: number;
  stretch: number;
  volume: number;
}

interface SignalCandidate {
  side: PredictionSide;
  family: SignalFamily;
  score: number;
  reason: string;
  tags: string[];
}
```

- [ ] **Step 2: Add small helpers that mirror the original project’s flow**

Implement helpers in the same file for:

```ts
function average(values: number[]): number { /* ... */ }
function moves(candles: BotlabCandle[]): number[] { /* ... */ }
function alignment(moves: number[]): number { /* ... */ }
function quotedEntryPrice(context: BotlabStrategyContext, side: PredictionSide): number { /* ... */ }
function summarizeMarket(context: BotlabStrategyContext, minimumVolume: number, lookbackCandles: number): MarketSummary | undefined { /* ... */ }
function continuationCandidate(summary: MarketSummary, params: PolybotPortedParams): SignalCandidate | undefined { /* ... */ }
function reversionCandidate(summary: MarketSummary, params: PolybotPortedParams): SignalCandidate | undefined { /* ... */ }
function relativeValueCandidate(summary: MarketSummary, peer: MarketSummary, params: PolybotPortedParams): SignalCandidate | undefined { /* ... */ }
function chooseStake(score: number, balance: number, params: PolybotPortedParams): number { /* ... */ }
```

Keep them focused:

- `continuationCandidate` should only fire when direction and carry are clean
- `reversionCandidate` should only fire when stretch is large enough and the last move starts to snap back
- `relativeValueCandidate` should only use BTC/ETH stretch divergence when both markets are available

- [ ] **Step 3: Implement the main strategy decision**

Export the strategy object in the same file:

```ts
function evaluatePortedStrategy(
  context: BotlabStrategyContext,
  params: PolybotPortedParams,
): BotlabStrategyDecision {
  if ((context.market.asset !== 'BTC' && context.market.asset !== 'ETH') || context.market.timeframe !== '5m') {
    return { action: 'hold', reason: 'strategy only trades BTC and ETH 5m markets', tags: ['polybot-ported', 'idle'] };
  }

  if (context.position.side !== 'flat') {
    return { action: 'hold', reason: 'strategy only opens from a flat state', tags: ['polybot-ported', 'idle'] };
  }

  const summary = summarizeMarket(context, params.minimumVolume, params.lookbackCandles);
  if (!summary) {
    return { action: 'hold', reason: 'market context is too thin or too short', tags: ['polybot-ported', 'idle'] };
  }

  const candidates: SignalCandidate[] = [];
  const continuation = continuationCandidate(summary, params);
  const reversion = reversionCandidate(summary, params);
  if (continuation) candidates.push(continuation);
  if (reversion) candidates.push(reversion);

  const peerMarket = context.relatedMarkets?.find((market) => market.asset !== context.market.asset && market.timeframe === '5m');
  if (peerMarket) {
    const peerSummary = summarizeRelatedMarket(peerMarket, params.minimumVolume, params.lookbackCandles);
    if (peerSummary) {
      const relative = relativeValueCandidate(summary, peerSummary, params);
      if (relative) candidates.push(relative);
    }
  }

  if (candidates.length === 0) {
    return { action: 'hold', reason: 'no direction had enough strength to justify a trade', tags: ['polybot-ported', 'idle'] };
  }

  const best = candidates.sort((left, right) => right.score - left.score)[0]!;
  const entry = quotedEntryPrice(context, best.side);
  if (entry < params.minEntryPrice || entry > params.maxEntryPrice) {
    return { action: 'hold', reason: 'setup looked real, but the quoted entry price was not worth taking', tags: ['polybot-ported', 'idle', 'price-filter'] };
  }

  if (best.score < params.minSignalScore) {
    return { action: 'hold', reason: 'direction was there, but the move strength was still too weak', tags: ['polybot-ported', 'idle', 'weak'] };
  }

  const size = chooseStake(best.score, context.balance, params);
  if (size <= 0) {
    return { action: 'hold', reason: 'balance is too small for a meaningful trade', tags: ['polybot-ported', 'idle'] };
  }

  return {
    action: 'buy',
    side: best.side,
    size,
    reason: best.reason,
    tags: ['polybot-ported', best.family, best.side, 'entry'],
  };
}

export const strategy: BotlabStrategyDefinition<PolybotPortedParams> = {
  id: 'polybot-ported',
  name: 'Polybot Ported',
  description: 'Ports the original polybot trading shape into botlab by choosing direction first, demanding enough strength, filtering bad prices, and sizing by confidence.',
  defaults: {
    lookbackCandles: 6,
    minimumVolume: 900,
    continuationAlignmentMin: 0.75,
    continuationMoveMin: 0.12,
    reversionStretchMin: 1.2,
    relativeGapMin: 1,
    minEntryPrice: 0.08,
    maxEntryPrice: 0.78,
    minSignalScore: 1.9,
    lowConfidenceStake: 5,
    mediumConfidenceStake: 8,
    highConfidenceStake: 12,
  },
  evaluate: evaluatePortedStrategy,
};

export default strategy;
```

- [ ] **Step 4: Re-run the strategy tests until they pass**

Run:

```bash
cd D:\Mikoto\botlab
npm run test:botlab
```

Expected:

- the new `polybot-ported` tests pass
- the rest of the suite still passes

- [ ] **Step 5: Commit the working strategy**

```bash
cd D:\Mikoto\botlab
git add botlab/strategies/polybot-ported.strategy.ts botlab/tests/engine.test.ts
git commit -m "feat: add ported polybot strategy"
```

### Task 3: Document And Verify The Strategy End To End

**Files:**
- Modify: `D:\Mikoto\botlab\botlab\README.md`
- Modify: `D:\Mikoto\botlab\botlab\tests\engine.test.ts` (only if a small command-level assertion is needed)

- [ ] **Step 1: Add the strategy to the bundled strategy list in the README**

Update the bundled-strategies section with a line like:

```md
- `polybot-ported`: a botlab-native port of the original polybot strategy shape that decides direction first, then filters by strength and entry quality before sizing the trade
```

Also add example commands:

```md
npm run botlab -- describe-strategy --strategy=polybot-ported
npm run botlab -- run --strategy=polybot-ported
npm run botlab -- backtest-batch --strategy=polybot-ported --data=botlab/data/polymarket-btc-5m-last-month.csv
```

- [ ] **Step 2: Run direct command checks**

Run:

```bash
cd D:\Mikoto\botlab
npm run botlab -- list-strategies
npm run botlab -- describe-strategy --strategy=polybot-ported
npm run botlab -- run --strategy=polybot-ported
```

Expected:

- `list-strategies` includes `polybot-ported`
- `describe-strategy` prints its name, description, and defaults
- `run` returns a clean decision instead of a loader error

- [ ] **Step 3: Run historical replay checks on real bundled data**

Run:

```bash
cd D:\Mikoto\botlab
npm run botlab -- backtest-batch --strategy=polybot-ported --data=botlab/data/polymarket-btc-5m-last-month.csv
npm run botlab -- backtest-batch --strategy=polybot-ported --data=botlab/data/polymarket-eth-5m-last-month.csv
```

Expected:

- both commands complete successfully
- the strategy trades often enough to feel more alive than the quietest current strategies
- the result does not immediately collapse into an obvious wipeout

- [ ] **Step 4: Run a bounded paper smoke check**

Run:

```bash
cd D:\Mikoto\botlab
npm run botlab -- paper --strategy=polybot-ported --session=polybot-ported-smoke --interval=0 --max-cycles=1 --config=botlab/config/paper-100u-5u.json
```

Expected:

- the command completes
- a new paper session folder is created
- the strategy records a clean cycle without a runtime error

- [ ] **Step 5: Run the final verification bundle**

Run:

```bash
cd D:\Mikoto\botlab
npm run test:botlab
npm run test:botlab:smoke
npm run build
```

Expected:

- all three commands pass

- [ ] **Step 6: Commit the docs and verification-ready state**

```bash
cd D:\Mikoto\botlab
git add botlab/README.md
git commit -m "docs: add polybot strategy usage"
```
