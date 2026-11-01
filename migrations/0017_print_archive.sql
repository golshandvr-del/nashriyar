-- ROADMAP phase 19 — digitisation & archive of old printed issues.
-- An archival issue is registered directly by the publications officer (no team production workflow), its scanned
-- PDF goes through the normal page pipeline (browser pdf.js or server pdftoppm/pdftotext → issue_pages.text_content,
-- which feeds full-text search), and on publication `published_at` is set to the ORIGINAL print date so it never
-- floods the "new issues" shelves. `original_label` is free text for vague dates ("پاییز ۱۳۷۸").
-- Additive only.
ALTER TABLE issues ADD COLUMN archival INTEGER NOT NULL DEFAULT 0;
ALTER TABLE issues ADD COLUMN original_date TEXT;
ALTER TABLE issues ADD COLUMN original_label TEXT;
CREATE INDEX IF NOT EXISTS idx_issues_archival ON issues(archival, original_date);
