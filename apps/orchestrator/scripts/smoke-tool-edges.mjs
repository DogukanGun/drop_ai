/**
 * Smoke for edge-based tool wiring.
 *
 * Case A: Topo-exclusion via `targetHandle:'tools'` edge.
 *   Build Input → Text Template (linear) plus a tool edge from Text Template
 *   into an LLM Agent's `tools` handle. Agent will fail (no key) — that's
 *   fine; we only assert the template never ran *linearly* (it should be
 *   filtered from topo order). If the new edge contract works, the template
 *   emits zero `start` events.
 *
 * Case B: Legacy migration. Same flow but no tool edge — instead the agent
 *   has `config.tools = [tplId]`. Same assertion: the template must NOT run
 *   linearly because migrateLegacyTools materializes a synthetic tool edge
 *   that pulls it out of the linear order.
 *
 * Case C: Per-agent isolation. Two agents A and B, each with a different
 *   text-template wired in. Agent runs fail (no key) but we sniff that
 *   templates never fire linearly and that the *correct* tool is wired into
 *   each agent (cross-talk would mean both _tools lists contain both
 *   templates — we can't observe _tools directly, but we can at least
 *   assert no linear template starts).
 */
const BASE = process.env.BASE ?? 'http://localhost:4001';
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error('TOKEN env var required (a JWT from /api/auth/login).');
  process.exit(2);
}
const auth = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };

async function runFlow(flow, input) {
  const a = await fetch(`${BASE}/api/flows`, { method: 'POST', headers: auth, body: JSON.stringify(flow) });
  if (!a.ok) throw new Error(`flow PUT ${a.status}: ${await a.text()}`);
  const b = await fetch(`${BASE}/api/flows/${flow.id}/runs`, { method: 'POST', headers: auth, body: JSON.stringify({ input }) });
  if (!b.ok) throw new Error(`run POST ${b.status}: ${await b.text()}`);
  const { runId } = await b.json();
  const ws = new WebSocket(`ws://localhost:4001/ws/runs/${runId}/events`);
  const events = []; let end = null;
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 10000);
    ws.addEventListener('message', e => {
      const ev = JSON.parse(e.data); events.push(ev);
      if (ev.channel === 'meta' && ev.payload?.kind === 'run-end') { end = ev.payload; clearTimeout(t); ws.close(); res(); }
    });
    ws.addEventListener('error', () => rej(new Error('ws error')));
  });
  return { events, end };
}

function tplLinearStarts(events, tplId) {
  return events.filter(e => e.nodeId === tplId && e.kind === 'start' && e.channel !== 'tool-call');
}

let failed = 0;

// ── Case A: tool edge ──────────────────────────────────────────────────────
{
  console.log('\n=== A: edge-based tool (targetHandle:"tools") excludes from topo');
  const flow = {
    id: 'edge-tools-a-' + Math.random().toString(36).slice(2, 6),
    name: 'edge-tools-a',
    nodes: [
      { id: 'in',  type: 'input',         position: { x: 0, y: 0 },   config: { payload: 'seed' } },
      { id: 'tpl', type: 'text-template', position: { x: 200, y: 0 }, config: { template: '<<{{input}}>>' } },
      { id: 'agent', type: 'llm-agent',   position: { x: 0, y: 200 }, config: { model: 'gpt-4o-mini', maxIterations: 1 } },
    ],
    edges: [
      { id: 'flow-1', source: 'in',  target: 'tpl',   sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'tool-1', source: 'tpl', target: 'agent', sourceHandle: 'flow-out', targetHandle: 'tools'  },
    ],
  };
  const { events, end } = await runFlow(flow, 'go');
  const linear = tplLinearStarts(events, 'tpl');
  console.log(`  end=${end?.status} tpl linear-starts=${linear.length}`);
  if (linear.length !== 0) { console.log('  FAIL: tpl ran linearly when it should be tool-only'); failed++; }
  else console.log('  OK');
}

// ── Case B: legacy migration ───────────────────────────────────────────────
{
  console.log('\n=== B: legacy config.tools is migrated to a tool edge');
  const flow = {
    id: 'edge-tools-b-' + Math.random().toString(36).slice(2, 6),
    name: 'edge-tools-b',
    nodes: [
      { id: 'in',  type: 'input',         position: { x: 0, y: 0 },   config: { payload: 'seed' } },
      { id: 'tpl', type: 'text-template', position: { x: 200, y: 0 }, config: { template: '<<{{input}}>>' } },
      { id: 'agent', type: 'llm-agent',   position: { x: 0, y: 200 }, config: { model: 'gpt-4o-mini', maxIterations: 1, tools: ['tpl'] } },
    ],
    edges: [
      { id: 'flow-1', source: 'in', target: 'tpl', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  };
  const { events, end } = await runFlow(flow, 'go');
  const linear = tplLinearStarts(events, 'tpl');
  console.log(`  end=${end?.status} tpl linear-starts=${linear.length}`);
  if (linear.length !== 0) { console.log('  FAIL: legacy tools didn\'t migrate — tpl ran linearly'); failed++; }
  else console.log('  OK');
}

// ── Case C: two agents, per-agent isolation ────────────────────────────────
{
  console.log('\n=== C: two agents, distinct tools per agent — neither template runs linearly');
  const flow = {
    id: 'edge-tools-c-' + Math.random().toString(36).slice(2, 6),
    name: 'edge-tools-c',
    nodes: [
      { id: 'tplA', type: 'text-template', position: { x: 0, y: 0 },   config: { template: 'A({{input}})' } },
      { id: 'tplB', type: 'text-template', position: { x: 0, y: 100 }, config: { template: 'B({{input}})' } },
      { id: 'agentA', type: 'llm-agent',   position: { x: 200, y: 0 }, config: { model: 'gpt-4o-mini', maxIterations: 1 } },
      { id: 'agentB', type: 'llm-agent',   position: { x: 200, y: 100 }, config: { model: 'gpt-4o-mini', maxIterations: 1 } },
    ],
    edges: [
      { id: 'tA', source: 'tplA', target: 'agentA', sourceHandle: 'flow-out', targetHandle: 'tools' },
      { id: 'tB', source: 'tplB', target: 'agentB', sourceHandle: 'flow-out', targetHandle: 'tools' },
    ],
  };
  const { events, end } = await runFlow(flow, 'go');
  const linA = tplLinearStarts(events, 'tplA');
  const linB = tplLinearStarts(events, 'tplB');
  console.log(`  end=${end?.status} tplA linear=${linA.length} tplB linear=${linB.length}`);
  if (linA.length || linB.length) { console.log('  FAIL: tool node ran linearly'); failed++; }
  else console.log('  OK');
}

// ── Case D: connection that targets a non-tools handle behaves like flow ───
{
  console.log('\n=== D: edge with no targetHandle is still a normal flow edge');
  const flow = {
    id: 'edge-tools-d-' + Math.random().toString(36).slice(2, 6),
    name: 'edge-tools-d',
    nodes: [
      { id: 'in',  type: 'input',         position: { x: 0, y: 0 },   config: { payload: 'hello' } },
      { id: 'tpl', type: 'text-template', position: { x: 200, y: 0 }, config: { template: '<{{input}}>' } },
    ],
    edges: [
      { id: 'flow-1', source: 'in', target: 'tpl' },  // no handles
    ],
  };
  const { events, end } = await runFlow(flow, 'hi');
  const tplStart = events.find(e => e.nodeId === 'tpl' && e.kind === 'start');
  console.log(`  end=${end?.status} result=${JSON.stringify(end?.result)} tpl-started=${!!tplStart}`);
  if (end?.status !== 'succeeded') { console.log('  FAIL: simple flow didn\'t succeed'); failed++; }
  else if (!tplStart) { console.log('  FAIL: tpl never started — flow edges must be broken'); failed++; }
  else if (!String(end.result).includes('hi')) { console.log('  FAIL: tpl didn\'t see runtime input'); failed++; }
  else console.log('  OK');
}

console.log(`\n${failed === 0 ? 'ALL OK' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
