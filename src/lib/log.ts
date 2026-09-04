/**
 * VROZEK AI — structured audit log helper.
 */

import type { Env } from '../db/db';

export async function logEvent(env: Env, type = 'info', message = ''): Promise<void> {
  await env.DB.prepare('INSERT INTO logs (type, message) VALUES (?1, ?2)').bind(type, String(message).slice(0, 500)).run();
}
