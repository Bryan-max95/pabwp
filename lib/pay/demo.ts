import crypto from 'node:crypto';
import { gatewayEnvironment } from '../cybersource/environment';
import type { CheckoutSessionInput } from './types';
import { DEMO_AMOUNTS, DEMO_SCENARIOS, demoCurrency, DEFAULT_DEMO_SCENARIO, type DemoScenario } from './demo-scenarios';

/** Explicitly local: deploying the same files never enables anonymous checkout. */
export function localDemoEnabled(requestUrl: string, host: string | null) {
  if (process.env.NODE_ENV !== 'development' || process.env.PAY_DEMO_ENABLED !== 'true' || gatewayEnvironment() !== 'sandbox') return false;
  try {
    const configured = new URL(process.env.PAY_PUBLIC_URL ?? '');
    const requested = new URL(requestUrl);
    const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
    return loopback.has(configured.hostname) && loopback.has(requested.hostname) && host === configured.host;
  } catch { return false; }
}

export function demoCheckout(variant: 'a' | 'b', scenario: DemoScenario = DEFAULT_DEMO_SCENARIO): CheckoutSessionInput {
  if (!DEMO_SCENARIOS.includes(scenario)) throw new Error('Invalid sandbox scenario');
  const run = crypto.randomUUID();
  return {
    eventId: `local-demo-${run}`, customerId: `demo-customer-${variant}`,
    orderId: `demo-order-${run}`, invoiceId: `demo-invoice-${run}`,
    unitId: `demo-unit-${variant}`, clientName: `Cliente de prueba ${variant.toUpperCase()}`,
    unitName: `DEMO-${variant.toUpperCase()}`, amount: DEMO_AMOUNTS[scenario], currency: demoCurrency(scenario),
    concept: 'Prueba sandbox — sin factura fiscal', environment: 'sandbox', isTest: true,
    isDemo: true, fiscalEnvironment: 'test', payable: true,
    billTo: { firstName: 'Demo', lastName: variant.toUpperCase(), address1: '1 Test Street',
      locality: 'Miami', administrativeArea: 'FL', postalCode: '33101', country: 'US', email: `demo-${variant}@example.com` },
  };
}
