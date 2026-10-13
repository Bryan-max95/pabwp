import type { PaymentResult } from './types';

interface Application { name?: string; reasonCode?: string | number; rCode?: string; rFlag?: string; rMessage?: string }
interface TransactionDetails {
  id?: string;
  clientReferenceInformation?: { code?: string };
  orderInformation?: { amountDetails?: { totalAmount?: string; currency?: string } };
  applicationInformation?: { applications?: Application[] };
  processorInformation?: { approvalCode?: string };
}

/** Authentication success is never evidence of payment authorization or capture. */
export function reconcileTransaction(data: TransactionDetails, expected: {
  transactionId: string; reference: string; amount: string; currency: string; mode: string;
}): PaymentResult {
  const base = { transactionId: expected.transactionId, reference: expected.reference };
  const amount = data.orderInformation?.amountDetails;
  if (data.id !== expected.transactionId || data.clientReferenceInformation?.code !== expected.reference ||
    !amount?.totalAmount || Number(amount.totalAmount).toFixed(2) !== expected.amount || amount.currency !== expected.currency) {
    return { ...base, status: 'unknown', gatewayStatus: 'RECONCILIATION_MISMATCH', reason: 'Provider transaction does not match this session' };
  }
  const apps = data.applicationInformation?.applications ?? [];
  const auth = apps.find(app => app.name === 'ics_auth');
  const bill = apps.find(app => app.name === 'ics_bill');
  const ok = (app?: Application) => String(app?.reasonCode) === '100' && app?.rCode === '1';
  if (apps.some(app => /void|reversal/.test(app.name ?? '') && ok(app))) {
    return { ...base, status: 'unknown', gatewayStatus: 'CANCELLATION_REQUIRES_REVIEW' };
  }
  if (ok(auth)) {
    if (expected.mode === 'authorization_only' || ok(bill)) return { ...base,
      status: expected.mode === 'authorization_only' ? 'authorized' : 'succeeded',
      gatewayStatus: expected.mode === 'authorization_only' ? 'AUTHORIZED' : 'CAPTURE_ACCEPTED',
      authorizationCode: data.processorInformation?.approvalCode };
    const captureFailed = /^D/.test(bill?.rFlag ?? '');
    return { ...base, status: 'unknown',
      gatewayStatus: captureFailed ? 'AUTHORIZED_CAPTURE_FAILED' : 'AUTHORIZED_CAPTURE_UNCONFIRMED',
      authorizationCode: data.processorInformation?.approvalCode,
      reason: captureFailed && /\bpurchaser_code\b/i.test(bill?.rMessage ?? '') ? 'PURCHASER_CODE_INVALID' :
        captureFailed ? 'CAPTURE_FAILED' : 'CAPTURE_NOT_CONFIRMED' };
  }
  if (auth?.rFlag === 'ESYSTEM' || String(auth?.reasonCode) === '150') {
    return { ...base, status: 'unknown', gatewayStatus: 'PROCESSOR_ERROR_150',
      reason: /merchant_id/i.test(auth?.rMessage ?? '') ? 'PROCESSOR_MERCHANT_ID_INVALID_OR_MISSING' : 'PROCESSOR_RESULT_REQUIRES_REVIEW' };
  }
  const rejected = auth && /^D/.test(auth.rFlag ?? '') && Number(auth.reasonCode) >= 200 && Number(auth.reasonCode) < 500;
  return { ...base, status: rejected ? 'declined' : 'unknown', gatewayStatus: rejected ? `AUTHORIZATION_DECLINED_${auth.reasonCode}` : 'RESULT_UNCONFIRMED',
    reason: rejected ? auth.rFlag : 'No confirmed authorization; do not repeat the payment' };
}
