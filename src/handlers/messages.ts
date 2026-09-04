/**
 * VROZEK AI — message router.
 * Private chat: access control + AI assistant (+ optional personal automation proxy mode).
 * Groups: authorized-only, welcome/goodbye, moderation, strict no-spam AI gating, product help.
 */

import type { Env } from '../db/db';
import { getSetting } from '../db/db';
import { getUserRole, isPrivateAccessApproved } from '../lib/auth';
import { displayName, esc, type TgClient, type TgMessage } from '../lib/telegram';
import { generateReply, findProducts, shouldRespondInGroup, type GateContext } from '../services/ai';
import { analyzeMessage, logModeration } from '../services/moderation';
import { getSticker } from '../services/stickers';
import { startPrivate, startGroup, helpPrivate, helpGroup, accessDenied, toKeyboard, mainMenuRows } from './commands';

/* per-worker in-memory state (chat cooldown, broadcast drafts) */
const cooldown = new Map<number, number>();
interface Draft {
  stage: string;
  text?: string;
  groupId?: number;
}
export const broadcastDrafts = new Map<number, Draft>();

let botIdentity: GateContext | null = null;

async function getBotIdentity(tg: TgClient): Promise<GateContext> {
  if (botIdentity) return botIdentity;
  const me = await tg.getMe();
  botIdentity = { botId: me?.id || 0, botUsername: me?.username || '' };
  return botIdentity;
}

function allowedToReply(chatId: number, isGroup: boolean): boolean {
  const now = Date.now();
  if (isGroup) {
    // groups: at most one AI reply per 6 seconds per chat
    const last = cooldown.get(chatId) || 0;
    if (now - last < 6000) return false;
    cooldown.set(chatId, now);
    return true;
  }
  const last = cooldown.get(chatId) || 0;
  if (now - last < 1200) return false;
  cooldown.set(chatId, now);
  return true;
}

export async function routeMessage(tg: TgClient, env: Env, msg: TgMessage): Promise<void> {
  if (!msg.from || msg.from.is_bot) return;
  const chat = msg.chat;
  const isGroup = chat.type === 'group' || chat.type === 'supergroup';

  /* ---------- sticker capture for admins (private) ---------- */
  if (!isGroup && msg.sticker) {
    const role = await getUserRole(env, msg.from.id);
    if (role) {
      await env.DB.prepare(
        'INSERT INTO stickers (file_id, category, label, created_by) VALUES (?1, ?2, ?3, ?4)'
      )
        .bind(msg.sticker.file_id, msg.sticker.emoji ? 'reaction' : 'reaction', '', msg.from.id)
        .run();
      await tg.sendMessage(chat.id, '😄 Sticker added to the library.');
      return;
    }
  }

  /* ---------- welcome / goodbye in authorized groups ---------- */
  if (isGroup) {
    const group = await env.DB.prepare('SELECT id, enabled FROM groups WHERE id = ?1').bind(chat.id).first<{ id: number; enabled: number }>();
    if (group?.enabled) {
      const gs = await env.DB.prepare('SELECT * FROM group_settings WHERE group_id = ?1').bind(chat.id).first<{
        welcome_enabled: number; goodbye_enabled: number; welcome_text: string; goodbye_text: string;
      }>();
      if (msg.new_chat_members?.some((m) => m.id === botIdentity?.botId || true)) {
        const joined = msg.new_chat_members?.[0];
        if (gs?.welcome_enabled !== 0) {
          const custom = gs?.welcome_text;
          const name = esc(displayName(joined));
          const text = custom
            ? custom.replace('{name}', name)
            : `Welcome, ${name}! 👋 We're happy to have you here.`;
          await tg.sendMessage(chat.id, text);
        }
      }
      if (msg.left_chat_member) {
        if (gs?.goodbye_enabled !== 0) {
          const name = esc(displayName(msg.left_chat_member));
          const words = [
            `${name} has left the group. Take care! 👋`,
            `Goodbye, ${name}. We'll miss you! 👋`,
          ];
          const custom = gs?.goodbye_text;
          const text = custom ? custom.replace('{name}', name) : words[Math.floor(Math.random() * words.length)];
          await tg.sendMessage(chat.id, text);
        }
      }
    }
  }

  /* ---------- moderation in authorized groups ---------- */
  if (isGroup) {
    const settings = await env.DB.prepare('SELECT moderation_enabled FROM group_settings WHERE group_id = ?1').bind(chat.id).first<{ moderation_enabled: number }>();
    const groupRow = await env.DB.prepare('SELECT enabled FROM groups WHERE id = ?1').bind(chat.id).first<{ enabled: number }>();
    if (groupRow?.enabled && settings?.moderation_enabled !== 0 && msg.text) {
      const res = analyzeMessage(msg.text, chat.id, msg.from.id);
      if (res.action === 'delete') {
        await tg.deleteMessage(chat.id, msg.message_id);
        await logModeration(env, {
          groupId: chat.id, userId: msg.from.id, userName: displayName(msg.from),
          action: 'delete', category: res.category, confidence: res.confidence,
        });
        await tg.sendMessage(chat.id, `⚠️ Removed a message (${res.category}).`, { reply_to_message_id: msg.message_id });
        return;
      }
      if (res.action === 'warn') {
        await logModeration(env, {
          groupId: chat.id, userId: msg.from.id, userName: displayName(msg.from),
          action: 'warn', category: res.category, confidence: res.confidence,
        });
      }
    }
  }

  /* ---------- commands ---------- */
  const text = (msg.text || '').trim();
  if (text.startsWith('/')) {
    const cmd = text.split(/\s/)[0].split('@')[0];
    if (cmd === '/start' || cmd === '/ai') {
      if (isGroup) {
        const groupRow = await env.DB.prepare('SELECT enabled FROM groups WHERE id = ?1').bind(chat.id).first<{ enabled: number }>();
        if (groupRow?.enabled) await startGroup(tg, env, msg);
      } else if (await isPrivateAccessApproved(env, msg.from.id)) {
        await startPrivate(tg, env, msg);
      } else {
        await accessDenied(tg, env, msg);
      }
      return;
    }
    if (cmd === '/help') {
      if (isGroup) {
        const groupRow = await env.DB.prepare('SELECT enabled FROM groups WHERE id = ?1').bind(chat.id).first<{ enabled: number }>();
        if (groupRow?.enabled) await helpGroup(tg, env, msg);
      } else if (await isPrivateAccessApproved(env, msg.from.id)) {
        await helpPrivate(tg, env, msg);
      }
      return;
    }
    if (cmd === '/admin') {
      if (isGroup) return;
      const role = await getUserRole(env, msg.from.id);
      if (role) {
        await tg.sendMessage(chat.id, '⚙️ <b>Admin Panel</b>', {
          reply_markup: toKeyboard(adminKeyboard(role)),
        });
      }
      return;
    }
    return;
  }

  /* ---------- private chat: access + AI assistant ---------- */
  if (!isGroup) {
    const approved = await isPrivateAccessApproved(env, msg.from.id);
    if (!approved) {
      await accessDenied(tg, env, msg);
      return;
    }

    // personal automation proxy mode (bot-side; see README for Salman's real-account option)
    const autoMode = (await getSetting(env, 'personal_automation')) === 'on';

    // broadcast draft flow (admin)
    const draft = broadcastDrafts.get(msg.from.id);
    if (draft?.stage === 'await_broadcast_text') {
      draft.stage = 'confirm';
      draft.text = text;
      await tg.sendMessage(
        chat.id,
        `📢 <b>Broadcast preview</b>\n\n${esc(text).slice(0, 900)}\n\nSend to all authorized groups?`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Confirm', callback_data: 'cb_bc_confirm_all' },
                { text: '❌ Cancel', callback_data: 'cb_bc_cancel' },
              ],
            ],
          },
        }
      );
      return;
    }

    if (!text) return;
    if (!allowedToReply(chat.id, false)) return;

    const memory = await getMemory(env, chat.id);
    const reply = await generateReply(env, {
      text,
      chatType: 'private',
      userName: displayName(msg.from),
      includeProducts: true,
      memory,
    });

    if (reply) {
      await tg.sendMessage(chat.id, reply.slice(0, 4000));
      await setMemory(env, chat.id, `user: ${text.slice(0, 300)} / bot: ${reply.slice(0, 200)}`);
      // soft sticker: 6% chance, only in auto mode or when relevant
      if (autoMode && Math.random() < 0.06) {
        const s = await getSticker(env, 'reaction');
        if (s) await tg.sendSticker(chat.id, s);
      }
    } else {
      await tg.sendMessage(
        chat.id,
        'I couldn\'t answer that one.\nPlease tell the administrator or check the dashboard settings (AI may be unconfigured).'
      );
    }
    return;
  }

  /* ---------- group chat: strict no-spam AI ---------- */
  const groupRow = await env.DB.prepare('SELECT enabled FROM groups WHERE id = ?1').bind(chat.id).first<{ enabled: number }>();
  if (!groupRow?.enabled) return;
  const gs = await env.DB.prepare('SELECT ai_enabled FROM group_settings WHERE group_id = ?1').bind(chat.id).first<{ ai_enabled: number }>();
  if (gs?.ai_enabled === 0) return;
  if (!text) return;

  const ident = await getBotIdentity(tg);
  if (!shouldRespondInGroup(msg, ident)) return;
  if (!allowedToReply(chat.id, true)) return;

  const products = text && /product|buy|price|কিন|দাম/i.test(text) ? await findProducts(env, text, 3) : [];
  if (products.length) {
    const lines = products.map((p, i) => {
      let l = `${i + 1}. <b>${esc(p.name)}</b>`;
      if (p.price) l += ` — ${esc(p.price)}`;
      if (p.description) l += `\n   ${esc(p.description)}`;
      if (p.link) l += `\n   🔗 ${p.link}`;
      return l;
    });
    await tg.sendMessage(chat.id, `📦 Here's what I found:\n\n${lines.join('\n\n')}`, { reply_to_message_id: msg.message_id });
    return;
  }

  const reply = await generateReply(env, {
    text,
    chatType: 'group',
    userName: displayName(msg.from),
    groupTitle: chat.title,
    includeProducts: false,
  });
  if (reply) {
    await tg.sendMessage(chat.id, reply.slice(0, 2000), { reply_to_message_id: msg.message_id });
  }
}

function adminKeyboard(role: string) {
  return [
    [
      { text: '👥 Groups', callback_data: 'cb_admin_groups' },
      { text: '📦 Products', callback_data: 'cb_admin_products' },
    ],
    [
      { text: '🧠 Knowledge', callback_data: 'cb_admin_kb' },
      { text: '🛡️ Moderation', callback_data: 'cb_admin_moderation' },
    ],
    [
      { text: '😄 Stickers', callback_data: 'cb_admin_stickers' },
      { text: '📢 Broadcast', callback_data: 'cb_admin_broadcast' },
    ],
    [
      { text: '📊 Analytics', callback_data: 'cb_admin_analytics' },
      { text: '📜 Logs', callback_data: 'cb_admin_logs' },
    ],
    [
      { text: '⚙️ Settings', callback_data: 'cb_admin_settings' },
      { text: '‹ Back', callback_data: 'cb_home' },
    ],
  ];
}

async function getMemory(env: Env, chatId: number): Promise<string> {
  const row = await env.DB.prepare('SELECT last_exchange FROM chat_memory WHERE chat_id = ?1').bind(chatId).first<{ last_exchange: string }>();
  return row?.last_exchange?.slice(0, 500) || '';
}

async function setMemory(env: Env, chatId: number, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO chat_memory (chat_id, last_exchange) VALUES (?1, ?2) ON CONFLICT(chat_id) DO UPDATE SET last_exchange = ?2, updated_at = datetime(\'now\')'
  )
    .bind(chatId, value)
    .run();
}
