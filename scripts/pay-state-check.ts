import assert from 'node:assert/strict';
import { closeDatabase, query } from '../lib/pay/db';
import { demoCheckout } from '../lib/pay/demo';
import { beginAttempt, claimAuthentication, createCheckoutSession, finishAttempt } from '../lib/pay/service';

/** Database concurrency regression only: no request to the payment gateway. */
async function main() {
  const checkout = await createCheckoutSession(demoCheckout('a', 'hnl100'));
  const token = `state-check-${crypto.randomUUID()}`;
  const starts = await Promise.allSettled([beginAttempt(checkout.id, token), beginAttempt(checkout.id, token)]);
  assert.equal(starts.filter(r => r.status === 'fulfilled').length, 1);
  const attempt = starts.find(r => r.status === 'fulfilled');
  assert.ok(attempt && attempt.status === 'fulfilled');
  const id = attempt.value.id;
  await finishAttempt(id, { status: 'pending', gatewayStatus: 'DEVICE_COLLECTION_REQUIRED', response: { phase: 'device' } });
  const claims = await Promise.allSettled([claimAuthentication(checkout.id, id, token, 'device'), claimAuthentication(checkout.id, id, token, 'device')]);
  assert.equal(claims.filter(r => r.status === 'fulfilled').length, 1, 'Only one completion can continue');
  await finishAttempt(id, { status: 'pending', gatewayStatus: 'CHALLENGE_REQUIRED', response: { phase: 'challenge' } });
  await assert.rejects(claimAuthentication(checkout.id, id, token, 'device'), 'A stale device callback cannot claim a challenge');
  await assert.rejects(claimAuthentication(crypto.randomUUID(), id, token, 'challenge'), 'Another session cannot claim this attempt');
  await assert.rejects(claimAuthentication(checkout.id, id, 'another-token', 'challenge'));
  const challenges = await Promise.allSettled([claimAuthentication(checkout.id, id, token, 'challenge'), claimAuthentication(checkout.id, id, token, 'challenge')]);
  assert.equal(challenges.filter(r => r.status === 'fulfilled').length, 1);
  await finishAttempt(id, { status: 'declined', gatewayStatus: 'STATE_CHECK_NO_PAYMENT', reason: 'No gateway request was sent' });
  const rows = await query('SELECT count(*)::int AS count FROM pay_attempts WHERE session_id=$1', [checkout.id]);
  assert.equal(rows.rows[0].count, 1);
  const next = await beginAttempt(checkout.id, `${token}-next`);
  const late = await finishAttempt(id, { status: 'declined', gatewayStatus: 'LATE_OLD_RESPONSE' });
  assert.equal(late.status, 'processing', 'Late response from an old attempt cannot overwrite a new one');
  await finishAttempt(next.id, { status: 'declined', gatewayStatus: 'STATE_CHECK_NO_PAYMENT' });
  console.log(JSON.stringify({ sessionId: checkout.id, concurrentStarts: 'blocked', concurrentCallbacks: 'blocked', stalePhase: 'blocked', crossSession: 'blocked', lateResponse: 'blocked', gatewayRequests: 0 }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'State check failed'); process.exitCode = 1; }).finally(closeDatabase);
