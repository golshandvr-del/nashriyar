-- Developer console (ROADMAP phase 13): role `developer` (users.system_role is free text, no CHECK to alter),
-- sudo-mode re-authentication per session and an append-only technical audit log.
ALTER TABLE sessions ADD COLUMN elevated_until TEXT;

CREATE TABLE IF NOT EXISTS system_audit (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,          -- e.g. system.elevate, system.backup, system.settings, system.staff_create
  detail_json TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_system_audit_created ON system_audit(created_at);

-- Append-only: rows can never be changed or removed, not even by the developer account (single-line triggers: see splitSql).
CREATE TRIGGER IF NOT EXISTS trg_system_audit_no_update BEFORE UPDATE ON system_audit BEGIN SELECT RAISE(ABORT, 'system_audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_system_audit_no_delete BEFORE DELETE ON system_audit BEGIN SELECT RAISE(ABORT, 'system_audit is append-only'); END;
