-- ROADMAP phase 19 — indexing of the articles in published issues with persistent identifiers.
-- One row per TOC item of a published issue (kind = 'article' and similar). `pid` is assigned once (NSH-<year>-<code>)
-- and NEVER changes or gets reused, even if the title is corrected later; `/a/<pid>` is the permanent landing page.
-- `doi` is optional (registered by the university with Crossref); abstract/keywords/lang feed citation_* meta and OAI-PMH.
-- Additive only.
CREATE TABLE IF NOT EXISTS article_index (
  pid TEXT PRIMARY KEY,
  toc_item_id TEXT UNIQUE NOT NULL REFERENCES issue_toc_items(id),
  issue_id TEXT NOT NULL REFERENCES issues(id),
  doi TEXT UNIQUE,
  abstract TEXT,
  keywords TEXT,
  lang TEXT NOT NULL DEFAULT 'fa',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_article_index_issue ON article_index(issue_id);
CREATE INDEX IF NOT EXISTS idx_article_index_created ON article_index(created_at, pid);
