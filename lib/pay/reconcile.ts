import { CyberSourceGateway } from '../cybersource/gateway';
import { reconcileTransaction } from '../cybersource/reconciliation';
import { query } from './db';
import { finishAttempt } from './service';
import type { SessionRow } from './types';
import { LEGACY_PAYMENT_ERROR_STATUSES } from './payment-state';

/** Read-only at the gateway; a durable throttle also prevents parallel browser polls. */
export async function reconcileSession(sessionId: string) {
  // Recover the latest legacy HTTP-error attempt for read-only verification.
  // Do not reopen it for charging, or change an older attempt/current approval.
  const recovered = await query<SessionRow>(`WITH legacy AS (
    UPDATE pay_attempts a SET status='unknown',updated_at=now() FROM pay_sessions s
    WHERE a.session_id=s.id AND s.id=$1 AND s.status='declined' AND a.status='declined'
      AND a.gateway_transaction_id IS NOT NULL AND a.gateway_transaction_id=s.gateway_transaction_id
      AND a.gateway_status=ANY($2::text[]) AND s.gateway_status=ANY($2::text[])
      AND a.attempt_no=(SELECT max(p.attempt_no) FROM pay_attempts p WHERE p.session_id=s.id)
    RETURNING a.session_id
  ) UPDATE pay_sessions SET status='unknown',updated_at=now()
    WHERE id IN (SELECT session_id FROM legacy) AND status='declined' RETURNING *`, [sessionId, LEGACY_PAYMENT_ERROR_STATUSES]);
  // A crashed request must not leave an endless spinner or reopen a charge.
  const stale = await query<SessionRow>(`WITH stopped AS (
    UPDATE pay_attempts SET status='unknown',gateway_status='SERVER_RESULT_UNCONFIRMED',updated_at=now()
    WHERE session_id=$1 AND status='processing' AND updated_at < now()-interval '2 minutes' RETURNING session_id
  ) UPDATE pay_sessions SET status='unknown',gateway_status='SERVER_RESULT_UNCONFIRMED',updated_at=now()
    WHERE id IN (SELECT session_id FROM stopped) AND status='processing' RETURNING *`, [sessionId]);
  const claimed = await query<{ id: string; gateway_transaction_id: string; reference: string; payment_mode: string; amount: string; currency: string; environment: SessionRow['environment'] }>(`
    UPDATE pay_attempts a SET last_reconciled_at=now() FROM pay_sessions s
    WHERE a.session_id=s.id AND s.id=$1 AND a.status IN ('pending','unknown')
      AND s.status IN ('pending','unknown') AND a.gateway_transaction_id IS NOT NULL
      AND a.attempt_no=(SELECT max(p.attempt_no) FROM pay_attempts p WHERE p.session_id=s.id)
      AND (a.last_reconciled_at IS NULL OR a.last_reconciled_at < now()-interval '30 seconds')
    RETURNING a.id,a.gateway_transaction_id,a.reference,a.payment_mode,s.amount,s.currency,s.environment`, [sessionId]);
  const attempt = claimed.rows[0];
  if (!attempt) return stale.rows[0] ?? recovered.rows[0];
  try {
    const data = await new CyberSourceGateway(attempt.environment).getPayment(attempt.gateway_transaction_id);
    const result = reconcileTransaction(data, { transactionId: attempt.gateway_transaction_id, reference: attempt.reference,
      amount: Number(attempt.amount).toFixed(2), currency: attempt.currency, mode: attempt.payment_mode });
    // Persist only normalized results; Transaction Search may include sensitive card data.
    return await finishAttempt(attempt.id, { ...result, response: result });
  } catch { /* An unavailable search result does not authorize a second charge. */ }
  return stale.rows[0] ?? recovered.rows[0];
}
