-- Licensing backend schema (MySQL) — Loop 2 data model.
-- Phase 0 scaffold: schema only; no business logic depends on it yet.
-- Brand-neutral: products are keyed by an opaque product_id, never a name.

CREATE TABLE IF NOT EXISTS products (
  product_id    CHAR(36)     NOT NULL PRIMARY KEY,
  name_internal VARCHAR(120) NOT NULL
);

-- Trial-clock anchor. Authoritative trial window per (product, fingerprint).
-- A returning fp_hash RESUMES this window; it is never re-minted.
-- customer_name/contact_name/email capture the trial customer's identity at
-- trial start (the in-app 14-day trial). They are plain contact details only —
-- never secrets, keys or tokens. customer_name is required when a trial starts.
CREATE TABLE IF NOT EXISTS device_registrations (
  id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fp_hash       CHAR(64)     NOT NULL,
  product_id    CHAR(36)     NOT NULL,
  first_seen    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  trial_start   DATETIME     NULL,
  trial_end     DATETIME     NULL,
  customer_name VARCHAR(190) NULL,   -- customer or company name (required at trial start)
  contact_name  VARCHAR(190) NULL,   -- user name
  email         VARCHAR(190) NULL,   -- contact email (validated when present)
  UNIQUE KEY uq_fp_product (fp_hash, product_id),
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE TABLE IF NOT EXISTS accounts (
  id               BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  account_key_hash CHAR(64)    NOT NULL UNIQUE,   -- never store the plaintext key
  status           VARCHAR(20) NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS entitlements (
  id          BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  account_id  BIGINT      NOT NULL,
  product_id  CHAR(36)    NOT NULL,
  feature     VARCHAR(20) NOT NULL DEFAULT 'core',   -- core | search | workflow (search/workflow are capacity counts)
  seats_total INT         NOT NULL DEFAULT 1,
  expires_at  DATETIME    NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'active',
  -- Admin-issuance metadata (temporary licences). Never secrets.
  customer_name  VARCHAR(190) NULL,   -- required at issuance: customer or company name
  device_label   VARCHAR(120) NULL,   -- optional human-friendly device name
  customer_email VARCHAR(190) NULL,   -- optional; support / expiry reminders only
  notes          TEXT         NULL,   -- internal admin notes
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

-- One ACTIVE binding per seat. A released seat sets fp_hash NULL and is
-- reusable (revoke -> reactivate). fp_hash is unique among active bindings.
CREATE TABLE IF NOT EXISTS seats (
  id             BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entitlement_id BIGINT      NOT NULL,
  fp_hash        CHAR(64)    NULL,
  device_label   VARCHAR(120) NULL,
  bound_at       DATETIME    NULL,
  released_at    DATETIME    NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'free',
  FOREIGN KEY (entitlement_id) REFERENCES entitlements(id)
);

CREATE TABLE IF NOT EXISTS signing_keys (
  kid             VARCHAR(40) NOT NULL PRIMARY KEY,
  public_key      TEXT        NOT NULL,   -- SPKI; mirrors the client's pinned key
  private_key_ref VARCHAR(255) NOT NULL,  -- reference/path to host-only private key
  active          TINYINT(1)  NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_events (
  id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fp_hash    CHAR(64)    NULL,
  account_id BIGINT      NULL,
  action     VARCHAR(40) NOT NULL,   -- license.trial_started, license.activated, ...
  detail     TEXT        NULL,       -- include outcome; never the plaintext account_key
  ip         VARCHAR(45) NULL,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Fixed-window rate-limit counters (F-03 anti-automation). One row per bucket
-- (e.g. "trial_ip:1.2.3.4", "trial_new:2026-06-20"); written by lib/ratelimit.php.
-- Disposable operational state — safe to TRUNCATE; never holds secrets.
-- REQUIRED for rate limiting to take effect: lib/ratelimit.php FAILS OPEN, so until
-- this table exists the /v1 limiter is INERT (no throttling). Import this file on
-- every deploy (Configure-WampBackend.ps1 -ImportDatabase) to enable F-03.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       VARCHAR(190) NOT NULL PRIMARY KEY,
  count        INT          NOT NULL DEFAULT 0,
  window_start BIGINT       NOT NULL DEFAULT 0    -- unix epoch seconds
);

-- Phase 2b: processed purchase-webhook events (idempotency + audit). The external
-- event_id is the idempotency key (PRIMARY KEY): a second delivery of the same id
-- fails the INSERT and is a NO-OP that returns the recorded outcome. Stores the
-- OUTCOME only — NEVER the raw payload, account_key, or signature. Whole-table
-- addition, so CREATE-IF-NOT-EXISTS is fully idempotent on re-import.
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id    VARCHAR(190) NOT NULL PRIMARY KEY,   -- external idempotency key
  event_type  VARCHAR(60)  NOT NULL,
  account_id  BIGINT       NULL,
  product_id  CHAR(36)     NULL,
  status      VARCHAR(20)  NOT NULL DEFAULT 'received',  -- received | applied | rejected
  detail      TEXT         NULL,                          -- human-readable outcome; never secrets/payload
  received_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Idempotent migrations ────────────────────────────────────────────────────
-- CREATE TABLE IF NOT EXISTS above only covers FRESH installs; an existing DB
-- keeps its old column set. This block back-fills new columns on re-import
-- (Configure-WampBackend.ps1 -ImportDatabase). Guarded so re-running is safe and
-- it does not depend on `ADD COLUMN IF NOT EXISTS` (absent in stock MySQL).
DROP PROCEDURE IF EXISTS _ds_migrate;
DELIMITER //
CREATE PROCEDURE _ds_migrate()
BEGIN
  -- Trial customer identity on device_registrations (see table comment above).
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device_registrations'
                   AND COLUMN_NAME = 'customer_name') THEN
    ALTER TABLE device_registrations ADD COLUMN customer_name VARCHAR(190) NULL AFTER trial_end;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device_registrations'
                   AND COLUMN_NAME = 'contact_name') THEN
    ALTER TABLE device_registrations ADD COLUMN contact_name VARCHAR(190) NULL AFTER customer_name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device_registrations'
                   AND COLUMN_NAME = 'email') THEN
    ALTER TABLE device_registrations ADD COLUMN email VARCHAR(190) NULL AFTER contact_name;
  END IF;
  -- Feature dimension on entitlements (core | search | workflow). Existing rows
  -- backfill to 'core', so a pre-feature account keeps working as a core licence.
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entitlements'
                   AND COLUMN_NAME = 'feature') THEN
    ALTER TABLE entitlements ADD COLUMN feature VARCHAR(20) NOT NULL DEFAULT 'core' AFTER product_id;
  END IF;
END //
DELIMITER ;
CALL _ds_migrate();
DROP PROCEDURE IF EXISTS _ds_migrate;
