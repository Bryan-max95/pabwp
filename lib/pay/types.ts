import type { BillTo } from '@/lib/cybersource/types';
import type { GatewayEnvironment } from '@/lib/cybersource/environment';

export interface StoreganiseContext {
  apiOrigin: string; customerId: string; invoiceId: string; rentalId: string;
  unitId: string; siteId: string; jobId?: string;
}

export interface CheckoutSessionInput {
  eventId: string; customerId: string; orderId?: string; invoiceId?: string; unitId: string;
  clientName: string; unitName: string; concept: string; currency: string; amount: string;
  environment: GatewayEnvironment; isTest: boolean; fiscalEnvironment: 'test' | 'production'; payable: true;
  source?: 'manual' | 'storeganise';
  returnUrl?: string; billTo: BillTo;
  isDemo?: boolean;
  storeganiseContext?: StoreganiseContext;
}

export interface SessionRow {
  id: string; event_id:string; launch_hash: string; access_hash?: string; customer_id:string; order_id?:string; invoice_id?:string; unit_id:string;
  client_name:string; unit_name:string; concept:string; currency:string; amount:string; bill_to:BillTo; environment:GatewayEnvironment; return_url?:string;
  checkout_source?: 'manual' | 'storeganise';
  status: string; portal_status: string;
  reference_usd_amount?: string | null; usd_hnl_rate?: string | null;
  fx_source?: string | null; fx_rate_date?: string | null; fx_fetched_at?: Date | null;
  is_demo: boolean; capture_context?: string;
  gateway_transaction_id?: string; authorization_code?: string; card_brand?: string; card_last4?: string;
  gateway_status?: string; failure_reason?: string; consumed_at?:Date; expires_at: Date; paid_at?: Date; created_at: Date;
  storeganise_context?: StoreganiseContext | null;
  storeganise_status?: string;
  storeganise_payment_id?: string | null;
  storeganise_error?: string | null;
}
