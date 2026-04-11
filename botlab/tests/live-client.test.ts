import assert from 'node:assert/strict';
import test from 'node:test';

test('normalizeCollateralBalance converts raw six-decimal USDC balances into display dollars', async () => {
  const { normalizeCollateralBalance } = await import('../live/client.js');

  assert.equal(normalizeCollateralBalance('30009060'), 30.00906);
  assert.equal(normalizeCollateralBalance('1000000'), 1);
  assert.equal(normalizeCollateralBalance('0'), 0);
});

test('resolveBuyOrderFill prefers exchange matched amounts when available', async () => {
  const { resolveBuyOrderFill } = await import('../live/client.js');

  const fill = resolveBuyOrderFill(
    {
      tokenId: 'token-1',
      amount: 1,
      priceLimit: 0.55,
      tickSize: '0.01',
      negRisk: false,
      expectedTotalCost: 1,
      expectedShares: 1.88,
      expectedAveragePrice: 0.53,
      expectedFeesPaid: 0.01,
    },
    {
      success: true,
      errorMsg: '',
      orderID: 'buy-order-1',
      transactionsHashes: [],
      status: 'matched',
      makingAmount: '0.97',
      takingAmount: '1.01',
    },
  );

  assert.equal(fill.orderId, 'buy-order-1');
  assert.equal(fill.status, 'matched');
  assert.equal(fill.tokenId, 'token-1');
  assert.equal(fill.requestedAmount, 1);
  assert.equal(fill.spentAmount, 0.97);
  assert.equal(fill.shares, 1.01);
  assert.ok(Math.abs(fill.averagePrice - 0.9603960396039605) < 1e-12);
  assert.equal(fill.feesPaid, 0.01);
});

test('resolveSellOrderFill prefers exchange matched amounts when available', async () => {
  const { resolveSellOrderFill } = await import('../live/client.js');

  const fill = resolveSellOrderFill(
    {
      tokenId: 'token-1',
      shares: 1.5,
      priceLimit: 0.44,
      tickSize: '0.01',
      negRisk: false,
      expectedGrossProceeds: 0.66,
      expectedAveragePrice: 0.44,
      expectedFeesPaid: 0.01,
    },
    {
      success: true,
      errorMsg: '',
      orderID: 'sell-order-1',
      transactionsHashes: [],
      status: 'matched',
      makingAmount: '1.25',
      takingAmount: '0.6',
    },
  );

  assert.deepEqual(fill, {
    orderId: 'sell-order-1',
    status: 'matched',
    tokenId: 'token-1',
    requestedShares: 1.5,
    soldShares: 1.25,
    averagePrice: 0.48,
    grossProceeds: 0.6,
    feesPaid: 0.01,
    netProceeds: 0.59,
  });
});
