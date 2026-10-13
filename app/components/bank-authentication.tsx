'use client';

import { useEffect, useRef } from 'react';
import type { BankAuthentication as Authentication } from '@/hooks/use-payment-session';

export function BankAuthentication({ authentication, onComplete, onCancel, language }: {
  authentication: Authentication; onComplete(): void; onCancel(): void; language: 'es' | 'en';
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);
  const completed = useRef(false);
  const callback = useRef(onComplete);
  useEffect(() => { callback.current = onComplete; }, [onComplete]);
  const device = authentication.step === 'device';
  useEffect(() => {
    const complete = () => {
      if (completed.current) return;
      completed.current = true;
      callback.current();
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow) return;
      let data = event.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return; } }
      if (device) {
        const expectedOrigin = new URL(authentication.url).origin;
        if (['https://centinelapistag.cardinalcommerce.com', 'https://centinelapi.cardinalcommerce.com'].includes(expectedOrigin) &&
          event.origin === expectedOrigin && data?.MessageType === 'profile.completed') complete();
      } else if (event.origin === window.location.origin && data?.type === 'cybersource-authentication' &&
        data.transactionId === authentication.transactionId) complete();
    };
    window.addEventListener('message', receive);
    // CyberSource permits enrollment after 10s with the browser fields as backup.
    const timer = device ? setTimeout(complete, 10000) : undefined;
    if (!submitted.current) { submitted.current = true; form.current?.submit(); }
    return () => { window.removeEventListener('message', receive); if (timer) clearTimeout(timer); };
  }, [device, authentication.transactionId, authentication.url]);
  const content = <>
    <iframe ref={iframe} title={language === 'es' ? 'Verificación bancaria 3D Secure' : '3D Secure bank verification'}
      name={device ? 'cybersource-device-iframe' : 'cybersource-step-up-iframe'}
      className={device ? 'h-[10px] w-[10px]' : 'h-[600px] w-full rounded-lg border border-slate-200'}
      sandbox="allow-forms allow-scripts allow-same-origin allow-popups" />
    <form ref={form} method="post" action={authentication.url} target={device ? 'cybersource-device-iframe' : 'cybersource-step-up-iframe'}>
      <input type="hidden" name="JWT" value={authentication.accessToken} />
    </form>
  </>;
  if (device) return <div className="hidden" aria-hidden="true">{content}</div>;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4">
    <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-2xl">
      <p className="mb-3 text-sm font-bold text-slate-800">{language === 'es' ? 'Verificación de su banco' : 'Bank verification'}</p>
      {content}
      <p className="mt-3 text-xs text-slate-600">{language === 'es' ? 'Si ya completó la verificación del banco y esta ventana sigue abierta, consulte el resultado.' : 'If you completed the bank verification and this window is still open, check the result.'}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="rounded-lg bg-[#1F5C4F] px-4 py-2 text-sm font-bold text-white" onClick={onComplete}>{language === 'es' ? 'Ya completé la verificación' : 'I completed verification'}</button>
        <button type="button" className="text-sm underline" onClick={onCancel}>{language === 'es' ? 'Cancelar verificación' : 'Cancel verification'}</button>
      </div>
    </div>
  </div>;
}
