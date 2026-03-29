import type { BotlabConfig, BotlabStrategyDecision } from './types.js';
import { buildStrategyContext } from './context.js';
import { createStrategyRegistry } from './strategy-registry.js';
import { runStrategy } from './runner.js';

export interface StrategySummary<TParams extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  defaults: TParams;
}

export interface StrategyRunResult<TParams extends Record<string, unknown> = Record<string, unknown>> {
  strategyId: string;
  strategy: StrategySummary<TParams>;
  context: ReturnType<typeof buildStrategyContext>;
  decision: BotlabStrategyDecision;
  renderedOutput: string;
}

function formatDefaults(defaults: Record<string, unknown>): string {
  return JSON.stringify(defaults, null, 2);
}

function cloneDefaults<TParams extends Record<string, unknown>>(defaults: TParams): TParams {
  return structuredClone(defaults);
}

export function renderDecision(
  strategyId: string,
  decision: BotlabStrategyDecision,
): string {
  const lines = [
    `Strategy: ${strategyId}`,
    `ACTION: ${decision.action}`,
    `Reason: ${decision.reason}`,
  ];

  if (typeof decision.size === 'number') {
    lines.push(`Size: ${decision.size}`);
  }
  if (Array.isArray(decision.tags) && decision.tags.length > 0) {
    lines.push(`Tags: ${decision.tags.join(', ')}`);
  }

  return lines.join('\n');
}

export async function listAvailableStrategies(config: BotlabConfig): Promise<StrategySummary[]> {
  const registry = await createStrategyRegistry(config.paths.strategyDir);

  return registry.strategies.map((strategy) => ({
    id: strategy.definition.id,
    name: strategy.definition.name,
    description: strategy.definition.description,
    defaults: cloneDefaults(strategy.definition.defaults),
  }));
}

export async function describeStrategyById(
  strategyId: string,
  config: BotlabConfig,
): Promise<StrategySummary> {
  const registry = await createStrategyRegistry(config.paths.strategyDir);
  const strategy = registry.getById(strategyId);

  return {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    defaults: cloneDefaults(strategy.defaults),
  };
}

export async function runStrategyById(
  strategyId: string,
  config: BotlabConfig,
): Promise<StrategyRunResult> {
  const registry = await createStrategyRegistry(config.paths.strategyDir);
  const loadedStrategy = registry.strategies.find((strategy) => strategy.definition.id === strategyId);

  if (!loadedStrategy) {
    throw new Error(`Unknown strategy id: ${strategyId}`);
  }

  const context = buildStrategyContext(config);
  const isolatedStrategy = {
    ...loadedStrategy.definition,
    defaults: cloneDefaults(loadedStrategy.definition.defaults),
  };
  const decision = runStrategy(isolatedStrategy, context);
  const strategy = {
    id: isolatedStrategy.id,
    name: isolatedStrategy.name,
    description: isolatedStrategy.description,
    defaults: isolatedStrategy.defaults,
  };

  return {
    strategyId,
    strategy,
    context,
    decision,
    renderedOutput: renderDecision(strategyId, decision),
  };
}

export function renderStrategySummary(strategy: StrategySummary): string {
  return [
    `${strategy.id} | ${strategy.name}`,
    strategy.description,
    `Defaults: ${formatDefaults(strategy.defaults)}`,
  ].join('\n');
}
