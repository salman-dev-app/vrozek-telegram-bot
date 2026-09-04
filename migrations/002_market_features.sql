-- VROZEK AI — market-features migration
-- RUN THIS ONLY on databases where 001_init.sql was already applied.
-- (Fresh installs: 001 already contains everything; skip this file.)
-- Apply:  npx wrangler d1 execute vrozek_ai --file=migrations/002_market_features.sql --remote

ALTER TABLE group_settings ADD COLUMN captcha_enabled INTEGER DEFAULT 0;
ALTER TABLE group_settings ADD COLUMN link_enabled INTEGER DEFAULT 1;
ALTER TABLE group_settings ADD COLUMN block_words TEXT DEFAULT '';
ALTER TABLE group_settings ADD COLUMN warn_limit INTEGER DEFAULT 3;
ALTER TABLE group_settings ADD COLUMN trusted TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS warns (
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  count INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS captcha_state (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  message_id INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS cart (
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty INTEGER DEFAULT 1,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 0,
  user_name TEXT DEFAULT '',
  items_json TEXT DEFAULT '',
  total TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
