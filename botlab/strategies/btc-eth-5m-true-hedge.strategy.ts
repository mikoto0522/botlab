import type {
  BotlabHedgeContext,
  BotlabRelatedMarketRuntime,
  BotlabStrategyDefinition,
} from '../core/types.js';

interface BtcEthTrueHedgeParams extends Record<string, unknown> {
  lookbackCandles: number;
  minimumVolume: number;
  minBinaryPrice: number;
  maxBinaryPrice: number;
  gapMin: number;
  revertGap: number;
  leaderAlignMin: number;
  followerAlignMin: number;
  revertKick: number;
  maxStakePerLeg: number;
}

type HedgeState = 'trend' | 'revert' | 'noise';

function averageClose(candles: BotlabRelatedMarketRuntime['candles']): number {
  if (candles.length === 0) {
    return 0;
  }

  return candles.reduce((sum, candle) => sum + candle.close, 0) / candles.length;
}

function averageAbsoluteMove(candles: BotlabRelatedMarketRuntime['candles']): number {
  if (candles.length < 2) {
    return 0;
  }

  let totalMove = 0;

  for (let index = 1; index < candles.length; index += 1) {
    totalMove += Math.abs(candles[index]!.close - candles[index - 1]!.close);
  }

  return totalMove / (candles.length - 1);
}

function directionAlignment(candles: BotlabRelatedMarketRuntime['candles']): number {
  if (candles.length < 2) {
    return 0;
  }

  let risingCount = 0;
  let fallingCount = 0;

  for (let index = 1; index < candles.length; index += 1) {
    const diff = candles[index]!.close - candles[index - 1]!.close;

    if (diff > 0) {
      risingCount += 1;
    } else if (diff < 0) {
      fallingCount += 1;
    }
  }

  const totalCount = risingCount + fallingCount;
  if (totalCount === 0) {
    return 0;
  }

  return Math.max(risingCount, fallingCount) / totalCount;
}

function lastMove(candles: BotlabRelatedMarketRuntime['candles']): number {
  if (candles.length < 2) {
    return 0;
  }

  return candles.at(-1)!.close - candles.at(-2)!.close;
}

function sign(value: number): -1 | 0 | 1 {
  if (value > 0) {
    return 1;
  }

  if (value < 0) {
    return -1;
  }

  return 0;
}

function findMarket(context: BotlabHedgeContext, asset: string): BotlabRelatedMarketRuntime | undefined {
  return context.markets.find((market) => market.asset === asset && market.timeframe === '5m');
}

function calculateNormalizedEdge(
  market: BotlabRelatedMarketRuntime,
  candles: BotlabRelatedMarketRuntime['candles'],
): number {
  const baseline = averageClose(candles);
  const move = Math.max(averageAbsoluteMove(candles), 0.01);

  return (market.price - baseline) / move;
}

function classifyState(
  btc: BotlabRelatedMarketRuntime,
  eth: BotlabRelatedMarketRuntime,
  params: BtcEthTrueHedgeParams,
): {
  state: HedgeState;
  gap: number;
  leaderAsset: 'BTC' | 'ETH';
} {
  const btcHistory = btc.candles.slice(-params.lookbackCandles);
  const ethHistory = eth.candles.slice(-params.lookbackCandles);
  const btcEdge = calculateNormalizedEdge(btc, btcHistory);
  const ethEdge = calculateNormalizedEdge(eth, ethHistory);
  const gap = btcEdge - ethEdge;
  const leaderAsset = gap >= 0 ? 'BTC' : 'ETH';
  const leaderMarket = leaderAsset === 'BTC' ? btc : eth;
  const followerMarket = leaderAsset === 'BTC' ? eth : btc;
  const leaderHistory = leaderAsset === 'BTC' ? btcHistory : ethHistory;
  const followerHistory = leaderAsset === 'BTC' ? ethHistory : btcHistory;
  const leaderSign = sign(leaderAsset === 'BTC' ? btcEdge : ethEdge);
  const leaderAlign = directionAlignment(leaderHistory);
  const followerAlign = directionAlignment(followerHistory);
  const leaderLastMove = lastMove(leaderHistory);
  const maxPrice = Math.max(btc.price, eth.price);
  const minPrice = Math.min(btc.price, eth.price);

  if (
    btc.volume < params.minimumVolume
    || eth.volume < params.minimumVolume
    || btcHistory.length < params.lookbackCandles
    || ethHistory.length < params.lookbackCandles
    || maxPrice > params.maxBinaryPrice
    || minPrice < params.minBinaryPrice
    || Math.abs(gap) < params.gapMin
    || leaderAlign < params.leaderAlignMin
    || followerAlign < params.followerAlignMin
    || leaderSign === 0
  ) {
    return {
      state: 'noise',
      gap,
      leaderAsset,
    };
  }

  if (sign(leaderLastMove) === leaderSign) {
    return {
      state: 'trend',
      gap,
      leaderAsset,
    };
  }

  if (Math.abs(gap) >= params.revertGap && sign(leaderLastMove) === -leaderSign && Math.abs(leaderLastMove) >= params.revertKick) {
    return {
      state: 'revert',
      gap,
      leaderAsset,
    };
  }

  return {
    state: 'noise',
    gap,
    leaderAsset,
  };
}

export const strategy: BotlabStrategyDefinition<BtcEthTrueHedgeParams> = {
  id: 'btc-eth-5m-true-hedge',
  name: 'BTC / ETH 5m True Hedge',
  description: 'Splits the BTC/ETH pair into trend, reversion, and noise states, then only opens the paired trade when the state is clean enough to trust.',
  defaults: {
    lookbackCandles: 8,
    minimumVolume: 1000,
    minBinaryPrice: 0.1,
    maxBinaryPrice: 0.82,
    gapMin: 1,
    revertGap: 1.5,
    leaderAlignMin: 0.5,
    followerAlignMin: 0.57,
    revertKick: 0.1,
    maxStakePerLeg: 35,
  },
  evaluate() {
    return {
      action: 'hold',
      reason: 'single-market mode is not used for the true hedge strategy',
      tags: ['btc-eth-5m-true-hedge', 'idle'],
    };
  },
  evaluateHedge(context, params) {
    const btc = findMarket(context, 'BTC');
    const eth = findMarket(context, 'ETH');

    if (!btc || !eth) {
      return {
        action: 'hold',
        reason: 'need both BTC and ETH 5m markets for the paired hedge',
        tags: ['btc-eth-5m-true-hedge', 'idle'],
      };
    }

    const { state, gap, leaderAsset } = classifyState(btc, eth, params);
    const stake = Number(Math.min(context.balance / 2, params.maxStakePerLeg).toFixed(2));

    if (stake <= 0) {
      return {
        action: 'hold',
        reason: 'balance is too small for a paired hedge entry',
        tags: ['btc-eth-5m-true-hedge', 'idle'],
      };
    }

    if (state === 'trend') {
      return {
        action: 'hedge',
        reason: `${leaderAsset} is leading cleanly with gap ${gap.toFixed(2)}, so the hedge follows the leader and fades the laggard`,
        legs: leaderAsset === 'BTC'
          ? [
            { asset: 'BTC', side: 'up', size: stake },
            { asset: 'ETH', side: 'down', size: stake },
          ]
          : [
            { asset: 'BTC', side: 'down', size: stake },
            { asset: 'ETH', side: 'up', size: stake },
          ],
        tags: ['btc-eth-5m-true-hedge', 'trend'],
      };
    }

    if (state === 'revert') {
      return {
        action: 'hedge',
        reason: `${leaderAsset} is stretched but slowing with gap ${gap.toFixed(2)}, so the hedge fades the leader and backs the laggard`,
        legs: leaderAsset === 'BTC'
          ? [
            { asset: 'BTC', side: 'down', size: stake },
            { asset: 'ETH', side: 'up', size: stake },
          ]
          : [
            { asset: 'BTC', side: 'up', size: stake },
            { asset: 'ETH', side: 'down', size: stake },
          ],
        tags: ['btc-eth-5m-true-hedge', 'revert'],
      };
    }

    return {
      action: 'hold',
      reason: `BTC/ETH pair looks noisy at gap ${gap.toFixed(2)}, so the hedge stands aside`,
      tags: ['btc-eth-5m-true-hedge', 'noise'],
    };
  },
};

export default strategy;
