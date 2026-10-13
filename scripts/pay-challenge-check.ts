import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { closeDatabase, query } from '../lib/pay/db';

async function main() {
  const origin = new URL(process.env.PAY_PUBLIC_URL ?? '').origin;
  if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Local sandbox required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    page.on('response', r => { if (r.request().method()==='POST' && /cardinalcommerce|authentication\/callback/.test(r.url())) { const u=new URL(r.url()); console.log(JSON.stringify({ responseUrl:u.origin+u.pathname, status:r.status() })); } });
    page.on('console', message => { if (/Content Security Policy|Mixed Content|blocked|ERR_/i.test(message.text())) console.log(message.text().replace(/https?:\/\/[^\s'"<>]+/g, value => { try { const u=new URL(value); return u.origin+u.pathname; } catch { return '[url]'; } }).slice(0,600)); });
    page.on('requestfailed', request => { if (/cardinalcommerce|authentication\/callback/.test(request.url())) { const u=new URL(request.url()); console.log(JSON.stringify({ failedUrl:u.origin+u.pathname, error:request.failure()?.errorText })); } });
    page.setDefaultTimeout(45000);
    await page.goto(origin);
    await page.getByRole('button', { name: 'Continuar a Datos de Tarjeta' }).click();
    await page.frameLocator('#cybersource-card-number iframe').locator('input[name="number"]').fill('4456530000001096');
    await page.frameLocator('#cybersource-security-code iframe').locator('input[name="securityCode"]').fill('123');
    await page.getByPlaceholder('NOMBRE COMO APARECE EN LA TARJETA').fill('DEMO CHALLENGE');
    await page.locator('#card-expiration').fill(`01/${String(new Date().getFullYear() + 3).slice(-2)}`);
    const response = page.waitForResponse(async r => r.url().endsWith('/api/pay/authentication') && (await r.json()).authentication?.step === 'challenge', { timeout: 90000 });
    await page.getByRole('button', { name: /^Pagar Ahora/ }).click();
    const result = await (await response).json();
    const sessionId = result.session.id;
    assert.ok(result.authentication.transactionId);
    await page.locator('iframe[name="cybersource-step-up-iframe"]').waitFor();
    const challengeFrame = await page.waitForEvent('framenavigated', { predicate: frame => /merchantacs/i.test(frame.url()), timeout: 20000 }).catch(() =>
      page.frames().find(frame => /merchantacs/i.test(frame.url())));
    assert.ok(challengeFrame, 'Sandbox issuer challenge must load');
    await challengeFrame.locator('body').waitFor();
    await challengeFrame.waitForLoadState('load');
    // A forged event from the parent has the correct origin but the wrong source.
    let submissions = 0;
    page.on('request', r => { if (r.url().endsWith('/api/pay/authentication') && r.method() === 'POST') submissions++; });
    await page.evaluate(id => window.postMessage({ type: 'cybersource-authentication', transactionId: id }, window.location.origin), result.authentication.transactionId);
    await page.screenshot({ path: '.private/challenge-window.png', fullPage: true });
    assert.equal(submissions, 0, 'Parent cannot forge a bank completion');
    if (process.argv.includes('--inspect')) {
      // Only visible sandbox instructions; no JWTs or hidden form values.
      for (const frame of page.frames().filter(f => /cardinalcommerce/.test(f.url()))) {
        console.log(JSON.stringify({ frameOrigin: new URL(frame.url()).origin, text: (await frame.locator('body').innerText()).replace(/\d{12,}/g, '[test-card]').slice(0,1500) }));
      }
    }
    if (process.argv.includes('--complete')) {
      const completed = page.waitForResponse(r => r.url().endsWith('/api/pay/authentication') && r.request().postDataJSON()?.step === 'challenge', { timeout: 60000 }).catch(() => null);
      const localReturnBlocked = page.waitForEvent('requestfailed', { predicate: r => r.url().endsWith('/api/pay/authentication/callback') && r.failure()?.errorText === 'net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS', timeout: 30000 }).then(()=>true).catch(()=>false);
      // The sandbox issuer explicitly displays OTP 1234. Never a real card/OTP.
      const otp = challengeFrame.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"])').first();
      await otp.fill('');
      await otp.pressSequentially('1234', { delay: 100 });
      await challengeFrame.getByRole('button', { name: /submit|continue|verify|confirm/i }).first().click();
      const useLocalVerification = await Promise.race([completed.then(()=>false), localReturnBlocked, new Promise<boolean>(resolve=>setTimeout(()=>resolve(true),15000))]);
      if (useLocalVerification) await page.getByRole('button', { name: 'Ya completé la verificación' }).click();
      const completion = await completed;
      if (!completion) {
        await page.screenshot({ path: '.private/challenge-failure.png', fullPage: true });
        for (const frame of page.frames().filter(f => /cardinalcommerce|authentication\/callback/.test(f.url()))) {
          const u=new URL(frame.url()); console.log(JSON.stringify({ url:u.origin+u.pathname, text:(await frame.locator('body').innerText().catch(()=>'' )).replace(/\d{12,}/g,'[id]').slice(0,800) }));
        }
        throw new Error('Challenge callback did not complete');
      }
      const final = await completion.json();
      assert.equal(final.session?.id, sessionId);
      console.log(JSON.stringify({ sessionId, phase:'validation-result', status:final.session?.status, gatewayStatus:final.session?.gatewayStatus, reason:final.session?.failureReason }));
      assert.ok(final.session.transactionId, 'Successful challenge must reach a recorded payment request');
      assert.equal(submissions, 1, 'Challenge completion is submitted once');
      const attempts = await query('SELECT count(*)::int AS count FROM pay_attempts WHERE session_id=$1', [sessionId]);
      assert.equal(attempts.rows[0].count, 1);
      const summary = { sessionId, challenge: 'completed', callback: useLocalVerification ? 'localhost-return-blocked-server-validation-used' : 'verified', submissions, status: final.session.status,
        gatewayStatus: final.session.gatewayStatus, transactionId: final.session.transactionId };
      await fs.writeFile('.private/challenge-completion.json', JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary));
      return;
    }
    await page.reload();
    await page.getByRole('button', { name: 'Continuar a Datos de Tarjeta' }).click();
    await page.getByRole('button', { name: 'La verificación se interrumpió. Reiniciar sin cobrar.' }).click();
    await page.getByRole('button', { name: 'Continuar a Datos de Tarjeta' }).waitFor();
    const stored = await query<{ status: string; gateway_status: string; gateway_transaction_id: string | null }>('SELECT status,gateway_status,gateway_transaction_id FROM pay_sessions WHERE id=$1', [sessionId]);
    assert.equal(stored.rows[0].status, 'declined');
    assert.equal(stored.rows[0].gateway_status, 'AUTHENTICATION_CANCELLED');
    assert.equal(stored.rows[0].gateway_transaction_id, null);
    const summary = { sessionId, challenge: 'opened', forgedCallback: 'rejected', reloadRecovery: 'cancelled-before-payment', authorizationRequests: 0 };
    await fs.writeFile('.private/challenge-check.json', JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message.split('\n')[0] : 'Challenge check failed'); process.exitCode = 1; }).finally(closeDatabase);
