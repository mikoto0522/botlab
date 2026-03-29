import type { BotlabConfig } from '../core/types.js';
import { runStrategyById } from '../core/engine.js';

export async function runStrategyCommand(
  strategyId: string,
  config: BotlabConfig,
): Promise<string> {
  const result = await runStrategyById(strategyId, config);

  return result.renderedOutput;
}
