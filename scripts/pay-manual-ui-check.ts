import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

/** Local browser fixtures only: no database, BCH, bank, tokenization or payment calls. */
async function main() {
  const origin = new URL(process.env.PAY_PUBLIC_URL ?? 'http://localhost:3010').origin;
  if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Local verification only');
  const fixtureLibrary = `window.Flex = function() { return { microform() { return {
    createField(type) { let frame; const handlers = {}; return {
      on(event, callback) { handlers[event] = callback; },
      load(selector) { frame = document.createElement('iframe');
        frame.title = type; frame.srcdoc = '<input name="' + type + '" autocomplete="off" />';
        frame.style = 'width:100%;height:30px;border:0';
        frame.onload = () => { if (handlers.load) handlers.load({}); };
        document.querySelector(selector).appendChild(frame);
      }, unload() { if(frame) frame.remove(); }
    }; }, createToken() { throw new Error('Tokenization forbidden in this UI check'); }
  }; } }; };`;
  const integrity = `sha256-${crypto.createHash('sha256').update(fixtureLibrary).digest('base64')}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const evidence: unknown[] = [];
  await fs.mkdir('.private/manual-ui', { recursive: true });
  try {
    for (const environment of ['sandbox', 'production']) for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 960 } });
      const sdk = `${environment === 'sandbox' ? 'https://testflex.cybersource.com' : 'https://flex.cybersource.com'}/fixture-manual.js`;
      const errors: string[] = [], unexpected: string[] = [];
      let manualCalls = 0, cardContexts = 0;
      let session: Record<string, unknown> = { id: crypto.randomUUID(), clientName: 'Cliente Manual', unitName: 'B-99',
        concept: 'Prueba manual', amount: '2623.50', currency: 'HNL', environment, status: 'open', source: 'manual', isDemo: false,
        portalStatus: 'disabled', priceReference: { amount: '99.00', currency: 'USD', hnlPerUsd: '26.500000', source: 'BCH', rateDate: '2026-10-13' } };
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (request.url() === sdk) return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fixtureLibrary });
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (url.pathname === '/api/pay/manual') {
          manualCalls++;
          const body = request.postDataJSON();
          assert.deepEqual(Object.keys(body).sort(), ['amount', 'clientName', 'reference', 'unitName']);
          assert.equal(body.amount, '99.00'); assert.equal(body.unitName, 'B-99'); assert.equal(body.clientName, 'Cliente Manual');
          session = { ...session, clientName: body.clientName, unitName: body.unitName };
          return route.fulfill({ json: { session } });
        }
        if (url.pathname === '/api/pay/session') return route.fulfill({ json: { session } });
        if (url.pathname === '/api/pay/capture-context') {
          cardContexts++;
          return route.fulfill({ json: { captureContext: 'ui-fixture', clientLibrary: sdk, clientLibraryIntegrity: integrity } });
        }
        unexpected.push(url.pathname);
        return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/${environment === 'production' ? '?session=' + 'a'.repeat(43) : ''}`, { waitUntil: 'domcontentloaded' });
      await page.locator('#client-name').waitFor();
      if (environment === 'sandbox') {
        assert.equal(await page.locator('form input').count(), 3);
        assert.equal(await page.locator('#client-name').inputValue(), '');
        assert.equal(manualCalls, 0); assert.equal(cardContexts, 0);
        await page.locator('#client-name').fill('Cliente Manual');
        await page.locator('#unit-number').fill('B-99');
        await page.locator('#price-reference-usd').fill('99');
      }
      await page.getByRole('button', { name: 'Continuar a Datos de Tarjeta', exact: true }).click();
      const number = page.frameLocator('#cybersource-card-number iframe').locator('input[name="number"]');
      const cvv = page.frameLocator('#cybersource-security-code iframe').locator('input[name="securityCode"]');
      await number.fill('4456530000001005'); await cvv.fill('123');
      await page.getByPlaceholder('NOMBRE COMO APARECE EN LA TARJETA').fill('CLIENTE MANUAL');
      await page.locator('#card-expiration').fill('01/29');
      assert.equal(await number.inputValue(), '4456530000001005'); assert.equal(await cvv.inputValue(), '123');
      assert.equal(await page.getByRole('button', { name: /^Pagar Ahora/ }).isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(manualCalls, environment === 'sandbox' ? 1 : 0);
      // React StrictMode repeats effect setup in development; both requests stay mocked.
      assert.ok(cardContexts >= 1 && cardContexts <= 2); assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
      await page.screenshot({ path: `.private/manual-ui/${environment}-${width}.png`, fullPage: true, animations: 'disabled' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('#client-name').waitFor();
      assert.equal(await page.locator('#price-reference-usd').inputValue(), '99.00');
      assert.equal(manualCalls, environment === 'sandbox' ? 1 : 0, 'Reload must preserve the session, not prepare another test');
      session = { ...session, status: 'unknown', failureCode: 'CAPTURE_FAILED' };
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Continuar a Datos de Tarjeta', exact: true }).click();
      await number.fill('4456530000001005'); await cvv.fill('123');
      await page.getByPlaceholder('NOMBRE COMO APARECE EN LA TARJETA').fill('CLIENTE MANUAL');
      await page.locator('#card-expiration').fill('01/29');
      await page.getByText('La tarjeta fue autorizada, pero no se pudo completar el cobro.', { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Pago pendiente de verificar', exact: true }).isEnabled(), false);
      assert.equal(await page.getByText('El pago fue rechazado.', { exact: false }).count(), 0);
      assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
      await page.screenshot({ path: `.private/manual-ui/partial-${environment}-${width}.png`, fullPage: true, animations: 'disabled' });
      evidence.push({ environment, width, editableCardFields: true, partialCaptureBlocksPayment: true, manualCalls, cardContexts, bankRequests: 0, paymentRequests: 0 });
      await context.close();
    }
    await fs.writeFile('.private/manual-ui/results.json', JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ manualCardEntry: 'passed', cases: evidence, fixturesOnly: true }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
