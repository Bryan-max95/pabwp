'use client';

import React, { useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { 
  motion, 
  AnimatePresence 
} from 'motion/react';
import { 
  CreditCard, 
  CheckCircle2, 
  Globe, 
  Lock, 
  ShieldCheck, 
  ChevronRight, 
  ChevronLeft, 
  Building, 
  Receipt, 
  ArrowRight,
  RefreshCw,
  Sparkles,
  Check
} from 'lucide-react';
import { SecureCardFields, type SecureCardHandle, type CardBrand } from './secure-card-fields';
import { usePaymentSession } from '@/hooks/use-payment-session';
import { paymentFailureMessage } from '@/lib/pay/payment-feedback';
import { BillingDetailsFields, readBillingDetails } from './billing-details-fields';
import { BankAuthentication } from './bank-authentication';
import { demoScenarioForAmount, DEMO_AMOUNTS, DEMO_SCENARIOS, demoCurrency, DEFAULT_DEMO_SCENARIO } from '@/lib/pay/demo-scenarios';

// Traducciones completas para el portal de tarjeta interactivo
const TRANSLATIONS = {
  es: {
    portalTitle: "Pago con Tarjeta",
    portalSubtitle: "Procese su mensualidad de forma instantánea y segura en",
    portalSubtitleHighlight: "Roatan Self Storage",
    secureBadge: "Conexión protegida • Datos de pago confidenciales",
    
    // Pasos del carrusel
    step1Tab: "1. Datos de Bodega",
    step2Tab: "2. Tarjeta y Pago",
    step3Tab: "3. Confirmación",

    // Paso 1
    step1Title: "Detalles del Alquiler y Facturación",
    step1Desc: "Verifique el número de bodega y el monto de su mensualidad antes de ingresar su tarjeta.",
    labelUnitNumber: "Número de Bodega / Unidad",
    labelClientName: "Nombre del Cliente",
    labelAmount: "Precio (USD)",
    unitSummaryLabel: "Número de bodega",
    bacPartnerText: "Pagos procesados de forma segura con BAC Credomatic",
    unitPlaceholder: "Bodega asignada",
    namePlaceholder: "Cliente verificado",
    btnContinueToCard: "Continuar a Datos de Tarjeta",

    // Paso 2
    step2Title: "Información de Tarjeta de Crédito / Débito",
    step2Desc: "Aceptamos Visa, Mastercard y American Express. Su banco puede solicitar una verificación adicional.",
    labelCardNumber: "Número de Tarjeta",
    labelCardHolder: "Nombre en la Tarjeta",
    labelExpDate: "Vencimiento (MM/AA)",
    labelCvv: "Código de Seguridad (CVV)",
    cardPlaceholderNum: "4000 1234 5678 9010",
    cardPlaceholderName: "NOMBRE COMO APARECE EN LA TARJETA",
    btnPayNow: "Pagar Ahora",
    btnBack: "Volver a Detalles",
    processingPayment: "Procesando pago seguro con pasarela...",
    cardBrandsBadge: "Tarjetas aceptadas",
    guaranteeText: "Sus datos viajan encriptados de extremo a extremo. No almacenamos los números completos de su tarjeta.",
    privacyLink: "Privacidad y políticas de pago",
    processedBy: "Pago procesado por BAC Credomatic",
    bankAuthTitle: "Autenticación bancaria",
    bankAuthNote: "Si su banco solicita una verificación, complétela en la ventana segura antes de autorizar el pago.",

    // Paso 3
    step3Title: "¡Pago Acreditado con Éxito!",
    step3Subtitle: "Su mensualidad ha sido aplicada y registrada en el sistema de Roatan Self Storage.",
    receiptTitle: "Comprobante de Transacción Digital",
    labelAuthCode: "Código de Autorización:",
    labelTransactionId: "ID de Transacción:",
    labelReceiptUnit: "Bodega / Unidad:",
    labelReceiptClient: "Titular:",
    labelReceiptCard: "Tarjeta Utilizada:",
    labelReceiptAmount: "Monto Pagado:",
    labelReceiptDate: "Fecha y Hora:",
    btnPayAnother: "Volver al Inicio",
    btnPrintReceipt: "Imprimir Comprobante",

    // Footer
    footerSecured: "Protección de datos y controles de pago seguro",
    footerCreated: "Creado por",
    footerSecurity: "Expertos en ciberseguridad"
  },
  en: {
    portalTitle: "Card Payment",
    portalSubtitle: "Process your monthly rent securely and instantly at",
    portalSubtitleHighlight: "Roatan Self Storage",
    secureBadge: "Protected connection • Confidential payment data",
    
    // Steps
    step1Tab: "1. Unit Details",
    step2Tab: "2. Card & Payment",
    step3Tab: "3. Confirmation",

    // Step 1
    step1Title: "Rental & Invoice Details",
    step1Desc: "Verify your storage unit number and payment amount before entering your card details.",
    labelUnitNumber: "Storage Unit Number",
    labelClientName: "Client Full Name",
    labelAmount: "Price (USD)",
    unitSummaryLabel: "Storage unit number",
    bacPartnerText: "Payments securely processed with BAC Credomatic",
    unitPlaceholder: "E.g., Unit B-45",
    namePlaceholder: "Verified customer",
    btnContinueToCard: "Continue to Card Details",

    // Step 2
    step2Title: "Credit / Debit Card Information",
    step2Desc: "We accept Visa, Mastercard, and American Express. Your bank may request additional verification.",
    labelCardNumber: "Card Number",
    labelCardHolder: "Cardholder Name",
    labelExpDate: "Expiry (MM/YY)",
    labelCvv: "Security Code (CVV)",
    cardPlaceholderNum: "4000 1234 5678 9010",
    cardPlaceholderName: "NAME AS PRINTED ON CARD",
    btnPayNow: "Pay Now",
    btnBack: "Back to Details",
    processingPayment: "Processing secure payment gateway...",
    cardBrandsBadge: "Accepted Cards",
    guaranteeText: "Your payment data is encrypted end-to-end. We do not store complete card numbers on our servers.",
    privacyLink: "Privacy and payment policies",
    processedBy: "Payment processed by BAC Credomatic",
    bankAuthTitle: "Bank authentication",
    bankAuthNote: "If your bank requests verification, complete it in the secure window before payment authorization.",

    // Step 3
    step3Title: "Payment Successfully Processed!",
    step3Subtitle: "Your rent has been credited and recorded in Roatan Self Storage system.",
    receiptTitle: "Digital Transaction Receipt",
    labelAuthCode: "Authorization Code:",
    labelTransactionId: "Transaction ID:",
    labelReceiptUnit: "Storage Unit:",
    labelReceiptClient: "Account Holder:",
    labelReceiptCard: "Card Used:",
    labelReceiptAmount: "Total Paid:",
    labelReceiptDate: "Date & Time:",
    btnPayAnother: "Return to Home",
    btnPrintReceipt: "Print Receipt",

    // Footer
    footerSecured: "Data protection and secure payment controls",
    footerCreated: "Created by",
    footerSecurity: "Cybersecurity experts"
  }
};

function CardBrandLogo({ brand, active = true }: { brand: Exclude<CardBrand, 'default'>; active?: boolean }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const logos = {
    visa: { src: 'https://cdn.simpleicons.org/visa/1434CB', alt: 'Visa' },
    mastercard: { src: 'https://cdn.simpleicons.org/mastercard/EB001B', alt: 'Mastercard' },
    amex: { src: 'https://cdn.simpleicons.org/americanexpress/2E77BC', alt: 'American Express' },
  };
  const logo = logos[brand];

  return (
    <span className={`relative flex h-8 w-12 items-center justify-center rounded-md border bg-white px-1.5 transition-all ${active ? 'border-[#1F5C4F] shadow-sm' : 'border-slate-200 opacity-45 grayscale'}`}>
      {!imageLoaded && <span className="absolute text-[8px] font-extrabold text-[#112a52]">{brand === 'amex' ? 'AMEX' : logo.alt}</span>}
      <Image src={logo.src} alt={logo.alt} width={40} height={22} onLoad={() => setImageLoaded(true)} onError={() => setImageLoaded(false)} className={`max-h-5 w-auto ${imageLoaded ? '' : 'opacity-0'}`} unoptimized />
    </span>
  );
}


export default function PaymentCarousel({ manualSandboxEnabled = false }: { manualSandboxEnabled?: boolean }) {
  const [lang, setLang] = useState<'es' | 'en'>('es');
  const t = TRANSLATIONS[lang];

  // Carousel slide step: 1 = Unit Details, 2 = Card Details, 3 = Confirmation Receipt
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  const payment = usePaymentSession(manualSandboxEnabled);
  const [manual, setManual] = useState({ unitName: '', clientName: '', amount: '' });
  const manualEntry = !payment.session;
  const unitNumber = payment.session?.unitName ?? manual.unitName;
  const clientName = payment.session?.clientName ?? manual.clientName;
  const manualComplete = Boolean(manual.unitName.trim() && manual.clientName.trim() && /^[0-9]+([.,][0-9]{1,2})?$/.test(manual.amount) && Number(manual.amount.replace(',', '.')) > 0);
  const amount = payment.session?.amount ?? '0.00';
  const priceReference = payment.session?.priceReference;
  const chargeLabel = payment.session?.currency === 'HNL' ? `L ${amount} HNL` : `${amount} ${payment.session?.currency ?? ''}`;
  const referenceAmount = priceReference?.amount ?? (manualEntry ? manual.amount : payment.session?.currency === 'USD' ? amount : '');
  const displayLabel = manualEntry ? (manual.amount ? `$ ${manual.amount} USD` : '— USD') : referenceAmount ? `$ ${referenceAmount} USD` : chargeLabel;
  const exchangeNotice = priceReference ? (lang === 'es'
    ? `Se debitarán ${chargeLabel} de su tarjeta. Tipo de cambio: L ${Number(priceReference.hnlPerUsd)} por USD 1.`
    : `Your card will be charged ${chargeLabel}. Exchange rate: L ${Number(priceReference.hnlPerUsd)} per USD 1.`) : '';
  const rateSource = priceReference?.source === 'BCH' ? `${lang === 'es' ? 'Fuente: Banco Central de Honduras' : 'Source: Banco Central de Honduras'} · ${priceReference.rateDate}` : '';

  // Form State - Card Details (Step 2)
  const [cardHolder, setCardHolder] = useState('');
  const [expDate, setExpDate] = useState('');
  const [detectedBrand,setDetectedBrand]=useState<CardBrand>('default');
  const [fieldsReady,setFieldsReady]=useState(false);
  const [cardError,setCardError]=useState<string | null>(null);
  const [tokenizing,setTokenizing]=useState(false);
  const tokenizingRef=useRef(false);
  const secureFields=useRef<SecureCardHandle>(null);
  const receiptData = payment.session?.receipt ?? null;
  const isProcessing=payment.busy || tokenizing || payment.preparingManual;
  const visibleStep = receiptData ? 3 : currentStep;

  // Format expiration date MM/YY
  const handleExpDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 4) value = value.slice(0, 4);
    if (value.length >= 3) {
      setExpDate(`${value.slice(0, 2)}/${value.slice(2)}`);
    } else {
      setExpDate(value);
    }
  };

  // Submit Step 1
  const continueToCard = async () => {
    if (isProcessing || (manualEntry && (payment.error || !manualComplete))) return;
    if (manualEntry && manualSandboxEnabled) {
      const [whole, fraction = ''] = manual.amount.replace(',', '.').split('.');
      const amount = `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
      if (!await payment.startManual({ clientName: manual.clientName.trim(), unitName: manual.unitName.trim(), amount })) return;
    }
    setCurrentStep(2);
  };
  const handleStep1Submit = (e: React.FormEvent) => { e.preventDefault(); void continueToCard(); };

  // Submit Step 2: Process Card Payment
  const handleCardPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payment.session) return;
    const billingDetails = payment.session.billingRequired ? readBillingDetails(e.currentTarget as HTMLFormElement) : undefined;
    const expiration = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(expDate);
    if (!expiration) { setCardError('CARD_DETAILS_INVALID'); return; }
    if (new Date(2000 + Number(expiration[2]), Number(expiration[1]), 1).getTime() <= Date.now()) { setCardError('CARD_EXPIRED'); return; }
    const [month,year]=expDate.split('/');if(!fieldsReady||!month||!year||!cardHolder.trim()||!payment.canPay||tokenizingRef.current)return;
    tokenizingRef.current=true;setTokenizing(true);setCardError(null);
    try{const transientToken=await secureFields.current?.tokenize(month,`20${year}`);if(!transientToken)return;
      await payment.pay({transientToken,cardHolder,expirationMonth:month,expirationYear:`20${year}`,...(billingDetails?{billingDetails}:{}),browser:{language:navigator.language,colorDepth:screen.colorDepth,height:screen.height,width:screen.width,timezoneOffset:new Date().getTimezoneOffset()}});
    }catch{setCardError('CARD_DETAILS_INVALID');}finally{tokenizingRef.current=false;setTokenizing(false);}
  };

  // Reset Carousel to Start a New Payment
  const handleReset = () => {
    window.sessionStorage.removeItem('pay-session-id');
    window.sessionStorage.removeItem('pay-manual-draft');
    window.location.assign(payment.session?.isDemo ? `/?demo=${payment.session.unitName === 'DEMO-B' ? 'b' : 'a'}&scenario=${demoScenarioForAmount(priceReference?.source === 'BCH' ? referenceAmount : amount, priceReference?.source === 'BCH' ? 'USD' : payment.session.currency) ?? DEFAULT_DEMO_SCENARIO}` : '/');
  };

  const expirationField = <div className="space-y-1.5">
    <label htmlFor="card-expiration" className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">{t.labelExpDate}</label>
    <input id="card-expiration" type="text" inputMode="numeric" autoComplete="cc-exp" required value={expDate} onChange={handleExpDateChange}
      placeholder="MM/AA" maxLength={5} pattern="(0[1-9]|1[0-2])/[0-9]{2}"
      className="w-full text-center text-sm font-mono font-bold px-3.5 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20 focus:border-[#1e3a8a] text-slate-800 transition-all" />
  </div>;

  if(payment.loading)return <main className="min-h-screen grid place-items-center bg-[#eef5fc]"><RefreshCw className="h-8 w-8 animate-spin text-[#1F5C4F]" /></main>;
  if(payment.exchangeRateUnavailable && !payment.session)return <main className="min-h-screen grid place-items-center bg-[#eef5fc] px-6"><div className="max-w-lg rounded-3xl bg-white p-8 text-center shadow-xl"><h1 className="font-display text-xl font-extrabold">{lang==='es'?'Tipo de cambio no disponible':'Exchange rate unavailable'}</h1><p className="mt-2 text-sm text-slate-600">{lang==='es'?'No podemos confirmar el importe en lempiras en este momento. No se ha realizado ningún cobro. Intente nuevamente más tarde.':'We cannot confirm the amount in lempiras right now. No charge has been made. Please try again later.'}</p><button onClick={()=>window.location.reload()} className="mt-4 rounded-xl bg-[#1F5C4F] px-5 py-3 text-sm font-bold text-white">{lang==='es'?'Reintentar':'Try again'}</button></div></main>;
  if(payment.localDemoUnavailable && !payment.session)return <main className="min-h-screen grid place-items-center bg-[#eef5fc] px-6"><div className="max-w-lg rounded-3xl bg-white p-8 text-center shadow-xl"><h1 className="font-display text-xl font-extrabold">{lang==='es'?'No se pudo abrir la prueba sandbox':'Sandbox test unavailable'}</h1><p className="mt-2 text-sm text-slate-500">{lang==='es'?'No se pudo crear la sesión de prueba. Compruebe la conexión de Neon y vuelva a intentar.':'The test session could not be created. Check the Neon connection and try again.'}</p><button onClick={()=>window.location.reload()} className="mt-4 rounded-xl bg-[#1F5C4F] px-5 py-3 text-sm font-bold text-white">{lang==='es'?'Reintentar':'Try again'}</button></div></main>;

  return (
    <div className="relative min-h-screen flex flex-col justify-between py-8 px-4 sm:px-6 md:py-12">
      {payment.authentication?.accessToken && payment.authentication.url && <BankAuthentication key={`${payment.authentication.step}-${payment.authentication.referenceId ?? payment.authentication.transactionId}`} authentication={payment.authentication} onComplete={payment.completeAuthentication} onCancel={payment.restartAuthentication} language={lang} />}
      
      {/* Fondo geométrico original con ondas y gradiente diagonal de la marca */}
      <div className="absolute inset-0 z-0 bg-[#eef5fc] overflow-hidden">
        <div className="absolute top-0 right-0 w-[60%] h-[120%] bg-gradient-to-l from-[#cfe3fc] via-[#e2eeff] to-[#eef5fc] transform skew-x-12 origin-top-right transition-all duration-1000 opacity-80 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[40%] h-[70%] bg-gradient-to-tr from-[#daebff] to-[#eef5fc] transform -skew-x-12 origin-bottom-left opacity-60 pointer-events-none" />
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#2563eb]/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-[#3b82f6]/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      <div className="relative z-10 max-w-3xl w-full mx-auto flex-grow flex flex-col justify-center">
        {manualEntry && payment.error && <div role="alert" className="mb-4 rounded-xl bg-amber-50 p-4 text-xs text-amber-900">
          <p>{lang === 'es' ? 'No se pudo abrir el enlace de cobro. Solicita un enlace nuevo.' : 'The payment link could not be opened. Please request a new link.'}</p>
          <button type="button" onClick={handleReset} className="mt-2 font-bold underline">{lang === 'es' ? 'Volver al inicio' : 'Return to the start'}</button>
        </div>}
        {payment.session?.isDemo && <div className="mb-3 flex flex-wrap items-center justify-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-bold text-amber-900"><span>{lang==='es'?'Prueba sandbox • Sin cargo real ni factura fiscal':'Sandbox test • No real charge or fiscal invoice'}</span><button type="button" onClick={handleReset} disabled={isProcessing} className="underline underline-offset-2 disabled:opacity-50">{lang==='es'?'Nueva prueba':'New test'}</button>
          {DEMO_SCENARIOS.map(scenario => <button key={scenario} type="button" disabled={isProcessing} className="rounded border border-amber-300 px-2 py-1 disabled:opacity-50" onClick={() => {
            window.sessionStorage.removeItem('pay-session-id');
            window.location.assign(`/?demo=${payment.session?.unitName === 'DEMO-B' ? 'b' : 'a'}&scenario=${scenario}`);
          }}>{demoCurrency(scenario) === 'USD' ? '$' : 'L'} {DEMO_AMOUNTS[scenario]} {demoCurrency(scenario)}</button>)}
        </div>}
        
        {/* Selector de idioma minimalista en la esquina superior derecha */}
        <div className="flex justify-between items-center mb-6">
          <div className="hidden sm:flex items-center gap-2 text-xs font-semibold text-slate-500 bg-white/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-slate-200/80 shadow-xs">
            <Lock className="w-3.5 h-3.5 text-emerald-600" />
            <span>{t.secureBadge}</span>
          </div>

          <div className="bg-white p-1 rounded-xl shadow-xs border border-slate-200/80 flex items-center ml-auto">
            <Globe className="w-3.5 h-3.5 text-slate-400 mx-2" />
            <button
              onClick={() => setLang('es')}
              className={`px-3 py-1 text-xs font-bold tracking-tight rounded-lg transition-all cursor-pointer ${
                lang === 'es' 
                  ? 'bg-[#1F5C4F] text-white shadow-xs' 
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              ESPAÑOL
            </button>
            <button
              onClick={() => setLang('en')}
              className={`px-3 py-1 text-xs font-bold tracking-tight rounded-lg transition-all cursor-pointer ${
                lang === 'en' 
                  ? 'bg-[#1F5C4F] text-white shadow-xs' 
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              ENGLISH
            </button>
          </div>
        </div>

        {/* Encabezado con Logo oficial Roatan Self Storage */}
        <header className="text-center mb-6 flex flex-col items-center">
          <div className="w-36 h-36 mb-3 transition-transform hover:scale-105 duration-300 flex items-center justify-center">
            <svg viewBox="0 0 200 200" className="w-full h-full" id="roatan-logo-header" aria-label="Roatan Self Storage Logo">
              {/* Roof Structure */}
              <path 
                d="M 32,82 L 100,20 L 168,82" 
                stroke="#111827" 
                strokeWidth="6.5" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                fill="none" 
              />
              <path 
                d="M 49,81 L 49,94" 
                stroke="#111827" 
                strokeWidth="6.5" 
                strokeLinecap="round" 
                fill="none" 
              />
              <path 
                d="M 151,81 L 151,94" 
                stroke="#111827" 
                strokeWidth="6.5" 
                strokeLinecap="round" 
                fill="none" 
              />
              <path 
                d="M 59,82 L 100,45 L 141,82" 
                stroke="#111827" 
                strokeWidth="6.5" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                fill="none" 
              />

              {/* Golden/Yellow Circle */}
              <circle 
                cx="100" 
                cy="63.5" 
                r="19" 
                fill="#f2b807" 
                stroke="#111827" 
                strokeWidth="6.5" 
              />

              {/* Black Keyhole */}
              <path 
                d="M 100,55 A 4.5,4.5 0 0,0 96.8,62 L 95.2,71.5 C 95.1,72.1 95.6,72.6 96.2,72.6 L 103.8,72.6 C 104.4,72.6 104.9,72.1 104.8,71.5 L 103.2,62 A 4.5,4.5 0 0,0 100,55 Z" 
                fill="#111827" 
              />

              {/* ROATAN Text */}
              <text 
                x="100" 
                y="119" 
                textAnchor="middle" 
                fill="#084c2e" 
                style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', fontWeight: 900 }}
                fontSize="24" 
                letterSpacing="0.5"
              >
                ROATAN
              </text>

              {/* Divider Line */}
              <line 
                x1="48" 
                y1="128" 
                x2="152" 
                y2="128" 
                stroke="#111827" 
                strokeWidth="4.5" 
                strokeLinecap="round" 
              />

              {/* SELF STORAGE Text */}
              <text 
                x="100" 
                y="151" 
                textAnchor="middle" 
                fill="#084c2e" 
                style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', fontWeight: 900 }}
                fontSize="19.5" 
                letterSpacing="0.2"
              >
                SELF STORAGE
              </text>

              {/* SAFE & SECURE Text */}
              <text 
                x="100" 
                y="173" 
                textAnchor="middle" 
                fill="#111827" 
                style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', fontWeight: 900 }}
                fontSize="14.5" 
                letterSpacing="0.5"
              >
                SAFE & SECURE
              </text>
            </svg>
          </div>

          <h1 className="text-2xl sm:text-3xl font-display font-extrabold text-[#112a52] tracking-tight">
            {t.portalTitle}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium max-w-lg mt-1 leading-relaxed">
            {t.portalSubtitle} <strong className="text-[#112a52]">{t.portalSubtitleHighlight}</strong>
          </p>
        </header>

        <div className="mb-5 flex flex-col items-center justify-center gap-3 border-y border-slate-200/80 bg-white/80 px-4 py-4 text-center shadow-sm backdrop-blur-sm sm:flex-row sm:text-left">
          <a
            href="https://www.baccredomatic.com/es-hn"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visitar el sitio oficial de BAC Credomatic Honduras"
            className="flex h-11 w-36 items-center justify-center rounded-md border border-red-100 bg-white px-3 transition-shadow hover:shadow-md"
          >
            <Image
              src="https://www.baccredomatic.com/themes/custom/bac_theme/images/logo.png"
              alt="BAC Credomatic"
              width={132}
              height={40}
              className="h-auto max-h-8 w-auto"
              priority
              unoptimized
            />
          </a>
          <div>
            <p className="text-xs font-extrabold text-slate-800">Roatan Self Storage</p>
            <p className="text-[11px] font-medium text-slate-500">{t.bacPartnerText}</p>
          </div>
        </div>

        {/* CONTENEDOR PRINCIPAL: CARRUSEL DE PAGO CON TARJETA */}
        <div className="bg-white rounded-3xl p-6 sm:p-9 shadow-xl border border-slate-200/80 relative overflow-hidden" id="card-payment-carousel">
          
          {/* Indicador de pasos del carrusel */}
          <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2 sm:gap-4 w-full">
              
              {/* Paso 1 */}
              <button 
                type="button"
                onClick={() => visibleStep > 1 && setCurrentStep(1)}
                disabled={visibleStep === 3}
                className={`flex items-center gap-2 text-xs font-bold transition-colors cursor-pointer ${
                  visibleStep === 1 
                    ? 'text-[#1F5C4F]' 
                    : visibleStep > 1 
                      ? 'text-emerald-700 hover:text-emerald-800' 
                      : 'text-slate-400'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black ${
                  visibleStep === 1 
                    ? 'bg-[#1F5C4F] text-white shadow-xs' 
                    : visibleStep > 1 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-slate-100 text-slate-400'
                }`}>
                  {visibleStep > 1 ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : '1'}
                </span>
                <span className="hidden sm:inline font-display">{t.step1Tab}</span>
              </button>

              <div className={`flex-1 h-0.5 rounded-full transition-colors ${visibleStep > 1 ? 'bg-emerald-500' : 'bg-slate-200'}`} />

              {/* Paso 2 */}
              <button 
                type="button"
                onClick={() => visibleStep === 1 && void continueToCard()}
                disabled={isProcessing || (manualEntry && (!manualComplete || payment.error)) || visibleStep === 3}
                className={`flex items-center gap-2 text-xs font-bold transition-colors cursor-pointer ${
                  visibleStep === 2 
                    ? 'text-[#1F5C4F]' 
                    : visibleStep > 2 
                      ? 'text-emerald-700' 
                      : 'text-slate-400'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black ${
                  visibleStep === 2 
                    ? 'bg-[#1F5C4F] text-white shadow-xs' 
                    : visibleStep > 2 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-slate-100 text-slate-400'
                }`}>
                  {visibleStep > 2 ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : '2'}
                </span>
                <span className="hidden sm:inline font-display">{t.step2Tab}</span>
              </button>

              <div className={`flex-1 h-0.5 rounded-full transition-colors ${visibleStep === 3 ? 'bg-emerald-500' : 'bg-slate-200'}`} />

              {/* Paso 3 */}
              <div className={`flex items-center gap-2 text-xs font-bold ${
                visibleStep === 3 ? 'text-emerald-700' : 'text-slate-400'
              }`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black ${
                  visibleStep === 3 ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-100 text-slate-400'
                }`}>
                  3
                </span>
                <span className="hidden sm:inline font-display">{t.step3Tab}</span>
              </div>

            </div>
          </div>

          {/* Vistas dinámicas del Carrusel */}
          <AnimatePresence mode="wait">
            
            {/* ================= SLIDE 1: DATOS DE BODEGA Y MONTO ================= */}
            {visibleStep === 1 && (
              <motion.div
                key="carousel-step-1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.25 }}
                className="space-y-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-display font-extrabold text-slate-900">
                      {t.step1Title}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t.step1Desc}
                    </p>
                  </div>
                  
                  {/* Badge de seguridad */}
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-[#1e3a8a] text-[11px] font-bold rounded-lg self-start sm:self-auto">
                    <ShieldCheck className="w-4 h-4 text-blue-600" />
                    <span>Roatan Safe Pay</span>
                  </div>
                </div>

                <form onSubmit={handleStep1Submit} className="space-y-4 pt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    
                    {/* Número de Bodega */}
                    <div className="space-y-1.5">
                      <label htmlFor="unit-number" className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                        {t.labelUnitNumber}
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                          <Building className="w-4 h-4" />
                        </div>
                        <input
                          type="text"
                          id="unit-number"
                          required
                          value={unitNumber}
                          readOnly={!manualEntry}
                          disabled={isProcessing || (manualEntry && payment.error)}
                          maxLength={60}
                          onChange={event => setManual({ ...manual, unitName: event.target.value })}
                          className="w-full text-sm pl-10 pr-3.5 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20 focus:border-[#1e3a8a] font-bold text-slate-800 transition-all"
                        />
                      </div>
                    </div>

                    {/* Nombre del Cliente */}
                    <div className="space-y-1.5">
                      <label htmlFor="client-name" className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                        {t.labelClientName}
                      </label>
                      <input
                        id="client-name"
                        type="text"
                        autoComplete="name"
                        required
                        value={clientName}
                        readOnly={!manualEntry}
                        disabled={isProcessing || (manualEntry && payment.error)}
                        maxLength={200}
                        onChange={event => setManual({ ...manual, clientName: event.target.value })}
                        className="w-full text-sm px-3.5 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20 focus:border-[#1e3a8a] font-bold text-slate-800 transition-all"
                      />
                    </div>

                    {/* Monto a pagar */}
                    <div className="space-y-1.5">
                      <label htmlFor="price-reference-usd" className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                        {manualEntry || referenceAmount ? t.labelAmount : (lang==='es'?'Monto (HNL)':'Amount (HNL)')}
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500 font-bold text-sm">
                          {manualEntry || referenceAmount ? '$' : 'L'}
                        </div>
                        <input
                          type="text"
                          id="price-reference-usd"
                          value={manualEntry ? manual.amount : referenceAmount || amount}
                          readOnly={!manualEntry}
                          disabled={isProcessing || (manualEntry && payment.error)}
                          required inputMode="decimal" maxLength={10}
                          pattern={manualEntry ? '[0-9]+([.,][0-9]{1,2})?' : undefined}
                          onChange={event => setManual({ ...manual, amount: event.target.value })}
                          className="w-full text-base font-mono font-extrabold pl-8 pr-16 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20 focus:border-[#1e3a8a] text-slate-900 transition-all"
                        />
                        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-[11px] font-bold text-slate-400">
                          {manualEntry || referenceAmount ? 'USD' : 'HNL'}
                        </div>
                      </div>
                      {priceReference && <p className="text-xs text-slate-600" data-testid="exchange-rate">{exchangeNotice} {rateSource}</p>}
                    </div>

                    {/* Identificación de la bodega en lugar del período de pago */}
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                        {lang==='es'?'Concepto':'Description'}
                      </span>
                      <div className="flex min-h-12 items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3.5">
                        <Building className="h-4 w-4 shrink-0 text-[#1F5C4F]" />
                        <span className="text-sm font-extrabold text-[#1F5C4F]">{payment.session?.concept ?? (lang === 'es' ? 'Mensualidad de bodega' : 'Storage rent')}</span>
                      </div>
                    </div>

                  </div>

                  {payment.preparingManual && <p role="status" className="text-xs text-slate-600">{lang === 'es' ? 'Preparando los campos de tarjeta…' : 'Preparing the card fields…'}</p>}
                  {payment.manualError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{payment.manualError === 'EXCHANGE_RATE_UNAVAILABLE'
                    ? (lang === 'es' ? 'No se pudo obtener el tipo de cambio del BCH. Intente nuevamente; no se ha realizado ningún cobro.' : 'The BCH exchange rate is unavailable. Try again; no payment has been made.')
                    : (lang === 'es' ? 'No se pudieron abrir los campos de tarjeta. Vuelve a pulsar Continuar. No se ha realizado ningún cobro.' : 'The card fields could not be opened. Press Continue again. No payment has been made.')}</p>}
                  {/* Resumen dinámico de la orden */}
                  <div className="bg-[#f8fafc] rounded-2xl p-4 border border-slate-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-[#1F5C4F] text-white rounded-xl">
                        <CreditCard className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800">{unitNumber || (lang === 'es' ? 'Bodega' : 'Storage unit')}</p>
                        <p data-testid="summary-customer" className="text-[11px] text-slate-500 font-medium break-words">{clientName || (lang === 'es' ? 'Cliente' : 'Customer')}</p>
                      </div>
                    </div>
                    <div className="self-end text-right shrink-0 sm:self-auto">
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{lang==='es'?'Total':'Total'}</p>
                      <p data-testid="charge-total" className="text-lg font-mono font-black text-[#112a52]">{displayLabel}</p>
                    </div>
                  </div>

                  {/* Botón para pasar al carrusel de tarjeta */}
                  <div className="flex justify-end pt-4">
                    <button
                      type="submit"
                      disabled={isProcessing || (manualEntry && (!manualComplete || payment.error))}
                      className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-[#1F5C4F] hover:bg-[#17483e] text-white font-extrabold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span>{t.btnContinueToCard}</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

            {/* ================= SLIDE 2: CARRUSEL DE TARJETA INTERACTIVA Y FORMULARIO ================= */}
            {visibleStep === 2 && (
              <motion.div
                key="carousel-step-2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="space-y-6"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-display font-extrabold text-slate-900">
                      {t.step2Title}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t.step2Desc}
                    </p>
                  </div>

                  {/* Logotipos de tarjetas */}
                  <div className="flex items-center gap-1.5" aria-label={t.cardBrandsBadge}>
                    <CardBrandLogo brand="visa" active={detectedBrand === 'default' || detectedBrand === 'visa'} />
                    <CardBrandLogo brand="mastercard" active={detectedBrand === 'default' || detectedBrand === 'mastercard'} />
                    <CardBrandLogo brand="amex" active={detectedBrand === 'default' || detectedBrand === 'amex'} />
                  </div>
                </div>

                {/* VISTA PREVIA INTERACTIVA DE TARJETA 3D */}
                <div className="flex justify-center py-2">
                  <div className="w-full max-w-sm h-48 rounded-2xl bg-[#173f38] p-6 text-white shadow-xl relative overflow-hidden flex flex-col justify-between border border-[#2f6f61] transition-transform duration-300">
                    
                    {/* Marca de agua de Roatan Self Storage */}
                    <svg
                      viewBox="0 0 200 200"
                      aria-hidden="true"
                      className="pointer-events-none absolute -bottom-8 right-5 h-44 w-44 text-white opacity-[0.07]"
                    >
                      <path d="M32 82 100 20l68 62M49 81v13M151 81v13M59 82l41-37 41 37" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      <circle cx="100" cy="63.5" r="19" fill="none" stroke="currentColor" strokeWidth="7" />
                      <path d="M100 55a4.5 4.5 0 0 0-3.2 7l-1.6 9.5c-.1.6.4 1.1 1 1.1h7.6c.6 0 1.1-.5 1-1.1l-1.6-9.5a4.5 4.5 0 0 0-3.2-7Z" fill="currentColor" />
                      <text x="100" y="119" textAnchor="middle" fill="currentColor" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="24">ROATAN</text>
                      <line x1="48" y1="128" x2="152" y2="128" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
                      <text x="100" y="151" textAnchor="middle" fill="currentColor" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="19.5">SELF STORAGE</text>
                    </svg>
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25" />
                    <div className="pointer-events-none absolute -left-16 top-14 h-28 w-72 rotate-[-18deg] bg-white/[0.025]" />

                    {/* Fila superior: Chip + Logo de Marca */}
                    <div className="flex justify-between items-center relative z-10">
                      <div className="flex items-center gap-2">
                        <div className="relative h-8 w-11 shrink-0 overflow-hidden rounded-[7px] border border-[#b98b25] bg-[#d9ad4a] shadow-[inset_0_1px_1px_rgba(255,255,255,0.7),0_1px_2px_rgba(0,0,0,0.25)]" aria-label="Chip de tarjeta">
                          <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.5),transparent_34%,rgba(112,72,13,0.18)_65%,rgba(255,255,255,0.28))]" />
                          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#9d7624]/70" />
                          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#9d7624]/70" />
                          <div className="absolute left-0 top-[5px] h-[7px] w-[10px] rounded-r-full border-y border-r border-[#9d7624]/70" />
                          <div className="absolute bottom-[5px] left-0 h-[7px] w-[10px] rounded-r-full border-y border-r border-[#9d7624]/70" />
                          <div className="absolute right-0 top-[5px] h-[7px] w-[10px] rounded-l-full border-y border-l border-[#9d7624]/70" />
                          <div className="absolute bottom-[5px] right-0 h-[7px] w-[10px] rounded-l-full border-y border-l border-[#9d7624]/70" />
                        </div>
                        <span className="text-[10px] font-extrabold text-white">PayRoatanSelfStorage</span>
                      </div>
                      
                      <div className="flex h-8 min-w-12 items-center justify-end">
                        {detectedBrand === 'visa' && <CardBrandLogo brand="visa" />}
                        {detectedBrand === 'mastercard' && <CardBrandLogo brand="mastercard" />}
                        {detectedBrand === 'amex' && <CardBrandLogo brand="amex" />}
                        {detectedBrand === 'default' && <CreditCard className="h-7 w-7 text-white/80" />}
                      </div>
                    </div>

                    {/* Número de tarjeta interactivo */}
                    <div className="relative z-10 py-1">
                      <p className="font-mono text-lg sm:text-xl tracking-widest text-white font-medium">
                        •••• •••• •••• ••••
                      </p>
                    </div>

                    {/* Fila inferior: Titular y Expiración */}
                    <div className="flex justify-between items-end relative z-10 text-[10px] uppercase font-mono tracking-wider">
                      <div>
                        <span className="block text-[8px] text-slate-400">Cardholder</span>
                        <span className="font-bold text-slate-200 truncate max-w-[170px] block">
                          {cardHolder || clientName || 'TITULAR DE TARJETA'}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="block text-[8px] text-slate-400">Expires</span>
                        <span className="font-bold text-slate-200">
                          {expDate || 'MM/AA'}
                        </span>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Formulario de Tarjeta con inputs de alta seguridad */}
                <form onSubmit={handleCardPayment} className="space-y-4">
                  <SecureCardFields ref={secureFields} preview={manualEntry} language={lang} numberLabel={t.labelCardNumber} securityLabel={t.labelCvv} onReady={setFieldsReady} onBrand={setDetectedBrand} expiration={expirationField}>

                  {/* Nombre en la tarjeta */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                      {t.labelCardHolder}
                    </label>
                    <input
                      type="text"
                      required
                      value={cardHolder}
                      onChange={(e) => setCardHolder(e.target.value.toUpperCase())}
                      placeholder={t.cardPlaceholderName}
                      className="w-full text-xs font-bold uppercase px-3.5 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/20 focus:border-[#1e3a8a] text-slate-800 transition-all"
                    />
                  </div>

                  </SecureCardFields>
                  {payment.session?.billingRequired && <BillingDetailsFields key={payment.session.id} value={payment.session.billingDetails} language={lang} />}
                  {(cardError || payment.requestError) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{paymentFailureMessage(cardError ?? payment.requestError ?? undefined, undefined, lang)}</p>}
                  {payment.session?.status==='declined' && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{paymentFailureMessage(payment.session.failureCode ?? payment.session.failureReason, payment.session.gatewayStatus, lang)}</p>}
                  {payment.pending && <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{['CAPTURE_FAILED', 'CAPTURE_NOT_CONFIRMED'].includes(payment.session?.failureCode ?? '') ? paymentFailureMessage(payment.session?.failureCode, undefined, lang) : payment.requiresReview ? (lang==='es'?'Resultado pendiente de confirmar. No se ha confirmado el pago. Este intento queda bloqueado para evitar un cargo duplicado.':'Result requires verification. Payment has not been confirmed. This attempt is blocked to prevent a duplicate charge.') : (lang==='es'?'Estamos verificando el resultado. No repita el pago.':'We are verifying the result. Do not repeat the payment.')}</p>}
                  {payment.session?.failureReason==='PROCESSOR_MERCHANT_ID_INVALID_OR_MISSING' && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{lang==='es'?'El procesador sandbox reporta un merchant_id inválido o ausente. BAC/CyberSource debe revisar la configuración de autorización del comercio. No hay un pago confirmado.':'The sandbox processor reports an invalid or missing merchant_id. BAC/CyberSource needs to review the merchant authorization configuration. No payment is confirmed.'}</p>}
                  {payment.interruptedAuthentication && <button type="button" onClick={payment.restartAuthentication} className="text-xs font-bold underline">{lang==='es'?'La verificación se interrumpió. Reiniciar sin cobrar.':'Verification was interrupted. Restart without charging.'}</button>}
                  {payment.requiresReview && <button type="button" onClick={()=>void payment.refresh().catch(()=>{})} className="text-xs font-bold underline">{lang==='es'?'Consultar resultado guardado':'Check stored result'}</button>}
                  {payment.session?.status==='authorized' && <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{lang==='es'?'Diagnóstico: autorización aprobada sin captura. No es un pago aplicado.':'Diagnostic: authorization approved without capture. This is not an applied payment.'}</p>}
                  {payment.session?.isDemo && payment.session.gatewayStatus && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 break-words">{lang==='es'?'Resultado sandbox':'Sandbox result'}: {payment.session.gatewayStatus}{payment.session.failureReason ? ` · ${payment.session.failureReason}` : ''}{payment.session.transactionId ? ` · ID: ${payment.session.transactionId}` : ''}</p>}
                  {payment.session?.status==='expired' && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{lang==='es'?'Esta sesión venció. Abra un enlace nuevo para continuar.':'This session expired. Open a new link to continue.'}</p>}
                  {payment.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">{lang==='es'?'No se confirmó el pago. Consulte el estado antes de intentar nuevamente.':'The payment was not confirmed. Check its status before trying again.'}</p>}

                  {/* Garantía y aviso de privacidad */}
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-[#f8fafc] p-3.5">
                    <div className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#1F5C4F]" />
                      <div>
                        <p>{t.guaranteeText}</p>
                        <Link href="/privacidad" className="mt-1 inline-block font-bold text-[#1F5C4F] underline decoration-[#1F5C4F]/30 underline-offset-2 hover:decoration-[#1F5C4F]">
                          {t.privacyLink}
                        </Link>
                      </div>
                    </div>
                    <div className="border-t border-slate-200 pt-3">
                      <p className="mb-2 text-[10px] font-extrabold uppercase text-slate-600">{t.bankAuthTitle}</p>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-700">3D SECURE</span>
                        <span className="rounded border border-blue-100 bg-white px-2 py-1 text-[10px] font-black text-[#1434CB]">VISA SECURE</span>
                        <span className="rounded border border-red-100 bg-white px-2 py-1 text-[10px] font-black text-[#EB001B]">MASTERCARD ID CHECK</span>
                      </div>
                      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{t.bankAuthNote}</p>
                    </div>
                  </div>

                  {/* Botones de acción */}
                  <div className="flex items-center gap-2 pt-2 text-[10px] font-bold text-slate-500">
                    <Lock className="h-3.5 w-3.5 text-[#1F5C4F]" />
                    <span>{t.processedBy}</span>
                  </div>

                  {priceReference && <p className="text-xs leading-relaxed text-slate-600" data-testid="charge-disclosure">{exchangeNotice} {rateSource}</p>}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between pt-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setCurrentStep(1)}
                      disabled={isProcessing}
                      className="px-5 py-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>{t.btnBack}</span>
                    </button>

                    <button
                      type="submit"
                      disabled={isProcessing || !fieldsReady || !payment.canPay}
                      className="flex-1 sm:flex-initial px-8 py-3.5 rounded-xl bg-[#1F5C4F] hover:bg-[#17483e] text-white font-extrabold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isProcessing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>{t.processingPayment}</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-4 h-4" />
                          <span>{payment.requiresReview ? (lang==='es'?'Pago pendiente de verificar':'Payment requires verification') : `${t.btnPayNow} • ${displayLabel}`}</span>
                        </>
                      )}
                    </button>
                  </div>

                </form>


              </motion.div>
            )}

            {/* ================= SLIDE 3: CONFIRMACIÓN Y RECIBO DIGITAL ================= */}
            {visibleStep === 3 && receiptData && (
              <motion.div
                key="carousel-step-3"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <h2 className="text-xl sm:text-2xl font-display font-extrabold text-slate-900">
                    {payment.session?.environment === 'production'
                      ? (lang==='es'?'Pago confirmado':'Payment confirmed')
                      : (lang==='es'?'Pago confirmado en sandbox':'Payment confirmed in sandbox')}
                  </h2>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    {payment.session?.isDemo
                      ? (lang==='es'?'Transacción de prueba guardada. No aplica pagos a facturas fiscales ni activa bodegas.':'Test transaction saved. It does not pay fiscal invoices or activate storage units.')
                      : payment.session?.source === 'manual'
                        ? (lang==='es'?'Conserve este comprobante. Roatan Self Storage registrará la aplicación del pago a su cuenta.':'Keep this receipt. Roatan Self Storage will record the payment against your account.')
                        : payment.session?.storeganise?.status==='active'
                          ? (lang==='es'?'Pago registrado por tarjeta. Su bodega está habilitada en Storeganise.':'Card payment recorded. Your unit is available in Storeganise.')
                          : (lang==='es'?'Su pago está guardado. Estamos confirmando su registro y el estado de su bodega con Storeganise.':'Your payment is saved. We are confirming its registration and your unit status with Storeganise.')}
                  </p>
                </div>

                {payment.session?.storeganise && <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm space-y-2" role="status">
                  <p className="font-bold text-slate-800">{lang==='es'?'Estado de su reserva':'Booking status'}</p>
                  <p>{payment.session.storeganise.status==='active'
                    ? (lang==='es'?'Pago aplicado y bodega habilitada. Puede regresar a su cuenta.':'Payment applied and unit available. You can return to your account.')
                    : payment.session.storeganise.status==='awaiting_move_in'
                      ? (lang==='es'?'Pago aplicado en Storeganise. La habilitación de la bodega está pendiente de completar la entrada.':'Payment applied in Storeganise. Your unit is awaiting move-in completion.')
                      : payment.session.storeganise.status==='review'
                        ? (lang==='es'?'Su pago está confirmado. El registro o la habilitación necesita revisión de Roatan Self Storage. Conserve este comprobante y no vuelva a pagar.':'Your payment is confirmed. Registration or activation needs review by Roatan Self Storage. Keep this receipt and do not pay again.')
                        : (lang==='es'?'Estamos registrando su pago en Storeganise. No vuelva a pagar; la confirmación se actualizará automáticamente.':'We are registering your payment in Storeganise. Do not pay again; confirmation will update automatically.')}</p>
                  {payment.session.storeganise.status!=='active'&&<button type="button" onClick={()=>void payment.refresh().catch(()=>{})} className="font-bold underline text-xs">{lang==='es'?'Actualizar estado':'Refresh status'}</button>}
                </div>}

                {/* Recibo digital con bordes limpios */}
                <div className="bg-[#f8fafc] rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
                  <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-[#1e3a8a]" />
                      <span className="font-display font-bold text-xs uppercase tracking-wider text-slate-800">
                        {t.receiptTitle}
                      </span>
                    </div>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                      {payment.session?.environment === 'production' ? (lang==='es'?'Autorizado':'Authorized') : (lang==='es'?'Sandbox aprobado':'Sandbox approved')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-y-3 text-xs">
                    <span className="text-slate-500 font-medium">{t.labelAuthCode}</span>
                    <span className="text-right font-mono font-bold text-slate-800">{receiptData.authCode || '—'}</span>

                    <span className="text-slate-500 font-medium">{t.labelTransactionId}</span>
                    <span className="text-right font-mono font-bold text-slate-800">{receiptData.transactionId}</span>

                    <span className="text-slate-500 font-medium">{t.labelReceiptUnit}</span>
                    <span className="text-right font-bold text-slate-900">{receiptData.unit}</span>

                    <span className="text-slate-500 font-medium">{t.labelReceiptClient}</span>
                    <span className="text-right font-bold text-slate-900">{receiptData.client}</span>

                    <span className="text-slate-500 font-medium">{t.labelReceiptCard}</span>
                    <span className="text-right font-mono text-slate-700">{receiptData.cardBrand || '—'} {receiptData.cardLast4 ? `•••• ${receiptData.cardLast4}` : ''}</span>

                    <span className="text-slate-500 font-medium">{t.labelReceiptDate}</span>
                    <span className="text-right text-slate-600">{new Date(receiptData.date).toLocaleString(lang==='es'?'es-HN':'en-US')}</span>

                    <div className="col-span-2 pt-3 border-t border-slate-200 flex justify-between items-center">
                      <span className="font-bold text-slate-800 text-sm">{t.labelReceiptAmount}</span>
                      <span className="font-mono font-black text-xl text-[#112a52]">{receiptData.priceReference ? `$ ${receiptData.priceReference.amount} USD` : `${receiptData.currency==='HNL'?'L ':''}${receiptData.amount} ${receiptData.currency}`}</span>
                    </div>
                    {receiptData.priceReference && <p className="col-span-2 text-xs leading-relaxed text-slate-600" data-testid="receipt-conversion">
                      {lang==='es'?'Débito realizado':'Amount charged'}: L {receiptData.amount} {receiptData.currency}. {lang==='es'?'Tipo de cambio':'Exchange rate'}: L {Number(receiptData.priceReference.hnlPerUsd)} / USD.
                      {receiptData.priceReference.source === 'BCH' && ` ${lang==='es'?'Fuente':'Source'}: Banco Central de Honduras · ${receiptData.priceReference.rateDate}`}
                    </p>}
                  </div>
                </div>

                {/* Botones de acción final */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex-1 py-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                  >
                    <span>{t.btnPrintReceipt}</span>
                  </button>

                  {payment.session?.storeganise ? <a href={payment.session.storeganise.returnUrl}
                    className="flex-1 py-3.5 rounded-xl bg-[#1F5C4F] hover:bg-[#17483e] text-white font-extrabold text-xs uppercase tracking-wider text-center">
                    {lang==='es'?'Volver a Storeganise':'Return to Storeganise'}
                  </a> : <button
                    type="button"
                    onClick={handleReset}
                    className="flex-1 py-3.5 rounded-xl bg-[#1F5C4F] hover:bg-[#17483e] text-white font-extrabold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:shadow-md"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>{t.btnPayAnother}</span>
                  </button>}
                </div>

              </motion.div>
            )}

          </AnimatePresence>

        </div>

      </div>

      {/* FOOTER: Firma profesional y segura */}
      <footer className="mt-6 text-center relative z-10 space-y-1">
        <p className="text-[8px] font-medium text-slate-400 tracking-wide uppercase">
          {t.footerSecured}
        </p>
        <div className="inline-flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-[9px] leading-relaxed">
          <span className="text-slate-500 font-medium">{t.footerCreated}</span>
          <a 
            href="https://bwpsoftware.com" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="font-black text-[#1F5C4F] hover:text-[#17483e] tracking-tight flex items-center gap-1"
          >
            <span>bwpsoftware</span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#1F5C4F] animate-pulse" />
          </a>
          <span className="text-slate-300">|</span>
          <a
            href="https://bwpentesting.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-slate-600 hover:text-[#1F5C4F]"
          >
            {t.footerSecurity}: bwpentesting
          </a>
        </div>
      </footer>

    </div>
  );
}
