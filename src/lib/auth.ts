/**
 * VROZEK AI — roles, authorization and bootstrap.
 * Sensitive actions must verify authorization before they run.
 */

import type { Env } from '../db/db';

export type Role = 'super_admin' | 'admin' | 'moderator';

export const ROLE_RANK: Record<Role, number> = { super_admin: 3, admin: 2, moderator: 1 };

export function isAtLeast(role: Role | null, min: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function bootstrap(env: Env): Promise<void> {
  const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM admins').first<{ c: number }>();
  if (!count || count.c === 0) {
    const ids = (env.ADMIN_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const id of ids) {
      await env.DB.prepare('INSERT OR IGNORE INTO admins (user_id, role, added_by) VALUES (?1, ?, 0)')
        .bind(Number(id), 'super_admin')
        .run();
    }
  }
}

export async function getUserRole(env: Env, userId: number): Promise<Role | null> {
  const row = await env.DB.prepare('SELECT role FROM admins WHERE user_id = ?1').bind(userId).first<{ role: Role }>();
  return row ? row.role : null;
}

export async function isPrivateAccessApproved(env: Env, userId: number): Promise<boolean> {
  const role = await getUserRole(env, userId);
  if (role) return true;
  const row = await env.DB.prepare('SELECT access_approved FROM users WHERE id = ?1').bind(userId).first<{ access_approved: number }>();
  return row?.access_approved === 1;
}

/** Timing-safe secret comparison (used for dashboard Basic auth). */
export async function compareSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const da = await crypto.subtle.digest('SHA-256', enc.encode(a));
  const db = await crypto.subtle.digest('SHA-256', enc.encode(b));
  const ba = new Uint8Array(da);
  const bb = new Uint8Array(db);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}
