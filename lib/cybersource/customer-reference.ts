import crypto from 'node:crypto';

/**
 * merchantCustomerId also maps to purchaser_code at capture (default limit: 15).
 * https://developer.cybersource.com/docs/cybs/en-us/api-fields/reference/all/so/api-fields/buyer-info-merchant-customer-id.html
 * This is processor metadata only. Session/order references and the original
 * Storeganise customer ID remain the authoritative payment-to-customer binding.
 */
export function merchantCustomerReference(customerId: string): string {
  if (/^[A-Za-z0-9_-]{1,15}$/.test(customerId)) return customerId;
  // Hash the whole ID rather than truncating IDs that may share a prefix.
  return crypto.createHash('sha256').update(customerId, 'utf8').digest('hex').slice(0, 15);
}
