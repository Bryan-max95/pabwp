import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { inspectAuthorizationRequest, redactAuthorizationBody, safeAuthorizationResponse } from '../lib/cybersource/authorization-audit';
import { CyberSourceGateway } from '../lib/cybersource/gateway';
import type { AuthenticationCheckInput } from '../lib/cybersource/types';

function sandboxCredentials(t: TestContext) {
  const config = { merchantId: 'unit-merchant', keyId: crypto.randomUUID(), sharedSecret: crypto.randomBytes(32).toString('base64') };
  const values = { CYBERSOURCE_MERCHANT_ID: config.merchantId, CYBERSOURCE_KEY_ID: config.keyId,
    CYBERSOURCE_SHARED_SECRET: config.sharedSecret, DATABASE_URL: 'invalid-must-not-use-database' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  return config;
}

test('authorization uses v-c-date and signs the actual body; setup keeps its working headers', async t => {
  const config = sandboxCredentials(t);
  // No database connection or provider calls. Exercise the actual gateway serialization.
  const savedFetch = globalThis.fetch;
  const requests: Array<{ url: string; raw: string; headers: Headers }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), raw: String(init?.body), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(String(url).endsWith('/authentication-setups') ? {
      id: '7900000000000000000001', status: 'COMPLETED', consumerAuthenticationInformation: {
        referenceId: 'test-reference', accessToken: 'test-not-real', deviceDataCollectionUrl: 'https://centinelapistag.cardinalcommerce.com/test',
      },
    } : { id: '7900000000000000000002', status: 'SERVER_ERROR', reason: 'SYSTEM_ERROR' }),
    { status: String(url).endsWith('/authentication-setups') ? 200 : 502 });
  };
  const token = { tokenJwt: 'secret-token-jwt', tokenId: 'secret-jti', cardType: '001' as const, brand: 'Visa' as const, expiresAt: '2030-01-01' };
  try {
    const gateway = new CyberSourceGateway();
    await gateway.setupAuthentication(token, 'unit-reference');
    const result = await gateway.pay({ token, reference: 'unit-reference', amount: '1.00', currency: 'USD', customerId: 'unit-customer',
      billTo: { firstName: 'Private', lastName: 'Name', address1: 'Private address', locality: 'Miami', country: 'US', email: 'private@example.com' },
      device: { httpAcceptContent: '*/*', httpBrowserLanguage: 'es', httpBrowserJavaEnabled: false, httpBrowserJavaScriptEnabled: true,
        httpBrowserColorDepth: 24, httpBrowserScreenHeight: 800, httpBrowserScreenWidth: 1200, httpBrowserTimeDifference: 0, userAgentBrowserValue: 'unit' },
      authentication: { status: 'authenticated', gatewayStatus: 'AUTHENTICATION_SUCCESSFUL', commerceIndicator: 'vbv', authentication: { cavv: 'secret-cavv', xid: 'secret-xid', paSpecificationVersion: '2.2.0', eciRaw: '05', paresStatus: 'Y' } } });
    assert.equal(result.status, 'unknown', '502 must not become approval or safe-to-retry decline');
    assert.equal(result.transactionId, '7900000000000000000002');
    assert.equal(requests.length, 2);
    assert.ok(requests[0].headers.has('date')); assert.equal(requests[0].headers.has('v-c-date'), false);
    const payment = requests[1];
    assert.equal(payment.url, 'https://apitest.cybersource.com/pts/v2/payments');
    assert.ok(payment.headers.has('v-c-date')); assert.equal(payment.headers.has('date'), false);
    const audit = inspectAuthorizationRequest(payment.raw, payment.headers, config);
    assert.equal(audit.signedHeaders, 'host v-c-date (request-target) digest v-c-merchant-id');
    assert.equal(audit.checks.signatureMatchesRequest, true); assert.equal(audit.checks.digestMatchesBody, true);
    assert.equal(audit.checks.merchantMatchesConfigured, true); assert.equal(audit.checks.acquirerInformationPresent, false);
    assert.deepEqual(audit.checks.emptyAcquirerFields, []);
    assert.equal(inspectAuthorizationRequest(payment.raw.replace('1.00', '2.00'), payment.headers, config).checks.digestMatchesBody, false);
    const changedHeaders = new Headers(payment.headers); changedHeaders.set('v-c-merchant-id', 'different-merchant');
    const changed = inspectAuthorizationRequest(payment.raw, changedHeaders, config);
    assert.equal(changed.checks.merchantMatchesConfigured, false); assert.equal(changed.checks.signatureMatchesRequest, false);
    const safe = JSON.stringify(audit);
    for (const secret of [config.sharedSecret, 'secret-token-jwt', 'secret-jti', 'secret-cavv', 'secret-xid', 'private@example.com']) assert.equal(safe.includes(secret), false);
    assert.equal(JSON.parse(payment.raw).tokenInformation.jti, token.tokenId, 'Redaction must not mutate outgoing token');
  } finally { globalThis.fetch = savedFetch; }
});

test('enrollment and challenge validation forward documented 3DS proof fields to Payments', async t => {
  sandboxCredentials(t);
  const savedFetch = globalThis.fetch;
  const gateway = new CyberSourceGateway();
  try {
    for (const fixture of [
      { cardType: '001', brand: 'Visa', eciRaw: '05', indicator: 'vbv', cavv: 'private-cavv' },
      { cardType: '002', brand: 'Mastercard', eciRaw: '02', indicator: 'spa', ucafAuthenticationData: 'private-ucaf', ucafCollectionIndicator: '2' },
      { cardType: '003', brand: 'American Express', eciRaw: '05', indicator: 'aesk', cavv: 'private-cavv' },
    ] as const) {
      for (const phase of ['enrollment', 'validation'] as const) {
        await t.test(`${fixture.brand}: ${phase}`, async () => {
          const { cardType, brand, ...proof } = fixture;
          const providerProof = { ...proof, paresStatus: 'Y', specificationVersion: '2.2.0',
            xid: 'private-xid', directoryServerTransactionId: 'private-ds-id', authenticationTransactionId: 'private-auth-id' };
          const requests: Array<{ url: string; body: Record<string, any> }> = [];
          globalThis.fetch = async (url, init) => {
            requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
            if (String(url).endsWith('/pts/v2/payments')) return new Response(JSON.stringify({
              id: '7900000000000000000002', status: 'SERVER_ERROR', reason: 'SYSTEM_ERROR',
            }), { status: 502 });
            return new Response(JSON.stringify({ id: '7900000000000000000001', status: 'AUTHENTICATION_SUCCESSFUL', consumerAuthenticationInformation: providerProof }));
          };
          const input: AuthenticationCheckInput = {
            token: { tokenJwt: 'private-jwt', tokenId: 'private-jti', cardType, brand, expiresAt: '2030-01-01' },
            reference: 'unit-reference', referenceId: 'unit-ddc-reference', returnUrl: 'http://localhost/unit-return',
            amount: '150.00', currency: 'HNL', customerId: 'unit-customer',
            billTo: { firstName: 'Private', lastName: 'Name', address1: 'Private address', locality: 'Miami', country: 'US', email: 'private@example.com' },
            device: { httpAcceptContent: '*/*', httpBrowserLanguage: 'es', httpBrowserJavaEnabled: false, httpBrowserJavaScriptEnabled: true,
              httpBrowserColorDepth: 24, httpBrowserScreenHeight: 800, httpBrowserScreenWidth: 1200, httpBrowserTimeDifference: 0, userAgentBrowserValue: 'unit' },
          };
          const authentication = phase === 'enrollment' ? await gateway.authenticate(input) :
            await gateway.validateAuthentication({ token: input.token, reference: input.reference, authenticationTransactionId: 'private-auth-id' });
          const result = await gateway.pay({ ...input, authentication });
          assert.equal(requests.length, 2, 'One authentication and one financial request');
          assert.ok(requests[0].url.endsWith(phase === 'enrollment' ? '/risk/v1/authentications' : '/risk/v1/authentication-results'));
          const payment = requests[1].body;
          assert.deepEqual(payment.orderInformation.amountDetails, { totalAmount: '150.00', currency: 'HNL' });
          if (phase === 'enrollment') assert.deepEqual(requests[0].body.orderInformation.amountDetails, payment.orderInformation.amountDetails);
          const { specificationVersion, indicator, ...expectedProof } = providerProof;
          assert.deepEqual(payment.consumerAuthenticationInformation, { ...expectedProof, paSpecificationVersion: specificationVersion });
          assert.equal(Object.hasOwn(payment.consumerAuthenticationInformation, 'specificationVersion'), false);
          assert.equal(payment.processingInformation.commerceIndicator, indicator);
          assert.equal(payment.tokenInformation.jti, input.token.tokenId);
          assert.equal(Object.hasOwn(payment, 'acquirerInformation'), false);
          assert.equal(result.status, 'unknown', 'Successful 3DS must not turn a financial error into success');
          const safe = JSON.stringify(redactAuthorizationBody(payment));
          for (const secret of ['private-cavv', 'private-ucaf', 'private-xid', 'private-ds-id', 'private-auth-id', 'private-jti']) assert.equal(safe.includes(secret), false);
          const safeProof = (redactAuthorizationBody(payment) as typeof payment).consumerAuthenticationInformation;
          assert.equal(safeProof.paSpecificationVersion, '2.2.0');
          assert.equal(safeProof.eciRaw, fixture.eciRaw);
          assert.equal(safeProof.paresStatus, 'Y');
        });
      }
    }
  } finally { globalThis.fetch = savedFetch; }
});

test('diagnostic redaction defaults to hiding unknown values and preserves empty acquirer evidence', () => {
  const body = { acquirerInformation: { merchantId: '', acquirerMerchantId: null }, unknown: 'unrecognized-secret',
    paymentInformation: { card: { number: '4111111111111111', securityCode: '999' } }, tokenInformation: { jti: 'secret' } };
  const redacted = redactAuthorizationBody(body) as typeof body;
  assert.equal(redacted.acquirerInformation.merchantId, ''); assert.equal(redacted.acquirerInformation.acquirerMerchantId, null);
  const output = JSON.stringify(redacted);
  for (const value of ['unrecognized-secret', '4111111111111111', '999', 'secret']) assert.equal(output.includes(value), false);
  assert.deepEqual(safeAuthorizationResponse(502, { id: '7900000000000000000002', status: 'SERVER_ERROR', reason: 'SYSTEM_ERROR', message: 'private-secret', token: 'private-token' }),
    { http: 502, transactionId: '7900000000000000000002', status: 'SERVER_ERROR', reason: 'SYSTEM_ERROR', processorResponseCode: undefined });
});
