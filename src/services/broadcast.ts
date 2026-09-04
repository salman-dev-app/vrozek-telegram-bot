/**
 * VROZEK AI — broadcast service (admin-only).
 */

import type { Env } from '../db/db';
import type { TgClient } from '../lib/telegram';

export interface BroadcastResult {
  total: number;
  success: number;
  failed: number;
}

export async function runBroadcast(
  env: Env,
  tg: TgClient,
  text: string,
  groupId?: number,
  triggeredBy = 0
): Promise<BroadcastResult> {
  const rows = groupId
    ? await env.DB.prepare('SELECT id FROM groups WHERE id = ?1 AND enabled = 1').bind(groupId).all<{ id: number }>()
    : await env.DB.prepare('SELECT id FROM groups WHERE enabled = 1').all<{ id: number }>();

  let success = 0;
  let failed = 0;
  for (const g of rows.results) {
    const ok = await tg.sendMessage(g.id, text);
    if (ok) success++;
    else failed++;
  }

  await env.DB.prepare(
    'INSERT INTO broadcast_logs (total, success, failed, payload, triggered_by) VALUES (?1,?2,?3,?4,?5)'
  )
    .bind(rows.results.length, success, failed, JSON.stringify({ group_id: groupId || null, text: text.slice(0, 500) }), triggeredBy)
    .run();

  return { total: rows.results.length, success, failed };
}
