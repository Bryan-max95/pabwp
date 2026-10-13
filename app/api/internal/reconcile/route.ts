import crypto from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pay/db';
import { reconcileSession } from '@/lib/pay/reconcile';
import { retryDueStoreganiseDeliveries } from '@/lib/storeganise/sync';
import { gatewayEnvironment } from '@/lib/cybersource/environment';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const provided = Buffer.from(req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '');
  const authorized = [process.env.CRON_SECRET,process.env.PAY_RETRY_SECRET].some(value=>{
    const secret=Buffer.from(value??'');
    return secret.length>=32&&secret.length===provided.length&&crypto.timingSafeEqual(secret,provided);
  });
  if (!authorized) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const attempts = await query<{ session_id: string }>(`SELECT a.session_id FROM pay_attempts a
    JOIN pay_sessions s ON s.id=a.session_id WHERE s.environment=$1 AND s.status IN ('unknown','pending','processing')
    AND a.attempt_no=(SELECT max(p.attempt_no) FROM pay_attempts p WHERE p.session_id=s.id)
    AND ((a.status IN ('unknown','pending') AND a.gateway_transaction_id IS NOT NULL)
      OR (a.status='processing' AND a.updated_at<now()-interval '2 minutes'))
    ORDER BY a.last_reconciled_at NULLS FIRST,a.updated_at LIMIT 3`,[gatewayEnvironment()]);
  const results=await Promise.allSettled(attempts.rows.map(attempt=>reconcileSession(attempt.session_id)));
  after(()=>retryDueStoreganiseDeliveries());
  return NextResponse.json({ ok: true, checked:results.filter(result=>result.status==='fulfilled').length },{headers:{'Cache-Control':'no-store'}});
}
export const GET=POST;
