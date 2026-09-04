-- VROZEK AI — cleanup of legacy commerce tables
-- Run ONLY on databases where earlier migrations (001/002/003) were applied.
-- The bot no longer has carts, orders or store webhooks — products live in catalog/products.json.
-- Fresh installs with the current 001/002 already have none of these tables; this is a safe no-op.
-- Apply:  npx wrangler d1 execute vrozek_ai --file=migrations/004_remove_commerce.sql --remote

DROP TABLE IF EXISTS cart;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS site_orders;
