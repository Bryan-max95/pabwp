import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { COOKIE, assertSameOrigin } from '@/lib/pay/http';
import { demoCheckout, localDemoEnabled } from '@/lib/pay/demo';
import { DEMO_SCENARIOS, DEFAULT_DEMO_SCENARIO } from '@/lib/pay/demo-scenarios';
import { ExchangeRateError } from '@/lib/pay/bch';
import { createCheckoutSession, exchangeLaunchToken, publicSession } from '@/lib/pay/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const bodySchema = z.object({ variant: z.enum(['a', 'b']).default('a'), scenario: z.enum(DEMO_SCENARIOS).default(DEFAULT_DEMO_SCENARIO) }).strict();

export async function POST(req: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!localDemoEnabled(req.url, req.headers.get('host'))) return NextResponse.json({ error: 'DEMO_DISABLED' }, { status: 404, headers });
  try { assertSameOrigin(req); }
  catch { return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers }); }
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID_DEMO_DATA' }, { status: 400, headers });
  try {
    const created = await createCheckoutSession(demoCheckout(body.data.variant, body.data.scenario));
    const result = await exchangeLaunchToken(created.launchToken);
    (await cookies()).set(`${COOKIE}_${result.session.id}`, result.accessToken, {
      httpOnly: true, secure: new URL(process.env.PAY_PUBLIC_URL!).protocol === 'https:',
      sameSite: 'strict', path: '/', maxAge: 86400,
    });
    return NextResponse.json({ session: publicSession(result.session) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ExchangeRateError ? 'EXCHANGE_RATE_UNAVAILABLE' : 'DEMO_UNAVAILABLE' }, { status: 503, headers });
  }
}
