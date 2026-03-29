import type { BotlabStrategyDefinition } from './types.js';
import { discoverStrategies, type LoadedStrategy } from './strategy-loader.js';

export interface StrategyRegistry {
  strategies: LoadedStrategy[];
  getById: (id: string) => BotlabStrategyDefinition;
}

export function getStrategyById(
  strategies: LoadedStrategy[],
  id: string,
): BotlabStrategyDefinition {
  const match = strategies.find((strategy) => strategy.definition.id === id);

  if (!match) {
    throw new Error(`Unknown strategy id: ${id}`);
  }

  return match.definition;
}

export async function createStrategyRegistry(strategyDir: string): Promise<StrategyRegistry> {
  const strategies = await discoverStrategies(strategyDir);

  return {
    strategies,
    getById: (id: string) => getStrategyById(strategies, id),
  };
}
