-- ROADMAP phase 19 — Android app with FLAG_SECURE. Additive only.
-- app_only = 1: the full (entitled) reading of this paid issue is served only inside the Nashriyar Android app,
-- where screenshots and screen recording are blocked. On the web the free preview pages stay readable.
ALTER TABLE issues ADD COLUMN app_only INTEGER NOT NULL DEFAULT 0;
