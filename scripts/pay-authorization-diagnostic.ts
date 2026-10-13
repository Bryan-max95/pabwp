import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { AUTHORIZATION_AUDIT_CONTROL, authorizationAuditPath } from '../lib/cybersource/authorization-audit';
import { CyberSourceGateway } from '../lib/cybersource/gateway';
import { loadCredentials } from '../lib/pay/credentials';
import { closeDatabase, query } from '../lib/pay/db';

// Intentionally no loop, retries or amount/card selection: ONE new 100 HNL sandbox attempt.
async function main() {
  const origin = new URL(process.env.PAY_PUBLIC_URL ?? '');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname));
  assert.equal(process.env.PAY_DEMO_ENABLED, 'true');
  assert.equal(process.env.CYBERSOURCE_ENVIRONMENT ?? 'sandbox', 'sandbox');
  const credentials = await loadCredentials('sandbox');
  const expectedMerchant = 'test_bac_hn_bodegsegurasroatan';
  assert.equal(credentials.merchantId, expectedMerchant);
  const runId = crypto.randomUUID();
  const result: Record<string, any> = {
    runId, date: new Date().toISOString(), environment: 'sandbox', endpoint: 'https://apitest.cybersource.com/pts/v2/payments',
    configuredMerchantId: credentials.merchantId, keyId: credentials.keyId, sharedSecret: credentials.sharedSecret ? 'LOADED' : 'NOT LOADED',
    credentialSource: 'Private server environment',
    accountKeyOwnership: 'Local configuration checked; issuing account must be confirmed in Business Center',
    brand: 'Visa', last4: '1005', amount: '100.00', currency: 'HNL',
  };
  await fs.mkdir('.private', { recursive: true });
  const resultPath = `.private/authorization-diagnostic-${runId}.json`;
  const save = () => fs.writeFile(resultPath, JSON.stringify(result, null, 2), { mode: 0o600 });
  await save();
  let armed = false;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let stage = 'browser';
  let paymentPosts = 0;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    // Even if a frontend regression retries, this run can start only one attempt.
    await page.route('**/api/pay/payments', async route => {
      if (route.request().method() === 'POST' && ++paymentPosts > 1) return route.abort();
      return route.continue();
    });
    stage = 'session';
    await page.goto(`${origin.origin}/?demo=a&scenario=hnl100`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[readonly]').first().waitFor();
    assert.equal(await page.getByTestId('charge-total').textContent(), 'L 100.00 HNL');
    result.sessionId = await page.evaluate(() => sessionStorage.getItem('pay-session-id'));
    assert.match(result.sessionId, /^[a-f0-9-]{36}$/);
    result.reference = `RSS-${result.sessionId}-1`;
    const session = await query('SELECT is_demo,environment,portal_status,amount,currency,(SELECT count(*)::int FROM pay_attempts WHERE session_id=s.id) AS attempts FROM pay_sessions s WHERE id=$1', [result.sessionId]);
    assert.equal(session.rows[0]?.is_demo, true); assert.equal(session.rows[0]?.environment, 'sandbox');
    assert.equal(session.rows[0]?.portal_status, 'disabled'); assert.equal(session.rows[0]?.attempts, 0);
    assert.equal(Number(session.rows[0]?.amount).toFixed(2), '100.00'); assert.equal(session.rows[0]?.currency, 'HNL');
    await fs.writeFile(AUTHORIZATION_AUDIT_CONTROL, JSON.stringify({ runId, reference: result.reference, expiresAt: Date.now() + 600_000 }), { flag: 'wx', mode: 0o600 });
    armed = true;
    await save();
    stage = 'microform';
    await page.getByRole('button', { name: 'Continuar a Datos de Tarjeta' }).click();
    // Official Payer Authentication case 2.1; test PAN/CVV go only into CyberSource iframes.
    await page.frameLocator('#cybersource-card-number iframe').locator('input[name="number"]').fill('4456530000001005');
    await page.frameLocator('#cybersource-security-code iframe').locator('input[name="securityCode"]').fill('123');
    await page.getByPlaceholder('NOMBRE COMO APARECE EN LA TARJETA').fill('DEMO AUTHORIZATION');
    await page.locator('#card-expiration').fill(`01/${String(new Date().getFullYear() + 3).slice(-2)}`);
    const setupResponse = page.waitForResponse(r => r.url().endsWith('/api/pay/payments') && r.request().method() === 'POST', { timeout: 90_000 }).catch(() => null);
    const authResponse = page.waitForResponse(r => r.url().endsWith('/api/pay/authentication') && r.request().method() === 'POST', { timeout: 90_000 }).catch(() => null);
    stage = 'setup';
    await page.getByRole('button', { name: /^Pagar Ahora/ }).click();
    const setup = await setupResponse;
    assert.ok(setup);
    const started = await setup.json();
    assert.equal(started.session?.id, result.sessionId);
    result.microform = started.authentication?.step === 'device' ? 'OK' : 'NOT CONFIRMED';
    result.setup = started.authentication?.step === 'device' ? 'SUCCESS' : 'FAILED';
    await save();
    assert.equal(result.setup, 'SUCCESS');
    stage = 'authentication';
    const authentication = await authResponse;
    assert.ok(authentication);
    const final = await authentication.json();
    assert.equal(final.session?.id, result.sessionId);
    result.localSessionStatus = final.session.status;
    result.transactionId = final.session.transactionId;
    if (final.authentication?.step === 'challenge') result.testError = 'Unexpected challenge; stopped without retrying';
    await save();
    // Stop polling before the single read-only transaction lookup below.
    await context.close();
  } catch (error) {
    result.testError = `${stage}: ${error instanceof Error ? error.name : 'Error'}; no automatic retry`;
  } finally {
    if (browser) await browser.close();
    if (armed) {
      const current = JSON.parse(await fs.readFile(AUTHORIZATION_AUDIT_CONTROL, 'utf8'));
      if (current.runId === runId) await fs.unlink(AUTHORIZATION_AUDIT_CONTROL);
    }
    result.paymentStartPosts = paymentPosts;
    await save();
  }

  if (result.sessionId) {
    const stored = await query(`SELECT a.reference,a.response->>'setupId' AS setup_id,a.response->>'authenticationId' AS authentication_id,
      a.response->>'authenticationStatus' AS authentication_status,a.response->>'paresStatus' AS pares_status,
      s.status,s.gateway_status,s.failure_reason,s.gateway_transaction_id,
      (SELECT count(*)::int FROM pay_attempts p WHERE p.session_id=s.id) AS attempts,
      (SELECT count(*)::int FROM portal_deliveries p WHERE p.session_id=s.id) AS deliveries
      FROM pay_sessions s JOIN pay_attempts a ON a.session_id=s.id WHERE s.id=$1 ORDER BY a.attempt_no DESC LIMIT 1`, [result.sessionId]);
    const row = stored.rows[0];
    if (row) Object.assign(result, { setupId: row.setup_id, authenticationId: row.authentication_id, authenticationStatus: row.authentication_status,
      paresStatus: row.pares_status, transactionId: row.gateway_transaction_id, gatewayStatus: row.gateway_status,
      failureReason: row.failure_reason, storedStatus: row.status, attempts: row.attempts, portalDeliveries: row.deliveries });
  }
  try { result.wireAudit = JSON.parse(await fs.readFile(authorizationAuditPath(runId), 'utf8')); }
  catch { result.auditError = 'No captured financial request; no retry'; }
  // Exactly one lookup, only for the financial Request ID created by this run.
  if (result.transactionId) {
    try {
      const data = await new CyberSourceGateway('sandbox').getPayment(result.transactionId);
      assert.equal(data.id, result.transactionId); assert.equal(data.clientReferenceInformation?.code, result.reference);
      assert.equal(Number(data.orderInformation?.amountDetails?.totalAmount).toFixed(2), '100.00');
      assert.equal(data.orderInformation?.amountDetails?.currency, 'HNL');
      result.applications = data.applicationInformation?.applications?.map((app: Record<string, unknown>) => ({
        name: app.name, reasonCode: app.reasonCode, replyCode: app.rCode, flag: app.rFlag,
        merchantIdError: /merchant_id/i.test(String(app.rMessage ?? '')),
        // Only the known diagnostic text is disclosed; never dump the provider response.
        processorMessage: /merchant_id/i.test(String(app.rMessage ?? '')) ?
          'Payment processor error: This field is invalid or missing: merchant_id' : 'See application reason code',
      }));
    } catch (error) { result.searchError = error instanceof Error ? error.name : 'Lookup failed'; }
  }
  const merchantError = result.applications?.some((a: Record<string, unknown>) => a.merchantIdError);
  result.outcome = merchantError ? 'STOP: BAC/CyberSource must review processor merchant configuration' :
    result.storedStatus === 'succeeded' ? 'Payment accepted; verify capture/settlement independently' : 'STOP: no approved payment confirmed; no retry';
  await save();

  const cell = (value: unknown) => String(value ?? 'No disponible').replace(/[|\r\n]/g, ' ');
  const request = result.wireAudit?.request, response = result.wireAudit?.response;
  const authApplication = result.applications?.find((a: Record<string, unknown>) => a.name === 'ics_auth');
  const md = `# Diagnóstico controlado de autorización BAC / CyberSource\n\nFecha UTC: ${result.date}. Una sola prueba nueva de Visa por 100.00 HNL, sin reenvíos.\n\n` +
    `| Dato | Resultado |\n| --- | --- |\n` + Object.entries({
      Ambiente: 'SANDBOX', Endpoint: result.endpoint, 'MID configurado': result.configuredMerchantId,
      'v-c-merchant-id enviado': request?.merchantIdSent, 'Key ID (identificador)': request?.keyId ?? result.keyId,
      'Shared Secret': result.sharedSecret, 'Encabezado de fecha': request?.dateHeader,
      'Digest corresponde al JSON enviado': request?.checks.digestMatchesBody, 'Firma corresponde a los headers enviados': request?.checks.signatureMatchesRequest,
      'MID enviado coincide con el configurado': request?.checks.merchantMatchesConfigured,
      'acquirerInformation enviado': request?.checks.acquirerInformationPresent,
      'Campos adquirente vacíos/null': request?.checks.emptyAcquirerFields?.length,
      Microform: result.microform, 'Payer Authentication Setup': result.setup,
      'Payer Authentication Enrollment': result.authenticationStatus, PARes: result.paresStatus,
      'Autorización (aplicación ics_auth)': authApplication ? `${authApplication.flag} / ${authApplication.reasonCode}` : 'No confirmada',
      HTTP: response?.http, 'CyberSource status': response?.status, Reason: response?.reason,
      'Respuesta del procesador': authApplication?.processorMessage,
      'Request ID financiero': result.transactionId, 'Referencia de comercio': result.reference,
      'Request ID Setup': result.setupId, 'Request ID autenticación': result.authenticationId,
      'Intentos guardados': result.attempts, 'Avisos al Portal': result.portalDeliveries,
    }).map(([k, v]) => `| ${k} | ${cell(v)} |`).join('\n') +
    `\n\n## Qué se revisó y cambió\n\nSe actualizó únicamente la firma de POST /pts/v2/payments para usar v-c-date tanto en el encabezado como en la cadena firmada. Microform y los endpoints de 3DS conservan su comportamiento. No se agregaron identificadores de adquirente ni valores inventados. El registro del JSON se tomó antes de enviarlo, con los tokens, pruebas 3DS y datos personales redactados.\n\n` +
    `Las credenciales se cargan juntas desde la fila cifrada de Neon para sandbox. El identificador configurado coincide con el facilitado por el usuario. Eso no certifica por sí solo la cuenta emisora de la llave: la asociación debe confirmarse en Key Management del Business Center. Los resultados de setup/enrollment muestran si esas llamadas fueron aceptadas.\n\n` +
    `## Resultado y siguiente paso\n\n${merchantError ? 'La única autorización volvió a fallar con merchant_id / 150. Se detuvieron las pruebas. El JSON no envía acquirerInformation ni un merchant_id vacío; la firma y el encabezado se verificaron con los bytes de esta solicitud. BAC/CyberSource debe confirmar el Processor Profile / Acquiring Merchant ID de sandbox, y si hace falta un campo REST, entregar su ruta exacta y el valor oficial. Esto es una hipótesis respaldada por el error del procesador; no confirma todavía qué ajuste del perfil falta.' : cell(result.outcome)}\n\n` +
    `No se confirma captura ni liquidación por un resultado de autenticación. No se enviaron avisos al Portal. ${result.testError ? `Incidencia de la prueba: ${cell(result.testError)}.` : ''}\n\n` +
    `## JSON de autorización enviado (valores sensibles ocultos)\n\n\`\`\`json\n${JSON.stringify(request?.body ?? {}, null, 2)}\n\`\`\`\n\n` +
    `## Documentación oficial\n\n- [Encabezados REST, incluido v-c-date y v-c-merchant-id](https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-http-message-intro/restgs-http-message-conf-intro/restgs-http-const-elements.html).\n- [Acquirer Merchant ID asignado por el adquirente](https://developer.cybersource.com/docs/cybs/en-us/api-fields/reference/all/rest/api-fields/acq-info-aa/acq-info-acqirer-merchant-id.html).\n- [Tarjeta oficial, caso 2.1](https://developer.cybersource.com/library/documentation/dev_guides/Payer_Authentication_SCMP_API/html/Topics/Test_Cases_for_3D_Secure_2_x.htm).\n\nEvidencia estructurada privada: ${resultPath}.\n`;
  await fs.writeFile('DIAGNOSTICO_AUTORIZACION_CONTROLADA.md', md);
  console.log(JSON.stringify({ runId, amount: result.amount, setup: result.setup, authentication: result.authenticationStatus,
    http: response?.http, status: response?.status, reason: response?.reason, transactionId: result.transactionId,
    attempts: result.attempts, portalDeliveries: result.portalDeliveries, merchantIdError: merchantError,
    testError: result.testError, auditError: result.auditError, report: 'DIAGNOSTICO_AUTORIZACION_CONTROLADA.md' }));
  if (result.storedStatus !== 'succeeded' || result.attempts !== 1 || result.portalDeliveries !== 0 || result.testError || result.auditError) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.name : 'Diagnostic failed'); process.exitCode = 1; }).finally(closeDatabase);
