import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BotlabStrategyDefinition } from './types.js';

export interface LoadedStrategy<TParams extends Record<string, unknown> = Record<string, unknown>> {
  filePath: string;
  definition: BotlabStrategyDefinition<TParams>;
}

const STRATEGY_FILE_PATTERN = /\.strategy\.(?:ts|js|mjs)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getStrategyModuleExport(moduleExports: Record<string, unknown>): unknown {
  if ('strategy' in moduleExports) {
    return moduleExports.strategy;
  }
  if ('definition' in moduleExports) {
    return moduleExports.definition;
  }
  if ('default' in moduleExports) {
    return moduleExports.default;
  }

  return undefined;
}

function validateStrategyDefinition(
  filePath: string,
  value: unknown,
): BotlabStrategyDefinition {
  if (!isRecord(value)) {
    throw new Error(`Strategy module must export an object: ${filePath}`);
  }
  if (typeof value.id !== 'string' || !value.id.trim()) {
    throw new Error(`Strategy module must define a string id: ${filePath}`);
  }
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error(`Strategy module must define a string name: ${filePath}`);
  }
  if (typeof value.description !== 'string' || !value.description.trim()) {
    throw new Error(`Strategy module must define a string description: ${filePath}`);
  }
  if (!isRecord(value.defaults)) {
    throw new Error(`Strategy module must define defaults as an object: ${filePath}`);
  }
  if (typeof value.evaluate !== 'function') {
    throw new Error(`Strategy module must define an evaluate function: ${filePath}`);
  }

  return value as unknown as BotlabStrategyDefinition;
}

export async function discoverStrategies(strategyDir: string): Promise<LoadedStrategy[]> {
  if (!fs.existsSync(strategyDir)) {
    return [];
  }

  const entries = fs.readdirSync(strategyDir, { withFileTypes: true });
  const strategyFiles = entries
    .filter((entry) => entry.isFile() && STRATEGY_FILE_PATTERN.test(entry.name))
    .map((entry) => path.resolve(strategyDir, entry.name))
    .sort();

  const loadedStrategies: LoadedStrategy[] = [];

  for (const filePath of strategyFiles) {
    const moduleExports = (await import(pathToFileURL(filePath).href)) as Record<string, unknown>;
    const strategy = validateStrategyDefinition(filePath, getStrategyModuleExport(moduleExports));
    loadedStrategies.push({
      filePath,
      definition: strategy,
    });
  }

  return loadedStrategies;
}
