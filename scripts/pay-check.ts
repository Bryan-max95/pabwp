import { CyberSourceGateway, GatewayError } from '../lib/cybersource/gateway';
import { closeDatabase } from '../lib/pay/db';
import { gatewayEnvironment } from '../lib/cybersource/environment';

async function main() {
  if (gatewayEnvironment() !== 'sandbox') throw new Error('Automatic connection checks are sandbox-only. Use the production checkout manually.');
  const context = await new CyberSourceGateway('sandbox').createCaptureContext();
  // Deliberately do not print the capture context or any signing credentials.
  console.log(JSON.stringify({ environment: gatewayEnvironment(), gateway: 'authenticated', captureContext: 'signature verified',
    targetOrigin: new URL(process.env.PAY_PUBLIC_URL!).origin,
    libraryHost: new URL(context.clientLibrary).hostname, expiresAt: context.expiresAt }, null, 2));
}
main().catch(error => {
  console.error(JSON.stringify({ environment: gatewayEnvironment(), gateway: 'not verified',
    reason: error instanceof GatewayError ? error.message : error instanceof Error ? error.message : 'Error' }));
  process.exitCode = 1;
}).finally(closeDatabase);
