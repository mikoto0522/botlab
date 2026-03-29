# Paper Trading Realtime-First Design

## Goal

Upgrade the current paper-trading market input so it behaves more like a future live trading path:

- prefer realtime market updates
- fall back to polling when realtime is unavailable
- keep the existing paper loop and paper account flow intact

The immediate goal is not to replace the paper loop. The immediate goal is to replace the market-input layer beneath it so the same loop can later feed a live execution sink.

## Product Direction

The new shape should be:

- realtime market source first
- polling market source as the safety net
- one normalized snapshot shape for both
- one loop runner above both

That means the paper loop should not care whether the current snapshot came from a websocket push or a polling fetch. It should receive the same normalized BTC and ETH 5m snapshot shape either way.

## Why This Change

The current polling-only version is useful as a stable first paper mode, but it has three limits:

- it is slower than a future live loop should be
- it spends more bandwidth than necessary
- it is less faithful to how a real execution path would observe the market

Polymarket already exposes realtime market data through its websocket market channel, including best bid / ask and live market updates. That makes realtime the better default input for a later live mode, as long as the system can survive disconnects and market-roll transitions without freezing.

## Recommended Approach

Keep the existing paper loop and add a new shared market-input layer with two sources:

1. `RealtimePaperMarketSource`
   - subscribes to the current BTC and ETH 5m markets
   - keeps the latest normalized snapshot for each asset
   - exposes a `getCurrentSnapshots()` shape that matches the existing loop contract

2. `PollingPaperMarketSource`
   - keeps the current REST-based behavior
   - remains available as a fallback path

3. `HybridPaperMarketSource`
   - prefers realtime snapshots when healthy
   - falls back to polling when realtime has not produced a fresh snapshot in time
   - refreshes the tracked BTC and ETH 5m market refs on rollover

This keeps one loop and one paper execution path, while improving the input layer in a way that later live mode can reuse.

## Architecture

### Snapshot Contract

Both realtime and polling paths must normalize into the same `PaperMarketSnapshot` shape already used by the paper loop.

No strategy-facing format should change in this iteration.

### Realtime Connection Layer

Add a websocket client that:

- opens one market-data connection
- subscribes to the current BTC and ETH 5m market identifiers
- listens for best-bid-ask and related market updates
- updates the in-memory latest snapshot for each tracked asset
- sends keepalive pings as required by the upstream websocket contract

This layer should not make trading decisions. It should only maintain the freshest known normalized market state.

### Market Rollover

Because BTC and ETH 5m prediction markets roll every 5 minutes, the realtime layer must refresh its tracked market refs periodically.

The first version should:

- keep checking whether the active BTC / ETH 5m slugs have changed
- resubscribe when the market rolls
- continue serving the last good snapshot until the next market is ready

### Fallback Rules

The system should fall back to polling when:

- websocket connection fails to start
- websocket disconnects and cannot recover quickly
- current tracked assets do not have fresh realtime snapshots
- market rollover is in progress and realtime data is not ready yet

The fallback should not kill the paper session. It should only change where the snapshots come from.

## Command Behavior

The user-facing `paper` command should keep the same basic flags:

- `--strategy`
- `--session`
- `--interval`
- `--max-cycles`
- `--fixture`

For this iteration, no new flag is required. Realtime-first should become the default live-data behavior automatically.

Terminal output should continue to show one readable line per cycle plus a final summary.

## Error Handling

The system should stay resilient:

- websocket startup failure should log and fall back
- websocket disconnect should log and retry in the background
- malformed websocket payloads should be ignored with a clear event record
- polling should continue to work even if realtime is unhealthy

The paper session should keep running unless both realtime and polling paths fail badly enough that no usable BTC/ETH snapshot can be built.

## Testing Plan

Implementation should prove:

- realtime payloads normalize into the same snapshot shape as polling
- hybrid source prefers realtime when it is healthy
- hybrid source falls back to polling when realtime is stale or disconnected
- market rollover triggers a resubscribe / ref refresh
- the existing paper loop can run unchanged on top of the hybrid source

## Verification Plan

Before completion:

- run focused market-source and paper-loop tests
- run smoke tests
- run full test suite
- run build
- run one bounded paper session with the realtime-first source
- verify that the command still prints per-cycle output and final summary

## Out Of Scope

This iteration does not include:

- live order placement
- user-order websocket handling
- UI work
- full order-book queue simulation
- multi-strategy orchestration

## Deliverables

- realtime-first hybrid market source for paper mode
- polling fallback retained as safety net
- same paper loop contract above both
- verified bounded local run using the upgraded source
