import { mkdir, writeFile } from 'node:fs/promises';
import { gatewayEnvironment, gatewayEndpoints } from '../lib/cybersource/environment';
import { loadCredentials } from '../lib/pay/credentials';

async function main() {
  if (process.argv.slice(2).length) {
    console.error(JSON.stringify({ error: 'This command only checks local configuration. Live checks are disabled; use the checkout manually.', networkRequests: 0, financialRequests: 0 }));
    process.exitCode = 1;
    return;
  }
  let credentials = false;
  try { await loadCredentials('production'); credentials = true; } catch { /* Do not expose parsed credentials. */ }
  let domain = false;
  try { const url = new URL(process.env.PAY_PUBLIC_URL ?? ''); domain = url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); } catch { /* Missing URL. */ }
  const ready = credentials && domain && gatewayEnvironment() === 'production';
  const integrationConfigured=ready&&process.env.STOREGANISE_PAY_ENABLED==='true'&&
    Boolean(process.env.STOREGANISE_API_KEY&&process.env.STOREGANISE_WEBHOOK_SECRET&&process.env.CRON_SECRET);
  const result = { checkedAt: new Date().toISOString(), activeEnvironment: gatewayEnvironment(), productionApi: gatewayEndpoints('production').api,
    productionCredentials: credentials ? 'configured' : 'missing-or-invalid', publicHttpsDomain: domain,
    manualCheckoutConfigured: ready, storeganiseCode: 'invoice-handoff-and-payment-registration',
    storeganiseConfigurationPresent: integrationConfigured, storeganiseExternalHandoff: 'requires-configuration-and-validation',
    productionConnection: 'not-checked-configuration-only', networkRequests: 0, financialRequests: 0 };
  await mkdir('.private', { recursive: true });
  await writeFile('.private/production-config-latest.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!ready) process.exitCode = 1;
}
main().catch(() => { console.error(JSON.stringify({ productionConnection: 'not-verified', financialRequests: 0 })); process.exitCode = 1; });
