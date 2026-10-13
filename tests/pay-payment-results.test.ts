import test from 'node:test';
import assert from 'node:assert/strict';
import { CyberSourceGateway } from '../lib/cybersource/gateway';
import { merchantCustomerReference } from '../lib/cybersource/customer-reference';
import { reconcileTransaction } from '../lib/cybersource/reconciliation';
import { paymentFailureCode, paymentFailureMessage } from '../lib/pay/payment-feedback';
import type { AuthenticationCheckInput } from '../lib/cybersource/types';

const id = '7900000000000000000002';
const input: AuthenticationCheckInput = {
  token: { tokenJwt: 'private-token', tokenId: 'private-jti', cardType: '001', brand: 'Visa', expiresAt: '2030-01-01' },
  reference: 'RSS-session-1', referenceId: 'unit-ddc', returnUrl: 'http://localhost/return',
  amount: '5353.50', currency: 'HNL', customerId: 'manual-sandbox-customer',
  billTo: { firstName: 'Manual', lastName: 'Test', address1: '1 Test Street', locality: 'Miami', country: 'US', email: 'manual-sandbox@example.com' },
  device: { httpAcceptContent: '*/*', httpBrowserLanguage: 'es', httpBrowserJavaEnabled: false, httpBrowserJavaScriptEnabled: true,
    httpBrowserColorDepth: 24, httpBrowserScreenHeight: 800, httpBrowserScreenWidth: 1200, httpBrowserTimeDifference: 0, userAgentBrowserValue: 'unit' },
};
const approvedAuth = { status: 'authenticated' as const, gatewayStatus: 'AUTHENTICATION_SUCCESSFUL', commerceIndicator: 'vbv', authentication: { cavv: 'private-cavv' } };
const success = (name: string) => ({ name, reasonCode: '100', rCode: '1', rFlag: 'SOK' });
const failedCapture = {
  id, clientReferenceInformation: { code: input.reference },
  orderInformation: { amountDetails: { totalAmount: '5353.5', currency: 'HNL' } },
  applicationInformation: { applications: [success('ics_auth'), {
    name: 'ics_bill', reasonCode: '102', rCode: '0', rFlag: 'DINVALIDDATA', rMessage: 'The field is invalid: purchaser_code',
  }] },
};

test('processor customer references fit 15 characters without truncating shared prefixes', () => {
  assert.equal(merchantCustomerReference('demo-customer-a'), 'demo-customer-a');
  const longIds = ['manual-sandbox-customer', 'storeganise-customer-aaaaaaaa', 'storeganise-customer-aaaaaaab', 'Cliente José'];
  const mapped = longIds.map(merchantCustomerReference);
  for (let n = 0; n < mapped.length; n++) {
    assert.match(mapped[n], /^[A-Za-z0-9_-]{1,15}$/);
    assert.equal(mapped[n], merchantCustomerReference(longIds[n]));
  }
  assert.equal(new Set(mapped).size, longIds.length);
});

test('manual enrollment and sale send the same bounded customer reference, exact HNL total and capture=true', async t => {
  const previous = { ...process.env };
  Object.assign(process.env, { CYBERSOURCE_MERCHANT_ID: 'unit-merchant', CYBERSOURCE_KEY_ID: '9b3e9b91-36d0-4d02-b24a-2145570032ea',
    CYBERSOURCE_SHARED_SECRET: Buffer.alloc(32, 7).toString('base64') });
  t.after(() => { process.env = previous; });
  const calls: Array<{ url: string; body: Record<string, any> }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(String(url).endsWith('/risk/v1/authentications') ? {
      status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: { paresStatus: 'Y', indicator: 'vbv', cavv: 'private-cavv' },
    } : { id, status: 'AUTHORIZED', orderInformation: { amountDetails: { authorizedAmount: '5353.50', currency: 'HNL' } } }));
  });
  const gateway = new CyberSourceGateway('sandbox');
  const authentication = await gateway.authenticate(input);
  const result = await gateway.pay({ ...input, authentication });
  assert.equal(result.status, 'succeeded'); assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.ok(call.url.startsWith('https://apitest.cybersource.com/'));
    assert.equal(call.body.buyerInformation.merchantCustomerId, merchantCustomerReference(input.customerId));
    assert.ok(call.body.buyerInformation.merchantCustomerId.length <= 15);
    assert.deepEqual(call.body.orderInformation.amountDetails, { totalAmount: '5353.50', currency: 'HNL' });
    assert.equal(call.body.clientReferenceInformation.code, input.reference);
  }
  assert.equal(calls[1].body.processingInformation.capture, true);
  assert.equal(input.customerId, 'manual-sandbox-customer', 'Original identity must not be mutated');
});

test('HTTP 400 with a transaction ID remains blocked, and read-only reconciliation recognizes partial authorization', async t => {
  const previous = { ...process.env };
  Object.assign(process.env, { CYBERSOURCE_MERCHANT_ID: 'unit-merchant', CYBERSOURCE_KEY_ID: '9b3e9b91-36d0-4d02-b24a-2145570032ea',
    CYBERSOURCE_SHARED_SECRET: Buffer.alloc(32, 7).toString('base64') });
  t.after(() => { process.env = previous; });
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    methods.push(String(init.method));
    if (init.method === 'GET') {
      assert.equal(String(url), `https://apitest.cybersource.com/tss/v2/transactions/${id}`);
      return new Response(JSON.stringify(failedCapture));
    }
    return new Response(JSON.stringify({ id, status: 'INVALID_REQUEST', errorInformation: { reason: 'INVALID_DATA' } }), { status: 400 });
  });
  const gateway = new CyberSourceGateway('sandbox');
  const submitted = await gateway.pay({ ...input, authentication: approvedAuth });
  assert.equal(submitted.status, 'unknown'); assert.equal(submitted.transactionId, id);
  assert.equal(submitted.gatewayStatus, 'HTTP_400');
  const result = reconcileTransaction(await gateway.getPayment(id), { transactionId: id, reference: input.reference, amount: input.amount, currency: input.currency, mode: 'payment' });
  assert.equal(result.status, 'unknown'); assert.equal(result.gatewayStatus, 'AUTHORIZED_CAPTURE_FAILED');
  assert.equal(result.reason, 'PURCHASER_CODE_INVALID');
  assert.deepEqual(methods, ['POST', 'GET'], 'Never repeat the authorization or attempt automatic capture');
});

test('customer messages distinguish bank declines, malformed requests and partial captures without provider data', () => {
  for (const language of ['es', 'en'] as const) {
    const partial = paymentFailureMessage(paymentFailureCode('PURCHASER_CODE_INVALID', 'AUTHORIZED_CAPTURE_FAILED'), undefined, language);
    assert.match(partial, language === 'es' ? /autorizada.*no se pudo completar/ : /authorized.*could not be completed/);
    assert.doesNotMatch(partial, /purchaser_code|rechazado|declined/);
    const malformed = paymentFailureMessage(paymentFailureCode('INVALID_DATA', 'HTTP_400'), undefined, language);
    assert.doesNotMatch(malformed, /CVV|security code|rechazado|declined/);
    assert.equal(paymentFailureCode('private-provider-message', 'anything'), 'PAYMENT_NOT_CONFIRMED');
    const declined = paymentFailureMessage(paymentFailureCode('DCARDREFUSED', 'AUTHORIZATION_DECLINED_203'), undefined, language);
    assert.match(declined, language === 'es' ? /rechazado/ : /declined/);
  }
});

test('partial captures and unavailable transaction searches cannot create a paid receipt', () => {
  const expected = { transactionId: id, reference: input.reference, amount: input.amount, currency: input.currency, mode: 'payment' };
  assert.equal(reconcileTransaction(failedCapture, expected).status, 'unknown');
  const confirmed = { ...failedCapture, applicationInformation: { applications: [success('ics_auth'), success('ics_bill')] } };
  assert.equal(reconcileTransaction(confirmed, expected).status, 'succeeded');
  assert.equal(reconcileTransaction(confirmed, { ...expected, reference: 'another-customer' }).status, 'unknown');
});
