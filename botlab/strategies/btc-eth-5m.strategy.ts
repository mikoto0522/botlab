import type { BotlabCandle, BotlabStrategyDefinition } from '../core/types.js';

interface BtcEth5mParams extends Record<string, unknown> {
  lookbackCandles: number;
  entryScore: number;
  minTrendChangePct: number;
  liveMovePct: number;
  midBinaryMinPrice: number;
  midBinaryMaxPrice: number;
  minBinaryVolume: number;
  binaryAllocation: number;
  allocation: number;
}

interface BinaryAssetProfile {
  allocation: number;
  mode: 'follow' | 'fade';
  minPrice?: number;
  maxPrice?: number;
  lookback: number;
  streak?: number;
  maxStake?: number;
}

function recentCandles(candles: BotlabCandle[], lookback: number): BotlabCandle[] {
  return candles.slice(-lookback);
}

function closeChangePct(candles: BotlabCandle[]): number {
  if (candles.length < 2) {
    return 0;
  }

  const first = candles[0].close;
  const last = candles[candles.length - 1].close;

  return first > 0 ? ((last - first) / first) * 100 : 0;
}

function scoreWindow(
  candles: BotlabCandle[],
  currentPrice: number,
  minTrendChangePct: number,
  liveMovePct: number,
): number {
  let score = 0;
  let bullishBodies = 0;
  let bearishBodies = 0;

  for (const candle of candles) {
    if (candle.close > candle.open) {
      bullishBodies += 1;
    } else if (candle.close < candle.open) {
      bearishBodies += 1;
    }
  }

  score += bullishBodies - bearishBodies;

  let risingCloses = 0;
  let fallingCloses = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const previousClose = candles[index - 1]?.close ?? candles[index].close;
    const currentClose = candles[index]?.close ?? previousClose;

    if (currentClose > previousClose) {
      risingCloses += 1;
    } else if (currentClose < previousClose) {
      fallingCloses += 1;
    }
  }

  score += risingCloses - fallingCloses;

  const trendChangePct = closeChangePct(candles);
  if (trendChangePct >= minTrendChangePct) {
    score += 2;
  } else if (trendChangePct >= minTrendChangePct / 2) {
    score += 1;
  } else if (trendChangePct <= -minTrendChangePct) {
    score -= 2;
  } else if (trendChangePct <= -(minTrendChangePct / 2)) {
    score -= 1;
  }

  const lastClose = candles.at(-1)?.close ?? currentPrice;
  const liveMovePctValue = lastClose > 0 ? ((currentPrice - lastClose) / lastClose) * 100 : 0;

  if (liveMovePctValue >= liveMovePct * 2) {
    score += 3;
  } else if (liveMovePctValue >= liveMovePct) {
    score += 2;
  } else if (liveMovePctValue <= -(liveMovePct * 2)) {
    score -= 3;
  } else if (liveMovePctValue <= -liveMovePct) {
    score -= 2;
  }

  return score;
}

function buildReason(asset: string, score: number, side: 'up' | 'down'): string {
  return `${asset} 5m score reached ${score} for ${side}`;
}

function buildBinaryPatternReason(
  asset: string,
  side: 'up' | 'down',
  mode: 'follow' | 'fade',
  direction: 'rising' | 'falling',
  streak: number,
  currentUpPrice: number,
): string {
  return `${asset} 5m ${mode} signal bought ${side} after ${direction} streak ${streak} with up at ${currentUpPrice.toFixed(2)}`;
}

function isBinaryMarketContext(candles: BotlabCandle[], currentPrice: number): boolean {
  return currentPrice > 0 && currentPrice < 1
    && candles.every((candle) => candle.open >= 0 && candle.open <= 1 && candle.close >= 0 && candle.close <= 1);
}

function isCurrentCandleEmbedded(candles: BotlabCandle[], currentPrice: number, currentTimestamp: string): boolean {
  const latest = candles.at(-1);
  if (!latest) {
    return false;
  }

  return latest.timestamp === currentTimestamp && Math.abs(latest.close - currentPrice) < 1e-9;
}

function getBinaryProfile(asset: string): BinaryAssetProfile {
  if (asset === 'BTC') {
    return {
      allocation: 0.05,
      maxStake: 25,
      mode: 'fade',
      minPrice: 0.01,
      maxPrice: 0.6,
      lookback: 4,
      streak: 3,
    };
  }

  return {
    allocation: 0.14,
    mode: 'fade',
    minPrice: 0.3,
    maxPrice: 0.6,
    lookback: 6,
    streak: 4,
  };
}

function getBinaryHistory(candles: BotlabCandle[], currentPrice: number, currentTimestamp: string): BotlabCandle[] {
  if (isCurrentCandleEmbedded(candles, currentPrice, currentTimestamp)) {
    return candles.slice(0, -1);
  }

  return candles;
}

function countBinaryMoves(candles: BotlabCandle[]): { rising: number; falling: number } {
  let rising = 0;
  let falling = 0;

  for (let index = 1; index < candles.length; index += 1) {
    const previousClose = candles[index - 1]?.close ?? candles[index].close;
    const currentClose = candles[index]?.close ?? previousClose;

    if (currentClose > previousClose) {
      rising += 1;
    } else if (currentClose < previousClose) {
      falling += 1;
    }
  }

  return { rising, falling };
}

export const strategy: BotlabStrategyDefinition<BtcEth5mParams> = {
  id: 'btc-eth-5m',
  name: 'BTC / ETH 5m Binary Pattern',
  description: 'Trades BTC and ETH 5m binary markets with asset-specific price-pattern rules built from prior market closes.',
  defaults: {
    lookbackCandles: 5,
    entryScore: 5,
    minTrendChangePct: 0.8,
    liveMovePct: 0.2,
    midBinaryMinPrice: 0.4,
    midBinaryMaxPrice: 0.6,
    minBinaryVolume: 1000,
    binaryAllocation: 0.1,
    allocation: 0.25,
  },
  evaluate(context, params) {
    if (!['BTC', 'ETH'].includes(context.market.asset) || context.market.timeframe !== '5m') {
      return {
        action: 'hold',
        reason: 'strategy only supports BTC/ETH 5m candles',
      };
    }

    const marketCandles = context.market.candles;
    const candles = recentCandles(marketCandles, params.lookbackCandles);

    if (context.position.side !== 'flat') {
      return {
        action: 'hold',
        reason: 'strategy only opens new positions from a flat state',
        tags: ['btc-eth-5m', 'idle'],
      };
    }

    const binaryMarket = isBinaryMarketContext(marketCandles, context.market.price);
    if (binaryMarket) {
      const binaryProfile = getBinaryProfile(context.market.asset);
      const currentUpPrice = context.market.price;
      const history = getBinaryHistory(marketCandles, context.market.price, context.market.timestamp);
      const historyWindow = history.slice(-binaryProfile.lookback);
      const positionSize = Number(
        Math.min(
          context.balance * Math.min(binaryProfile.allocation, params.binaryAllocation),
          binaryProfile.maxStake ?? Number.POSITIVE_INFINITY,
        ).toFixed(2),
      );

      if (positionSize <= 0) {
        return {
          action: 'hold',
          reason: 'balance is too small to open a meaningful binary position',
          tags: ['btc-eth-5m', 'idle'],
        };
      }

      if (context.market.volume < params.minBinaryVolume) {
        return {
          action: 'hold',
          reason: `binary volume ${context.market.volume.toFixed(0)} is too thin to trust`,
          tags: ['btc-eth-5m', 'idle'],
        };
      }

      if (historyWindow.length < binaryProfile.lookback) {
        return {
          action: 'hold',
          reason: `need ${binaryProfile.lookback} binary closes before evaluating ${binaryProfile.mode} setup`,
          tags: ['btc-eth-5m', 'idle'],
        };
      }

      if (currentUpPrice < (binaryProfile.minPrice ?? 0) || currentUpPrice > (binaryProfile.maxPrice ?? 1)) {
        return {
          action: 'hold',
          reason: `binary market moved outside ${(binaryProfile.minPrice ?? 0).toFixed(2)}-${(binaryProfile.maxPrice ?? 1).toFixed(2)} with up at ${currentUpPrice.toFixed(2)}`,
          tags: ['btc-eth-5m', 'idle'],
        };
      }

      const { rising, falling } = countBinaryMoves(historyWindow);
      const streak = binaryProfile.streak ?? 0;

      if (binaryProfile.mode === 'follow' && rising >= streak) {
        return {
          action: 'buy',
          side: 'up',
          size: positionSize,
          reason: buildBinaryPatternReason(context.market.asset, 'up', binaryProfile.mode, 'rising', rising, currentUpPrice),
          tags: ['btc-eth-5m', 'entry', 'up', 'binary-follow'],
        };
      }

      if (binaryProfile.mode === 'follow' && falling >= streak) {
        return {
          action: 'buy',
          side: 'down',
          size: positionSize,
          reason: buildBinaryPatternReason(context.market.asset, 'down', binaryProfile.mode, 'falling', falling, currentUpPrice),
          tags: ['btc-eth-5m', 'entry', 'down', 'binary-follow'],
        };
      }

      if (binaryProfile.mode === 'fade' && rising >= streak) {
        return {
          action: 'buy',
          side: 'down',
          size: positionSize,
          reason: buildBinaryPatternReason(context.market.asset, 'down', binaryProfile.mode, 'rising', rising, currentUpPrice),
          tags: ['btc-eth-5m', 'entry', 'down', 'binary-fade'],
        };
      }

      if (binaryProfile.mode === 'fade' && falling >= streak) {
        return {
          action: 'buy',
          side: 'up',
          size: positionSize,
          reason: buildBinaryPatternReason(context.market.asset, 'up', binaryProfile.mode, 'falling', falling, currentUpPrice),
          tags: ['btc-eth-5m', 'entry', 'up', 'binary-fade'],
        };
      }

      return {
        action: 'hold',
        reason: 'binary market history does not show a strong enough pattern yet',
        tags: ['btc-eth-5m', 'idle'],
      };
    }

    if (candles.length < params.lookbackCandles) {
      return {
        action: 'hold',
        reason: 'not enough candles to evaluate the setup',
      };
    }

    const score = scoreWindow(
      candles,
      context.market.price,
      params.minTrendChangePct,
      params.liveMovePct,
    );
    const positionSize = Number((context.balance * params.allocation).toFixed(2));

    if (score >= params.entryScore) {
      return {
        action: 'buy',
        side: 'up',
        size: positionSize,
        reason: buildReason(context.market.asset, score, 'up'),
        tags: ['btc-eth-5m', 'entry', 'up'],
      };
    }

    if (score <= -params.entryScore) {
      return {
        action: 'buy',
        side: 'down',
        size: positionSize,
        reason: buildReason(context.market.asset, score, 'down'),
        tags: ['btc-eth-5m', 'entry', 'down'],
      };
    }

    return {
      action: 'hold',
      reason: `recent candles scored ${score}, which is not strong enough to trade`,
      tags: ['btc-eth-5m', 'idle'],
    };
  },
};

export default strategy;
