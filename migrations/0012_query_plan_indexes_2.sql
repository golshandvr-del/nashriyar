-- ROADMAP phase 17 — second pass of the query-plan audit (statements seen in the security and reader suites).
-- Additive only; reversible by DROP INDEX.

-- comment rate limit: comments by one user in the last window
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id, created_at);

-- media access check: which issue owns this cover image
CREATE INDEX IF NOT EXISTS idx_issues_cover ON issues(cover_key);

-- reader: a user's bookmarks in one issue, ordered by page
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_issue ON reader_bookmarks(user_id, issue_id, page);

-- developer console: latest login-attempt windows
CREATE INDEX IF NOT EXISTS idx_login_attempts_window ON login_attempts(window_start);
