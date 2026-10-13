import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CyberSourceGateway } from '../lib/cybersource/gateway';
import { closeDatabase, query } from '../lib/pay/db';

/** Read-only provider queries for an existing HNL run; never submits a payment. */
async function main() {
  const directory = process.argv[2];
  assert.match(directory ?? '', /^\.private[\\/]amount-matrix-hnl-[\dTZ-]+$/);
  const file = path.join(directory, 'results.json');
  const run = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(run.pay, true);
  for (const result of run.results) {
    assert.equal(result.currency, 'HNL'); assert.ok(result.transactionId);
    const data = await new CyberSourceGateway('sandbox').getPayment(result.transactionId);
    assert.equal(data.id, result.transactionId);
    assert.equal(data.clientReferenceInformation?.code, result.reference);
    assert.equal(Number(data.orderInformation?.amountDetails?.totalAmount).toFixed(2), result.amount);
    assert.equal(data.orderInformation?.amountDetails?.currency, 'HNL');
    result.providerAmount = result.amount; result.providerCurrency = 'HNL';
    result.applications = data.applicationInformation?.applications?.map((a: Record<string, unknown>) => ({
      name: a.name, code: a.reasonCode === undefined ? undefined : String(a.reasonCode), flag: a.rFlag,
      merchantIdError: /merchant_id/i.test(String(a.rMessage ?? '')),
    }));
    delete result.searchError;
    const stored = await query(`SELECT s.amount,s.currency,s.status,s.portal_status,
      (SELECT count(*)::int FROM pay_attempts WHERE session_id=s.id) AS attempts,
      (SELECT count(*)::int FROM portal_deliveries WHERE session_id=s.id) AS deliveries
      FROM pay_sessions s WHERE s.id=$1 AND s.gateway_transaction_id=$2`, [result.sessionId, result.transactionId]);
    assert.equal(stored.rows.length, 1);
    assert.equal(Number(stored.rows[0].amount).toFixed(2), result.amount);
    assert.equal(stored.rows[0].currency, 'HNL'); assert.equal(stored.rows[0].attempts, 1);
    assert.equal(stored.rows[0].deliveries, 0); assert.equal(stored.rows[0].portal_status, 'disabled');
    result.confirmedAt = new Date().toISOString();
    await fs.writeFile(file, JSON.stringify(run, null, 2));
    console.log(JSON.stringify({ amount: result.amount, currency: 'HNL', transactionId: result.transactionId, applications: result.applications, attempts: 1, portalDeliveries: 0 }));
  }
  const report = await fs.readFile(path.join(directory, 'RESULTADOS.md'), 'utf8');
  const updated = report.split('\n## Precio en dólares')[0] +
    '\n## Precio en dólares y verificación de moneda\n\n' +
    run.results.map((r: any) => `- ${r.amount} HNL: referencia USD ${r.referenceUsd ?? 'pendiente de tasa comercial'}; tasa HNL/USD ${r.hnlPerUsd ?? 'sin configurar'}; proveedor ${r.providerAmount} ${r.providerCurrency}.`).join('\n') + '\n' +
    `\n## Confirmación posterior de los tres casos\n\nConsulta GET de los mismos Request ID, sin reenviar pagos: ${new Date().toISOString()}.\n\n` +
    run.results.map((r: any) => `- **L ${r.amount} HNL**, Request ID \`${r.transactionId}\`: ${r.applications.map((a: any) => `${a.name}: ${a.flag ?? ''} / ${a.code ?? ''}`).join('; ')}. Un intento y cero entregas al Portal.`).join('\n') + '\n';
  await fs.writeFile(path.join(directory, 'RESULTADOS_CONFIRMADOS.md'), updated);
  await fs.writeFile('RESULTADOS_MONTOS_HNL_SANDBOX.md', updated);
}
main().catch(error => { console.error(error instanceof Error ? error.name : 'Confirmation failed'); process.exitCode = 1; }).finally(closeDatabase);
