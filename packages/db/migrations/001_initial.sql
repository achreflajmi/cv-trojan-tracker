-- 001_initial: data model from SPEC 4.3 (v1.1).
-- Never edit this file after it has been applied anywhere: add 002_*.sql instead.
-- The migration runner stores this file's sha256 and refuses to run if it changes.

CREATE TABLE model (
  id            bigserial PRIMARY KEY,
  provider      text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'google', 'openrouter', 'fake')),
  model_id      text NOT NULL,
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  -- Same model with different settings (e.g. thinking off vs low effort) is a different row.
  UNIQUE (provider, model_id, settings_json)
);

CREATE TABLE job (
  id      bigserial PRIMARY KEY,
  slug    text NOT NULL,
  version integer NOT NULL,
  title   text NOT NULL,
  text    text NOT NULL,
  UNIQUE (slug, version)
);

CREATE TABLE profile (
  id          bigserial PRIMARY KEY,
  job_id      bigint NOT NULL REFERENCES job (id),
  external_id text NOT NULL,          -- e.g. 'nurse-strong-01'
  seed        text NOT NULL,
  fit_band    text NOT NULL CHECK (fit_band IN ('strong', 'medium', 'weak')),
  data_json   jsonb NOT NULL,
  UNIQUE (job_id, external_id)
);

CREATE TABLE cv_document (
  id            bigserial PRIMARY KEY,
  profile_id    bigint NOT NULL REFERENCES profile (id),
  condition     text NOT NULL
                CHECK (condition IN ('CLEAN', 'DATA', 'INSTR', 'VIS_DATA', 'HIDDEN_NEUTRAL', 'VIS_INSTR')),
  hiding_method text CHECK (hiding_method IN ('WHITE', 'TINY', 'OFFPAGE', 'RENDER3', 'OCG_OFF')),
  pdf_sha256    text NOT NULL,
  path          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Hidden conditions need a hiding method; CLEAN and visible conditions must not have one.
  CHECK ((condition IN ('DATA', 'INSTR', 'HIDDEN_NEUTRAL')) = (hiding_method IS NOT NULL)),
  -- NULLS NOT DISTINCT (PostgreSQL 15+): CLEAN with NULL method is still unique per profile.
  UNIQUE NULLS NOT DISTINCT (profile_id, condition, hiding_method)
);

CREATE TABLE extraction (
  id                  bigserial PRIMARY KEY,
  cv_document_id      bigint NOT NULL REFERENCES cv_document (id),
  extractor           text NOT NULL CHECK (extractor IN ('pdfjs', 'poppler')),
  extractor_version   text NOT NULL,
  text                text NOT NULL,
  text_sha256         text NOT NULL,
  hidden_text_present boolean,        -- NULL for CLEAN: nothing was injected
  UNIQUE (cv_document_id, extractor, extractor_version)
);
CREATE INDEX extraction_text_sha256 ON extraction (text_sha256);

CREATE TABLE experiment (
  id             bigserial PRIMARY KEY,
  name           text NOT NULL UNIQUE,
  prereg_commit  text,
  prompt_version text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE run (
  id            bigserial PRIMARY KEY,
  experiment_id bigint NOT NULL REFERENCES experiment (id),
  model_id      bigint NOT NULL REFERENCES model (id),
  status        text NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned', 'running', 'stopped_budget', 'completed', 'failed')),
  started_at    timestamptz,
  finished_at   timestamptz,
  budget_eur    numeric(12, 6) NOT NULL CHECK (budget_eur >= 0)
);

CREATE TABLE trial (
  id               bigserial PRIMARY KEY,
  run_id           bigint NOT NULL REFERENCES run (id),
  task             text NOT NULL CHECK (task IN ('score', 'rank')),
  job_id           bigint NOT NULL REFERENCES job (id),
  pool_composition text NOT NULL,
  repeat_index     integer NOT NULL CHECK (repeat_index >= 0),
  inputs_sha256    text NOT NULL,
  shuffle_seed     text NOT NULL,
  -- SPEC 4.4: a trial exists once, whatever the code does.
  idempotency_key  text NOT NULL UNIQUE
);

CREATE TABLE trial_input (
  trial_id       bigint NOT NULL REFERENCES trial (id),
  position       integer NOT NULL CHECK (position >= 0),
  cv_document_id bigint NOT NULL REFERENCES cv_document (id),
  extraction_id  bigint NOT NULL REFERENCES extraction (id),
  PRIMARY KEY (trial_id, position)
);

CREATE TABLE call (
  id                bigserial PRIMARY KEY,
  trial_id          bigint NOT NULL REFERENCES trial (id),
  status            text NOT NULL CHECK (status IN ('claimed', 'completed', 'failed')),
  reserved_eur      numeric(12, 6) NOT NULL CHECK (reserved_eur >= 0),
  raw_text          text,
  parsed_json       jsonb,               -- NULL when the answer was unparseable
  returned_model_id text,
  input_tokens      integer,
  output_tokens     integer,
  thinking_tokens   integer,
  cost_eur          numeric(12, 6),
  latency_ms        integer,
  finish_reason     text,
  error             text,
  claimed_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  -- A completed call has a result; a claimed one has none yet.
  CHECK (status <> 'completed' OR (raw_text IS NOT NULL AND cost_eur IS NOT NULL))
);
-- SPEC 4.4 (#16): at most one completed call per trial, and at most one call in flight.
-- These two indexes are what make "never pay twice" a database guarantee.
CREATE UNIQUE INDEX call_one_completed_per_trial ON call (trial_id) WHERE status = 'completed';
CREATE UNIQUE INDEX call_one_claim_per_trial ON call (trial_id) WHERE status = 'claimed';

CREATE TABLE budget_ledger (
  id         bigserial PRIMARY KEY,
  run_id     bigint NOT NULL REFERENCES run (id),
  call_id    bigint REFERENCES call (id),
  -- reserve: worst case before a call; settle: actual minus reserved after it;
  -- orphaned: a claim whose outcome is unknown (process died), reservation kept.
  kind       text NOT NULL CHECK (kind IN ('reserve', 'settle', 'orphaned')),
  delta_eur  numeric(12, 6) NOT NULL,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX budget_ledger_run ON budget_ledger (run_id);
