-- Events calendar (ROADMAP phase 14, proposed item): the official `deadlines` table becomes a general calendar
-- of publication events. Additive only: existing rows keep kind = 'deadline'.
ALTER TABLE deadlines ADD COLUMN kind TEXT NOT NULL DEFAULT 'deadline';
ALTER TABLE deadlines ADD COLUMN start_time TEXT;
ALTER TABLE deadlines ADD COLUMN location TEXT;
CREATE INDEX IF NOT EXISTS idx_deadlines_due ON deadlines(due_at);
