-- Licensing backend schema (MySQL) — Loop 2 data model.
-- Phase 0 scaffold: schema only; no business logic depends on it yet.
-- Brand-neutral: products are keyed by an opaque product_id, never a name.

CREATE TABLE IF NOT EXISTS products (
  product_id    CHAR(36)     NOT NULL PRIMARY KEY,
  name_internal VARCHAR(120) NOT NULL
);

-- Trial-clock anchor. Authoritative trial window per (product, fingerprint).
-- A returning fp_hash RESUMES this window; it is never re-minted.
CREATE TABLE IF NOT EXISTS device_registrations (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fp_hash     CHAR(64)     NOT NULL,
  product_id  CHAR(36)     NOT NULL,
  first_seen  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  trial_start DATETIME     NULL,
  trial_end   DATETIME     NULL,
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
  seats_total INT         NOT NULL DEFAULT 1,
  expires_at  DATETIME    NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'active',
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
