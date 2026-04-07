# Extreme Reversal Paper Strategy Design

## Goal

Add a new botlab strategy that only takes very small contrarian entries when a 5m BTC or ETH prediction market reaches an extreme binary price, shows its own first sign of reversal, and gets a same-timeframe confirmation from the related market. The first release is for paper trading validation, not optimization by backtest.

## Why This Exists

The user wants a strategy that can exploit the last-minute overreaction pattern common in 5m prediction markets. The core idea is not to buy every very cheap side, but to wait until:

1. the side is already priced at an extreme,
2. the market itself has started to turn,
3. the related market is no longer moving against that reversal.

This keeps the strategy closer to “small controlled reversal bet” than “blind lottery ticket.”

## Scope

### In Scope

- Add a new standalone strategy file in `botlab/strategies`
- Support both directions:
  - buy `up` when `up` is extremely cheap and starts to recover
  - buy `down` when `up` is extremely expensive and starts to fade
- Require related-market confirmation:
  - BTC can use ETH as the related market
  - ETH can use BTC as the related market
- Keep stake size intentionally small and fixed-like for paper trading
- Make the strategy usable through existing commands, especially `paper`
- Add focused tests for the strategy behavior
- Update README with usage examples

### Out of Scope

- No historical optimization pass before release
- No extra web UI work
- No changes to the existing main strategies
- No multi-leg hedge behavior in this first version

## Strategy Behavior

### Market Eligibility

The strategy only evaluates:

- `BTC` and `ETH`
- `5m` markets
- flat state only

It should hold when:

- there are not enough candles,
- volume is too low,
- the market is not BTC/ETH 5m,
- there is already an open position.

### Extreme Price Trigger

The strategy opens only inside clear binary extremes.

- Reversal-up candidate:
  - effective `up` entry price is at or below a configured low threshold
- Reversal-down candidate:
  - effective `down` entry price is at or below a configured low threshold
  - equivalently, `up` is at or above a configured high threshold

The strategy should use actual quoted entry prices, not just the display midpoint.

### Self Reversal Confirmation

The target market must show its own first sign of turning:

- for `up` reversal:
  - recent movement had been negative overall,
  - the latest move turns positive,
  - the latest move is meaningful relative to recent average movement
- for `down` reversal:
  - recent movement had been positive overall,
  - the latest move turns negative,
  - the latest move is meaningful relative to recent average movement

This is intentionally simple. The point is to confirm “the slide has started to slow and turn,” not to predict from raw extreme price alone.

### Related-Market Confirmation

The related market acts as a sanity check, not as a second trade leg.

- When trading BTC, look at ETH 5m
- When trading ETH, look at BTC 5m

The related market should support the reversal by doing one of these:

- already turning in the same implied direction,
- or at least no longer accelerating against it

If the related market is still clearly pushing the opposite way, the strategy should hold.

### Position Sizing

This strategy is for paper validation first, so sizing should stay deliberately small.

- one small stake bucket only
- default target should match the user’s current paper preference (`5u` style sizing)
- capped by available balance

### Decision Output

The strategy will produce:

- `buy up`
- `buy down`
- `hold`

The reason string should clearly say which of the three gates passed or failed:

- extreme price,
- self turn,
- related-market confirmation.

## Parameters

The strategy should expose a small default set:

- `lookbackCandles`
- `minimumVolume`
- `extremeLowPrice`
- `extremeHighPrice`
- `minTurnStrength`
- `stakeSize`

Keep it intentionally small for the first paper release.

## Testing

Add focused engine-level tests that prove:

1. the strategy buys `up` on an extreme-low setup with self-turn and related confirmation,
2. the strategy buys `down` on the symmetric extreme-high setup,
3. the strategy holds when the related market still disagrees,
4. the strategy holds when the quoted entry is not extreme enough.

Also run one paper-mode smoke check to confirm the strategy can be launched by the existing `paper` command.

## Acceptance

This work is complete when:

- the new strategy appears in strategy listing and description,
- the paper command can run it,
- the focused tests pass,
- the full botlab test/build commands still pass,
- README explains how to start a paper session with the new strategy.
