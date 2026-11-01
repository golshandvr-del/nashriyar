-- ROADMAP phase 17 — academic-year dimension: read-only yearly archive.
-- One immutable snapshot per FINISHED academic year (1 Mehr jy → 31 Shahrivar jy+1): headline KPIs, per-publication
-- ranking, sales and production frozen as JSON the first time the year is requested after it ends. The app never
-- updates or deletes a row (append-only), so past years stay exactly as they were reported. Additive only.
CREATE TABLE IF NOT EXISTS academic_year_archive (
  year INTEGER PRIMARY KEY,               -- Jalali year the academic year starts in (1403 = 1403–1404)
  from_day TEXT NOT NULL,
  to_day TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);
