import crypto from 'node:crypto';
import { query, transaction } from '../pay/db';
import type { SessionRow } from '../pay/types';
import { assertStoreganiseEnabled, StoreganiseIntegrationError } from './config';
import { getInvoice, getJob, getUnit, invoiceContext } from './records';
import { storeganiseRequest, StoreganiseApiError } from './client';

interface Delivery {
  session_id: string; transaction_id: string; attempt_count: number;
  payment_write_started: boolean; lease_token: string;
}

async function saveProgress(delivery: Delivery, status: string, error?: string, paymentId?: string) {
  const delay = status === 'active' ? 86400 : status === 'review' ? 300 :
    status === 'awaiting_move_in' ? 30 : Math.min(1800, 15 * 2 ** Math.min(delivery.attempt_count, 7));
  await transaction(async client => {
    const claimed = await client.query(`UPDATE storeganise_deliveries SET status=$3,last_error=$4,
      lease_token=NULL,lease_until=NULL,next_attempt_at=now()+($5*interval '1 second'),updated_at=now(),
      delivered_at=CASE WHEN $3='active' THEN now() ELSE delivered_at END
      WHERE session_id=$1 AND lease_token=$2 RETURNING session_id`,
    [delivery.session_id,delivery.lease_token,status,error??null,delay]);
    if (!claimed.rowCount) return;
    await client.query(`UPDATE pay_sessions SET storeganise_status=$2,storeganise_error=$3,
      storeganise_payment_id=COALESCE($4,storeganise_payment_id),updated_at=now() WHERE id=$1`,
    [delivery.session_id,status,error??null,paymentId??null]);
  });
}

/** Durable outbound delivery. This module never calls CyberSource or the fiscal Portal. */
export async function syncStoreganiseSession(sessionId: string): Promise<void> {
  if (process.env.STOREGANISE_PAY_ENABLED !== 'true') return;
  const lease = crypto.randomUUID();
  const claimed = await query<Delivery>(`UPDATE storeganise_deliveries d SET lease_token=$2,
    lease_until=now()+interval '3 minutes',status='sending',attempt_count=attempt_count+1,updated_at=now()
    FROM pay_sessions s WHERE d.session_id=s.id AND d.session_id=$1 AND s.status='succeeded'
      AND s.storeganise_context IS NOT NULL AND s.is_demo=false AND s.checkout_source='storeganise'
      AND s.gateway_transaction_id=d.transaction_id AND d.status<>'active'
      AND d.next_attempt_at<=now() AND (d.lease_until IS NULL OR d.lease_until<now()) RETURNING d.*`, [sessionId,lease]);
  const delivery = claimed.rows[0];
  if (!delivery) return;
  try {
    const { url, environment } = assertStoreganiseEnabled();
    const stored = await query<SessionRow>('SELECT * FROM pay_sessions WHERE id=$1', [sessionId]);
    const session = stored.rows[0];
    const binding = session.storeganise_context;
    if (!binding || binding.apiOrigin !== url.origin || session.environment !== environment ||
      binding.customerId !== session.customer_id || binding.invoiceId !== session.invoice_id ||
      binding.unitId !== session.unit_id || !session.reference_usd_amount || !session.paid_at) {
      throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH');
    }
    const context = await invoiceContext(binding.invoiceId,binding.customerId,binding.jobId);
    if (context.rental.id !== binding.rentalId || context.invoice.siteId !== binding.siteId || context.invoice.deleted) {
      throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH');
    }
    const amount = Number(session.reference_usd_amount).toFixed(2);
    const method = process.env.STOREGANISE_CARD_PAYMENT_METHOD ?? 'card';
    const marker = `Pay/CyberSource [${session.environment}:${delivery.transaction_id}]`;
    let invoice = context.invoice;
    const matchingPayment = () => {
      const matches = invoice.payments.filter(payment => !payment.deleted && payment.notes?.split('\n')[0] === marker);
      if (matches.length > 1) throw new StoreganiseIntegrationError('DUPLICATE_STOREGANISE_PAYMENT');
      const payment = matches[0];
      if (payment && (payment.amount.toFixed(2) !== amount || payment.method !== method || payment.type !== 'manual')) {
        throw new StoreganiseIntegrationError('STOREGANISE_PAYMENT_MISMATCH');
      }
      return payment;
    };
    let payment = matchingPayment();
    if (!payment) {
      if (delivery.payment_write_started) {
        // A timeout/crash after POST is ambiguous. Read back until found; never
        // repeat a financial write based solely on an absent/eventually-consistent read.
        await saveProgress(delivery,'review','STOREGANISE_WRITE_UNCONFIRMED'); return;
      }
      if (!['sent','overdue'].includes(invoice.state) || invoice.balance.toFixed(2) !== amount) {
        await saveProgress(delivery,'review','INVOICE_CHANGED_AFTER_PAYMENT'); return;
      }
      const writing = await query(`UPDATE storeganise_deliveries SET payment_write_started=true,updated_at=now()
        WHERE session_id=$1 AND lease_token=$2 AND payment_write_started=false RETURNING session_id`, [sessionId,lease]);
      if (!writing.rowCount) return;
      delivery.payment_write_started = true;
      const notes = `${marker}\nReference: RSS-${session.id}\nUSD ${amount}; HNL ${Number(session.amount).toFixed(2)}; BCH ${session.usd_hnl_rate} (${session.fx_rate_date}).`;
      // Same manual payment operation used by Storeganise's Management Portal.
      // "manual" means an externally collected payment; the displayed method is card.
      await storeganiseRequest(`/invoices/${binding.invoiceId}/payments`,'POST',{
        type:'manual',method,amount:Number(amount),date:session.paid_at.toISOString().slice(0,10),notes,
      });
      invoice = await getInvoice(binding.invoiceId);
      payment = matchingPayment();
      if (!payment) { await saveProgress(delivery,'review','STOREGANISE_WRITE_UNCONFIRMED'); return; }
    }
    if (invoice.state !== 'paid' || Math.abs(invoice.balance) > 0.00001) {
      await saveProgress(delivery,'review','STOREGANISE_BALANCE_NOT_SETTLED',payment.id); return;
    }
    const job = context.job ? await getJob(context.job.id) : undefined;
    if(job&&(job.ownerId!==binding.customerId||job.type!=='unit_moveIn'||
      (job.result.unitRentalId&&job.result.unitRentalId!==binding.rentalId)))throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH');
    if (job && ['cancelled','canceled','failed'].includes(job.state)) {
      await saveProgress(delivery,'review','MOVE_IN_REQUIRES_REVIEW',payment.id); return;
    }
    // Complete only the payment-dependent step of this exact paid initial invoice.
    // Never skip agreement/identity checks or directly force a unit to "occupied".
    const invoiceStep = job?.steps.find(step => step.type === 'invoice_createInitial' &&
      step.state === 'ready' && step.result?.invoiceId === invoice.id);
    if (job && invoiceStep && process.env.STOREGANISE_COMPLETE_PAID_INVOICE_STEP === 'true') {
      await storeganiseRequest(`/jobs/${job.id}/steps/${encodeURIComponent(invoiceStep.id)}`,'PUT',{state:'completed'});
    }
    const unit = await getUnit(binding.unitId);
    const active = unit.state === 'occupied' && unit.ownerId === binding.customerId && unit.rentalId === binding.rentalId;
    await saveProgress(delivery,active?'active':'awaiting_move_in',undefined,payment.id);
  } catch (error) {
    const code = error instanceof StoreganiseIntegrationError ? error.code : error instanceof StoreganiseApiError ?
      `STOREGANISE_${error.code}${error.status ? `_${error.status}` : ''}` : 'STOREGANISE_SYNC_UNAVAILABLE';
    const review = error instanceof StoreganiseIntegrationError || delivery.payment_write_started ||
      (error instanceof StoreganiseApiError && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 429);
    await saveProgress(delivery,review?'review':'retry',code);
  }
}

export async function retryDueStoreganiseDeliveries() {
  if (process.env.STOREGANISE_PAY_ENABLED !== 'true') return;
  const due = await query<{session_id:string}>(`SELECT session_id FROM storeganise_deliveries
    WHERE status<>'active' AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now())
    ORDER BY next_attempt_at LIMIT 3`);
  await Promise.allSettled(due.rows.map(row => syncStoreganiseSession(row.session_id)));
}

/** Signed Storeganise state events wake existing deliveries; an event never proves payment. */
export async function wakeStoreganiseDeliveries(ids: {invoiceId?: string; jobId?: string; unitId?: string; unitRentalId?: string}) {
  if (!Object.values(ids).some(Boolean)) return;
  await query(`UPDATE storeganise_deliveries d SET next_attempt_at=now(),status=CASE WHEN d.status='active' THEN 'pending' ELSE d.status END FROM pay_sessions s
    WHERE d.session_id=s.id AND s.status='succeeded' AND s.storeganise_context IS NOT NULL
      AND (($1::text IS NOT NULL AND s.invoice_id=$1) OR ($2::text IS NOT NULL AND s.storeganise_context->>'jobId'=$2)
        OR ($3::text IS NOT NULL AND s.unit_id=$3) OR ($4::text IS NOT NULL AND s.storeganise_context->>'rentalId'=$4))`,
  [ids.invoiceId??null,ids.jobId??null,ids.unitId??null,ids.unitRentalId??null]);
}
