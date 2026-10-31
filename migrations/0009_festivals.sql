-- Publications festival (ROADMAP phase 14, proposed item): call for entries, judging with a score form, results.
CREATE TABLE IF NOT EXISTS festivals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | open | judging | announced
  submit_until TEXT,                         -- YYYY-MM-DD (inclusive)
  criteria_json TEXT NOT NULL,               -- [{ "key": "content", "label": "محتوا", "max": 10 }, …]
  created_by TEXT,
  created_at TEXT NOT NULL,
  announced_at TEXT
);
CREATE TABLE IF NOT EXISTS festival_entries (
  id TEXT PRIMARY KEY,
  festival_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  note TEXT,
  submitted_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (festival_id, issue_id)
);
CREATE INDEX IF NOT EXISTS idx_festival_entries_fest ON festival_entries(festival_id);
CREATE TABLE IF NOT EXISTS festival_judges (
  festival_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (festival_id, user_id)
);
CREATE TABLE IF NOT EXISTS festival_scores (
  entry_id TEXT NOT NULL,
  judge_id TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  total REAL NOT NULL,
  comment TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entry_id, judge_id)
);
