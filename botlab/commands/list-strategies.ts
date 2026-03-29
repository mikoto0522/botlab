import type { BotlabConfig } from '../core/types.js';
import { listAvailableStrategies, renderStrategySummary } from '../core/engine.js';

export async function listStrategiesCommand(config: BotlabConfig): Promise<string> {
  const strategies = await listAvailableStrategies(config);

  if (strategies.length === 0) {
    return 'No strategies found.';
  }

  return strategies.map((strategy) => renderStrategySummary(strategy)).join('\n\n');
}
