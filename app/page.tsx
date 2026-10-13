import PaymentCarousel from './components/payment-carousel';
import { sandboxManualEnabled } from '@/lib/pay/sandbox-manual';

export const dynamic = 'force-dynamic';

export default function PaymentPage() {
  return <PaymentCarousel manualSandboxEnabled={sandboxManualEnabled()} />;
}
