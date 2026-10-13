type Language = 'es' | 'en';
const say = (language: Language, es: string, en: string) => language === 'es' ? es : en;

/** Only these application-owned codes reach customers; never a raw provider message. */
export function paymentFailureCode(reason: string | null | undefined, status: string | null | undefined): string {
  if(['INVOICE_AMOUNT_CHANGED','INVOICE_NOT_PAYABLE','CUSTOMER_DISABLED'].includes(reason??''))return 'STOREGANISE_ORDER_CHANGED';
  if (status === 'AUTHORIZED_CAPTURE_FAILED') return 'CAPTURE_FAILED';
  if (status === 'AUTHORIZED_CAPTURE_UNCONFIRMED') return 'CAPTURE_NOT_CONFIRMED';
  if (['HTTP_401', 'HTTP_403', 'HTTP_404', 'AUTHENTICATION_SETUP_FAILED'].includes(status ?? '') ||
    ['AUTHENTICATION_FAILED', 'SETUP_UNAVAILABLE'].includes(reason ?? '')) return 'SETUP_UNAVAILABLE';
  if (['EXPIRED_CARD', 'CARD_EXPIRED'].includes(reason ?? '')) return 'CARD_EXPIRED';
  if (['INVALID_DATA', 'MISSING_FIELD'].includes(reason ?? '')) return 'PAYMENT_REQUEST_INVALID';
  if (['INVALID_ACCOUNT', 'INVALID_PAYMENT_DATA', 'CARD_DETAILS_INVALID'].includes(reason ?? '')) return 'CARD_DETAILS_INVALID';
  if (['CONSUMER_AUTHENTICATION_FAILED', 'AUTHENTICATION_NOT_CONFIRMED'].includes(reason ?? '') ||
    status === 'AUTHENTICATION_FAILED') return 'CONSUMER_AUTHENTICATION_FAILED';
  if (status === 'DECLINED' || status?.startsWith('AUTHORIZATION_DECLINED_') ||
    ['CARD_DECLINED', 'INSUFFICIENT_FUND', 'CREDIT_LIMIT_EXCEEDED', 'DO_NOT_HONOR'].includes(reason ?? '')) return 'CARD_DECLINED';
  return 'PAYMENT_NOT_CONFIRMED';
}

export function paymentFailureMessage(reason: string | undefined, status: string | undefined, language: Language) {
  if(['STOREGANISE_ORDER_CHANGED','INVOICE_AMOUNT_CHANGED','INVOICE_NOT_PAYABLE','CUSTOMER_DISABLED'].includes(reason??''))return say(language,'La reserva o su saldo cambió en Storeganise. Regrese a su cuenta y abra nuevamente el enlace de pago.','Your booking or balance changed in Storeganise. Return to your account and open the payment link again.');
  if(reason==='BILLING_DETAILS_REQUIRED')return say(language,'Complete la dirección de facturación de su tarjeta para continuar.','Complete your card billing address to continue.');
  if(reason?.startsWith('STOREGANISE_'))return say(language,'No se pudo confirmar su reserva con Storeganise. Intente más tarde; no se inició el cobro.','Your booking could not be confirmed with Storeganise. Try later; no charge was started.');
  if (reason === 'CAPTURE_FAILED' || status === 'AUTHORIZED_CAPTURE_FAILED') {
    return say(language, 'La tarjeta fue autorizada, pero no se pudo completar el cobro. No repita el pago; contacte a Roatan Self Storage para revisar esta operación.', 'The card was authorized, but the payment could not be completed. Do not pay again; contact Roatan Self Storage to review this transaction.');
  }
  if (reason === 'CAPTURE_NOT_CONFIRMED' || status === 'AUTHORIZED_CAPTURE_UNCONFIRMED') {
    return say(language, 'La tarjeta fue autorizada. Estamos verificando la confirmación del cobro. No repita el pago.', 'The card was authorized. We are checking payment completion. Do not pay again.');
  }
  if (reason === 'PAYMENT_REQUEST_INVALID') return say(language, 'No se pudo procesar la solicitud de pago por un dato enviado al servicio de pagos. Contacte a Roatan Self Storage.', 'The payment request could not be processed because of data sent to the payment service. Contact Roatan Self Storage.');
  if (reason === 'PAYMENT_NOT_CONFIRMED') return say(language, 'No se confirmó el pago. Consulte el estado de esta operación antes de intentar nuevamente.', 'Payment has not been confirmed. Check this transaction before trying again.');
  if (['HTTP_401', 'HTTP_403', 'HTTP_404', 'AUTHENTICATION_SETUP_FAILED'].includes(status ?? '') ||
    ['AUTHENTICATION_FAILED', 'SETUP_UNAVAILABLE'].includes(reason ?? '')) {
    return say(language, 'El servicio de pago no está disponible. Contacte a Roatan Self Storage para continuar.', 'The payment service is unavailable. Contact Roatan Self Storage to continue.');
  }
  if (reason === 'EXPIRED_CARD' || reason === 'CARD_EXPIRED') return say(language, 'La tarjeta está vencida. Verifique el vencimiento o utilice otra tarjeta.', 'The card has expired. Check the expiry date or use another card.');
  if (['INVALID_DATA', 'MISSING_FIELD', 'INVALID_ACCOUNT', 'INVALID_PAYMENT_DATA', 'CARD_DETAILS_INVALID'].includes(reason ?? '')) {
    return say(language, 'Revise el número de tarjeta, vencimiento, CVV y datos de facturación antes de continuar.', 'Check the card number, expiry, security code and billing details before continuing.');
  }
  if (['CONSUMER_AUTHENTICATION_FAILED', 'AUTHENTICATION_NOT_CONFIRMED'].includes(reason ?? '') || status === 'AUTHENTICATION_FAILED') {
    return say(language, 'No se completó la verificación del banco. Vuelva a verificar su tarjeta o consulte con su banco.', 'Bank verification was not completed. Verify your card again or contact your bank.');
  }
  if (status?.startsWith('HTTP_') || status === 'INVALID_REQUEST') return say(language, 'No se pudo procesar la solicitud de pago. Revise sus datos o contacte a Roatan Self Storage.', 'The payment request could not be processed. Check your details or contact Roatan Self Storage.');
  return say(language, 'El pago fue rechazado. Consulte con su banco o utilice otra tarjeta.', 'The payment was declined. Contact your bank or use another card.');
}
