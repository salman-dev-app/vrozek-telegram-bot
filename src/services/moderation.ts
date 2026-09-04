/**
 * VROZEK AI — moderation service.
 * Conservative by design: only act when confidence is high; never punish on a guess.
 * Anti-flood / anti-repeat state is persisted in D1 (mod_state) so it never resets on
 * worker restarts. Trusted users and admins are always exempt.
 */

import type { Env } from '../db/db';

export type ModAction = 'delete' | 'warn' | 'mute' | 'none';

export interface ModResult {
  action: ModAction;
  category: string;
  confidence: number;
}

export interface ModOptions {
  blockWords: string[];
  linkEnabled: boolean;
  trusted: boolean;
}

const ADULT = [
  'porn', 'pornhub', 'xnxx', 'xvideos', 'nsfw', 'nude', 'nudes', 'sex tape', 'sextape',
  'onlyfans', 'escort', 'fuck video', 'child porn', 'cp video',
];

const SCAM = [
  'congratulations you won', 'claim your prize', 'free money', 'send 100 get 500',
  'earn 50000 per day', 'double your money', 'urgent: your account', 'click this link to verify',
];

const LINK_RE = /(https?:\/\/|t\.me\/|bit\.ly\/|tinyurl\.com\/)/gi;
const REPEAT_CHAR = /(.)\1{9,}/;

export async function analyzeMessage(
  env: Env,
  text: string,
  chatId: number,
  userId: number,
  opts: ModOptions
): Promise<ModResult> {
  const lower = text.toLowerCase();

  // Admins & trusted users are always exempt.
  if (opts.trusted) return { action: 'none', category: '', confidence: 0 };

  // Per-group blocklist (words configured by the admin).
  for (const w of opts.blockWords) {
    if (w && lower.includes(w)) return { action: 'delete', category: 'blocklist', confidence: 0.9 };
  }

  for (const kw of ADULT) {
    if (lower.includes(kw)) return { action: 'delete', category: 'adult', confidence: 0.9 };
  }

  if (opts.linkEnabled) {
    const links = (text.match(LINK_RE) || []).length;
    if (links >= 3) return { action: 'delete', category: 'spam', confidence: 0.85 };
  }
  for (const kw of SCAM) {
    if (lower.includes(kw)) return { action: 'delete', category: 'spam', confidence: 0.95 };
  }

  if (REPEAT_CHAR.test(text) && text.length > 14) {
    return { action: 'warn', category: 'spam', confidence: 0.8 };
  }

  // —— Persistent flood & repeat detection (D1-backed) ——
  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT last_text, last_time, recent FROM mod_state WHERE chat_id = ?1 AND user_id = ?2'
  )
    .bind(chatId, userId)
    .first<{ last_text: string; last_time: number; recent: string }>();

  let recent: number[] = [];
  try {
    recent = JSON.parse(row?.recent || '[]');
  } catch {
    recent = [];
  }
  recent = recent.filter((t) => now - t < 8000).concat(now);

  const lastText = row?.last_text || '';
  const lastTime = row?.last_time || 0;

  await env.DB.prepare(
    `INSERT INTO mod_state (chat_id, user_id, last_text, last_time, recent)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(chat_id, user_id) DO UPDATE SET last_text = ?3, last_time = ?4, recent = ?5`
  )
    .bind(chatId, userId, text, now, JSON.stringify(recent.slice(-10)))
    .run();

  if (recent.length > 8) return { action: 'mute', category: 'flood', confidence: 0.85 };
  if (recent.length > 4) return { action: 'delete', category: 'flood', confidence: 0.8 };
  if (lastText === text && now - lastTime < 60000 && text.length > 8) {
    return { action: 'delete', category: 'repeat', confidence: 0.85 };
  }

  return { action: 'none', category: '', confidence: 0 };
}

export async function logModeration(
  env: Env,
  data: { groupId: number; userId: number; userName: string; action: string; category: string; confidence: number }
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO moderation_logs (group_id, user_id, user_name, action, category, confidence) VALUES (?1,?2,?3,?4,?5,?6)'
  )
    .bind(data.groupId, data.userId, data.userName, data.action, data.category, data.confidence)
    .run();
}

/** Increment a user's strike counter in a group; returns the new count. */
export async function addWarn(env: Env, groupId: number, userId: number): Promise<number> {
  const row = await env.DB.prepare('SELECT count FROM warns WHERE group_id = ?1 AND user_id = ?2')
    .bind(groupId, userId)
    .first<{ count: number }>();
  const next = (row?.count ?? 0) + 1;
  await env.DB.prepare(
    `INSERT INTO warns (group_id, user_id, count) VALUES (?1, ?2, ?3)
     ON CONFLICT(group_id, user_id) DO UPDATE SET count = ?3, updated_at = datetime('now')`
  )
    .bind(groupId, userId, next)
    .run();
  return next;
}

export async function resetWarns(env: Env, groupId: number, userId: number): Promise<void> {
  await env.DB.prepare('DELETE FROM warns WHERE group_id = ?1 AND user_id = ?2').bind(groupId, userId).run();
}
