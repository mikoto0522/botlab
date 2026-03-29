# BTC Curve Smoothing Design

## Goal

Adjust the BTC side of `btc-eth-5m-multi-signal` so the equity curve climbs more smoothly while still keeping the strategy able to catch large winning trades.

This design does not aim to maximize headline return at any cost. It aims to keep BTC profitable, reduce the worst swings, and avoid a result that depends almost entirely on a handful of outsized trades.

## Why This Change Is Needed

The current BTC results look strong on the surface:

- Last month: 30 trades, +221.56%, max drawdown 7.89%
- Year to date: 98 trades, +179.55%, max drawdown 50.94%

But the stability check shows the current BTC path is still too fragile:

- Removing the top few winning trades pushes the adjusted result negative
- A very small number of large winners accounts for almost all positive performance
- The year-to-date drawdown is still too deep for a "smooth upward curve" goal

In other words, the current BTC side is profitable, but the path is still too jumpy and too concentrated.

## Non-Goals

This change will not:

- Rewrite the whole framework
- Change ETH logic unless needed for shared safety
- Turn BTC into a low-trade defensive strategy
- Eliminate large BTC winners on purpose

The user explicitly wants BTC to remain able to capture big trades. The strategy should become cleaner, not timid.

## Design

### 1. Keep large BTC opportunities, but make them harder to fake

The current BTC side contains a few replay-style setups and general continuation/reversion setups. Some of them produce large winners that should be preserved. The change will keep those higher-value BTC setups available, but require stronger confirmation before taking the most unstable ones.

The first filter will focus on the BTC setups that currently create the biggest swings:

- upper-band BTC downside replay
- weaker mid-band BTC snapback cases
- general BTC continuation cases that are good enough to trigger but not clean enough to be dependable

These setups will not be removed outright. Instead, they will need stronger prior movement quality, cleaner alignment, or both.

### 2. Let lower-quality BTC setups participate more carefully

To avoid replacing "large volatile trades" with "too few trades," the weaker BTC setups that remain after filtering will still be allowed, but at a smaller size.

This creates three practical BTC buckets:

- strongest BTC setups: keep current ability to size up
- middle-quality BTC setups: still trade, but with less size
- weakest BTC setups: skip completely

This allows the strategy to keep some exposure to large moves without letting borderline BTC entries dominate drawdown.

### 3. Measure success by path quality, not just total return

The acceptance check for this change will focus on all of the following together:

- BTC return remains clearly positive
- BTC max drawdown drops meaningfully from the current year-to-date level
- BTC still captures large winners
- BTC is less concentrated in a few trades than before

This means the new version can accept some reduction in headline BTC return, but not a collapse into a small or trivial result.

## Implementation Outline

1. Inspect the current BTC trade groups and identify which setup families drive drawdown.
2. Add targeted tests that lock in the BTC large-winner path we want to keep and the unstable BTC path we want to cut or downsize.
3. Update the BTC decision rules inside `btc-eth-5m-multi-signal`.
4. If needed, adjust BTC sizing so weaker entries stay smaller than stronger entries.
5. Re-run real BTC backtests for the last month and year to date.
6. Re-check concentration and adjusted return after removing the biggest winners.

## Verification Plan

Before reporting success, run all of these:

- `npm run test:botlab`
- `npm run test:botlab:smoke`
- `npm run build`
- `npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-5m-last-month.csv`
- `npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-5m-ytd.csv`

And compare the new BTC result against the current BTC baseline:

- Last month: 30 trades, +221.56%, max drawdown 7.89%
- Year to date: 98 trades, +179.55%, max drawdown 50.94%

## Done Criteria

This task is complete when:

- the BTC side still has meaningful upside,
- the BTC curve is visibly less volatile,
- drawdown is lower than the current BTC baseline,
- and the new result is less dependent on a tiny handful of winners.
