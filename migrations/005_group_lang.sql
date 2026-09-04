-- VROZEK AI — v1.2: per-group interface language
-- Run once on EXISTING installs:  npx wrangler d1 execute vrozek_ai --file=migrations/005_group_lang.sql --remote
-- (Fresh installs: 001_init.sql already contains the column; this is a safe skip there.)

ALTER TABLE group_settings ADD COLUMN lang TEXT DEFAULT 'en';
