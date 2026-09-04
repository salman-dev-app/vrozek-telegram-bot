# ☁️ Deploy VROZEK AI to Cloudflare

Step-by-step from an empty Cloudflare account to a live bot with webhook + dashboard.
Everything below runs on **your own machine** (or CI). I cannot log into your Cloudflare account for you — `wrangler login` is an interactive OAuth flow tied to your browser.

> ✅ The code is already Cloudflare-native: **webhook entry**, no long-polling, no Node-only APIs, D1 (SQLite) storage, cron-trigger housekeeping, secrets via Worker secrets.

---

## Step 0 — Prepare

- Node.js 18+ → `node -v`
- A Telegram bot token from [@BotFather](https://t.me/BotFather) (create with `/newbot`)
- A Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- Your Telegram **user ID** (from [@userinfobot](https://t.me/userinfobot))

```bash
cd vrozek-ai
npm install
```

## Step 1 — Connect your Cloudflare account

**Option A — interactive (recommended):**

```bash
npx wrangler login
```

A browser opens → authorize → done. Verify with `npx wrangler whoami`.

**Option B — CI / token:**

```bash
export CLOUDFLARE_API_TOKEN=your_api_token      # Edit > API Tokens > Create
export CLOUDFLARE_ACCOUNT_ID=your_account_id    # dashboard right sidebar
```

*(Optional) enable your `workers.dev` subdomain once in the Cloudflare dashboard: Workers & Pages → Your subdomain → `vrozek-ai.<account>.workers.dev`.*

## Step 2 — Create the D1 database

```bash
npx wrangler d1 create vrozek_ai
```

Copy the printed `database_id` into **`wrangler.toml`**:

```toml
[[d1_databases]]
binding = "DB"
database_name = "vrozek_ai"
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"   # ← paste here
```

Apply the schema:

```bash
npx wrangler d1 execute vrozek_ai --file=migrations/001_init.sql --remote
```

Sanity check: `npx wrangler d1 execute vrozek_ai --remote --command "SELECT name FROM sqlite_master WHERE type='table'"` → you should see `users, admins, groups, products, knowledge, ...`

## Step 3 — Set secrets (never in code)

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN      # from @BotFather
npx wrangler secret put GEMINI_API_KEY          # can also be set later in Dashboard → Settings
npx wrangler secret put DASHBOARD_USERNAME      # admin login
npx wrangler secret put DASHBOARD_PASSWORD      # strong admin password
npx wrangler secret put WEBHOOK_SECRET          # random string → protects your webhook
npx wrangler secret put ORDER_WEBHOOK_SECRET    # signs your store's order webhook (POST /webhook/order)
npx wrangler secret put ADMIN_IDS               # e.g. 111111111,222222222 → Super Admins
```

Optional defaults (non-secret) in `wrangler.toml` `[vars]`: `GEMINI_MODEL`.

## Step 4 — Deploy

```bash
npx wrangler deploy
```

Your URL is printed, e.g. `https://vrozek-ai.<account>.workers.dev`.

## Step 5 — Register the Telegram webhook

**Option A — one-shot setup endpoint (recommended):**

```bash
node scripts/setup.js https://vrozek-ai.<account>.workers.dev
```

This calls `POST /setup` on your worker, which:
1. Bootstraps `ADMIN_IDS` as Super Admins,
2. calls `setWebhook` with `secret_token`,
3. registers permission-scoped bot commands (`setMyCommands`).

**Option B — manual curl:**

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://vrozek-ai.<account>.workers.dev/webhook","secret_token":"<WEBHOOK_SECRET>","allowed_updates":["message","callback_query"]}'
```

Verify: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` → `"pending_update_count": 0` and `"last_error_message": ""`.

## Step 6 — Configure via the dashboard

Open **`https://vrozek-ai.<account>.workers.dev/dashboard`** (Basic Auth with `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`):

1. **Admins** — confirm your Super Admin(s)
2. **Groups** — add your group ID (from [@getidsbot](https://t.me/getidsbot)) → toggle per-group features
3. **Products / Knowledge** — add what the AI may recommend (it never invents anything)
4. **Settings** — double-check Gemini key/model, system prompt
5. Test in Telegram: open a private chat with the bot → `/start` → ask in any language. In your group: add the bot, then `@vrozek_ai_bot` a question.

## Step 7 — (Optional) Custom domain

Cloudflare dashboard → **Workers & Pages → vrozek-ai → Settings → Domains & Routes → Add → Custom Domain** → enter e.g. `bot.vrozek.xyz` (DNS on Cloudflare). Webhook URL becomes `https://bot.vrozek.xyz/webhook` — repeat Step 5.

## Local development

```bash
cp .dev.vars.example .dev.vars     # fill in values
npx wrangler dev                    # local webhook server on localhost:8787
```

Test locally with `curl -X POST http://localhost:8787/webhook -H "Content-Type: application/json" -d '{"update_id":1,"message":{...}}'`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `setWebhook returned 404` | Webhook URL wrong — must be `/webhook` on the deployed worker. |
| Telegram `last_error_message: 404 Not Found` | `wrangler deploy` didn't complete, or custom domain route missing. |
| Webhook `401 unauthorized` | `WEBHOOK_SECRET` mismatch between secret and `setWebhook` call. |
| `Could not find D1 database` | `database_id` in `wrangler.toml` still placeholder / wrong account. |
| Commands don't update in Telegram | Telegram caches command menus — close & reopen the chat, or re-run Step 5. |
| Cron never fires | Cron Triggers require `[triggers] crons` in `wrangler.toml` **before** `wrangler deploy` — re-deploy. |
| Dashboard 503 | `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` secrets not set. |

## What NOT to do

- ❌ Never paste the bot token / API keys into `wrangler.toml` or code → secrets only via `wrangler secret put`
- ❌ Never run long-polling (`getUpdates`) on Workers → webhook only
- ❌ Don't commit `.dev.vars` (git-ignored)
