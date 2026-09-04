/**
 * VROZEK AI — permission-aware Telegram command registration.
 * Uses setMyCommands scopes so users only ever see commands they may use.
 */

import type { Env } from '../db/db';
import type { TgClient } from '../lib/telegram';

const PUBLIC_COMMANDS = [
  { command: 'start', description: 'Start the assistant' },
  { command: 'help', description: 'Help & features' },
  { command: 'products', description: 'Browse products & templates' },
];

export async function registerCommands(tg: TgClient, env: Env): Promise<{ username: string }> {
  const me = await tg.getMe();
  const username: string = me?.username || '';

  // Default scope (everywhere a chat menu shows): public commands only.
  await tg.setCommands(PUBLIC_COMMANDS);

  // Per-admin private scope: adds /admin — nobody else ever sees it.
  const admins = await env.DB.prepare('SELECT user_id FROM admins').all<{ user_id: number }>();
  for (const a of admins.results) {
    try {
      await tg.setCommands([...PUBLIC_COMMANDS, { command: 'admin', description: 'Open admin panel' }], {
        type: 'chat',
        chat_id: a.user_id,
      });
    } catch {
      /* chat unavailable — ignore */
    }
  }
  return { username };
}
