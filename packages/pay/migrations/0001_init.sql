-- Ferry Gate schema. Neon stores no memory text (PRD 4): cards hold labels and a public
-- account reference only, payments hold a SHA-256 of the query, never the query.

CREATE TABLE IF NOT EXISTS cards (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{22}$'),
  owner_address text NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{64}$'),
  public_account_id text NOT NULL CHECK (public_account_id ~ '^0x[0-9a-f]{1,64}$'),
  name varchar(60) NOT NULL CHECK (length(name) > 0),
  scope_label varchar(40) NOT NULL CHECK (length(scope_label) > 0),
  price_micros bigint NOT NULL CHECK (price_micros > 0 AND price_micros <= 100000000),
  daily_cap integer NOT NULL CHECK (daily_cap > 0 AND daily_cap <= 100000),
  allowed_agents text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  killed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cards_owner_idx ON cards (owner_address);

-- One row per 402 issued. Binds card, price, recipient and expiry (X-PAY-2).
CREATE TABLE IF NOT EXISTS challenges (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{16,128}$'),
  card_id text NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  price_micros bigint NOT NULL CHECK (price_micros > 0),
  recipient text NOT NULL CHECK (recipient ~ '^0x[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS challenges_expires_idx ON challenges (expires_at);

-- The replay table. UNIQUE(digest) and UNIQUE(challenge_id) are the only replay gate:
-- INSERT ... ON CONFLICT DO NOTHING RETURNING, never read-then-write (THREAT_MODEL 11).
CREATE TABLE IF NOT EXISTS payments (
  receipt_id text PRIMARY KEY CHECK (receipt_id ~ '^rcpt_[A-Za-z0-9_-]{22}$'),
  digest text NOT NULL UNIQUE CHECK (digest ~ '^[1-9A-HJ-NP-Za-km-z]{32,64}$'),
  challenge_id text NOT NULL UNIQUE REFERENCES challenges (id),
  card_id text NOT NULL REFERENCES cards (id),
  payer text NOT NULL CHECK (payer ~ '^0x[0-9a-f]{64}$'),
  amount_micros bigint NOT NULL CHECK (amount_micros > 0),
  query_sha256 char(64) NOT NULL CHECK (query_sha256 ~ '^[0-9a-f]{64}$'),
  dialect varchar(8) NOT NULL CHECK (dialect IN ('mpp', 'x402')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_card_created_idx ON payments (card_id, created_at DESC);

CREATE TABLE IF NOT EXISTS daily_counters (
  card_id text NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  day date NOT NULL,
  paid_count integer NOT NULL DEFAULT 0 CHECK (paid_count >= 0),
  PRIMARY KEY (card_id, day)
);

-- Fixed-window counters. bucket_key holds a class prefix and a SHA-256, never a raw IP.
CREATE TABLE IF NOT EXISTS rate_buckets (
  bucket_key varchar(80) NOT NULL CHECK (bucket_key ~ '^[a-z0-9_]{1,15}:[0-9a-f]{1,64}$'),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (bucket_key, window_start)
);

-- SIWS nonces: single use, consumed by an UPDATE ... WHERE consumed_at IS NULL RETURNING.
CREATE TABLE IF NOT EXISTS siws_nonces (
  nonce text PRIMARY KEY CHECK (nonce ~ '^[A-Za-z0-9_-]{22}$'),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
