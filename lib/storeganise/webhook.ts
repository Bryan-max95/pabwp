import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifySignature } from './verify-signature';
import { StoreganiseIntegrationError, validateEventOrigin } from './config';

const envelope = z.object({ type:z.string().max(100).optional(),event:z.string().max(100).optional(),
  id:z.string().max(200).optional(),created:z.string().optional(),data:z.record(z.string(),z.unknown()).default({}),
  apiUrl:z.string().optional(),returnUrl:z.string().url().max(2000).optional(),
}).passthrough();

export async function readStoreganiseWebhook(req: NextRequest) {
  if (Number(req.headers.get('content-length') ?? 0) > 65536) throw new StoreganiseIntegrationError('WEBHOOK_TOO_LARGE',413);
  const raw = await req.text();
  if (Buffer.byteLength(raw,'utf8') > 65536) throw new StoreganiseIntegrationError('WEBHOOK_TOO_LARGE',413);
  if (!await verifySignature(req,raw)) throw new StoreganiseIntegrationError('INVALID_WEBHOOK_SIGNATURE',401);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new StoreganiseIntegrationError('INVALID_WEBHOOK_JSON',400); }
  const result = envelope.safeParse(value);
  if (!result.success) throw new StoreganiseIntegrationError('INVALID_WEBHOOK_PAYLOAD',400);
  validateEventOrigin(result.data.apiUrl);
  return result.data;
}

export function integrationErrorResponse(error: unknown) {
  if (error instanceof StoreganiseIntegrationError) return {error:error.code,status:error.httpStatus};
  if (error instanceof z.ZodError) return {error:'INVALID_STOREGANISE_DATA',status:422};
  return {error:'STOREGANISE_UNAVAILABLE',status:503};
}
