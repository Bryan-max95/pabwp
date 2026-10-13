import { cookies, headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { getSession } from './service';
export const COOKIE='pay_session';
export async function authenticatedSession(){
  const id=(await headers()).get('x-pay-session');
  if(!id || !/^[a-f0-9-]{36}$/.test(id))throw new Error('Payment session required');
  const value=(await cookies()).get(`${COOKIE}_${id}`)?.value;
  if(!value)throw new Error('Payment session required');
  const session=await getSession(value);
  if(session.id!==id)throw new Error('Session identity mismatch');
  return session;
}
export function assertSameOrigin(req:NextRequest) {
  const expected=new URL(process.env.PAY_PUBLIC_URL ?? '').origin;
  if(req.headers.get('origin')!==expected || req.headers.get('sec-fetch-site')==='cross-site')throw new Error('Invalid request origin');
}
