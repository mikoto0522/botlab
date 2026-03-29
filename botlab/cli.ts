import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { analyzeHedgeCommand } from './commands/analyze-hedge.js';
import { backtestCommand, type BacktestSide } from './commands/backtest.js';
import { backtestBatchCommand } from './commands/backtest-batch.js';
import { backtestHedgeCommand } from './commands/backtest-hedge.js';
import { loadBotlabConfig } from './config/default-config.js';
import { createStrategyCommand } from './commands/create-strategy.js';
import { describeStrategyCommand } from './commands/describe-strategy.js';
import { listStrategiesCommand } from './commands/list-strategies.js';
import { paperCommand } from './commands/paper.js';
import { runStrategyCommand } from './commands/run-strategy.js';

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(cliDir, '..');

function getFlagValue(args: string[], flagName: string): string | undefined {
  const prefix = `--${flagName}=`;
  const match = args.find((arg) => arg.startsWith(prefix));

  return match ? match.slice(prefix.length) : undefined;
}

function hasFlag(args: string[], flagName: string): boolean {
  return args.includes(`--${flagName}`) || args.some((arg) => arg.startsWith(`--${flagName}=`));
}

function getBacktestSide(args: string[]): BacktestSide {
  const sideValue = getFlagValue(args, 'side');

  if (sideValue === undefined) {
    if (hasFlag(args, 'side')) {
      throw new Error('Invalid --side value. Use --side=up or --side=down.');
    }

    return 'up';
  }

  if (sideValue === 'up' || sideValue === 'down') {
    return sideValue;
  }

  throw new Error('Invalid --side value. Use --side=up or --side=down.');
}

function requireCommand(command: string | undefined): string {
  if (!command) {
    throw new Error('Missing command. Use list-strategies, describe-strategy, create-strategy, run, paper, backtest, backtest-batch, backtest-hedge, or analyze-hedge.');
  }

  return command;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const command = requireCommand(argv[0]);
  const config = loadBotlabConfig(getFlagValue(argv, 'config'), projectRoot);

  if (command === 'list-strategies') {
    console.log(await listStrategiesCommand(config));
    return;
  }

  if (command === 'describe-strategy') {
    const strategyId = getFlagValue(argv, 'strategy');
    if (!strategyId) {
      throw new Error('Missing required flag --strategy=<id>.');
    }

    console.log(await describeStrategyCommand(strategyId, config));
    return;
  }

  if (command === 'create-strategy') {
    const name = getFlagValue(argv, 'name');
    if (!name) {
      throw new Error('Missing required flag --name=<strategy name>.');
    }

    console.log(await createStrategyCommand(name, config.paths.strategyDir));
    return;
  }

  if (command === 'run') {
    const strategyId = getFlagValue(argv, 'strategy');
    if (!strategyId) {
      throw new Error('Missing required flag --strategy=<id>.');
    }

    console.log(await runStrategyCommand(strategyId, config));
    return;
  }

  if (command === 'paper') {
    const strategyId = getFlagValue(argv, 'strategy');
    if (!strategyId) {
      throw new Error('Missing required flag --strategy=<id>.');
    }

    const sessionName = getFlagValue(argv, 'session') ?? 'default-paper';
    const intervalValue = Number(getFlagValue(argv, 'interval') ?? '30');
    if (!Number.isFinite(intervalValue) || intervalValue < 0) {
      throw new Error('Invalid --interval value. Use a non-negative number of seconds.');
    }

    const maxCyclesValue = getFlagValue(argv, 'max-cycles');
    const parsedMaxCycles = maxCyclesValue === undefined ? undefined : Number(maxCyclesValue);
    if (parsedMaxCycles !== undefined && (!Number.isInteger(parsedMaxCycles) || parsedMaxCycles < 1)) {
      throw new Error('Invalid --max-cycles value. Use a positive whole number.');
    }
    const maxCycles = parsedMaxCycles;

    const fixturePath = getFlagValue(argv, 'fixture');
    console.log(await paperCommand(strategyId, config, {
      sessionName,
      intervalSeconds: intervalValue,
      maxCycles,
      fixturePath,
    }));
    return;
  }

  if (command === 'backtest') {
    const strategyId = getFlagValue(argv, 'strategy');
    if (!strategyId) {
      throw new Error('Missing required flag --strategy=<id>.');
    }

    const dataPath = getFlagValue(argv, 'data');
    if (!dataPath) {
      throw new Error('Missing required flag --data=<path>.');
    }

    console.log(await backtestCommand(strategyId, dataPath, getBacktestSide(argv), config));
    return;
  }

  if (command === 'backtest-batch') {
    if (hasFlag(argv, 'side')) {
      throw new Error('The backtest-batch command does not accept --side. Use --strategy and --data only.');
    }

    const strategyId = getFlagValue(argv, 'strategy');
    if (!strategyId) {
      throw new Error('Missing required flag --strategy=<id>.');
    }

    const dataPath = getFlagValue(argv, 'data');
    if (!dataPath) {
      throw new Error('Missing required flag --data=<path>.');
    }

    console.log(await backtestBatchCommand(strategyId, dataPath, config));
    return;
  }

  if (command === 'backtest-hedge') {
    if (hasFlag(argv, 'side')) {
      throw new Error('The backtest-hedge command does not accept --side. Use --strategy and --data only.');
    }

    const strategyId = getFlagValue(argv, 'strategy');
    if (!strategyId) {
      throw new Error('Missing required flag --strategy=<id>.');
    }

    const dataPath = getFlagValue(argv, 'data');
    if (!dataPath) {
      throw new Error('Missing required flag --data=<path>.');
    }

    console.log(await backtestHedgeCommand(strategyId, dataPath, config));
    return;
  }

  if (command === 'analyze-hedge') {
    if (hasFlag(argv, 'side')) {
      throw new Error('The analyze-hedge command does not accept --side. Use --strategy and --data only.');
    }

    const strategyId = getFlagValue(argv, 'strategy');
    if (!strategyId) {
      throw new Error('Missing required flag --strategy=<id>.');
    }

    const dataPath = getFlagValue(argv, 'data');
    if (!dataPath) {
      throw new Error('Missing required flag --data=<path>.');
    }

    console.log(await analyzeHedgeCommand(strategyId, dataPath, config));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(message);
  process.exitCode = 1;
});
