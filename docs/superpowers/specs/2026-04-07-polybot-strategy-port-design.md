# Polybot Strategy Port Design

## Goal

Add a new `botlab` strategy that carries over the core trading shape from `D:\Mikoto\polybot-intraday` without requiring the full external-data stack that the original project uses.

The new strategy should feel closer to the original live strategy than the current `botlab` strategies do:

- decide direction first
- require enough move strength before acting
- reject trades that are too expensive or too lottery-like
- size trades by confidence instead of using one flat stake

This should be delivered as a new strategy file in `botlab`, not as a rewrite of the existing `btc-eth-5m-multi-signal` strategy.

## Why A Direct Port Is Not The Right First Step

The original `polybot-intraday` strategy depends on inputs that `botlab` does not currently provide in its normal single-market flow:

- Binance lead/lag deltas
- Chainlink confirmation deltas
- very short external pulse signals
- explicit baseline-vs-now comparisons

Trying to port the original code line-for-line would force a wider `botlab` runtime redesign before we can even validate whether the strategy shape itself helps.

The right first move is to port the decision structure, not every original data dependency.

## Recommended Approach

Create a new `botlab` strategy that mirrors the original project at the behavior level:

1. build a directional view from recent local market action
2. require enough strength before allowing entries
3. apply price-quality filters before buying a side
4. size the trade according to confidence

This preserves the recognizable shape of the original strategy while staying compatible with the current `botlab` strategy interface and paper-trading flow.

## Alternatives Considered

### 1. Full Line-By-Line Port

Pros:

- closest to the original project on paper

Cons:

- blocked by missing `botlab` inputs
- would expand scope into framework redesign
- makes it harder to tell whether better behavior came from the strategy or from new data plumbing

### 2. Behavior-Level Port

This is the recommended option.

Pros:

- keeps the original project's core decision flow
- fits `botlab` as it exists today
- can be backtested and paper-tested immediately
- gives a clean comparison against the current `botlab` strategies

Cons:

- not every original filter can be recreated exactly
- some original signal sources must be approximated from local data

### 3. Keep Tuning The Existing Multi-Signal Strategy

Pros:

- smallest implementation change

Cons:

- does not solve the user request
- keeps the current `botlab` strategy family as the base
- will still feel like a `botlab`-native strategy, not like the original project

## Source Strategy Shape To Preserve

The original `polybot-intraday` strategy has a clear decision order:

### 1. Direction Selection

The original strategy first decides whether the setup deserves an `UP` or `DOWN` trade at all.

That decision is driven by:

- directional bias
- whether the move is still carrying
- whether confirmation disagrees too strongly

In the new `botlab` version, this should be approximated from:

- recent candle net move
- recent move alignment
- latest move and acceleration
- BTC vs ETH relative stretch when both are available

### 2. Strength Gate

The original strategy does not enter just because one side is slightly stronger.

It checks whether the move has enough force to matter.

The new version should preserve that by requiring:

- minimum alignment for continuation setups
- minimum stretch for reversion setups
- minimum relative gap for BTC/ETH divergence setups
- minimum recent activity so thin setups are skipped

### 3. Price-Quality Filter

The original strategy rejects trades that are technically "correct" but badly priced.

That is one of the most important pieces to preserve.

The new version should reject entries when:

- the target side is already too expensive
- the target side is too close to the binary extremes
- the setup falls into entry zones already proven weak in `botlab` paper or replay

### 4. Confidence-Based Sizing

The original project does not treat all entries the same.

The new strategy should keep that feel by sizing in tiers:

- weak-but-valid entries get the smallest stake
- stronger entries get larger stakes
- the highest-confidence entries get the largest allowed stake

## New Strategy Structure

The new strategy should live beside the existing ones, for example as a dedicated new strategy file in:

- `D:\Mikoto\botlab\botlab\strategies`

It should use the current `botlab` strategy interface and support:

- historical replay
- batch backtest
- paper trading

It should not replace the current default strategy.

## Runtime Logic

The first version should use a four-step flow.

### Step 1: Build Local Market View

For the active market, compute a local summary from the existing `botlab` fields:

- recent net move
- recent alignment
- recent acceleration
- recent stretch from local average
- current volume quality
- distance from the binary edges

If a peer BTC/ETH market exists, also compute a relative-strength comparison.

### Step 2: Choose Direction

Choose `up`, `down`, or no-trade based on:

- dominant recent direction for continuation
- snapback direction for reversion
- peer divergence direction for relative-value cases

The strategy should not force a trade when the direction signal is weak or conflicted.

### Step 3: Run Price-Quality Filters

Before buying, validate the actual quoted entry side:

- reject too-expensive entries
- reject too-cheap lottery-like entries
- reject historically weak price buckets

This should be based on the actual side being bought, not just the display midpoint.

### Step 4: Size By Confidence

Use score tiers to decide stake size.

The exact values can be tuned later, but the structure should be:

- low-confidence tier
- medium-confidence tier
- high-confidence tier

BTC may still need a stricter guardrail tier if replay shows it remains more fragile than ETH.

## Exit Logic

The first version should keep exits simple.

It only needs two practical exit paths:

- take profit once the move reaches its expected follow-through
- exit when the setup clearly invalidates and turns against the position

This is enough for the first port. A more detailed exit model can come later if the entry side proves worthwhile.

## Testing And Verification

The implementation should prove the new strategy is real and usable, not just present on disk.

Required verification:

- strategy loads and appears in `list-strategies`
- strategy can be described by `describe-strategy`
- strategy runs through historical backtests
- strategy can be used by the existing paper-trading command
- full test suite passes
- smoke tests pass
- build passes

## Acceptance Criteria

This work is only complete if all of the following are true:

- a new standalone strategy exists in `botlab`
- that strategy clearly reflects the original project's flow:
  - direction
  - strength
  - price filter
  - confidence sizing
- the strategy works in backtest and paper modes without changing the `botlab` paper engine
- replay results show it has more of the original project's trading feel than the current `botlab` strategy family
- the result does not immediately collapse in replay compared with the existing baseline

## Out Of Scope

This first port does not include:

- a full external-data bridge from `polybot-intraday` into `botlab`
- exact Binance or Chainlink signal replication
- a rewrite of the `botlab` runtime types
- replacing the current `btc-eth-5m-multi-signal` strategy

## Deliverables

- one new `botlab` strategy based on the original `polybot-intraday` decision shape
- tests for the new strategy's routing and sizing behavior
- updated documentation showing how to run it
- replay and paper verification comparing it with the current `botlab` strategy
