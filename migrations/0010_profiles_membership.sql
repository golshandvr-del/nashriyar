-- Full profiles, two-path registration and role-based access inside a publication (ROADMAP phase 15). Additive only.
ALTER TABLE users ADD COLUMN gender TEXT;            -- male | female
ALTER TABLE users ADD COLUMN birth_year INTEGER;     -- Jalali year
ALTER TABLE users ADD COLUMN degree TEXT;            -- associate | bachelor | master | phd
ALTER TABLE users ADD COLUMN entry_year INTEGER;     -- Jalali year of university entry
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN avatar_key TEXT;
ALTER TABLE users ADD COLUMN profile_consent_at TEXT; -- consent to store sensitive profile fields
ALTER TABLE users ADD COLUMN profile_completed_at TEXT;

-- team member records can be linked to a real account
ALTER TABLE team_members ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_members_user ON team_members(user_id);

-- "request to join a publication team" queue
CREATE TABLE IF NOT EXISTS membership_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  role_name TEXT,                    -- requested production role (from production_roles)
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  team_member_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mreq_pub ON membership_requests(publication_id, status);
CREATE INDEX IF NOT EXISTS idx_mreq_user ON membership_requests(user_id);
