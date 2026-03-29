import fs from 'node:fs';
import path from 'node:path';
import type {
  BotlabCandle,
  BotlabConfig,
  BotlabPaths,
  BotlabRelatedMarketRuntime,
  BotlabRuntimeConfig,
} from '../core/types.js';

const DEFAULT_RUNTIME: BotlabRuntimeConfig = {
  mode: 'dry-run',
  market: {
    asset: 'BTC',
    symbol: 'BTC-USD',
    timeframe: '5m',
    price: 100,
    changePct24h: 1.2,
    momentum: 0.72,
    volume: 250000,
    timestamp: '2026-03-26T09:30:00.000Z',
    candles: [
      { timestamp: '2026-03-26T09:10:00.000Z', open: 98.9, high: 99.8, low: 98.7, close: 99.6, volume: 1100 },
      { timestamp: '2026-03-26T09:15:00.000Z', open: 99.6, high: 100.4, low: 99.5, close: 100.1, volume: 1250 },
      { timestamp: '2026-03-26T09:20:00.000Z', open: 100.1, high: 100.9, low: 100, close: 100.6, volume: 1380 },
      { timestamp: '2026-03-26T09:25:00.000Z', open: 100.6, high: 101, low: 100.3, close: 100.8, volume: 1410 },
      { timestamp: '2026-03-26T09:30:00.000Z', open: 100.8, high: 101.4, low: 100.7, close: 101.2, volume: 1490 },
    ],
  },
  position: {
    side: 'flat',
    size: 0,
    entryPrice: null,
  },
  balance: 1000,
  clock: {
    now: '2026-03-26T09:30:00.000Z',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCandle(value: unknown): value is BotlabCandle {
  return isRecord(value)
    && typeof value.timestamp === 'string'
    && typeof value.open === 'number'
    && typeof value.high === 'number'
    && typeof value.low === 'number'
    && typeof value.close === 'number'
    && typeof value.volume === 'number';
}

function isRelatedMarketRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.asset === 'string'
    && typeof value.symbol === 'string'
    && typeof value.timeframe === 'string'
    && typeof value.volume === 'number'
    && Number.isFinite(value.volume)
    && typeof value.timestamp === 'string'
    && Array.isArray(value.candles)
    && value.candles.every(isValidCandle);
}

function optionalFiniteNumber(
  value: unknown,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function cloneDefaultRuntime(): BotlabRuntimeConfig {
  return {
    mode: DEFAULT_RUNTIME.mode,
    market: {
      ...DEFAULT_RUNTIME.market,
      candles: DEFAULT_RUNTIME.market.candles.map((candle) => ({ ...candle })),
    },
    position: { ...DEFAULT_RUNTIME.position },
    balance: DEFAULT_RUNTIME.balance,
    clock: { ...DEFAULT_RUNTIME.clock },
  };
}

function cloneRelatedMarkets(relatedMarkets: BotlabRelatedMarketRuntime[] | undefined): BotlabRelatedMarketRuntime[] | undefined {
  if (!relatedMarkets) {
    return undefined;
  }

  return relatedMarkets.map((market) => ({
    ...market,
    candles: market.candles.map((candle) => ({ ...candle })),
  }));
}

function normalizeRelatedMarket(market: Record<string, unknown>): BotlabRelatedMarketRuntime {
  const candleValues = Array.isArray(market.candles) ? market.candles : [];
  const candles = candleValues.filter(isValidCandle).map((candle) => ({ ...candle }));
  const latest = candles.at(-1);
  const fallbackPrice = typeof market.price === 'number' && Number.isFinite(market.price) ? market.price : 0;
  const fallbackTimestamp = typeof market.timestamp === 'string' ? market.timestamp : DEFAULT_RUNTIME.clock.now;

  return {
    asset: String(market.asset),
    symbol: String(market.symbol),
    timeframe: String(market.timeframe),
    price: latest?.close ?? fallbackPrice,
    upPrice: optionalFiniteNumber(market.upPrice),
    downPrice: optionalFiniteNumber(market.downPrice),
    upAsk: optionalFiniteNumber(market.upAsk),
    downAsk: optionalFiniteNumber(market.downAsk),
    volume: typeof market.volume === 'number' && Number.isFinite(market.volume) ? market.volume : 0,
    timestamp: latest?.timestamp ?? fallbackTimestamp,
    candles,
  };
}

function mergeRuntimeOverrides(runtime: Record<string, unknown>): BotlabRuntimeConfig {
  const merged = cloneDefaultRuntime();

  if (runtime.mode === 'dry-run' || runtime.mode === 'paper' || runtime.mode === 'live') {
    merged.mode = runtime.mode;
  }
  if (typeof runtime.balance === 'number' && Number.isFinite(runtime.balance)) {
    merged.balance = runtime.balance;
  }

  if (isRecord(runtime.market)) {
    if (typeof runtime.market.asset === 'string' && runtime.market.asset.trim()) {
      merged.market.asset = runtime.market.asset;
    }
    if (typeof runtime.market.symbol === 'string' && runtime.market.symbol.trim()) {
      merged.market.symbol = runtime.market.symbol;
    }
    if (typeof runtime.market.timeframe === 'string' && runtime.market.timeframe.trim()) {
      merged.market.timeframe = runtime.market.timeframe;
    }
    if (typeof runtime.market.price === 'number' && Number.isFinite(runtime.market.price)) {
      merged.market.price = runtime.market.price;
    }
    if (typeof runtime.market.upPrice === 'number' && Number.isFinite(runtime.market.upPrice)) {
      merged.market.upPrice = runtime.market.upPrice;
    }
    if (typeof runtime.market.downPrice === 'number' && Number.isFinite(runtime.market.downPrice)) {
      merged.market.downPrice = runtime.market.downPrice;
    }
    if (typeof runtime.market.upAsk === 'number' && Number.isFinite(runtime.market.upAsk)) {
      merged.market.upAsk = runtime.market.upAsk;
    }
    if (typeof runtime.market.downAsk === 'number' && Number.isFinite(runtime.market.downAsk)) {
      merged.market.downAsk = runtime.market.downAsk;
    }
    if (typeof runtime.market.changePct24h === 'number' && Number.isFinite(runtime.market.changePct24h)) {
      merged.market.changePct24h = runtime.market.changePct24h;
    }
    if (typeof runtime.market.momentum === 'number' && Number.isFinite(runtime.market.momentum)) {
      merged.market.momentum = runtime.market.momentum;
    }
    if (typeof runtime.market.volume === 'number' && Number.isFinite(runtime.market.volume)) {
      merged.market.volume = runtime.market.volume;
    }
    if (typeof runtime.market.timestamp === 'string' && runtime.market.timestamp.trim()) {
      merged.market.timestamp = runtime.market.timestamp;
    }
    if (Array.isArray(runtime.market.candles)) {
      const candles = runtime.market.candles.filter(isValidCandle).map((candle) => ({ ...candle }));
      if (candles.length > 0) {
        merged.market.candles = candles;
        const latest = candles[candles.length - 1];
        merged.market.price = latest.close;
        merged.market.timestamp = latest.timestamp;
      }
    }
  }

  if (Array.isArray(runtime.relatedMarkets)) {
    const relatedMarkets = runtime.relatedMarkets
      .filter(isRelatedMarketRecord)
      .map((market) => normalizeRelatedMarket(market));

    if (relatedMarkets.length > 0) {
      merged.relatedMarkets = cloneRelatedMarkets(relatedMarkets);
    }
  }

  if (isRecord(runtime.position)) {
    if (runtime.position.side === 'flat' || runtime.position.side === 'long' || runtime.position.side === 'short') {
      merged.position.side = runtime.position.side;
    }
    if (typeof runtime.position.size === 'number' && Number.isFinite(runtime.position.size)) {
      merged.position.size = runtime.position.size;
    }
    if (runtime.position.entryPrice === null || (typeof runtime.position.entryPrice === 'number' && Number.isFinite(runtime.position.entryPrice))) {
      merged.position.entryPrice = runtime.position.entryPrice as number | null;
    }
  }

  if (isRecord(runtime.clock)) {
    if (typeof runtime.clock.now === 'string' && runtime.clock.now.trim()) {
      merged.clock.now = runtime.clock.now;
    }
  }

  return merged;
}

export function resolveBotlabPaths(cwd = process.cwd()): BotlabPaths {
  const rootDir = path.resolve(cwd, 'botlab');

  return {
    rootDir,
    strategyDir: path.resolve(rootDir, 'strategies'),
    templateDir: path.resolve(rootDir, 'templates'),
    defaultConfigPath: path.resolve(rootDir, 'config/example.config.json'),
  };
}

export function loadBotlabConfig(configPath?: string, cwd = process.cwd()): BotlabConfig {
  const paths = resolveBotlabPaths(cwd);
  const selectedConfigPath = configPath ? path.resolve(cwd, configPath) : paths.defaultConfigPath;

  if (!fs.existsSync(selectedConfigPath)) {
    return {
      paths,
      runtime: cloneDefaultRuntime(),
    };
  }

  const raw = fs.readFileSync(selectedConfigPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Botlab config must be a JSON object: ${selectedConfigPath}`);
  }

  const runtime = isRecord(parsed.runtime) ? parsed.runtime : {};

  return {
    paths,
    runtime: mergeRuntimeOverrides(runtime),
  };
}
