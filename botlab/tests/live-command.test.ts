import assert from 'node:assert/strict';
import test from 'node:test';

test('assertRealtimeCompatibleLiveStrategy allows only single-asset realtime strategies', async () => {
  const {
    SUPPORTED_REALTIME_LIVE_STRATEGY_IDS,
    assertRealtimeCompatibleLiveStrategy,
  } = await import('../commands/live.js');

  assert.deepEqual(
    [...SUPPORTED_REALTIME_LIVE_STRATEGY_IDS].sort(),
    ['btc-eth-5m', 'btc-eth-5m-aggressive', 'polybot-ported-v4-single-asset'],
  );
  assert.doesNotThrow(() => {
    assertRealtimeCompatibleLiveStrategy('btc-eth-5m');
  });
  assert.doesNotThrow(() => {
    assertRealtimeCompatibleLiveStrategy('btc-eth-5m-aggressive');
  });
  assert.doesNotThrow(() => {
    assertRealtimeCompatibleLiveStrategy('polybot-ported-v4-single-asset');
  });
  assert.throws(() => {
    assertRealtimeCompatibleLiveStrategy('polybot-ported');
  }, /only supports btc-eth-5m, btc-eth-5m-aggressive, and polybot-ported-v4-single-asset/i);
});
