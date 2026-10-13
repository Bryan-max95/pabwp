'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  CreditCard,
  FileCheck2,
  Globe,
  Landmark,
  LockKeyhole,
  Scale,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';

type Language = 'es' | 'en';

const COPY = {
  es: {
    back: 'Volver al portal de pagos',
    eyebrow: 'Roatan Self Storage',
    title: 'Privacidad y políticas de pago',
    subtitle: 'Información clara sobre el tratamiento de datos, pagos en línea y transferencias bancarias.',
    contents: 'Contenido',
    updated: 'Última actualización',
    date: '24 de agosto de 2026',
    notice: 'Este documento describe el funcionamiento previsto del portal. Antes de aceptar pagos reales, Roatan Self Storage debe alinearlo con su contrato comercial, la configuración definitiva de BAC Credomatic y la legislación aplicable.',
    returnPayment: 'Regresar al pago',
    createdBy: 'Plataforma desarrollada por',
    securityBy: 'Ciberseguridad y pruebas por',
    developerDescription: 'Software, plataformas y experiencias digitales.',
    securityDescription: 'Ciberseguridad, evaluación y pruebas de seguridad.',
    bacText: 'Roatan Self Storage trabaja con BAC Credomatic para el procesamiento de pagos habilitado en producción.',
    sections: [
      {
        id: 'alcance', label: 'Alcance', title: '1. Alcance y aceptación', icon: FileCheck2,
        paragraphs: [
          'Estas políticas aplican al portal de pagos de Roatan Self Storage y a la información enviada para identificar una bodega, registrar un pago, emitir un comprobante o atender una consulta relacionada.',
          'Al continuar, el cliente confirma que los datos son correctos, que está autorizado para utilizar el medio de pago y que revisó el monto y el número de bodega antes de confirmar.',
        ],
      },
      {
        id: 'datos', label: 'Datos tratados', title: '2. Información que tratamos', icon: UserRoundCheck,
        paragraphs: ['Recopilamos solamente la información necesaria para identificar, procesar, conciliar y respaldar una operación.'],
        bullets: [
          'Nombre, información de contacto y número o referencia de la bodega.',
          'Monto, moneda, fecha, estado e identificadores de la transacción.',
          'Marca y últimos cuatro dígitos cuando la pasarela bancaria los devuelve.',
          'Datos técnicos de seguridad como dirección IP, navegador y registros de eventos.',
          'El portal no debe almacenar el número completo de tarjeta ni el código CVV.',
        ],
      },
      {
        id: 'tarjetas', label: 'Tarjetas', title: '3. Pagos en línea con tarjeta', icon: CreditCard,
        paragraphs: ['Los pagos están sujetos a autorización de BAC Credomatic, la red de la tarjeta y el banco emisor. Enviar el formulario no garantiza la aprobación.'],
        bullets: [
          'El cliente debe verificar monto, moneda y bodega antes de confirmar.',
          'El banco puede mostrar temporalmente una retención o cargo pendiente.',
          'La pasarela o el emisor pueden solicitar 3D Secure, Visa Secure o Mastercard Identity Check.',
          'Si el pago es rechazado, consulte con su banco o utilice otro medio de pago.',
          'No repita un pago mientras la transacción anterior permanezca pendiente.',
        ],
      },
      {
        id: 'transferencias', label: 'Transferencias', title: '4. Transferencias bancarias', icon: Landmark,
        paragraphs: ['Una transferencia se considera recibida después de que los fondos estén visibles y conciliados en la cuenta oficial indicada por Roatan Self Storage.'],
        bullets: [
          'Incluya el nombre del cliente y el número de bodega en la referencia.',
          'Confirme que la cuenta beneficiaria sea oficial antes de transferir.',
          'No envíe fondos a cuentas comunicadas únicamente por mensajes no verificados.',
          'Los cargos por envío, conversión o intermediación corresponden al ordenante salvo acuerdo distinto.',
          'El comprobante ayuda a localizar la operación, pero no sustituye la confirmación de fondos.',
        ],
      },
      {
        id: 'aplicacion', label: 'Aplicación', title: '5. Aplicación del pago', icon: Building2,
        paragraphs: [
          'El pago se aplicará al número de bodega informado. Una referencia incompleta o incorrecta puede quedar pendiente hasta verificar la identidad y la obligación correspondiente.',
          'El comprobante confirma el estado indicado en él, pero no modifica el contrato de almacenamiento, vencimientos, recargos u otras obligaciones vigentes.',
        ],
      },
      {
        id: 'reembolsos', label: 'Reembolsos', title: '6. Duplicados, disputas y reembolsos', icon: Scale,
        paragraphs: [
          'Los cargos duplicados, montos incorrectos o pagos aplicados a otra bodega deben reportarse por los canales oficiales, acompañados del comprobante necesario para investigar.',
          'Los reembolsos aprobados se enviarán, cuando sea posible, al medio de pago original. El tiempo de acreditación depende de la pasarela, la red y el banco emisor.',
        ],
      },
      {
        id: 'seguridad', label: 'Seguridad', title: '7. Seguridad y conservación', icon: LockKeyhole,
        paragraphs: ['La solución debe utilizar cifrado en tránsito, control de acceso, minimización de datos, registros técnicos y tokenización bancaria cuando la integración esté activa.'],
        bullets: [
          'BAC Credomatic y proveedores necesarios pueden tratar datos para autorizar, conciliar y prevenir fraude.',
          'La información se conserva solo durante los plazos operativos, contractuales, contables y legales necesarios.',
          'Ante un incidente confirmado se aplicarán medidas de contención, investigación y notificación según corresponda.',
          'Nunca solicitaremos el CVV o el número completo de tarjeta por correo, llamada o mensajería.',
        ],
      },
      {
        id: 'derechos', label: 'Derechos', title: '8. Derechos, cookies y contacto', icon: ShieldCheck,
        paragraphs: [
          'El cliente puede solicitar acceso, corrección o actualización de sus datos y, cuando sea aplicable, eliminación, oposición o limitación del tratamiento. Algunos registros deben conservarse por obligaciones legales o contractuales.',
          'El portal puede utilizar cookies necesarias para sesión, idioma y seguridad. Las herramientas de analítica deben administrarse conforme al consentimiento requerido.',
          'Para consultas utilice únicamente los canales oficiales de Roatan Self Storage y nunca comparta fotografías que muestren una tarjeta completa.',
        ],
      },
    ],
  },
  en: {
    back: 'Back to payment portal',
    eyebrow: 'Roatan Self Storage',
    title: 'Privacy and payment policies',
    subtitle: 'Clear information about data processing, online payments, and bank transfers.',
    contents: 'Contents',
    updated: 'Last updated',
    date: 'August 24, 2026',
    notice: 'This document describes the portal’s intended operation. Before accepting real payments, Roatan Self Storage must align it with its commercial agreement, the final BAC Credomatic configuration, and applicable law.',
    returnPayment: 'Return to payment',
    createdBy: 'Platform developed by',
    securityBy: 'Cybersecurity and testing by',
    developerDescription: 'Software, platforms, and digital experiences.',
    securityDescription: 'Cybersecurity, assessment, and security testing.',
    bacText: 'Roatan Self Storage works with BAC Credomatic for payment processing enabled in production.',
    sections: [
      {
        id: 'scope', label: 'Scope', title: '1. Scope and acceptance', icon: FileCheck2,
        paragraphs: [
          'These policies apply to the Roatan Self Storage payment portal and information submitted to identify a storage unit, record a payment, issue a receipt, or handle a related inquiry.',
          'By continuing, the customer confirms the information is accurate, they are authorized to use the payment method, and they reviewed the amount and storage unit number.',
        ],
      },
      {
        id: 'data', label: 'Data handled', title: '2. Information we process', icon: UserRoundCheck,
        paragraphs: ['We collect only the information needed to identify, process, reconcile, and support a transaction.'],
        bullets: [
          'Name, contact information, and storage unit number or reference.',
          'Amount, currency, date, status, and transaction identifiers.',
          'Card brand and last four digits when returned by the payment gateway.',
          'Security data such as IP address, browser, and event logs.',
          'The portal must not store the full card number or CVV.',
        ],
      },
      {
        id: 'cards', label: 'Cards', title: '3. Online card payments', icon: CreditCard,
        paragraphs: ['Payments are subject to authorization by BAC Credomatic, the card network, and the issuing bank. Submitting the form does not guarantee approval.'],
        bullets: [
          'Customers must verify the amount, currency, and storage unit before confirmation.',
          'The bank may temporarily display a hold or pending charge.',
          'The gateway or issuer may request 3D Secure, Visa Secure, or Mastercard Identity Check.',
          'If declined, contact your bank or use another payment method.',
          'Do not repeat a payment while the previous transaction remains pending.',
        ],
      },
      {
        id: 'transfers', label: 'Transfers', title: '4. Bank transfers', icon: Landmark,
        paragraphs: ['A transfer is considered received after funds are visible and reconciled in the official account designated by Roatan Self Storage.'],
        bullets: [
          'Include the customer name and storage unit number in the reference.',
          'Confirm that the beneficiary account is official before transferring.',
          'Do not send funds to accounts communicated only through unverified messages.',
          'Sending, conversion, and intermediary fees belong to the sender unless otherwise agreed.',
          'A receipt helps locate the transaction but does not replace confirmation of received funds.',
        ],
      },
      {
        id: 'allocation', label: 'Allocation', title: '5. Payment allocation', icon: Building2,
        paragraphs: [
          'Payment will be applied to the submitted storage unit number. An incomplete or incorrect reference may remain pending while identity and the related obligation are verified.',
          'A receipt confirms the status shown on it but does not modify the storage agreement, due dates, late charges, or other current obligations.',
        ],
      },
      {
        id: 'refunds', label: 'Refunds', title: '6. Duplicates, disputes, and refunds', icon: Scale,
        paragraphs: [
          'Duplicate charges, incorrect amounts, or payments applied to another unit must be reported through official channels with the receipt needed for investigation.',
          'Approved refunds will be returned to the original payment method when possible. Posting time depends on the gateway, network, and issuing bank.',
        ],
      },
      {
        id: 'security', label: 'Security', title: '7. Security and retention', icon: LockKeyhole,
        paragraphs: ['The solution should use encryption in transit, access controls, data minimization, technical logs, and bank tokenization when the integration is active.'],
        bullets: [
          'BAC Credomatic and required providers may process data for authorization, reconciliation, and fraud prevention.',
          'Information is retained only for necessary operational, contractual, accounting, and legal periods.',
          'A confirmed incident will trigger appropriate containment, investigation, and notification measures.',
          'We will never request a CVV or full card number by email, phone, or messaging.',
        ],
      },
      {
        id: 'rights', label: 'Rights', title: '8. Rights, cookies, and contact', icon: ShieldCheck,
        paragraphs: [
          'Customers may request access, correction, or updating of their data and, where applicable, deletion, objection, or restriction. Some records must be retained for legal or contractual obligations.',
          'The portal may use cookies required for sessions, language, and security. Analytics tools must be managed according to applicable consent requirements.',
          'For inquiries, use only official Roatan Self Storage channels and never share photographs showing a complete payment card.',
        ],
      },
    ],
  },
};

export default function PrivacyPage() {
  const [lang, setLang] = useState<Language>('es');
  const t = COPY[lang];

  return (
    <main className="min-h-screen bg-[#f4f8f7] text-slate-800">
      <header className="border-b border-emerald-950/10 bg-[#173f38] text-white">
        <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
          <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
            <Link href="/" className="inline-flex items-center gap-2 text-xs font-bold text-white/75 hover:text-white">
              <ArrowLeft className="h-4 w-4" />{t.back}
            </Link>
            <div className="flex items-center rounded-md border border-white/20 bg-white/10 p-1">
              <Globe className="mx-2 h-4 w-4 text-white/70" />
              {(['es', 'en'] as Language[]).map((language) => (
                <button key={language} type="button" onClick={() => setLang(language)} className={`rounded px-3 py-1.5 text-xs font-extrabold ${lang === language ? 'bg-white text-[#173f38]' : 'text-white/70 hover:text-white'}`}>
                  {language === 'es' ? 'ESPAÑOL' : 'ENGLISH'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-white/20 bg-white/10"><ShieldCheck className="h-7 w-7" /></div>
            <div>
              <p className="mb-1 text-xs font-extrabold uppercase text-emerald-100">{t.eyebrow}</p>
              <h1 className="font-display text-2xl font-extrabold sm:text-3xl">{t.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">{t.subtitle}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-3 text-[11px] font-extrabold uppercase text-slate-500">{t.contents}</p>
          <nav aria-label={t.contents} className="border-l border-slate-200">
            {t.sections.map((section) => <a key={section.id} href={`#${section.id}`} className="block border-l-2 border-transparent px-4 py-2 text-xs font-semibold text-slate-500 hover:border-[#1F5C4F] hover:text-[#1F5C4F]">{section.label}</a>)}
          </nav>
          <div className="mt-6 border-t border-slate-200 pt-4 text-[11px] leading-relaxed text-slate-500"><p className="font-bold text-slate-700">{t.updated}</p><p>{t.date}</p></div>
        </aside>

        <article className="min-w-0 space-y-10">
          <div className="border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-950">{t.notice}</div>
          <div className="border-y border-slate-200 py-5">
            <p className="text-sm font-bold text-slate-800">{t.bacText}</p>
            <a href="https://www.baccredomatic.com/es-hn" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-extrabold text-[#c8102e] hover:underline">BAC Credomatic Honduras ↗</a>
          </div>

          {t.sections.map(({ id, title, icon: Icon, paragraphs, bullets }) => (
            <section key={id} id={id} className="scroll-mt-6 border-b border-slate-200 pb-10 last:border-0">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-[#1F5C4F]"><Icon className="h-5 w-5" /></div>
                <h2 className="font-display text-lg font-extrabold text-slate-900 sm:text-xl">{title}</h2>
              </div>
              <div className="space-y-3 text-sm leading-7 text-slate-600">
                {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {bullets && <ul className="space-y-1.5">{bullets.map((bullet) => <li key={bullet} className="ml-5 list-disc">{bullet}</li>)}</ul>}
              </div>
            </section>
          ))}

          <div className="border-y border-slate-200 py-7">
            <div className="grid gap-5 sm:grid-cols-2">
              <div><p className="text-[11px] font-bold uppercase text-slate-400">{t.createdBy}</p><a href="https://bwpsoftware.com" target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-display text-lg font-extrabold text-[#1F5C4F] hover:underline">bwpsoftware ↗</a><p className="mt-1 text-xs text-slate-500">{t.developerDescription}</p></div>
              <div><p className="text-[11px] font-bold uppercase text-slate-400">{t.securityBy}</p><a href="https://bwpentesting.com" target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-display text-lg font-extrabold text-[#1F5C4F] hover:underline">bwpentesting ↗</a><p className="mt-1 text-xs text-slate-500">{t.securityDescription}</p></div>
            </div>
          </div>

          <Link href="/" className="inline-flex items-center gap-2 rounded-md bg-[#1F5C4F] px-5 py-3 text-xs font-extrabold text-white shadow-sm hover:bg-[#17483e]"><ArrowLeft className="h-4 w-4" />{t.returnPayment}</Link>
        </article>
      </div>
    </main>
  );
}
