import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const transactionId = String(form.get('TransactionId') ?? form.get('transactionId') ?? '');
  const safe = transactionId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 200);
  return new NextResponse(`<!doctype html><script>window.parent.postMessage(${JSON.stringify({ type: 'cybersource-authentication', transactionId: safe })}, ${JSON.stringify(new URL(process.env.PAY_PUBLIC_URL!).origin)})</script>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}