import type { BotlabStrategyContext, BotlabStrategyDecision, BotlabStrategyDefinition } from './types.js';

export function runStrategy<TParams extends Record<string, unknown>>(
  strategy: BotlabStrategyDefinition<TParams>,
  context: BotlabStrategyContext,
): BotlabStrategyDecision {
  return strategy.evaluate(context, strategy.defaults);
}
