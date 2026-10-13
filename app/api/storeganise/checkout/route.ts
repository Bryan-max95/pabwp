import { NextRequest,NextResponse } from 'next/server';
import { handleBillingCheckout } from '@/lib/storeganise/billing-checkout';
import { readStoreganiseWebhook,integrationErrorResponse } from '@/lib/storeganise/webhook';

export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:NextRequest){
  const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
  try{
    const payload=await readStoreganiseWebhook(req);
    const result=await handleBillingCheckout(payload);
    return NextResponse.json({url:result.url},{headers});
  }catch(error){const result=integrationErrorResponse(error);return NextResponse.json({error:result.error},{status:result.status,headers});}
}
