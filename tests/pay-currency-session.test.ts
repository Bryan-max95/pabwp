import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { database, closeDatabase } from '../lib/pay/db';
import { createCheckoutSession, beginAttempt, publicSession } from '../lib/pay/service';
import { currentBchRate } from '../lib/pay/exchange-rate';
import { demoCheckout } from '../lib/pay/demo';
import type { SessionRow } from '../lib/pay/types';
import type { BchRate } from '../lib/pay/bch';
import { manualCheckoutInput } from '../lib/pay/manual-checkout';
import { openSandboxManualAccess, sandboxManualInput, SANDBOX_MANUAL_CUSTOMER } from '../lib/pay/sandbox-manual';

/** In-memory DB boundary: exercises actual session/cache logic without external writes. */
function fixture(t: TestContext) {
  const env = { DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unused', BCH_API_KEY: 'private-unit-test',
    CYBERSOURCE_ENVIRONMENT: 'sandbox', CYBERSOURCE_MERCHANT_ID: 'unit-configured-merchant',
    CYBERSOURCE_KEY_ID: '9b3e9b91-36d0-4d02-b24a-2145570032ea', CYBERSOURCE_SHARED_SECRET: Buffer.alloc(32, 7).toString('base64'),
    PAY_PUBLIC_URL: 'http://localhost:3000', PAY_SESSION_TOKEN_SECRET: 'unit-test-session-secret-with-more-than-32-chars',
    PAY_SANDBOX_MANUAL_ENABLED: 'true', PAY_DEMO_ENABLED: 'true', STOREGANISE_TEST_CUSTOMER_IDS: `demo-customer-a,demo-customer-b,${SANDBOX_MANUAL_CUSTOMER}` };
  const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const sessions = new Map<string, SessionRow>();
  const state = { cache: undefined as BchRate | undefined, inserts: 0, attempts: 0, requests: 0, rate: 26.5, unavailable: false };
  const runQuery = async (sql: string, values: unknown[] = []) => {
    let rows: unknown[] = [];
    if (sql.startsWith('SELECT rate FROM pay_exchange_rates')) rows = state.cache ? [{ rate: state.cache }] : [];
    else if (sql.startsWith('INSERT INTO pay_exchange_rates')) state.cache = JSON.parse(String(values[0]));
    else if (sql.startsWith('SELECT * FROM pay_sessions WHERE event_id=')) rows = [...sessions.values()].filter(s => s.event_id === values[0]);
    else if (sql.startsWith('SELECT * FROM pay_sessions WHERE id=')) rows = [...sessions.values()].filter(s => s.id === values[0]);
    else if (sql.startsWith('INSERT INTO pay_sessions')) {
      const oldSession = [...sessions.values()].find(s => s.event_id === values[1]);
      if (oldSession) rows = [oldSession];
      else {
        const row = { id: String(values[0]), event_id: String(values[1]), launch_hash: String(values[2]),
          customer_id: String(values[3]), order_id: values[4], invoice_id: values[5], unit_id: String(values[6]),
          client_name: String(values[7]), unit_name: String(values[8]), concept: String(values[9]), currency: String(values[10]),
          amount: String(values[11]), bill_to: JSON.parse(String(values[12])), return_url: values[13], is_demo: values[14],
          portal_status: values[15], reference_usd_amount: values[16], usd_hnl_rate: values[17], fx_source: values[18],
          fx_rate_date: values[19], fx_fetched_at: values[20] ? new Date(String(values[20])) : null,
          status: 'open', environment: values[21], checkout_source: values[22], created_at: new Date(), expires_at: new Date(Date.now() + 1800000) } as SessionRow;
        sessions.set(row.id, row); state.inserts++; rows = [row];
      }
    } else if (sql.startsWith('UPDATE pay_sessions SET access_hash=$2,')) {
      const row = [...sessions.values()].find(s => s.launch_hash === values[0] && s.environment === 'sandbox' &&
        s.checkout_source === 'manual' && s.customer_id === values[2] && !s.is_demo && s.expires_at.getTime() > Date.now() &&
        (s.access_hash === values[1] || ['open', 'declined'].includes(s.status)));
      if (row) { row.access_hash = String(values[1]); row.consumed_at ??= new Date(); rows = [row]; }
    } else if (sql.startsWith('SELECT count(*)::int n FROM pay_attempts')) rows = [{ n: state.attempts }];
    else if (sql.startsWith("UPDATE pay_sessions SET status='processing'")) sessions.get(String(values[0]))!.status = 'processing';
    else if (sql.startsWith('INSERT INTO pay_attempts')) state.attempts++;
    else if (!['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) && !sql.includes('pg_advisory_xact_lock') && !sql.includes('CREATE TABLE IF NOT EXISTS')) {
      throw new Error(`Unhandled test query: ${sql}`);
    }
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
  const pool = database();
  t.mock.method(pool, 'query', runQuery);
  t.mock.method(pool, 'connect', async () => ({ query: runQuery, release() {} }));
  t.mock.method(globalThis, 'fetch', async () => {
    state.requests++;
    if (state.unavailable) return new Response('unavailable', { status: 503 });
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa' }).format(new Date());
    return new Response(JSON.stringify([{ IndicadorId: 97, Fecha: `${date}T00:00:00Z`, Valor: state.rate }]));
  });
  t.after(async () => {
    await closeDatabase();
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  return { sessions, state };
}

test('USD price and HNL charge stay attached to the customer, persisted quote and receipt', async t => {
  const { sessions, state } = fixture(t);
  const a = demoCheckout('a');
  const created = await createCheckoutSession(a);
  const row = sessions.get(created.id)!;
  assert.equal(row.amount, '5273.50'); assert.equal(row.currency, 'HNL');
  assert.equal(row.reference_usd_amount, '199.00'); assert.equal(row.usd_hnl_rate, '26.500000');
  assert.equal(row.fx_source, 'BCH'); assert.equal(row.customer_id, a.customerId); assert.equal(row.invoice_id, a.invoiceId);
  const expires = row.expires_at.getTime();
  state.rate = 27;
  state.cache!.fetchedAt = new Date(Date.now() - 3600001).toISOString();
  const b = await createCheckoutSession(demoCheckout('b'));
  assert.equal(sessions.get(b.id)!.amount, '5373.00');
  assert.equal(sessions.get(b.id)!.customer_id, 'demo-customer-b');
  assert.notEqual(created.id, b.id);
  const calls = state.requests;
  delete process.env.BCH_API_KEY;
  const retry = await createCheckoutSession(a);
  assert.deepEqual(retry, created, 'Replaying an event must return its original session without BCH access');
  assert.equal(row.amount, '5273.50'); assert.equal(row.expires_at.getTime(), expires);
  assert.equal(state.requests, calls);
  await assert.rejects(createCheckoutSession({ ...a, customerId: 'demo-customer-b' }), /does not match/);
  const attempt = await beginAttempt(created.id, 'unit-token');
  assert.equal(attempt.session.amount, '5273.50'); assert.equal(attempt.session.currency, 'HNL');
  await assert.rejects(beginAttempt(created.id, 'second-token'), /already active/);
  const view = publicSession({ ...row, status: 'succeeded', gateway_transaction_id: 'test-transaction' });
  assert.equal(view.priceReference?.amount, '199.00'); assert.equal(view.priceReference?.source, 'BCH');
  assert.equal(view.receipt?.amount, '5273.50'); assert.deepEqual(view.receipt?.priceReference, view.priceReference);
});

test('concurrent repeated events resolve to one stored quote and invoice', async t => {
  const { state } = fixture(t);
  const input = demoCheckout('a');
  const results = await Promise.all([createCheckoutSession(input), createCheckoutSession(input)]);
  assert.deepEqual(results[0], results[1]); assert.equal(state.inserts, 1);
});

test('fresh shared cache avoids requests; expired cache cannot hide provider failure', async t => {
  const { state } = fixture(t);
  const rate = await currentBchRate();
  assert.deepEqual(await currentBchRate(), rate); assert.equal(state.requests, 1);
  state.cache!.fetchedAt = new Date(Date.now() - 3600001).toISOString(); state.unavailable = true;
  await assert.rejects(createCheckoutSession(demoCheckout('a')), /BCH_UNAVAILABLE/);
  assert.equal(state.inserts, 0);
  delete process.env.BCH_API_KEY;
  await assert.rejects(createCheckoutSession(demoCheckout('a')), /BCH_NOT_CONFIGURED/);
  assert.equal(state.inserts, 0);
});

test('altered amounts, expired quotes and legacy USD sessions cannot start a charge', async t => {
  const { sessions, state } = fixture(t);
  const created = await createCheckoutSession(demoCheckout('a'));
  const row = sessions.get(created.id)!;
  row.amount = '199.00';
  await assert.rejects(beginAttempt(created.id), /Invalid stored exchange quote/);
  row.amount = '5273.50'; row.expires_at = new Date(Date.now() - 1);
  await assert.rejects(beginAttempt(created.id), /Session expired/);
  row.currency = 'USD';
  await assert.rejects(beginAttempt(created.id), /HNL charge/);
  assert.equal(state.attempts, 0);
});

test('production manual checkout stores a fixed USD quote and starts no payment or invoice delivery', async t => {
  const { sessions, state } = fixture(t);
  process.env.CYBERSOURCE_ENVIRONMENT = 'production';
  process.env.PAY_PUBLIC_URL = 'https://pay.example.com';
  const demo = demoCheckout('a');
  const input = manualCheckoutInput({ reference: 'MANUAL-UNIQUE-1', customerId: 'actual-client', unitId: 'actual-unit',
    clientName: 'Client', unitName: 'Unit A', concept: 'Rent', amount: '199.00', billTo: demo.billTo });
  const created = await createCheckoutSession(input);
  const row = sessions.get(created.id)!;
  assert.equal(row.environment, 'production'); assert.equal(row.checkout_source, 'manual'); assert.equal(row.is_demo, false);
  assert.equal(row.status, 'open'); assert.equal(row.portal_status, 'disabled');
  assert.equal(row.amount, '5273.50'); assert.equal(row.reference_usd_amount, '199.00'); assert.equal(state.attempts, 0);
  assert.equal(publicSession(row).source, 'manual');
  assert.deepEqual(await createCheckoutSession(input), created);
  await assert.rejects(createCheckoutSession({ ...input, amount: '1.00' }), /does not match/);
  await assert.rejects(createCheckoutSession({ ...input, source: 'storeganise' }), /does not match/);
  await assert.rejects(createCheckoutSession({ ...input, isTest: true }), /does not accept test/);
  await assert.rejects(createCheckoutSession({ ...input, isDemo: true }), /does not accept test/);
  process.env.CYBERSOURCE_ENVIRONMENT = 'sandbox';
  await assert.rejects(beginAttempt(created.id), /different gateway environment/);
  assert.equal(state.attempts, 0);
});

test('manual browser session fixes USD99 as an HNL quote without a payment, duplicates or Portal delivery', async t => {
  const { sessions, state } = fixture(t);
  const input = sandboxManualInput({ reference: '5b5ce93f-c7dc-4c9f-b244-6f9d014b33ca', clientName: 'Manual One', unitName: 'B-99', amount: '99.00' });
  const [a, replay] = await Promise.all([createCheckoutSession(input), createCheckoutSession(input)]);
  assert.equal(a.id, replay.id); assert.equal(state.inserts, 1); assert.equal(state.attempts, 0);
  const row = sessions.get(a.id)!;
  assert.equal(row.currency, 'HNL'); assert.equal(row.amount, '2623.50');
  assert.equal(row.reference_usd_amount, '99.00'); assert.equal(row.environment, 'sandbox');
  assert.equal(row.portal_status, 'disabled'); assert.equal(row.checkout_source, 'manual');
  assert.equal(row.client_name, 'Manual One'); assert.equal(row.unit_name, 'B-99');
  await assert.rejects(createCheckoutSession({ ...input, amount: '1.00' }), /does not match/);
  const second = await createCheckoutSession(sandboxManualInput({ reference: '6b5ce93f-c7dc-4c9f-b244-6f9d014b33ca', clientName: 'Manual Two', unitName: 'B-100', amount: '1000.00' }));
  assert.notEqual(a.id, second.id); assert.equal(sessions.get(second.id)!.amount, '26500.00');
  assert.equal(row.amount, '2623.50'); assert.equal(state.attempts, 0);
});

test('lost manual preparation response recovers the same access and quote without resetting attempts or expiry', async t => {
  const { sessions, state } = fixture(t);
  const created = await createCheckoutSession(sandboxManualInput({ reference: '5b5ce93f-c7dc-4c9f-b244-6f9d014b33ca', clientName: 'Retry', unitName: 'A', amount: '99.00' }));
  const row = sessions.get(created.id)!;
  const expiry = row.expires_at.getTime();
  // Recover sessions opened by the old one-use exchange when its cookie never reached the browser.
  row.access_hash = 'legacy-unreceived-cookie-hash'; row.consumed_at = new Date();
  const originalConsumed = row.consumed_at.getTime();
  const [first, retry] = await Promise.all([openSandboxManualAccess(created.launchToken), openSandboxManualAccess(created.launchToken)]);
  assert.equal(first.session.id, created.id); assert.equal(first.accessToken, retry.accessToken);
  assert.equal(row.expires_at.getTime(), expiry); assert.equal(row.consumed_at.getTime(), originalConsumed);
  assert.equal(state.inserts, 1); assert.equal(state.attempts, 0); assert.equal(row.amount, '2623.50');
  row.status = 'processing';
  assert.equal((await openSandboxManualAccess(created.launchToken)).session.status, 'processing');
  row.status = 'succeeded'; row.gateway_transaction_id = 'existing-payment';
  const paid = await openSandboxManualAccess(created.launchToken);
  assert.equal(paid.session.status, 'succeeded'); assert.equal(paid.session.gateway_transaction_id, 'existing-payment');
  row.expires_at = new Date(Date.now() - 1);
  await assert.rejects(openSandboxManualAccess(created.launchToken), /NOT_RECOVERABLE/);
});

test('manual recovery cannot open production, Storeganise, other customers or an unrelated launch token', async t => {
  const { sessions } = fixture(t);
  const created = await createCheckoutSession(sandboxManualInput({ reference: '5b5ce93f-c7dc-4c9f-b244-6f9d014b33ca', clientName: 'Retry', unitName: 'A', amount: '99.00' }));
  const row = sessions.get(created.id)!;
  for (const key of ['environment', 'checkout_source', 'customer_id'] as const) {
    const previous = row[key];
    Object.assign(row, { [key]: key === 'environment' ? 'production' : key === 'checkout_source' ? 'storeganise' : 'someone-else' });
    await assert.rejects(openSandboxManualAccess(created.launchToken), /NOT_RECOVERABLE/);
    Object.assign(row, { [key]: previous });
  }
  await assert.rejects(openSandboxManualAccess('x'.repeat(43)), /NOT_RECOVERABLE/);
  process.env.CYBERSOURCE_ENVIRONMENT = 'production';
  await assert.rejects(openSandboxManualAccess(created.launchToken), /DISABLED/);
});

test('legacy manual HTTP errors with transaction IDs block retries even before reconciliation or after expiry', async t => {
  const { sessions, state } = fixture(t);
  const created = await createCheckoutSession(sandboxManualInput({ reference: '5b5ce93f-c7dc-4c9f-b244-6f9d014b33ca', clientName: 'Manual', unitName: 'A', amount: '199.00' }));
  const row = sessions.get(created.id)!;
  Object.assign(row, { status: 'declined', gateway_status: 'HTTP_400', failure_reason: 'INVALID_DATA', gateway_transaction_id: '7900000000000000000002' });
  assert.equal(publicSession(row).status, 'unknown');
  assert.equal(publicSession(row).failureCode, 'PAYMENT_NOT_CONFIRMED');
  assert.equal(publicSession(row).receipt, undefined);
  await assert.rejects(beginAttempt(row.id, 'fresh-token'), /must be reconciled/);
  row.expires_at = new Date(Date.now() - 1);
  assert.equal(publicSession(row).status, 'unknown');
  await assert.rejects(beginAttempt(row.id, 'another-token'), /must be reconciled/);
  assert.equal(state.attempts, 0);
  assert.equal(row.customer_id, SANDBOX_MANUAL_CUSTOMER);
  row.status = 'unknown'; row.gateway_status = 'AUTHORIZED_CAPTURE_FAILED'; row.failure_reason = 'PURCHASER_CODE_INVALID';
  const view = publicSession(row);
  assert.equal(view.failureCode, 'CAPTURE_FAILED');
  assert.equal(view.receipt, undefined);
  assert.equal(view.failureReason, undefined, 'Raw gateway diagnostics must not reach a manual customer');
  assert.equal(view.gatewayStatus, undefined);
});
