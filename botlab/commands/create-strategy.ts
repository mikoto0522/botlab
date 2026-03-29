import fs from 'node:fs';
import path from 'node:path';
import { buildStrategyTemplate } from '../templates/strategy-template.js';

export async function createStrategyCommand(name: string, strategyDir: string): Promise<string> {
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error('Strategy name is required.');
  }

  const template = buildStrategyTemplate(trimmedName);
  const filePath = path.resolve(strategyDir, template.fileName);

  fs.mkdirSync(strategyDir, { recursive: true });

  if (fs.existsSync(filePath)) {
    throw new Error(`Strategy already exists: ${filePath}`);
  }

  fs.writeFileSync(filePath, template.source, 'utf-8');

  return `Created strategy at ${filePath}`;
}
