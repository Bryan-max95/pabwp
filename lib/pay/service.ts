import crypto from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { query, transaction } from './db';
import type { CheckoutSessionInput, SessionRow } from './types';
import type { BrowserDevice } from '../cybersource/types';
import { demoScenarioForAmount } from './demo-scenarios';
import { currentBchRate, hnlCharge } from './exchange-rate';
import { gatewayEnvironment } from '../cybersource/environment';
import { loadCredentials } from './credentials';
import { needsLegacyPaymentReview } from './payment-state';
import { paymentFailureCode } from './payment-feedback';
import { billToSchema } from './billing-details';
import { storeganiseReturnUrl } from '../storeganise/config';
import type { BchRate } from './bch';

const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
function launchTokenFor(eventId:string){const secret=process.env.PAY_SESSION_TOKEN_SECRET;if(!secret||secret.length<32)throw new Error('PAY_SESSION_TOKEN_SECRET must contain at least 32 characters');return crypto.createHmac('sha256',secret).update(eventId).digest('base64url');}
const money = (value: string) => /^\d{1,11}\.\d{2}$/.test(value) && Number(value) > 0;

export async function createCheckoutSession(input: CheckoutSessionInput, storage?: {client:PoolClient;rate?:BchRate}) {
  const runQuery = <T extends QueryResultRow>(sql:string,values:unknown[]=[]) =>
    storage ? storage.client.query<T>(sql,values) : query<T>(sql,values);
  const environment = gatewayEnvironment();
  const source = input.source ?? 'storeganise';
  if (input.environment !== environment || !input.payable || !['manual', 'storeganise'].includes(source)) throw new Error('Checkout environment or source mismatch');
  if (environment === 'sandbox' && (!input.isTest || input.fiscalEnvironment !== 'test')) throw new Error('Only isolated test checkout is allowed');
  if (environment === 'production' && (input.isTest || input.isDemo || input.fiscalEnvironment !== 'production')) throw new Error('Production does not accept test checkouts');
  if (!money(input.amount) || !['USD', 'HNL'].includes(input.currency)) throw new Error('Invalid definitive amount');
  const allowed = new Set((process.env.STOREGANISE_TEST_CUSTOMER_IDS ?? '').split(',').map(v => v.trim()).filter(Boolean));
  if (environment === 'sandbox' && !allowed.has(input.customerId)) throw new Error('Customer is not allowlisted for sandbox');
  if (!input.invoiceId && !input.orderId) throw new Error('Verified invoice or order required');
  const publicUrl = requiredUrl('PAY_PUBLIC_URL');
  if (environment === 'production') {
    const origin = new URL(publicUrl);
    if (origin.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Production checkout requires its public HTTPS domain');
    await loadCredentials(environment);
  }
  if (input.isDemo && (process.env.PAY_DEMO_ENABLED !== 'true' || !input.customerId.startsWith('demo-'))) throw new Error('Demo sessions are disabled');
  if (input.isDemo && !demoScenarioForAmount(input.amount, input.currency)) throw new Error('Invalid sandbox demo amount or currency');
  const launchToken = launchTokenFor(input.eventId); const id = crypto.randomUUID();
  const sessionResult = (row: SessionRow) => {
    // A retried event reuses its first quote, even after BCH publishes a different rate.
    const originalCurrency = row.fx_source === 'BCH' ? 'USD' : row.currency;
    const originalAmount = row.fx_source === 'BCH' ? row.reference_usd_amount : row.amount;
    if (row.customer_id !== input.customerId || row.unit_id !== input.unitId || row.invoice_id !== (input.invoiceId ?? null) ||
      originalCurrency !== input.currency || Number(originalAmount).toFixed(2) !== input.amount ||
      row.order_id !== (input.orderId ?? null) || row.is_demo !== (input.isDemo === true) || row.environment !== environment ||
      (row.checkout_source ?? 'storeganise') !== source) throw new Error('Checkout event does not match its persisted session');
    return { id: row.id, launchToken, launchUrl: `${publicUrl}/?session=${encodeURIComponent(launchToken)}`, expiresAt: row.expires_at.toISOString() };
  };
  const existing = await runQuery<SessionRow>('SELECT * FROM pay_sessions WHERE event_id=$1', [input.eventId]);
  if (existing.rows[0]) return sessionResult(existing.rows[0]);
  if(storage&&input.currency==='USD'&&!storage.rate)throw new Error('Exchange quote required before checkout transaction');
  const rate = input.currency === 'USD' ? storage?.rate ?? await currentBchRate() : null;
  const chargeAmount = rate ? hnlCharge(input.amount, rate.hnlPerUsd) : input.amount;
  const result = await runQuery<SessionRow>(`INSERT INTO pay_sessions
    (id,event_id,launch_hash,customer_id,order_id,invoice_id,unit_id,client_name,unit_name,concept,currency,amount,bill_to,environment,return_url,expires_at,is_demo,portal_status,reference_usd_amount,usd_hnl_rate,fx_source,fx_rate_date,fx_fetched_at,checkout_source,storeganise_context,storeganise_status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$22,$14,now()+interval '30 minutes',$15,$16,$17,$18,$19,$20,$21,$23,$24,$25)
    ON CONFLICT(event_id) DO UPDATE SET updated_at=now() RETURNING *`,
    [id,input.eventId,sha(launchToken),input.customerId,input.orderId??null,input.invoiceId??null,input.unitId,input.clientName,input.unitName,input.concept,'HNL',chargeAmount,JSON.stringify(input.billTo),input.returnUrl??null,input.isDemo === true,'disabled',rate ? input.amount : null,rate?.hnlPerUsd??null,rate?.source??null,rate?.rateDate??null,rate?.fetchedAt??null,environment,source,input.storeganiseContext ? JSON.stringify(input.storeganiseContext) : null,input.storeganiseContext ? 'waiting_payment' : 'disabled']);
  return sessionResult(result.rows[0]);
}

export async function exchangeLaunchToken(launchToken: string) {
  const accessToken=token();
  const result=await query<SessionRow>(`UPDATE pay_sessions SET access_hash=$2,consumed_at=now(),updated_at=now()
    WHERE launch_hash=$1 AND consumed_at IS NULL AND expires_at>now() AND status IN ('open','declined') RETURNING *`,[sha(launchToken),sha(accessToken)]);
  if (result.rowCount) return { accessToken, session: result.rows[0] };
  const linked = await query<SessionRow>(`WITH claimed AS (
    UPDATE pay_launch_links SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now()
    RETURNING session_id
  ) UPDATE pay_sessions SET access_hash=$2,consumed_at=now(),updated_at=now()
    WHERE id IN (SELECT session_id FROM claimed) AND storeganise_context IS NOT NULL RETURNING *`, [sha(launchToken),sha(accessToken)]);
  if (!linked.rowCount) throw new Error('Invalid or expired session');
  return { accessToken, session: linked.rows[0] };
}

export async function getSession(accessToken: string) {
  const result=await query<SessionRow>("SELECT * FROM pay_sessions WHERE access_hash=$1 AND consumed_at > now()-interval '24 hours'",[sha(accessToken)]);
  if (!result.rowCount) throw new Error('Session not found'); return result.rows[0];
}

export function publicSession(row: SessionRow) {
  const legacyReview = needsLegacyPaymentReview(row);
  const status = legacyReview ? 'unknown' : ['open','declined'].includes(row.status) && row.expires_at.getTime() <= Date.now() ? 'expired' : row.status;
  const priceReference = row.currency === 'HNL' && row.reference_usd_amount != null && row.usd_hnl_rate != null ? {
    amount: Number(row.reference_usd_amount).toFixed(2), currency: 'USD' as const, hnlPerUsd: Number(row.usd_hnl_rate).toFixed(6),
    ...(row.fx_source === 'BCH' ? { source: 'BCH' as const, rateDate: row.fx_rate_date, fetchedAt: row.fx_fetched_at?.toISOString() } : {}),
  } : undefined;
  return { id:row.id,clientName:row.client_name,unitName:row.unit_name,concept:row.concept,currency:row.currency,amount:Number(row.amount).toFixed(2),status,portalStatus:row.portal_status,isDemo:row.is_demo,environment:row.environment,source:row.checkout_source ?? 'storeganise',
    ...(priceReference ? { priceReference } : {}),
    authenticationPending: row.status==='pending' && ['DEVICE_COLLECTION_REQUIRED','CHALLENGE_REQUIRED'].includes(row.gateway_status ?? ''),
    ...(['declined', 'unknown'].includes(status) ? { failureCode: legacyReview ? 'PAYMENT_NOT_CONFIRMED' : paymentFailureCode(row.failure_reason, row.gateway_status) } : {}),
    ...(row.storeganise_context ? {
      storeganise: { status: row.storeganise_status ?? 'waiting_payment', paymentId: row.storeganise_payment_id ?? undefined,
        returnUrl: storeganiseReturnUrl(row.return_url) },
      billingRequired: !billToSchema.safeParse(row.bill_to).success,
      billingDetails: row.bill_to,
    } : {}),
    ...(row.is_demo ? { gatewayStatus: row.gateway_status, failureReason: row.failure_reason, transactionId: row.gateway_transaction_id } : {}),
    ...(row.status==='succeeded'&&row.gateway_transaction_id?{receipt:{authCode:row.authorization_code,transactionId:row.gateway_transaction_id,date:(row.paid_at??row.created_at).toISOString(),cardLast4:row.card_last4,cardBrand:row.card_brand,amount:Number(row.amount).toFixed(2),unit:row.unit_name,client:row.client_name,currency:row.currency,...(priceReference ? { priceReference } : {})}}:{}) };
}

export async function beginAttempt(sessionId:string, tokenJti?:string, mode: 'payment' | 'authorization_only' = 'payment', billingDetails?: unknown) {
 return transaction(async client=>{ const locked=await client.query<SessionRow>('SELECT * FROM pay_sessions WHERE id=$1 FOR UPDATE',[sessionId]); const session=locked.rows[0];
   if (!session) throw new Error('Session missing');
   if (session.environment !== gatewayEnvironment()) throw new Error('Session belongs to a different gateway environment');
   if (session.environment === 'production') {
     if (session.is_demo || mode !== 'payment') throw new Error('Test attempts cannot use production');
     await loadCredentials('production');
   }
   if (session.currency !== 'HNL') throw new Error('Create a new checkout with an HNL charge');
   if (session.fx_source === 'BCH' && (!session.reference_usd_amount || !session.usd_hnl_rate || !session.fx_rate_date || !session.fx_fetched_at ||
     hnlCharge(Number(session.reference_usd_amount).toFixed(2), session.usd_hnl_rate) !== Number(session.amount).toFixed(2))) throw new Error('Invalid stored exchange quote');
   if (session.is_demo && !demoScenarioForAmount(Number(session.fx_source === 'BCH' ? session.reference_usd_amount : session.amount).toFixed(2), session.fx_source === 'BCH' ? 'USD' : 'HNL')) throw new Error('Create an allowed sandbox demo');
   if (mode === 'authorization_only' && !session.is_demo) throw new Error('Diagnostic requires an isolated demo');
   if (needsLegacyPaymentReview(session)) throw new Error('Existing transaction must be reconciled before retrying');
   if (!['open','declined'].includes(session.status)) throw new Error('Payment already active or closed');
   if (session.expires_at.getTime() <= Date.now()) throw new Error('Session expired');
   if (session.storeganise_context) {
     const details = billToSchema.parse(billingDetails ?? session.bill_to);
     await client.query('UPDATE pay_sessions SET bill_to=$2 WHERE id=$1', [sessionId, JSON.stringify(details)]);
     session.bill_to = details;
   }
   const c=await client.query<{n:number}>('SELECT count(*)::int n FROM pay_attempts WHERE session_id=$1',[sessionId]); const n=c.rows[0].n+1; const id=crypto.randomUUID(); const reference=`RSS-${sessionId}-${n}`;
   await client.query("UPDATE pay_sessions SET status='processing',gateway_transaction_id=NULL,authorization_code=NULL,gateway_status=NULL,failure_reason=NULL,updated_at=now() WHERE id=$1",[sessionId]);
   await client.query("INSERT INTO pay_attempts(id,session_id,attempt_no,status,reference,token_jti,payment_mode) VALUES($1,$2,$3,'processing',$4,$5,$6)",[id,sessionId,n,reference,tokenJti??null,mode]);
   return {id,reference,session}; });
}

export interface AuthenticationState {
  phase: 'device' | 'challenge'; referenceId: string; device: BrowserDevice;
  setupId?: string;
  enrollmentId?: string;
  authentication?: { authenticationTransactionId?: string };
}

export async function activeAttempt(sessionId:string) {
  const result = await query<{ id:string; reference:string; token_jti?:string; response?:AuthenticationState }>(
    "SELECT id,reference,token_jti,response FROM pay_attempts WHERE session_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1", [sessionId]);
  if (!result.rows[0]) throw new Error('Authentication attempt missing');
  return result.rows[0];
}

/** Claim the pending challenge once, before any request that could authorize. */
export async function claimAuthentication(sessionId: string, attemptId: string, tokenId: string, phase: 'device' | 'challenge') {
  return transaction(async client => {
    const claimed = await client.query("UPDATE pay_attempts SET status='processing',updated_at=now() WHERE id=$1 AND session_id=$2 AND token_jti=$3 AND status='pending' AND response->>'phase'=$4 RETURNING id", [attemptId, sessionId, tokenId, phase]);
    if (!claimed.rowCount) throw new Error('Authentication is already being processed');
    const session = await client.query("UPDATE pay_sessions SET status='processing',updated_at=now() WHERE id=$1 AND status='pending' RETURNING id", [sessionId]);
    if (!session.rowCount) throw new Error('Session is no longer awaiting authentication');
  });
}

export async function finishAttempt(attemptId:string,result:{status:string;transactionId?:string;gatewayStatus:string;authorizationCode?:string;brand?:string;last4?:string;reason?:string;response?:unknown}) {
 const status=['succeeded','authorized','declined','pending','unknown'].includes(result.status)?result.status:'unknown';
 if (['succeeded','authorized'].includes(status)&&!result.transactionId) throw new Error('A confirmed transaction is required');
 return transaction(async client=>{
   const current=await client.query<{session_id:string;status:string;payment_mode:string}>('SELECT session_id,status,payment_mode FROM pay_attempts WHERE id=$1 FOR UPDATE',[attemptId]);
   if(!current.rows[0])throw new Error('Attempt not found');
   if (status==='succeeded' && current.rows[0].payment_mode!=='payment') throw new Error('Authorization-only is not a payment');
   if (status==='authorized' && current.rows[0].payment_mode!=='authorization_only') throw new Error('Unexpected authorization-only result');
   const session=await client.query<SessionRow>('SELECT * FROM pay_sessions WHERE id=$1 FOR UPDATE',[current.rows[0].session_id]);
   const latest=await client.query<{id:string}>('SELECT id FROM pay_attempts WHERE session_id=$1 ORDER BY attempt_no DESC LIMIT 1',[current.rows[0].session_id]);
   if (latest.rows[0]?.id !== attemptId) return session.rows[0];
   if(['succeeded','authorized'].includes(current.rows[0].status)||['voided','cancelling'].includes(session.rows[0].status))return session.rows[0];
   if(current.rows[0].status==='declined'&&status!=='declined')throw new Error('Cannot overwrite a closed attempt');
   const a=await client.query<{session_id:string}>('UPDATE pay_attempts SET status=$2,gateway_transaction_id=COALESCE($3,gateway_transaction_id),gateway_status=$4,response=$5,updated_at=now() WHERE id=$1 RETURNING session_id',[attemptId,status,result.transactionId??null,result.gatewayStatus,JSON.stringify(result.response??{})]);
   const sid=a.rows[0].session_id; await client.query(`UPDATE pay_sessions SET status=$2,gateway_transaction_id=COALESCE($3,gateway_transaction_id),authorization_code=COALESCE($4,authorization_code),card_brand=COALESCE($5,card_brand),card_last4=COALESCE($6,card_last4),gateway_status=$7,failure_reason=$8,paid_at=CASE WHEN $2='succeeded' THEN now() ELSE paid_at END,updated_at=now() WHERE id=$1`,[sid,status,result.transactionId??null,result.authorizationCode??null,result.brand??null,result.last4??null,result.gatewayStatus,result.reason??null]);
   if(status==='succeeded' && session.rows[0].storeganise_context && !session.rows[0].is_demo) {
     await client.query(`INSERT INTO storeganise_deliveries(session_id,transaction_id)
       VALUES($1,$2) ON CONFLICT(session_id) DO NOTHING`, [sid,result.transactionId]);
     await client.query("UPDATE pay_sessions SET storeganise_status='pending',portal_status='disabled' WHERE id=$1 AND storeganise_status='waiting_payment'", [sid]);
   }
   const s=await client.query<SessionRow>('SELECT * FROM pay_sessions WHERE id=$1',[sid]); return s.rows[0]; });
}

export function requiredUrl(name:string){const value=process.env[name];if(!value)throw new Error(`${name} is required`);const url=new URL(value);if(url.protocol!=='https:'&&url.hostname!=='localhost')throw new Error(`${name} must use HTTPS`);return url.origin+url.pathname.replace(/\/$/,'');}
