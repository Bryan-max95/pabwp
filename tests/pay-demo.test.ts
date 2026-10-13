import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCheckout, localDemoEnabled } from '../lib/pay/demo';
import { createCheckoutSession } from '../lib/pay/service';
import { DEMO_AMOUNTS, DEMO_SCENARIOS } from '../lib/pay/demo-scenarios';
import { hnlCharge } from '../lib/pay/exchange-rate';
import { publicSession } from '../lib/pay/service';
import type { SessionRow } from '../lib/pay/types';

test('anonymous demo is limited to explicitly enabled development on loopback', () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, PAY_DEMO_ENABLED: process.env.PAY_DEMO_ENABLED, PAY_PUBLIC_URL: process.env.PAY_PUBLIC_URL };
  try {
    Object.assign(process.env, { NODE_ENV: 'development', PAY_DEMO_ENABLED: 'true', PAY_PUBLIC_URL: 'http://localhost:3000' });
    assert.equal(localDemoEnabled('http://localhost:3000/api/pay/demo', 'localhost:3000'), true);
    assert.equal(localDemoEnabled('http://localhost:3000/api/pay/demo', 'attacker.example'), false);
    assert.equal(localDemoEnabled('https://pay.example/api/pay/demo', 'localhost:3000'), false);
    Object.assign(process.env, { NODE_ENV: 'production' });
    assert.equal(localDemoEnabled('http://localhost:3000/api/pay/demo', 'localhost:3000'), false);
    Object.assign(process.env, { NODE_ENV: 'development', PAY_DEMO_ENABLED: 'false' });
    assert.equal(localDemoEnabled('http://localhost:3000/api/pay/demo', 'localhost:3000'), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('each local trial has its own invoice and server-defined non-fiscal details', () => {
  const a = demoCheckout('a'), b = demoCheckout('b'), next = demoCheckout('a');
  assert.notEqual(a.invoiceId, b.invoiceId);
  assert.notEqual(a.invoiceId, next.invoiceId);
  assert.equal(a.amount, '199.00'); assert.equal(b.amount, '199.00');
  assert.notEqual(a.customerId, b.customerId); assert.notEqual(a.unitId, b.unitId);
  for (const trial of [a, b, next]) {
    assert.equal(trial.environment, 'sandbox'); assert.equal(trial.isDemo, true);
    assert.equal(trial.currency, 'USD');
    assert.equal(trial.fiscalEnvironment, 'test'); assert.equal(trial.isTest, true);
  }
});

test('server accepts only defined USD and historical HNL demo prices', async () => {
  const keys = ['PAY_DEMO_ENABLED', 'PAY_PUBLIC_URL', 'STOREGANISE_TEST_CUSTOMER_IDS'];
  const previous = Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env, { PAY_DEMO_ENABLED:'true', PAY_PUBLIC_URL:'http://localhost:3000', STOREGANISE_TEST_CUSTOMER_IDS:'demo-customer-a' });
    for (const scenario of DEMO_SCENARIOS) assert.equal(demoCheckout('a', scenario).amount, DEMO_AMOUNTS[scenario]);
    for (const amount of ['0.50','1.00','10.00','100.01','151.00','300.00']) await assert.rejects(createCheckoutSession({ ...demoCheckout('a'), amount }), /Invalid sandbox demo/);
    await assert.rejects(createCheckoutSession({ ...demoCheckout('a'), currency:'HNL' }), /Invalid sandbox demo/);
  } finally {
    for (const [key,value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key]=value; }
  }
});

test('USD invoice converts to HNL with exact decimal arithmetic and one rounding', () => {
  assert.equal(hnlCharge('199.00', '26.5'), '5273.50');
  assert.equal(hnlCharge('199.00', '26.123456'), '5198.57');
  assert.equal(hnlCharge('0.01', '26.5'), '0.27', 'Half cents round up');
  assert.equal(hnlCharge('10.01', '26.123456'), '261.50');
  for (const rate of ['', '0', '-1', 'NaN', 'Infinity', '26.1234567', '26,50']) assert.throws(() => hnlCharge('199.00', rate));
  for (const amount of ['0.00', '-1.00', '199', '199.001', '1e2', '99999999999.99']) assert.throws(() => hnlCharge(amount, '26.5'));
});

test('session and receipt retain HNL while the USD reference uses the stored rate', () => {
  const previous = process.env.PAY_USD_HNL_RATE;
  try {
    process.env.PAY_USD_HNL_RATE = '99';
    const row = { id: 'fixture', status: 'succeeded', currency: 'HNL', amount: '150.00',
      reference_usd_amount: '5.66', usd_hnl_rate: '26.500000', gateway_transaction_id: 'fixture-transaction',
      expires_at: new Date(), created_at: new Date() } as SessionRow;
    const session = publicSession(row);
    assert.equal(session.amount, '150.00'); assert.equal(session.currency, 'HNL');
    assert.deepEqual(session.priceReference, { amount: '5.66', currency: 'USD', hnlPerUsd: '26.500000' });
    assert.equal(session.receipt?.amount, '150.00'); assert.equal(session.receipt?.currency, 'HNL');
  } finally { if (previous === undefined) delete process.env.PAY_USD_HNL_RATE; else process.env.PAY_USD_HNL_RATE = previous; }
});
