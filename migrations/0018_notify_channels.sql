-- ROADMAP phase 19 — outbound notifications through email and the domestic messengers (Bale, Eitaa).
-- In-app notifications stay in `notifications`; every notify() additionally enqueues one row per verified,
-- non-muted channel of the recipient into `outbound_queue`, which is flushed after the request (waitUntil on
-- Cloudflare, background promise on Node) and by the periodic maintenance job, with retry/backoff.
-- Additive only.
CREATE TABLE IF NOT EXISTS notify_channels (
  user_id TEXT NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL,                 -- email | bale | eitaa
  address TEXT,                          -- email address / Bale chat_id / Eitaa id (null until linked)
  verified_at TEXT,
  code_hash TEXT,                        -- sha256 of the pending verification / link code
  code_expires TEXT,
  muted_json TEXT,                       -- JSON array of muted categories (issue, membership, approval, …)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_notify_channels_code ON notify_channels(code_hash);

CREATE TABLE IF NOT EXISTS outbound_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  address TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at TEXT NOT NULL,
  sent_at TEXT,
  failed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbound_pending ON outbound_queue(sent_at, failed_at, next_at);
