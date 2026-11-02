-- ROADMAP phase 19 — SMS one-time-code sign-in and university SSO (OpenID Connect). Additive only.
-- A phone number signs in only after its owner verified it (users.phone_verified_at); a verified number is unique.
ALTER TABLE users ADD COLUMN phone_verified_at TEXT;
CREATE INDEX IF NOT EXISTS idx_users_phone_verified ON users(phone, phone_verified_at);

-- one-time codes sent by SMS (purpose: login | verify); only a hash of the code is stored
CREATE TABLE IF NOT EXISTS sms_otps (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL,
  user_id TEXT,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sms_otps_phone ON sms_otps(phone, purpose, created_at);

-- external identities (issuer + subject) linked to local accounts
CREATE TABLE IF NOT EXISTS sso_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX IF NOT EXISTS idx_sso_identities_user ON sso_identities(user_id);

-- pending authorization requests (state → PKCE verifier, nonce, return path); short-lived
CREATE TABLE IF NOT EXISTS sso_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  next_path TEXT,
  link_user_id TEXT,
  created_at TEXT NOT NULL
);
