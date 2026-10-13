import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createCheckoutSession } from '../lib/pay/service';
import { closeDatabase } from '../lib/pay/db';

async function main() {
  if (process.env.PAY_DEMO_ENABLED !== 'true') throw new Error('Demo is disabled');
  const run = crypto.randomUUID();
  const sessions = await Promise.all([
    { suffix: 'a', name: 'Cliente de prueba A', unit: 'DEMO-A', amount: '100.00' },
    { suffix: 'b', name: 'Cliente de prueba B', unit: 'DEMO-B', amount: '100.00' },
  ].map(item => createCheckoutSession({
    eventId: `demo-${run}-${item.suffix}`, customerId: `demo-customer-${item.suffix}`,
    orderId: `demo-order-${run}-${item.suffix}`, invoiceId: `demo-invoice-${run}-${item.suffix}`,
    unitId: `demo-unit-${item.suffix}`, clientName: item.name, unitName: item.unit,
    amount: item.amount, currency: 'HNL', concept: 'Prueba sandbox — sin factura fiscal',
    environment: 'sandbox', isTest: true, isDemo: true, fiscalEnvironment: 'test', payable: true,
    billTo: { firstName: 'Demo', lastName: item.suffix.toUpperCase(), address1: '1 Test Street',
      locality: 'Miami', administrativeArea: 'FL', postalCode: '33101', country: 'US', email: `demo-${item.suffix}@example.com` },
  })));
  await fs.mkdir('.private', { recursive: true });
  await fs.writeFile('.private/demo-sessions.json', JSON.stringify(sessions, null, 2), { mode: 0o600 });
  await fs.writeFile('.private/DEMO.md', `# Enlaces privados de prueba\n\nCada enlace se usa una vez y caduca en 30 minutos. Después de abrirlo, la cookie permite consultar el resultado hasta 24 horas.\n\n${sessions.map((session, i) => `- Cliente ${i ? 'B' : 'A'} — 100.00 HNL: [Abrir carrusel](${session.launchUrl})`).join('\n')}\n\nUtilizar solo tarjetas publicadas para sandbox. Estas sesiones nunca notifican al Portal ni generan facturas fiscales.\n`, { mode: 0o600 });
  console.log('Dos sesiones creadas en Neon. Enlaces privados: .private/DEMO.md (no se imprimen tokens).');
}
main().catch(error => { console.error('Demo setup failed:', error instanceof Error ? error.message : 'Error'); process.exitCode = 1; }).finally(closeDatabase);
