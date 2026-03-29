import type {
  BotlabCandle,
  BotlabHedgeContext,
  BotlabHedgeDecision,
  BotlabRelatedMarketRuntime,
  BotlabStrategyContext,
  BotlabStrategyDecision,
  BotlabStrategyDefinition,
} from '../core/types.js';

interface BtcEthMultiSignalParams extends Record<string, unknown> {
  lookbackCandles: number;
  minimumVolume: number;
  minBinaryPrice: number;
  maxBinaryPrice: number;
  continuationAlignmentMin: number;
  continuationMoveMin: number;
  reversionStretchMin: number;
  relativeSingleGapMin: number;
  relativeHedgeGapMin: number;
  maxNoiseRatio: number;
  btcMinEntryPrice: number;
  btcMinReplayRescueDownPrice: number;
  btcGuardrailStake: number;
  lowConfidenceStake: number;
  mediumConfidenceStake: number;
  highConfidenceStake: number;
  hedgeStakePerLeg: number;
}

type PredictionSide = 'up' | 'down';
type SignalFamily = 'continuation' | 'reversion' | 'relative-value';
type MoveBucket = 'm++' | 'm+' | 'm0' | 'm-' | 'm--';
type AccelBucket = 'a++' | 'a+' | 'a0' | 'a-' | 'a--';
type Sequence2 = '++' | '+-' | '-+' | '--' | '+0' | '-0' | '0+' | '0-' | '00';
type Sequence3 = '+++' | '++-' | '+-+' | '+--' | '-++' | '-+-' | '--+' | '---' | string;

interface MarketView {
  asset: 'BTC' | 'ETH';
  price: number;
  volume: number;
  candles: BotlabCandle[];
  averageClose: number;
  averageMove: number;
  netMove: number;
  lastMove: number;
  previousMove: number;
  acceleration: number;
  alignment: number;
  noiseRatio: number;
  stretch: number;
  priceBucket: number;
  moveBucket: MoveBucket;
  accelBucket: AccelBucket;
  sequence2: Sequence2;
  sequence3: Sequence3;
}

interface SignalCandidate {
  side: PredictionSide;
  family: SignalFamily;
  score: number;
  reason: string;
  tags: string[];
}

const DIRECT_RUNTIME_BUCKETS: Record<'BTC' | 'ETH', Record<string, { side: PredictionSide; score: number }>> = {
  BTC: {
    '6|m--|a--': { side: 'up', score: 1.5 },
  },
  ETH: {},
};

const REPLAY_RULES: Array<{
  asset: 'BTC' | 'ETH';
  side: PredictionSide;
  family: SignalFamily;
  score: number;
  reason: string;
  priceBucket?: number;
  sequence2?: Sequence2;
  sequence3?: Sequence3;
  minNetMove?: number;
  maxNetMove?: number;
  minStretch?: number;
  maxStretch?: number;
}> = [
  {
    asset: 'BTC',
    side: 'up',
    family: 'reversion',
    score: 3.4,
    sequence3: '---',
    reason: 'BTC kept sliding for three straight steps, and that replay state paid best when bought back up',
  },
  {
    asset: 'BTC',
    side: 'up',
    family: 'reversion',
    score: 3.1,
    priceBucket: 6,
    sequence2: '-+',
    reason: 'BTC in the 0.6x zone with a down-then-up wobble stayed profitable on the upside replay',
  },
  {
    asset: 'BTC',
    side: 'down',
    family: 'continuation',
    score: 2.4,
    priceBucket: 8,
    sequence3: '++-',
    minNetMove: 0.1,
    reason: 'BTC near the upper band after a fast push and slip favored the downside replay',
  },
  {
    asset: 'BTC',
    side: 'up',
    family: 'reversion',
    score: 2.2,
    priceBucket: 5,
    sequence2: '--',
    reason: 'BTC in the middle band after two drops still had a small but repeatable snapback edge',
  },
  {
    asset: 'ETH',
    side: 'down',
    family: 'continuation',
    score: 2.9,
    priceBucket: 3,
    sequence2: '-+',
    reason: 'ETH in the 0.3x zone with a bounce-then-fade pattern kept paying on the downside replay',
  },
  {
    asset: 'ETH',
    side: 'up',
    family: 'reversion',
    score: 2.7,
    priceBucket: 3,
    sequence2: '--',
    reason: 'ETH in the 0.3x zone after two down steps still recovered enough to pay on the upside replay',
  },
  {
    asset: 'ETH',
    side: 'down',
    family: 'continuation',
    score: 2.1,
    priceBucket: 4,
    sequence2: '++',
    reason: 'ETH in the 0.4x zone after two quick pushes stayed rich enough to fade down',
  },
  {
    asset: 'ETH',
    side: 'down',
    family: 'continuation',
    score: 2.05,
    priceBucket: 8,
    sequence3: '-+-',
    minNetMove: 0.2,
    reason: 'ETH near the upper band after an up-down-up wobble kept paying on the downside replay',
  },
];

const REPLAY_RESCUE_RULES: Array<{
  asset: 'BTC' | 'ETH';
  side: PredictionSide;
  family: SignalFamily;
  score: number;
  reason: string;
  priceBucket?: number;
  sequence2?: Sequence2;
}> = [
  {
    asset: 'BTC',
    side: 'down',
    family: 'continuation',
    score: 1.95,
    priceBucket: 5,
    sequence2: '+-',
    reason: 'BTC in the middle band after a pop-and-slip wobble kept paying better on the downside follow-through',
  },
  {
    asset: 'BTC',
    side: 'down',
    family: 'continuation',
    score: 1.9,
    priceBucket: 4,
    sequence2: '-+',
    reason: 'BTC in the lower middle band often rolled back down after a rebound lost its grip',
  },
];

function clampScore(value: number): number {
  return Number(value.toFixed(3));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageClose(candles: BotlabCandle[]): number {
  return average(candles.map((candle) => candle.close));
}

function recentMoves(candles: BotlabCandle[]): number[] {
  const moves: number[] = [];

  for (let index = 1; index < candles.length; index += 1) {
    moves.push(candles[index]!.close - candles[index - 1]!.close);
  }

  return moves;
}

function averageAbsoluteMove(moves: number[]): number {
  if (moves.length === 0) {
    return 0;
  }

  return average(moves.map((move) => Math.abs(move)));
}

function directionAlignment(moves: number[]): number {
  if (moves.length === 0) {
    return 0;
  }

  let positive = 0;
  let negative = 0;

  for (const move of moves) {
    if (move > 0) {
      positive += 1;
    } else if (move < 0) {
      negative += 1;
    }
  }

  const directionalCount = positive + negative;
  if (directionalCount === 0) {
    return 0;
  }

  return Math.max(positive, negative) / directionalCount;
}

function noiseRatio(moves: number[]): number {
  if (moves.length < 2) {
    return 0;
  }

  let signChanges = 0;
  let comparableMoves = 0;

  for (let index = 1; index < moves.length; index += 1) {
    const previous = Math.sign(moves[index - 1]!);
    const current = Math.sign(moves[index]!);

    if (previous === 0 || current === 0) {
      continue;
    }

    comparableMoves += 1;
    if (previous !== current) {
      signChanges += 1;
    }
  }

  if (comparableMoves === 0) {
    return 0;
  }

  return signChanges / comparableMoves;
}

function bucketMove(move: number): MoveBucket {
  if (move > 0.08) {
    return 'm++';
  }

  if (move > 0.03) {
    return 'm+';
  }

  if (move < -0.08) {
    return 'm--';
  }

  if (move < -0.03) {
    return 'm-';
  }

  return 'm0';
}

function bucketAcceleration(acceleration: number): AccelBucket {
  if (acceleration > 0.06) {
    return 'a++';
  }

  if (acceleration > 0.02) {
    return 'a+';
  }

  if (acceleration < -0.06) {
    return 'a--';
  }

  if (acceleration < -0.02) {
    return 'a-';
  }

  return 'a0';
}

function encodeSign(value: number): '+' | '-' | '0' {
  if (value > 0) {
    return '+';
  }

  if (value < 0) {
    return '-';
  }

  return '0';
}

function toMarketView(
  asset: 'BTC' | 'ETH',
  price: number,
  volume: number,
  candles: BotlabCandle[],
): MarketView {
  const moves = recentMoves(candles);
  const averageMove = Math.max(averageAbsoluteMove(moves), 0.01);
  const lastMove = moves.at(-1) ?? 0;
  const previousMove = moves.at(-2) ?? 0;
  const olderMove = moves.at(-3) ?? 0;
  const averagePrice = averageClose(candles);
  const netMove = (candles.at(-1)?.close ?? price) - (candles[0]?.close ?? price);
  const stretch = (price - averagePrice) / averageMove;

  return {
    asset,
    price,
    volume,
    candles,
    averageClose: averagePrice,
    averageMove,
    netMove,
    lastMove,
    previousMove,
    acceleration: lastMove - previousMove,
    alignment: directionAlignment(moves),
    noiseRatio: noiseRatio(moves),
    stretch,
    priceBucket: Math.max(0, Math.min(9, Math.floor(price * 10))),
    moveBucket: bucketMove(lastMove),
    accelBucket: bucketAcceleration(lastMove - previousMove),
    sequence2: `${encodeSign(lastMove)}${encodeSign(previousMove)}` as Sequence2,
    sequence3: `${encodeSign(lastMove)}${encodeSign(previousMove)}${encodeSign(olderMove)}`,
  };
}

function findPeerMarket(
  context: BotlabStrategyContext,
  asset: 'BTC' | 'ETH',
): BotlabRelatedMarketRuntime | undefined {
  const targetAsset = asset === 'BTC' ? 'ETH' : 'BTC';

  return context.relatedMarkets?.find((market) => (
    market.asset === targetAsset && market.timeframe === '5m'
  ));
}

function findHedgeMarket(context: BotlabHedgeContext, asset: 'BTC' | 'ETH'): BotlabRelatedMarketRuntime | undefined {
  return context.markets.find((market) => market.asset === asset && market.timeframe === '5m');
}

function binaryPriceAllowed(price: number, params: BtcEthMultiSignalParams): boolean {
  return price > params.minBinaryPrice && price < params.maxBinaryPrice;
}

function effectiveEntryPrice(
  market: BotlabStrategyContext['market'],
  side: PredictionSide,
): number {
  if (side === 'up') {
    return market.upAsk ?? market.upPrice ?? market.price;
  }

  return market.downAsk ?? market.downPrice ?? (1 - market.price);
}

function runtimeVolume(volume: number | undefined, candles: BotlabCandle[]): number {
  const candleVolume = candles.at(-1)?.volume;
  if (typeof candleVolume === 'number' && Number.isFinite(candleVolume)) {
    return candleVolume;
  }

  if (typeof volume === 'number' && Number.isFinite(volume)) {
    return volume;
  }

  return 0;
}

function isReplayLikeContext(context: BotlabStrategyContext): boolean {
  const latestCandle = context.market.candles.at(-1);
  if (!latestCandle) {
    return false;
  }

  return Math.abs(context.market.price - latestCandle.close) < 1e-9
    && Date.parse(context.market.timestamp) > Date.parse(latestCandle.timestamp);
}

function bucketKey(view: MarketView): string {
  return `${view.priceBucket}|${view.moveBucket}|${view.accelBucket}`;
}

function buildDirectRuntimeBucketCandidate(view: MarketView): SignalCandidate | undefined {
  const match = DIRECT_RUNTIME_BUCKETS[view.asset][bucketKey(view)];
  if (!match) {
    return undefined;
  }

  const movementDirection = Math.sign(view.lastMove);
  const sideDirection = match.side === 'up' ? 1 : -1;
  const family: SignalFamily = movementDirection === 0 || movementDirection === sideDirection
    ? 'continuation'
    : 'reversion';

  return {
    side: match.side,
    family,
    score: match.score,
    reason: `${view.asset} historical bucket ${bucketKey(view)} stayed profitable on both replay windows`,
    tags: ['btc-eth-5m-multi-signal', family, 'bucket'],
  };
}

function buildReplayCandidates(view: MarketView): SignalCandidate[] {
  return REPLAY_RULES
    .filter((rule) => (
      rule.asset === view.asset
      && (rule.priceBucket === undefined || rule.priceBucket === view.priceBucket)
      && (rule.sequence2 === undefined || rule.sequence2 === view.sequence2)
      && (rule.sequence3 === undefined || rule.sequence3 === view.sequence3)
      && (rule.minNetMove === undefined || view.netMove >= rule.minNetMove)
      && (rule.maxNetMove === undefined || view.netMove <= rule.maxNetMove)
      && (rule.minStretch === undefined || view.stretch >= rule.minStretch)
      && (rule.maxStretch === undefined || view.stretch <= rule.maxStretch)
    ))
    .map((rule) => ({
      side: rule.side,
      family: rule.family,
      score: rule.score,
      reason: rule.reason,
      tags: ['btc-eth-5m-multi-signal', rule.family, 'replay-model'],
    }));
}

function buildReplayRescueCandidates(view: MarketView): SignalCandidate[] {
  return REPLAY_RESCUE_RULES
    .filter((rule) => (
      rule.asset === view.asset
      && (rule.priceBucket === undefined || rule.priceBucket === view.priceBucket)
      && (rule.sequence2 === undefined || rule.sequence2 === view.sequence2)
    ))
    .map((rule) => ({
      side: rule.side,
      family: rule.family,
      score: rule.score,
      reason: rule.reason,
      tags: ['btc-eth-5m-multi-signal', rule.family, 'replay-rescue'],
    }));
}

function buildContinuationCandidate(
  view: MarketView,
  params: BtcEthMultiSignalParams,
): SignalCandidate | undefined {
  const direction = Math.sign(view.netMove);
  if (
    direction === 0
    || view.alignment < params.continuationAlignmentMin
    || Math.abs(view.netMove) < params.continuationMoveMin
    || view.noiseRatio > params.maxNoiseRatio
  ) {
    return undefined;
  }

  const sameDirectionCarry = Math.sign(view.lastMove) === direction || Math.abs(view.lastMove) <= view.averageMove * 0.3;
  if (!sameDirectionCarry) {
    return undefined;
  }

  return {
    side: direction > 0 ? 'up' : 'down',
    family: 'continuation',
    score: clampScore(1.6 + view.alignment + Math.min(Math.abs(view.netMove) / view.averageMove, 2.5) * 0.35),
    reason: `${view.asset} kept carrying in one direction through the middle zone`,
    tags: ['btc-eth-5m-multi-signal', 'continuation'],
  };
}

function buildReversionCandidate(
  view: MarketView,
  params: BtcEthMultiSignalParams,
): SignalCandidate | undefined {
  const stretchDirection = Math.sign(view.stretch);
  if (
    stretchDirection === 0
    || Math.abs(view.stretch) < params.reversionStretchMin
    || Math.sign(view.lastMove) !== -stretchDirection
    || Math.abs(view.lastMove) < view.averageMove * 0.5
  ) {
    return undefined;
  }

  return {
    side: stretchDirection > 0 ? 'down' : 'up',
    family: 'reversion',
    score: clampScore(1.8 + Math.min(Math.abs(view.stretch), 3) * 0.4 + Math.min(Math.abs(view.lastMove) / view.averageMove, 2) * 0.25),
    reason: `${view.asset} stretched too far and the last move started snapping back`,
    tags: ['btc-eth-5m-multi-signal', 'reversion'],
  };
}

function buildRelativeValueCandidate(
  view: MarketView,
  peer: MarketView,
  params: BtcEthMultiSignalParams,
): SignalCandidate | undefined {
  const relativeGap = view.stretch - peer.stretch;
  if (Math.abs(relativeGap) < params.relativeSingleGapMin || Math.sign(view.lastMove) !== Math.sign(relativeGap)) {
    return undefined;
  }

  return {
    side: relativeGap > 0 ? 'up' : 'down',
    family: 'relative-value',
    score: clampScore(1.2 + Math.min(Math.abs(relativeGap), 3) * 0.45),
    reason: `${view.asset} is diverging from ${peer.asset} by ${relativeGap.toFixed(2)} stretch units`,
    tags: ['btc-eth-5m-multi-signal', 'relative-value'],
  };
}

function summarizeCandidates(candidates: SignalCandidate[]): {
  upScore: number;
  downScore: number;
  reasons: string[];
  tags: string[];
} {
  let upScore = 0;
  let downScore = 0;
  const reasons: string[] = [];
  const tags = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.side === 'up') {
      upScore += candidate.score;
    } else {
      downScore += candidate.score;
    }

    reasons.push(candidate.reason);
    for (const tag of candidate.tags) {
      tags.add(tag);
    }
  }

  return {
    upScore: clampScore(upScore),
    downScore: clampScore(downScore),
    reasons,
    tags: [...tags],
  };
}

function stakeForScore(
  balance: number,
  score: number,
  asset: 'BTC' | 'ETH',
  tags: string[],
  params: BtcEthMultiSignalParams,
): number {
  if (asset === 'BTC' && !tags.includes('replay-model')) {
    return Number(Math.min(balance, params.btcGuardrailStake).toFixed(2));
  }

  if (score >= 2) {
    return Number(Math.min(balance, params.lowConfidenceStake).toFixed(2));
  }

  const requested = score >= 4.5
    ? params.highConfidenceStake
    : score >= 3.3
      ? params.mediumConfidenceStake
      : params.lowConfidenceStake;

  return Number(Math.min(balance, requested).toFixed(2));
}

function evaluateSingleMarket(
  context: BotlabStrategyContext,
  params: BtcEthMultiSignalParams,
): BotlabStrategyDecision {
  if ((context.market.asset !== 'BTC' && context.market.asset !== 'ETH') || context.market.timeframe !== '5m') {
    return {
      action: 'hold',
      reason: 'strategy only trades BTC and ETH 5m prediction markets',
      tags: ['btc-eth-5m-multi-signal', 'idle'],
    };
  }

  if (context.position.side !== 'flat') {
    return {
      action: 'hold',
      reason: 'strategy only opens from a flat state',
      tags: ['btc-eth-5m-multi-signal', 'idle'],
    };
  }

  if (
    context.market.candles.length < params.lookbackCandles
    || !binaryPriceAllowed(context.market.price, params)
  ) {
    return {
      action: 'hold',
      reason: 'market is too thin or too close to the binary extremes',
      tags: ['btc-eth-5m-multi-signal', 'idle'],
    };
  }

  const currentVolume = runtimeVolume(context.market.volume, context.market.candles);
  const replayLike = isReplayLikeContext(context);
  if ((!replayLike && currentVolume < params.minimumVolume) || currentVolume <= 0) {
    return {
      action: 'hold',
      reason: 'market is too thin or too close to the binary extremes',
      tags: ['btc-eth-5m-multi-signal', 'idle'],
    };
  }

  const asset = context.market.asset as 'BTC' | 'ETH';
  const candles = context.market.candles.slice(-params.lookbackCandles);
  const view = toMarketView(asset, context.market.price, currentVolume, candles);

  if (!replayLike && view.noiseRatio > params.maxNoiseRatio && view.alignment < 0.7) {
    return {
      action: 'hold',
      reason: `${asset} 5m history is too noisy to trust`,
      tags: ['btc-eth-5m-multi-signal', 'idle', 'noisy'],
    };
  }

  const candidates: SignalCandidate[] = [];

  if (replayLike) {
    candidates.push(...buildReplayCandidates(view));
    if (candidates.length === 0) {
      candidates.push(...buildReplayRescueCandidates(view));
    }
  } else {
    const directRuntimeBucket = buildDirectRuntimeBucketCandidate(view);
    if (directRuntimeBucket) {
      candidates.push(directRuntimeBucket);
    }

    const continuationCandidate = buildContinuationCandidate(view, params);
    if (continuationCandidate) {
      candidates.push(continuationCandidate);
    }

    const reversionCandidate = buildReversionCandidate(view, params);
    if (reversionCandidate) {
      candidates.push(reversionCandidate);
    }

    const peerMarket = findPeerMarket(context, asset);
    if (
      peerMarket
      && runtimeVolume(peerMarket.volume, peerMarket.candles) >= params.minimumVolume
      && peerMarket.candles.length >= params.lookbackCandles
      && binaryPriceAllowed(peerMarket.price, params)
    ) {
      const peerAsset = peerMarket.asset as 'BTC' | 'ETH';
      const peerView = toMarketView(
        peerAsset,
        peerMarket.price,
        runtimeVolume(peerMarket.volume, peerMarket.candles),
        peerMarket.candles.slice(-params.lookbackCandles),
      );
      const relativeCandidate = buildRelativeValueCandidate(view, peerView, params);
      if (relativeCandidate) {
        candidates.push(relativeCandidate);
      }
    }
  }

  if (candidates.length === 0) {
    return {
      action: 'hold',
      reason: `${asset} 5m setup did not pass any continuation, reversion, or relative-value checks`,
      tags: ['btc-eth-5m-multi-signal', 'idle'],
    };
  }

  const summary = summarizeCandidates(candidates);
  const bestSide: PredictionSide = summary.upScore >= summary.downScore ? 'up' : 'down';
  const bestScore = bestSide === 'up' ? summary.upScore : summary.downScore;
  const otherScore = bestSide === 'up' ? summary.downScore : summary.upScore;

  if (bestScore < 1.8 || bestScore - otherScore < 0.55) {
    return {
      action: 'hold',
      reason: `${asset} had signals, but they were too weak or conflicted too much`,
      tags: ['btc-eth-5m-multi-signal', 'idle', 'weak'],
    };
  }

  const quotedEntryPrice = effectiveEntryPrice(context.market, bestSide);
  if (!binaryPriceAllowed(quotedEntryPrice, params)) {
    return {
      action: 'hold',
      reason: `${asset} setup looked good, but the actual ${bestSide} entry was already too close to the binary extremes`,
      tags: ['btc-eth-5m-multi-signal', 'idle', 'expensive-entry'],
    };
  }

  if (asset === 'BTC' && bestSide === 'up' && quotedEntryPrice < params.btcMinEntryPrice) {
    return {
      action: 'hold',
      reason: 'BTC upside entry was too cheap and left too much wipeout risk for too little consistency',
      tags: ['btc-eth-5m-multi-signal', 'idle', 'lottery-entry'],
    };
  }

  if (
    asset === 'BTC'
    && bestSide === 'down'
    && summary.tags.includes('replay-rescue')
    && quotedEntryPrice < params.btcMinReplayRescueDownPrice
  ) {
    return {
      action: 'hold',
      reason: 'BTC downside rescue entry was too cheap and had started behaving like a coin-flip instead of a controlled fade',
      tags: ['btc-eth-5m-multi-signal', 'idle', 'cheap-rescue-down'],
    };
  }

  const size = stakeForScore(context.balance, bestScore, asset, summary.tags, params);
  if (size <= 0) {
    return {
      action: 'hold',
      reason: 'balance is too small for a meaningful trade',
      tags: ['btc-eth-5m-multi-signal', 'idle'],
    };
  }

  return {
    action: 'buy',
    side: bestSide,
    size,
    reason: `${asset} multi-signal chose ${bestSide} from ${summary.reasons.join('; ')}`,
    tags: [...summary.tags, bestSide, 'entry'],
  };
}

function evaluateRelativeHedge(
  context: BotlabHedgeContext,
  params: BtcEthMultiSignalParams,
): BotlabHedgeDecision {
  const btcMarket = findHedgeMarket(context, 'BTC');
  const ethMarket = findHedgeMarket(context, 'ETH');

  if (!btcMarket || !ethMarket) {
    return {
      action: 'hold',
      reason: 'need both BTC and ETH 5m markets for the paired path',
      tags: ['btc-eth-5m-multi-signal', 'idle'],
    };
  }

  if (
    runtimeVolume(btcMarket.volume, btcMarket.candles) < params.minimumVolume
    || runtimeVolume(ethMarket.volume, ethMarket.candles) < params.minimumVolume
    || btcMarket.candles.length < params.lookbackCandles
    || ethMarket.candles.length < params.lookbackCandles
    || !binaryPriceAllowed(btcMarket.price, params)
    || !binaryPriceAllowed(ethMarket.price, params)
  ) {
    return {
      action: 'hold',
      reason: 'paired path needs healthy BTC and ETH 5m context',
      tags: ['btc-eth-5m-multi-signal', 'idle'],
    };
  }

  const btc = toMarketView(
    'BTC',
    btcMarket.price,
    runtimeVolume(btcMarket.volume, btcMarket.candles),
    btcMarket.candles.slice(-params.lookbackCandles),
  );
  const eth = toMarketView(
    'ETH',
    ethMarket.price,
    runtimeVolume(ethMarket.volume, ethMarket.candles),
    ethMarket.candles.slice(-params.lookbackCandles),
  );

  if ((btc.noiseRatio > params.maxNoiseRatio && btc.alignment < 0.7) || (eth.noiseRatio > params.maxNoiseRatio && eth.alignment < 0.7)) {
    return {
      action: 'hold',
      reason: 'paired path stands aside when either market looks too noisy',
      tags: ['btc-eth-5m-multi-signal', 'idle', 'noisy'],
    };
  }

  const relativeGap = btc.stretch - eth.stretch;
  if (Math.abs(relativeGap) < params.relativeHedgeGapMin) {
    return {
      action: 'hold',
      reason: `BTC/ETH divergence is only ${relativeGap.toFixed(2)}, so the paired path stays flat`,
      tags: ['btc-eth-5m-multi-signal', 'idle'],
    };
  }

  const stake = Number(Math.min(context.balance / 2, params.hedgeStakePerLeg).toFixed(2));
  if (stake <= 0) {
    return {
      action: 'hold',
      reason: 'balance is too small for a paired entry',
      tags: ['btc-eth-5m-multi-signal', 'idle'],
    };
  }

  return {
    action: 'hedge',
    reason: relativeGap > 0
      ? `BTC is running ${relativeGap.toFixed(2)} stretch units ahead of ETH, so the paired path backs BTC and fades ETH`
      : `ETH is running ${Math.abs(relativeGap).toFixed(2)} stretch units ahead of BTC, so the paired path backs ETH and fades BTC`,
    legs: relativeGap > 0
      ? [
        { asset: 'BTC', side: 'up', size: stake },
        { asset: 'ETH', side: 'down', size: stake },
      ]
      : [
        { asset: 'BTC', side: 'down', size: stake },
        { asset: 'ETH', side: 'up', size: stake },
      ],
    tags: ['btc-eth-5m-multi-signal', 'relative-value', 'hedge'],
  };
}

export const strategy: BotlabStrategyDefinition<BtcEthMultiSignalParams> = {
  id: 'btc-eth-5m-multi-signal',
  name: 'BTC / ETH 5m Multi Signal',
  description: 'Blends fast prediction-market replay rules with continuation, reversion, and BTC/ETH relative-value checks so the strategy can trade more often without leaning on one narrow setup.',
  defaults: {
    lookbackCandles: 6,
    minimumVolume: 900,
    minBinaryPrice: 0,
    maxBinaryPrice: 0.93,
    continuationAlignmentMin: 0.75,
    continuationMoveMin: 0.14,
    reversionStretchMin: 1.35,
      relativeSingleGapMin: 0.95,
      relativeHedgeGapMin: 1.25,
      maxNoiseRatio: 0.55,
      btcMinEntryPrice: 0.03,
      btcMinReplayRescueDownPrice: 0.05,
      btcGuardrailStake: 14,
      lowConfidenceStake: 20,
      mediumConfidenceStake: 28,
    highConfidenceStake: 36,
    hedgeStakePerLeg: 20,
  },
  evaluate(context, params) {
    return evaluateSingleMarket(context, params);
  },
  evaluateHedge(context, params) {
    return evaluateRelativeHedge(context, params);
  },
};

export default strategy;
