-- Accessible explore posts (ROADMAP phase 6): optional alt text per post image.
-- JSON array aligned with posts.images_json (same order); NULL = no alt text provided.
ALTER TABLE posts ADD COLUMN alt_json TEXT;
