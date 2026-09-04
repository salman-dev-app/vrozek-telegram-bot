# 🤖 VROZEK AI

**VROZEK AI** — Salman's intelligent Telegram ecosystem. A premium, modular, serverless AI platform that combines a private AI bot, authorized-group assistant, smart product recommendations, knowledge base, moderation, welcome/goodbye, stickers, admin dashboard, broadcast and analytics.

- Brand: **VROZEK** · Website: https://vrozek.xyz
- Stack: **Cloudflare Workers + Hono + D1 (SQLite) + Gemini API** · Webhook-based (serverless ready)

---

## ⚡ Quick start (5 steps)

> ☁️ **Cloudflare deployment:** follow [CLOUDFLARE.md](CLOUDFLARE.md) — step-by-step from `wrangler login` to live webhook.

### 1. Create everything in Cloudflare

```bash
npm install
npx wrangler login
npx wrangler d1 create vrozek_db          # copy the database_id into wrangler.toml
npx wrangler d1 execute vrozek_db --file=migrations/001_init.sql --remote
```

### 2. Set secrets (never hardcode them)

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN      # from @BotFather
npx wrangler secret put GEMINI_API_KEY          # from https://aistudio.google.com/apikey (or set later in dashboard Settings)
npx wrangler secret put DASHBOARD_USERNAME      # admin login
npx wrangler secret put DASHBOARD_PASSWORD      # admin password
npx wrangler secret put WEBHOOK_SECRET          # optional webhook protection
npx wrangler secret put ADMIN_IDS               # comma-separated Telegram user IDs -> Super Admin
```

> Secrets can also be set later in **Dashboard → Settings** (stored in D1), except the bot token and dashboard auth which stay as Worker secrets.

### 3. Deploy

```bash
npm run deploy          # npx wrangler deploy
```

### 4. Run the one-time setup (webhook + command scopes + super admin bootstrap)

```bash
node scripts/setup.js https://vrozek-ai.yourname.workers.dev
```

or call it manually:

```bash
curl -X POST https://vrozek-ai.yourname.workers.dev/setup \
  -H "Content-Type: application/json" \
  -H "x-setup-url: https://vrozek-ai.yourname.workers.dev/webhook" \
  -d '{}'
```

### 5. Open the dashboard and configure

**https://vrozek-ai.yourname.workers.dev/dashboard**

- **Admins** — confirm/remove administrators (roles: super_admin / admin / moderator)
- **Groups** — authorize your group (ID from [@getidsbot](https://t.me/getidsbot)) and toggle per-group features (AI, welcome, goodbye, moderation, stickers, products)
- **Products** — add what the AI may recommend. The AI **never invents** products/links/prices — it only uses this database
- **Knowledge** — verified Q&A the AI may answer from
- **Stickers** — send any sticker to the bot privately to capture it, or add a `file_id`
- **Broadcast** — announce to all authorized groups (preview + confirmation)
- **Analytics / Logs** — usage, moderation actions, audit trail
- **Settings** — Gemini key/model, system prompt, personal automation toggle

---

## 🔑 Roles & access

| Role | Capabilities |
|---|---|
| super_admin | Everything: admins, groups, products, knowledge, moderation, stickers, broadcast, analytics, logs, settings, AI config |
| admin | Group/product/knowledge/moderation/broadcast management |
| moderator | View moderation/analytics/logs, limited actions |

- Private chat with the bot requires **approved access** (admins automatically, others via `users.access_approved`). Unauthorized users see one clean message.
- Every admin action (Telegram callback or dashboard API) re-verifies the role. Dashboards use HTTP Basic Auth from `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`.
- Command visibility is permission-based via `setMyCommands` scopes — normal users only ever see `/start` and `/help`; admins additionally see `/admin` in their own chat.

## 🧠 AI behavior

- **Multi-language**: auto-detects Bengali, Hindi, Urdu, Arabic, Russian, Chinese, Japanese, Korean, English and replies in the user's language.
- **Accuracy first**: never guesses facts, products, prices or links; uses VERIFIED DATA (product DB + knowledge base) when relevant, otherwise answers honestly or asks a clarifying question.
- **Identity**: always VROZEK AI, never Salman.
- **Strict no-spam groups**: replies only when mentioned (`@vrozek` or `vrozek`), replied-to, asked a direct/`/ai` question, or a product request appears. Per-chat reply cooldown prevents flooding.
- **Moderation**: adult/illegal/spam/flood/repeat detection, **high-confidence delete only**, warn instead of punish on uncertainty, full audit logging.
- **Personal Chat Automation**: *bot-side* mode (toggle in Settings) that greets newcomers with varied intro lines and funnels messages to the inbox. **Honest note:** the Telegram *Bot API cannot act inside Salman's own user account* — that requires the admin's real client (Telegram Premium applies to a full MTProto setup, outside the scope of any bot). This repo implements the bot-side assistant; Salman reviews missed messages in the inbox table.

## 🗂 Project structure

```
vrozek-ai/
├── wrangler.toml            # Workers config + D1 binding
├── migrations/001_init.sql  # full schema (users, admins, groups, settings, products, knowledge, moderation, logs, broadcasts, stickers, memory, inbox)
├── src/
│   ├── index.ts             # entry: webhook + setup + dashboard mount
│   ├── db/db.ts             # database layer + env types + settings helpers
│   ├── lib/
│   │   ├── auth.ts          # roles, authorization, bootstrap, safe compare
│   │   ├── telegram.ts      # raw Telegram Bot API client (webhook-friendly)
│   │   └── log.ts           # audit log helper
│   ├── services/
│   │   ├── ai.ts            # language detection, Gemini, product/knowledge retrieval, no-spam gate
│   │   ├── moderation.ts    # conservative moderation engine
│   │   ├── broadcast.ts     # broadcast runner + logging
│   │   ├── stickers.ts      # sticker library service
│   │   └── commands.ts      # setMyCommands scopes
│   ├── handlers/
│   │   ├── messages.ts      # router: access, commands, welcome/goodbye, moderation, AI
│   │   ├── callbacks.ts     # inline button navigation (roles re-checked)
│   │   └── commands.ts      # /start /help + clean inline menus
│   └── dashboard/index.ts   # Web Admin Dashboard (SPA + JSON API, Basic Auth)
└── scripts/setup.js         # one-shot webhook/commands/bootstrap
```

## 🔐 Security checklist

- ☑ Zero secrets in code — everything via Worker secrets env / `.env.example`
- ☑ Telegram advert authorization by user ID
- ☑ Role checks on every sensitive action (bot + dashboard)
- ☑ Webhook secret token verification (`X-Telegram-Bot-Api-Secret-Token`)
- ☑ Basic Auth dashboard, timing-safe password compare
- ☑ Input validation on all dashboard POST endpoints
- ☑ Minimal data collection: no private chat content stored except short memory + optional inbox

## Market-grade features (v1.1)

- 🛍️ In-bot **Shop**: browse products → cart → checkout → order alerts to admins (Dashboard → Orders)
- 🧩 **Newcomer CAPTCHA** verification (per-group toggle)
- ⚠️ **Warn/strike system** with auto-mute at the configured limit
- 🛡 **Admin moderation commands**: /warn /mute /kick /ban /unmute /unban (system admins)
- 🚨 **/report** — members flag messages, the team gets a private alert
- 🧠 **Persistent anti-flood & anti-repeat** (D1 `mod_state` — survives worker restarts)
- 🚫 Per-group **blocklist words**, link-post toggle, trusted-user list
- Migration for existing installs: `migrations/002_market_features.sql`
