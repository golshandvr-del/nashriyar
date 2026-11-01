-- ROADMAP phase 17 — query-plan audit, third pass (statement seen by the nightly maintenance job).
-- The expired/revoked-session purge used to scan the whole sessions table; with both columns indexed SQLite serves
-- `expires_at < ? OR revoked_at < ?` with a multi-index OR (two range searches). Additive only; reversible by DROP INDEX.
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked ON sessions(revoked_at);
