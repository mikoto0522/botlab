# Polymarket Bilateral Batch Backtest Design

**Date:** 2026-03-26

## Goal

Upgrade `D:/Mikoto/botlab` so it can run a real month-style Polymarket batch backtest across many independent 5-minute markets, while allowing a strategy to choose `up`, `down`, or `skip` for each market.

At the same time, replace the current one-sided BTC / ETH strategy with a more aggressive bilateral strategy that is explicitly tuned for higher upside rather than capital preservation.

## Why This Change

The current Botlab backtest works for one replay stream and one configured side at a time. That was enough to prove the engine and fee model, but it does not match how Polymarket BTC / ETH 5-minute contracts actually behave in practice:

- each 5-minute contract is its own independent market
- the strategy should decide whether to take the `up` side, the `down` side, or stand aside
- results over many markets matter more than a single sample replay

The temporary one-month experiment already showed that a formal batch mode is needed. Right now that result only exists in an ad-hoc script, which is not a real product capability.

## Scope

### In Scope

- add a first-class batch backtest mode for many Polymarket rows
- group and evaluate independent BTC / ETH 5-minute markets across a date range
- let strategies choose `up`, `down`, or `hold`
- keep fees, slippage, realized profit, and equity curve in the calculation
- report total results across the whole batch
- add a more aggressive bilateral BTC / ETH strategy
- document how to run the new mode
- verify the new mode on the downloaded last-month BTC and ETH datasets

### Out of Scope

- live trading
- order-book-level fill simulation
- portfolio optimization
- automatic parameter search
- machine-learned prediction
- cross-market position overlap

## Recommended Approaches

### Option 1: Keep Two Separate Single-Side Runs

Run `up` and `down` as two separate backtests and compare them manually.

Why not choose this:

- not a real bilateral strategy flow
- no single equity curve for the actual decision process
- hides how often the strategy would skip a market entirely

### Option 2: Add Bilateral Batch Backtest

Treat each independent market as one decision opportunity. The strategy sees recent history, then chooses `up`, `down`, or `hold`. If it enters, the engine settles that market when its outcome is known and rolls equity forward.

Why this is recommended:

- matches Polymarket 5-minute contract structure much better
- turns the temporary month-long script into a real Botlab feature
- keeps the scope practical enough for this iteration

### Option 3: Full Multi-Market Portfolio Simulator

Build a larger portfolio engine that can hold many overlapping markets, size by portfolio rules, and simulate more advanced capital management.

Why not choose this first:

- much larger than the current need
- delays getting a usable real-data tool
- adds complexity before the basic bilateral flow is proven

## Design Overview

The new batch mode should treat the downloaded BTC / ETH files as a sequence of independent 5-minute prediction markets.

For each row:

1. build the rolling context from recent same-asset rows
2. ask the strategy whether to buy `up`, buy `down`, or skip
3. if it buys, spend the strategy-requested amount on that side
4. settle the position using the market outcome
5. update equity, fees, wins/losses, and drawdown

This is intentionally different from the existing replay engine, which assumes one open position moving through time on one price series.

## Strategy Contract Change

The strategy output needs one new capability: when opening a new trade, it must be able to declare which prediction side it wants.

### Current Limitation

Today the strategy can only say:

- `buy`
- `sell`
- `hold`

The side is chosen outside the strategy by CLI configuration.

### New Contract

The strategy decision should support:

- `action`
- `side` for opening decisions, where side can be `up` or `down`
- `size`
- `reason`
- optional tags

Meaning:

- `buy` + `side=up` opens the `up` side
- `buy` + `side=down` opens the `down` side
- `hold` skips the market

The existing single-stream backtest can keep supporting the configured-side fallback for compatibility, but the new batch mode should prefer the strategy-selected side.

## Batch Backtest Mode

Add a dedicated batch command instead of overloading the current single-stream backtest behavior.

Recommended command shape:

- `npm run botlab -- backtest-batch --strategy=btc-eth-5m --data=...`

This keeps the current `backtest` command intact for the already-working single-stream sample replay.

### Input Data

The batch mode should accept the same CSV style already used for Polymarket data:

- `timestamp`
- `market`
- `timeframe`
- `up_price`
- `down_price`
- `volume`
- `outcome`

### Market Semantics

Each row represents one independent prediction market that already has:

- quoted `up` and `down` prices
- the resolved outcome

That means batch mode does not need to simulate holding through many rows of the same market. Instead, each row is one closed trade opportunity once the strategy chooses a side.

## Context Construction For Strategy Logic

Even though each market is independent, the strategy still needs recent context. The batch engine should build that context from prior rows of the same asset and timeframe.

For example:

- BTC rows use recent BTC rows only
- ETH rows use recent ETH rows only

The strategy should see:

- recent candle-like history derived from those prior rows
- current market identity
- current quoted prices
- balance and current clock

This keeps the strategy close to the `freqtrade` idea of consuming generic recent history rather than framework-provided custom signals.

## Aggressive Bilateral BTC / ETH Strategy

### Purpose

Replace the current conservative one-sided momentum bias with a strategy that actively chooses `up` or `down` and aims for higher upside.

### Style

This strategy should be selective but aggressive:

- prefer stronger directional setups over constant low-confidence trading
- allow both `up` and `down`
- use recent short-window structure to decide direction
- skip when the signal is mixed

### Decision Logic

The strategy should compute a direction score from recent rows, using generic recent-history inputs only.

Recommended ingredients:

- recent price change over the lookback window
- share of rising versus falling closes
- latest close location within the recent mini-range
- recent average move size

Recommended behavior:

- choose `up` when the score is strongly positive
- choose `down` when the score is strongly negative
- hold when the score is weak or conflicted

### Aggressive Sizing

This strategy should risk more than the current sample strategy. It should still cap spend per market, but the default allocation should be materially higher than the current conservative amount.

The goal is not safety-first behavior. The goal is to give strong setups enough size to matter.

## Outputs

The new batch command should print a summary that makes the month-long result easy to read:

- strategy id
- data file
- rows processed
- markets traded
- skipped markets
- `up` trades
- `down` trades
- win count
- loss count
- total fees
- ending equity
- return percentage
- max drawdown

It should also keep structured results in memory for tests:

- per-trade log
- equity curve
- summary object

## Error Handling

The new batch mode should fail clearly when:

- the CSV file is missing
- required columns are missing
- any row has invalid prices
- `outcome` is missing, because batch settlement depends on it
- there is not enough prior history to evaluate the strategy

The strategy should fail safely to `hold` when there is not enough usable history.

## Compatibility

The existing features should keep working:

- `list-strategies`
- `describe-strategy`
- `run`
- current single-stream `backtest`

The new work should add capability without breaking the simpler paths already in place.

## Likely Files To Touch

Expected implementation areas:

- `D:/Mikoto/botlab/botlab/core/types.ts`
- `D:/Mikoto/botlab/botlab/backtest/engine.ts`
- `D:/Mikoto/botlab/botlab/backtest/`
- `D:/Mikoto/botlab/botlab/commands/`
- `D:/Mikoto/botlab/botlab/cli.ts`
- `D:/Mikoto/botlab/botlab/strategies/btc-eth-5m.strategy.ts`
- `D:/Mikoto/botlab/botlab/tests/`
- `D:/Mikoto/botlab/botlab/README.md`

## Testing

Implementation should only be considered complete when it covers:

- strategy decisions can specify `up` or `down`
- batch backtest reads the real Polymarket-style CSV format
- batch mode skips weak setups
- batch mode records both `up` and `down` trades
- fees and equity are updated correctly
- CLI output is readable and stable
- the downloaded BTC last-month dataset runs successfully
- the downloaded ETH last-month dataset runs successfully

## Completion Criteria

This design is fully implemented when:

- Botlab has a first-class batch backtest command
- strategies can choose `up` or `down` directly
- the BTC / ETH strategy is bilateral and more aggressive than the current one
- the new command runs successfully on the downloaded last-month BTC and ETH datasets
- documentation explains how to run it
- tests and fresh command runs confirm the flow works

## Notes

`D:/Mikoto/botlab` is still not a Git repository, so this spec can be written locally but not committed until the project is placed under Git.
