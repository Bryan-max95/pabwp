import { transaction } from './db';
import { bchApiKey, fetchBchRate, isCurrentBchRate, type BchRate } from './bch';

/** Shared cache and refresh lock across Vercel instances. No stale/manual fallback. */
export async function currentBchRate(): Promise<BchRate> {
  bchApiKey();
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(741906, 97)');
    const saved = await client.query<{ rate: BchRate }>("SELECT rate FROM pay_exchange_rates WHERE source='BCH-TCR-97'");
    if (saved.rows[0] && isCurrentBchRate(saved.rows[0].rate)) return saved.rows[0].rate;
    const rate = await fetchBchRate();
    await client.query("INSERT INTO pay_exchange_rates(source,rate) VALUES('BCH-TCR-97',$1) ON CONFLICT(source) DO UPDATE SET rate=EXCLUDED.rate", [JSON.stringify(rate)]);
    return rate;
  });
}

/** USD cents × exact millionths of HNL/USD; round half up once to HNL cents. */
export function hnlCharge(amountUsd: string, hnlPerUsd: string) {
  if (!/^\d{1,11}\.\d{2}$/.test(amountUsd) || Number(amountUsd) <= 0) throw new Error('Invalid USD amount');
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(hnlPerUsd) || Number(hnlPerUsd) <= 0) throw new Error('Invalid USD/HNL rate');
  const [whole, fraction = ''] = hnlPerUsd.split('.');
  const scaled = BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, '0'));
  const cents = (BigInt(amountUsd.replace('.', '')) * scaled + BigInt(500_000)) / BigInt(1_000_000);
  if (cents <= BigInt(0) || cents > BigInt('99999999999999')) throw new Error('HNL amount outside supported range');
  const digits = cents.toString().padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
