/**
 * VROZEK AI — message router.
 * Private chat: access control + AI assistant (+ optional personal automation proxy mode) + shop cart.
 * Groups: authorized-only, welcome/goodbye, CAPTCHA verification, moderation (persistent),
 * admin moderation commands (/warn /mute /kick /ban /unmute /unban), /report, strict no-spam AI.
 */

import type { Env } from '../db/db';
import { getSetting } from '../db/db';
import { getUserRole, isPrivateAccessApproved } from '../lib/auth';
import { displayName, esc, type TgClient, type TgMessage } from '../lib/telegram';
import { generateReply, findProducts, shouldRespondInGroup, type GateContext } from '../services/ai';
import { analyzeMessage, logModeration, addWarn, resetWarns } from '../services/moderation';
import { getSticker } from '../services/stickers';
import { logEvent } from '../lib/log';
import { startPrivate, startGroup, helpPrivate, helpGroup, accessDenied, toKeyboard, mainMenuRows } from './commands';

/* per-worker in-memory state (AI reply cooldown, broadcast drafts) */
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

/** Private-notify every system admin (super_admin + admin). */
export async function notifyAdmins(env: Env, tg: TgClient, text: string): Promise<void> {
  const admins = await env.DB.prepare('SELECT user_id FROM admins').all<{ user_id: number }>();
  for (const a of admins.results) {
    try {
      await tg.sendMessage(a.user_id, text.slice(0, 3900));
    } catch {
      /* admin chat unavailable — ignore */
    }
  }
}

async function getWarnLimit(env: Env, groupId: number): Promise<number> {
  const row = await env.DB.prepare('SELECT warn_limit FROM group_settings WHERE group_id = ?1').bind(groupId).first<{ warn_limit: number }>();
  const n = Number(row?.warn_limit);
  return n >= 1 ? n : 3;
}

export async function routeMessage(tg: TgClient, env: Env, msg: TgMessage): Promise<void> {
  if (!msg.from || msg.from.is_bot) return;
  const chat = msg.chat;
  const isGroup = chat.type === 'group' || chat.type === 'supergroup';

  /* ---------- sticker capture for admins (private) ---------- */
  if (!isGroup && msg.sticker) {
    const role = await getUserRole(env, msg.from.id);
    if (role) {
      await env.DB.prepare('INSERT INTO stickers (file_id, category, label, created_by) VALUES (?1, ?2, ?3, ?4)')
        .bind(msg.sticker.file_id, 'reaction', '', msg.from.id)
        .run();
      await tg.sendMessage(chat.id, '😄 Sticker added to the library.');
      return;
    }
  }

  /* ---------- welcome / goodbye / CAPTCHA in authorized groups ---------- */
  if (isGroup) {
    const group = await env.DB.prepare('SELECT id, enabled FROM groups WHERE id = ?1').bind(chat.id).first<{ id: number; enabled: number }>();
    if (group?.enabled) {
      const gs = await env.DB.prepare('SELECT * FROM group_settings WHERE group_id = ?1').bind(chat.id).first<{
        welcome_enabled: number; goodbye_enabled: number; welcome_text: string; goodbye_text: string;
        captcha_enabled: number;
      }>();
      const ident = await getBotIdentity(tg);

      if (msg.new_chat_members?.length) {
        for (const joined of msg.new_chat_members) {
          if (joined.is_bot && joined.id === ident.botId) continue;
          if (gs?.welcome_enabled !== 0) {
            const name = esc(displayName(joined));
            const text = gs?.welcome_text
              ? gs.welcome_text.replace('{name}', name)
              : `Welcome, ${name}! 👋 We're happy to have you here.`;
            await tg.sendMessage(chat.id, text);
          }
          // Newcomer verification: restrict until they tap the button.
          if (gs?.captcha_enabled === 1 && !joined.is_bot) {
            try {
              await tg.restrictChatMember(chat.id, joined.id, 0);
              const cm = await tg.sendMessage(
                chat.id,
                `🧩 <b>${esc(displayName(joined))}</b>, please verify you're human:`,
                {
                  reply_markup: {
                    inline_keyboard: [[{ text: '✅ I am human', callback_data: `cb_captcha:${joined.id}` }]],
                  },
                }
              );
              await env.DB.prepare(
                `INSERT INTO captcha_state (chat_id, user_id, message_id) VALUES (?1, ?2, ?3)
                 ON CONFLICT(chat_id, user_id) DO UPDATE SET message_id = ?3`
              )
                .bind(chat.id, joined.id, cm?.message_id || 0)
                .run();
            } catch {
              await logEvent(env, 'error', `captcha restrict failed for ${joined.id} in ${chat.id}`);
            }
          }
        }
      }
      if (msg.left_chat_member && !msg.left_chat_member.is_bot) {
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

  const text = (msg.text || '').trim();

  /* ---------- moderation in authorized groups (persistent state) ---------- */
  if (isGroup) {
    const groupRow = await env.DB.prepare('SELECT enabled FROM groups WHERE id = ?1').bind(chat.id).first<{ enabled: number }>();
    if (groupRow?.enabled && text) {
      const gs = await env.DB.prepare(
        'SELECT moderation_enabled, link_enabled, block_words, trusted, warn_limit FROM group_settings WHERE group_id = ?1'
      )
        .bind(chat.id)
        .first<{
          moderation_enabled: number; link_enabled: number; block_words: string; trusted: string; warn_limit: number;
        }>();
      if (gs && gs.moderation_enabled !== 0) {
        const isAdmin = !!(await getUserRole(env, msg.from.id));
        const trusted = isAdmin || gs.trusted.split(',').map((s) => s.trim()).filter(Boolean).some((s) => Number(s) === msg.from!.id);
        const res = await analyzeMessage(env, text, chat.id, msg.from.id, {
          blockWords: gs.block_words.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
          linkEnabled: gs.link_enabled !== 0,
          trusted,
        });
        if (res.action === 'delete' || res.action === 'mute') {
          await tg.deleteMessage(chat.id, msg.message_id);
          await logModeration(env, {
            groupId: chat.id, userId: msg.from.id, userName: displayName(msg.from),
            action: res.action === 'mute' ? 'mute' : 'delete', category: res.category, confidence: res.confidence,
          });
          if (res.action === 'mute') {
            await tg.restrictChatMember(chat.id, msg.from.id, 3600);
            await tg.sendMessage(chat.id, `🔇 <b>${esc(displayName(msg.from))}</b> muted for flooding.`);
          } else {
            // escálate: strikes accumulate; at the limit the user is muted and strikes reset.
            const limit = Number(gs.warn_limit) >= 1 ? Number(gs.warn_limit) : 3;
            if (!isAdmin) {
              const strikes = await addWarn(env, chat.id, msg.from.id);
              if (strikes >= limit) {
                await tg.restrictChatMember(chat.id, msg.from.id, 3600);
                await resetWarns(env, chat.id, msg.from.id);
                await tg.sendMessage(
                  chat.id,
                  `⚠️ <b>${esc(displayName(msg.from))}</b> reached ${limit} strikes — muted for 1 hour.`
                );
              } else {
                await tg.sendMessage(
                  chat.id,
                  `⚠️ Removed a message (${res.category}). ${esc(displayName(msg.from))} — strike ${strikes}/${limit}.`
                );
              }
            } else {
              await tg.sendMessage(chat.id, `⚠️ Removed a message (${res.category}).`);
            }
          }
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
  }

  /* ---------- commands ---------- */
  if (text.startsWith('/')) {
    const cmd = text.split(/\s/)[0].split('@')[0];

    // Group admin moderation commands (system roles only for now).
    if (['/warn', '/mute', '/kick', '/ban', '/unmute', '/unban'].includes(cmd)) {
      if (!isGroup) return;
      const role = await getUserRole(env, msg.from.id);
      if (!role) return;
      const target = msg.reply_to_message?.from;
      if (!target || target.is_bot) {
        await tg.sendMessage(chat.id, `Usage: reply to a user's message with <code>${cmd}</code>.`);
        return;
      }
      const chatId = chat.id;
      const tName = esc(displayName(target));
      if (cmd === '/warn') {
        const limit = await getWarnLimit(env, chatId);
        const strikes = await addWarn(env, chatId, target.id);
        await logModeration(env, { groupId: chatId, userId: target.id, userName: displayName(target), action: 'warn', category: 'admin', confidence: 1 });
        if (strikes >= limit) {
          await tg.restrictChatMember(chatId, target.id, 3600);
          await resetWarns(env, chatId, target.id);
          await tg.sendMessage(chatId, `⚠️ <b>${tName}</b> reached ${limit} strikes — muted for 1 hour.`);
        } else {
          await tg.sendMessage(chatId, `⚠️ <b>${tName}</b> warned (${strikes}/${limit}).`);
        }
      } else if (cmd === '/mute') {
        await tg.restrictChatMember(chatId, target.id, 3600);
        await logModeration(env, { groupId: chatId, userId: target.id, userName: displayName(target), action: 'mute', category: 'admin', confidence: 1 });
        await tg.sendMessage(chatId, `🔇 <b>${tName}</b> muted for 1 hour.`);
      } else if (cmd === '/kick') {
        await tg.call('kickChatMember', { chat_id: chatId, user_id: target.id });
        await logModeration(env, { groupId: chatId, userId: target.id, userName: displayName(target), action: 'kick', category: 'admin', confidence: 1 });
        await tg.sendMessage(chatId, `👢 <b>${tName}</b> kicked.`);
      } else if (cmd === '/ban') {
        await tg.call('banChatMember', { chat_id: chatId, user_id: target.id });
        await logModeration(env, { groupId: chatId, userId: target.id, userName: displayName(target), action: 'ban', category: 'admin', confidence: 1 });
        await tg.sendMessage(chatId, `🚫 <b>${tName}</b> banned.`);
      } else if (cmd === '/unmute') {
        await tg.unrestrictChatMember(chatId, target.id);
        await tg.sendMessage(chatId, `✅ <b>${tName}</b> unmuted.`);
      } else if (cmd === '/unban') {
        await tg.call('unbanChatMember', { chat_id: chatId, user_id: target.id });
        await tg.sendMessage(chatId, `✅ <b>${tName}</b> unbanned.`);
      }
      return;
    }

    if (cmd === '/report') {
      if (!isGroup) return;
      const target = msg.reply_to_message;
      if (!target?.from) {
        await tg.sendMessage(chat.id, 'Reply to a message with /report to flag it to the team.');
        return;
      }
      await logEvent(env, 'report', `Report in ${chat.id} by ${msg.from.id} against ${target.from.id}`);
      const txt = target.text ? esc(target.text.slice(0, 300)) : '(non-text message)';
      await notifyAdmins(
        env,
        tg,
        `🚨 <b>Report</b>\nGroup: ${esc(chat.title || '')}\nReported by: ${esc(displayName(msg.from))}\nTarget: ${esc(displayName(target.from))}\nMessage: ${txt}`
      );
      await tg.sendMessage(chat.id, '📨 Thanks — the report was sent to the team.');
      return;
    }

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
        await tg.sendMessage(chat.id, '⚙️ <b>Admin Panel</b>', { reply_markup: toKeyboard(adminKeyboard()) });
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

  const products = /product|buy|price|কিন|দাম|order|cart/i.test(text) ? await findProducts(env, text, 3) : [];
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

function adminKeyboard() {
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
    `INSERT INTO chat_memory (chat_id, last_exchange) VALUES (?1, ?2)
     ON CONFLICT(chat_id) DO UPDATE SET last_exchange = ?2, updated_at = datetime('now')`
  )
    .bind(chatId, value)
    .run();
}
