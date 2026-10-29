-- Nashriyar initial schema (SQLite dialect: Cloudflare D1 / node:sqlite)
-- Conventions: TEXT ids (random), ISO-8601 UTC timestamps, soft delete via deleted_at.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT
);

-- ───────── Organization ─────────
CREATE TABLE IF NOT EXISTS faculties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS majors (
  id TEXT PRIMARY KEY,
  faculty_id TEXT NOT NULL REFERENCES faculties(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS associations (
  id TEXT PRIMARY KEY,
  faculty_id TEXT REFERENCES faculties(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'scientific_association', -- scientific_association | cultural_club | islamic_association | other
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

-- ───────── Users & auth ─────────
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,          -- login id (student number for students)
  student_number TEXT UNIQUE,
  display_name TEXT NOT NULL,
  faculty_id TEXT REFERENCES faculties(id),
  major_id TEXT REFERENCES majors(id),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER DEFAULT 0,
  system_role TEXT NOT NULL DEFAULT 'student', -- super_admin | pub_officer | faculty_supervisor | analyst | team | student
  scope_faculty_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',   -- active | suspended
  theme TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                     -- sha256(token)
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  locked_until TEXT
);

-- ───────── Categories ─────────
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES categories(id),
  type TEXT NOT NULL DEFAULT 'subject',   -- subject | major | format | custom
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

-- ───────── Publications & teams ─────────
CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  tagline TEXT,
  description TEXT,
  association_id TEXT NOT NULL REFERENCES associations(id),
  faculty_id TEXT REFERENCES faculties(id),
  license_number TEXT,
  license_issued_at TEXT,
  license_expires_at TEXT,
  frequency TEXT,                          -- monthly | bimonthly | quarterly | biannual | irregular
  theme_color TEXT,
  logo_key TEXT,
  keywords TEXT,                           -- comma separated
  contacts_json TEXT,                      -- [{kind,value,label}]
  status TEXT NOT NULL DEFAULT 'active',   -- active | suspended | archived
  search_text TEXT,
  founded_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS publication_roles (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,                      -- managing_director | editor_in_chief | license_holder
  started_at TEXT NOT NULL,
  ended_at TEXT                            -- NULL = current; history kept forever
);
CREATE INDEX IF NOT EXISTS idx_pubroles_pub ON publication_roles(publication_id, role);
CREATE INDEX IF NOT EXISTS idx_pubroles_user ON publication_roles(user_id);

CREATE TABLE IF NOT EXISTS publication_categories (
  publication_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  PRIMARY KEY (publication_id, category_id)
);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  full_name TEXT NOT NULL,
  student_number TEXT,
  faculty_id TEXT,
  major_id TEXT,
  default_role TEXT,
  phone TEXT,
  joined_at TEXT,
  left_at TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_pub ON team_members(publication_id);

CREATE TABLE IF NOT EXISTS production_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- ───────── Issues & production workflow ─────────
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  keywords TEXT,
  status TEXT NOT NULL DEFAULT 'planning', -- planning | in_production | awaiting_approval | changes_requested | published | archived
  progress_view TEXT NOT NULL DEFAULT 'timeline', -- timeline | checklist | kanban
  planned_publish_at TEXT,
  published_at TEXT,
  page_count INTEGER DEFAULT 0,
  pricing TEXT NOT NULL DEFAULT 'free',   -- free | paid
  price_digital INTEGER,
  price_print INTEGER,
  print_run INTEGER,
  free_preview_pages INTEGER DEFAULT 3,
  cover_key TEXT,
  main_pdf_key TEXT,
  code_ttl_hours INTEGER DEFAULT 24,       -- set by team, max 24
  director_user_id TEXT,                   -- managing director at time of creation
  search_text TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_issues_pub ON issues(publication_id, status);
CREATE INDEX IF NOT EXISTS idx_issues_published ON issues(published_at);

CREATE TABLE IF NOT EXISTS issue_categories (
  issue_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  PRIMARY KEY (issue_id, category_id)
);

CREATE TABLE IF NOT EXISTS issue_toc_items (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  parent_id TEXT,
  sort_order INTEGER DEFAULT 0,
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'article',
  page_start INTEGER,
  page_end INTEGER,
  status TEXT NOT NULL DEFAULT 'todo',     -- todo | writing | written | editing | edited | done
  due_at TEXT,
  done_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_toc_issue ON issue_toc_items(issue_id);

CREATE TABLE IF NOT EXISTS toc_assignments (
  id TEXT PRIMARY KEY,
  toc_item_id TEXT NOT NULL REFERENCES issue_toc_items(id),
  team_member_id TEXT NOT NULL REFERENCES team_members(id),
  role TEXT NOT NULL DEFAULT 'author'      -- author | translator | editor | illustrator | ...
);
CREATE INDEX IF NOT EXISTS idx_assign_toc ON toc_assignments(toc_item_id);

CREATE TABLE IF NOT EXISTS issue_members (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  team_member_id TEXT NOT NULL REFERENCES team_members(id),
  production_role TEXT NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_issue_members ON issue_members(issue_id);

CREATE TABLE IF NOT EXISTS issue_stages (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | done | skipped
  started_at TEXT,
  completed_at TEXT,
  due_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stages_issue ON issue_stages(issue_id);

-- append-only event log for every progress change (source of stage durations)
CREATE TABLE IF NOT EXISTS stage_events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  stage_id TEXT,
  toc_item_id TEXT,
  from_status TEXT,
  to_status TEXT,
  actor_user_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stage_events_issue ON stage_events(issue_id, created_at);

CREATE TABLE IF NOT EXISTS issue_approvals (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  requested_by TEXT,
  requested_at TEXT NOT NULL,
  decided_by TEXT,
  decision TEXT,                           -- approved | changes_requested
  note TEXT,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_approvals_issue ON issue_approvals(issue_id);

-- ───────── Media ─────────
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  publication_id TEXT,
  issue_id TEXT,
  kind TEXT NOT NULL,                      -- pdf | audio | video | image | page
  role TEXT,                               -- main_pdf | podcast | clip | gallery | attachment | cover | post | page
  title TEXT,
  storage_key TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER,
  toc_item_id TEXT,
  access TEXT DEFAULT 'free',              -- free | paid | private
  sort_order INTEGER DEFAULT 0,
  uploaded_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_issue ON media_assets(issue_id, role);

CREATE TABLE IF NOT EXISTS issue_pages (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  image_key TEXT NOT NULL,
  text_content TEXT,
  UNIQUE (issue_id, page_number)
);

-- ───────── Sales & access ─────────
CREATE TABLE IF NOT EXISTS access_codes (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  code_hash TEXT UNIQUE NOT NULL,
  code_last4 TEXT,
  bound_student_number TEXT,
  price_paid INTEGER,
  channel TEXT,                            -- card_to_card | cash | gift | other
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  redeemed_by TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_codes_issue ON access_codes(issue_id, created_at);
CREATE INDEX IF NOT EXISTS idx_codes_pub ON access_codes(publication_id, created_at);

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  source TEXT NOT NULL,                    -- code | free | admin_grant
  access_code_id TEXT,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (user_id, issue_id)
);

CREATE TABLE IF NOT EXISTS physical_sales (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER,
  sold_at TEXT NOT NULL,
  channel TEXT,
  recorded_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_progress (
  user_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  last_page INTEGER DEFAULT 1,
  percent INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, issue_id)
);

CREATE TABLE IF NOT EXISTS reader_bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

-- ───────── Explore ─────────
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'image',      -- image | carousel | video (future)
  caption TEXT,
  images_json TEXT NOT NULL,               -- [storage_key,...]
  source_issue_id TEXT NOT NULL,
  source_toc_item_id TEXT NOT NULL,
  is_story INTEGER DEFAULT 0,
  expires_at TEXT,                         -- stories: +24h
  status TEXT NOT NULL DEFAULT 'published',-- draft | published | hidden_by_team | hidden_by_admin
  published_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_pub ON posts(publication_id, published_at);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, published_at);

CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS highlight_items (
  highlight_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  PRIMARY KEY (highlight_id, post_id)
);

CREATE TABLE IF NOT EXISTS follows (
  user_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  unfollowed_at TEXT,
  PRIMARY KEY (user_id, publication_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_pub ON follows(publication_id);

CREATE TABLE IF NOT EXISTS saved_posts (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT,
  parent_id TEXT,
  is_team_reply INTEGER DEFAULT 0,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | spam
  flagged INTEGER DEFAULT 0,
  moderated_by TEXT,
  moderated_at TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, status);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',     -- open | resolved | dismissed
  handled_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);

-- ───────── Logs & analytics ─────────
CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  publication_id TEXT,
  issue_id TEXT,
  type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_pub ON activity_events(publication_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_events(type, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS view_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,               -- post | publication | issue | issue_read | category | search
  entity_id TEXT,
  publication_id TEXT,
  category_id TEXT,
  viewer_hash TEXT,
  user_id TEXT,
  day TEXT NOT NULL,                       -- YYYY-MM-DD
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_views_entity ON view_events(entity_type, entity_id, day);
CREATE INDEX IF NOT EXISTS idx_views_pub ON view_events(publication_id, day);
CREATE INDEX IF NOT EXISTS idx_views_day ON view_events(day);

CREATE TABLE IF NOT EXISTS insight_dismissals (
  insight_key TEXT PRIMARY KEY,
  dismissed_by TEXT,
  dismissed_at TEXT NOT NULL
);

-- ───────── Communication ─────────
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  author_id TEXT,
  audience TEXT NOT NULL DEFAULT 'all',    -- all | faculty | publication
  target_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS deadlines (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  verify_code TEXT UNIQUE NOT NULL,
  team_member_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  roles TEXT,
  issued_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recruitment_calls (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL,
  title TEXT NOT NULL,
  roles_needed TEXT,
  body TEXT,
  contact TEXT,
  open_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS featured_shelves (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  issue_ids_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
