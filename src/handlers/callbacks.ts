/**
 * VROZEK AI — inline button (callback) navigation.
 * Every admin callback re-verifies the role. No admin action without authorization.
 * Includes: newcomer CAPTCHA verification, website store deep-links,
 * and the full admin menu (groups, products, knowledge, moderation, stickers,
 * broadcast, analytics, logs, settings).
 */

import type { Env } from '../db/db';
import { getSetting } from '../db/db';
import { getUserRole } from '../lib/auth';
import type { TgClient, TgUpdate } from '../lib/telegram';
import { displayName, esc } from '../lib/telegram';
import { mainMenuRows, adminMenuRows, toKeyboard } from './commands';
import { broadcastDrafts, groupLang } from './messages';
import { runBroadcast } from '../services/broadcast';
import { t } from '../lib/i18n';
import { getAllCatalog } from '../services/catalog';
import { logEvent } from '../lib/log';

const ADMIN_CBS = [
  'cb_admin', 'cb_admin_groups', 'cb_admin_products', 'cb_admin_kb',
  'cb_admin_moderation', 'cb_admin_stickers', 'cb_admin_broadcast', 'cb_admin_analytics',
  'cb_admin_logs', 'cb_admin_settings', 'cb_bc_confirm_all', 'cb_bc_cancel',
];

export async function routeCallback(tg: TgClient, env: Env, update: TgUpdate): Promise<void> {
  const cb = update.callback_query;
  if (!cb || !cb.message) return;
  const user = cb.from;
  const data: string = cb.data || '';
  const { chat, message_id } = cb.message;

  const role = await getUserRole(env, user.id);
  if (ADMIN_CBS.includes(data) && !role) {
    await tg.answerCallback(cb.id, 'Access denied. Admins only.', { show_alert: true });
    return;
  }

  const website = (await getSetting(env, 'website_url')) || env.WEBSITE_URL || 'https://vrozek.xyz';

  const edit = (text: string, rowBuilder: (isAdmin: boolean, websiteUrl: string) => any) => {
    return tg.editMessageText(chat.id, message_id, text, {
      reply_markup: toKeyboard(rowBuilder(!!role, website)),
    });
  };

  /* ------------------------------------------------ CAPTCHA ------------------------------------------------ */
  if (data.startsWith('cb_captcha:')) {
    const uid = Number(data.split(':')[1]);
    if (uid !== user.id) {
      await tg.answerCallback(cb.id, 'This button is for the new member only.');
      return;
    }
    await env.DB.prepare('DELETE FROM captcha_state WHERE chat_id = ?1 AND user_id = ?2').bind(chat.id, user.id).run();
    await tg.unrestrictChatMember(chat.id, user.id);
    await tg.editMessageText(chat.id, message_id, t(await groupLang(env, chat.id), 'verified', { name: esc(displayName(user)) }));
    await tg.answerCallback(cb.id, 'Verified ✓');
    await logEvent(env, 'moderation', `Captcha passed: ${user.id} in ${chat.id}`);
    return;
  }

  /* ------------------------------------------------ main menu ------------------------------------------------ */
  switch (data) {
    case 'cb_home': {
      await edit(
        `${'━━━━━━━━━━━━━━━━━━'}\n\n🤖 <b>VROZEK AI</b>\nSmart System Assistant\n\n${'━━━━━━━━━━━━━━━━━━'}\n\nYour intelligent VROZEK system assistant.`,
        mainMenuRows
      );
      break;
    }
    case 'cb_ai': {
      await edit(
        `🤖 <b>AI Assistant</b>\n\nI'm <b>VROZEK AI</b>, Salman's intelligent assistant.\n\nAsk me anything in your own language — I'll reply in the same language.\n\nExamples:\n• "What products do you have?"\n• "Tell me about VROZEK"\n• Ask about a service or product.`,
        mainMenuRows
      );
      break;
    }
    case 'cb_products': {
      const rows = await env.DB.prepare('SELECT * FROM products WHERE active = 1 ORDER BY id DESC LIMIT 20').all<{ name: string; price: string; link: string; description: string }>();
      let text = '📦 <b>Products</b>\n\n';
      if (!rows.results.length) text += 'No products available yet.';
      else {
        rows.results.forEach((p, i) => {
          text += `${i + 1}. <b>${esc(p.name)}</b>`;
          if (p.price) text += ` — ${esc(p.price)}`;
          if (p.description) text += `\n   ${esc(p.description)}`;
          if (p.link) text += `\n   🔗 <a href="${p.link}">${p.link}</a>`;
          text += '\n';
        });
      }
      text += `\n\nOrder on the website: <a href="${website}">${website}</a>`;
      await edit(text, mainMenuRows);
      break;
    }
    case 'cb_groups': {
      const rows = await env.DB.prepare('SELECT id, title FROM groups WHERE enabled = 1').all<{ id: number; title: string }>();
      let text = '👥 <b>Authorized Groups</b>\n\n';
      if (!rows.results.length) text += 'No authorized groups yet.';
      else rows.results.forEach((g, i) => (text += `${i + 1}. ${esc(g.title || `Group ${g.id}`)}\n`));
      await edit(text, mainMenuRows);
      break;
    }
    case 'cb_about': {
      await edit(
        `ℹ️ <b>About</b>\n\n<b>VROZEK AI</b> is Salman's intelligent assistant system — a premium Telegram ecosystem built with AI, products, knowledge, smart moderation and a shop.\n\n🌐 Website: https://vrozek.xyz`,
        mainMenuRows
      );
      break;
    }
    case 'cb_help': {
      const lines = [
        '❓ <b>Help</b>',
        '',
        '🤖 <b>AI Assistant</b> — chat in any language.',
        '🌐 <b>Website</b> — visit the online store and order there.',
        '📦 <b>Products</b> — browse available products.',
        '👥 <b>Groups</b> — see authorized groups.',
        'ℹ️ <b>About</b> — about VROZEK AI.',
        '🌐 <b>Website</b> — vrozek.xyz',
        '',
        'In groups: mention me, /report a message, admins can /warn /mute /kick /ban.',
        '',
        'Commands: /start  /help',
      ];
      if (role) lines.push('', '⚙️ <b>Admin Panel</b> — manage the system.');
      await edit(lines.join('\n'), mainMenuRows);
      break;
    }
    case 'cb_admin': {
      await edit(
        '⚙️ <b>Admin Panel</b>\nManage the VROZEK system.\n\nFull control is available on the Web Dashboard:\n<code>{worker-url}/dashboard</code>',
        adminMenuRows
      );
      break;
    }
    case 'cb_admin_groups': {
      const rows = await env.DB.prepare('SELECT id, title, enabled FROM groups').all<{ id: number; title: string; enabled: number }>();
      let text = '👥 <b>Authorized Groups</b>\n\n';
      if (!rows.results.length) text += 'No groups authorized yet.\n\nAdd groups in the Web Dashboard.';
      else
        rows.results.forEach((g, i) => {
          text += `${i + 1}. ${esc(g.title || `Group ${g.id}`)} — ${g.enabled ? '✅ active' : '⛔ disabled'}\n`;
        });
      text += '\nManage groups on the Web Dashboard.';
      await edit(text, adminMenuRows);
      break;
    }
    case 'cb_admin_products': {
      const c = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(active) AS a FROM products').first<{ n: number; a: number }>();
      await edit(
        `📦 <b>Products</b>\n\nTotal: <b>${c?.n || 0}</b> · Active: <b>${c?.a || 0}</b>\n\nAdd, edit and manage products in the Web Dashboard → Products.`,
        adminMenuRows
      );
      break;
    }
    case 'cb_admin_kb': {
      const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM knowledge').first<{ n: number }>();
      await edit(
        `🧠 <b>Knowledge Base</b>\n\nEntries: <b>${c?.n || 0}</b>\n\nManage questions, answers and services in the Web Dashboard → Knowledge Base.`,
        adminMenuRows
      );
      break;
    }
    case 'cb_admin_moderation': {
      const rows = await env.DB.prepare('SELECT id, title FROM groups').all<{ id: number; title: string }>();
      const warns = await env.DB.prepare('SELECT COUNT(*) AS n FROM warns').first<{ n: number }>();
      let text = '🛡️ <b>Moderation</b>\n\nConfigured per group:\n';
      if (!rows.results.length) text += '\nNo authorized groups yet.';
      else rows.results.forEach((g) => (text += `\n• ${esc(g.title || `Group ${g.id}`)}`));
      text += `\n\nActive strikes: <b>${warns?.n || 0}</b>\n\nFine-tune each group (AI / welcome / moderation / CAPTCHA / blocklist) in the Web Dashboard → Groups.`;
      await edit(text, adminMenuRows);
      break;
    }
    case 'cb_admin_stickers': {
      const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM stickers').first<{ n: number }>();
      await edit(
        `😄 <b>Stickers</b>\n\nLibrary: <b>${c?.n || 0}</b> stickers\n\nTo add a sticker: send it to this bot privately — it is captured automatically.\nOr manage in the Web Dashboard → Stickers.`,
        adminMenuRows
      );
      break;
    }
    case 'cb_admin_broadcast': {
      broadcastDrafts.set(user.id, { stage: 'await_broadcast_text' });
      await edit(`📢 <b>Broadcast</b>\n\nSend me the message you want to broadcast.\n(You will confirm before it is sent to all authorized groups.)`, adminMenuRows);
      break;
    }
    case 'cb_bc_cancel': {
      broadcastDrafts.delete(user.id);
      await tg.answerCallback(cb.id, 'Broadcast cancelled.');
      await edit('📢 <b>Broadcast</b>\n\nCancelled.', adminMenuRows);
      break;
    }
    case 'cb_bc_confirm_all': {
      const draft = broadcastDrafts.get(user.id);
      broadcastDrafts.delete(user.id);
      if (!draft?.text) {
        await tg.answerCallback(cb.id, 'No draft found.');
        break;
      }
      const res = await runBroadcast(env, tg, draft.text, undefined, user.id);
      await tg.answerCallback(cb.id, `Sent to ${res.success}/${res.total} groups.`);
      await logEvent(env, 'broadcast', `Broadcast by ${user.id}: ${res.success}/${res.total} OK`);
      await tg.sendMessage(chat.id, `📢 <b>Broadcast complete</b>\n\n✅ Sent: ${res.success}\n❌ Failed: ${res.failed}\nTotal: ${res.total}`);
      await edit('📢 <b>Broadcast</b>\n\nDone. Send a new broadcast any time.', adminMenuRows);
      break;
    }
    case 'cb_admin_analytics': {
      const u = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
      const g = await env.DB.prepare('SELECT COUNT(*) AS n FROM groups').first<{ n: number }>();
      const p = await env.DB.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').first<{ n: number }>();
      const k = await env.DB.prepare('SELECT COUNT(*) AS n FROM knowledge').first<{ n: number }>();
      const m = await env.DB.prepare('SELECT COUNT(*) AS n FROM moderation_logs').first<{ n: number }>();
      const tpl = await getAllCatalog().length;
      await edit(
        `📊 <b>Analytics</b>\n\n👤 Users: <b>${u?.n || 0}</b>\n👥 Groups: <b>${g?.n || 0}</b>\n📦 Catalog items: <b>${tpl}</b>\n🧠 Knowledge entries: <b>${k?.n || 0}</b>\n🛡️ Moderation actions: <b>${m?.n || 0}</b>\n\nFull analytics on the Web Dashboard.`,
        adminMenuRows
      );
      break;
    }
    case 'cb_admin_logs': {
      const rows = await env.DB.prepare('SELECT type, message, created_at FROM logs ORDER BY id DESC LIMIT 8').all<{ type: string; message: string; created_at: string }>();
      let text = '📜 <b>Recent Logs</b>\n\n';
      if (!rows.results.length) text += 'No logs yet.';
      else
        rows.results.forEach((l) => {
          text += `• [${l.created_at || '?'}] ${esc(l.type)}: ${esc(String(l.message).slice(0, 80))}\n`;
        });
      text += '\nFull logs on the Web Dashboard.';
      await edit(text, adminMenuRows);
      break;
    }
    case 'cb_admin_settings': {
      const model = (await getSetting(env, 'gemini_model')) || env.GEMINI_MODEL || 'gemini-3.5-flash';
      const keySet = !!((await getSetting(env, 'gemini_api_key')) || env.GEMINI_API_KEY);
      const auto = (await getSetting(env, 'personal_automation')) === 'on';
      await edit(
        `⚙️ <b>Settings</b>\n\n🤖 AI model: <code>${esc(model)}</code>\n🔑 Gemini key: ${keySet ? '✅ set' : '❌ not set'}\n🤖 Personal automation: ${auto ? 'on' : 'off'}\n\nConfigure everything on the Web Dashboard → Settings.`,
        adminMenuRows
      );
      break;
    }
    default: {
      await tg.answerCallback(cb.id, 'Unknown action.');
    }
  }
}
