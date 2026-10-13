/** Official BCH TCR series; never called by the browser. */
export const BCH_RATE_URL = 'https://bchapi-am.azure-api.net/api/v1/indicadores/97/cifras';
export const BCH_MAX_AGE_DAYS = 4;
export const BCH_REFRESH_MS = 60 * 60 * 1000;

export interface BchRate {
  source: 'BCH'; hnlPerUsd: string; rateDate: string; fetchedAt: string;
}

export class ExchangeRateError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ExchangeRateError'; }
}

export function bchApiKey() {
  if (typeof window !== 'undefined') throw new ExchangeRateError('BCH_SERVER_ONLY');
  // This checkout supports only the official TCR series. Never forward its key to another endpoint.
  bchEndpoint();
  const key = process.env.BCH_API_KEY?.trim();
  if (!key || /\s/.test(key) || /^(TU_|YOUR_|CHANGE_ME|<)/i.test(key)) throw new ExchangeRateError('BCH_NOT_CONFIGURED');
  return key;
}

function bchEndpoint() {
  const url = process.env.BCH_API_URL?.trim() || BCH_RATE_URL;
  const indicator = process.env.BCH_INDICADOR_ID?.trim() || '97';
  if (url !== BCH_RATE_URL || indicator !== '97') throw new ExchangeRateError('BCH_INVALID_CONFIGURATION');
  return url;
}

function hondurasDate(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function isCurrentBchRate(rate: BchRate, now = new Date()) {
  if (!rate || typeof rate !== 'object') return false;
  const today = Date.parse(`${hondurasDate(now)}T00:00:00Z`);
  const date = Date.parse(`${rate.rateDate}T00:00:00Z`);
  const fetched = Date.parse(rate.fetchedAt);
  return rate.source === 'BCH' && /^\d{1,6}\.\d{6}$/.test(rate.hnlPerUsd) && Number(rate.hnlPerUsd) > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(rate.rateDate) && Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === rate.rateDate &&
    date <= today && today - date <= BCH_MAX_AGE_DAYS * 86400000 &&
    Number.isFinite(fetched) && fetched <= now.getTime() && now.getTime() - fetched < BCH_REFRESH_MS;
}

/** The documented series is not necessarily sorted. Future publications are not yet applicable. */
export function parseBchRate(payload: unknown, now = new Date()): BchRate {
  if (!Array.isArray(payload) || !payload.length) throw new ExchangeRateError('BCH_INVALID_RESPONSE');
  const today = hondurasDate(now);
  let selected: BchRate | undefined;
  for (const item of payload) {
    if (!item || typeof item !== 'object' || item.IndicadorId !== 97 ||
      (item.Nombre !== undefined && item.Nombre !== 'EC-TCR-01') || typeof item.Fecha !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?Z?$/.test(item.Fecha)) throw new ExchangeRateError('BCH_INVALID_RESPONSE');
    const rateDate = item.Fecha.slice(0, 10);
    // Live BCH sends calendar dates without Z; never interpret them in the server's local timezone.
    const parsedDate = Date.parse(`${rateDate}T00:00:00Z`);
    if (!Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== rateDate) throw new ExchangeRateError('BCH_INVALID_RESPONSE');
    const value = typeof item.Valor === 'number' || typeof item.Valor === 'string' ? String(item.Valor) : '';
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(value) || Number(value) <= 0) throw new ExchangeRateError('BCH_INVALID_RATE');
    if (rateDate > today) continue;
    const candidate: BchRate = { source: 'BCH', hnlPerUsd: Number(value).toFixed(6), rateDate, fetchedAt: now.toISOString() };
    if (selected && selected.rateDate === rateDate && selected.hnlPerUsd !== candidate.hnlPerUsd) throw new ExchangeRateError('BCH_CONFLICTING_RATES');
    if (!selected || rateDate > selected.rateDate) selected = candidate;
  }
  if (!selected || !isCurrentBchRate(selected, now)) throw new ExchangeRateError('BCH_RATE_OUTDATED');
  return selected;
}

export async function fetchBchRate(): Promise<BchRate> {
  const key = bchApiKey();
  const url = bchEndpoint();
  let response: Response;
  try {
    // BCH's WWW-Authenticate explicitly specifies name="clave", type="header".
    response = await fetch(url, { method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { clave: key, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  } catch { throw new ExchangeRateError('BCH_UNAVAILABLE'); }
  if (!response.ok) throw new ExchangeRateError(response.status === 401 || response.status === 403 ? 'BCH_UNAUTHORIZED' : 'BCH_UNAVAILABLE');
  let data: unknown;
  try { data = await response.json(); } catch { throw new ExchangeRateError('BCH_INVALID_RESPONSE'); }
  return parseBchRate(data);
}
