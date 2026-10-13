import { z } from 'zod';
import { gatewayEnvironment, type GatewayEnvironment } from '../cybersource/environment';

const credentialsSchema = z.object({
  merchantId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  keyId: z.string().uuid(),
  sharedSecret: z.string().min(32).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type GatewayCredentials = z.infer<typeof credentialsSchema>;

/** Server environment only. Never fall back to old credentials stored in Neon. */
export async function loadCredentials(environment: GatewayEnvironment = gatewayEnvironment()): Promise<GatewayCredentials> {
  if (typeof window !== 'undefined') throw new Error('Credentials are server-only');
  if (!['sandbox', 'production'].includes(environment)) throw new Error('Invalid gateway environment');
  const variables = {
    merchantId: 'CYBERSOURCE_MERCHANT_ID',
    keyId: 'CYBERSOURCE_KEY_ID',
    sharedSecret: 'CYBERSOURCE_SHARED_SECRET',
  } as const;
  const result = credentialsSchema.safeParse({
    merchantId: process.env[variables.merchantId],
    keyId: process.env[variables.keyId],
    sharedSecret: process.env[variables.sharedSecret],
  });
  if (!result.success) {
    const names = [...new Set(result.error.issues.map(issue => variables[issue.path[0] as keyof typeof variables]))];
    // Include variable names only, never their values or the parsed input.
    throw new Error(`CyberSource server credentials missing or invalid: ${names.join(', ')}`);
  }
  // BAC validates this configured credential set at the selected endpoint.
  // A merchant naming convention is not proof of its provider permissions.
  return result.data;
}
