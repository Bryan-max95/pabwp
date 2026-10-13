import { NextResponse } from 'next/server';
// Fiscal notifications originate from Storeganise, never directly from Pay.
export async function POST(){return NextResponse.json({error:'DIRECT_PORTAL_DELIVERY_REMOVED'},{status:410});}

