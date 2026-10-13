import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import { createCheckoutSession } from '../lib/pay/service';
import { closeDatabase, query } from '../lib/pay/db';

/** Uses the user's already-running server. Never starts Next.js. */
async function main() {
  if (process.env.PAY_DEMO_ENABLED !== 'true') throw new Error('Demo is disabled');
  const submitPayments = process.argv.includes('--pay');
  const run = crypto.randomUUID();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const results = await Promise.all(['a', 'b'].map(async (suffix, index) => {
      const context = await browser.newContext();
      let phase = 'create-session';
      const session = await createCheckoutSession({
        eventId: `browser-${run}-${suffix}`, customerId: `demo-customer-${suffix}`,
        orderId: `demo-order-${run}-${suffix}`, invoiceId: `demo-invoice-${run}-${suffix}`,
        unitId: `demo-unit-${suffix}`, unitName: `DEMO-${suffix.toUpperCase()}`,
        clientName: `Cliente de prueba ${suffix.toUpperCase()}`, concept: 'Prueba de navegador sandbox',
        amount: '100.00', currency: 'HNL', environment: 'sandbox', isTest: true,
        isDemo: true, fiscalEnvironment: 'test', payable: true,
        billTo: { firstName: 'Demo', lastName: suffix.toUpperCase(), address1: '1 Test Street', locality: 'Miami',
          administrativeArea: 'FL', postalCode: '33101', country: 'US', email: `demo-${suffix}@example.com` },
      });
      const page = await context.newPage();
      let tokenShape: unknown;
      page.on('console', message => {
        if (message.text().startsWith('Secure card validation:')) console.log(JSON.stringify({ client: suffix, validation: message.text() }));
      });
      page.on('request', request => {
        if (!request.url().endsWith('/api/pay/payments')) return;
        try {
          const jwt = request.postDataJSON().transientToken as string;
          const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
          const shape = (value: unknown): unknown => value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([key, val]) => [key, shape(val)])) : typeof value;
          tokenShape = shape(payload);
        } catch { /* Do not log tokens. */ }
      });
      page.setDefaultTimeout(40_000);
      try {
        phase = 'load-session';
        await page.goto(session.launchUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.locator('input[readonly]').first().waitFor();
        assert.equal(await page.locator('input[readonly]').nth(0).inputValue(), `DEMO-${suffix.toUpperCase()}`);
        assert.equal(await page.getByTestId('charge-total').textContent(), 'L 100.00 HNL');
        phase = 'secure-fields';
        await page.getByRole('button', { name: 'Continuar a Datos de Tarjeta' }).click();
        const number = page.frameLocator('#cybersource-card-number iframe').locator('input[name="number"]');
        const cvv = page.frameLocator('#cybersource-security-code iframe').locator('input[name="securityCode"]');
        await page.locator('#cybersource-card-number iframe').waitFor();
        await number.waitFor(); await cvv.waitFor();
        console.log(JSON.stringify({ client: suffix, phase, status: 'ready', sessionId: session.id }));
        if (!submitPayments) return { client: suffix, fields: 'loaded', sessionId: session.id };
        phase = 'tokenize-and-pay';
        // Published sandbox test cards only. PAN/CVV go to CyberSource-owned frames.
        await number.click();
        await number.pressSequentially(index ? '5555555555554444' : '4111111111111111', { delay: 60 });
        await cvv.click();
        await cvv.pressSequentially('123', { delay: 60 });
        await page.getByPlaceholder('NOMBRE COMO APARECE EN LA TARJETA').fill(`DEMO ${suffix.toUpperCase()}`);
        await page.locator('#card-expiration').fill('12/30');
        const response = page.waitForResponse(r => r.url().endsWith('/api/pay/payments') && r.request().method() === 'POST', { timeout: 60_000 });
        await page.getByRole('button', { name: /^Pagar Ahora/ }).click();
        const result = await (await response).json();
        if (!result.session) throw new Error(String(result.error ?? 'NO_SESSION_RESPONSE') + ':' + String(result.category ?? ''));
        assert.equal(result.session.id, session.id);
        assert.equal(result.session.unitName, `DEMO-${suffix.toUpperCase()}`);
        assert.equal(result.session.amount, '100.00');
        const details = await query<{ status: string; gateway_status: string; failure_reason: string; gateway_transaction_id: string }>(
          'SELECT status,gateway_status,failure_reason,gateway_transaction_id FROM pay_sessions WHERE id=$1', [session.id]);
        return { client: suffix, ...details.rows[0], sessionId: session.id };
      } catch (error) {
        await saveFailureScreenshot(page, suffix);
        return { client: suffix, phase, failed: true, reason: error instanceof Error ? error.message.split('\n')[0].replace(/https?:\/\/\S+/g,'[url]') : 'Error', tokenShape, sessionId: session.id };
      }
    }));
    await fs.mkdir('.private', { recursive: true });
    await fs.writeFile('.private/browser-check.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    if (results.some(result => 'failed' in result)) process.exitCode = 1;
  } finally { await browser.close(); }
}
async function saveFailureScreenshot(page: Page, suffix: string) {
  await fs.mkdir('.private', { recursive: true });
  await page.screenshot({ path: `.private/browser-${suffix}.png`, fullPage: true }).catch(() => undefined);
}
main().catch(error => { console.error('Browser check failed:', error instanceof Error ? error.name : 'Error'); process.exitCode = 1; }).finally(closeDatabase);
