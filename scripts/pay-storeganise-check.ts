import { storeganiseGet, StoreganiseApiError } from '../lib/storeganise/client';
import { gatewayEnvironment } from '../lib/cybersource/environment';

async function main() {
  const settings = await storeganiseGet<Record<string, unknown>>('/settings');
  if (!settings || Array.isArray(settings) || typeof settings !== 'object' || typeof settings.code !== 'string') {
    throw new StoreganiseApiError('INVALID_SETTINGS_RESPONSE');
  }
  const secret = process.env.STOREGANISE_WEBHOOK_SECRET?.trim();
  const webhookConfigured = Boolean(secret && !/^(TU_|YOUR_|CHANGE_ME|<)/i.test(secret));
  const key = process.env.BCH_API_KEY?.trim();
  const rateConfigured = Boolean(key && !/\s/.test(key) && !/^(TU_|YOUR_|CHANGE_ME|<)/i.test(key));
  console.log(JSON.stringify({
    storeganise: 'authenticated', operation: 'GET /settings (read only)',
    apiHost: new URL(process.env.STOREGANISE_API_URL!.trim()).hostname,
    currencyCode: typeof settings.currencyCode === 'string' && /^[A-Z]{3}$/.test(settings.currencyCode) ? settings.currencyCode : 'not confirmed',
    webhookSecret: webhookConfigured ? 'configured, not yet verified against a signed webhook' : 'missing',
    bchApiKey: rateConfigured ? 'configured; verify with pnpm pay:bch-check' : 'missing',
    cybersourceEnvironment: gatewayEnvironment(), cybersourceAccess: 'not checked by this command',
    productionReady: false,
    pending: [...(!webhookConfigured ? ['Real Storeganise webhook secret'] : []),
      ...(settings.currencyCode === 'USD' && !rateConfigured ? ['BCH subscription key and live exchange-rate verification'] : []),
      ...(process.env.STOREGANISE_PAY_ENABLED!=='true'?['STOREGANISE_PAY_ENABLED is disabled']:[]),
      'Configure authenticated handoff after invoice creation in Storeganise',
      'Validate payment-write permissions and move-in automations', 'Production gateway and checkout configuration', 'End-to-end validation'],
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ storeganise: 'not verified',
    code: error instanceof StoreganiseApiError ? error.code : 'CHECK_FAILED',
    httpStatus: error instanceof StoreganiseApiError ? error.status : undefined }));
  process.exitCode = 1;
});
