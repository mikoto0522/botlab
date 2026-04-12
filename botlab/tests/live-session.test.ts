import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appendLiveSessionEvent } from '../live/session-store.js';
import { resolveLiveSessionPaths } from '../live/types.js';

test('appendLiveSessionEvent skips quiet per-cycle noise but keeps meaningful events', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'botlab-live-event-filter-'));
  const sessionName = 'Filtered Live Event Session';

  appendLiveSessionEvent(sessionName, {
    type: 'live-strategy-decision',
    timestamp: '2026-03-26T09:30:00.000Z',
    asset: 'ETH',
    action: 'hold',
    side: 'flat',
    reason: 'no edge',
  }, cwd);
  appendLiveSessionEvent(sessionName, {
    type: 'live-cycle-complete',
    timestamp: '2026-03-26T09:30:00.000Z',
    cycleCount: 1,
    cash: 100,
    equity: 100,
    openPositionCount: 0,
    openedCount: 0,
    closedCount: 0,
    settledCount: 0,
  }, cwd);
  appendLiveSessionEvent(sessionName, {
    type: 'live-strategy-decision',
    timestamp: '2026-03-26T09:31:00.000Z',
    asset: 'ETH',
    action: 'sell',
    side: 'down',
    reason: 'take profit',
  }, cwd);
  appendLiveSessionEvent(sessionName, {
    type: 'live-cycle-complete',
    timestamp: '2026-03-26T09:31:00.000Z',
    cycleCount: 2,
    cash: 101,
    equity: 101,
    openPositionCount: 0,
    openedCount: 0,
    closedCount: 1,
    settledCount: 0,
  }, cwd);

  const { eventsPath } = resolveLiveSessionPaths(cwd, sessionName);
  const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n');

  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0] as string), {
    type: 'live-strategy-decision',
    timestamp: '2026-03-26T09:31:00.000Z',
    asset: 'ETH',
    action: 'sell',
    side: 'down',
    reason: 'take profit',
  });
  assert.deepEqual(JSON.parse(lines[1] as string), {
    type: 'live-cycle-complete',
    timestamp: '2026-03-26T09:31:00.000Z',
    cycleCount: 2,
    cash: 101,
    equity: 101,
    openPositionCount: 0,
    openedCount: 0,
    closedCount: 1,
    settledCount: 0,
  });
});
