import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTransaction } from '../lib/cybersource/reconciliation';

const expected = { transactionId: '7903919901706454604807', reference: 'RSS-test-1', amount: '1.00', currency: 'USD', mode: 'payment' };
const base = { id: expected.transactionId, clientReferenceInformation: { code: expected.reference }, orderInformation: { amountDetails: { totalAmount: '1', currency: 'USD' } } };
const success = (name: string) => ({ name, reasonCode: '100', rCode: '1', rFlag: 'SOK' });

test('successful enrollment and processor error 150 never become a paid invoice', () => {
  const result = reconcileTransaction({ ...base, applicationInformation: { applications: [success('ics_pa_enroll'),
    { name: 'ics_auth', reasonCode: '150', rCode: '-1', rFlag: 'ESYSTEM', rMessage: 'This field is invalid or missing: merchant_id' }, { name: 'ics_bill' }] } }, expected);
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'PROCESSOR_MERCHANT_ID_INVALID_OR_MISSING');
});

test('authorization-only diagnostic never produces a paid receipt', () => {
  const data = { ...base, applicationInformation: { applications: [success('ics_auth')] } };
  assert.equal(reconcileTransaction(data, { ...expected, mode: 'authorization_only' }).status, 'authorized');
  assert.equal(reconcileTransaction(data, expected).status, 'unknown');
  assert.equal(reconcileTransaction({ ...data, applicationInformation: { applications: [success('ics_auth'), success('ics_bill')] } }, expected).status, 'succeeded');
});

test('different customer reference, amount, currency or ID cannot reconcile another session', () => {
  const data = { ...base, applicationInformation: { applications: [success('ics_auth'), success('ics_bill')] } };
  for (const override of [{ reference: 'RSS-other-1' }, { amount: '2.00' }, { currency: 'HNL' }, { transactionId: 'other' }]) {
    const result = reconcileTransaction(data, { ...expected, ...override });
    assert.equal(result.status, 'unknown'); assert.equal(result.gatewayStatus, 'RECONCILIATION_MISMATCH');
  }
});

test('only an explicit authorization decline closes a failed payment', () => {
  const result = reconcileTransaction({ ...base, applicationInformation: { applications: [{ name: 'ics_auth', reasonCode: '203', rCode: '0', rFlag: 'DCARDREFUSED' }] } }, expected);
  assert.equal(result.status, 'declined');
  assert.equal(reconcileTransaction({ ...base, applicationInformation: { applications: [success('ics_pa_enroll')] } }, expected).status, 'unknown');
});
