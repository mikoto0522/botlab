import type {
  BotlabCandle,
  BotlabRelatedMarketRuntime,
  BotlabStrategyContext,
  BotlabStrategyDecision,
  BotlabStrategyDefinition,
} from '../core/types.js';

interface PolybotPortedV2Params extends Record<string, unknown> {
  lookbackCandles: number;
  minimumVolume: number;
  earlyContinuationAlignmentMin: number;
  earlyContinuationMoveMin: number;
  confirmedContinuationAlignmentMin: number;
  confirmedContinuationMoveMin: number;
  reversionStretchMin: number;
  relativeGapMin: number;
  minEntryPrice: number;
  earlyEntryPriceCap: number;
  maxEntryPrice: number;
  earlySignalScore: number;
  confirmedSignalScore: number;
  earlyStarterStake: number;
  lowConfidenceStake: number;
  mediumConfidenceStake: number;
  highConfidenceStake: number;
}

type PredictionSide = 'up' | 'down';
type SignalFamily = 'continuation' | 'reversion' | 'relative-value';
type EntryTier = 'early' | 'confirmed';

interface MarketSummary {
  asset: 'BTC' | 'ETH';
  price: number;
  quotedUp: number;
  quotedDown: number;
  averageClose: number;
  averageMove: number;
  netMove: number;
  lastMove: number;
  previousMove: number;
  acceleration: number;
  alignment: number;
  stretch: number;
  volume: number;
}

interface SignalCandidate {
  side: PredictionSide;
  family: SignalFamily;
  tier: EntryTier;
  score: number;
  reason: string;
  tags: string[];
}

type MarketLike = Pick<
  BotlabStrategyContext['market'],
  'asset' | 'price' | 'upPrice' | 'downPrice' | 'upAsk' | 'downAsk' | 'volume' | 'candles'
> | Pick<
  BotlabRelatedMarketRuntime,
  'asset' | 'price' | 'upPrice' | 'downPrice' | 'upAsk' | 'downAsk' | 'volume' | 'candles'
>;

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function moves(candles: BotlabCandle[]): number[] {
  const values: number[] = [];

  for (let index = 1; index < candles.length; index += 1) {
    values.push(candles[index]!.close - candles[index - 1]!.close);
  }

  return values;
}

function averageAbsoluteMove(values: number[]): number {
  if (values.length === 0) {
    return 0.01;
  }

  return Math.max(average(values.map((value) => Math.abs(value))), 0.01);
}

function directionalAlignment(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  let positive = 0;
  let negative = 0;

  for (const value of values) {
    if (value > 0) {
      positive += 1;
    } else if (value < 0) {
      negative += 1;
    }
  }

  const totalDirectional = positive + negative;
  if (totalDirectional === 0) {
    return 0;
  }

  return Math.max(positive, negative) / totalDirectional;
}

function quotedEntryPrice(market: MarketLike, side: PredictionSide): number {
  if (side === 'up') {
    return market.upAsk ?? market.upPrice ?? market.price;
  }

  return market.downAsk ?? market.downPrice ?? (1 - market.price);
}

function summarizeMarket(
  market: MarketLike,
  minimumVolume: number,
  lookbackCandles: number,
): MarketSummary | undefined {
  if ((market.asset !== 'BTC' && market.asset !== 'ETH') || market.candles.length < lookbackCandles) {
    return undefined;
  }

  const candles = market.candles.slice(-lookbackCandles);
  const recentMoves = moves(candles);
  const currentVolume = candles.at(-1)?.volume ?? market.volume ?? 0;

  if (currentVolume < minimumVolume) {
    return undefined;
  }

  const averageClose = average(candles.map((candle) => candle.close));
  const averageMove = averageAbsoluteMove(recentMoves);
  const lastMove = recentMoves.at(-1) ?? 0;
  const previousMove = recentMoves.at(-2) ?? 0;

  return {
    asset: market.asset,
    price: market.price,
    quotedUp: quotedEntryPrice(market, 'up'),
    quotedDown: quotedEntryPrice(market, 'down'),
    averageClose,
    averageMove,
    netMove: (candles.at(-1)?.close ?? market.price) - (candles[0]?.close ?? market.price),
    lastMove,
    previousMove,
    acceleration: lastMove - previousMove,
    alignment: directionalAlignment(recentMoves),
    stretch: (market.price - averageClose) / averageMove,
    volume: currentVolume,
  };
}

function continuationCandidates(
  summary: MarketSummary,
  params: PolybotPortedV2Params,
): SignalCandidate[] {
  const direction = Math.sign(summary.netMove);
  if (direction === 0) {
    return [];
  }

  if (Math.sign(summary.lastMove) !== direction && Math.abs(summary.lastMove) > summary.averageMove * 0.4) {
    return [];
  }

  const candidates: SignalCandidate[] = [];
  const side = direction > 0 ? 'up' : 'down';
  const volumeRatio = Math.min(summary.volume / params.minimumVolume, 2.5);
  const accelerationBonus = Math.sign(summary.acceleration) === direction ? 0.15 : 0;

  if (
    summary.alignment >= params.earlyContinuationAlignmentMin
    && Math.abs(summary.netMove) >= params.earlyContinuationMoveMin
    && Math.sign(summary.lastMove) === direction
  ) {
    const score = 0.85
      + summary.alignment * 1.1
      + Math.abs(summary.netMove) * 3.2
      + volumeRatio * 0.2
      + accelerationBonus;

    candidates.push({
      side,
      family: 'continuation',
      tier: 'early',
      score: Number(score.toFixed(3)),
      reason: `${summary.asset} started carrying early enough for a smaller starter entry before the move gets crowded`,
      tags: ['polybot-ported-v2', 'continuation', 'early-entry'],
    });
  }

  if (
    summary.alignment >= params.confirmedContinuationAlignmentMin
    && Math.abs(summary.netMove) >= params.confirmedContinuationMoveMin
  ) {
    const score = 1.1
      + summary.alignment * 1.35
      + Math.abs(summary.netMove) * 4
      + volumeRatio * 0.25
      + Math.max(accelerationBonus, 0);

    candidates.push({
      side,
      family: 'continuation',
      tier: 'confirmed',
      score: Number(score.toFixed(3)),
      reason: `${summary.asset} kept carrying in one direction with enough short-term strength`,
      tags: ['polybot-ported-v2', 'continuation', 'confirmed-entry'],
    });
  }

  return candidates;
}

function reversionCandidate(
  summary: MarketSummary,
  params: PolybotPortedV2Params,
): SignalCandidate | undefined {
  const stretchDirection = Math.sign(summary.stretch);
  if (stretchDirection === 0 || Math.abs(summary.stretch) < params.reversionStretchMin) {
    return undefined;
  }

  if (Math.sign(summary.lastMove) !== -stretchDirection || Math.abs(summary.lastMove) < summary.averageMove * 0.45) {
    return undefined;
  }

  const score = 1.0
    + Math.min(Math.abs(summary.stretch), 3) * 0.55
    + Math.min(Math.abs(summary.lastMove) / summary.averageMove, 2.5) * 0.35;

  return {
    side: stretchDirection > 0 ? 'down' : 'up',
    family: 'reversion',
    tier: 'confirmed',
    score: Number(score.toFixed(3)),
    reason: `${summary.asset} had stretched too far and the latest move started snapping back`,
    tags: ['polybot-ported-v2', 'reversion', 'confirmed-entry'],
  };
}

function relativeValueCandidate(
  summary: MarketSummary,
  peer: MarketSummary,
  params: PolybotPortedV2Params,
): SignalCandidate | undefined {
  const gap = summary.stretch - peer.stretch;
  if (Math.abs(gap) < params.relativeGapMin || Math.sign(summary.lastMove) !== Math.sign(gap)) {
    return undefined;
  }

  const score = 0.9 + Math.min(Math.abs(gap), 3) * 0.4;

  return {
    side: gap > 0 ? 'up' : 'down',
    family: 'relative-value',
    tier: 'confirmed',
    score: Number(score.toFixed(3)),
    reason: `${summary.asset} diverged enough from ${peer.asset} to justify a relative-value follow-through trade`,
    tags: ['polybot-ported-v2', 'relative-value', 'confirmed-entry'],
  };
}

function chooseConfirmedStake(
  score: number,
  balance: number,
  params: PolybotPortedV2Params,
): number {
  const requested = score >= 3.4
    ? params.highConfidenceStake
    : score >= 2.5
      ? params.mediumConfidenceStake
      : params.lowConfidenceStake;

  return Number(Math.min(balance, requested).toFixed(2));
}

function evaluatePortedStrategyV2(
  context: BotlabStrategyContext,
  params: PolybotPortedV2Params,
): BotlabStrategyDecision {
  if ((context.market.asset !== 'BTC' && context.market.asset !== 'ETH') || context.market.timeframe !== '5m') {
    return {
      action: 'hold',
      reason: 'strategy only trades BTC and ETH 5m markets',
      tags: ['polybot-ported-v2', 'idle'],
    };
  }

  if (context.position.side !== 'flat') {
    return {
      action: 'hold',
      reason: 'strategy only opens from a flat state',
      tags: ['polybot-ported-v2', 'idle'],
    };
  }

  const summary = summarizeMarket(context.market, params.minimumVolume, params.lookbackCandles);
  if (!summary) {
    return {
      action: 'hold',
      reason: 'market context is too thin or too short',
      tags: ['polybot-ported-v2', 'idle'],
    };
  }

  const candidates: SignalCandidate[] = [
    ...continuationCandidates(summary, params),
  ];
  const reversion = reversionCandidate(summary, params);
  if (reversion) {
    candidates.push(reversion);
  }

  const peerMarket = context.relatedMarkets?.find((market) => (
    market.asset !== context.market.asset && market.timeframe === '5m'
  ));
  if (peerMarket) {
    const peerSummary = summarizeMarket(peerMarket, params.minimumVolume, params.lookbackCandles);
    if (peerSummary) {
      const relative = relativeValueCandidate(summary, peerSummary, params);
      if (relative) {
        candidates.push(relative);
      }
    }
  }

  if (candidates.length === 0) {
    return {
      action: 'hold',
      reason: 'no direction had enough strength to justify a trade',
      tags: ['polybot-ported-v2', 'idle'],
    };
  }

  const best = [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (left.tier === right.tier) {
      return 0;
    }

    return left.tier === 'confirmed' ? -1 : 1;
  })[0]!;
  const entryPrice = best.side === 'up' ? summary.quotedUp : summary.quotedDown;

  if (entryPrice < params.minEntryPrice || entryPrice > params.maxEntryPrice) {
    return {
      action: 'hold',
      reason: 'setup looked real, but the quoted entry price was not worth taking',
      tags: ['polybot-ported-v2', 'idle', 'price-filter'],
    };
  }

  if (best.tier === 'early') {
    if (entryPrice > params.earlyEntryPriceCap) {
      return {
        action: 'hold',
        reason: 'the trend started early enough, but the quoted entry had already run too far for a starter trade',
        tags: ['polybot-ported-v2', 'idle', 'price-filter'],
      };
    }

    if (best.score < params.earlySignalScore) {
      return {
        action: 'hold',
        reason: 'the move started to lean one way, but not enough for an earlier starter entry',
        tags: ['polybot-ported-v2', 'idle', 'weak'],
      };
    }

    const size = Number(Math.min(context.balance, params.earlyStarterStake).toFixed(2));
    if (size <= 0) {
      return {
        action: 'hold',
        reason: 'balance is too small for a meaningful trade',
        tags: ['polybot-ported-v2', 'idle'],
      };
    }

    return {
      action: 'buy',
      side: best.side,
      size,
      reason: best.reason,
      tags: [...best.tags, best.side, 'entry'],
    };
  }

  if (best.score < params.confirmedSignalScore) {
    return {
      action: 'hold',
      reason: 'direction was there, but the move strength was still too weak',
      tags: ['polybot-ported-v2', 'idle', 'weak'],
    };
  }

  const size = chooseConfirmedStake(best.score, context.balance, params);
  if (size <= 0) {
    return {
      action: 'hold',
      reason: 'balance is too small for a meaningful trade',
      tags: ['polybot-ported-v2', 'idle'],
    };
  }

  return {
    action: 'buy',
    side: best.side,
    size,
    reason: best.reason,
    tags: [...best.tags, best.side, 'entry'],
  };
}

export const strategy: BotlabStrategyDefinition<PolybotPortedV2Params> = {
  id: 'polybot-ported-v2',
  name: 'Polybot Ported V2',
  description: 'Rebuilds the polybot port around earlier starter entries, then scales into the stronger confirmation path only when the move keeps improving.',
  defaults: {
    lookbackCandles: 6,
    minimumVolume: 850,
    earlyContinuationAlignmentMin: 0.6,
    earlyContinuationMoveMin: 0.05,
    confirmedContinuationAlignmentMin: 0.75,
    confirmedContinuationMoveMin: 0.1,
    reversionStretchMin: 1.15,
    relativeGapMin: 0.9,
    minEntryPrice: 0.08,
    earlyEntryPriceCap: 0.62,
    maxEntryPrice: 0.76,
    earlySignalScore: 1.45,
    confirmedSignalScore: 1.9,
    earlyStarterStake: 6,
    lowConfidenceStake: 8,
    mediumConfidenceStake: 12,
    highConfidenceStake: 16,
  },
  evaluate: evaluatePortedStrategyV2,
};

export default strategy;
