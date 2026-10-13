import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { loadCredentials } from '../lib/pay/credentials';
import { verifySignature } from '../lib/storeganise/verify-signature';
import { CyberSourceGateway } from '../lib/cybersource/gateway';

test('CyberSource uses only private environment credentials and fails closed without leaking values', async () => {
  const values = { CYBERSOURCE_MERCHANT_ID: 'unit-test-only', CYBERSOURCE_KEY_ID: crypto.randomUUID(),
    CYBERSOURCE_SHARED_SECRET: crypto.randomBytes(32).toString('base64'), DATABASE_URL: 'invalid-must-not-use-database' };
  const names = ['CYBERSOURCE_MERCHANT_ID', 'CYBERSOURCE_KEY_ID', 'CYBERSOURCE_SHARED_SECRET'] as const;
  const previous = Object.fromEntries([...Object.keys(values), 'PAY_CREDENTIALS_ENCRYPTION_KEY'].map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    delete process.env.PAY_CREDENTIALS_ENCRYPTION_KEY;
    assert.deepEqual(await loadCredentials(), { merchantId: values.CYBERSOURCE_MERCHANT_ID,
      keyId: values.CYBERSOURCE_KEY_ID, sharedSecret: values.CYBERSOURCE_SHARED_SECRET });
    for (const name of names) {
      for (const invalid of [undefined, '', 'private-invalid-value!']) {
        if (invalid === undefined) delete process.env[name]; else process.env[name] = invalid;
        await assert.rejects(loadCredentials(), error => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(name));
          for (const value of [...Object.values(values), 'private-invalid-value!']) assert.equal(error.message.includes(value), false);
          return true;
        });
      }
      process.env[name] = values[name];
    }
    const replacement = crypto.randomUUID();
    process.env.CYBERSOURCE_KEY_ID = replacement;
    assert.equal((await loadCredentials()).keyId, replacement, 'No cached or database key replaces the configured value');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('Storeganise authenticates raw body Base64 only and rejects missing secret', async () => {
  const secret = 'unit-test-secret-not-for-production';
  const raw = '{"type":"billing.checkout","data":{"userId":"demo"}}';
  process.env.STOREGANISE_WEBHOOK_SECRET = secret;
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const request = new NextRequest('https://localhost/api/storeganise/billing', { headers: { 'sg-signature': signature } });
  assert.equal(await verifySignature(request, raw), true);
  assert.equal(await verifySignature(request, raw + ' '), false);
  assert.equal(await verifySignature(new NextRequest('https://localhost'), raw), false);
  delete process.env.STOREGANISE_WEBHOOK_SECRET;
  assert.equal(await verifySignature(request, raw), false);
  for (const placeholder of ['TU_SECRETO_WEBHOOK_REAL', 'YOUR_WEBHOOK_SECRET', '<webhook-secret>']) {
    process.env.STOREGANISE_WEBHOOK_SECRET = placeholder;
    const forged = crypto.createHmac('sha256', placeholder).update(raw).digest('base64');
    assert.equal(await verifySignature(new NextRequest('https://localhost', { headers: { 'sg-signature': forged } }), raw), false);
  }
  delete process.env.STOREGANISE_WEBHOOK_SECRET;
});

test('payment token is verified with its session capture key; cross-session and forged tokens fail', async () => {
  const signing = await generateKeyPair('RS256', { extractable: true });
  const sessionA = await generateKeyPair('RS256', { extractable: true });
  const sessionB = await generateKeyPair('RS256', { extractable: true });
  const capture = async (key: CryptoKey) => new SignJWT({ flx: { jwk: await exportJWK(key) } })
    .setProtectedHeader({ alg: 'RS256', kid: 'unit-test-capture-key' }).setIssuedAt().setExpirationTime('15m').sign(signing.privateKey);
  const captureA = await capture(sessionA.publicKey), captureB = await capture(sessionB.publicKey);
  const paymentToken = await new SignJWT({ content: { paymentInformation: { card: { number: { detectedCardTypes: ['001'], maskedValue: 'XXXXXXXXXXXX1111' } } } } })
    .setProtectedHeader({ alg: 'RS256' }).setJti('unit-test-token').setIssuedAt().setExpirationTime('5m').sign(sessionA.privateKey);
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(await exportJWK(signing.publicKey)), { status: 200 });
  try {
    const gateway = new CyberSourceGateway();
    const verified = await gateway.verifyTransientToken(paymentToken, captureA);
    assert.equal(verified.brand, 'Visa'); assert.equal(verified.last4, '1111');
    await assert.rejects(gateway.verifyTransientToken(paymentToken, captureB));
    const pieces = paymentToken.split('.'); pieces[1] = Buffer.from('{"jti":"forged"}').toString('base64url');
    await assert.rejects(gateway.verifyTransientToken(pieces.join('.'), captureA));
  } finally { globalThis.fetch = savedFetch; }
});
