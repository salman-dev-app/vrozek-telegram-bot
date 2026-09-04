/**
 * VROZEK AI — moderation service.
 * Conservative by design: only act when confidence is high; never punish on a guess.
 */

import type { Env } from '../db/db';

export interface ModResult {
  action: 'delete' | 'warn' | 'none';
  category: string;
  confidence: number;
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

/** In-memory flood & repeat tracking (per worker isolate; best-effort on Workers). */
const floodMap = new Map<string, number[]>();
const lastMsgMap = new Map<string, { text: string; t: number }>();

const groupKey = (chatId: number, userId: number) => `${chatId}:${userId}`;

export function analyzeMessage(text: string, chatId: number, userId: number): ModResult {
  const lower = text.toLowerCase();

  for (const kw of ADULT) {
    if (lower.includes(kw)) {
      return { action: 'delete', category: 'adult', confidence: 0.9 };
    }
  }

  const links = (text.match(LINK_RE) || []).length;
  if (links >= 3) return { action: 'delete', category: 'spam', confidence: 0.85 };
  for (const kw of SCAM) {
    if (lower.includes(kw)) return { action: 'delete', category: 'spam', confidence: 0.95 };
  }

  if (REPEAT_CHAR.test(text) && text.length > 14) {
    return { action: 'warn', category: 'spam', confidence: 0.8 };
  }

  // Flooding: more than 4 messages in 8 seconds.
  const now = Date.now();
  const key = groupKey(chatId, userId);
  const arr = (floodMap.get(key) || []).filter((t) => now - t < 8000);
  arr.push(now);
  floodMap.set(key, arr);
  if (arr.length > 4) {
    return { action: 'delete', category: 'flood', confidence: 0.8 };
  }

  // Repeated identical message.
  const prev = lastMsgMap.get(key);
  if (prev && prev.text === text && now - prev.t < 60000 && text.length > 8) {
    return { action: 'delete', category: 'repeat', confidence: 0.85 };
  }
  lastMsgMap.set(key, { text, t: now });

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
