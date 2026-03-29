import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createStrategyCommand } from '../commands/create-strategy.js';

const execFileAsync = promisify(execFile);

test('createStrategyCommand writes a new strategy file', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-create-'));

  await createStrategyCommand('Breakout Scout', tempDir);

  const createdPath = path.join(tempDir, 'breakout-scout.strategy.ts');

  assert.equal(fs.existsSync(createdPath), true);
  assert.match(fs.readFileSync(createdPath, 'utf-8'), /id: 'breakout-scout'/);
});

test('createStrategyCommand rejects duplicate strategy files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-create-'));
  const createdPath = path.join(tempDir, 'breakout-scout.strategy.ts');

  fs.writeFileSync(createdPath, 'export default {};', 'utf-8');

  await assert.rejects(
    () => createStrategyCommand('Breakout Scout', tempDir),
    /already exists/i,
  );
});

test('botlab cli list-strategies prints the bundled example strategy', async () => {
  const tsxCli = path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');

  const result = await execFileAsync(process.execPath, [tsxCli, 'botlab/cli.ts', 'list-strategies'], {
    cwd: process.cwd(),
  });

  assert.match(result.stdout, /example-momentum/);
});
