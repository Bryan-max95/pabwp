import crypto from 'node:crypto';
import { z } from 'zod';
import { gatewayEnvironment } from '../cybersource/environment';
import { manualCheckoutInput } from './manual-checkout';
import { query } from './db';
import type { SessionRow } from './types';

export const SANDBOX_MANUAL_CUSTOMER = 'manual-sandbox-customer';

export function sandboxManualEnabled() {
  try {
    const url = new URL(process.env.PAY_PUBLIC_URL ?? '');
    const allowed = (process.env.STOREGANISE_TEST_CUSTOMER_IDS ?? '').split(',').map(value => value.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return gatewayEnvironment() === 'sandbox' && process.env.PAY_SANDBOX_MANUAL_ENABLED === 'true' &&
      allowed.includes(SANDBOX_MANUAL_CUSTOMER) && !url.username && !url.password &&
      (url.protocol === 'https:' || (local && url.protocol === 'http:'));
  } catch { return false; }
}

export const sandboxManualSchema = z.object({
  reference: z.string().uuid(),
  clientName: z.string().trim().min(1).max(200),
  unitName: z.string().trim().min(1).max(60),
  amount: z.string().regex(/^\d{1,8}\.\d{2}$/).refine(value => Number(value) > 0),
}).strict();

/** This browser-defined amount is accepted only for explicitly enabled sandbox trials. */
export function sandboxManualInput(value: unknown) {
  if (!sandboxManualEnabled()) throw new Error('MANUAL_SANDBOX_DISABLED');
  const details = sandboxManualSchema.parse(value);
  const identity = crypto.createHash('sha256').update(JSON.stringify([details.clientName, details.unitName])).digest('hex');
  const names = details.clientName.split(/\s+/);
  return manualCheckoutInput({ ...details, customerId: SANDBOX_MANUAL_CUSTOMER,
    unitId: `manual-sandbox-${identity}`, concept: 'Prueba manual de pago',
    // Sandbox billing fixture only. Production links require the operator's actual billTo.
    billTo: { firstName: names[0], lastName: names.slice(1).join(' ') || 'Test',
      address1: '1 Test Street', locality: 'Miami', administrativeArea: 'FL', postalCode: '33101', country: 'US',
      email: 'manual-sandbox@example.com' },
  });
}

/** Recover the same manual trial after a lost response, without extending it or resetting a payment. */
export async function openSandboxManualAccess(launchToken: string) {
  if (!sandboxManualEnabled() || !/^[A-Za-z0-9_-]{43}$/.test(launchToken)) throw new Error('MANUAL_SANDBOX_DISABLED');
  const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
  const accessToken = crypto.createHmac('sha256', launchToken).update('pay-sandbox-manual-access-v1').digest('base64url');
  const result = await query<SessionRow>(`UPDATE pay_sessions SET access_hash=$2,
    consumed_at=COALESCE(consumed_at,now()),updated_at=now()
    WHERE launch_hash=$1 AND environment='sandbox' AND checkout_source='manual'
      AND customer_id=$3 AND is_demo=false AND expires_at>now()
      AND (access_hash=$2 OR status IN ('open','declined')) RETURNING *`,
  [hash(launchToken), hash(accessToken), SANDBOX_MANUAL_CUSTOMER]);
  if (!result.rowCount) throw new Error('MANUAL_SESSION_NOT_RECOVERABLE');
  return { accessToken, session: result.rows[0] };
}
