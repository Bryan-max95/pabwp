import { CyberSourceGateway } from '../lib/cybersource/gateway';
import { closeDatabase, query } from '../lib/pay/db';
import { reconcileSession } from '../lib/pay/reconcile';

async function main() {
  const requested = process.argv[2];
  if (requested === '--authentication') {
    const id = process.argv[3];
    if (!/^\d{12,30}$/.test(id ?? '')) throw new Error('Invalid authentication ID');
    const data = await new CyberSourceGateway('sandbox').getPayment(id);
    const info = data.consumerAuthenticationInformation ?? {};
    console.log(JSON.stringify({ transactionId: id, fields: Object.keys(info), status:data.status,
      applications: data.applicationInformation?.applications?.map((app: Record<string, unknown>)=>({name:app.name,reasonCode:app.reasonCode,rFlag:app.rFlag})),
      paresStatus:info.paresStatus,authenticationStatus:info.authenticationStatus, indicator:info.indicator,ecommerceIndicator:info.ecommerceIndicator,eci:info.eci }));
    return;
  }
  if (requested === '--recent') {
    const recent = await query("SELECT s.id,s.status,s.gateway_status,s.failure_reason,s.gateway_transaction_id,a.response->>'phase' AS phase,a.response->>'authenticationId' AS authentication_id,a.response->>'paresStatus' AS pares_status,a.response->>'authenticationResult' AS authentication_result,a.response->>'authenticationMessage' AS authentication_message FROM pay_sessions s LEFT JOIN pay_attempts a ON a.session_id=s.id WHERE s.is_demo=true ORDER BY s.created_at DESC,a.attempt_no DESC LIMIT 8");
    console.log(JSON.stringify(recent.rows));
    return;
  }
  if (requested && !/^\d{12,30}$/.test(requested)) throw new Error('Invalid transaction ID');
  const rows = await query<{ id: string; gateway_transaction_id: string }>("SELECT id,gateway_transaction_id FROM pay_sessions WHERE is_demo=true AND gateway_transaction_id IS NOT NULL AND ($1::text IS NULL OR gateway_transaction_id=$1) ORDER BY created_at DESC LIMIT 2", [requested ?? null]);
  for (const row of rows.rows) {
    const data = await new CyberSourceGateway('sandbox').getPayment(row.gateway_transaction_id);
    const info = data.applicationInformation ?? {};
    console.log(JSON.stringify({ session: row.id, transactionId: row.gateway_transaction_id, providerId: data.id, reference: data.clientReferenceInformation?.code,
      applications: info.applications?.map((app: Record<string, unknown>) => ({ name: app.name, rCode: app.rCode, rFlag: app.rFlag, reasonCode: app.reasonCode,
        merchantConfigurationError: /merchant_id/i.test(String(app.rMessage ?? '')) })),
      error: data.errorInformation?.reason, auth: { paresStatus: data.consumerAuthenticationInformation?.paresStatus, veresEnrolled: data.consumerAuthenticationInformation?.veresEnrolled },
    }));
    const reconciled = await reconcileSession(row.id);
    console.log(JSON.stringify({ reconciled: Boolean(reconciled), status: reconciled?.status, gatewayStatus: reconciled?.gateway_status, reason: reconciled?.failure_reason }));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Inspection failed'); process.exitCode = 1; }).finally(closeDatabase);
