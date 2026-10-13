'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { CreditCard, Lock } from 'lucide-react';
import { paymentRequest } from '@/hooks/use-payment-session';

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'default';

interface HostedField {
  load(selector: string): void;
  unload(): void;
  on(event: string, listener: (data: { card?: Array<{ name: string }> }) => void): void;
}

interface Microform {
  createField(type: 'number' | 'securityCode', options: Record<string, unknown>): HostedField;
  createToken(options: { expirationMonth: string; expirationYear: string }, callback: (error: unknown, token?: string) => void): void;
}

declare global {
  interface Window {
    Flex?: new (context: string) => { microform(options: { styles: Record<string, unknown> }): Microform };
  }
}

export interface SecureCardHandle {
  tokenize(month: string, year: string): Promise<string>;
}

interface Props {
  preview?: boolean;
  language: 'es' | 'en';
  numberLabel: string;
  securityLabel: string;
  children: React.ReactNode;
  expiration: React.ReactNode;
  onReady(ready: boolean): void;
  onBrand(brand: CardBrand): void;
}

const libraryLoads = new Map<string, Promise<void>>();

function loadLibrary(url: string, integrity: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['testflex.cybersource.com', 'flex.cybersource.com'].includes(parsed.hostname) || !/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(integrity)) {
    return Promise.reject(new Error('INVALID_CAPTURE_CONTEXT'));
  }
  const key = `${url}|${integrity}`;
  if (!libraryLoads.has(key)) {
    libraryLoads.set(key, new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.integrity = integrity;
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        libraryLoads.delete(key);
        script.remove();
        reject(new Error('SECURE_FIELDS_UNAVAILABLE'));
      };
      document.head.appendChild(script);
    }));
  }
  return libraryLoads.get(key)!;
}

/** PAN and security code live exclusively inside CyberSource-owned iframes. */
export const SecureCardFields = forwardRef<SecureCardHandle, Props>(function SecureCardFields({ preview = false, language, numberLabel, securityLabel, children, expiration, onReady, onBrand }, ref) {
  const microform = useRef<Microform | null>(null);
  const [failed, setFailed] = useState(false);
  const callbacks = useRef({ onReady, onBrand, numberLabel, securityLabel });
  useEffect(() => { callbacks.current = { onReady, onBrand, numberLabel, securityLabel }; }, [onReady, onBrand, numberLabel, securityLabel]);

  useImperativeHandle(ref, () => ({
    tokenize(expirationMonth, expirationYear) {
      return new Promise<string>((resolve, reject) => {
        if (!microform.current) return reject(new Error('SECURE_FIELDS_UNAVAILABLE'));
        microform.current.createToken({ expirationMonth, expirationYear }, (error, token) => {
          if (error || !token) {
            const reason = (error as { reason?: unknown } | null)?.reason;
            if (typeof reason === 'string' && /^[A-Z_]+$/.test(reason)) console.warn('Secure card validation:', reason);
            reject(new Error('CARD_DETAILS_INVALID'));
          }
          else resolve(token);
        });
      });
    },
  }), []);

  useEffect(() => {
    if (preview) return;
    let active = true;
    const fields: HostedField[] = [];
    setFailed(false);
    callbacks.current.onReady(false);
    const initialize = async () => {
      const context = await paymentRequest<{ captureContext: string; clientLibrary: string; clientLibraryIntegrity: string }>('/api/pay/capture-context', {});
      await loadLibrary(context.clientLibrary, context.clientLibraryIntegrity);
      if (!active) return;
      if (!window.Flex) throw new Error('SECURE_FIELDS_UNAVAILABLE');
      const secure = new window.Flex(context.captureContext).microform({
        styles: { input: { 'font-size': '16px', 'font-family': 'monospace', color: '#1e293b' }, ':focus': { color: '#0f172a' }, invalid: { color: '#b91c1c' } },
      });
      microform.current = secure;
      const number = secure.createField('number', { placeholder: '•••• •••• •••• ••••', autoformat: true, 'aria-label': callbacks.current.numberLabel, 'aria-required': true });
      const security = secure.createField('securityCode', { placeholder: '•••', maxlength: 4, 'aria-label': callbacks.current.securityLabel, 'aria-required': true });
      fields.push(number, security);
      let loaded = 0;
      fields.forEach((field) => field.on('load', () => {
        loaded += 1;
        if (active && loaded === 2) callbacks.current.onReady(true);
      }));
      number.on('change', (data) => {
      const name = data.card?.length === 1 ? data.card[0].name : 'default';
        if (active) callbacks.current.onBrand(name === 'visa' || name === 'mastercard' || name === 'amex' ? name : 'default');
      });
      number.load('#cybersource-card-number');
      security.load('#cybersource-security-code');
    };
    initialize().catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      microform.current = null;
      callbacks.current.onReady(false);
      fields.forEach((field) => { try { field.unload(); } catch { /* Field may already be unmounted. */ } });
    };
  }, [preview]);

  return (
    <>
      <div className="space-y-1.5">
        <label id="card-number-label" className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">{numberLabel}</label>
        <div className="relative rounded-xl bg-slate-50 border border-slate-200 focus-within:ring-2 focus-within:ring-[#1e3a8a]/20 focus-within:border-[#1e3a8a]">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400"><CreditCard className="w-4 h-4" /></div>
          <div id="cybersource-card-number" role="group" aria-labelledby="card-number-label" className="h-12 pl-10 pr-3.5 py-3">{preview && <span className="font-mono text-slate-400">•••• •••• •••• ••••</span>}</div>
        </div>
      </div>
      {children}
      <div className="grid grid-cols-2 gap-4">
      {expiration}
      <div className="space-y-1.5">
        <label id="card-security-label" className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">{securityLabel}</label>
        <div className="relative rounded-xl bg-slate-50 border border-slate-200 focus-within:ring-2 focus-within:ring-[#1e3a8a]/20 focus-within:border-[#1e3a8a]">
          <div id="cybersource-security-code" role="group" aria-labelledby="card-security-label" className="h-11 px-3.5 py-3">{preview && <span className="font-mono text-slate-400">•••</span>}</div>
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400"><Lock className="w-3.5 h-3.5" /></div>
        </div>
      </div>
      </div>
      {failed && <p role="alert" className="text-xs text-red-700">{language === 'es' ? 'No se pudieron cargar los campos seguros. Recargue la página para volver a intentarlo.' : 'The secure fields could not be loaded. Reload the page to try again.'}</p>}
    </>
  );
});
