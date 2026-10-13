import crypto from 'node:crypto';
import { NextRequest,NextResponse } from 'next/server';
import { retryDueStoreganiseDeliveries } from '@/lib/storeganise/sync';

export const runtime='nodejs';
export const maxDuration=60;
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){
  const secret=process.env.CRON_SECRET;
  const supplied=req.headers.get('authorization')?.replace(/^Bearer /,'')??'';
  if(!secret||secret.length<32||Buffer.byteLength(secret)!==Buffer.byteLength(supplied)||
    !crypto.timingSafeEqual(Buffer.from(secret),Buffer.from(supplied)))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
  await retryDueStoreganiseDeliveries();
  return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
}
export const GET=POST;
