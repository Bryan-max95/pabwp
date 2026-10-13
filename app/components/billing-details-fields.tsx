'use client';
import type { BillTo } from '@/lib/cybersource/types';

/** Shown only if the authenticated Storeganise profile lacks a complete billing address. */
export function BillingDetailsFields({value,language}:{value?:BillTo;language:'es'|'en'}) {
  const fields = [
    {key:'firstName',es:'Nombre',en:'First name',autocomplete:'billing given-name',max:60},
    {key:'lastName',es:'Apellido',en:'Last name',autocomplete:'billing family-name',max:60},
    {key:'email',es:'Correo',en:'Email',autocomplete:'billing email',max:254,type:'email'},
    {key:'address1',es:'Dirección de facturación',en:'Billing address',autocomplete:'billing address-line1',max:60},
    {key:'locality',es:'Ciudad',en:'City',autocomplete:'billing address-level2',max:50},
    {key:'administrativeArea',es:'Departamento o estado',en:'State or region',autocomplete:'billing address-level1',max:50,optional:true},
    {key:'postalCode',es:'Código postal',en:'Postal code',autocomplete:'billing postal-code',max:10},
    {key:'country',es:'Código de país (HN, US…)',en:'Country code (HN, US…)',autocomplete:'billing country',max:2},
  ] as const;
  return <fieldset className="rounded-xl border border-slate-200 p-4 space-y-3">
    <legend className="px-2 text-xs font-bold text-slate-700">{language==='es'?'Facturación de la tarjeta':'Card billing details'}</legend>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{fields.map(field=><label key={field.key} className="text-xs text-slate-600 space-y-1">
      <span>{language==='es'?field.es:field.en}</span>
      <input name={`billing.${field.key}`} type={'type' in field?field.type:'text'} autoComplete={field.autocomplete}
        required={!('optional' in field&&field.optional)} maxLength={field.max} defaultValue={value?.[field.key]??''}
        pattern={field.key==='country'?'[A-Za-z]{2}':undefined}
        className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
    </label>)}</div>
  </fieldset>;
}

export function readBillingDetails(form:HTMLFormElement):BillTo {
  const values=new FormData(form);
  const get=(key:string)=>String(values.get(`billing.${key}`)??'').trim();
  return {firstName:get('firstName'),lastName:get('lastName'),email:get('email'),address1:get('address1'),
    locality:get('locality'),administrativeArea:get('administrativeArea'),postalCode:get('postalCode'),country:get('country').toUpperCase()};
}
