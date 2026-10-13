interface StoredPaymentState {
  status: string;
  gateway_status?: string | null;
  gateway_transaction_id?: string | null;
}

export const LEGACY_PAYMENT_ERROR_STATUSES = ['HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_422', 'INVALID_REQUEST', 'FAILED'];

/** Older versions treated a Payments HTTP error as a decline even after authorization. */
export function needsLegacyPaymentReview(row: StoredPaymentState): boolean {
  return row.status === 'declined' && Boolean(row.gateway_transaction_id) &&
    LEGACY_PAYMENT_ERROR_STATUSES.includes(row.gateway_status ?? '');
}
