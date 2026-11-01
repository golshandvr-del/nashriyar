-- ROADMAP phase 17 — composite indexes found by the query-plan audit (tests/query-plan.mjs, EXPLAIN QUERY PLAN over
-- every statement the app runs). Additive only (CREATE INDEX IF NOT EXISTS): safe to apply with the app running and
-- reversible by DROP INDEX.

-- physical (print) sales had no index at all: per-issue totals, per-publication windows and global windows
CREATE INDEX IF NOT EXISTS idx_psales_issue ON physical_sales(issue_id, sold_at);
CREATE INDEX IF NOT EXISTS idx_psales_pub ON physical_sales(publication_id, sold_at);
CREATE INDEX IF NOT EXISTS idx_psales_sold ON physical_sales(sold_at);

-- moderation queue counters (open reports)
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);

-- production funnel: average stage durations over finished stages
CREATE INDEX IF NOT EXISTS idx_stages_status ON issue_stages(status, key);

-- role lists and counters (students, team accounts) on a users table that grows every year
CREATE INDEX IF NOT EXISTS idx_users_role ON users(system_role, deleted_at, display_name);

-- «is this major still in use?» before deleting it (users + legacy team records)
CREATE INDEX IF NOT EXISTS idx_users_major ON users(major_id);
CREATE INDEX IF NOT EXISTS idx_members_major ON team_members(major_id);
