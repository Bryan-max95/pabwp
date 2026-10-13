import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { hnlCharge } from '../lib/pay/exchange-rate';

/** UI fixtures only. No bank requests, database writes or real exchange-rate claim. */
async function main() {
  const origin = new URL(process.env.PAY_PUBLIC_URL ?? 'http://localhost:3000');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Local server required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const priceReference = { amount: '199.00', currency: 'USD', hnlPerUsd: '26.500000', source: 'BCH', rateDate: '2026-10-09', fetchedAt: '2026-10-09T15:00:00Z' };
  const session = { id: '11111111-1111-4111-8111-111111111111', clientName: 'Cliente de prueba A', unitName: 'DEMO-A',
    concept: 'Prueba de interfaz — tasa simulada', currency: 'HNL', amount: hnlCharge('199.00', priceReference.hnlPerUsd),
    status: 'open', isDemo: true, environment: 'sandbox', portalStatus: 'disabled', priceReference };
  const directory = '.private/currency-ui';
  await fs.mkdir(directory, { recursive: true });
  let paymentRequests = 0;
  try {
    for (const width of [1280, 390]) {
      const previewContext = await browser.newContext({ viewport: { width, height: 980 } });
      const unexpected: string[] = [];
      await previewContext.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/') || /cybersource\.com$|cardinalcommerce\.com$/.test(url.hostname)) {
          unexpected.push(`${url.hostname}${url.pathname}`);
          return route.abort();
        }
        return route.continue();
      });
      const previewPage = await previewContext.newPage();
      const errors: string[] = [];
      previewPage.on('pageerror', error => errors.push(error.message));
      await previewPage.goto(origin.origin, { waitUntil: 'domcontentloaded' });
      await previewPage.locator('#client-name').waitFor();
      assert.equal(await previewPage.getByText('Sesión de pago requerida', { exact: true }).count(), 0);
      assert.equal(await previewPage.getByText('Vista previa del carrusel', { exact: false }).count(), 0);
      assert.equal(await previewPage.locator('form input').count(), 3, 'Keep only the three original rental fields');
      for (const id of ['unit-number', 'client-name', 'price-reference-usd']) {
        assert.equal(await previewPage.locator(`#${id}`).inputValue(), '', 'No example customer or amount');
        assert.equal(await previewPage.locator(`#${id}`).isEditable(), true);
      }
      assert.equal(await previewPage.getByRole('button', { name: 'Continuar a Datos de Tarjeta', exact: true }).isDisabled(), true);
      await waitForTransition(previewPage, 'charge-total');
      await previewPage.screenshot({ path: `${directory}/manual-details-${width}.png`, fullPage: true });
      await previewPage.locator('#unit-number').fill('B-10');
      await previewPage.locator('#client-name').fill('Cliente ingresado manualmente');
      await previewPage.locator('#price-reference-usd').fill('0');
      assert.equal(await previewPage.getByRole('button', { name: 'Continuar a Datos de Tarjeta', exact: true }).isDisabled(), true);
      await previewPage.locator('#price-reference-usd').fill('199.00');
      assert.equal(await previewPage.getByTestId('charge-total').textContent(), '$ 199.00 USD');
      await previewPage.getByRole('button', { name: 'Continuar a Datos de Tarjeta', exact: true }).click();
      await previewPage.locator('#card-expiration').waitFor();
      assert.equal(await previewPage.getByRole('button', { name: 'Ver ejemplo de confirmación', exact: true }).count(), 0);
      assert.equal(await previewPage.getByText('La vista previa no recibe datos de tarjeta ni realiza cobros.', { exact: true }).count(), 0);
      assert.equal(await previewPage.getByRole('button', { name: /^Pagar Ahora/ }).isDisabled(), true);
      assert.equal(await previewPage.locator('iframe').count(), 0);
      assert.equal(await previewPage.getByRole('heading', { name: 'Ejemplo de comprobante', exact: true }).count(), 0);
      await previewPage.screenshot({ path: `${directory}/manual-card-${width}.png`, fullPage: true, animations: 'disabled' });
      await previewPage.getByRole('button', { name: 'ENGLISH', exact: true }).click();
      await previewPage.getByRole('button', { name: 'Back to Details', exact: true }).click();
      await previewPage.locator('#client-name').waitFor();
      assert.equal(await previewPage.locator('#client-name').inputValue(), 'Cliente ingresado manualmente');
      assert.equal(await previewPage.locator('#unit-number').inputValue(), 'B-10');
      assert.equal(await previewPage.locator('#price-reference-usd').inputValue(), '199.00');
      assert.equal(await previewPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await previewPage.locator('footer p').evaluate(element => getComputedStyle(element).fontSize), '8px');
      assert.equal(await previewPage.evaluate(() => sessionStorage.getItem('pay-session-id')), null);
      assert.deepEqual(errors, []);
      assert.deepEqual(unexpected, [], 'Editing the form must not start a payment or request a card context without a valid session');
      await previewContext.close();
    }
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 980 } });
      let paid = false;
      await context.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.includes('payments') || path.includes('authentication')) paymentRequests++;
        if (path !== '/api/pay/session' && path !== '/api/pay/demo') return route.fulfill({ status: 503, json: { error: 'UI_FIXTURE_ONLY' } });
        return route.fulfill({ json: { session: paid ? { ...session, status: 'succeeded', receipt: {
          amount: session.amount, currency: 'HNL', priceReference, transactionId: 'UI-FIXTURE-NO-PAYMENT', date: priceReference.fetchedAt,
          unit: session.unitName, client: session.clientName, cardBrand: 'Visa', cardLast4: '0000',
        } } : session } });
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(45000);
      await page.goto(`${origin.origin}/?scenario=usd199`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('charge-total').waitFor();
      assert.equal(await page.getByTestId('charge-total').textContent(), '$ 199.00 USD');
      assert.equal(await page.locator('#price-reference-usd').inputValue(), '199.00');
      assert.match(await page.getByTestId('exchange-rate').innerText(), /5273\.50 HNL/);
      const customer = await page.getByTestId('summary-customer').boundingBox();
      const total = await page.getByTestId('charge-total').boundingBox();
      assert.ok(customer && total);
      assert.ok(customer.y + customer.height <= total.y || customer.x + customer.width <= total.x, 'Name and USD total must not overlap');
      await waitForTransition(page, 'charge-total');
      await page.screenshot({ path: `${directory}/usd-price-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Continuar a Datos de Tarjeta', exact: true }).click();
      await page.getByTestId('charge-disclosure').waitFor();
      assert.match(await page.getByTestId('charge-disclosure').innerText(), /5273\.50 HNL/);
      assert.match(await page.getByRole('button', { name: /Pagar Ahora/ }).innerText(), /199\.00 USD/);
      await page.getByRole('button', { name: 'ENGLISH', exact: true }).click();
      assert.match(await page.getByTestId('charge-disclosure').innerText(), /Your card will be charged L 5273\.50 HNL/);
      assert.match(await page.getByRole('button', { name: /Pay Now/ }).innerText(), /199\.00 USD/);
      paid = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTestId('receipt-conversion').waitFor();
      assert.match(await page.getByTestId('receipt-conversion').innerText(), /5273\.50 HNL/);
      assert.match(await page.getByTestId('receipt-conversion').innerText(), /Banco Central de Honduras/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal overflow');
      await waitForTransition(page, 'receipt-conversion');
      await page.screenshot({ path: `${directory}/receipt-${width}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      await context.close();
    }
    const manualContext = await browser.newContext();
    let manualPaid = false;
    await manualContext.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes('payments') || path.includes('authentication')) paymentRequests++;
      if (path !== '/api/pay/session') return route.fulfill({ status: 503, json: { error: 'UI_FIXTURE_ONLY' } });
      return route.fulfill({ json: { session: { ...session, isDemo: false, environment: 'production', source: 'manual',
        ...(manualPaid ? { status: 'succeeded', receipt: { amount: session.amount, currency: 'HNL', priceReference,
          transactionId: 'UI-FIXTURE-NO-PAYMENT', date: priceReference.fetchedAt, unit: session.unitName, client: session.clientName } } : {}) } } });
    });
    const manualPage = await manualContext.newPage();
    await manualPage.goto(`${origin.origin}/?session=${'a'.repeat(43)}`, { waitUntil: 'domcontentloaded' });
    await manualPage.getByTestId('charge-total').waitFor();
    assert.equal(await manualPage.locator('#price-reference-usd').getAttribute('readonly'), '');
    assert.equal(await manualPage.getByTestId('charge-total').textContent(), '$ 199.00 USD');
    assert.equal(await manualPage.getByRole('button', { name: 'Nueva prueba' }).count(), 0);
    manualPaid = true;
    await manualPage.reload({ waitUntil: 'domcontentloaded' });
    await manualPage.getByRole('heading', { name: 'Pago autorizado', exact: true }).waitFor();
    assert.equal(await manualPage.getByText('Sandbox aprobado', { exact: true }).count(), 0);
    await manualPage.getByText('Conserve este comprobante.', { exact: false }).waitFor();
    await manualContext.close();
    for (const failure of [
      { reason: 'DECLINED', status: 'DECLINED', es: 'El pago fue rechazado.', en: 'The payment was declined.' },
      { reason: 'EXPIRED_CARD', status: 'DECLINED', es: 'La tarjeta está vencida.', en: 'The card has expired.' },
      { reason: 'INVALID_DATA', status: 'INVALID_REQUEST', es: 'Revise el número de tarjeta', en: 'Check the card number' },
      { reason: 'AUTHENTICATION_FAILED', status: 'AUTHENTICATION_SETUP_FAILED', es: 'El servicio de pago no está disponible.', en: 'The payment service is unavailable.' },
    ]) {
      const failureContext = await browser.newContext();
      await failureContext.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.includes('payments') || path.includes('authentication')) paymentRequests++;
        if (path !== '/api/pay/session') return route.fulfill({ status: 503, json: { error: 'UI_FIXTURE_ONLY' } });
        return route.fulfill({ json: { session: { ...session, isDemo: false, environment: 'production', source: 'manual',
          status: 'declined', failureReason: failure.reason, gatewayStatus: failure.status } } });
      });
      const failurePage = await failureContext.newPage();
      await failurePage.goto(`${origin.origin}/?session=${'f'.repeat(43)}`, { waitUntil: 'domcontentloaded' });
      await failurePage.getByRole('button', { name: 'Continuar a Datos de Tarjeta', exact: true }).click();
      await failurePage.getByRole('alert').filter({ hasText: failure.es }).waitFor();
      assert.equal(await failurePage.getByRole('heading', { name: 'Pago autorizado', exact: true }).count(), 0);
      await failurePage.getByRole('button', { name: 'ENGLISH', exact: true }).click();
      await failurePage.getByRole('alert').filter({ hasText: failure.en }).waitFor();
      await failureContext.close();
    }
    const context = await browser.newContext();
    await context.route('**/api/**', route => route.fulfill({ status: route.request().url().endsWith('/demo') ? 503 : 401,
      json: { error: route.request().url().endsWith('/demo') ? 'EXCHANGE_RATE_UNAVAILABLE' : 'SESSION_REQUIRED' } }));
    const page = await context.newPage();
    await page.goto(`${origin.origin}/?demo=a`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Tipo de cambio no disponible' }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Pagar Ahora/ }).count(), 0);
    assert.equal(paymentRequests, 0);
    const invalidContext = await browser.newContext();
    const invalidRequests: string[] = [];
    await invalidContext.route('**/api/**', route => {
      invalidRequests.push(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 401, json: { error: 'INVALID_OR_EXPIRED_SESSION' } });
    });
    const invalidPage = await invalidContext.newPage();
    await invalidPage.goto(`${origin.origin}/?session=${'z'.repeat(43)}`, { waitUntil: 'domcontentloaded' });
    await invalidPage.getByText('No se pudo abrir el enlace de cobro.', { exact: false }).waitFor();
    assert.equal(await invalidPage.getByRole('button', { name: 'Continuar a Datos de Tarjeta', exact: true }).isDisabled(), true);
    assert.equal(await invalidPage.locator('#client-name').inputValue(), '');
    assert.deepEqual(invalidRequests, ['/api/pay/session']);
    await invalidContext.close();
    console.log(JSON.stringify({ ui: 'passed', widths: [1280, 390], languages: ['es', 'en'], manualForm: 'three-original-fields-no-extra-billing', invalidLink: 'cannot-pay', manualReceipt: 'verified', paymentFailures: 'decline-expiry-data-service', fixturesOnly: true, paymentRequests }));
  } finally { await browser.close(); }
}
async function waitForTransition(page: import('@playwright/test').Page, testId: string) {
  await page.waitForFunction(id => {
    let element: Element | null = document.querySelector(`[data-testid="${id}"]`);
    if (!element) return false;
    while (element) { if (Number(getComputedStyle(element).opacity) < 1) return false; element = element.parentElement; }
    return true;
  }, testId);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'UI check failed'); process.exitCode = 1; });
