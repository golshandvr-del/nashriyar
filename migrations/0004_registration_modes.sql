-- Configurable registration (ROADMAP phase 5, SECURITY.md §2) and self-service password recovery.
-- setting `registration_mode`: 'open' (default) | 'allowlist'.
-- In allowlist mode only listed student numbers can register; if secret_hash is set the registrant must also
-- enter the matching second value (national id from the officer's CSV, or a generated activation code).
CREATE TABLE IF NOT EXISTS registration_allowlist (
  student_number TEXT PRIMARY KEY,
  secret_hash TEXT,                        -- sha256(normalised national id / activation code) or NULL
  secret_kind TEXT,                        -- national_id | activation_code | NULL
  note TEXT,
  used_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
-- One-time recovery code (shown once in account settings; only its hash is stored).
ALTER TABLE users ADD COLUMN recovery_hash TEXT;
