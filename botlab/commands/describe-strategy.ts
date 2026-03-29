import type { BotlabConfig } from '../core/types.js';
import { describeStrategyById } from '../core/engine.js';

export async function describeStrategyCommand(
  strategyId: string,
  config: BotlabConfig,
): Promise<string> {
  const strategy = await describeStrategyById(strategyId, config);

  return [
    `id: ${strategy.id}`,
    `name: ${strategy.name}`,
    `description: ${strategy.description}`,
    `defaults: ${JSON.stringify(strategy.defaults, null, 2)}`,
  ].join('\n');
}
