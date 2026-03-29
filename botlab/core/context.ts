import type { BotlabConfig, BotlabStrategyContext } from './types.js';

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildStrategyContext(config: BotlabConfig): BotlabStrategyContext {
  const runtime = config.runtime;
  const now = isString(runtime.clock?.now) ? runtime.clock.now : new Date().toISOString();
  const timestamp = isString(runtime.market?.timestamp) ? runtime.market.timestamp : now;
  const relatedMarkets = runtime.relatedMarkets?.map((market) => ({
    asset: market.asset,
    symbol: market.symbol,
    timeframe: market.timeframe,
    price: market.price,
    volume: market.volume,
    timestamp: market.timestamp,
    candles: market.candles.map((candle) => ({ ...candle })),
  }));

  return {
    mode: runtime.mode,
    market: {
      asset: runtime.market.asset,
      symbol: runtime.market.symbol,
      timeframe: runtime.market.timeframe,
      price: runtime.market.price,
      changePct24h: runtime.market.changePct24h,
      momentum: runtime.market.momentum,
      volume: runtime.market.volume,
      timestamp,
      candles: runtime.market.candles.map((candle) => ({ ...candle })),
    },
    relatedMarkets,
    position: {
      side: runtime.position.side,
      size: runtime.position.size,
      entryPrice: runtime.position.entryPrice,
    },
    balance: runtime.balance,
    clock: {
      now,
    },
  };
}
