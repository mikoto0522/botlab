import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  appendPaperSessionEvent,
  createEmptyPaperSessionState,
  loadPaperSessionState,
  savePaperSessionState,
} from '../paper/session-store.js';
import { resolvePaperSessionPaths, normalizePaperSessionSlug } from '../paper/types.js';

test('normalizePaperSessionSlug turns a display name into a safe filesystem slug', () => {
  assert.equal(normalizePaperSessionSlug('  BTC / ETH: Lunch Break!  '), 'btc-eth-lunch-break');
  assert.equal(normalizePaperSessionSlug('###'), 'session');
});

test('resolvePaperSessionPaths places the session under a normalized directory name', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-paths-'));
  const paths = resolvePaperSessionPaths(cwd, '  BTC / ETH: Lunch Break!  ');

  assert.equal(path.basename(paths.rootDir), 'BTC%20%2F%20ETH%3A%20Lunch%20Break!');
  assert.equal(paths.statePath, path.resolve(paths.rootDir, 'state.json'));
  assert.equal(paths.summaryPath, path.resolve(paths.rootDir, 'summary.json'));
  assert.equal(paths.eventsPath, path.resolve(paths.rootDir, 'events.jsonl'));
  assert.equal(paths.sessionName, '  BTC / ETH: Lunch Break!  ');
  assert.equal(paths.sessionSlug, 'btc-eth-lunch-break');
});

test('createEmptyPaperSessionState initializes cash, equity, counts, and BTC/ETH history', () => {
  const state = createEmptyPaperSessionState('  BTC / ETH: Lunch Break!  ');

  assert.equal(state.sessionName, '  BTC / ETH: Lunch Break!  ');
  assert.equal(state.cash, 1000);
  assert.equal(state.equity, 1000);
  assert.equal(state.tradeCount, 0);
  assert.equal(state.cycleCount, 0);
  assert.deepEqual(state.positions, {});
  assert.equal(state.history.BTC.maxLength, 200);
  assert.deepEqual(state.history.BTC.points, []);
  assert.equal(state.history.ETH.maxLength, 200);
  assert.deepEqual(state.history.ETH.points, []);
});

test('savePaperSessionState and loadPaperSessionState round-trip a resumed session', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-store-'));
  const sessionName = '  BTC / ETH: Lunch Break!  ';
  const state = createEmptyPaperSessionState(sessionName);

  state.cash = 875.25;
  state.equity = 903.5;
  state.tradeCount = 2;
  state.cycleCount = 4;
  state.positions.BTC = {
    asset: 'BTC',
    side: 'long',
    predictionSide: 'up',
    size: 3,
    shares: 3,
    stake: 120,
    entryPrice: 0.51,
    entryFee: 1.5,
    marketSlug: 'btc-updown-5m-1711445400',
    openedAt: '2026-03-26T09:30:15.000Z',
    bucketStartTime: '2026-03-26T09:30:00.000Z',
    endDate: '2026-03-26T09:35:00.000Z',
  };
  state.history.BTC.points.push({
    timestamp: '2026-03-26T09:30:00.000Z',
    price: 101.5,
  });

  const { rootDir } = savePaperSessionState(state, cwd);
  const loaded = loadPaperSessionState(sessionName, cwd);
  const summary = JSON.parse(fs.readFileSync(path.join(rootDir, 'summary.json'), 'utf-8')) as Record<string, unknown>;

  assert.equal(loaded.sessionName, sessionName);
  assert.equal(loaded.sessionSlug, 'btc-eth-lunch-break');
  assert.equal(loaded.cash, 875.25);
  assert.equal(loaded.equity, 903.5);
  assert.equal(loaded.tradeCount, 2);
  assert.equal(loaded.cycleCount, 4);
  assert.deepEqual(loaded.positions.BTC, {
    asset: 'BTC',
    side: 'long',
    predictionSide: 'up',
    size: 3,
    shares: 3,
    stake: 120,
    entryPrice: 0.51,
    entryFee: 1.5,
    marketSlug: 'btc-updown-5m-1711445400',
    openedAt: '2026-03-26T09:30:15.000Z',
    bucketStartTime: '2026-03-26T09:30:00.000Z',
    endDate: '2026-03-26T09:35:00.000Z',
  });
  assert.deepEqual(loaded.history.BTC.points, [
    {
      timestamp: '2026-03-26T09:30:00.000Z',
      price: 101.5,
    },
  ]);
  assert.deepEqual(summary, {
    sessionName,
    sessionSlug: 'btc-eth-lunch-break',
    createdAt: loaded.createdAt,
    updatedAt: loaded.updatedAt,
    cash: 875.25,
    equity: 903.5,
    tradeCount: 2,
    cycleCount: 4,
  });
});

test('loadPaperSessionState creates an empty state when no files exist yet', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-empty-'));

  const state = loadPaperSessionState('Brand New Session', cwd);

  assert.equal(state.sessionName, 'Brand New Session');
  assert.equal(state.cash, 1000);
  assert.equal(state.equity, 1000);
  assert.equal(state.tradeCount, 0);
  assert.equal(state.cycleCount, 0);
  assert.deepEqual(state.history.ETH.points, []);
});

test('loadPaperSessionState throws a clear error when state.json is malformed', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-malformed-'));
  const sessionName = 'Malformed Session';
  const { rootDir, sessionSlug, statePath } = resolvePaperSessionPaths(cwd, sessionName);

  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(statePath, '{ this is not valid json', 'utf-8');

  assert.throws(
    () => loadPaperSessionState(sessionName, cwd),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Malformed Session/);
      assert.match(error.message, /state\.json/);
      assert.match(error.message, new RegExp(statePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return true;
    },
  );
});

test('loadPaperSessionState ignores an on-disk sessionSlug that disagrees with the requested session', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-slug-'));
  const sessionName = 'Requested Session';
  const { rootDir, statePath, sessionSlug } = resolvePaperSessionPaths(cwd, sessionName);

  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    sessionName,
    sessionSlug: 'wrong-slug',
    createdAt: '2026-03-26T09:00:00.000Z',
    updatedAt: '2026-03-26T09:05:00.000Z',
    cash: 912,
    equity: 934,
    positions: {},
    tradeCount: 1,
    cycleCount: 2,
    history: {
      BTC: { maxLength: 200, points: [] },
      ETH: { maxLength: 200, points: [] },
    },
  }), 'utf-8');

  const state = loadPaperSessionState(sessionName, cwd);

  assert.equal(state.sessionName, sessionName);
  assert.equal(state.sessionSlug, sessionSlug);
  assert.equal(state.cash, 912);
  assert.equal(state.equity, 934);
});

test('resolvePaperSessionPaths gives different directories to names that normalize the same way', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-collision-'));
  const plain = resolvePaperSessionPaths(cwd, 'BTC');
  const punctuated = resolvePaperSessionPaths(cwd, 'BTC!');

  assert.notEqual(plain.rootDir, punctuated.rootDir);
  assert.equal(plain.sessionSlug, 'btc');
  assert.equal(punctuated.sessionSlug, 'btc');
  assert.equal(path.basename(plain.rootDir), 'BTC');
  assert.equal(path.basename(punctuated.rootDir), 'BTC!');
});

test('appendPaperSessionEvent adds one JSONL record per call', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-paper-events-'));
  const sessionName = 'Event Session';

  appendPaperSessionEvent(sessionName, { type: 'cycle-start', timestamp: '2026-03-26T09:30:00.000Z' }, cwd);
  appendPaperSessionEvent(sessionName, { type: 'trade-opened', timestamp: '2026-03-26T09:35:00.000Z', side: 'up' }, cwd);

  const { eventsPath } = resolvePaperSessionPaths(cwd, sessionName);
  const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');

  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0] as string), {
    type: 'cycle-start',
    timestamp: '2026-03-26T09:30:00.000Z',
  });
  assert.deepEqual(JSON.parse(lines[1] as string), {
    type: 'trade-opened',
    timestamp: '2026-03-26T09:35:00.000Z',
    side: 'up',
  });
});
