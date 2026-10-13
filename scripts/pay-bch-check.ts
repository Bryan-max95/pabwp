import { fetchBchRate, ExchangeRateError } from '../lib/pay/bch';
import { hnlCharge } from '../lib/pay/exchange-rate';

// Read-only authenticated check: no checkout, card or payment is created.
fetchBchRate().then(rate => {
  console.log(JSON.stringify({ bch: 'verified', ...rate, example: { usd: '199.00', hnl: hnlCharge('199.00', rate.hnlPerUsd) } }, null, 2));
}).catch(error => {
  console.error(JSON.stringify({ bch: 'not verified', code: error instanceof ExchangeRateError ? error.code : 'BCH_CHECK_FAILED' }));
  process.exitCode = 1;
});
