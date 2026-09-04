/**
 * VROZEK AI — /start and /help handlers + clean inline navigation menus.
 */

import type { Env } from '../db/db';
import { getUserRole } from '../lib/auth';
import { displayName, esc, type TgClient, type TgMessage } from '../lib/telegram';

const SEP = '━━━━━━━━━━━━━━━━━━';

export interface MenuRow {
  text: string;
  callback_data?: string;
  url?: string;
}

export function mainMenuRows(isAdmin: boolean, websiteUrl = 'https://vrozek.xyz'): MenuRow[][] {
  const rows: MenuRow[][] = [
    [
      { text: '🤖 AI Assistant', callback_data: 'cb_ai' },
      { text: '📦 Products', callback_data: 'cb_products' },
    ],
    [
      { text: '👥 Groups', callback_data: 'cb_groups' },
      { text: 'ℹ️ About', callback_data: 'cb_about' },
    ],
    [
      { text: '🌐 Website', url: websiteUrl },
      { text: '❓ Help', callback_data: 'cb_help' },
    ],
  ];
  if (isAdmin) {
    rows.push([{ text: '⚙️ Admin Panel', callback_data: 'cb_admin' }]);
  }
  return rows;
}

export function toKeyboard(rows: MenuRow[][]): { inline_keyboard: MenuRow[][] } {
  return { inline_keyboard: rows };
}

export function adminMenuRows(): MenuRow[][] {
  return [
    [
      { text: '👥 Groups', callback_data: 'cb_admin_groups' },
      { text: '📦 Products', callback_data: 'cb_admin_products' },
    ],
    [
      { text: '🧠 Knowledge Base', callback_data: 'cb_admin_kb' },
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

export async function startPrivate(tg: TgClient, env: Env, msg: TgMessage): Promise<void> {
  const user = msg.from!;
  const role = await getUserRole(env, user.id);
  const title = `${SEP}\n\n🤖 <b>VROZEK AI</b>\nSmart System Assistant\n\n${SEP}\n\n👤 User: ${esc(displayName(user))}\n🆔 ID: <code>${user.id}</code>\n\nYour intelligent VROZEK system assistant.`;
  await tg.sendMessage(msg.chat.id, title, { reply_markup: toKeyboard(mainMenuRows(!!role)) });
}

export async function startGroup(tg: TgClient, env: Env, msg: TgMessage): Promise<void> {
  await tg.sendMessage(
    msg.chat.id,
    `👋 Hello! I'm <b>VROZEK AI</b>.\nMention me, reply to me, or ask me directly and I'll help — quietly.`,
    { reply_to_message_id: msg.message_id }
  );
}

export async function helpPrivate(tg: TgClient, env: Env, msg: TgMessage): Promise<void> {
  const user = msg.from!;
  const role = await getUserRole(env, user.id);
  const lines = [
    `${SEP}`,
    '❓ <b>Help</b>',
    `${SEP}`,
    '🤖 <b>AI Assistant</b> — chat with the AI in any language.',
    '📦 <b>Products</b> — browse available products.',
    '👥 <b>Groups</b> — see connected groups.',
    'ℹ️ <b>About</b> — about VROZEK AI.',
    '🌐 <b>Website</b> — vrozek.xyz',
  ];
  if (role) {
    lines.push('', '⚙️ <b>Admin Panel</b> — manage the system (admins only).');
  }
  lines.push('', 'Commands: /start /help /products');
  await tg.sendMessage(msg.chat.id, lines.join('\n'), { reply_markup: toKeyboard(mainMenuRows(!!role)) });
}

export async function helpGroup(tg: TgClient, env: Env, msg: TgMessage): Promise<void> {
  await tg.sendMessage(
    msg.chat.id,
    `🤖 <b>VROZEK AI</b> — group assistant\n\nYou can:\n• Mention me (@vrozek_ai_bot) or reply to me\n• Ask questions in any language\n• Ask about products\n\nCommands: /start /help /products`,
    { reply_to_message_id: msg.message_id }
  );
}

export async function accessDenied(tg: TgClient, env: Env, msg: TgMessage): Promise<void> {
  await tg.sendMessage(msg.chat.id, '🔒 This bot is privately managed. Please contact the administrator for access.');
}
