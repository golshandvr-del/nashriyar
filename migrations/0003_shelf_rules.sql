-- Rule-based storefront shelves (ROADMAP phase 4: «قفسه‌های ویژه (دستی یا قاعده‌محور)»).
-- rule NULL/'manual' = hand-picked issue_ids_json; otherwise one of:
--   'latest' | 'free' | 'popular' (views in the last 30 days) | 'category:<category_id>' | 'faculty:<faculty_id>'
ALTER TABLE featured_shelves ADD COLUMN rule TEXT;
