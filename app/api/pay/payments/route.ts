import { NextRequest, NextResponse } from 'next/server';
import { authenticatedSession, assertSameOrigin } from '@/lib/pay/http';
import { beginAttempt, finishAttempt, publicSession } from '@/lib/pay/service';
import { CyberSourceGateway, GatewayError } from '@/lib/cybersource/gateway';
import { browserDevice, paymentRequestSchema } from '@/lib/pay/payment-input';
import { needsLegacyPaymentReview } from '@/lib/pay/payment-state';
import { verifyStoreganiseCheckout } from '@/lib/storeganise/checkout';
import { StoreganiseIntegrationError } from '@/lib/storeganise/config';
import { StoreganiseApiError } from '@/lib/storeganise/client';
import { billToSchema } from '@/lib/pay/billing-details';

export const runtime = 'nodejs';
export const maxDuration = 45;

/** Starts authentication only. No authorization before its server-verified result. */
export async function POST(req: NextRequest) {
  let attemptId: string | undefined;
  try {
    assertSameOrigin(req);
    const session = await authenticatedSession();
    if (!['open', 'declined'].includes(session.status) || needsLegacyPaymentReview(session)) return NextResponse.json({ session: publicSession(session) });
    const body = paymentRequestSchema.safeParse(await req.json());
    if (!body.success || !session.capture_context) return NextResponse.json({ error: 'INVALID_PAYMENT_DATA' }, { status: 400 });
    const data = body.data;
    if (session.storeganise_context && !billToSchema.safeParse(data.billingDetails ?? session.bill_to).success) {
      return NextResponse.json({error:'BILLING_DETAILS_REQUIRED'},{status:400});
    }
    await verifyStoreganiseCheckout(session);
    if (new Date(Number(data.expirationYear), Number(data.expirationMonth), 1).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'CARD_EXPIRED' }, { status: 400 });
    }
    const gateway = new CyberSourceGateway(session.environment);
    const token = await gateway.verifyTransientToken(data.transientToken, session.capture_context);
    const attempt = await beginAttempt(session.id, token.tokenId, 'payment', data.billingDetails);
    attemptId = attempt.id;
    const setup = await gateway.setupAuthentication(token, attempt.reference);
    const updated = await finishAttempt(attempt.id, { status: 'pending', gatewayStatus: 'DEVICE_COLLECTION_REQUIRED', brand: token.brand, last4: token.last4,
      response: { phase: 'device', setupId: setup.transactionId, referenceId: setup.referenceId, device: browserDevice(req, data) } });
    return NextResponse.json({ session: publicSession(updated), authentication: {
      step: 'device', accessToken: setup.accessToken, url: setup.deviceDataCollectionUrl, referenceId: setup.referenceId,
    } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (attemptId) {
      // Setup has no financial effect: a fresh token is safe after setup failure.
      const updated = await finishAttempt(attemptId, { status: 'declined', gatewayStatus: 'AUTHENTICATION_SETUP_FAILED',
        reason: error instanceof GatewayError ? error.reason : 'SETUP_UNAVAILABLE' });
      return NextResponse.json({ session: publicSession(updated) }, { status: 402 });
    }
    if(error instanceof StoreganiseIntegrationError)return NextResponse.json({error:error.code},{status:error.httpStatus});
    if(error instanceof StoreganiseApiError)return NextResponse.json({error:'STOREGANISE_CHECKOUT_UNAVAILABLE'},{status:503});
    return NextResponse.json({ error: 'PAYMENT_NOT_STARTED' }, { status: 409 });
  }
}
