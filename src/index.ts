/**
 * VROZEK AI — entry point.
 * Cloudflare Workers + Hono. Webhook-first (serverless friendly). Dashboard mounted at /dashboard.
 */

import { Hono } from 'hono';
import type { Env } from './db/db';
import { TgClient, type TgUpdate } from './lib/telegram';
import { bootstrap } from './lib/auth';
import { routeMessage } from './handlers/messages';
import { routeCallback } from './handlers/callbacks';
import { registerCommands } from './services/commands';
import { logEvent } from './lib/log';
import { createDashboard } from './dashboard';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) =>
  c.json({
    service: 'VROZEK AI',
    owner: 'Salman',
    website: 'https://vrozek.xyz',
    ok: true,
  })
);

/**
 * Telegram webhook. Verify secret token when configured.
 * POST /webhook  (set via /setup or scripts/setup.js)
 */
app.post('/webhook', async (c) => {
  const env = c.env;
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
    return c.text('unauthorized', 401);
  }
  let update: TgUpdate;
  try {
    update = (await c.req.json()) as TgUpdate;
  } catch {
    return c.json({ ok: false, error: 'bad json' });
  }
  const tg = new TgClient(env.TELEGRAM_BOT_TOKEN, (m) => c.executionCtx.waitUntil(logEvent(env, 'tg', m).catch(() => {})));
  try {
    if (update.message) {
      await routeMessage(tg, env, update.message);
    } else if (update.callback_query) {
      await routeCallback(tg, env, update);
    }
  } catch (e) {
    c.executionCtx.waitUntil(logEvent(env, 'error', `webhook: ${String(e)}`).catch(() => {}));
  }
  return c.json({ ok: true });
});

/**
 * One-time setup: bootstrap super admin, set webhook, register command scopes.
 * POST /setup   header: x-setup-url: https://<worker>/webhook
 */
app.post('/setup', async (c) => {
  const env = c.env;
  const url = c.req.header('x-setup-url') || '';
  const tg = new TgClient(env.TELEGRAM_BOT_TOKEN, () => {});
  await bootstrap(env);
  const results: Record<string, unknown> = { bootstrap: true };
  if (url) {
    results.webhook = await tg.setWebhook(url, env.WEBHOOK_SECRET);
  }
  results.commands = await registerCommands(tg, env);
  return c.json({ ok: true, results });
});

const dash = createDashboard();
app.route('/dashboard', dash);
app.route('/api', dash);

/**
 * Cron trigger (see [triggers] in wrangler.toml): light housekeeping.
 * Runs daily at 03:00 UTC; prunes old logs so D1 stays small.
 */
const scheduled: ExportedHandlerScheduledHandler<Env> = async (_controller, env) => {
  try {
    await env.DB.prepare("DELETE FROM logs WHERE created_at < datetime('now', '-30 days')").run();
    await env.DB.prepare("DELETE FROM moderation_logs WHERE created_at < datetime('now', '-60 days')").run();
    await env.DB.prepare("DELETE FROM broadcast_logs WHERE created_at < datetime('now', '-60 days')").run();
  } catch {
    /* housekeeping is best-effort */
  }
};

export default {
  fetch: app.fetch,
  scheduled,
};
