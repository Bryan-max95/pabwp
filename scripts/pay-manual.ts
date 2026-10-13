import fs from 'node:fs/promises';
import { manualCheckoutInput } from '../lib/pay/manual-checkout';
import { createCheckoutSession } from '../lib/pay/service';
import { closeDatabase } from '../lib/pay/db';

/** Creates a pending link only. Card entry and payment always require the customer. */
async function main() {
  const file = process.argv.find(arg => arg.startsWith('--file='))?.slice('--file='.length);
  if (!file) throw new Error('Pass --file=.private/cobro.json');
  const input = manualCheckoutInput(JSON.parse(await fs.readFile(file, 'utf8')));
  const created = await createCheckoutSession(input);
  await fs.mkdir('.private', { recursive: true });
  const output = `.private/manual-${created.id}.json`;
  await fs.writeFile(output, JSON.stringify({ ...created, environment: input.environment, source: input.source,
    originalAmount: input.amount, originalCurrency: 'USD', chargeCurrency: 'HNL', paymentStarted: false }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ file: output, sessionId: created.id, environment: input.environment, paymentStarted: false, expiresAt: created.expiresAt }));
}
main().catch(error => {
  // Zod and database errors can contain client data. Emit only a safe failure class.
  console.error(JSON.stringify({ manualCheckout: 'not created', error: error instanceof Error ? error.name : 'Error',
    nextStep: 'Check the private JSON, gateway credentials/environment and BCH connection. No payment was started.' }));
  process.exitCode = 1;
}).finally(closeDatabase);
