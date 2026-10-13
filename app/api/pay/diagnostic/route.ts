import { NextRequest, NextResponse } from 'next/server';
import { localDemoEnabled } from '@/lib/pay/demo';
import { authenticatedSession, assertSameOrigin } from '@/lib/pay/http';
import { paymentRequestSchema, browserDevice } from '@/lib/pay/payment-input';
import { beginAttempt, finishAttempt, publicSession } from '@/lib/pay/service';
import { CyberSourceGateway } from '@/lib/cybersource/gateway';

export const runtime = 'nodejs';
export const maxDuration = 45;

/** Isolated authorization-only diagnostic, never an automatic payment fallback. */
export async function POST(req: NextRequest) {
  if (!localDemoEnabled(req.url, req.headers.get('host'))) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  let attemptId: string | undefined;
  try {
    assertSameOrigin(req);
    const session = await authenticatedSession();
    if (!session.is_demo || session.environment !== 'sandbox' || session.status !== 'open') return NextResponse.json({ error: 'FRESH_DEMO_REQUIRED' }, { status: 409 });
    const data = paymentRequestSchema.parse(await req.json());
    if (new Date(Number(data.expirationYear), Number(data.expirationMonth), 1).getTime() <= Date.now()) return NextResponse.json({ error: 'CARD_EXPIRED' }, { status: 400 });
    if (!session.capture_context) throw new Error('Capture context required');
    const gateway = new CyberSourceGateway(session.environment);
    const token = await gateway.verifyTransientToken(data.transientToken, session.capture_context);
    const attempt = await beginAttempt(session.id, token.tokenId, 'authorization_only');
    attemptId = attempt.id;
    const result = await gateway.authorizeOnly({ token, reference: attempt.reference, amount: Number(session.amount).toFixed(2),
      currency: session.currency, billTo: session.bill_to, customerId: session.customer_id, device: browserDevice(req, data) });
    const updated = await finishAttempt(attempt.id, { ...result, brand: token.brand, last4: token.last4, response: result });
    return NextResponse.json({ session: publicSession(updated), diagnostic: 'authorization_only' }, { status: result.status === 'declined' ? 402 : 200 });
  } catch {
    if (attemptId) return NextResponse.json({ session: publicSession(await finishAttempt(attemptId, { status: 'unknown', gatewayStatus: 'DIAGNOSTIC_UNCERTAIN' })) }, { status: 202 });
    return NextResponse.json({ error: 'DIAGNOSTIC_NOT_STARTED' }, { status: 409 });
  }
}
