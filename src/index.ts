/**
 * VROZEK AI — entry point.
 * Cloudflare Workers + Hono. Webhook-first (serverless friendly). Dashboard mounted at /dashboard.
 */

import { Hono } from 'hono';
import type { Env } from './db/db';
import { esc, TgClient, type TgUpdate } from './lib/telegram';
import { bootstrap } from './lib/auth';
import { routeMessage, notifyAdmins } from './handlers/messages';
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
 * Website order webhook — your store calls this with every new order.
 * POST /webhook/order   header: X-Order-Secret: <ORDER_WEBHOOK_SECRET> (falls back to WEBHOOK_SECRET)
 * Payload (JSON): { order_id, customer: { name, phone?, telegram_id? }, items: [{name, price, qty}],
 *                   total?, currency?, note?, source? }
 * → stored in site_orders + Telegram alert to every admin.
 */
app.post('/webhook/order', async (c) => {
  const env = c.env;
  const header = c.req.header('X-Order-Secret') || c.req.header('X-Telegram-Bot-Api-Secret-Token');
  const expected = env.ORDER_WEBHOOK_SECRET || env.WEBHOOK_SECRET;
  if (expected && header !== expected) return c.text('unauthorized', 401);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'bad json' }, 400);
  }
  const orderId = String(body?.order_id ?? body?.id ?? '').slice(0, 100);
  if (!orderId) return c.json({ ok: false, error: 'order_id required' }, 400);
  const customer = body?.customer || {};
  const custName = String(customer?.name ?? customer?.customer_name ?? 'Customer').slice(0, 200);
  let items: any[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length && typeof body?.items === 'string') {
    try {
      items = JSON.parse(body.items);
    } catch {
      items = [];
    }
  }
  items = items.slice(0, 50);
  const total = body?.total != null ? String(body.total) : '';
  const currency = String(body?.currency ?? '').slice(0, 10);
  const note = String(body?.note ?? '').slice(0, 300);
  const tgLink = customer?.telegram_id
    ? `\nTelegram: <a href="tg://user?id=${Number(customer.telegram_id)}">open chat</a>`
    : '';
  const lines = [
    `🛍️ <b>New order</b>${body?.source ? ` (${esc(String(body.source))})` : ''} #${orderId}`,
    `👤 ${esc(custName)}${customer?.phone ? ` · ${esc(String(customer.phone))}` : ''}${tgLink}`,
  ];
  if (items.length) {
    lines.push(
      '',
      ...items.map((it) => `• ${esc(String(it?.name ?? 'item'))}${it?.qty ? ` ×${it.qty}` : ''}${it?.price != null ? ` — ${it.price}` : ''}`)
    );
  }
  if (total) lines.push('', `💰 Total: ${esc(total)}${currency ? ` ${esc(currency)}` : ''}`);
  if (note) lines.push('', `📝 ${esc(note)}`);
  await env.DB.prepare('INSERT INTO site_orders (order_id, customer, payload, source) VALUES (?1, ?2, ?3, ?4)')
    .bind(orderId, custName, JSON.stringify(body).slice(0, 2000), String(body?.source ?? 'website'))
    .run();
  const tg = new TgClient(env.TELEGRAM_BOT_TOKEN);
  await notifyAdmins(env, tg, lines.join('\n').slice(0, 3900));
  c.executionCtx.waitUntil(logEvent(env, 'order', `Webhook order #${orderId} from ${custName}`).catch(() => {}));
  return c.json({ ok: true, received: true });
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
