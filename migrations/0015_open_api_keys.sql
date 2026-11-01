-- ROADMAP phase 19 — read-only public API for other university systems (/api/open/v1/*).
-- Keys are created in the developer console; only a SHA-256 hash is stored (the plain key is shown once).
-- `prefix` (first 8 chars) identifies a key in lists and logs. Revoked keys stay for the audit trail. Additive only.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'read',      -- comma separated: read
  rate_per_min INTEGER NOT NULL DEFAULT 120,
  created_by TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT
);
