import type { BotlabStrategyDefinition } from '../core/types.js';

function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toPascalCase(name: string): string {
  return name
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

export interface StrategyTemplate {
  fileName: string;
  source: string;
}

export function buildStrategyTemplate(name: string): StrategyTemplate {
  const trimmedName = name.trim();
  const id = toSlug(trimmedName);
  const paramsName = `${toPascalCase(trimmedName)}Params`;

  const source = [
    "import type { BotlabStrategyDefinition } from '../core/types.js';",
    '',
    `interface ${paramsName} extends Record<string, unknown> {`,
    '  enterMomentum: number;',
    '  exitMomentum: number;',
    '  allocation: number;',
    '}',
    '',
    `const strategy: BotlabStrategyDefinition<${paramsName}> = {`,
    `  id: '${id}',`,
    `  name: '${trimmedName.replace(/'/g, "\\'")}',`,
    "  description: 'Describe what this strategy is trying to do.',",
    '  defaults: {',
    '    enterMomentum: 0.65,',
    '    exitMomentum: 0.35,',
    '    allocation: 0.1,',
    '  },',
    '  evaluate(context, params) {',
    "    if (context.position.side === 'flat' && context.market.momentum > params.enterMomentum) {",
    '      return {',
    "        action: 'buy',",
    '        reason: `Momentum ${context.market.momentum} is above ${params.enterMomentum}.`,',
    '        size: Number((context.balance * params.allocation).toFixed(2)),',
    "        tags: ['entry'],",
    '      };',
    '    }',
    '',
    "    if (context.position.side === 'long' && context.market.momentum < params.exitMomentum) {",
    '      return {',
    "        action: 'sell',",
    '        reason: `Momentum ${context.market.momentum} is below ${params.exitMomentum}.`,',
    '        size: context.position.size,',
    "        tags: ['exit'],",
    '      };',
    '    }',
    '',
    '    return {',
    "      action: 'hold',",
    "      reason: 'No entry or exit condition matched.',",
    "      tags: ['idle'],",
    '    };',
    '  },',
    '};',
    '',
    'export default strategy;',
    '',
  ].join('\n');

  return {
    fileName: `${id}.strategy.ts`,
    source,
  };
}
