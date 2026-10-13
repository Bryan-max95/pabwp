import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { storeganiseGet, StoreganiseApiError } from '../lib/storeganise/client';

function fixture(t: TestContext) {
  const values = { STOREGANISE_API_URL: 'https://unit-test.storeganise.com/api/v1/admin', STOREGANISE_API_KEY: 'unit-test-private-key' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, values);
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  return values;
}

test('Storeganise client authenticates server-side reads and rejects redirects', async t => {
  const config = fixture(t);
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), `${config.STOREGANISE_API_URL}/settings`);
    assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('authorization'), `ApiKey ${config.STOREGANISE_API_KEY}`);
    return new Response(JSON.stringify({ code: 'unit-test', currencyCode: 'HNL' }));
  };
  assert.deepEqual(await storeganiseGet('/settings'), { code: 'unit-test', currencyCode: 'HNL' });
  assert.equal(calls, 1);
});

test('invalid origins, placeholders and traversal never send the Storeganise credential', async t => {
  const config = fixture(t);
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected request'); };
  for (const url of ['http://unit-test.storeganise.com/api/v1/admin', 'https://attacker.example/api/v1/admin',
    'https://unit-test.storeganise.com.attacker.example/api/v1/admin',
    'https://private:secret@unit-test.storeganise.com/api/v1/admin',
    'https://unit-test.storeganise.com/api/v1/admin?key=secret', 'not-a-url']) {
    process.env.STOREGANISE_API_URL = url;
    await assert.rejects(storeganiseGet('/settings'), StoreganiseApiError);
  }
  process.env.STOREGANISE_API_URL = config.STOREGANISE_API_URL;
  for (const resource of ['https://attacker.example', '//attacker.example', '/../settings', '/%2e%2e/settings', '/settings#fragment', '/settings\r\nheader']) {
    await assert.rejects(storeganiseGet(resource), StoreganiseApiError);
  }
  for (const key of ['', 'TU_API_KEY', 'invalid key']) {
    process.env.STOREGANISE_API_KEY = key;
    await assert.rejects(storeganiseGet('/settings'), StoreganiseApiError);
  }
  assert.equal(calls, 0);
});

test('provider and network errors never disclose raw bodies or secrets', async t => {
  const config = fixture(t);
  for (const kind of ['provider', 'network', 'invalid-json']) {
    globalThis.fetch = async () => {
      if (kind === 'network') throw new Error(config.STOREGANISE_API_KEY);
      return new Response(config.STOREGANISE_API_KEY, { status: kind === 'provider' ? 403 : 200 });
    };
    await assert.rejects(storeganiseGet('/settings'), error => {
      assert.ok(error instanceof StoreganiseApiError);
      assert.equal(error.message.includes(config.STOREGANISE_API_KEY), false);
      if (kind === 'provider') assert.equal(error.status, 403);
      return true;
    });
  }
});
