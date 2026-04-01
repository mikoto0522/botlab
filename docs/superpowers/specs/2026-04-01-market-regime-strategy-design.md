# Market Regime Strategy Design

## Goal

Replace the current one-shape-fits-all prediction-market strategy with a regime-aware version that first decides what kind of market is active, then only allows the matching trade families to participate.

The immediate goal is not "find better numbers." The immediate goal is to stop using the same trade logic in incompatible market states.

This redesign should directly address what the live paper session exposed:

- the strategy can win often and still lose badly
- profitability is concentrated in a narrow slice of behavior
- the same rules are being applied to both directional and choppy periods
- recent paper performance shows that cross-regime stability is not there yet

## Why The Current Shape Fails

The current multi-signal strategy mixes continuation, reversion, and relative-value ideas in one shared decision flow, but it does not first decide whether the market currently behaves like a directional environment, a mean-reverting environment, or a noisy environment.

That means:

- continuation trades can fire when the market is actually choppy
- reversion trades can fire when the market is actually trending
- trade families end up fighting the market state instead of fitting it

The paper session proves this is not just a backtest concern.

From the latest live paper run:

- starting balance: `100`
- ending balance: `37.12`
- trades settled: `193`
- win rate: about `61.7%`
- realized result: `-62.88`

That combination matters. A strategy that wins more than it loses but still ends up deeply negative is structurally mismatched to the market states it is trading.

The problem is not simply that one parameter is loose. The problem is that the strategy lacks a market-state gate.

## Recommended Approach

Build a regime classifier first, then route trade logic through that classifier.

The strategy should answer one question before opening anything:

"Is the current market directional, ranging, or too noisy to trust?"

Only after that answer is known should the strategy decide whether to:

- use continuation logic
- use mean-reversion logic
- use a limited relative-value path
- or stay flat

This is the smallest redesign that directly addresses the paper failure without immediately jumping into a much larger model-driven system.

## Alternatives Considered

### 1. Keep Tuning Raw Price Buckets

Pros:

- smallest code change
- easiest to compare

Cons:

- already tried repeatedly
- paper results show the problem is broader than one bad bucket
- does not solve cross-regime mismatch

### 2. Regime Classifier Plus Regime-Specific Signals

This is the recommended option.

Pros:

- directly addresses the core failure mode
- easier to reason about than a black-box model
- allows different trade families to behave differently in different states
- supports future tuning from paper logs without redesigning the engine again

Cons:

- larger than parameter tuning
- requires clearer separation between market-state logic and entry logic

### 3. Full Model-Led Regime And Probability System

Pros:

- strong long-term direction

Cons:

- too large for this iteration
- would mix regime redesign and model redesign at the same time
- makes it harder to tell what improvement came from what change

## Regime Definitions

The first version should keep the classifier simple and explicit.

### 1. Directional Regime

This regime is active when short recent movement is mostly one-way and the latest movement still supports the same direction.

Behavioral intent:

- use continuation-style entries
- allow only the side that matches the current directional bias
- reject reversion entries unless a later version explicitly adds a trend-exhaustion transition

What this means in practice:

- recent moves are aligned enough
- noise is low enough
- net move is strong enough
- latest step is not obviously contradicting the dominant direction

### 2. Ranging Regime

This regime is active when the market remains inside a more balanced middle area and recent moves alternate or snap back often enough to resemble a bounded back-and-forth environment.

Behavioral intent:

- use mean-reversion entries only
- do not chase continuation in this state
- prefer middle-zone entries over expensive extremes

What this means in practice:

- price is not near the ends
- recent movement lacks clean carry
- recent reversals happen often enough to support fade logic
- volatility is present, but not chaotic

### 3. Noise Regime

This regime is active when the market is neither clearly directional nor cleanly ranging.

Behavioral intent:

- do not trade

What this means in practice:

- conflicting evidence
- mixed short movement
- poor structure
- low-quality context where both continuation and reversion are untrustworthy

This state is important. The redesign should treat "do nothing" as a first-class valid outcome instead of forcing a weak decision.

## Strategy Structure

The redesigned strategy should follow a two-layer flow.

### Layer 1: Regime Classification

Use a small shared market-state summary to classify each BTC or ETH opportunity into:

- directional
- ranging
- noise

The classifier should be based on the same raw ingredients already available in the project:

- recent short candle history
- net short move
- latest move
- reversal frequency
- distance from the binary ends
- recent volume

No new external data source is required.

### Layer 2: Regime-Specific Entry Rules

Once the regime is known:

- directional regime uses continuation rules
- ranging regime uses reversion rules
- noise regime stays flat

The relative-value path should not disappear, but it should become secondary:

- only active when both legs are in compatible non-noise states
- never allowed to override a clearly invalid market state

This keeps the cross-market logic, but makes it subordinate to market quality instead of letting it fire in the wrong environment.

## Parameter Strategy

The redesign should tune in this order:

### 1. Regime Boundaries

Tune the thresholds that decide:

- when directional starts
- when ranging starts
- when the market is too noisy to trade

This is the highest-priority tuning layer.

### 2. Allowed Trade Families Per Regime

Tune which trade families are even permitted:

- directional: continuation only
- ranging: reversion only
- noise: none

The first version should be strict. If a trade family is ambiguous, leave it out instead of allowing it by default.

### 3. Price Zones Per Regime

Tune where entries are allowed:

- directional entries should avoid obviously poor binary extremes
- ranging entries should favor middle zones where snapback still has room
- cheap lottery-like entries should remain blocked unless the paper evidence clearly supports them

### 4. Direction Filters Per Regime

Tune which side is allowed inside each regime.

This is important because the paper run already showed that some asset-side combinations are structurally weak:

- BTC-up was a major drag
- ETH-up and ETH-down both had weak slices

The redesign should therefore assume that allowed direction may differ by:

- regime
- asset
- price zone

### 5. Sizing Only After The Above

Sizing should be tuned last.

The paper result proves that position sizing is not the main issue. The current setup already loses because the wrong trades are being allowed. Changing the stake before fixing regime selection would only resize the same mistake.

## What Should Change Immediately

The first implementation pass should make these structural changes:

- continuation logic must not run in ranging or noisy conditions
- reversion logic must not run in directional or noisy conditions
- clearly weak live-paper slices should be disabled by default in the first regime-aware version
- the paper path should be used as a real acceptance gate, not just backtests

## Paper-Driven Acceptance

This redesign exists because the paper session invalidated the current strategy shape.

So the next accepted version must be judged on paper-style evidence as well as historical replay.

### Required Acceptance Signals

- it should no longer collapse from `100` to near `30` over a short live paper window
- it should not rely on one narrow asset-side slice to stay alive
- it should show better day-to-day balance than the latest paper result
- it should avoid the pattern of "wins often but still bleeds badly"

### Required Diagnostic Checks

The final evaluation should include:

- settled trade breakdown by asset and side
- settled trade breakdown by entry-price zone
- day-level paper or replay slices
- concentration check on the best winners

The redesign is not done if it only shifts the losses around.

## Testing Plan

The implementation should add failing tests first for the classifier and its routing behavior.

Tests should prove:

- directional contexts can trigger continuation trades
- ranging contexts can trigger reversion trades
- noisy contexts force holds
- continuation does not fire in a ranging case
- reversion does not fire in a directional case
- relative-value entries are blocked when one or both markets are noisy

## Verification Plan

The final verification should include:

- focused strategy tests
- full test suite
- smoke suite
- build
- historical replay on the current real BTC/ETH files
- renewed live paper run after deployment

### Success Criteria

The first acceptable regime-aware version should satisfy all of the following:

- it behaves differently across directional, ranging, and noisy conditions
- it removes the worst asset-side / price-zone slices seen in paper
- it improves stability versus the current paper result
- it does not simply replace one narrow lucky regime with another narrow lucky regime

## Out Of Scope

This redesign does not yet include:

- a fully learned regime model
- order-book-level model fitting
- inventory-style market making
- new assets beyond BTC and ETH
- live execution

## Deliverables

- a regime-aware redesign for the BTC/ETH prediction-market strategy
- updated tests for regime classification and regime-specific routing
- updated strategy documentation
- renewed replay and live paper verification showing whether the redesign actually improves cross-regime behavior
