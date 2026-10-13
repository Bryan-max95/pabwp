import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { sandboxManualEnabled, sandboxManualInput, sandboxManualSchema, SANDBOX_MANUAL_CUSTOMER } from '../lib/pay/sandbox-manual';
import { POST } from '../app/api/pay/manual/route';

const input = { reference: '5b5ce93f-c7dc-4c9f-b244-6f9d014b33ca', clientName: 'Cliente Manual', unitName: 'B-99', amount: '99.00' };
function configure(t: TestContext) {
  const values = { CYBERSOURCE_ENVIRONMENT: 'sandbox', PAY_SANDBOX_MANUAL_ENABLED: 'true',
    PAY_PUBLIC_URL: 'http://localhost:3000', STOREGANISE_TEST_CUSTOMER_IDS: SANDBOX_MANUAL_CUSTOMER };
  const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No external requests allowed'); });
  t.after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test('browser-entered totals require explicit sandbox configuration and never enable production', t => {
  configure(t);
  assert.equal(sandboxManualEnabled(), true);
  for (const [key, value] of Object.entries({ CYBERSOURCE_ENVIRONMENT: 'production', PAY_SANDBOX_MANUAL_ENABLED: 'false',
    STOREGANISE_TEST_CUSTOMER_IDS: 'someone-else', PAY_PUBLIC_URL: 'http://public.example.com' })) {
    const prior = process.env[key]; process.env[key] = value;
    assert.equal(sandboxManualEnabled(), false);
    assert.throws(() => sandboxManualInput(input), /DISABLED/);
    process.env[key] = prior;
  }
});

test('manual sandbox creates only a fixed USD test input, bound to the typed identity and request', t => {
  configure(t);
  const session = sandboxManualInput(input);
  assert.equal(session.environment, 'sandbox'); assert.equal(session.source, 'manual');
  assert.equal(session.amount, '99.00'); assert.equal(session.currency, 'USD');
  assert.equal(session.clientName, input.clientName); assert.equal(session.unitName, input.unitName);
  assert.equal(session.isTest, true); assert.equal(session.fiscalEnvironment, 'test');
  assert.equal(session.eventId, sandboxManualInput(input).eventId);
  assert.notEqual(session.unitId, sandboxManualInput({ ...input, clientName: 'Otro Cliente' }).unitId);
  assert.notEqual(session.eventId, sandboxManualInput({ ...input, reference: '6b5ce93f-c7dc-4c9f-b244-6f9d014b33ca' }).eventId);
});

test('preparation endpoint rejects card data, environment overrides and cross-origin requests before services', async t => {
  configure(t);
  const request = (body: unknown, origin = 'http://localhost:3000') => new NextRequest('http://localhost:3000/api/pay/manual', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  for (const extra of [{ cardNumber: '4456530000001005' }, { cvv: '123' }, { currency: 'HNL' }, { environment: 'production' },
    { amount: '0.00' }, { amount: '-1.00' }, { amount: '99.999' }, { reference: 'invalid' }]) {
    assert.equal(sandboxManualSchema.safeParse({ ...input, ...extra }).success, false);
    assert.equal((await POST(request({ ...input, ...extra }))).status, 400);
  }
  assert.equal((await POST(request(input, 'https://attacker.example'))).status, 403);
  process.env.CYBERSOURCE_ENVIRONMENT = 'production';
  assert.equal((await POST(request(input))).status, 404);
});
