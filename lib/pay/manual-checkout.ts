import crypto from 'node:crypto';
import { z } from 'zod';
import { gatewayEnvironment } from '../cybersource/environment';
import type { CheckoutSessionInput } from './types';

const text = z.string().trim().min(1).max(200);
export const manualCheckoutSchema = z.object({
  reference: text, customerId: text, unitId: text, clientName: text, unitName: text, concept: z.string().trim().min(1).max(500),
  amount: z.string().regex(/^\d{1,11}\.\d{2}$/).refine(value => Number(value) > 0), currency: z.literal('USD').default('USD'),
  billTo: z.object({ firstName: text, lastName: text, address1: text, address2: text.optional(), locality: text,
    administrativeArea: text.optional(), postalCode: text.optional(), country: z.string().regex(/^[A-Z]{2}$/),
    email: z.string().trim().email().max(254), phoneNumber: z.string().trim().max(30).optional() }).strict(),
}).strict();

/** Operator-only input, loaded by the private CLI. Never accepts a browser-supplied total. */
export function manualCheckoutInput(value: unknown): CheckoutSessionInput {
  const { reference, ...details } = manualCheckoutSchema.parse(value);
  const environment = gatewayEnvironment();
  return { ...details, eventId: `manual-${environment}-${crypto.createHash('sha256').update(reference).digest('hex')}`,
    orderId: reference, environment, source: 'manual', isTest: environment === 'sandbox',
    fiscalEnvironment: environment === 'sandbox' ? 'test' : 'production', payable: true, isDemo: false };
}
