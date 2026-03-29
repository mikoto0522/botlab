import type { BotlabStrategyDefinition } from '../core/types.js';

interface ExampleMomentumParams extends Record<string, unknown> {
  enterMomentum: number;
  exitMomentum: number;
  allocation: number;
}

export const strategy: BotlabStrategyDefinition<ExampleMomentumParams> = {
  id: 'example-momentum',
  name: 'Example Momentum',
  description: 'A simple starter strategy that buys strength and exits when momentum fades.',
  defaults: {
    enterMomentum: 0.65,
    exitMomentum: 0.35,
    allocation: 0.1,
  },
  evaluate(context, params) {
    const latestClose = context.market.candles.at(-1)?.close ?? context.market.price;
    const previousClose = context.market.candles.at(-2)?.close ?? latestClose;
    const derivedMomentum = previousClose > 0
      ? (latestClose - previousClose) / previousClose
      : context.market.momentum;
    const momentum = context.market.candles.length >= 2
      ? Math.max(context.market.momentum, derivedMomentum)
      : context.market.momentum;

    if (context.position.side === 'flat' && momentum > params.enterMomentum) {
      return {
        action: 'buy',
        reason: 'momentum is strong enough to open a position',
        size: params.allocation,
      };
    }

    if (context.position.side === 'long' && momentum < params.exitMomentum) {
      return {
        action: 'sell',
        reason: 'momentum has faded and the position should be closed',
        size: context.position.size,
      };
    }

    return {
      action: 'hold',
      reason: 'momentum is not strong enough to change the position',
    };
  },
};

export default strategy;
