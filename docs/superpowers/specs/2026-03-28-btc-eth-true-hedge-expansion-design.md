# BTC ETH True Hedge Expansion Design

## Goal

Increase the number of paired hedge entries for `btc-eth-5m-true-hedge` and raise total return, while still verifying that the result is not entirely carried by a tiny number of outsized trades.

This change is intentionally scoped to the current true-hedge strategy only. The hedge backtest engine, the hedge analysis command, and the real BTC/ETH datasets remain unchanged.

## Current Problem

The current state-based true hedge version is cleaner than the earlier pair strategy, but it is too selective:

- last month: `4` paired trades, `+4.65%`
- year to date: `13` paired trades, `+26.27%`
- trimmed return is positive, but the trade count is too low
- the result still leans heavily on February

In practice, the strategy is filtering out too many mid-quality opportunities. It protects capital well, but it does not participate often enough for a 5m prediction-market workflow.

## Recommended Approach

Use the existing three-state hedge structure, but relax the gates that decide whether a setup is tradable.

This keeps the current mental model:

- classify the BTC/ETH relationship into `trend`, `revert`, or `noise`
- open a paired trade only for `trend` or `revert`
- skip obviously messy situations

The change is not to invent a new strategy family. The change is to widen the current one so it can accept more "good enough" opportunities instead of waiting only for the cleanest edge cases.

## Alternatives Considered

### 1. Relax The Existing Gates

This is the recommended option.

Pros:

- smallest change
- easiest to verify against the current baseline
- preserves the current state-based structure
- can directly increase both trade count and return if the current filters are simply too strict

Cons:

- if relaxed too far, noise can leak back in quickly

### 2. Add A Second Aggressive Sub-Regime

Keep the current strict regime and add a second fallback regime for weaker signals.

Pros:

- explicit control over conservative vs aggressive entries

Cons:

- more moving parts
- harder to tell which regime is actually helping
- easier to overfit to the current dataset

### 3. Add Scaling Entries

Let the strategy start smaller and add to positions later.

Pros:

- can increase participation without committing full size immediately

Cons:

- requires more logic than this iteration needs
- does not necessarily increase return in the current settlement-style replay

## Strategy Changes

The following adjustments are in scope:

### 1. Relax The Tradability Gates

The strategy currently blocks too many setups as `noise`. The new version will:

- allow a smaller BTC/ETH edge gap before a setup becomes tradable
- accept somewhat less perfect short-window alignment
- widen the safe middle price zone modestly

These changes are expected to increase the number of `trend` and `revert` decisions.

### 2. Keep The Hard Safety Floor

The strategy will still refuse:

- very extreme binary prices near the ends of the range
- low-volume situations
- mixed conditions where recent movement does not point to either continuation or reversal clearly enough

The goal is to open more trades, not to convert the strategy into a noise chaser.

### 3. Increase Per-Leg Size

Because the user explicitly accepts higher volatility, the per-leg budget cap can move higher.

This change is bounded:

- each leg still uses a capped amount
- the strategy still checks available balance first

The purpose is to make added opportunities matter instead of only increasing trade count while keeping each result too small.

## Data Flow

No new data is required.

The strategy continues to use:

- BTC and ETH 5m rows from the paired CSV
- recent candle history already exposed by the hedge backtest
- balance, volume, and current binary prices

The hedge engine and analysis command stay exactly as they are today.

## Error Handling

The relaxed version must preserve the current safe failure behavior:

- if BTC or ETH is missing, hold
- if balance is too small, hold
- if history is too short, hold
- if prices are outside the acceptable zone, hold
- if the setup still looks noisy, hold

## Verification Plan

The result is only acceptable if it improves on the current baseline in a meaningful way.

### Required Checks

- focused state tests pass
- full test suite passes
- smoke tests pass
- build passes
- last-month hedge backtest runs
- year-to-date hedge backtest runs
- last-month hedge analysis runs
- year-to-date hedge analysis runs

### Success Criteria

The relaxed version should satisfy all of the following:

- paired trade count is clearly higher than the current baseline
- last-month return is higher than `+4.65%`
- year-to-date return is higher than `+26.27%`
- trimmed return remains positive on both datasets

### Evaluation Notes

It is acceptable if drawdown rises, because the user explicitly accepts more volatility. However:

- the strategy should still avoid collapsing back into a "few lucky trades only" profile
- if return rises but trimmed return turns negative, that version should be rejected

## Out Of Scope

This iteration does not:

- change the hedge backtest engine
- introduce additional markets beyond BTC and ETH
- add order-book-level execution logic
- add scaling entries or multi-stage position management
- create a second strategy file

## Deliverables

- updated `btc-eth-5m-true-hedge` strategy logic
- updated tests for the looser state behavior
- updated README summary if the behavior meaningfully changes
- verified backtest and stability results on both real datasets
