import type { BotlabStrategyContext, BotlabStrategyDecision, BotlabStrategyDefinition } from './types.js';
import { resolveStrategyParams } from './strategy-params.js';

export function runStrategy<TParams extends Record<string, unknown>>(
  strategy: BotlabStrategyDefinition<TParams>,
  context: BotlabStrategyContext,
  overrides?: Record<string, unknown>,
): BotlabStrategyDecision {
  return strategy.evaluate(context, resolveStrategyParams(strategy.defaults, overrides));
}
