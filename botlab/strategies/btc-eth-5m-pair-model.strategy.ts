import type {
  BotlabCandle,
  BotlabRelatedMarketRuntime,
  BotlabStrategyDefinition,
} from '../core/types.js';

interface BtcEth5mPairModelParams extends Record<string, unknown> {
  lookbackCandles: number;
  minimumVolume: number;
  signalMinPrice: number;
  signalMaxPrice: number;
  buyUpGap: number;
  buyDownGap: number;
  maxStake: number;
}

function averageClose(candles: BotlabCandle[]): number {
  if (candles.length === 0) {
    return 0;
  }

  const total = candles.reduce((sum, candle) => sum + candle.close, 0);
  return total / candles.length;
}

function isBinaryMarketContext(candles: BotlabCandle[], currentPrice: number): boolean {
  return currentPrice > 0
    && currentPrice < 1
    && candles.every((candle) => (
      candle.open >= 0
      && candle.open <= 1
      && candle.close >= 0
      && candle.close <= 1
    ));
}

function findRelatedMarket(
  asset: string,
  timeframe: string,
  relatedMarkets: BotlabRelatedMarketRuntime[] | undefined,
): BotlabRelatedMarketRuntime | undefined {
  return relatedMarkets?.find((market) => (
    market.asset !== asset
    && ['BTC', 'ETH'].includes(market.asset)
    && market.timeframe === timeframe
  ));
}

function buildReason(
  side: 'up' | 'down',
  relativeGap: number,
  ownEdge: number,
  peerEdge: number,
): string {
  return `ETH pair-model bought ${side} from the calibrated mid zone with gap ${relativeGap.toFixed(3)} (self ${ownEdge.toFixed(3)} vs peer ${peerEdge.toFixed(3)})`;
}

export const strategy: BotlabStrategyDefinition<BtcEth5mPairModelParams> = {
  id: 'btc-eth-5m-pair-model',
  name: 'BTC / ETH 5m Pair Model',
  description: 'Uses BTC as the reference market and only trades ETH inside the mid-price state blocks that stayed profitable in both the earlier and later replay windows.',
  defaults: {
    lookbackCandles: 5,
    minimumVolume: 1000,
    signalMinPrice: 0.35,
    signalMaxPrice: 0.45,
    buyUpGap: 0.5,
    buyDownGap: -0.3,
    maxStake: 25,
  },
  evaluate(context, params) {
    if (context.market.asset !== 'ETH' || context.market.timeframe !== '5m') {
      return {
        action: 'hold',
        reason: 'strategy only opens ETH 5m trades and uses BTC as the reference market',
        tags: ['btc-eth-5m-pair-model', 'idle'],
      };
    }

    if (context.position.side !== 'flat') {
      return {
        action: 'hold',
        reason: 'strategy only opens new positions from a flat state',
        tags: ['btc-eth-5m-pair-model', 'idle'],
      };
    }

    const relatedMarket = findRelatedMarket(context.market.asset, context.market.timeframe, context.relatedMarkets);
    if (!relatedMarket || relatedMarket.asset !== 'BTC') {
      return {
        action: 'hold',
        reason: 'need BTC 5m context before evaluating the ETH pair model',
        tags: ['btc-eth-5m-pair-model', 'idle'],
      };
    }

    if (
      context.market.volume < params.minimumVolume
      || relatedMarket.volume < params.minimumVolume
      || !isBinaryMarketContext(context.market.candles, context.market.price)
      || !isBinaryMarketContext(relatedMarket.candles, relatedMarket.price)
    ) {
      return {
        action: 'hold',
        reason: 'ETH or BTC context is too thin for the pair model',
        tags: ['btc-eth-5m-pair-model', 'idle'],
      };
    }

    const ownHistory = context.market.candles.slice(-params.lookbackCandles);
    const peerHistory = relatedMarket.candles.slice(-params.lookbackCandles);
    if (ownHistory.length < params.lookbackCandles || peerHistory.length < params.lookbackCandles) {
      return {
        action: 'hold',
        reason: `need ${params.lookbackCandles} prior closes in both ETH and BTC`,
        tags: ['btc-eth-5m-pair-model', 'idle'],
      };
    }

    const ownBaseline = averageClose(ownHistory);
    const peerBaseline = averageClose(peerHistory);
    const ownEdge = context.market.price - ownBaseline;
    const peerEdge = relatedMarket.price - peerBaseline;
    const relativeGap = ownEdge - peerEdge;
    const stake = Number(Math.min(context.balance, params.maxStake).toFixed(2));

    if (stake <= 0) {
      return {
        action: 'hold',
        reason: 'balance is too small for a meaningful pair-model trade',
        tags: ['btc-eth-5m-pair-model', 'idle'],
      };
    }

    const inSignalZone = context.market.price >= params.signalMinPrice
      && context.market.price <= params.signalMaxPrice;

    if (inSignalZone && relativeGap >= params.buyUpGap) {
      return {
        action: 'buy',
        side: 'up',
        size: stake,
        reason: buildReason('up', relativeGap, ownEdge, peerEdge),
        tags: ['btc-eth-5m-pair-model', 'entry', 'up', 'mid-zone-rich'],
      };
    }

    if (inSignalZone && relativeGap <= params.buyDownGap) {
      return {
        action: 'buy',
        side: 'down',
        size: stake,
        reason: buildReason('down', relativeGap, ownEdge, peerEdge),
        tags: ['btc-eth-5m-pair-model', 'entry', 'down', 'mid-zone-cheap'],
      };
    }

    return {
      action: 'hold',
      reason: `ETH pair-model found gap ${relativeGap.toFixed(3)}, but not inside the calibrated mid zone`,
      tags: ['btc-eth-5m-pair-model', 'idle'],
    };
  },
};

export default strategy;
