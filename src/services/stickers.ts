/**
 * VROZEK AI — sticker service.
 * Stickers are stored in the database (file_id captured from admins or added via dashboard).
 * The library contains NO fabricated ids — only stickers an admin actually provides.
 */

import type { Env } from '../db/db';

export const STICKER_CATEGORIES = ['funny', 'happy', 'greeting', 'celebration', 'thinking', 'normal', 'reaction'];

export async function getSticker(env: Env, category?: string): Promise<string | null> {
  let row: { file_id: string } | null = null;
  if (category) {
    row = await env.DB.prepare(
      'SELECT file_id FROM stickers WHERE category = ?1 ORDER BY RANDOM() LIMIT 1'
    )
      .bind(category)
      .first<{ file_id: string }>();
  }
  if (!row) {
    row = await env.DB.prepare('SELECT file_id FROM stickers ORDER BY RANDOM() LIMIT 1').first<{ file_id: string }>();
  }
  return row?.file_id ?? null;
}

export async function addSticker(env: Env, fileId: string, category: string, label: string, by: number): Promise<void> {
  await env.DB.prepare('INSERT INTO stickers (file_id, category, label, created_by) VALUES (?1,?2,?3,?4)')
    .bind(fileId, category || 'reaction', label || '', by)
    .run();
}
