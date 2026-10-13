import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { openSandboxManualAccess, sandboxManualEnabled, sandboxManualInput, sandboxManualSchema } from '@/lib/pay/sandbox-manual';
import { assertSameOrigin, COOKIE } from '@/lib/pay/http';
import { createCheckoutSession, getSession, publicSession } from '@/lib/pay/service';
import { loadCredentials } from '@/lib/pay/credentials';
import { ExchangeRateError } from '@/lib/pay/bch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

/** Prepare a sandbox session. No card data, gateway context or financial request here. */
export async function POST(req: NextRequest) {
  if (!sandboxManualEnabled()) return NextResponse.json({ error: 'MANUAL_SANDBOX_DISABLED' }, { status: 404, headers });
  try { assertSameOrigin(req); }
  catch { return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers }); }
  const raw = await req.text();
  if (raw.length > 4096) return NextResponse.json({ error: 'INVALID_MANUAL_DATA' }, { status: 413, headers });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { value = null; }
  const body = sandboxManualSchema.safeParse(value);
  if (!body.success) return NextResponse.json({ error: 'INVALID_MANUAL_DATA' }, { status: 400, headers });
  try {
    await loadCredentials('sandbox');
    const created = await createCheckoutSession(sandboxManualInput(body.data));
    if (new Date(created.expiresAt).getTime() <= Date.now()) return NextResponse.json({ error: 'MANUAL_SESSION_EXPIRED' }, { status: 410, headers });
    const jar = await cookies();
    const cookieName = `${COOKIE}_${created.id}`;
    const existing = jar.get(cookieName)?.value;
    if (existing) {
      const session = await getSession(existing).catch(() => null);
      if (session?.id === created.id) return NextResponse.json({ session: publicSession(session) }, { headers });
    }
    const result = await openSandboxManualAccess(created.launchToken);
    jar.set(cookieName, result.accessToken, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 86400,
      secure: new URL(process.env.PAY_PUBLIC_URL!).protocol === 'https:' });
    return NextResponse.json({ session: publicSession(result.session) }, { headers });
  } catch (error) {
    // Diagnose failures without logging client data, credentials or provider responses.
    const code = error instanceof ExchangeRateError ? error.code :
      error instanceof Error && error.message === 'MANUAL_SESSION_NOT_RECOVERABLE' ? error.message :
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(error.code) ? error.code : 'PREPARATION_FAILED';
    console.error('Manual checkout preparation failed', { code });
    return NextResponse.json({ error: error instanceof ExchangeRateError ? 'EXCHANGE_RATE_UNAVAILABLE' : 'MANUAL_SESSION_UNAVAILABLE' }, { status: 503, headers });
  }
}
