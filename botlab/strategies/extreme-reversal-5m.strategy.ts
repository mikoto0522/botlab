import type {
  BotlabCandle,
  BotlabRelatedMarketRuntime,
  BotlabStrategyContext,
  BotlabStrategyDecision,
  BotlabStrategyDefinition,
} from '../core/types.js';

interface ExtremeReversalParams extends Record<string, unknown> {
  lookbackCandles: number;
  minimumVolume: number;
  extremeLowPrice: number;
  extremeHighPrice: number;
  minTurnStrength: number;
  stakeSize: number;
}

type ReversalSide = 'up' | 'down';

interface MarketSummary {
  asset: 'BTC' | 'ETH';
  price: number;
  quotedUp: number;
  quotedDown: number;
  volume: number;
  averageMove: number;
  netMove: number;
  lastMove: number;
  previousMove: number;
}

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

function quotedEntryPrice(context: BotlabStrategyContext['market'] | BotlabRelatedMarketRuntime, side: ReversalSide): number {
  if (side === 'up') {
    return context.upAsk ?? context.upPrice ?? context.price;
  }

  return context.downAsk ?? context.downPrice ?? (1 - context.price);
}

function summarizeMarket(
  market: BotlabStrategyContext['market'] | BotlabRelatedMarketRuntime,
  minimumVolume: number,
  lookbackCandles: number,
): MarketSummary | undefined {
  if ((market.asset !== 'BTC' && market.asset !== 'ETH') || market.candles.length < lookbackCandles) {
    return undefined;
  }

  const candles = market.candles.slice(-lookbackCandles);
  const recentMoves = moves(candles);
  const volume = candles.at(-1)?.volume ?? market.volume ?? 0;

  if (volume < minimumVolume) {
    return undefined;
  }

  return {
    asset: market.asset,
    price: market.price,
    quotedUp: quotedEntryPrice(market, 'up'),
    quotedDown: quotedEntryPrice(market, 'down'),
    volume,
    averageMove: averageAbsoluteMove(recentMoves),
    netMove: (candles.at(-1)?.close ?? market.price) - (candles[0]?.close ?? market.price),
    lastMove: recentMoves.at(-1) ?? 0,
    previousMove: recentMoves.at(-2) ?? 0,
  };
}

function relatedMarketFor(context: BotlabStrategyContext): BotlabRelatedMarketRuntime | undefined {
  const targetAsset = context.market.asset === 'BTC' ? 'ETH' : context.market.asset === 'ETH' ? 'BTC' : undefined;
  if (!targetAsset) {
    return undefined;
  }

  return context.relatedMarkets?.find((market) => market.asset === targetAsset && market.timeframe === '5m');
}

function extremePricePassed(summary: MarketSummary, params: ExtremeReversalParams): ReversalSide | undefined {
  if (summary.quotedUp <= params.extremeLowPrice) {
    return 'up';
  }

  if (summary.quotedDown <= params.extremeLowPrice || summary.quotedUp >= params.extremeHighPrice) {
    return 'down';
  }

  return undefined;
}

function selfTurnPassed(summary: MarketSummary, side: ReversalSide, params: ExtremeReversalParams): boolean {
  const turnThreshold = summary.averageMove * params.minTurnStrength;

  if (side === 'up') {
    return summary.netMove < 0 && summary.previousMove < 0 && summary.lastMove > 0 && summary.lastMove >= turnThreshold;
  }

  return summary.netMove > 0 && summary.previousMove > 0 && summary.lastMove < 0 && Math.abs(summary.lastMove) >= turnThreshold;
}

function relatedConfirmationPassed(summary: MarketSummary, side: ReversalSide): boolean {
  if (side === 'up') {
    return summary.lastMove > 0;
  }

  return summary.lastMove < 0;
}

function buildHold(reason: string, tags: string[] = []): BotlabStrategyDecision {
  return {
    action: 'hold',
    reason,
    tags: ['extreme-reversal-5m', 'idle', ...tags],
  };
}

function evaluateExtremeReversal(
  context: BotlabStrategyContext,
  params: ExtremeReversalParams,
): BotlabStrategyDecision {
  if ((context.market.asset !== 'BTC' && context.market.asset !== 'ETH') || context.market.timeframe !== '5m') {
    return buildHold('strategy only trades BTC and ETH 5m markets');
  }

  if (context.position.side !== 'flat') {
    return buildHold('strategy only opens from a flat state');
  }

  const summary = summarizeMarket(context.market, params.minimumVolume, params.lookbackCandles);
  if (!summary) {
    return buildHold('market history is too short or too thin');
  }

  const side = extremePricePassed(summary, params);
  if (!side) {
    return buildHold('quoted entry is not extreme enough yet', ['price-filter']);
  }

  if (!selfTurnPassed(summary, side, params)) {
    return buildHold('extreme price is there, but this market has not turned back yet', ['waiting-turn']);
  }

  const relatedMarket = relatedMarketFor(context);
  if (!relatedMarket) {
    return buildHold('related market confirmation is missing', ['related-missing']);
  }

  const relatedSummary = summarizeMarket(relatedMarket, params.minimumVolume, params.lookbackCandles);
  if (!relatedSummary) {
    return buildHold('related market is too thin to confirm the reversal', ['related-thin']);
  }

  if (!relatedConfirmationPassed(relatedSummary, side)) {
    return buildHold('related market is still moving against the reversal', ['related-disagree']);
  }

  const size = Number(Math.min(context.balance, params.stakeSize).toFixed(2));
  if (size <= 0) {
    return buildHold('balance is too small for a meaningful trade');
  }

  return {
    action: 'buy',
    side,
    size,
    reason: `${summary.asset} hit an extreme ${side} price, turned back locally, and the related market confirmed it`,
    tags: ['extreme-reversal-5m', side, 'entry', 'extreme', 'confirmed'],
  };
}

export const strategy: BotlabStrategyDefinition<ExtremeReversalParams> = {
  id: 'extreme-reversal-5m',
  name: 'Extreme Reversal 5m',
  description: 'Takes very small BTC or ETH 5m reversal entries only after an extreme quoted price, a local turn, and same-timeframe confirmation from the related market.',
  defaults: {
    lookbackCandles: 5,
    minimumVolume: 900,
    extremeLowPrice: 0.1,
    extremeHighPrice: 0.9,
    minTurnStrength: 0.4,
    stakeSize: 5,
  },
  evaluate: evaluateExtremeReversal,
};

export default strategy;
