import test from 'node:test';
import assert from 'node:assert/strict';
import { BCH_RATE_URL, fetchBchRate, isCurrentBchRate, parseBchRate, ExchangeRateError } from '../lib/pay/bch';

const now = new Date('2026-10-09T15:00:00Z');
const point = (date: string, value: unknown = 26.5) => ({ IndicadorId: 97, Nombre: 'EC-TCR-01', Fecha: `${date}T00:00:00Z`, Valor: value });

test('latest published applicable BCH observation wins regardless of order', () => {
  const rate = parseBchRate([point('2026-10-08'), point('2026-10-10', 27), point('2026-10-09', 26.6), point('2026-10-07')], now);
  assert.deepEqual(rate, { source: 'BCH', hnlPerUsd: '26.600000', rateDate: '2026-10-09', fetchedAt: now.toISOString() });
  assert.equal(isCurrentBchRate(rate, now), true);
  assert.equal(isCurrentBchRate(rate, new Date(now.getTime() + 3600000)), false, 'Refresh after one hour');
  assert.equal(isCurrentBchRate(rate, new Date(now.getTime() - 1)), false, 'No future cache timestamps');
});

test('Honduras calendar controls applicability, with bounded weekend/holiday tolerance', () => {
  const beforeMidnight = new Date('2026-10-10T05:59:00Z');
  assert.equal(parseBchRate([point('2026-10-09'), point('2026-10-10')], beforeMidnight).rateDate, '2026-10-09');
  assert.equal(parseBchRate([point('2026-10-05')], now).rateDate, '2026-10-05');
  for (const data of [[point('2026-10-04')], [point('2026-10-10')], [point('2024-03-09')]]) {
    assert.throws(() => parseBchRate(data, now), /BCH_RATE_OUTDATED/);
  }
});

test('live BCH dates without timezone and duplicate observations preserve the publication day', () => {
  const actual = { IndicadorId: 97, Nombre: 'EC-TCR-01', Fecha: '2026-10-07T00:00:00', Valor: 26.8883 };
  for (const date of ['2026-10-07T00:00:00', '2026-10-07T00:00:00.000', '2026-10-07T00:00:00Z']) {
    const rate = parseBchRate([{ ...actual, Fecha: date }, actual], now);
    assert.equal(rate.rateDate, '2026-10-07'); assert.equal(rate.hnlPerUsd, '26.888300');
  }
  for (const date of ['2026-02-30T00:00:00', '2026-10-07T12:00:00', '2026-10-07T00:00:00+06:00']) {
    assert.throws(() => parseBchRate([{ ...actual, Fecha: date }], now), /BCH_INVALID_RESPONSE/);
  }
});

test('invalid data, wrong series, conflicting rates and pagination envelopes fail closed', () => {
  for (const data of [null, {}, [], { data: [point('2026-10-09')] },
    [{ ...point('2026-10-09'), IndicadorId: 98 }], [{ ...point('2026-10-09'), Nombre: 'OTHER' }],
    [point('2026-02-30')], [point('2026-10-09', null)], [point('2026-10-09', 0)],
    [point('2026-10-09', '26,5')], [point('2026-10-09', '26.1234567')],
    [point('2026-10-09', 26), point('2026-10-09', 27)]]) assert.throws(() => parseBchRate(data, now), ExchangeRateError);
});

test('BCH client uses clave only on official server and sanitizes every failure', async t => {
  const saved = process.env.BCH_API_KEY;
  t.after(() => { if (saved === undefined) delete process.env.BCH_API_KEY; else process.env.BCH_API_KEY = saved; });
  process.env.BCH_API_KEY = 'private-test-key';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa' }).format(new Date());
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, BCH_RATE_URL); assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('clave'), 'private-test-key');
    assert.ok(init?.signal); assert.equal(init?.body, undefined);
    return new Response(JSON.stringify([point(today)]));
  });
  assert.equal((await fetchBchRate()).hnlPerUsd, '26.500000');
  for (const mode of ['unauthorized', 'limit', 'network', 'json']) {
    fetchMock.mock.mockImplementation(async () => {
      if (mode === 'network') throw new Error('private-test-key');
      return new Response('private-test-key', { status: mode === 'unauthorized' ? 401 : mode === 'limit' ? 429 : 200 });
    });
    await assert.rejects(fetchBchRate(), error => error instanceof ExchangeRateError && !error.message.includes('private-test-key'));
  }
  const calls = fetchMock.mock.callCount();
  for (const key of ['', 'TU_SECRETO', 'invalid key']) {
    process.env.BCH_API_KEY = key;
    await assert.rejects(fetchBchRate(), /BCH_NOT_CONFIGURED/);
  }
  assert.equal(fetchMock.mock.callCount(), calls);
});

test('configured URL and indicator cannot redirect the subscription key or select another series', async t => {
  const names = ['BCH_API_KEY', 'BCH_API_URL', 'BCH_INDICADOR_ID'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  });
  Object.assign(process.env, { BCH_API_KEY: 'private-test-key', BCH_API_URL: BCH_RATE_URL, BCH_INDICADOR_ID: '97' });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 401 }));
  await assert.rejects(fetchBchRate(), /BCH_UNAUTHORIZED/);
  assert.equal(fetchMock.mock.callCount(), 1, 'Configured official endpoint is used');
  for (const url of ['https://example.com/api/v1/indicadores/97/cifras', BCH_RATE_URL + '?subscription-key=test', BCH_RATE_URL.replace('/97/', '/98/')]) {
    process.env.BCH_API_URL = url;
    await assert.rejects(fetchBchRate(), /BCH_INVALID_CONFIGURATION/);
  }
  process.env.BCH_API_URL = BCH_RATE_URL;
  process.env.BCH_INDICADOR_ID = '98';
  await assert.rejects(fetchBchRate(), /BCH_INVALID_CONFIGURATION/);
  assert.equal(fetchMock.mock.callCount(), 1);
});
