import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticatedSession, assertSameOrigin } from '@/lib/pay/http';
import { activeAttempt, claimAuthentication, finishAttempt, publicSession } from '@/lib/pay/service';
import { assertAuthenticationUrl, CyberSourceGateway, GatewayError } from '@/lib/cybersource/gateway';
import { verifyStoreganiseCheckout } from '@/lib/storeganise/checkout';
import { StoreganiseIntegrationError } from '@/lib/storeganise/config';
import { syncStoreganiseSession } from '@/lib/storeganise/sync';

export const runtime = 'nodejs';
export const maxDuration = 60;
const requestSchema = z.object({ transientToken: z.string().min(100).max(30000), step: z.enum(['device', 'challenge']),
  authenticationTransactionId: z.string().min(1).max(200).optional() }).strict();

export async function POST(req: NextRequest) {
  let attemptId: string | undefined;
  let authorizationStarted = false;
  try {
    assertSameOrigin(req);
    const session = await authenticatedSession();
    const body = requestSchema.parse(await req.json());
    const attempt = await activeAttempt(session.id);
    const state = attempt.response;
    if (!state || state.phase !== body.step || !state.referenceId || !state.device) throw new Error('Authentication state mismatch');
    if (body.step === 'challenge' && (!body.authenticationTransactionId ||
      state.authentication?.authenticationTransactionId !== body.authenticationTransactionId)) throw new Error('Authentication transaction mismatch');
    const gateway = new CyberSourceGateway(session.environment);
    const token = await gateway.verifyTransientToken(body.transientToken, session.capture_context!);
    if (token.tokenId !== attempt.token_jti) throw new Error('Authentication token mismatch');
    await claimAuthentication(session.id, attempt.id, token.tokenId, body.step);
    attemptId = attempt.id;
    const authentication = body.step === 'device' ? await gateway.authenticate({ token, reference: attempt.reference, referenceId: state.referenceId,
      returnUrl: new URL(process.env.PAY_PUBLIC_URL!).origin + '/api/pay/authentication/callback', amount: Number(session.amount).toFixed(2),
      currency: session.currency, billTo: session.bill_to, customerId: session.customer_id, device: state.device }) :
      await gateway.validateAuthentication({ token, reference: attempt.reference, authenticationTransactionId: body.authenticationTransactionId! });
    if (body.step === 'device' && authentication.status === 'challenge_required' && authentication.accessToken &&
      authentication.stepUpUrl && authentication.authenticationTransactionId) {
      assertAuthenticationUrl(authentication.stepUpUrl, session.environment);
      const updated = await finishAttempt(attempt.id, { status: 'pending', gatewayStatus: 'CHALLENGE_REQUIRED', response: {
        phase: 'challenge', setupId: state.setupId, enrollmentId: authentication.transactionId, referenceId: state.referenceId, device: state.device,
        authentication: { authenticationTransactionId: authentication.authenticationTransactionId },
      } });
      return NextResponse.json({ session: publicSession(updated), authentication: { step: 'challenge', accessToken: authentication.accessToken,
        url: authentication.stepUpUrl, transactionId: authentication.authenticationTransactionId } }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.step === 'challenge' && authentication.status === 'challenge_required') {
      const updated = await finishAttempt(attempt.id, { status: 'pending', gatewayStatus: 'CHALLENGE_REQUIRED', response: state });
      return NextResponse.json({ session: publicSession(updated) }, { status: 202 });
    }
    if (authentication.status !== 'authenticated') {
      const updated = await finishAttempt(attempt.id, { status: 'declined', gatewayStatus: authentication.gatewayStatus,
        reason: authentication.reason ?? 'CONSUMER_AUTHENTICATION_FAILED', response: {
          phase: 'authentication_failed', setupId: state.setupId, enrollmentId: state.enrollmentId, authenticationId: authentication.transactionId, gatewayStatus: authentication.gatewayStatus,
          paresStatus: authentication.paresStatus, authenticationResult: authentication.authenticationResult, authenticationMessage: authentication.authenticationMessage,
        } });
      return NextResponse.json({ session: publicSession(updated) }, { status: 402 });
    }
    await verifyStoreganiseCheckout(session);
    authorizationStarted = true;
    // Already verified: never request VALIDATE a second time during authorization.
    const result = await gateway.pay({ token, reference: attempt.reference, amount: Number(session.amount).toFixed(2), currency: session.currency,
      billTo: session.bill_to, customerId: session.customer_id, device: state.device, authentication });
    const updated = await finishAttempt(attempt.id, { ...result, brand: token.brand, last4: token.last4,
      response: { ...result, setupId: state.setupId, enrollmentId: state.enrollmentId, authenticationId: authentication.transactionId,
        authenticationStatus: authentication.gatewayStatus, paresStatus: authentication.paresStatus } });
    if(updated.status==='succeeded'&&updated.storeganise_context)after(async()=>{try{await syncStoreganiseSession(updated.id);}catch{/* Durable delivery remains available to the worker. */}});
    return NextResponse.json({ session: publicSession(updated) }, { status: result.status === 'declined' ? 402 : 200 });
  } catch (error) {
    if (attemptId) {
      const updated = await finishAttempt(attemptId, { status: authorizationStarted ? 'unknown' : 'declined',
        gatewayStatus: authorizationStarted ? 'PAYMENT_UNCERTAIN' : 'AUTHENTICATION_FAILED',
        reason: error instanceof GatewayError ? error.reason : error instanceof StoreganiseIntegrationError ? error.code : 'AUTHENTICATION_NOT_CONFIRMED' });
      return NextResponse.json({ session: publicSession(updated) }, { status: authorizationStarted ? 202 : 402 });
    }
    return NextResponse.json({ error: 'AUTHENTICATION_FAILED' }, { status: 409 });
  }
}
