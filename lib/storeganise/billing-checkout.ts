import { openStoreganiseCheckout } from './checkout';

/** A signed handoff identifies an existing order/invoice; Pay resolves every amount by API. */
export async function handleBillingCheckout(payload: Record<string, unknown>) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {};
  const checkout = await openStoreganiseCheckout({ userId:data.userId,invoiceId:data.invoiceId,
    orderId:data.orderId,jobId:data.jobId,returnUrl:data.returnUrl ?? payload.returnUrl });
  const url = checkout.url.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  return { ...checkout, html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${url}"><title>Roatan Self Storage</title></head><body><a href="${url}">Continuar al pago</a></body></html>` };
}

