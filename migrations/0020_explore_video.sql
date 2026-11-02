-- ROADMAP phase 19 — short videos in explore. Additive only.
-- posts.kind = 'video' (reserved since phase 6) now carries a video: images_json[0] stays the thumbnail (poster),
-- video_json = {"src": "<mp4/webm storage key>", "duration": <seconds>, "w": <px>, "h": <px>,
--               "hls": "<storage key of index.m3u8>" | null, "hls_state": "none" | "pending" | "ready" | "failed"}
ALTER TABLE posts ADD COLUMN video_json TEXT;
