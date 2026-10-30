-- Two-factor authentication (TOTP, RFC 6238) for staff accounts (ROADMAP phase 1, SECURITY.md §1).
-- totp_secret holds the base32 secret; it is set during setup and only counts once totp_enabled = 1.
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
-- Last accepted time-step, so a code cannot be replayed within its 30-second window.
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;
