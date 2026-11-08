-- Public counters for the landing page, written by scripts/count-memories.ts. Numbers and a
-- timestamp only: no memory text, no refs, no account ids (PRD 4, X-DB-1).

CREATE TABLE IF NOT EXISTS public_stats (
  stat_key varchar(40) PRIMARY KEY CHECK (stat_key ~ '^[a-z_]{1,40}$'),
  stat_value bigint NOT NULL CHECK (stat_value >= 0),
  counted_at timestamptz NOT NULL DEFAULT now()
);
