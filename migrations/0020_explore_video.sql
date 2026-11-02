-- ROADMAP phase 19 — short videos in explore. Additive only.
-- posts.kind = 'video' (reserved since phase 6) now carries a video: images_json[0] stays the thumbnail (poster),
-- video_json = {"src": "<mp4/webm storage key>", "duration": <seconds>, "w": <px>, "h": <px>,
--               "hls": "<storage key of index.m3u8>" | null, "hls_state": "none" | "pending" | "ready" | "failed"}
ALTER TABLE posts ADD COLUMN video_json TEXT;
-- probe result recorded at upload ({"duration": s, "w": px, "h": px}) so a post never re-reads a large file
ALTER TABLE media_assets ADD COLUMN meta_json TEXT;
-- lookups by storage key (video post creation, file serving) and the restart resume of pending video transcodes
CREATE INDEX IF NOT EXISTS idx_media_key ON media_assets(storage_key);
CREATE INDEX IF NOT EXISTS idx_posts_kind ON posts(kind);
