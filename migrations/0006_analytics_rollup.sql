-- Analytics infrastructure (ROADMAP phase 7, ANALYTICS.md): lazy daily rollup + short-lived result cache.
-- No cron needed: the first analytics request after midnight rolls up every finished day not yet aggregated.
CREATE TABLE IF NOT EXISTS view_daily (
  day TEXT NOT NULL,                       -- YYYY-MM-DD (finished days only)
  publication_id TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,            -- total views
  uniq INTEGER NOT NULL DEFAULT 0,         -- distinct viewers
  PRIMARY KEY (day, publication_id, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_view_daily_pub ON view_daily(publication_id, day);

CREATE TABLE IF NOT EXISTS analytics_cache (
  key TEXT PRIMARY KEY,                    -- scope + path + query
  value TEXT NOT NULL,                     -- JSON response body
  expires_at TEXT NOT NULL
);
