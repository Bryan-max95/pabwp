import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { DEMO_AMOUNTS, HNL_DEMO_SCENARIOS, DEMO_SCENARIOS, DEMO_CURRENCY, demoCurrency, type DemoScenario } from '../lib/pay/demo-scenarios';
import { CyberSourceGateway } from '../lib/cybersource/gateway';
import { closeDatabase, query } from '../lib/pay/db';

// Official Payer Authentication 2.1 frictionless-success fixtures, never real cards.
const cards = [
  { brand: 'Visa', number: '4456530000001005', cvv: '123' },
  { brand: 'Mastercard', number: '5200000000001005', cvv: '123' },
  { brand: 'American Express', number: '340000000001007', cvv: '1234' },
] as const;
interface Result {
  brand: string; last4: string; amount: string; currency: 'HNL'; scenario: string;
  referenceUsd?: string; hnlPerUsd?: string; providerAmount?: string; providerCurrency?: string;
  sessionId?: string; reference?: string; setupId?: string; authenticationId?: string;
  authenticationStatus?: string; paresStatus?: string; transactionId?: string;
  status?: string; gatewayStatus?: string; failureReason?: string; attempts?: number; portalDeliveries?: number;
  testError?: string; searchError?: string;
  applications?: Array<{ name?: string; code?: string; flag?: string; merchantIdError: boolean }>;
}

/** New sessions only. Never starts Next.js, resubmits an uncertain payment or logs tokens. */
async function main() {
  const pay = process.argv.includes('--pay');
  if ((process.env.CYBERSOURCE_ENVIRONMENT ?? 'sandbox') !== 'sandbox' || !/^test_/i.test(process.env.CYBERSOURCE_MERCHANT_ID ?? '')) throw new Error('Sandbox gateway profile required');
  const scenarioOption = process.argv.find(arg => arg.startsWith('--scenarios='))?.slice('--scenarios='.length);
  const selectedScenarios = scenarioOption ? scenarioOption.split(',') as DemoScenario[] : [...HNL_DEMO_SCENARIOS];
  if (!selectedScenarios.length || new Set(selectedScenarios).size !== selectedScenarios.length || selectedScenarios.some(s => !DEMO_SCENARIOS.includes(s) || demoCurrency(s) !== 'HNL')) throw new Error('Invalid HNL sandbox scenarios');
  const brandOption = process.argv.find(arg => arg.startsWith('--brand='))?.slice('--brand='.length);
  const brandNames: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express' };
  if (brandOption && !Object.hasOwn(brandNames, brandOption)) throw new Error('Invalid sandbox card brand');
  const selectedCards = brandOption ? cards.filter(card => card.brand === brandNames[brandOption]) : cards;
  const origin = new URL(process.env.PAY_PUBLIC_URL ?? '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || process.env.PAY_DEMO_ENABLED !== 'true') throw new Error('Enabled local sandbox required');
  const run = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.join('.private', `amount-matrix-hnl-${run}`);
  await fs.mkdir(directory, { recursive: true });
  const results: Result[] = [];
  const save = () => fs.writeFile(path.join(directory, 'results.json'), JSON.stringify({ run, pay, results }, null, 2));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const card of pay ? selectedCards : selectedCards.slice(0, 1)) {
      for (const scenario of selectedScenarios) {
        const result: Result = { brand: card.brand, last4: card.number.slice(-4), amount: DEMO_AMOUNTS[scenario], currency: DEMO_CURRENCY, scenario };
        results.push(result);
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(45000);
        let paymentPosts = 0;
        await page.route('**/api/pay/payments', route => {
          if (route.request().method() === 'POST' && ++paymentPosts > 1) return route.abort();
          return route.continue();
        });
        let stage = 'session';
        try {
          const variant = card.brand === 'Mastercard' ? 'b' : 'a';
          await page.goto(`${origin.origin}/?demo=${variant}&scenario=${scenario}`, { waitUntil: 'domcontentloaded' });
          const fields = page.locator('input[readonly]');
          await fields.first().waitFor();
          assert.equal(await page.getByTestId('charge-total').textContent(), `L ${result.amount} HNL`);
          result.sessionId = (await page.evaluate(() => sessionStorage.getItem('pay-session-id'))) ?? undefined;
          assert.ok(result.sessionId);
          assert.equal(results.filter(r => r.sessionId === result.sessionId).length, 1, 'Each case must use a new session');
          const sessionResponse = await context.request.get(`${origin.origin}/api/pay/session`, { headers: { 'x-pay-session': result.sessionId } });
          assert.equal(sessionResponse.status(), 200);
          const current = (await sessionResponse.json()).session;
          assert.equal(current.amount, result.amount); assert.equal(current.currency, DEMO_CURRENCY);
          assert.equal(current.isDemo, true); assert.equal(current.environment, 'sandbox');
          assert.equal(current.status, 'open'); assert.equal(current.portalStatus, 'disabled');
          result.referenceUsd = current.priceReference?.amount; result.hnlPerUsd = current.priceReference?.hnlPerUsd;
          assert.equal(await page.locator('#price-reference-usd').inputValue(), result.referenceUsd ?? result.amount);
          await page.screenshot({ path: path.join(directory, `${scenario}-${card.brand.replaceAll(' ', '-')}-checkout.png`), fullPage: true });
          await save();
          if (!pay) {
            const invalid = await context.request.post(`${origin.origin}/api/pay/demo`, { headers: { Origin: origin.origin }, data: { scenario, amount: '999.00' } });
            assert.equal(invalid.status(), 400, 'Browser cannot supply arbitrary amount');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await fields.first().waitFor();
            assert.equal(await page.getByTestId('charge-total').textContent(), `L ${result.amount} HNL`);
            assert.equal(await page.evaluate(() => sessionStorage.getItem('pay-session-id')), result.sessionId);
            const renewed = page.waitForResponse(r => r.url().endsWith('/api/pay/demo') && r.request().method() === 'POST');
            await page.getByRole('button', { name: 'Nueva prueba', exact: true }).click();
            const next = await (await renewed).json();
            assert.notEqual(next.session.id, result.sessionId);
            assert.equal(next.session.amount, result.amount, 'New test keeps selected amount');
            assert.equal(next.session.currency, DEMO_CURRENCY);
            assert.deepEqual(next.session.priceReference, current.priceReference);
            result.status = 'ui_verified';
            continue;
          }
          stage = 'secure-fields';
          await page.getByRole('button', { name: 'Continuar a Datos de Tarjeta' }).click();
          await page.frameLocator('#cybersource-card-number iframe').locator('input[name="number"]').fill(card.number);
          await page.frameLocator('#cybersource-security-code iframe').locator('input[name="securityCode"]').fill(card.cvv);
          await page.getByPlaceholder('NOMBRE COMO APARECE EN LA TARJETA').fill('DEMO MATRIX');
          await page.locator('#card-expiration').fill(`01/${String(new Date().getFullYear() + 3).slice(-2)}`);
          const started = page.waitForResponse(r => r.url().endsWith('/api/pay/payments') && r.request().method() === 'POST', { timeout: 90000 });
          const authenticated = page.waitForResponse(r => r.url().endsWith('/api/pay/authentication') && r.request().method() === 'POST', { timeout: 90000 }).catch(() => null);
          stage = 'payment';
          await page.getByRole('button', { name: /^Pagar Ahora/ }).click();
          const setup = await (await started).json();
          assert.equal(setup.session?.id, result.sessionId);
          if (setup.authentication) {
            stage = 'authentication';
            const response = await authenticated;
            assert.ok(response, 'Authentication response required');
            const final = await response.json();
            assert.equal(final.session?.id, result.sessionId);
            // No automatic challenge bypass or second charge if this fixture behaves differently.
            if (final.authentication?.step === 'challenge') result.testError = 'Unexpected issuer challenge; no payment retried';
          }
          stage = 'database';
          const stored = await query(`SELECT s.status,s.gateway_status,s.failure_reason,s.gateway_transaction_id,s.amount,s.currency,
            a.reference,a.response->>'setupId' AS setup_id,a.response->>'authenticationId' AS authentication_id,
            a.response->>'authenticationStatus' AS authentication_status,a.response->>'paresStatus' AS pares_status,
            (SELECT count(*)::int FROM pay_attempts p WHERE p.session_id=s.id) AS attempts,
            (SELECT count(*)::int FROM portal_deliveries d WHERE d.session_id=s.id) AS deliveries
            FROM pay_sessions s JOIN pay_attempts a ON a.session_id=s.id WHERE s.id=$1 ORDER BY a.attempt_no DESC LIMIT 1`, [result.sessionId]);
          const row = stored.rows[0];
          assert.ok(row);
          assert.equal(Number(row.amount).toFixed(2), result.amount); assert.equal(row.currency, DEMO_CURRENCY);
          assert.equal(row.attempts, 1); assert.equal(row.deliveries, 0);
          Object.assign(result, { status: row.status, gatewayStatus: row.gateway_status, failureReason: row.failure_reason,
            transactionId: row.gateway_transaction_id, reference: row.reference, setupId: row.setup_id,
            authenticationId: row.authentication_id, authenticationStatus: row.authentication_status, paresStatus: row.pares_status,
            attempts: row.attempts, portalDeliveries: row.deliveries });
        } catch (error) {
          result.testError = `${stage}: ${error instanceof Error ? error.name : 'Error'}`;
          await page.screenshot({ path: path.join(directory, `${scenario}-${card.brand.replaceAll(' ', '-')}-error.png`), fullPage: true }).catch(() => undefined);
          // Preserve the incomplete session. Never retry an uncertain POST automatically.
        } finally {
          await context.close();
          await save();
          console.log(JSON.stringify(result));
        }
      }
    }
  } finally { await browser.close(); }

  // Inspect only the IDs created by THIS run, once each. No historical transactions.
  if (pay) {
    const inspected = new Set<string>();
    for (const result of results) {
      if (!result.transactionId || inspected.has(result.transactionId)) continue;
      inspected.add(result.transactionId);
      try {
        const data = await new CyberSourceGateway('sandbox').getPayment(result.transactionId);
        assert.equal(data.id, result.transactionId); assert.equal(data.clientReferenceInformation?.code, result.reference);
        const details = data.orderInformation?.amountDetails;
        assert.equal(Number(details?.totalAmount).toFixed(2), result.amount); assert.equal(details?.currency, DEMO_CURRENCY);
        result.providerAmount = Number(details.totalAmount).toFixed(2); result.providerCurrency = details.currency;
        result.applications = data.applicationInformation?.applications?.map((a: Record<string, unknown>) => ({
          name: a.name, code: a.reasonCode === undefined ? undefined : String(a.reasonCode), flag: a.rFlag,
          merchantIdError: /merchant_id/i.test(String(a.rMessage ?? '')),
        }));
      } catch (error) { result.searchError = error instanceof Error ? error.name : 'Search unavailable'; }
      await save();
    }
  }
  const cell = (value: unknown) => String(value ?? '—').replace(/[|\r\n]/g, ' ');
  const rows = results.map(r => `| ${r.brand} | ${r.amount} | ${cell(r.authenticationStatus ?? r.status)} | ${cell(r.gatewayStatus ?? r.testError)} | ${cell(r.transactionId)} | ${r.applications?.some(a=>a.merchantIdError) ? 'merchant_id / 150' : cell(r.failureReason)} |`);
  const md = `# Comparación de importes en CyberSource sandbox\n\nEjecución: ${run}. ${pay ? 'Solicitudes reales al sandbox con tarjetas oficiales de ensayo.' : 'Solo interfaz; no se solicitaron pagos.'}\n\nCada caso utiliza una sesión e intento nuevos. No se reenvió ningún pago incierto, no se consultaron IDs históricos ni se enviaron avisos al Portal.\n\n| Tarjeta | HNL | Autenticación | Resultado de pago | Request ID financiero | Detalle |\n| --- | ---: | --- | --- | --- | --- |\n${rows.join('\n')}\n\n## Referencias para buscar en Business Center\n\n${results.map(r=>`- **${r.brand}, ${r.amount} HNL**: referencia \`${r.reference ?? 'sin intento financiero'}\`; Setup \`${r.setupId ?? 'no disponible'}\`; autenticación \`${r.authenticationId ?? 'no disponible'}\`.`).join('\n')}\n\nFuente de tarjetas: [caso 2.1 de CyberSource](https://developer.cybersource.com/library/documentation/dev_guides/Payer_Authentication_SCMP_API/html/Topics/Test_Cases_for_3D_Secure_2_x.htm). Se usó enero del año actual más tres. Los resultados de autenticación y autorización financiera se evalúan por separado.\n\nDatos estructurados: \`${directory.replaceAll('\\','/')}/results.json\`.\n`;
  const referenceNote = '\n## Precio en dólares y verificación de moneda\n\n' + results.map(r => `- ${r.amount} HNL: ${r.referenceUsd ? `referencia USD ${r.referenceUsd}; tasa HNL/USD ${r.hnlPerUsd}` : 'importe HNL directo, sin conversion USD en este caso'}; proveedor ${r.providerAmount ?? 'sin consulta confirmada'} ${r.providerCurrency ?? ''}.`).join('\n') + '\n';
  await fs.writeFile(path.join(directory, 'RESULTADOS.md'), md + referenceNote);
  const report = `RESULTADOS_PRUEBAS_${selectedScenarios.map(s => Number(DEMO_AMOUNTS[s])).join('_')}_HNL_SANDBOX.md`;
  if (pay) await fs.writeFile(report, md + referenceNote);
  console.log(JSON.stringify({ run, cases: results.length, completed: results.filter(r=>!r.testError).length,
    approved: results.filter(r=>r.status==='succeeded').length, report: pay ? report : path.join(directory, 'RESULTADOS.md') }));
  if (results.some(r=>r.testError || r.searchError) || (pay && results.some(r=>r.status!=='succeeded'))) process.exitCode=1;
}
main().catch(error => { console.error(error instanceof Error ? error.name : 'Matrix failed'); process.exitCode=1; }).finally(closeDatabase);
