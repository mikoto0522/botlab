# Botlab

Botlab is a small strategy sandbox inspired by the "framework first, strategy second" workflow. The core scans strategy files, loads a runtime config, and runs the selected strategy without hard-wiring one specific trading idea into the app.

## What It Does

- scans `botlab/strategies` for strategy files
- shows the bundled strategies that are available
- prints a strategy's details and defaults
- runs a strategy against the current runtime and renders the decision
- creates a starter strategy file from the built-in template

## Bundled Strategies

- `example-momentum`: the starter strategy that still works as a simple example
- `btc-eth-5m`: the more balanced BTC / ETH 5m prediction-market strategy
- `btc-eth-5m-aggressive`: a more aggressive BTC / ETH 5m variant for side-by-side comparison
- `btc-eth-5m-multi-signal`: a higher-frequency BTC / ETH 5m variant that blends several replay-tested entry patterns instead of leaning on one narrow setup
- `btc-eth-5m-pair-model`: a BTC/ETH relative-value variant that uses BTC as the reference market and only opens ETH trades inside a calibrated mid-price zone
- `btc-eth-5m-true-hedge`: a paired BTC/ETH strategy that opens both legs together when one side clearly leads the other
- `polybot-ported`: a botlab-native port of the original polybot strategy shape that chooses direction first, then filters by strength and quoted entry quality before sizing the trade

## Commands

Run everything through the package script:

```bash
npm run botlab -- list-strategies
npm run botlab -- describe-strategy --strategy=btc-eth-5m
npm run botlab -- run --strategy=btc-eth-5m
npm run botlab -- describe-strategy --strategy=polybot-ported
npm run botlab -- run --strategy=polybot-ported
npm run botlab -- paper --strategy=btc-eth-5m-multi-signal --session=my-paper --interval=30
npm run botlab -- describe-strategy --strategy=btc-eth-5m-aggressive
npm run botlab -- describe-strategy --strategy=btc-eth-5m-multi-signal
npm run botlab -- describe-strategy --strategy=btc-eth-5m-pair-model
npm run botlab -- create-strategy --name="My New Strategy"
npm run botlab -- backtest --strategy=btc-eth-5m --data=botlab/data/polymarket-sample.csv
npm run botlab -- backtest-batch --strategy=btc-eth-5m --data=botlab/data/polymarket-sample.csv
npm run botlab -- backtest-batch --strategy=polybot-ported --data=botlab/data/polymarket-btc-5m-last-month.csv
npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-eth-5m-last-month.csv
npm run botlab -- backtest-batch --strategy=btc-eth-5m-pair-model --data=botlab/data/polymarket-btc-eth-5m-last-month.csv
npm run botlab -- backtest-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv
npm run botlab -- analyze-hedge --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv
```

Short aliases are also available:

```bash
npm run botlab:list
npm run botlab:describe -- --strategy=btc-eth-5m
npm run botlab:run -- --strategy=btc-eth-5m
npm run botlab:describe -- --strategy=polybot-ported
npm run botlab:run -- --strategy=polybot-ported
npm run botlab:paper -- --strategy=btc-eth-5m-multi-signal --session=my-paper --interval=30
npm run botlab:create -- --name="My New Strategy"
npm run botlab:backtest -- --strategy=btc-eth-5m --data=botlab/data/polymarket-sample.csv
npm run botlab:backtest:batch -- --strategy=btc-eth-5m --data=botlab/data/polymarket-sample.csv
npm run botlab:backtest:hedge -- --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv
npm run botlab:analyze:hedge -- --strategy=btc-eth-5m-true-hedge --data=botlab/data/polymarket-btc-eth-5m-last-month.csv
```

Backtests accept Polymarket-style up/down CSV data. The expected columns are:

- `timestamp`
- `market`
- `timeframe`
- `up_price`
- `down_price`
- `volume`
- `outcome` is optional, and can be `up` or `down` when you want the sample to settle on the final row

Optional book columns are also supported:

- `up_bid`
- `up_ask`
- `down_bid`
- `down_ask`

The bundled `btc-eth-5m` strategy can run against `botlab/data/polymarket-sample.csv` as-is. Use `--side=down` when you want the backtest to replay the `down_price` path instead of `up_price`.

`backtest` replays one market path at a time and is useful when you want to inspect one up-side or down-side run in isolation.

`backtest-batch` is the monthly Polymarket workflow. It treats each CSV row as one settled market opportunity, lets the strategy decide whether to buy `up`, buy `down`, or skip, and then prints the combined result across the full file.

When bid and ask columns are present, Botlab buys from the ask side instead of the display price. Batch mode also evaluates each row from prior same-asset history, so a strategy cannot see one row and immediately count that same row as a completed trade.

## Paper Trading

Paper trading runs the same strategy flow you would later want for a live mode, but keeps the fills, balance, and logs local on disk instead of placing real orders.

Live paper sessions now prefer realtime market updates. If the realtime feed has not caught up yet or drops out, Botlab automatically falls back to the older polling path so the session can keep running.

Start a named paper session like this:

```bash
npm run botlab -- paper --strategy=btc-eth-5m-multi-signal --session=my-paper --interval=30
```

Run a short bounded local check like this:

```bash
npm run botlab -- paper --strategy=btc-eth-5m-multi-signal --session=my-paper --interval=0 --max-cycles=2
```

For smoke tests or offline checks, you can feed a fixture file instead of live markets:

```bash
npm run botlab -- paper --strategy=btc-eth-5m-multi-signal --session=my-paper --interval=0 --max-cycles=1 --fixture=path/to/paper-fixture.json
```

Each named paper session gets its own folder under `botlab/paper-sessions/` with:

- `state.json`: the latest wallet, open positions, and rolling history
- `summary.json`: a quick session snapshot
- `events.jsonl`: append-only cycle, decision, open, close, settle, and error records

If you stop the command and run the same session name again, Botlab resumes that paper account instead of starting over.

You can also control paper starting cash and strategy sizing from a config file. A ready-to-use example is bundled at `botlab/config/paper-100u-5u.json`, which starts paper trading at `100` and caps the bundled `btc-eth-5m-multi-signal` stake buckets at `5`.

Use it like this:

```bash
npm run botlab -- paper --strategy=btc-eth-5m-multi-signal --session=my-paper --interval=30 --config=botlab/config/paper-100u-5u.json
```

## Real Month Data

The project includes downloaded BTC and ETH 5m Polymarket month data:

- `botlab/data/polymarket-btc-5m-last-month.csv`
- `botlab/data/polymarket-eth-5m-last-month.csv`
- `botlab/data/polymarket-btc-eth-5m-last-month.csv`
- `botlab/data/polymarket-btc-eth-5m-ytd.csv`

Run the batch backtest like this:

```bash
npm run botlab -- backtest-batch --strategy=btc-eth-5m --data=botlab/data/polymarket-btc-5m-last-month.csv
npm run botlab -- backtest-batch --strategy=btc-eth-5m --data=botlab/data/polymarket-eth-5m-last-month.csv
```

Or with the shortcut script:

```bash
npm run botlab:backtest:batch -- --strategy=btc-eth-5m --data=botlab/data/polymarket-btc-5m-last-month.csv
```

Some real exports include `NaN` in the `volume` column. Botlab keeps the row and treats that volume as `0` so the month file still loads cleanly.

The current `btc-eth-5m` strategy uses different rules per asset. BTC now waits for a clean short streak, fades it inside a safer price zone, and keeps each entry capped; ETH still waits for a stretched move in the middle range and fades it.

The `btc-eth-5m-aggressive` variant keeps a wider BTC fade zone and lets ETH fade a slightly wider stretch zone with a larger capped budget, so it is easier to compare a steadier version against a more aggressive one.

The `btc-eth-5m-multi-signal` variant is now regime-aware. It first classifies each BTC or ETH setup as directional, ranging, or noisy, then only lets the matching trade family through. Continuation entries only fire in directional states, reversion entries only fire in ranging states, and noisy states stay flat. The replay paths still work in batch mode, but the live-style side now blocks the worst paper-proven entry zones before they can open.

The `btc-eth-5m-pair-model` variant is the first cross-market strategy. It reads BTC and ETH together, uses BTC as the reference series, and only opens ETH trades when ETH lands in a calibrated mid-price zone and the BTC/ETH gap reaches one of the stronger historical levels.

The `btc-eth-5m-true-hedge` variant is the first paired strategy. It reads BTC and ETH together, classifies the pair into trend, reversion, or noise, and only opens both legs when the pair sits in a cleaner state inside a safer price zone.

The current true-hedge version now allows a slightly wider upper price ceiling and a larger capped stake per leg. That makes it participate in a few more mid-quality paired setups, with the trade-off that drawdown can rise versus the stricter earlier state-based version.

The `polybot-ported` variant is the closest current bridge from the original `polybot-intraday` project into `botlab`. It does not copy the external Binance or Chainlink feeds, but it keeps the same decision order: pick a side, demand enough move strength, reject bad quoted entry prices, then size the trade by confidence.

The latest accepted real-data checks for `btc-eth-5m-multi-signal` were:

- BTC last month: `10` trades, `+59.80%`, max drawdown `2.61%`
- ETH last month: `42` trades, `+42.95%`, max drawdown `10.92%`
- BTC year to date: `28` trades, `+70.06%`, max drawdown `3.50%`
- ETH year to date: `57` trades, `+44.47%`, max drawdown `10.78%`

That means the current accepted version stays positive on all four real-data checks while cutting back the worst paper-proven slices. BTC is now noticeably smoother year to date, and ETH still trades often enough to stay useful without reopening the weakest upside bands that were dragging paper results down.

The historical verification commands used for the accepted version were:

```bash
npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-5m-last-month.csv
npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-eth-5m-last-month.csv
npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-btc-5m-ytd.csv
npm run botlab -- backtest-batch --strategy=btc-eth-5m-multi-signal --data=botlab/data/polymarket-eth-5m-ytd.csv
```

## Default Config

Botlab reads its default runtime from `botlab/config/example.config.json`.

The bundled example config now includes recent candles, so strategies can compute their own signals from raw market data instead of relying on strategy-specific fields.

You can point the CLI at another file with `--config=path/to/file.json`. If the file is missing, Botlab falls back to its built-in runtime so the CLI still works.

## Strategy File Contract

Each strategy lives in a file that matches `*.strategy.ts`, `*.strategy.js`, or `*.strategy.mjs`.

A strategy file should export an object with these fields:

- `id`: a stable string id
- `name`: a friendly display name
- `description`: one short paragraph
- `defaults`: the strategy's default parameters
- `evaluate(context, params)`: returns a decision with `action`, `reason`, and optional `size` or `tags`

The shared `context` includes:

- `market.asset`, `market.symbol`, and `market.timeframe`
- `market.price`, `market.volume`, and the current timestamp
- `market.candles`: a recent candle array with `open`, `high`, `low`, `close`, and `volume`
- `relatedMarkets`: optional companion market snapshots for strategies that compare BTC against ETH or other markets
- `position`, `balance`, and `clock`

You can use the starter example in `botlab/strategies/example-momentum.strategy.ts` as the simplest template, or use `botlab/strategies/btc-eth-5m.strategy.ts` as the first binary-market reference.
