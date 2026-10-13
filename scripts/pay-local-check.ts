import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { closeDatabase, query } from '../lib/pay/db';

/** Exercise only the existing local server; never start or stop it. */
async function main() {
  const origin = new URL(process.env.PAY_PUBLIC_URL ?? '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Local server required');
  const diagnostic = process.argv.includes('--diagnostic');
  const pay = process.argv.includes('--pay') || diagnostic;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const results = await Promise.all((diagnostic ? ['a'] : ['a', 'b']).map(async variant => {
      const context = await browser.newContext();
      const page = await context.newPage();
      if (diagnostic) await page.route('**/api/pay/payments', route => route.continue({ url: `${origin.origin}/api/pay/diagnostic` }));
      page.setDefaultTimeout(45000);
      await page.goto(`${origin.origin}/?demo=${variant}&scenario=hnl100`, { waitUntil: 'domcontentloaded' });
      const fields = page.locator('input[readonly]');
      await fields.first().waitFor();
      assert.equal(await fields.nth(0).inputValue(), `DEMO-${variant.toUpperCase()}`);
      assert.equal(await page.getByTestId('charge-total').textContent(), 'L 100.00 HNL');
      const sessionId = await page.evaluate(() => sessionStorage.getItem('pay-session-id'));
      assert.ok(sessionId);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await fields.first().waitFor();
      assert.equal(await page.evaluate(() => sessionStorage.getItem('pay-session-id')), sessionId, 'Reload must keep its session');
      const alien = await context.request.get(`${origin.origin}/api/pay/session`, { headers: { 'x-pay-session': crypto.randomUUID() } });
      assert.equal(alien.status(), 401);
      await page.getByRole('button', { name: 'Continuar a Datos de Tarjeta' }).click();
      const number = page.frameLocator('#cybersource-card-number iframe').locator('input[name="number"]');
      const cvv = page.frameLocator('#cybersource-security-code iframe').locator('input[name="securityCode"]');
      await number.waitFor(); await cvv.waitFor();
      console.log(JSON.stringify({ variant, sessionId, phase: 'local-checkout-ready' }));
      if (!pay) {
        await fs.mkdir('.private', { recursive: true });
        await page.screenshot({ path: `.private/local-check-${variant}.png`, fullPage: true });
        const renewed = page.waitForResponse(r => r.url().endsWith('/api/pay/demo') && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Nueva prueba', exact: true }).click();
        const next = await (await renewed).json();
        assert.notEqual(next.session.id, sessionId, 'New test must use a new invoice/session');
        assert.equal(next.session.unitName, `DEMO-${variant.toUpperCase()}`);
        return { variant, sessionId, fields: 'ready', reload: 'isolated', unauthorized: 'rejected', newTest: 'verified' };
      }
      // Official Payer Authentication 2.1 success and 2.2 failure cases; test data only.
      await number.fill(variant === 'a' ? (diagnostic || process.argv.includes('--standard-card') ? '4111111111111111' : '4456530000001005') : '5200000000001013');
      await cvv.fill('123');
      await page.getByPlaceholder('NOMBRE COMO APARECE EN LA TARJETA').fill('DEMO TEST');
      await page.locator('#card-expiration').fill(`01/${String(new Date().getFullYear() + 3).slice(-2)}`);
      const response = page.waitForResponse(r => ['/api/pay/payments','/api/pay/diagnostic'].some(path => r.url().endsWith(path)) && r.request().method() === 'POST', { timeout: 90000 });
      const completed = !diagnostic ? page.waitForResponse(async r => r.url().endsWith('/api/pay/authentication') && r.request().method() === 'POST' &&
        (await r.json()).session?.status !== 'pending', { timeout: 90000 }).catch(() => null) : undefined;
      await page.getByRole('button', { name: /^Pagar Ahora/ }).click();
      const result = await (await response).json();
      assert.equal(result.session?.id, sessionId, 'Payment response must retain session identity');
      if (result.authentication) {
        const finalResponse = await completed;
        assert.ok(finalResponse, 'Authentication must finish');
        const final = await finalResponse.json();
        assert.equal(final.session?.id, sessionId);
      }
      // Read-only reconciliation of the recorded transaction, never a second charge.
      await context.request.get(`${origin.origin}/api/pay/session`, { headers: { 'x-pay-session': sessionId } });
      const stored = await query<{status: string; gateway_status: string; failure_reason: string; gateway_transaction_id: string}>('SELECT status,gateway_status,failure_reason,gateway_transaction_id FROM pay_sessions WHERE id=$1', [sessionId]);
      const attempts = await query('SELECT count(*)::int AS count FROM pay_attempts WHERE session_id=$1', [sessionId]);
      assert.equal(attempts.rows[0].count, 1);
      const deliveries = await query('SELECT count(*)::int AS count FROM portal_deliveries WHERE session_id=$1', [sessionId]);
      assert.equal(deliveries.rows[0].count, 0);
      return { variant, sessionId, ...stored.rows[0], attempts: 1, portalDeliveries: 0 };
    }));
    if (!diagnostic) assert.notEqual(results[0].sessionId, results[1].sessionId);
    const invalidContext = await browser.newContext();
    const invalidPage = await invalidContext.newPage();
    let demoRequests = 0;
    invalidPage.on('request', r => { if (r.url().endsWith('/api/pay/demo')) demoRequests += 1; });
    await invalidPage.goto(`${origin.origin}/?session=${'z'.repeat(43)}`, { waitUntil: 'domcontentloaded' });
    await invalidPage.getByText('No se pudo abrir el enlace de cobro.', { exact: false }).waitFor();
    assert.equal(demoRequests, 0, 'Explicit invalid links must not silently turn into demos');
    await fs.mkdir('.private', { recursive: true });
    await fs.writeFile(diagnostic ? '.private/authorization-diagnostic.json' : pay ? '.private/local-payment-check.json' : '.private/local-check.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    const states = results.map(result => 'status' in result ? result.status : undefined);
    if (pay && (diagnostic ? states[0] !== 'authorized' : states[0] !== 'succeeded' || states[1] !== 'declined')) process.exitCode = 1;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message.split('\n')[0] : 'Local check failed'); process.exitCode = 1; }).finally(closeDatabase);
