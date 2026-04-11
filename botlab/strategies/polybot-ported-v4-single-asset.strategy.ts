import type {
  BotlabCandle,
  BotlabStrategyContext,
  BotlabStrategyDecision,
  BotlabStrategyDefinition,
} from '../core/types.js';

interface PolybotPortedV4SingleAssetParams extends Record<string, unknown> {
  lookbackCandles: number;
  minimumVolume: number;
  earlyContinuationAlignmentMin: number;
  earlyContinuationMoveMin: number;
  preferredWindowContinuationAlignmentMin: number;
  preferredWindowContinuationMoveMin: number;
  confirmedContinuationAlignmentMin: number;
  confirmedContinuationMoveMin: number;
  reversionStretchMin: number;
  minEntryPrice: number;
  earlyEntryPriceCap: number;
  preferredWindowEntryPriceCap: number;
  maxEntryPrice: number;
  earlySignalScore: number;
  preferredWindowSignalScore: number;
  confirmedSignalScore: number;
  preferredWindowScoreBonus: number;
  lateWindowScorePenalty: number;
  veryLateWindowScorePenalty: number;
  preferredWindowMinSecondsRemaining: number;
  preferredWindowMaxSecondsRemaining: number;
  lateEntryGuardSeconds: number;
  veryLateEntryGuardSeconds: number;
  veryLateConfirmedScoreBump: number;
  earlyStarterStake: number;
  lowConfidenceStake: number;
  mediumConfidenceStake: number;
  highConfidenceStake: number;
}

type PredictionSide = 'up' | 'down';
type SignalFamily = 'continuation' | 'reversion';
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

interface EntryTimingProfile {
  secondsRemaining: number | null;
  inPreferredWindow: boolean;
  lateWindow: boolean;
  veryLateWindow: boolean;
}

type MarketLike = Pick<
  BotlabStrategyContext['market'],
  'asset' | 'price' | 'upPrice' | 'downPrice' | 'upAsk' | 'downAsk' | 'volume' | 'candles'
>;

const FIVE_MINUTES_MS = 5 * 60 * 1000;

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

function resolveEntryTiming(
  context: BotlabStrategyContext,
  params: PolybotPortedV4SingleAssetParams,
): EntryTimingProfile {
  const bucketStartMs = Date.parse(context.market.timestamp);
  const nowMs = Date.parse(context.clock.now);
  if (!Number.isFinite(bucketStartMs) || !Number.isFinite(nowMs)) {
    return {
      secondsRemaining: null,
      inPreferredWindow: false,
      lateWindow: false,
      veryLateWindow: false,
    };
  }

  const secondsRemaining = Math.max(0, (bucketStartMs + FIVE_MINUTES_MS - nowMs) / 1000);

  return {
    secondsRemaining,
    inPreferredWindow: (
      secondsRemaining >= params.preferredWindowMinSecondsRemaining
      && secondsRemaining <= params.preferredWindowMaxSecondsRemaining
    ),
    lateWindow: secondsRemaining < params.lateEntryGuardSeconds,
    veryLateWindow: secondsRemaining < params.veryLateEntryGuardSeconds,
  };
}

function timingScoreAdjustment(
  timing: EntryTimingProfile,
  params: PolybotPortedV4SingleAssetParams,
): number {
  if (timing.inPreferredWindow) {
    return params.preferredWindowScoreBonus;
  }

  if (timing.veryLateWindow) {
    return -(params.lateWindowScorePenalty + params.veryLateWindowScorePenalty);
  }

  if (timing.lateWindow) {
    return -params.lateWindowScorePenalty;
  }

  return 0;
}

function continuationCandidates(
  summary: MarketSummary,
  params: PolybotPortedV4SingleAssetParams,
  timing: EntryTimingProfile,
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
  const timingAdjustment = timingScoreAdjustment(timing, params);
  const earlyAlignmentFloor = timing.inPreferredWindow
    ? params.preferredWindowContinuationAlignmentMin
    : params.earlyContinuationAlignmentMin;
  const earlyMoveFloor = timing.inPreferredWindow
    ? params.preferredWindowContinuationMoveMin
    : params.earlyContinuationMoveMin;

  if (
    summary.alignment >= earlyAlignmentFloor
    && Math.abs(summary.netMove) >= earlyMoveFloor
    && Math.sign(summary.lastMove) === direction
  ) {
    const score = 0.85
      + summary.alignment * 1.1
      + Math.abs(summary.netMove) * 3.2
      + volumeRatio * 0.2
      + accelerationBonus
      + timingAdjustment;

    candidates.push({
      side,
      family: 'continuation',
      tier: 'early',
      score: Number(score.toFixed(3)),
      reason: timing.inPreferredWindow
        ? `${summary.asset} leaned one way inside the preferred 90-to-120 second entry window, so the strategy can start with a smaller position`
        : `${summary.asset} started carrying early enough, and the move was already strong enough for a smaller starter entry before the preferred window`,
      tags: [
        'polybot-ported-v4-single-asset',
        'continuation',
        'early-entry',
        ...(timing.inPreferredWindow ? ['preferred-window'] : ['pre-window']),
      ],
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
      + Math.max(accelerationBonus, 0)
      + timingAdjustment;

    candidates.push({
      side,
      family: 'continuation',
      tier: 'confirmed',
      score: Number(score.toFixed(3)),
      reason: `${summary.asset} kept carrying in one direction with enough short-term strength`,
      tags: [
        'polybot-ported-v4-single-asset',
        'continuation',
        'confirmed-entry',
        ...(timing.inPreferredWindow ? ['preferred-window'] : []),
      ],
    });
  }

  return candidates;
}

function reversionCandidate(
  summary: MarketSummary,
  params: PolybotPortedV4SingleAssetParams,
  timing: EntryTimingProfile,
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
    + Math.min(Math.abs(summary.lastMove) / summary.averageMove, 2.5) * 0.35
    + timingScoreAdjustment(timing, params);

  return {
    side: stretchDirection > 0 ? 'down' : 'up',
    family: 'reversion',
    tier: 'confirmed',
    score: Number(score.toFixed(3)),
    reason: `${summary.asset} had stretched too far and the latest move started snapping back`,
    tags: ['polybot-ported-v4-single-asset', 'reversion', 'confirmed-entry'],
  };
}

function chooseConfirmedStake(
  score: number,
  balance: number,
  params: PolybotPortedV4SingleAssetParams,
): number {
  const requested = score >= 3.4
    ? params.highConfidenceStake
    : score >= 2.5
      ? params.mediumConfidenceStake
      : params.lowConfidenceStake;

  return Number(Math.min(balance, requested).toFixed(2));
}

function evaluatePortedStrategyV4SingleAsset(
  context: BotlabStrategyContext,
  params: PolybotPortedV4SingleAssetParams,
): BotlabStrategyDecision {
  if ((context.market.asset !== 'BTC' && context.market.asset !== 'ETH') || context.market.timeframe !== '5m') {
    return {
      action: 'hold',
      reason: 'strategy only trades BTC and ETH 5m markets',
      tags: ['polybot-ported-v4-single-asset', 'idle'],
    };
  }

  if (context.position.side !== 'flat') {
    return {
      action: 'hold',
      reason: 'strategy only opens from a flat state',
      tags: ['polybot-ported-v4-single-asset', 'idle'],
    };
  }

  const summary = summarizeMarket(context.market, params.minimumVolume, params.lookbackCandles);
  if (!summary) {
    return {
      action: 'hold',
      reason: 'market context is too thin or too short',
      tags: ['polybot-ported-v4-single-asset', 'idle'],
    };
  }

  const timing = resolveEntryTiming(context, params);
  const candidates: SignalCandidate[] = [
    ...continuationCandidates(summary, params, timing),
  ];
  const reversion = reversionCandidate(summary, params, timing);
  if (reversion) {
    candidates.push(reversion);
  }

  if (candidates.length === 0) {
    return {
      action: 'hold',
      reason: 'no direction had enough strength to justify a trade',
      tags: ['polybot-ported-v4-single-asset', 'idle'],
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
      tags: ['polybot-ported-v4-single-asset', 'idle', 'price-filter'],
    };
  }

  if (best.tier === 'early') {
    if (timing.lateWindow) {
      return {
        action: 'hold',
        reason: 'the starter setup only became actionable in the final minute, so the strategy skipped the late chase',
        tags: ['polybot-ported-v4-single-asset', 'idle', 'late-window'],
      };
    }

    const earlyEntryPriceCap = timing.inPreferredWindow
      ? params.preferredWindowEntryPriceCap
      : params.earlyEntryPriceCap;
    if (entryPrice > earlyEntryPriceCap) {
      return {
        action: 'hold',
        reason: 'the trend started early enough, but the quoted entry had already run too far for a starter trade',
        tags: ['polybot-ported-v4-single-asset', 'idle', 'price-filter'],
      };
    }

    const earlyScoreFloor = timing.inPreferredWindow
      ? params.preferredWindowSignalScore
      : params.earlySignalScore;
    if (best.score < earlyScoreFloor) {
      return {
        action: 'hold',
        reason: timing.inPreferredWindow
          ? 'the preferred entry window was open, but the move was still not convincing enough for a starter trade'
          : 'the move started to lean one way, but not enough for an earlier starter entry',
        tags: ['polybot-ported-v4-single-asset', 'idle', 'weak'],
      };
    }

    const size = Number(Math.min(context.balance, params.earlyStarterStake).toFixed(2));
    if (size <= 0) {
      return {
        action: 'hold',
        reason: 'balance is too small for a meaningful trade',
        tags: ['polybot-ported-v4-single-asset', 'idle'],
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

  const confirmedScoreFloor = params.confirmedSignalScore + (
    timing.veryLateWindow ? params.veryLateConfirmedScoreBump : 0
  );
  if (best.score < confirmedScoreFloor) {
    return {
      action: 'hold',
      reason: timing.veryLateWindow
        ? 'the move looked real, but it was too late in the round to chase without stronger confirmation'
        : 'direction was there, but the move strength was still too weak',
      tags: ['polybot-ported-v4-single-asset', 'idle', 'weak'],
    };
  }

  const size = chooseConfirmedStake(best.score, context.balance, params);
  if (size <= 0) {
    return {
      action: 'hold',
      reason: 'balance is too small for a meaningful trade',
      tags: ['polybot-ported-v4-single-asset', 'idle'],
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

export const strategy: BotlabStrategyDefinition<PolybotPortedV4SingleAssetParams> = {
  id: 'polybot-ported-v4-single-asset',
  name: 'Polybot Ported V4 Single Asset',
  description: 'A single-asset polybot variant for realtime live trading that prefers the 90-to-120 second window, still allows earlier starter entries when the move is strong enough, and avoids weak late chases.',
  defaults: {
    lookbackCandles: 6,
    minimumVolume: 750,
    earlyContinuationAlignmentMin: 0.55,
    earlyContinuationMoveMin: 0.03,
    preferredWindowContinuationAlignmentMin: 0.5,
    preferredWindowContinuationMoveMin: 0.02,
    confirmedContinuationAlignmentMin: 0.75,
    confirmedContinuationMoveMin: 0.1,
    reversionStretchMin: 1.15,
    minEntryPrice: 0.08,
    earlyEntryPriceCap: 0.66,
    preferredWindowEntryPriceCap: 0.7,
    maxEntryPrice: 0.76,
    earlySignalScore: 1.35,
    preferredWindowSignalScore: 1.2,
    confirmedSignalScore: 1.9,
    preferredWindowScoreBonus: 0.3,
    lateWindowScorePenalty: 0.15,
    veryLateWindowScorePenalty: 0.35,
    preferredWindowMinSecondsRemaining: 90,
    preferredWindowMaxSecondsRemaining: 120,
    lateEntryGuardSeconds: 60,
    veryLateEntryGuardSeconds: 30,
    veryLateConfirmedScoreBump: 0.2,
    earlyStarterStake: 6,
    lowConfidenceStake: 8,
    mediumConfidenceStake: 12,
    highConfidenceStake: 16,
  },
  evaluate: evaluatePortedStrategyV4SingleAsset,
};

export default strategy;
