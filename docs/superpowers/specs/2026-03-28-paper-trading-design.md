# Paper Trading Design

## Goal

Add a paper-trading mode for the current main strategy, `btc-eth-5m-multi-signal`, so it can run for long periods against live BTC and ETH 5m prediction markets while keeping the same core workflow that a future real-money mode will use.

The immediate goal is not to build a dashboard or a broker integration. The immediate goal is to let the user run the strategy continuously, inspect what it would have done, and compare that paper behavior against backtests.

## Product Direction

The paper-trading flow should follow the same structural rule used by freqtrade dry-run mode:

- strategy evaluation flow is shared with real trading
- market polling / iteration flow is shared with real trading
- position and balance handling follow the same lifecycle
- only the final execution sink changes:
  - paper mode records simulated fills
  - live mode will later send real orders

This avoids building a separate toy loop for paper mode that later has to be thrown away.

## Why This Shape

The current project already has:

- strategy loading
- strategy execution
- backtesting
- hedge backtesting
- a runtime mode field that already distinguishes `dry-run`, `paper`, and `live`

What it does not yet have is a long-running market loop with persistent paper account state.

If paper trading is added as a separate one-off command that bypasses the future live path, then the project will end up with:

- one flow for backtest
- one flow for paper
- one different flow for live

That would make paper results much less useful as a rehearsal for future live trading.

## Recommended Approach

Build one reusable live-loop framework and plug paper execution into it first.

The first version should include:

- a long-running `paper` command
- live market fetch for BTC and ETH 5m prediction markets
- one shared iteration loop
- persistent paper wallet and open-position state
- append-only session logs
- resumable paper sessions

The live order sink stays out of scope for this iteration, but the loop should be shaped so it can be added later without redoing the rest of the system.

## Alternatives Considered

### 1. Separate Paper Command With Its Own Logic

Pros:

- fastest short-term path
- minimal code motion

Cons:

- creates a second execution model
- paper behavior becomes a weak rehearsal for live
- high chance of divergence later

### 2. Shared Live/Paper Loop

This is the recommended approach.

Pros:

- paper is a true dress rehearsal for later live mode
- shared logic reduces future drift
- better fit for the user's "same flow as live" requirement

Cons:

- slightly more upfront structure work
- requires clearer boundaries between market data, decision, execution, and persistence

### 3. UI-First Paper Trading

Pros:

- easier to watch visually

Cons:

- delays the most important part: getting the loop running
- risks spending time on surface before the behavior is trustworthy

## User Workflow

The first version should feel like this:

1. The user starts a paper session with one command.
2. The process keeps running and watches BTC and ETH 5m markets.
3. Each cycle:
   - fetches the latest market state
   - rebuilds the strategy input
   - loads current paper wallet and open positions
   - runs the strategy
   - decides whether to enter, exit, or hold
   - records the outcome to a session log
4. The user can stop the process at any time.
5. The next launch can resume the same paper account and continue from the last stored state.

This keeps paper trading practical for real observation instead of forcing each run to restart from a blank wallet.

## Command Shape

Add a new CLI entry:

- `paper --strategy=<id>`

Optional flags for the first version:

- `--session=<name>` to choose or resume a named paper session
- `--config=<path>` to reuse project config
- `--interval=<seconds>` to control polling cadence

The command should default to the current main strategy if the user does not override it in a later iteration, but the first version can require the strategy id explicitly to stay consistent with the current CLI style.

## Shared Runtime Architecture

The paper-trading loop should be separated into small units with one purpose each.

### Market Source

Responsible for fetching the latest BTC and ETH 5m market state.

For the first version this should:

- fetch the current market snapshot needed by `btc-eth-5m-multi-signal`
- expose the values required to build the same kind of strategy input used elsewhere
- prefer executable-side prices when available instead of idealized display prices

### Session Store

Responsible for saving and loading paper-session state.

It should persist:

- paper balance
- open paper positions
- realized trade history
- session metadata
- latest processed timestamp or cycle marker

The storage can be simple local files in the project tree. A database is unnecessary for the first version.

### Loop Runner

Responsible for orchestrating each cycle.

It should:

- load session state
- fetch market state
- rebuild contexts
- run the strategy
- pass the decision to the execution sink
- persist the updated session
- append a cycle log entry
- sleep until the next cycle

### Execution Sink

Responsible for turning strategy decisions into account changes.

For the first version this is paper-only:

- simulate fills
- update positions
- deduct fees
- track realized and unrealized pnl

Later, a live sink can replace this without changing the loop runner.

## Execution Model

The paper execution model should stay deliberately close to a future live model.

That means:

- decisions do not directly mutate balance inside the strategy
- fills are handled in the execution layer
- fees are charged in the paper executor
- positions have explicit open / close state
- logs record both the strategy reason and the paper account result

This keeps paper mode from becoming a simplified "print a buy signal and call it done" feature.

## Session Files

The first version should create one folder per named paper session.

Suggested contents:

- `state.json` for the latest paper wallet and open positions
- `events.jsonl` for append-only cycle and trade events
- `summary.json` for easy quick inspection

This is intentionally simple:

- easy to inspect by hand
- easy to resume
- easy to replace with a richer interface later

## Logging And Visibility

Because there is no web UI in the first version, the paper command must be readable enough from the terminal and the saved files.

Each cycle should make it clear:

- timestamp
- current BTC and ETH market snapshot used
- strategy action
- whether a paper trade was opened, closed, or skipped
- updated paper balance / equity

The saved event log should preserve more detail than the terminal summary so the user can inspect a run after the fact.

## Error Handling

The loop should be resilient rather than brittle.

Expected first-version behavior:

- transient fetch failures should log and retry instead of killing the session immediately
- malformed or incomplete market data should skip that cycle and log the reason
- corrupted session files should fail loudly with a clear message instead of silently resetting funds

The first version does not need complicated retry backoff trees, but it must be safe enough to run unattended for a while.

## Out Of Scope

This first paper-trading version does not include:

- live order execution
- a web UI
- multiple concurrent strategies in one process
- advanced portfolio dashboards
- complex risk panels
- order-book-level simulation with queue position modeling

## Testing Plan

Implementation should prove the following with automated tests:

- a paper session can start from empty state
- a paper session can resume from saved state
- a cycle can fetch market data, run the strategy, and persist results
- paper execution updates cash and positions correctly
- failed fetch cycles do not destroy session state

## Verification Plan

Before calling the work complete, the implementation must be verified by actually running a paper session locally.

Required verification:

- focused paper-session tests
- full botlab test suite
- smoke tests
- build
- real paper command run that creates a session directory
- confirmation that logs and state files update across multiple cycles
- confirmation that stopping and restarting can resume the same session

## Deliverables

- a new `paper` CLI command
- shared live/paper loop structure that can later host a live execution sink
- local persistent paper session files
- terminal and file logging for paper sessions
- verified local run instructions in the README
