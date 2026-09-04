-- VROZEK AI — website (storefront) integration migration
-- Creates the order-webhook notification table on databases that already ran
-- the earlier 001/002 (fresh installs already include it; this is a safe no-op).
-- Apply:  npx wrangler d1 execute vrozek_ai --file=migrations/003_website_integration.sql --remote

CREATE TABLE IF NOT EXISTS site_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT DEFAULT '',
  customer TEXT DEFAULT '',
  payload TEXT DEFAULT '',
  source TEXT DEFAULT 'website',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_site_orders_created ON site_orders(created_at);
