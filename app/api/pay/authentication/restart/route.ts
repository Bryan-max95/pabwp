import { NextRequest, NextResponse } from 'next/server';
import { authenticatedSession, assertSameOrigin } from '@/lib/pay/http';
import { activeAttempt, claimAuthentication, finishAttempt, publicSession } from '@/lib/pay/service';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const session = await authenticatedSession();
    const attempt = await activeAttempt(session.id);
    if (!attempt.token_jti || !attempt.response || !['device', 'challenge'].includes(attempt.response.phase)) throw new Error('Not a pre-payment authentication');
    // Same atomic claim as completion: cancellation cannot race an authorization.
    await claimAuthentication(session.id, attempt.id, attempt.token_jti, attempt.response.phase);
    const updated = await finishAttempt(attempt.id, { status: 'declined', gatewayStatus: 'AUTHENTICATION_CANCELLED', reason: 'NO_PAYMENT_REQUESTED' });
    return NextResponse.json({ session: publicSession(updated) });
  } catch { return NextResponse.json({ error: 'AUTHENTICATION_ALREADY_PROCESSING' }, { status: 409 }); }
}
