import { gatewayEnvironment } from '../cybersource/environment';
import { storeganiseConfiguration } from './client';

export class StoreganiseIntegrationError extends Error {
  constructor(readonly code: string, readonly httpStatus = 409) { super(code); this.name = 'StoreganiseIntegrationError'; }
}

export function assertStoreganiseEnabled() {
  if (process.env.STOREGANISE_PAY_ENABLED !== 'true') throw new StoreganiseIntegrationError('STOREGANISE_PAY_DISABLED', 503);
  const { url } = storeganiseConfiguration();
  if (gatewayEnvironment() === 'sandbox' && !url.hostname.endsWith('.storeganise.dev')) {
    // A fake bank approval must never pay a real invoice or activate a real unit.
    throw new StoreganiseIntegrationError('STOREGANISE_SANDBOX_INSTANCE_REQUIRED', 503);
  }
  if (gatewayEnvironment() === 'production' && !url.hostname.endsWith('.storeganise.com')) {
    throw new StoreganiseIntegrationError('STOREGANISE_INSTANCE_ENVIRONMENT_MISMATCH', 503);
  }
  return { url, environment: gatewayEnvironment() };
}

export function validateEventOrigin(apiUrl: unknown) {
  if (apiUrl === undefined) return; // Standard account webhooks omit apiUrl.
  const { url } = storeganiseConfiguration();
  let candidate: URL;
  try { candidate = new URL(String(apiUrl)); } catch { throw new StoreganiseIntegrationError('INVALID_STOREGANISE_ORIGIN', 403); }
  if (candidate.origin !== url.origin || candidate.username || candidate.password ||
    !['/api', '/api/', '/api/v1/admin', '/api/v1/admin/'].includes(candidate.pathname) || candidate.search || candidate.hash) {
    throw new StoreganiseIntegrationError('INVALID_STOREGANISE_ORIGIN', 403);
  }
}

export function storeganiseReturnUrl(value?: string): string {
  const { url } = storeganiseConfiguration();
  const fallback = new URL('/', url.origin).href;
  if (!value) return fallback;
  let candidate: URL;
  try { candidate = new URL(value); } catch { return fallback; }
  if (candidate.origin !== url.origin || candidate.username || candidate.password ||
    candidate.pathname.startsWith('/api/') || candidate.pathname.startsWith('/admin')) return fallback;
  return candidate.href;
}
