import crypto from 'node:crypto';
import { loadCredentials } from '../lib/pay/credentials';
import { closeDatabase } from '../lib/pay/db';

/** Empty, signed requests verify routing only. They contain no payment instrument and cannot charge. */
async function main() {
  const config = await loadCredentials('sandbox');
  for (const path of ['/pts/v2/payments', '/pts/v2/payments/', '/risk/v1/authentications']) {
    const host = 'apitest.cybersource.com', date = new Date().toUTCString(), raw = '{}';
    const digest = `SHA-256=${crypto.createHash('sha256').update(raw).digest('base64')}`;
    const signing = `host: ${host}\ndate: ${date}\n(request-target): post ${path}\ndigest: ${digest}\nv-c-merchant-id: ${config.merchantId}`;
    const signature = crypto.createHmac('sha256', Buffer.from(config.sharedSecret, 'base64')).update(signing).digest('base64');
    const response = await fetch(`https://${host}${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Accept: process.argv.includes('--strict-json') ? 'application/json' : '*/*', Host: host, Date: date, Digest: digest, 'v-c-merchant-id': config.merchantId, 'Content-Type': 'application/json',
        Signature: `keyid="${config.keyId}", algorithm="HmacSHA256", headers="host date (request-target) digest v-c-merchant-id", signature="${signature}"` }, body: raw });
    const text = await response.text();
    let info: Record<string, any> = {};
    try { info = JSON.parse(text); } catch { /* HTML body is never dumped. */ }
    console.log(JSON.stringify({ path, status: response.status, contentType: response.headers.get('content-type'), keys: Object.keys(info),
      reason: info.reason ?? info.errorInformation?.reason ?? info.response?.rmsg,
      fields: (info.details ?? info.errorInformation?.details ?? []).map((entry: { field?: string }) => entry.field) }));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.name : 'Error'); process.exitCode = 1; }).finally(closeDatabase);
