export class StoreganiseApiError extends Error {
  constructor(readonly code: string, readonly status?: number) {
    super(status ? `Storeganise ${code} (HTTP ${status})` : `Storeganise ${code}`);
    this.name = 'StoreganiseApiError';
  }
}

export function storeganiseConfiguration() {
  if (typeof window !== 'undefined') throw new StoreganiseApiError('SERVER_ONLY');
  const configured = process.env.STOREGANISE_API_URL?.trim();
  const key = process.env.STOREGANISE_API_KEY?.trim();
  if (!configured || !key || /\s/.test(key) || /^(TU_|YOUR_|CHANGE_ME|<)/i.test(key)) {
    throw new StoreganiseApiError('CONFIGURATION_MISSING_OR_INVALID');
  }
  let url: URL;
  try { url = new URL(configured); }
  catch { throw new StoreganiseApiError('INVALID_API_URL'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.storeganise\.(com|dev)$/.test(url.hostname) ||
    url.port || url.username || url.password || url.search || url.hash || !/^\/api\/v1\/admin\/?$/.test(url.pathname)) {
    throw new StoreganiseApiError('INVALID_API_URL');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  return { url, key };
}

/** Fixed operator origin only. Never send the key to an event-supplied apiUrl. */
export async function storeganiseRequest<T>(resource: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown): Promise<T> {
  const { url: base, key } = storeganiseConfiguration();
  if (!resource.startsWith('/') || resource.startsWith('//') || /[\s\\]/.test(resource)) {
    throw new StoreganiseApiError('INVALID_RESOURCE');
  }
  const url = new URL(base.href + resource);
  if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}/`) || url.hash) {
    throw new StoreganiseApiError('INVALID_RESOURCE');
  }
  let response: Response;
  try {
    response = await fetch(url, { method, redirect: 'error', cache: 'no-store',
      headers: { Authorization: `ApiKey ${key}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
  } catch { throw new StoreganiseApiError('NETWORK_ERROR'); }
  if (!response.ok) throw new StoreganiseApiError('REQUEST_FAILED', response.status);
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; }
  catch { throw new StoreganiseApiError('INVALID_RESPONSE', response.status); }
}

export const storeganiseGet = <T>(resource: string) => storeganiseRequest<T>(resource);

