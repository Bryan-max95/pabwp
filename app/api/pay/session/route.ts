import { after,NextRequest,NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE,authenticatedSession,assertSameOrigin } from '@/lib/pay/http';
import { exchangeLaunchToken,publicSession } from '@/lib/pay/service';
import { reconcileSession } from '@/lib/pay/reconcile';
import { gatewayEnvironment } from '@/lib/cybersource/environment';
import { needsLegacyPaymentReview } from '@/lib/pay/payment-state';
import { syncStoreganiseSession } from '@/lib/storeganise/sync';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(){
  try{
    const session=await authenticatedSession();
    if(session.environment!==gatewayEnvironment())return NextResponse.json({error:'SESSION_ENVIRONMENT_CHANGED'},{status:409,headers:{'Cache-Control':'no-store'}});
    const updated=['processing','pending','unknown'].includes(session.status)||needsLegacyPaymentReview(session)?await reconcileSession(session.id):undefined;
    const current=updated??session;
    if(current.status==='succeeded'&&current.storeganise_context&&current.storeganise_status!=='active'){
      after(async()=>{try{await syncStoreganiseSession(current.id);}catch{/* The durable queue retains this delivery. */}});
    }
    return NextResponse.json({session:publicSession(current)},{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'SESSION_REQUIRED'},{status:401,headers:{'Cache-Control':'no-store'}});}
}
export async function POST(req:NextRequest){try{assertSameOrigin(req);const body=await req.json();if(typeof body.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.token))return NextResponse.json({error:'INVALID_TOKEN'},{status:400});const result=await exchangeLaunchToken(body.token);(await cookies()).set(`${COOKIE}_${result.session.id}`,result.accessToken,{httpOnly:true,secure:new URL(process.env.PAY_PUBLIC_URL!).protocol==='https:',sameSite:'strict',path:'/',maxAge:86400});return NextResponse.json({session:publicSession(result.session)},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'INVALID_OR_EXPIRED_SESSION'},{status:401});}}
