import assert from 'node:assert/strict';
import test from 'node:test';

test('normalizeCollateralBalance converts raw six-decimal USDC balances into display dollars', async () => {
  const { normalizeCollateralBalance } = await import('../live/client.js');

  assert.equal(normalizeCollateralBalance('30009060'), 30.00906);
  assert.equal(normalizeCollateralBalance('1000000'), 1);
  assert.equal(normalizeCollateralBalance('0'), 0);
});

