-- VROZEK AI — D1 schema (SQLite)
-- Fresh install:  npx wrangler d1 execute vrozek_ai --file=migrations/001_init.sql --remote
-- Existing installs only: run 002_market_features.sql too

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  first_name TEXT DEFAULT '',
  username TEXT DEFAULT '',
  access_approved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  user_id INTEGER PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'moderator' CHECK (role IN ('super_admin','admin','moderator')),
  added_by INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  title TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_settings (
  group_id INTEGER PRIMARY KEY,
  ai_enabled INTEGER DEFAULT 1,
  welcome_enabled INTEGER DEFAULT 1,
  goodbye_enabled INTEGER DEFAULT 1,
  moderation_enabled INTEGER DEFAULT 1,
  sticker_enabled INTEGER DEFAULT 1,
  products_enabled INTEGER DEFAULT 1,
  welcome_text TEXT DEFAULT '',
  goodbye_text TEXT DEFAULT '',
  captcha_enabled INTEGER DEFAULT 0,
  link_enabled INTEGER DEFAULT 1,
  block_words TEXT DEFAULT '',
  warn_limit INTEGER DEFAULT 3,
  trusted TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT '',
  link TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  price TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moderation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER DEFAULT 0,
  user_id INTEGER DEFAULT 0,
  user_name TEXT DEFAULT '',
  action TEXT DEFAULT '',
  category TEXT DEFAULT '',
  confidence REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT DEFAULT 'info',
  message TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS broadcast_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  total INTEGER DEFAULT 0,
  success INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  payload TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS stickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT UNIQUE NOT NULL,
  category TEXT DEFAULT 'reaction',
  label TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_memory (
  chat_id INTEGER PRIMARY KEY,
  last_exchange TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER DEFAULT 0,
  from_name TEXT DEFAULT '',
  text TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Persistent anti-flood / anti-repeat state (survives worker restarts)
CREATE TABLE IF NOT EXISTS mod_state (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_text TEXT DEFAULT '',
  last_time INTEGER DEFAULT 0,
  recent TEXT DEFAULT '[]',
  PRIMARY KEY (chat_id, user_id)
);

-- Strike (warn) counter per group per user
CREATE TABLE IF NOT EXISTS warns (
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  count INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, user_id)
);

-- Newcomer CAPTCHA verification in progress
CREATE TABLE IF NOT EXISTS captcha_state (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  message_id INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, user_id)
);

-- Shopping cart
CREATE TABLE IF NOT EXISTS cart (
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty INTEGER DEFAULT 1,
  PRIMARY KEY (user_id, product_id)
);

-- Checked-out orders
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 0,
  user_name TEXT DEFAULT '',
  items_json TEXT DEFAULT '',
  total TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_cat ON knowledge(category);
CREATE INDEX IF NOT EXISTS idx_modlogs_created ON moderation_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
