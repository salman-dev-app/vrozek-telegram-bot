/**
 * VROZEK AI — AI service (Gemini), language detection, verified-data retrieval,
 * product intelligence and the strict no-spam group decision logic.
 */

import type { Env } from '../db/db';
import { getSetting } from '../db/db';
import type { TgMessage } from '../lib/telegram';

/* ------------------------------------------------- language detection */

export function detectLanguage(text: string): string {
  if (/[\u0980-\u09FF]/.test(text)) return 'bn'; // Bengali
  if (/[\u0900-\u097F]/.test(text)) return 'hi'; // Hindi / Devanagari
  if (/[\u0600-\u06FF]/.test(text)) return 'ur'; // Urdu / Arabic script
  if (/[\u0400-\u04FF]/.test(text)) return 'ru'; // Russian
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh'; // Chinese
  if (/[\u3040-\u30FF]/.test(text)) return 'ja'; // Japanese
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko'; // Korean
  return 'en';
}

/* ----------------------------------------------- verified data search */

interface Scoreable {
  id: number;
  [k: string]: unknown;
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9\u0980-\u09FF\u0900-\u097F\u0600-\u06FF]{2,}/g) || []).filter(
    (t) => !['the', 'and', 'for', 'you', 'are', 'can', 'have', 'with', 'this', 'that'].includes(t)
  );
}

function scoreFields(queryTokens: string[], fields: string[]): number {
  let hits = 0;
  for (const f of fields) {
    const ft = tokens(f);
    for (const q of queryTokens) if (ft.includes(q)) hits++;
  }
  return queryTokens.length ? hits / queryTokens.length : 0;
}

export interface Product {
  id: number;
  name: string;
  description: string;
  category: string;
  link: string;
  image_url: string;
  price: string;
  active: number;
}

export interface KnowledgeItem {
  id: number;
  question: string;
  answer: string;
  category: string;
}

export async function findProducts(env: Env, text: string, limit = 3): Promise<Product[]> {
  const q = tokens(text);
  if (!q.length) return [];
  const rows = await env.DB.prepare('SELECT * FROM products WHERE active = 1').all<Product>();
  return rows.results
    .map((p) => ({ p, s: scoreFields(q, [p.name, p.category, p.description]) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.p);
}

export async function findKnowledge(env: Env, text: string, limit = 2): Promise<KnowledgeItem[]> {
  const q = tokens(text);
  if (!q.length) return [];
  const rows = await env.DB.prepare('SELECT * FROM knowledge').all<KnowledgeItem>();
  return rows.results
    .map((k) => ({ k, s: scoreFields(q, [k.question, k.answer, k.category]) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.k);
}

export function isProductRequest(text: string): boolean {
  return /(\bbuy\b|\bprice\b|\bcost\b|\bproduct\b|\brecommend\b|\bavailable\b|\bsell\b|\bshop\b|\border\b|\bকিন|\bদাম|\bমূল্য|\bमूल्य|\bकीमत|\bخرید|\bقیمت)/i.test(
    text
  );
}

function productLine(p: Product): string {
  const parts = [`- ${p.name}`];
  if (p.price) parts.push(`Price: ${p.price}`);
  if (p.category) parts.push(`Category: ${p.category}`);
  if (p.description) parts.push(p.description);
  if (p.link) parts.push(`Link: ${p.link}`);
  return parts.join(' | ');
}

/* ------------------------------------------------------- Gemini API */

async function callGemini(
  env: Env,
  system: string,
  user: string
): Promise<string | null> {
  const key = env.GEMINI_API_KEY || (await getSetting(env, 'gemini_api_key'));
  if (!key) return null;
  const model = env.GEMINI_MODEL || (await getSetting(env, 'gemini_model')) || 'gemini-3.5-flash';
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
        }),
      }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || '')
      .join('')
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function buildSystemPrompt(env: Env, group = false): Promise<string> {
  const custom = await getSetting(env, 'system_prompt');
  const base = [
    'You are VROZEK AI, the intelligent assistant bot of Salman (website: https://vrozek.xyz).',
    'Rules:',
    '- Reply in the same language the user wrote in.',
    '- Be short, natural, friendly and human. Never be robotic or verbose.',
    '- Never pretend to be Salman. If relevant, identify yourself as VROZEK AI.',
    '- Never invent facts, prices, links, products or information. Use ONLY the VERIFIED DATA section when relevant.',
    '- If the user is unclear or the question is incomplete, ask a brief clarification question.',
    '- If nothing verified is relevant and you are unsure, answer honestly within your limits.',
    group ? '- You are in a group chat: stay concise, never spam, only help when asked.' : '- This is a private chat.',
  ].join('\n');
  return custom || base;
}

export interface AiReplyOptions {
  text: string;
  chatType: 'private' | 'group';
  userName?: string;
  groupTitle?: string;
  includeProducts: boolean;
  memory?: string;
}

export async function generateReply(env: Env, opts: AiReplyOptions): Promise<string | null> {
  const system = await buildSystemPrompt(env, opts.chatType === 'group');
  const lang = detectLanguage(opts.text);
  const productHits = opts.includeProducts ? await findProducts(env, opts.text, 3) : [];
  const kbHits = await findKnowledge(env, opts.text, 2);

  const verified: string[] = [];
  if (productHits.length) {
    verified.push('PRODUCTS (verified, from Salman\'s shop database):', ...productHits.map(productLine));
  }
  if (kbHits.length) {
    verified.push(
      'KNOWLEDGE BASE (verified information from the administrator):',
      ...kbHits.map((k) => `Q: ${k.question}\nA: ${k.answer}`)
    );
  }

  const ctx = [
    `User message: ${opts.text}`,
    opts.userName ? `User name: ${opts.userName}` : '',
    opts.groupTitle ? `Group: ${opts.groupTitle}` : '',
    opts.memory ? `Recent context: ${opts.memory}` : '',
    `Detected language hint: ${lang}`,
  ]
    .filter(Boolean)
    .join('\n');

  const userPrompt =
    verified.length > 0
      ? `${ctx}\n\nVERIFIED DATA (only use this when relevant to the question, never invent extra):\n${verified.join('\n')}`
      : `${ctx}\n\nNo verified database entry is directly relevant. Answer honestly, briefly, and never invent specifics.`;

  const ai = await callGemini(env, system, userPrompt);
  if (ai) return ai;

  // Fallback without API key: answer from verified data only.
  if (kbHits.length) return kbHits[0].answer;
  if (productHits.length) return productHits.map(productLine).join('\n');
  return null;
}

/* -------------------------------------------- no-spam group decision */

export interface GateContext {
  botId: number;
  botUsername: string;
}

export function shouldRespondInGroup(msg: TgMessage, ctx: GateContext): boolean {
  if (!msg.text) return false;
  const text = msg.text.trim();
  const lower = text.toLowerCase();
  if (lower.startsWith('/start') || lower.startsWith('/help')) return false; // handled elsewhere
  if (lower.startsWith('/ai ') || lower === '/ai') return true;
  if (lower.includes(`@${ctx.botUsername.toLowerCase()}`)) return true;
  if (lower.startsWith('vrozek')) return true;
  if (msg.reply_to_message?.from && msg.reply_to_message.from.id === ctx.botId) return true;
  if (msg.entities?.some((e) => e.type === 'mention')) return true;
  if (isProductRequest(text)) return true;
  return false;
}
