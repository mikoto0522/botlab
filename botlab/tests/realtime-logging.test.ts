import assert from 'node:assert/strict';
import test from 'node:test';

test('quiet cycle logger only prints low-frequency heartbeats but still prints trade activity immediately', async () => {
  const { createQuietCycleLogger } = await import('../commands/realtime-logging.js');
  const lines: string[] = [];
  const logCycle = createQuietCycleLogger('paper', {
    heartbeatIntervalMs: 60_000,
    write: (line) => {
      lines.push(line);
    },
  });

  logCycle({
    type: 'cycle',
    timestamp: '2026-04-11T15:30:00.000Z',
    cycleCount: 1,
    cash: 100,
    equity: 100,
    openedCount: 0,
    closedCount: 0,
    settledCount: 0,
    decisions: [{
      asset: 'BTC',
      action: 'hold',
      side: 'flat',
      reason: 'no edge',
      marketSlug: 'btc-updown-5m-1775921400',
      upPrice: 0.67,
      downPrice: 0.24,
      upAsk: 0.68,
      downAsk: 0.25,
    }],
  });
  logCycle({
    type: 'cycle',
    timestamp: '2026-04-11T15:30:10.000Z',
    cycleCount: 2,
    cash: 100,
    equity: 100,
    openedCount: 0,
    closedCount: 0,
    settledCount: 0,
    decisions: [{
      asset: 'BTC',
      action: 'hold',
      side: 'flat',
      reason: 'no edge',
      marketSlug: 'btc-updown-5m-1775921400',
      upPrice: 0.66,
      downPrice: 0.25,
      upAsk: 0.67,
      downAsk: 0.26,
    }],
  });
  logCycle({
    type: 'cycle',
    timestamp: '2026-04-11T15:31:10.000Z',
    cycleCount: 3,
    cash: 100,
    equity: 100,
    openedCount: 0,
    closedCount: 0,
    settledCount: 0,
    decisions: [{
      asset: 'BTC',
      action: 'hold',
      side: 'flat',
      reason: 'still no edge',
      marketSlug: 'btc-updown-5m-1775921400',
      upPrice: 0.65,
      downPrice: 0.26,
      upAsk: 0.66,
      downAsk: 0.27,
    }],
  });
  logCycle({
    type: 'cycle',
    timestamp: '2026-04-11T15:31:11.000Z',
    cycleCount: 4,
    cash: 88,
    equity: 88.5,
    openedCount: 1,
    closedCount: 0,
    settledCount: 0,
    decisions: [{
      asset: 'BTC',
      action: 'buy',
      side: 'up',
      reason: 'strong signal',
      marketSlug: 'btc-updown-5m-1775921400',
      upPrice: 0.41,
      downPrice: 0.59,
      upAsk: 0.42,
      downAsk: 0.6,
    }],
  });
  logCycle({
    type: 'error',
    timestamp: '2026-04-11T15:31:12.000Z',
    cycleCount: 5,
    cash: 88,
    equity: 88.5,
    openedCount: 0,
    closedCount: 0,
    settledCount: 0,
    errorMessage: 'temporary disconnect',
  });

  assert.deepEqual(lines, [
    '[2026-04-11T15:30:00.000Z] paper heartbeat: connected | cycles=1 cash=100.00 equity=100.00',
    '[2026-04-11T15:31:10.000Z] paper heartbeat: connected | cycles=3 cash=100.00 equity=100.00',
    '[2026-04-11T15:31:11.000Z] cycle 4: BTC btc-updown-5m-1775921400 buy up (price up=0.41 down=0.59) | opened=1 closed=0 settled=0 | cash=88.00 equity=88.50',
    '[2026-04-11T15:31:12.000Z] cycle 5: skipped (temporary disconnect)',
  ]);
});

test('realtime connection logger prints only key connection lifecycle events', async () => {
  const { createRealtimeConnectionLogger } = await import('../commands/realtime-logging.js');
  const lines: string[] = [];
  const logConnection = createRealtimeConnectionLogger('live', {
    write: (line) => {
      lines.push(line);
    },
  });

  logConnection({
    type: 'connected',
    timestamp: '2026-04-11T15:30:00.000Z',
  });
  logConnection({
    type: 'reconnecting',
    timestamp: '2026-04-11T15:30:05.000Z',
    attempt: 1,
    maxAttempts: 5,
    delayMs: 5_000,
  });
  logConnection({
    type: 'reconnected',
    timestamp: '2026-04-11T15:30:10.000Z',
  });
  logConnection({
    type: 'fatal',
    timestamp: '2026-04-11T15:30:35.000Z',
    message: 'Realtime market connection exhausted 5 reconnect attempts.',
  });

  assert.deepEqual(lines, [
    '[2026-04-11T15:30:00.000Z] live realtime connected',
    '[2026-04-11T15:30:05.000Z] live realtime reconnecting (attempt 1/5 in 5s)',
    '[2026-04-11T15:30:10.000Z] live realtime reconnected',
    '[2026-04-11T15:30:35.000Z] live realtime stopped (Realtime market connection exhausted 5 reconnect attempts.)',
  ]);
});
