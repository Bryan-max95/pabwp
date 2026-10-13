/** Additive PostgreSQL schema, shared by the application and the setup command. */
export const schema = `
CREATE TABLE IF NOT EXISTS pay_sessions (
  id uuid PRIMARY KEY, event_id text UNIQUE NOT NULL, launch_hash text UNIQUE NOT NULL,
  access_hash text UNIQUE, customer_id text NOT NULL, order_id text, invoice_id text,
  unit_id text NOT NULL, client_name text NOT NULL, unit_name text NOT NULL, concept text NOT NULL,
  currency varchar(3) NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount > 0), bill_to jsonb NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','production')), return_url text,
  status text NOT NULL DEFAULT 'open', portal_status text NOT NULL DEFAULT 'pending',
  gateway_transaction_id text, authorization_code text, card_brand text, card_last4 text,
  gateway_status text, failure_reason text, consumed_at timestamptz,
  expires_at timestamptz NOT NULL, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), is_demo boolean NOT NULL DEFAULT false,
  capture_context text
);
ALTER TABLE pay_sessions ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE pay_sessions ADD COLUMN IF NOT EXISTS capture_context text;
ALTER TABLE pay_sessions ADD COLUMN IF NOT EXISTS reference_usd_amount numeric(14,2);
ALTER TABLE pay_sessions ADD COLUMN IF NOT EXISTS usd_hnl_rate numeric(14,6);
ALTER TABLE pay_sessions ADD COLUMN IF NOT EXISTS fx_source text;
ALTER TABLE pay_sessions ADD COLUMN IF NOT EXISTS fx_rate_date text;
ALTER TABLE pay_sessions ADD COLUMN IF NOT EXISTS fx_fetched_at timestamptz;
ALTER TABLE pay_sessions ADD COLUMN IF NOT EXISTS checkout_source text NOT NULL DEFAULT 'storeganise' CHECK (checkout_source IN ('manual','storeganise'));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='pay_sessions'::regclass
    AND conname='pay_sessions_environment_check' AND pg_get_constraintdef(oid) NOT LIKE '%production%') THEN
    ALTER TABLE pay_sessions DROP CONSTRAINT pay_sessions_environment_check;
    ALTER TABLE pay_sessions ADD CONSTRAINT pay_sessions_environment_check CHECK (environment IN ('sandbox','production'));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS pay_exchange_rates (
  source text PRIMARY KEY, rate jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pay_invoice_once ON pay_sessions (environment, invoice_id) WHERE invoice_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS pay_attempts (
  id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES pay_sessions(id), attempt_no int NOT NULL,
  status text NOT NULL, reference text UNIQUE NOT NULL, token_jti text,
  gateway_transaction_id text, gateway_status text, response jsonb, callback_nonce_hash text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, attempt_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS pay_token_once ON pay_attempts (token_jti) WHERE token_jti IS NOT NULL;
ALTER TABLE pay_attempts ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'payment';
ALTER TABLE pay_attempts ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS pay_transaction_once ON pay_attempts (gateway_transaction_id) WHERE gateway_transaction_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS portal_deliveries (
  id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES pay_sessions(id), attempt_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text, delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id)
);
CREATE TABLE IF NOT EXISTS pay_gateway_credentials (
  provider text NOT NULL, environment text NOT NULL CHECK(environment = 'sandbox'),
  encrypted_payload text NOT NULL, iv text NOT NULL, auth_tag text NOT NULL,
  key_version int NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider, environment)
);
CREATE TABLE IF NOT EXISTS pay_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL, subject_id text, details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pay_pending_attempts ON pay_attempts(status, updated_at);
CREATE INDEX IF NOT EXISTS pay_due_deliveries ON portal_deliveries(status, next_attempt_at);
ALTER TABLE pay_sessions ADD COLUMN IF NOT EXISTS storeganise_context jsonb;
ALTER TABLE pay_sessions ADD COLUMN IF NOT EXISTS storeganise_status text NOT NULL DEFAULT 'disabled';
ALTER TABLE pay_sessions ADD COLUMN IF NOT EXISTS storeganise_payment_id text;
ALTER TABLE pay_sessions ADD COLUMN IF NOT EXISTS storeganise_error text;
CREATE TABLE IF NOT EXISTS storeganise_deliveries (
  session_id uuid PRIMARY KEY REFERENCES pay_sessions(id),
  transaction_id text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0, payment_write_started boolean NOT NULL DEFAULT false,
  lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text, delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storeganise_delivery_due ON storeganise_deliveries(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS pay_launch_links (
  token_hash text PRIMARY KEY, session_id uuid NOT NULL REFERENCES pay_sessions(id),
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pay_launch_session ON pay_launch_links(session_id);
`;
