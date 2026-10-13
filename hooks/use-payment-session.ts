'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_AMOUNTS, DEMO_SCENARIOS, demoCurrency, DEFAULT_DEMO_SCENARIO, type DemoScenario } from '@/lib/pay/demo-scenarios';
import type { BillTo } from '@/lib/cybersource/types';

export interface PriceReference {
  amount: string; currency: 'USD'; hnlPerUsd: string;
  source?: 'BCH'; rateDate?: string | null; fetchedAt?: string;
}

export interface PaymentReceipt {
  priceReference?: PriceReference;
  authCode?: string;
  transactionId: string;
  date: string;
  cardLast4?: string;
  cardBrand?: string;
  amount: string;
  unit: string;
  client: string;
  currency: string;
}

export interface PaymentSession {
  priceReference?: PriceReference;
  id: string;
  clientName: string;
  unitName: string;
  concept: string;
  currency: string;
  amount: string;
  status: string;
  portalStatus?: string;
  receipt?: PaymentReceipt;
  isDemo?: boolean;
  environment?: string;
  source?: 'manual' | 'storeganise';
  gatewayStatus?: string;
  failureReason?: string;
  failureCode?: string;
  transactionId?: string;
  authenticationPending?: boolean;
  billingRequired?: boolean;
  billingDetails?: BillTo;
  storeganise?: { status: string; paymentId?: string; returnUrl: string };
}

export interface BankAuthentication {
  step: 'device' | 'challenge';
  accessToken: string;
  url: string;
  referenceId?: string;
  transactionId?: string;
}

interface PaymentResponse {
  session: PaymentSession;
  authentication?: BankAuthentication;
}

class PaymentRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export async function paymentRequest<T>(path: string, body?: unknown): Promise<T> {
  const sessionId = window.sessionStorage.getItem('pay-session-id');
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { ...(sessionId ? { 'x-pay-session': sessionId } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(65_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !(response.status === 402 && payload && typeof payload === 'object' && 'session' in payload)) throw new PaymentRequestError(response.status, payload.error ?? 'PAY_REQUEST_FAILED');
  return payload as T;
}

export function usePaymentSession(manualSandboxEnabled = false) {
  const [session, setSession] = useState<PaymentSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [localDemoUnavailable, setLocalDemoUnavailable] = useState(false);
  const [exchangeRateUnavailable, setExchangeRateUnavailable] = useState(false);
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [authentication, setAuthentication] = useState<BankAuthentication | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [preparingManual, setPreparingManual] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const manualInFlight = useRef(false);
  const inFlight = useRef(false);
  const initialRequest = useRef<Promise<PaymentResponse | null> | null>(null);
  const transientToken = useRef<string | null>(null);

  const acceptResponse = useCallback((result: PaymentResponse) => {
    setSession(result.session);
    window.sessionStorage.setItem('pay-session-id',result.session.id);
    setAuthentication(previous => result.authentication ?? (result.session.status === 'pending' ? previous : null));
    setError(false);
    setUncertain(false);
    setRequestError(null);
    return result;
  }, []);

  const refresh = useCallback(async () => {
    const result = await paymentRequest<PaymentResponse>('/api/pay/session');
    return acceptResponse(result);
  }, [acceptResponse]);

  const startManual = useCallback(async (details: { clientName: string; unitName: string; amount: string }) => {
    if (manualInFlight.current) return false;
    manualInFlight.current = true;
    setPreparingManual(true); setManualError(null);
    try {
      const fingerprint = JSON.stringify(details);
      let saved: { fingerprint?: string; reference?: string } | null = null;
      try { saved = JSON.parse(window.sessionStorage.getItem('pay-manual-draft') ?? 'null'); } catch { /* New draft. */ }
      const reference = saved?.fingerprint === fingerprint && saved.reference ? saved.reference : crypto.randomUUID();
      window.sessionStorage.setItem('pay-manual-draft', JSON.stringify({ fingerprint, reference }));
      let result: PaymentResponse;
      try { result = await paymentRequest<PaymentResponse>('/api/pay/manual', { ...details, reference }); }
      catch (failure) {
        if (failure instanceof PaymentRequestError && failure.status < 500) throw failure;
        // This endpoint only prepares a session. Reuse its reference after a lost response.
        await new Promise(resolve => setTimeout(resolve, 500));
        result = await paymentRequest<PaymentResponse>('/api/pay/manual', { ...details, reference });
      }
      acceptResponse(result);
      window.sessionStorage.removeItem('pay-manual-draft');
      return true;
    } catch (failure) {
      const code = failure instanceof PaymentRequestError ? failure.code : 'MANUAL_SESSION_UNAVAILABLE';
      setManualError(code);
      if (code === 'MANUAL_SESSION_EXPIRED') window.sessionStorage.removeItem('pay-manual-draft');
      return false;
    } finally { manualInFlight.current = false; setPreparingManual(false); }
  }, [acceptResponse]);


  useEffect(() => {
    let active = true;
    if (!initialRequest.current) {
      const url = new URL(window.location.href);
      const token = url.searchParams.get('session');
      const scenario = url.searchParams.get('scenario') ?? DEFAULT_DEMO_SCENARIO;
      url.searchParams.delete('session');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      initialRequest.current = (async () => {
        if (token) return paymentRequest<PaymentResponse>('/api/pay/session', { token });
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        const requestedDemo = local && (url.searchParams.has('demo') || url.searchParams.has('scenario'));
        // Opening the public carousel must not create a session or contact payment services.
        if (!window.sessionStorage.getItem('pay-session-id') && !requestedDemo) return null;
        try {
          const existing = await paymentRequest<PaymentResponse>('/api/pay/session');
          if (manualSandboxEnabled && !requestedDemo && existing.session.source === 'manual' && existing.session.status === 'expired') {
            window.sessionStorage.removeItem('pay-session-id');
            return null;
          }
          if (!(requestedDemo && existing.session.isDemo && (existing.session.status === 'expired' ||
            (DEMO_SCENARIOS.includes(scenario as DemoScenario) && ['open','declined'].includes(existing.session.status) &&
              (demoCurrency(scenario as DemoScenario) === 'USD'
                ? existing.session.priceReference?.source !== 'BCH' || existing.session.priceReference.amount !== DEMO_AMOUNTS[scenario as DemoScenario]
                : existing.session.priceReference?.source === 'BCH' || existing.session.currency !== 'HNL' || existing.session.amount !== DEMO_AMOUNTS[scenario as DemoScenario]))))) return existing;
        } catch (failure) {
          if (manualSandboxEnabled && !requestedDemo && failure instanceof PaymentRequestError &&
            (failure.status === 401 || failure.code === 'SESSION_ENVIRONMENT_CHANGED')) {
            window.sessionStorage.removeItem('pay-session-id');
            return null;
          }
          if (!requestedDemo || !(failure instanceof PaymentRequestError) || failure.status !== 401) throw failure;
        }
        try {
          return await paymentRequest<PaymentResponse>('/api/pay/demo', { variant: url.searchParams.get('demo') === 'b' ? 'b' : 'a', scenario });
        } catch (failure) {
          if (failure instanceof PaymentRequestError && failure.code === 'EXCHANGE_RATE_UNAVAILABLE') setExchangeRateUnavailable(true);
          else if (failure instanceof PaymentRequestError && failure.status === 503) setLocalDemoUnavailable(true);
          throw failure;
        }
      })();
    }
    initialRequest.current.then((result) => {
      if (active && result) acceptResponse(result);
    }).catch(() => {
      if (active) setError(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [acceptResponse, manualSandboxEnabled]);

  const pending = uncertain || ['processing', 'unknown', 'pending', 'reconciling'].includes(session?.status ?? '');
  const awaitingStoreganise = Boolean(session?.receipt && session.storeganise && session.storeganise.status !== 'active');
  const sessionId = session?.id;

  useEffect(() => {
    if (!sessionId || authentication || (!pending && !awaitingStoreganise)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); } catch { /* Keep the prior state; an unknown result never allows another charge. */ }
      if (active) timer = setTimeout(poll, awaitingStoreganise ? 15000 : 4000);
    };
    timer = setTimeout(poll, 4000);
    return () => { active = false; clearTimeout(timer); };
  }, [sessionId, pending, awaitingStoreganise, authentication, refresh]);

  const submit = useCallback(async (path: string, body: unknown) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(false);
    setRequestError(null);
    try {
      return acceptResponse(await paymentRequest<PaymentResponse>(path, body));
    } catch (failure) {
      if (failure instanceof PaymentRequestError && ['INVALID_PAYMENT_DATA', 'CARD_EXPIRED', 'BILLING_DETAILS_REQUIRED',
        'INVOICE_AMOUNT_CHANGED','INVOICE_NOT_PAYABLE','CUSTOMER_DISABLED','STOREGANISE_CHECKOUT_UNAVAILABLE',
        'STOREGANISE_PAY_DISABLED','STOREGANISE_SANDBOX_INSTANCE_REQUIRED','STOREGANISE_INSTANCE_ENVIRONMENT_MISMATCH'].includes(failure.code)) {
        setRequestError(failure.code); setUncertain(false); return;
      }
      // The request may have reached the processor. Consult durable server state,
      // and do not turn a lost HTTP response into an invitation to charge again.
      setUncertain(true);
      setError(true);
      try { await refresh(); } catch { /* Poll until the server can establish the result. */ }
      setError(true);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, [acceptResponse, refresh]);

  return {
    session, loading, error, pending, authentication, localDemoUnavailable, exchangeRateUnavailable,
    requestError, preparingManual, manualError, startManual,
    busy: submitting || session?.status === 'processing' || Boolean(authentication),
    requiresReview: uncertain || ['unknown', 'reconciling'].includes(session?.status ?? ''),
    interruptedAuthentication: session?.authenticationPending && !authentication,
    canPay: Boolean(session && ['open', 'ready', 'created', 'declined', 'failed'].includes(session.status) && !submitting && !pending && !authentication),
    refresh,
    completeAuthentication: () => submit('/api/pay/authentication', { transientToken: transientToken.current, step: authentication?.step,
      ...(authentication?.transactionId ? { authenticationTransactionId: authentication.transactionId } : {}) }),
    restartAuthentication: async () => {
      const result = await submit('/api/pay/authentication/restart', {});
      if (result?.session.status === 'declined') window.location.reload();
    },
    pay: (body: unknown) => {
      if (body && typeof body === 'object' && 'transientToken' in body && typeof body.transientToken === 'string') transientToken.current = body.transientToken;
      return submit('/api/pay/payments', body);
    },
  };
}
