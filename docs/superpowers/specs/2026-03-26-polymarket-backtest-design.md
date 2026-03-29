# Polymarket Backtest Design

**Date:** 2026-03-26

## Goal

Add a real backtest entry to `D:/Mikoto/botlab` so strategies can be replayed on historical Polymarket-style data and produce results that are closer to live trading than a toy candle replay.

This backtest must account for:

- prediction-market style `up` / `down` positions
- order execution with slippage
- trading fees
- per-trade profit and loss
- full equity curve
- optional final settlement when a resolved outcome is available

## Why This Change

The current Botlab workflow can list strategies, inspect them, and run a single live-like snapshot. That is useful for framework validation, but it does not answer the important question: "what would this strategy have done over time?"

For a Polymarket-style strategy, a usable backtest cannot be built from the usual spot-market assumptions:

- the position is not a normal long or short on the underlying asset
- the trade is on `Yes` / `No` outcome tokens
- prices live in a bounded range and can settle to `0` or `1`
- fees are not a flat stock-style percentage

So the backtest needs its own explicit market model instead of pretending this is a standard crypto spot engine.

## Official Market Rules That Shape The Design

As of **2026-03-26**, Polymarket's public documentation says:

- trading happens through a central limit order book
- trades create `Yes` and `No` outcome token positions
- when a market resolves, winning shares pay **$1 per share** and losing shares become worthless
- the fee model is documented separately, and the docs also note an updated fee structure taking effect on **2026-03-30**

That means the backtest should:

- model positions as `up` / `down` outcome shares
- support pre-resolution mark-to-market equity
- support optional resolved settlement
- isolate fee logic so it can be updated without rewriting the engine

## Scope

### In Scope

- add a `backtest` CLI command
- accept historical data from CSV
- replay history row by row
- let a strategy emit `buy`, `sell`, or `hold`
- map strategy actions onto Polymarket-style `up` / `down` positions
- apply configurable slippage
- apply configurable fees using a pluggable fee calculator
- track cash, open position value, realized profit, unrealized profit, and equity curve
- print a readable backtest summary
- save enough detail in memory to inspect per-trade results in tests
- ship a small bundled sample CSV so the command can be demonstrated immediately

### Out of Scope

- live API access
- historical order book depth replay
- partial fills from actual book liquidity
- multiple simultaneous markets in one run
- portfolio-level risk sizing across many positions
- optimization or hyperparameter search
- graphical chart rendering

## Recommended Approaches

### Option 1: Candle Close Replay Only

Treat each candle close as the exact execution price and ignore market friction.

Why not choose this:

- too far from Polymarket reality
- no slippage
- no fee treatment
- misleading results

### Option 2: Candle Replay With Polymarket Trading Model

Replay historical rows from CSV, execute trades on quoted `Yes` / `No` prices with configurable slippage, apply fees, and maintain an equity curve.

Why this is recommended:

- much simpler than full order book replay
- still usable right now with normal exported data
- close enough to live behavior for first-pass strategy evaluation
- easy to extend later

### Option 3: Full Order Book Replay

Replay the actual book and fill orders against historical resting liquidity.

Why not choose this first:

- best realism, but highest data requirement
- not practical unless full historical book data already exists
- too large for the next step

## Data Model

The backtest should use CSV because it is easy to inspect, easy to export, and easy to swap later.

### Required CSV Columns

- `timestamp`
- `market`
- `timeframe`
- `up_price`
- `down_price`

### Recommended CSV Columns

- `volume`
- `mid_price`
- `outcome`

### Notes

- `up_price` and `down_price` should be interpreted in the Polymarket `0` to `1` price range
- if `outcome` exists, it should be either `up` or `down` and represents final resolution
- if `outcome` is absent, the backtest still runs, but the final result is mark-to-market only

## Runtime Model

The backtest engine should simulate one market at a time.

At every row:

1. update the strategy context with the latest replay window
2. let the strategy decide `buy`, `sell`, or `hold`
3. translate that into a position action
4. apply execution price, slippage, and fees
5. update cash and current holdings
6. mark open positions to market
7. append a new point to the equity curve

## Position Model

The engine should not use generic `long` / `short` wording internally for user-facing results. For this Polymarket backtest, the active side should be:

- `flat`
- `up`
- `down`

The meaning should be:

- `up`: holding the `Yes` side
- `down`: holding the `No` side

The strategy adapter layer should work like this:

- `buy` while flat opens the preferred side for the current row
- `sell` closes the currently open side
- `hold` does nothing

For the first backtest version, side selection should come from configuration, not from the current generic strategy contract. This keeps the framework change smaller:

- `signal_side = up` means a `buy` opens `up`
- `signal_side = down` means a `buy` opens `down`

For `btc-eth-5m`, the first bundled sample should use `signal_side = up`.

## Strategy Context During Replay

The backtest should continue using the generic Botlab strategy context shape and supply:

- current market identity
- timeframe
- current displayed price
- recent candles or price rows
- current balance
- current position state
- current replay clock

For Polymarket rows:

- `market.price` should reflect the currently traded side's price for the strategy being evaluated
- `market.asset` can remain a general market label from the CSV
- the rolling history should be built from replay rows so existing candle-based strategy logic can still operate

This keeps the strategy contract reusable instead of inventing a second totally separate strategy interface.

## Execution Price and Slippage

Slippage should be configurable and applied against the quoted side price:

- opening `up`: execution price = `up_price + slippage`
- opening `down`: execution price = `down_price + slippage`
- closing `up`: execution price = `up_price - slippage`
- closing `down`: execution price = `down_price - slippage`

The engine must clamp prices to the valid `0` to `1` range after slippage.

This is still a simplification, but it is materially better than assuming fills always happen at the displayed price.

## Fee Model

Fees must be isolated behind a fee calculator module.

### First Version

The engine should support:

- a simple configurable fallback fee model
- a dedicated Polymarket fee model module

The Polymarket module should be written so its parameters can be updated later without changing the rest of the engine.

### Important Date Note

Because Polymarket's docs show an updated fee structure taking effect on **2026-03-30**, the first version should make the fee model explicitly versioned. The default sample backtest can use the documented structure active for the sample dataset, and the code should make it easy to swap to the newer schedule.

## Profit And Loss

For an open position:

- unrealized value = held shares x current side price
- equity = cash + unrealized value

When closing:

- realized proceeds = held shares x exit execution price
- realized profit = proceeds - entry cost - open fee - close fee

When the market has a final resolved outcome:

- winning side settles at `1`
- losing side settles at `0`
- settlement value replaces the final marked price

This lets the engine report both:

- mark-to-market results during the replay
- final settled results if outcome data exists

## Outputs

The `backtest` command should print a human-readable summary including:

- strategy id
- data file used
- number of rows replayed
- number of trades
- number of wins and losses
- total realized profit
- ending equity
- return percentage
- max drawdown
- fee total
- slippage setting
- whether final settlement was applied

It should also retain structured details in code for tests:

- per-trade log
- equity curve array
- summary object

## Bundled Sample Data

The project should include a small sample CSV under a data folder so the command works immediately after implementation.

The sample should:

- be short enough for tests
- include a clear trend and reversal
- allow at least one open and one close
- preferably include a resolved outcome column so settlement can be demonstrated

## Likely Files To Touch

Expected implementation areas:

- `D:/Mikoto/botlab/botlab/cli.ts`
- `D:/Mikoto/botlab/botlab/core/types.ts`
- `D:/Mikoto/botlab/botlab/core/engine.ts`
- `D:/Mikoto/botlab/botlab/commands/`
- `D:/Mikoto/botlab/botlab/config/`
- `D:/Mikoto/botlab/botlab/tests/`
- new backtest-specific files under `D:/Mikoto/botlab/botlab/core/` or a dedicated `backtest/` folder
- bundled sample CSV under a new data folder

## Error Handling

The backtest should fail clearly when:

- the CSV file is missing
- required columns are missing
- prices are outside the `0` to `1` range
- both side prices are invalid
- there are too few rows to build the strategy lookback

The backtest should not silently continue with malformed rows.

## Testing

Implementation should be considered verified only if it covers:

- CSV parsing and validation
- fee calculation
- slippage-adjusted execution
- opening and closing trades
- equity curve generation
- max drawdown calculation
- settlement handling
- CLI summary output
- a real smoke run on bundled sample data

## Completion Criteria

This design is fully implemented when:

- Botlab has a `backtest` command
- the command can read a CSV file and replay it
- the engine applies slippage and fees
- the engine tracks cash, open positions, trades, and equity curve
- the engine supports optional resolved settlement
- the command prints a clear summary
- a bundled sample dataset can be backtested successfully
- tests and a real command run confirm the flow works

## Sources

- Polymarket trading and order book docs: `https://docs.polymarket.com/polymarket-learn/trading/using-the-orderbook`
- Polymarket fee docs: `https://docs.polymarket.com/trading/fees`
- Polymarket market resolution help: `https://help.polymarket.com/en/articles/13364518-how-are-prediction-markets-resolved`

## Notes

`D:/Mikoto/botlab` is not a Git repository right now, so this spec can be written locally but cannot be committed until the project is put under Git.
