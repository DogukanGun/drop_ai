/**
 * Agent-wide memory: a per-flow knowledge graph that grows with every chat
 * turn when settings.memoryEnabled is true.
 *
 * - Storage: a JSON file at <artifacts>/memory/<flowId>.json with a flat list
 *   of {subject, predicate, object, ts} triples. Simple and human-readable;
 *   swap for a vector DB later.
 * - Extraction: after each turn we ask an OpenAI-compatible model to pull
 *   triples from "user said X, agent replied Y". Falls back gracefully if no
 *   API key is present.
 * - Retrieval: before each turn we keyword-match the most relevant triples
 *   against the user's message and prepend them as a "Memory:" block to the
 *   runtime input. Crude but works for short conversations; a vector index is
 *   the obvious next upgrade.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config as appConfig } from '../config.js';

export interface Triple {
  subject: string;
  predicate: string;
  object: string;
  ts: number;
}

interface MemoryFile {
  triples: Triple[];
}

function memoryPath(flowId: string): string {
  return join(appConfig.artifactsDir, 'memory', `${flowId}.json`);
}

function readMemory(flowId: string): MemoryFile {
  const path = memoryPath(flowId);
  if (!existsSync(path)) return { triples: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as MemoryFile;
  } catch {
    return { triples: [] };
  }
}

function writeMemory(flowId: string, mem: MemoryFile): void {
  const path = memoryPath(flowId);
  mkdirSync(join(appConfig.artifactsDir, 'memory'), { recursive: true });
  writeFileSync(path, JSON.stringify(mem, null, 2), 'utf8');
}

/** Augment a user message with the most relevant remembered triples. */
export function buildPromptWithMemory(flowId: string, userMessage: string): string {
  const { triples } = readMemory(flowId);
  if (triples.length === 0) return userMessage;
  const relevant = scoreAndPick(triples, userMessage, 8);
  if (relevant.length === 0) return userMessage;
  const memo = relevant.map(t => `- ${t.subject} -- ${t.predicate} -- ${t.object}`).join('\n');
  return `[Memory]\n${memo}\n\n[User]\n${userMessage}`;
}

function scoreAndPick(triples: Triple[], query: string, k: number): Triple[] {
  const tokens = tokenize(query);
  if (tokens.size === 0) return triples.slice(-k);
  const scored = triples.map(t => {
    const text = `${t.subject} ${t.predicate} ${t.object}`;
    const tt = tokenize(text);
    let overlap = 0;
    for (const tok of tokens) if (tt.has(tok)) overlap += 1;
    // Mild recency bias so a tied match prefers newer triples.
    const recency = (t.ts ?? 0) / 1e13;
    return { t, score: overlap + recency };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, k).map(s => s.t);
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2),
  );
}

/**
 * Extract triples from a single conversation turn and append to the flow's
 * memory store. No-op if extraction fails or returns nothing.
 */
export async function ingestTurn(
  flowId: string,
  userMessage: string,
  agentReply: string,
): Promise<{ added: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { added: 0 };
  const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const model = process.env.DROPAI_MEMORY_MODEL ?? 'gpt-4o-mini';

  const passage = `User said: ${userMessage}\nAgent replied: ${agentReply}`;
  let triples: Omit<Triple, 'ts'>[];
  try {
    triples = await extractTriples(apiKey, baseUrl, model, passage);
  } catch {
    return { added: 0 };
  }
  if (triples.length === 0) return { added: 0 };

  const mem = readMemory(flowId);
  const seen = new Set(mem.triples.map(t => key(t)));
  const ts = Date.now();
  for (const t of triples) {
    const k = key(t);
    if (seen.has(k)) continue;
    mem.triples.push({ ...t, ts });
    seen.add(k);
  }
  writeMemory(flowId, mem);
  return { added: triples.length };
}

function key(t: { subject: string; predicate: string; object: string }): string {
  return `${t.subject}|${t.predicate}|${t.object}`;
}

async function extractTriples(
  apiKey: string,
  baseUrl: string,
  model: string,
  passage: string,
): Promise<Omit<Triple, 'ts'>[]> {
  const system =
    `Extract subject-predicate-object triples that capture durable facts about the user, ` +
    `entities, or preferences expressed in the passage. Skip pleasantries and meta talk. ` +
    `Lowercase canonical noun phrases for subject and object; 1-3 word lowercase predicates. ` +
    `Output a JSON object {"triples":[{"subject":"...","predicate":"...","object":"..."}]}. ` +
    `If nothing notable, return {"triples":[]}.`;

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 512,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: passage },
      ],
    }),
  });
  if (!res.ok) throw new Error(`memory extract HTTP ${res.status}`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content ?? '';
  let parsed: { triples?: { subject?: string; predicate?: string; object?: string }[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const out: Omit<Triple, 'ts'>[] = [];
  for (const t of parsed.triples ?? []) {
    const s = norm(t.subject);
    const p = norm(t.predicate);
    const o = norm(t.object);
    if (s && p && o && s !== o) out.push({ subject: s, predicate: p, object: o });
  }
  return out;
}

function norm(v: unknown): string {
  if (v == null) return '';
  return String(v)
    .trim()
    .toLowerCase()
    .replace(/^(a |an |the )/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:'"]+$/, '');
}

export function listMemory(flowId: string): Triple[] {
  return readMemory(flowId).triples;
}
