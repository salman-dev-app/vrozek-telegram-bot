/**
 * VROZEK AI — database layer (D1 on Cloudflare Workers)
 * Typed environment bindings + tiny settings helpers.
 */

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ADMIN_IDS?: string;
  DASHBOARD_USERNAME?: string;
  DASHBOARD_PASSWORD?: string;
  WEBHOOK_SECRET?: string;
}

export interface SettingRow {
  key: string;
  value: string;
}

export const getSetting = async (env: Env, key: string): Promise<string | null> => {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first<SettingRow>();
  return row?.value ?? null;
};

export const setSetting = async (env: Env, key: string, value: string): Promise<void> => {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2'
  )
    .bind(key, value)
    .run();
};

export const upsertUser = async (env: Env, user: { id: number; first_name?: string; username?: string }): Promise<void> => {
  await env.DB.prepare(
    'INSERT INTO users (id, first_name, username) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET first_name = ?2, username = ?3'
  )
    .bind(user.id, user.first_name || '', user.username || '')
    .run();
};

export async function requireNotNull<T>(p: Promise<T | null>, fallback: T): Promise<T> {
  return (await p) ?? fallback;
}
