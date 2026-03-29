# Prediction Market Multi-Signal Strategy Design

## Goal

Replace the current low-frequency BTC/ETH hedge strategy with a prediction-market-native multi-signal strategy that treats trade frequency, return, and stability as equally important targets.

The immediate acceptance target is:

- at least `100` entries over the most recent month of real BTC/ETH 5m market data
- positive return over the same real month and the year-to-date file
- stability that does not collapse into a "few lucky trades carry everything" profile

## Why The Current Strategy Is The Wrong Shape

The current true-hedge design was built around selectivity:

- it waits for very clean paired setups
- it often insists on opening both legs together
- it is structurally biased toward low trade counts

That makes it incompatible with the new requirement. A strategy that is designed to only act on rare, clean pair states can be tuned a little, but it will not naturally become a high-frequency, still-stable prediction-market strategy.

The problem is not just parameters. The problem is the strategy shape.

## Recommended Approach

Build one strategy that can open trades from multiple independent signal families instead of forcing every trade through one narrow gate.

The strategy should not rely on a single type of setup. It should combine a small number of distinct opportunity types, each with its own quality checks:

- continuation opportunities
- mean-reversion opportunities
- cross-market relative-value opportunities

The strategy then scores the opportunity, decides whether the setup is good enough to trade, and chooses whether to trade one leg or a paired structure.

This is the most realistic path to increasing trade frequency without simply lowering standards until the strategy turns noisy and unstable.

## Alternatives Considered

### 1. Keep One Signal And Relax It More

Pros:

- smallest code change
- easy to compare against the current baseline

Cons:

- already tested and found wanting
- trade count rises too slowly
- once loosened enough to matter, return quality and stability degrade

### 2. Multi-Signal Strategy

This is the recommended option.

Pros:

- frequency comes from multiple opportunity types, not from one weak rule
- easier to keep some quality floor per setup family
- better fit for a prediction-market workflow than a single rare setup

Cons:

- larger redesign than parameter tuning
- requires clearer signal boundaries and scoring rules

### 3. Full Portfolio / Market-Making Style System

Pros:

- most prediction-market-native long-term direction

Cons:

- too large for this iteration
- would require bigger engine changes, inventory logic, and likely order-book-level work

## Strategy Structure

The new strategy should evaluate three signal families on every eligible BTC and ETH 5m opportunity.

### 1. Continuation Signal

Use this when short recent movement is clean and still moving in the same direction.

High-level behavior:

- if recent movement shows follow-through and current price is not too extreme
- the strategy may back the current direction

Purpose:

- capture the simple "this move is still carrying" opportunities
- provide more frequent entries than the current paired hedge

### 2. Mean-Reversion Signal

Use this when short recent movement looks stretched and the latest movement suggests the move is losing force.

High-level behavior:

- if price has moved far enough away from a short recent reference
- and the latest move suggests slowing or snapback
- the strategy may fade the stretch

Purpose:

- catch the common prediction-market behavior where a short move overshoots and then pulls back

### 3. Relative-Value Signal

Use this when BTC and ETH diverge enough that one looks cheap or rich relative to the other.

High-level behavior:

- compare BTC and ETH short-window behavior
- if the relationship is far enough from its recent norm
- the strategy may either:
  - trade the richer/weaker side alone, or
  - open a paired structure when the divergence is strong enough

Purpose:

- keep the useful part of the earlier cross-market idea
- avoid forcing every trade into a hedge

## Trade Decision Model

Every candidate trade should go through the same high-level flow:

1. Determine which signal families are active.
2. Give each active family a score.
3. Combine the scores into one final confidence level.
4. Reject the trade if the confidence does not meet the minimum threshold.
5. Choose the structure:
   - single-leg trade for ordinary opportunities
   - paired trade only for stronger relative-value opportunities
6. Size the trade from capped risk tiers instead of one fixed budget.

This is important because the new strategy must trade more often, but it cannot treat all trades as equally strong.

## Position Structure

The new strategy should support two entry styles:

### Single-Leg Entry

Used for ordinary continuation or reversion opportunities.

Why:

- this is the easiest way to increase trade count
- it removes the requirement that every opportunity must have a perfect partner leg

### Paired Entry

Used only when the BTC/ETH relative-value signal is strong enough.

Why:

- keeps the useful hedge behavior for stronger dislocations
- avoids overusing paired entries where they suppress activity

## Risk Model

Because frequency, return, and stability all matter equally, the strategy needs a bounded risk model.

### Trade Filters

The strategy still refuses:

- very low-volume opportunities
- clearly extreme binary prices near the ends
- mixed/noisy recent movement with no real edge

### Size Tiers

Use a small set of size tiers, for example:

- low-confidence valid trade
- medium-confidence valid trade
- high-confidence valid trade

The exact tier values can be tuned during implementation, but the design goal is:

- more trades than before
- no single trade type gets to dominate the whole result

### Stability Check

The analysis step must still measure:

- trimmed return
- concentration in top winners
- monthly slice behavior

A version that reaches `100+` trades by turning trimmed return negative should be rejected.

## Data Requirements

No new external data source is required for the first version.

The design should use only what the project already has:

- BTC and ETH 5m rows
- recent candle history
- balance
- current binary prices
- outcome data for replay

This keeps the redesign focused on strategy quality instead of expanding the data pipeline.

## Engine Scope

The first version should avoid major engine changes.

The strategy should reuse the current project capabilities:

- single-market batch backtest
- hedge backtest
- hedge analysis

If needed, the strategy can expose:

- ordinary single-leg decisions for the batch workflow
- paired decisions for the hedge workflow

The design goal is to improve behavior mainly through strategy structure, not through rebuilding the entire execution engine in this iteration.

## Testing Plan

The implementation should follow test-first changes for the new strategy behavior.

Tests should prove:

- continuation trades can trigger on valid BTC and ETH cases
- mean-reversion trades can trigger on valid BTC and ETH cases
- relative-value trades can still trigger paired entries when appropriate
- noisy setups still hold
- low-volume or extreme-price setups still hold

## Verification Plan

The final evaluation must use the real month and year-to-date files.

### Required Verification

- focused strategy tests
- full test suite
- smoke suite
- build
- real-data month replay
- real-data year-to-date replay
- stability analysis on both files

### Success Criteria

The first acceptable version should satisfy all of the following:

- recent-month trade count reaches at least `100`
- recent-month return stays positive
- year-to-date return stays positive
- trimmed return stays positive on both files
- concentration remains high enough to be worth noting, but not so extreme that removing a couple of winners destroys the whole result

If any of these fail, the strategy is not done.

## Out Of Scope

This redesign does not yet include:

- market making
- order-book-level quoting
- multiple additional assets beyond BTC and ETH
- live order execution
- a fully new portfolio engine

## Deliverables

- a new multi-signal BTC/ETH prediction-market strategy
- updated tests for the new signal families
- updated README usage notes
- verified real-data results against the `100+` recent-month trade goal and the matching return/stability requirements
