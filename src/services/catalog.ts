/**
 * VROZEK AI — product catalog service.
 * SINGLE source of truth: catalog/products.json (edited by the administrator by hand).
 * Each product is just a name + category + keywords + short description + website url.
 * The bot only ever recommends products that exist here and only shares their real urls.
 * There is NO pricing, cart, checkout or payment anywhere.
 */

import type { Env } from '../db/db';
import { getSetting } from '../db/db';
import catalogData from '../../catalog/products.json';

export interface CatalogProduct {
  name: string;
  category: string;
  keywords: string[];
  description: string;
  url: string;
}

function tokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .match(/[a-z0-9\u0980-\u09FF\u0900-\u097F\u0600-\u06FF]{2,}/g) || []
  ).filter((t) => !['the', 'and', 'for', 'you', 'are', 'can', 'have', 'with', 'this', 'that'].includes(t));
}

/** All catalog entries from catalog/products.json. */
export function getAllCatalog(): CatalogProduct[] {
  return (catalogData as unknown as { products?: CatalogProduct[] }).products || [];
}

/** Base store url: per-entry url wins; fallback: website_url setting → WEBSITE_URL env → catalog json. */
export async function getWebsiteUrl(env: Env): Promise<string> {
  return (
    (await getSetting(env, 'website_url')) ||
    env.WEBSITE_URL ||
    (catalogData as unknown as { website?: string }).website ||
    'https://vrozek.xyz'
  );
}

/** Keyword/intent matching: scores name + category + keywords + description. */
export function findCatalogProducts(text: string, limit = 3): CatalogProduct[] {
  const q = tokens(text);
  if (!q.length) return [];
  return getAllCatalog()
    .map((p) => {
      const hay = `${p.name} ${p.category} ${(p.keywords || []).join(' ')} ${p.description}`.toLowerCase();
      const hits = q.filter((t) => hay.includes(t)).length;
      return { p, s: q.length ? hits / q.length : 0 };
    })
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.p);
}
