/**
 * Standalone-flow bundler. Takes a FlowDef saved in the editor and produces a
 * Map of files (path → contents) that, when zipped and extracted, runs the
 * exact flow as a self-contained Node CLI — no DropAI proxy, no DropAI tokens.
 * The user provides their own OPENAI_API_KEY / TAVILY_API_KEY via .env.
 *
 * The runner inside the bundle is a slimmed-down twin of executor.ts: topo
 * sort with tool-edge filtering, tool-call dispatch through a local registry.
 */
import type { FlowDef } from '@dropai/runtime-core';

const BUNDLABLE = new Set([
  'input',
  'echo',
  'text-template',
  'llm',
  'llm-agent',
  'tool-calculator',
  'tool-fetch',
  'tool-web-search',
]);

const NEEDS_MATHJS = new Set(['tool-calculator']);
const NEEDS_TAVILY_KEY = new Set(['tool-web-search']);
const NEEDS_OPENAI_KEY = new Set(['llm', 'llm-agent']);

export class BundleError extends Error {}

export function buildBundle(flow: FlowDef): Map<string, string> {
  const files = new Map<string, string>();
  const types = new Set(flow.nodes.map(n => n.type));

  const unsupported = [...types].filter(t => !BUNDLABLE.has(t));
  if (unsupported.length > 0) {
    throw new BundleError(
      `Cannot bundle: these node types are not supported in standalone mode yet: ${unsupported.join(', ')}. ` +
        `Bundlable types: ${[...BUNDLABLE].sort().join(', ')}.`,
    );
  }

  const needsOpenai = [...types].some(t => NEEDS_OPENAI_KEY.has(t));
  const needsTavily = [...types].some(t => NEEDS_TAVILY_KEY.has(t));
  const needsMathjs = [...types].some(t => NEEDS_MATHJS.has(t));

  files.set('flow.json', JSON.stringify(flow, null, 2));
  files.set('package.json', renderPackageJson(flow.name, needsMathjs));
  files.set('.env.example', renderEnvExample(needsOpenai, needsTavily));
  files.set('.gitignore', '.env\nnode_modules/\n');
  files.set('README.md', renderReadme(flow.name, needsOpenai, needsTavily));
  files.set('index.js', RUNNER_INDEX);
  files.set('runner.js', RUNNER_CORE);

  for (const t of types) files.set(`nodes/${t}.js`, NODE_RUNTIMES[t]!);

  return files;
}

// ───────────────────────────────────────────────────────────────────────────
// Project files
// ───────────────────────────────────────────────────────────────────────────

function renderPackageJson(name: string, needsMathjs: boolean): string {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'dropai-flow';
  const dep: Record<string, string> = {};
  if (needsMathjs) dep.mathjs = '^14.0.1';
  return JSON.stringify(
    {
      name: safe,
      version: '0.0.1',
      private: true,
      type: 'module',
      bin: { [safe]: './index.js' },
      scripts: { start: 'node index.js' },
      dependencies: dep,
      engines: { node: '>=20' },
    },
    null,
    2,
  );
}

function renderEnvExample(needsOpenai: boolean, needsTavily: boolean): string {
  const lines = ['# Fill in the keys you need, then save this file as `.env`.', ''];
  if (needsOpenai) lines.push('OPENAI_API_KEY=', '');
  if (needsTavily) lines.push('TAVILY_API_KEY=', '');
  if (!needsOpenai && !needsTavily) lines.push('# (No API keys required for this flow.)');
  return lines.join('\n') + '\n';
}

function renderReadme(name: string, needsOpenai: boolean, needsTavily: boolean): string {
  const keyLines: string[] = [];
  if (needsOpenai) keyLines.push('- `OPENAI_API_KEY` — get one at https://platform.openai.com/api-keys');
  if (needsTavily) keyLines.push('- `TAVILY_API_KEY` — get one at https://tavily.com');
  const keysSection = keyLines.length
    ? `## API keys\n\nThis flow uses:\n\n${keyLines.join('\n')}\n\nCopy \`.env.example\` to \`.env\` and fill in the values.\n`
    : `## API keys\n\nThis flow needs no API keys.\n`;
  return `# ${name}

Standalone export of a DropAI flow. Runs as a plain Node CLI — no DropAI service, no DropAI token.

## Install

\`\`\`
npm install
\`\`\`

${keysSection}
## Run

\`\`\`
node index.js "your message here"
\`\`\`

Or pipe stdin:

\`\`\`
echo "summarize https://example.com" | node index.js
\`\`\`

The CLI runs the flow once with your message as the runtime input and prints the final reply to stdout. Tool-call traces and per-node progress go to stderr so you can pipe just the reply if you want.

## What's inside

- \`flow.json\` — the exact graph you exported.
- \`runner.js\` — topo-sort + agent tool-call loop. Mirrors the platform executor.
- \`nodes/<type>.js\` — one file per node type used in this flow. Each is the same code that powers the live editor.
- \`index.js\` — small CLI wrapper.
`;
}

// ───────────────────────────────────────────────────────────────────────────
// CLI entry + runner
// ───────────────────────────────────────────────────────────────────────────

const RUNNER_INDEX = `#!/usr/bin/env node
/**
 * Read a runtime message from argv (joined) or stdin, run the flow, print
 * the final result to stdout. Logs go to stderr.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFlow } from './runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

function loadDotenv() {
  // Minimal .env loader so we don't require an extra dep.
  try {
    const text = readFileSync(resolve(__dirname, '.env'), 'utf8');
    for (const line of text.split(/\\r?\\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [, k, raw] = m;
      if (process.env[k]) continue;
      let v = raw.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[k] = v;
    }
  } catch {
    // no .env, that's fine
  }
}
loadDotenv();

const flow = JSON.parse(readFileSync(resolve(__dirname, 'flow.json'), 'utf8'));
const argMessage = process.argv.slice(2).join(' ').trim();
const stdinMessage = await readStdin();
const message = argMessage || stdinMessage;

try {
  const result = await runFlow(flow, message);
  if (typeof result === 'string') process.stdout.write(result + '\\n');
  else process.stdout.write(JSON.stringify(result, null, 2) + '\\n');
} catch (err) {
  process.stderr.write('error: ' + (err instanceof Error ? err.message : String(err)) + '\\n');
  process.exit(1);
}
`;

const RUNNER_CORE = `/**
 * Runtime: topo-sort, tool-edge filtering, agent tool-call dispatch.
 * Mirrors apps/orchestrator/src/runtime/executor.ts but stripped of the
 * editor's eventBus, db, memory, and auth.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const AGENT_TYPES = new Set(['llm-agent']);
const TOOLS_HANDLE = 'tools';

const registryCache = new Map();
async function loadNodeRuntime(type) {
  if (registryCache.has(type)) return registryCache.get(type);
  const url = pathToFileURL(resolve(__dirname, 'nodes', type + '.js')).href;
  const mod = await import(url);
  const run = mod.default ?? mod.run;
  if (!run) throw new Error('node ' + type + ' has no run() export');
  registryCache.set(type, run);
  return run;
}

function topoSort(flow) {
  const indegree = new Map();
  const outgoing = new Map();
  for (const n of flow.nodes) { indegree.set(n.id, 0); outgoing.set(n.id, []); }
  for (const e of flow.edges) {
    if (!indegree.has(e.target) || !outgoing.has(e.source)) continue;
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    outgoing.get(e.source).push(e.target);
  }
  const queue = [];
  for (const [id, deg] of indegree) if (deg === 0) queue.push(id);
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (order.length !== flow.nodes.length) throw new Error('cycle in flow graph');
  return order;
}

function predecessors(flow, target) {
  return flow.edges.filter(e => e.target === target).map(e => e.source);
}
function sinks(flow) {
  const has = new Set(flow.edges.map(e => e.source));
  return flow.nodes.map(n => n.id).filter(id => !has.has(id));
}
function computeToolNodes(flow) {
  const ids = new Set();
  for (const e of flow.edges) if (e.targetHandle === TOOLS_HANDLE) ids.add(e.source);
  return ids;
}
function migrateLegacyTools(flow) {
  const extra = [];
  let mut = false;
  const nodes = flow.nodes.map(n => {
    if (!AGENT_TYPES.has(n.type)) return n;
    const legacy = Array.isArray(n.config?.tools) ? n.config.tools : null;
    if (!legacy || legacy.length === 0) return n;
    mut = true;
    for (const id of legacy) {
      if (typeof id !== 'string') continue;
      extra.push({ id: 'legacy-tool-' + n.id + '-' + id, source: id, target: n.id, targetHandle: TOOLS_HANDLE });
    }
    const { tools, ...rest } = n.config;
    return { ...n, config: rest };
  });
  if (!mut) return flow;
  return { ...flow, nodes, edges: [...flow.edges, ...extra] };
}
function injectAgentTools(node, flow) {
  if (!AGENT_TYPES.has(node.type)) return node.config;
  const resolved = flow.edges
    .filter(e => e.target === node.id && e.targetHandle === TOOLS_HANDLE)
    .map(e => flow.nodes.find(n => n.id === e.source))
    .filter(Boolean)
    .map(n => ({ nodeId: n.id, type: n.type, label: n.id, description: '' }));
  return { ...node.config, _tools: resolved };
}

function makeCtx(nodeId, flow) {
  return {
    nodeId,
    runId: 'cli',
    signal: { aborted: false, addEventListener: () => {}, removeEventListener: () => {} },
    emit(event) {
      const { kind, payload } = event;
      const tag = '[' + nodeId + ']' + (event.channel ? ' (' + event.channel + ')' : '');
      const body = payload === undefined ? '' : ' ' + JSON.stringify(payload).slice(0, 200);
      process.stderr.write(tag + ' ' + kind + body + '\\n');
    },
    log(level, message, meta) {
      process.stderr.write('[' + nodeId + '] [' + level + '] ' + message + (meta ? ' ' + JSON.stringify(meta) : '') + '\\n');
    },
    async callTool(targetNodeId, input) {
      return invokeTool(flow, targetNodeId, input);
    },
  };
}

async function invokeTool(flow, targetNodeId, input) {
  const target = flow.nodes.find(n => n.id === targetNodeId);
  if (!target) throw new Error('callTool: no node with id "' + targetNodeId + '"');
  const childCtx = {
    nodeId: target.id,
    runId: 'cli',
    signal: { aborted: false, addEventListener: () => {}, removeEventListener: () => {} },
    emit(event) {
      const tag = '[' + target.id + '] (tool-call)';
      const body = event.payload === undefined ? '' : ' ' + JSON.stringify(event.payload).slice(0, 200);
      process.stderr.write(tag + ' ' + event.kind + body + '\\n');
    },
    log(level, message) { process.stderr.write('[' + target.id + '] [' + level + '] ' + message + '\\n'); },
    async callTool(nestedId, nestedInput) { return invokeTool(flow, nestedId, nestedInput); },
  };
  const run = await loadNodeRuntime(target.type);
  const config = injectAgentTools(target, flow);
  return run(childCtx, config, input);
}

function collectInput(flow, nodeId, outputs, runtimeInput) {
  const preds = predecessors(flow, nodeId);
  if (preds.length === 0) return runtimeInput ?? null;
  if (preds.length === 1) return outputs.get(preds[0]) ?? null;
  return preds.map(p => outputs.get(p) ?? null);
}

function finalResult(sinkIds, outputs) {
  if (sinkIds.length === 0) return null;
  if (sinkIds.length === 1) return outputs.get(sinkIds[0]) ?? null;
  return Object.fromEntries(sinkIds.map(id => [id, outputs.get(id) ?? null]));
}

export async function runFlow(flow, runtimeInput) {
  const full = migrateLegacyTools(flow);
  const linear = { ...full, edges: full.edges.filter(e => e.targetHandle !== TOOLS_HANDLE) };
  const toolIds = computeToolNodes(full);
  const order = topoSort(linear).filter(id => !toolIds.has(id));
  const outputs = new Map();
  for (const nodeId of order) {
    const node = full.nodes.find(n => n.id === nodeId);
    if (!node) continue;
    const inputMsg = collectInput(linear, nodeId, outputs, runtimeInput);
    const ctx = makeCtx(nodeId, full);
    const config = injectAgentTools(node, full);
    const run = await loadNodeRuntime(node.type);
    const result = await run(ctx, config, inputMsg);
    outputs.set(nodeId, result);
  }
  return finalResult(sinks(linear), outputs);
}
`;

// ───────────────────────────────────────────────────────────────────────────
// Per-node runtimes (inlined from plugins/, with proxy paths stripped)
// ───────────────────────────────────────────────────────────────────────────

const NODE_INPUT = `export async function run(ctx, config, msg) {
  ctx.emit({ kind: 'start' });
  const payload = msg ?? config.payload ?? null;
  ctx.emit({ kind: 'output', payload });
  ctx.emit({ kind: 'end' });
  return payload;
}
`;

const NODE_ECHO = `export async function run(ctx, config, msg) {
  ctx.emit({ kind: 'start' });
  ctx.emit({ kind: 'output', payload: msg });
  ctx.emit({ kind: 'end' });
  return msg;
}
`;

const NODE_TEXT_TEMPLATE = `export async function run(ctx, config, msg) {
  ctx.emit({ kind: 'start' });
  const tpl = String(config.template ?? '{{input}}');
  const out = tpl.replace(/\\{\\{\\s*input(?:\\.([\\w.]+))?\\s*\\}\\}/g, (_m, path) => {
    if (!path) return stringify(msg);
    const parts = path.split('.');
    let v = msg;
    for (const p of parts) { if (v == null) return ''; v = v[p]; }
    return stringify(v);
  });
  ctx.emit({ kind: 'output', payload: out });
  ctx.emit({ kind: 'end' });
  return out;
}
function stringify(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
`;

const NODE_LLM = `const TEMPLATE_INPUT = /\\{\\{\\s*input\\s*\\}\\}/g;
export async function run(ctx, config, msg) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set in environment.');
  const model = String(config.model || 'gpt-4o-mini');
  const systemPrompt = String(config.systemPrompt || 'You are a helpful assistant.');
  const userPromptTemplate = String(config.userPromptTemplate || '{{input}}');
  const temperature = Number(config.temperature ?? 0.7);
  const maxTokens = Number(config.maxTokens ?? 1024);
  const baseUrl = String(config.baseUrl || 'https://api.openai.com/v1').replace(/\\/$/, '');
  const upstream = stringifyMsg(msg);
  const userContent = userPromptTemplate.replace(TEMPLATE_INPUT, upstream);
  ctx.emit({ kind: 'start', payload: { model } });
  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ model, temperature, max_tokens: maxTokens, messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('LLM API ' + res.status + ': ' + (text.slice(0, 300) || res.statusText));
  }
  const body = await res.json();
  const reply = (body?.choices?.[0]?.message?.content?.trim?.()) || '';
  ctx.emit({ kind: 'output', payload: reply });
  ctx.emit({ kind: 'end' });
  return reply;
}
function stringifyMsg(m) {
  if (m == null) return '';
  if (typeof m === 'string') return m;
  try { return JSON.stringify(m); } catch { return String(m); }
}
`;

const NODE_LLM_AGENT = `const NAME_SAFE = /[^a-zA-Z0-9_-]/g;
export async function run(ctx, config, msg) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set in environment.');
  if (typeof ctx.callTool !== 'function') throw new Error('runtime missing ctx.callTool');
  const model = String(config.model || 'gpt-4o-mini');
  const systemPrompt = String(config.systemPrompt || 'You are a helpful agent.');
  const temperature = Number(config.temperature ?? 0.3);
  const maxTokens = Number(config.maxTokens ?? 1024);
  const maxIterations = Math.max(1, Number(config.maxIterations ?? 6));
  const baseUrl = String(config.baseUrl || 'https://api.openai.com/v1').replace(/\\/$/, '');
  const resolvedTools = Array.isArray(config._tools) ? config._tools : [];
  const tools = resolvedTools.map(t => ({
    type: 'function',
    function: {
      name: sanitize(t.nodeId),
      description: (t.label + ': ' + (t.description || t.type)).slice(0, 1024),
      parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
    },
  }));
  const nameToId = new Map(resolvedTools.map(t => [sanitize(t.nodeId), t.nodeId]));
  ctx.emit({ kind: 'start', payload: { model, tools: resolvedTools.map(t => t.nodeId), maxIterations } });
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: stringifyMsg(msg) || '' },
  ];
  let finalText = '';
  for (let iter = 1; iter <= maxIterations; iter++) {
    ctx.emit({ kind: 'progress', payload: { phase: 'iteration', iteration: iter } });
    const body = { model, temperature, max_tokens: maxTokens, messages };
    if (tools.length > 0) { body.tools = tools; body.tool_choice = 'auto'; }
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('LLM API ' + res.status + ': ' + (t.slice(0, 300) || res.statusText));
    }
    const completion = await res.json();
    const choice = completion?.choices?.[0];
    const message = choice?.message ?? {};
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (calls.length === 0) { finalText = (message.content || '').trim(); break; }
    messages.push(message);
    for (const call of calls) {
      const name = call.function?.name || '';
      const targetNodeId = nameToId.get(name);
      let result;
      if (!targetNodeId) result = 'error: unknown tool "' + name + '"';
      else {
        let parsed = {};
        try { parsed = call.function?.arguments ? JSON.parse(call.function.arguments) : {}; } catch { parsed = {}; }
        const input = typeof parsed.input === 'string' ? parsed.input : stringifyMsg(parsed);
        try {
          const out = await ctx.callTool(targetNodeId, input);
          result = stringifyResult(out);
        } catch (err) {
          result = 'error: ' + (err instanceof Error ? err.message : String(err));
        }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.slice(0, 8000) });
    }
  }
  if (!finalText) finalText = '(agent did not produce a reply within maxIterations)';
  ctx.emit({ kind: 'output', payload: finalText });
  ctx.emit({ kind: 'end' });
  return finalText;
}
function sanitize(s) { return String(s).replace(NAME_SAFE, '_').slice(0, 64) || 'tool'; }
function stringifyMsg(m) {
  if (m == null) return '';
  if (typeof m === 'string') return m;
  try { return JSON.stringify(m); } catch { return String(m); }
}
function stringifyResult(r) {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (typeof r === 'object') {
    for (const k of ['finalText', 'reportMd', 'text', 'output', 'stdout']) {
      const v = r[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
  }
  try { return JSON.stringify(r); } catch { return String(r); }
}
`;

const NODE_TOOL_CALCULATOR = `import { evaluate } from 'mathjs';
export async function run(ctx, config, msg) {
  const expr = (typeof msg === 'string' && msg.trim()) || String(config.expression || '').trim();
  if (!expr) throw new Error('calculator tool needs an expression');
  ctx.emit({ kind: 'start', payload: { expression: expr } });
  let result;
  try { result = evaluate(expr); }
  catch (err) { throw new Error('could not evaluate "' + expr + '": ' + (err instanceof Error ? err.message : err)); }
  const text = format(result);
  ctx.emit({ kind: 'output', payload: { expression: expr, result: text } });
  ctx.emit({ kind: 'end' });
  return text;
}
function format(r) {
  if (r == null) return '';
  if (typeof r === 'number') return Number.isFinite(r) ? String(r) : 'NaN';
  if (typeof r === 'string') return r;
  try { return r.toString(); } catch { return String(r); }
}
`;

const NODE_TOOL_FETCH = `export async function run(ctx, config, msg) {
  const url = (typeof msg === 'string' && msg.trim()) || String(config.url || '').trim();
  if (!url) throw new Error('fetch tool needs a URL');
  const maxChars = Math.max(100, Number(config.maxChars ?? 5000));
  ctx.emit({ kind: 'start', payload: { url, maxChars } });
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'DropAI-Standalone/0.0.1' } });
  if (!res.ok) throw new Error('fetch ' + res.status + ': ' + res.statusText);
  const raw = await res.text();
  const text = raw.length > maxChars ? raw.slice(0, maxChars) + '\\n…(truncated)' : raw;
  ctx.emit({ kind: 'output', payload: { url, status: res.status, bytes: raw.length } });
  ctx.emit({ kind: 'end' });
  return text;
}
`;

const NODE_TOOL_WEB_SEARCH = `const TAVILY_URL = 'https://api.tavily.com/search';
export async function run(ctx, config, msg) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY not set. Get one at tavily.com.');
  const query = (typeof msg === 'string' && msg.trim()) || String(config.query || '').trim();
  if (!query) throw new Error('web search tool needs a query');
  const maxResults = Math.max(1, Math.min(10, Number(config.maxResults ?? 5)));
  const searchDepth = ['basic', 'advanced'].includes(config.searchDepth) ? config.searchDepth : 'basic';
  ctx.emit({ kind: 'start', payload: { query, maxResults } });
  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey, query, max_results: maxResults, search_depth: searchDepth,
      include_answer: false, include_raw_content: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Tavily ' + res.status + ': ' + (t.slice(0, 200) || res.statusText));
  }
  const body = await res.json();
  const results = Array.isArray(body?.results) ? body.results : [];
  const formatted = results.length === 0
    ? '(no results for "' + query + '")'
    : results.map(r => '- ' + r.title + '\\n  ' + r.url + '\\n  ' + (r.content || '').slice(0, 240).replace(/\\s+/g, ' ').trim()).join('\\n\\n');
  ctx.emit({ kind: 'output', payload: { query, count: results.length } });
  ctx.emit({ kind: 'end' });
  return formatted;
}
`;

const NODE_RUNTIMES: Record<string, string> = {
  input: NODE_INPUT,
  echo: NODE_ECHO,
  'text-template': NODE_TEXT_TEMPLATE,
  llm: NODE_LLM,
  'llm-agent': NODE_LLM_AGENT,
  'tool-calculator': NODE_TOOL_CALCULATOR,
  'tool-fetch': NODE_TOOL_FETCH,
  'tool-web-search': NODE_TOOL_WEB_SEARCH,
};

export const BUNDLABLE_TYPES: string[] = [...BUNDLABLE].sort();
