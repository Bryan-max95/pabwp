import { NextRequest, NextResponse } from 'next/server';
import { authenticatedSession, assertSameOrigin } from '@/lib/pay/http';
import { transaction } from '@/lib/pay/db';
import type { SessionRow } from '@/lib/pay/types';
import { CyberSourceGateway } from '@/lib/cybersource/gateway';
import { decodeJwt } from 'jose';
import { gatewayEnvironment } from '@/lib/cybersource/environment';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const authenticated = await authenticatedSession();
    if (authenticated.environment !== gatewayEnvironment()) throw new Error('Session environment mismatch');
    const gateway = new CyberSourceGateway(authenticated.environment);
    const context = await transaction(async client => {
      const locked = await client.query<SessionRow>('SELECT * FROM pay_sessions WHERE id=$1 FOR UPDATE', [authenticated.id]);
      const session = locked.rows[0];
      if (!['open', 'declined'].includes(session.status) || session.expires_at.getTime() <= Date.now()) throw new Error('Session not payable');
      if (session.capture_context && Number(decodeJwt(session.capture_context).exp) > Date.now() / 1000 + 60) {
        return gateway.readCaptureContext(session.capture_context);
      }
      const fresh = await gateway.createCaptureContext();
      await client.query('UPDATE pay_sessions SET capture_context=$2,updated_at=now() WHERE id=$1', [session.id, fresh.captureContext]);
      return fresh;
    });
    return NextResponse.json(context, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'SECURE_FIELDS_UNAVAILABLE' }, { status: 503 });
  }
}
