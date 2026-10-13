import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleBillingCheckout } from '@/lib/storeganise/billing-checkout';
import { handleBillingList } from '@/lib/storeganise/billing-list';
import { handleBillingCharge } from '@/lib/storeganise/billing-charge';
import { readStoreganiseWebhook,integrationErrorResponse } from '@/lib/storeganise/webhook';
import { wakeStoreganiseDeliveries,retryDueStoreganiseDeliveries } from '@/lib/storeganise/sync';
import { sgId } from '@/lib/storeganise/records';

export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const wakeEvents=new Set(['invoice.payments.updated','invoice.state.updated','invoice.deleted',
  'job.unit_moveIn.completed','job.unit_moveIn.cancelled','unit.occupied','unit.unassigned','unitRental.updated']);
const wakeIds=z.object({invoiceId:sgId.optional(),jobId:sgId.optional(),unitId:sgId.optional(),unitRentalId:sgId.optional()});

export async function GET(){return NextResponse.json({ok:true,service:'Storeganise payment handoff'},{headers});}
export async function POST(req:NextRequest){
  try{
    const payload=await readStoreganiseWebhook(req);
    const event=payload.type??payload.event;
    if(event==='billing.checkout'||event==='pay.checkout'){
      const result=await handleBillingCheckout(payload);
      if(event==='pay.checkout')return NextResponse.json({url:result.url},{headers});
      return new NextResponse(result.html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
    }
    if(event==='billing.list')return NextResponse.json(await handleBillingList(),{headers});
    if(event==='billing.charge')return NextResponse.json(await handleBillingCharge(),{status:409,headers});
    if(event&&wakeEvents.has(event)){
      const ids=wakeIds.parse(payload.data);
      // Some event producers use data.id for the event's entity. This only wakes
      // existing paid sessions; the worker still verifies records via the API.
      const entityId=sgId.safeParse(payload.data.id);
      if(entityId.success){
        if(event.startsWith('invoice.'))ids.invoiceId??=entityId.data;
        else if(event.startsWith('job.'))ids.jobId??=entityId.data;
        else if(event.startsWith('unitRental.'))ids.unitRentalId??=entityId.data;
        else if(event.startsWith('unit.'))ids.unitId??=entityId.data;
      }
      await wakeStoreganiseDeliveries(ids);
      after(()=>retryDueStoreganiseDeliveries());
      return NextResponse.json({received:true},{headers});
    }
    return NextResponse.json({received:true,ignored:true},{headers});
  }catch(error){const result=integrationErrorResponse(error);return NextResponse.json({error:result.error},{status:result.status,headers});}
}

