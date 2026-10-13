import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { gatewayEnvironment, gatewayEndpoints } from '../lib/cybersource/environment';
import { CyberSourceGateway, assertAuthenticationUrl } from '../lib/cybersource/gateway';
import { loadCredentials } from '../lib/pay/credentials';
import { localDemoEnabled, demoCheckout } from '../lib/pay/demo';
import { manualCheckoutInput } from '../lib/pay/manual-checkout';
import { paymentRequestSchema } from '../lib/pay/payment-input';
import { middleware } from '../middleware';

function configuration(t: TestContext) {
  const values = { CYBERSOURCE_ENVIRONMENT: 'production', PAY_PUBLIC_URL: 'https://pay.example.com',
    CYBERSOURCE_MERCHANT_ID: 'test_unit', CYBERSOURCE_KEY_ID: crypto.randomUUID(), CYBERSOURCE_SHARED_SECRET: crypto.randomBytes(32).toString('base64'),
    PAY_DEMO_ENABLED: 'true' };
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  return values;
}

test('both endpoints use the configured BAC credentials; missing secrets fail before requests and production demos stay disabled', async t => {
  const values = configuration(t);
  assert.equal(gatewayEnvironment(), 'production');
  assert.equal((await loadCredentials()).merchantId, values.CYBERSOURCE_MERCHANT_ID);
  assert.deepEqual(await loadCredentials('sandbox'), await loadCredentials('production'));
  delete process.env.CYBERSOURCE_SHARED_SECRET;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected provider call'); });
  await assert.rejects(new CyberSourceGateway().getPayment('fixture'), /CYBERSOURCE_SHARED_SECRET/);
  assert.equal(fetchMock.mock.callCount(), 0);
  process.env.CYBERSOURCE_SHARED_SECRET = values.CYBERSOURCE_SHARED_SECRET;
  assert.equal((await loadCredentials('production')).merchantId, 'test_unit', 'The provider determines endpoint access, not a merchant-name prefix');
  process.env.PAY_PUBLIC_URL = 'http://localhost:3000';
  assert.equal(localDemoEnabled('http://localhost:3000', 'localhost:3000'), false);
  const input = {} as Parameters<CyberSourceGateway['authorizeOnly']>[0];
  await assert.rejects(new CyberSourceGateway('production').authorizeOnly(input), /sandbox-only/);
  process.env.CYBERSOURCE_ENVIRONMENT = 'invalid';
  assert.throws(gatewayEnvironment, /Invalid/);
});

test('requests sign the selected live or sandbox host using the same configured BAC credentials', async t => {
  const values = configuration(t);
  const requests: Array<{ url: string; headers: Headers }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ id: 'unit-transaction' }));
  });
  await new CyberSourceGateway('production').getPayment('unit-transaction');
  await new CyberSourceGateway('sandbox').getPayment('unit-transaction');
  for (const [i, environment] of (['production', 'sandbox'] as const).entries()) {
    const { host, api } = gatewayEndpoints(environment);
    const request = requests[i];
    const merchant = values.CYBERSOURCE_MERCHANT_ID;
    const secret = values.CYBERSOURCE_SHARED_SECRET;
    assert.equal(request.url, `${api}/tss/v2/transactions/unit-transaction`);
    assert.equal(request.headers.get('host'), host); assert.equal(request.headers.get('v-c-merchant-id'), merchant);
    const message = `host: ${host}\ndate: ${request.headers.get('date')}\n(request-target): get /tss/v2/transactions/unit-transaction\nv-c-merchant-id: ${merchant}`;
    const signature = crypto.createHmac('sha256', Buffer.from(secret, 'base64')).update(message).digest('base64');
    assert.ok(request.headers.get('signature')?.includes(`signature="${signature}"`));
  }
});

test('capture context keys, hosted libraries and Cardinal origins match the selected environment', async t => {
  configuration(t);
  const sandboxSigning = await generateKeyPair('RS256', { extractable: true });
  const liveSigning = await generateKeyPair('RS256', { extractable: true });
  const capture = async (production: boolean) => new SignJWT({ ctx: [{ data: { targetOrigins: ['https://pay.example.com'],
    clientLibrary: `${production ? 'https://flex.cybersource.com' : 'https://testflex.cybersource.com'}/microform.js`,
    clientLibraryIntegrity: 'sha256-aGVsbG8=' } }] }).setProtectedHeader({ alg: 'RS256', kid: 'same-kid-in-both-environments' })
    .setIssuedAt().setExpirationTime('15m').sign(production ? liveSigning.privateKey : sandboxSigning.privateKey);
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(JSON.stringify(await exportJWK(String(url).startsWith('https://api.cybersource.com/') ? liveSigning.publicKey : sandboxSigning.publicKey)));
  });
  const sandboxToken = await capture(false), liveToken = await capture(true);
  const sandbox = new CyberSourceGateway('sandbox'), live = new CyberSourceGateway('production');
  assert.match((await sandbox.readCaptureContext(sandboxToken)).clientLibrary, /testflex/);
  assert.match((await live.readCaptureContext(liveToken)).clientLibrary, /^https:\/\/flex\./);
  await assert.rejects(live.readCaptureContext(sandboxToken));
  assert.equal(urls.length, 2, 'The same kid needs separate verification keys per environment');
  assert.doesNotThrow(() => assertAuthenticationUrl('https://centinelapi.cardinalcommerce.com/V1/Cruise/Collect', 'production'));
  assert.throws(() => assertAuthenticationUrl('https://centinelapistag.cardinalcommerce.com/V1/Cruise/Collect', 'production'));
  assert.throws(() => assertAuthenticationUrl('https://attacker.example/', 'production'));
  const policy = middleware(new NextRequest('https://pay.example.com/')).headers.get('content-security-policy')!;
  assert.ok(policy.includes('https://flex.cybersource.com')); assert.ok(policy.includes('https://centinelapi.cardinalcommerce.com'));
  assert.equal(policy.includes('testflex'), false); assert.equal(policy.includes('centinelapistag'), false);
});

test('live payment serialization keeps the HNL total, capture and 3DS proof with the production signature', async t => {
  const values = configuration(t);
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'https://api.cybersource.com/pts/v2/payments');
    const headers = new Headers(init?.headers);
    const raw = String(init?.body);
    const body = JSON.parse(raw);
    assert.equal(body.orderInformation.amountDetails.totalAmount, '5350.77');
    assert.equal(body.orderInformation.amountDetails.currency, 'HNL');
    assert.equal(body.processingInformation.capture, true);
    assert.equal(body.consumerAuthenticationInformation.cavv, 'fixture-cavv');
    const digest = `SHA-256=${crypto.createHash('sha256').update(raw).digest('base64')}`;
    const message = `host: api.cybersource.com\nv-c-date: ${headers.get('v-c-date')}\n(request-target): post /pts/v2/payments\ndigest: ${digest}\nv-c-merchant-id: ${values.CYBERSOURCE_MERCHANT_ID}`;
    const signature = crypto.createHmac('sha256', Buffer.from(values.CYBERSOURCE_SHARED_SECRET, 'base64')).update(message).digest('base64');
    assert.ok(headers.get('signature')?.includes(`signature="${signature}"`));
    assert.equal(headers.get('digest'), digest);
    return new Response(JSON.stringify({ id: 'fixture-payment', status: 'AUTHORIZED',
      orderInformation: { amountDetails: { authorizedAmount: '5350.77', currency: 'HNL' } } }));
  });
  const result = await new CyberSourceGateway('production').pay({
    token: { tokenJwt: 'fixture-jwt', tokenId: 'fixture-token', cardType: '001', brand: 'Visa', expiresAt: '2030-01-01' },
    reference: 'fixture-reference', amount: '5350.77', currency: 'HNL', customerId: 'fixture-customer', billTo: demoCheckout('a').billTo,
    device: { httpAcceptContent: '*/*', httpBrowserLanguage: 'es', httpBrowserJavaEnabled: false, httpBrowserJavaScriptEnabled: true,
      httpBrowserColorDepth: 24, httpBrowserScreenHeight: 900, httpBrowserScreenWidth: 1200, httpBrowserTimeDifference: 0, userAgentBrowserValue: 'fixture' },
    authentication: { status: 'authenticated', gatewayStatus: 'AUTHENTICATION_SUCCESSFUL', commerceIndicator: 'vbv',
      authentication: { cavv: 'fixture-cavv', paresStatus: 'Y', eciRaw: '05' } },
  });
  assert.equal(result.status, 'succeeded');
});

test('manual links use an operator-defined USD amount and cannot be converted into browser-supplied payment totals', t => {
  configuration(t);
  const sample = { reference: 'ORDER-1', customerId: 'customer', unitId: 'unit', clientName: 'Client', unitName: 'A1',
    concept: 'Rent', amount: '199.00', billTo: demoCheckout('a').billTo };
  const input = manualCheckoutInput(sample);
  assert.equal(input.environment, 'production'); assert.equal(input.isTest, false); assert.equal(input.isDemo, false);
  assert.equal(input.source, 'manual'); assert.equal(input.currency, 'USD'); assert.equal(input.amount, '199.00');
  assert.equal(manualCheckoutInput(sample).eventId, input.eventId);
  for (const extra of [{ environment: 'sandbox' }, { isTest: true }, { currency: 'HNL' }, { amount: '0.00' }, { amount: '199.001' }]) {
    assert.throws(() => manualCheckoutInput({ ...sample, ...extra }));
  }
  const request = { transientToken: 't'.repeat(100), cardHolder: 'Unit Test', expirationMonth: '01', expirationYear: '2030',
    browser: { language: 'es', colorDepth: 24, height: 900, width: 1200, timezoneOffset: 0 } };
  assert.equal(paymentRequestSchema.safeParse(request).success, true);
  assert.equal(paymentRequestSchema.safeParse({ ...request, amount: '1.00', currency: 'USD' }).success, false);
});
