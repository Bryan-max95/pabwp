import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { GatewayCredentials } from '../pay/credentials';

// Explicitly armed by the local diagnostic script for ONE reference, for ten minutes.
// No public endpoint can enable this, and production never reads the control file.
export const AUTHORIZATION_AUDIT_CONTROL = path.join('.private', 'authorization-audit-control.json');
export const authorizationAuditPath = (runId: string) => path.join('.private', `authorization-audit-${runId}.json`);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const visibleFields = new Set([
  'clientReferenceInformation.code', 'processingInformation.capture', 'processingInformation.commerceIndicator',
  'paymentInformation.card.type', 'orderInformation.amountDetails.totalAmount', 'orderInformation.amountDetails.currency',
  'acquirerInformation.merchantId', 'acquirerInformation.acquirerMerchantId', 'acquirerInformation.acquirerBin',
  'consumerAuthenticationInformation.paSpecificationVersion', 'consumerAuthenticationInformation.ucafCollectionIndicator',
  'consumerAuthenticationInformation.eciRaw', 'consumerAuthenticationInformation.paresStatus',
]);

/** Preserve JSON structure; disclose only the explicit non-secret diagnostic fields. */
export function redactAuthorizationBody(value: unknown, field = ''): unknown {
  if (Array.isArray(value)) return value.map(item => redactAuthorizationBody(item, `${field}[]`));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactAuthorizationBody(item, field ? `${field}.${key}` : key)]));
  }
  return visibleFields.has(field) ? value : '[REDACTED]';
}

/** Independently checks the exact serialized bytes/headers that will be passed to fetch. */
export function inspectAuthorizationRequest(raw: string, headers: Headers, config: GatewayCredentials) {
  const body = JSON.parse(raw);
  const signatureHeader = headers.get('signature') ?? '';
  const signedHeaders = /headers="([^"]+)"/.exec(signatureHeader)?.[1] ?? '';
  const keyId = /keyid="([^"]+)"/.exec(signatureHeader)?.[1];
  const receivedSignature = /signature="([^"]+)"/.exec(signatureHeader)?.[1];
  const digest = `SHA-256=${crypto.createHash('sha256').update(raw).digest('base64')}`;
  const signatureInput = signedHeaders.split(' ').map(name => `${name}: ${name === '(request-target)' ? 'post /pts/v2/payments' : headers.get(name)}`).join('\n');
  const expectedSignature = crypto.createHmac('sha256', Buffer.from(config.sharedSecret, 'base64')).update(signatureInput).digest('base64');
  const fields = ['merchantId', 'acquirerMerchantId', 'acquirerBin'];
  return {
    environment: 'sandbox', endpoint: 'https://apitest.cybersource.com/pts/v2/payments',
    configuredMerchantId: config.merchantId, merchantIdSent: headers.get('v-c-merchant-id'),
    host: headers.get('host'), dateHeader: headers.has('v-c-date') ? 'v-c-date' : 'date',
    requestDate: headers.get('v-c-date') ?? headers.get('date'), keyId, sharedSecret: config.sharedSecret ? 'LOADED' : 'NOT LOADED', signedHeaders,
    checks: {
      sandboxHost: headers.get('host') === 'apitest.cybersource.com', merchantMatchesConfigured: headers.get('v-c-merchant-id') === config.merchantId,
      keyIdMatchesConfigured: keyId === config.keyId, digestMatchesBody: headers.get('digest') === digest,
      signatureMatchesRequest: receivedSignature === expectedSignature, modernDateHeader: headers.has('v-c-date'),
      acquirerInformationPresent: Object.hasOwn(body, 'acquirerInformation'),
      emptyAcquirerFields: fields.filter(key => body.acquirerInformation && Object.hasOwn(body.acquirerInformation, key) &&
        (body.acquirerInformation[key] === null || String(body.acquirerInformation[key]).trim() === '')),
    },
    body: redactAuthorizationBody(body),
  };
}

export function safeAuthorizationResponse(http: number, data: unknown) {
  const body = data && typeof data === 'object' ? data as Record<string, any> : {};
  const code = (value: unknown) => typeof value === 'string' && /^[A-Z0-9_ -]{1,100}$/.test(value) ? value : undefined;
  return { http, transactionId: typeof body.id === 'string' && /^\d{12,30}$/.test(body.id) ? body.id : undefined,
    status: code(body.status), reason: code(body.errorInformation?.reason ?? body.reason),
    processorResponseCode: code(body.processorInformation?.responseCode) };
}

export async function startAuthorizationAudit(raw: string, headers: Headers, config: GatewayCredentials) {
  try {
    if (process.env.NODE_ENV !== 'development' || process.env.PAY_DEMO_ENABLED !== 'true' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.PAY_PUBLIC_URL ?? '').hostname)) return;
    const control = JSON.parse(await fs.readFile(AUTHORIZATION_AUDIT_CONTROL, 'utf8'));
    const body = JSON.parse(raw);
    if (!uuid.test(control.runId ?? '') || !Number.isFinite(control.expiresAt) || control.expiresAt <= Date.now() ||
      control.expiresAt > Date.now() + 600_000 || body.clientReferenceInformation?.code !== control.reference ||
      body.orderInformation?.amountDetails?.totalAmount !== '100.00' || body.orderInformation?.amountDetails?.currency !== 'HNL' ||
      !/^RSS-[a-f0-9-]{36}-1$/.test(control.reference ?? '')) return;
    const record = { runId: control.runId, createdAt: new Date().toISOString(), request: inspectAuthorizationRequest(raw, headers, config) };
    const target = authorizationAuditPath(control.runId);
    // A duplicate request cannot overwrite the first request's evidence.
    await fs.writeFile(target, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
    return async (http: number, data: unknown) => {
      try { await fs.writeFile(target, JSON.stringify({ ...record, response: safeAuthorizationResponse(http, data) }, null, 2), { mode: 0o600 }); }
      catch { /* Diagnostics must never trigger another payment or change its outcome. */ }
    };
  } catch { return; /* Disabled/missing audit or storage failure has no effect on payments. */ }
}
