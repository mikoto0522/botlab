# BTC / ETH 5m Kline Strategy Design

**Date:** 2026-03-26

## Goal

Evolve `D:/Mikoto/botlab` toward a more `freqtrade`-like strategy model by changing the framework input from a single simplified market snapshot into reusable candle-based market data, then add a dedicated BTC / ETH 5m strategy that computes its own signals from that generic input.

The point of this change is to make future strategies depend on common raw data instead of adding one-off framework fields for every new idea.

## Why This Change

The current Botlab strategy contract is good enough for a toy example, but it is still too close to a single hard-coded strategy shape. A framework that wants to support many strategies should expose reusable building blocks, not strategy-specific precomputed fields.

`freqtrade` works because strategies consume generic price series data and compute their own logic locally. This design moves Botlab in the same direction:

- the framework provides candles, position state, balance, and metadata
- the strategy computes trend, momentum, and entry/exit rules itself
- future strategies reuse the same input contract instead of requiring framework-specific signal fields

## Scope

### In Scope

- extend Botlab market input to include recent candle data
- keep existing simple runtime state, but make candles the primary strategy input
- preserve current framework flow: load config, load strategy, run strategy, render decision
- add a new BTC / ETH 5m strategy using only generic inputs
- keep the example strategy working, either by adapting it or by preserving a compatibility path
- add tests for the new candle-based input and BTC / ETH 5m strategy behavior

### Out of Scope

- live exchange connectivity
- backtesting engine
- multiple timeframes in one run
- orderbook-based logic
- external indicator services
- direct migration of the original Polymarket signal stack

## Recommended Approach

### Option 1: Add More Dedicated Fields

The framework could expose more custom values such as trend score, entry score, lead/lag score, BTC mode, ETH mode, and so on.

Why not choose this:

- each new strategy idea would force framework changes
- framework and strategy would get coupled again
- this moves away from the `freqtrade` direction

### Option 2: Generic Candle Input With Strategy-Local Logic

The framework exposes recent candles and basic runtime state. Strategies compute their own indicators from those candles.

Why this is recommended:

- much closer to `freqtrade`
- future strategies can reuse the same raw input
- strategy files become the main place where logic evolves
- framework stays smaller and more stable

## Design Overview

The framework should move from this:

- one current market snapshot
- a few simplified derived values

To this:

- market identity
- timeframe
- recent candles
- current position
- current balance
- current mode
- current clock

The strategy then derives its own short-term conditions from the recent candles.

## Input Contract

The new strategy context should include:

- `mode`
- `balance`
- `clock.now`
- `position`
  - side
  - size
  - entry price
- `market`
  - symbol
  - asset
  - timeframe
  - current price
  - recent candles

Each candle should contain:

- timestamp
- open
- high
- low
- close
- volume

This is the important boundary change. Candles become generic input. Indicators such as momentum or trend can still exist as convenience data if desired, but the new BTC / ETH 5m strategy should not depend on special framework-only fields.

## BTC / ETH 5m Strategy

### Purpose

Create a first non-trivial strategy specialized for BTC and ETH on 5-minute candles, but still written entirely against generic inputs.

### Markets

This strategy should only operate when:

- asset is `BTC` or `ETH`
- timeframe is `5m`

Any other asset or timeframe should immediately return `hold`.

### Strategy Style

This should be a filtered short-term trend-following strategy:

- enter only when recent candles show short-term strength
- require simple confirmation from candle direction and recent price expansion
- exit when that strength fades

This is intentionally stronger than the toy momentum example, but still simple enough to fit the current framework.

### Derived Signals Inside The Strategy

The strategy should compute its own local values from recent candles, such as:

- recent close-to-close return
- count of bullish candles in the recent window
- short lookback price expansion
- optional simple average candle body or range

The framework should not precompute these values specially for this strategy.

### Entry Rules

The strategy should only consider entries when currently flat.

Recommended BTC rule:

- recent price change is positive and above a BTC threshold
- a majority of recent candles are bullish
- latest close is near the top of the recent mini-range

Recommended ETH rule:

- same structure, but with slightly stricter thresholds than BTC

ETH should be harder to enter than BTC because it tends to need a bit more confirmation for noisy short windows.

### Exit Rules

The strategy should only consider exits when currently long.

Recommended exit conditions:

- recent short-term change turns negative beyond threshold
- or bullish candle count collapses below a floor
- or latest close falls back through a simple weakness trigger

If no exit rule is hit, return `hold`.

### Parameters

The strategy defaults should include:

- BTC entry threshold
- ETH entry threshold
- BTC exit threshold
- ETH exit threshold
- bullish candle count threshold
- lookback window size
- allocation size

This keeps BTC and ETH behavior different without requiring different framework structures.

## Compatibility With Existing Example Strategy

The existing `example-momentum` strategy should continue to run.

The best path is:

- preserve existing top-level market fields used by the simple example
- add candles as new generic fields

This avoids breaking the already-working command flow while opening the door for richer strategies.

## Likely Files To Touch

Expected implementation areas:

- `D:/Mikoto/botlab/botlab/core/types.ts`
- `D:/Mikoto/botlab/botlab/config/default-config.ts`
- `D:/Mikoto/botlab/botlab/config/example.config.json`
- `D:/Mikoto/botlab/botlab/strategies/example-momentum.strategy.ts`
- `D:/Mikoto/botlab/botlab/strategies/btc-eth-5m.strategy.ts`
- tests under `D:/Mikoto/botlab/botlab/tests`

## Error Handling

The new BTC / ETH 5m strategy should fail safely to `hold` when:

- there are not enough candles
- candles are malformed
- asset or timeframe is unsupported

The framework should not crash because a strategy received incomplete candle data.

## Testing

The implementation should be considered verified only if it covers:

- config can load candle data
- example strategy still works
- BTC / ETH 5m strategy buys on a clearly strong BTC or ETH 5m candle sequence
- BTC / ETH 5m strategy holds on unsupported assets or weak setups
- BTC / ETH 5m strategy sells on a clearly weakening long position setup
- command layer can describe and run the new strategy

## Completion Criteria

This design is fully implemented when:

- Botlab strategies can consume recent candles from the framework input
- the framework still runs existing strategies
- a new `btc-eth-5m` strategy exists
- the strategy uses only generic input data to make decisions
- the CLI can list and run the new strategy
- tests prove entry, hold, and exit behavior for the new strategy

## Notes

This directory is not a Git repository right now, so this spec can be written locally but not committed until the project is put under Git.
