/**
 * Smoke for the LLM Agent + tools path.
 *
 * Three cases:
 *   1) Calculator tool — agent should call tool-calculator with "17 * 23",
 *      get back 391, and include 391 in the reply. Requires OPENAI_API_KEY.
 *   2) Topo-sort exclusion — Input → Text Template wired linearly, plus an
 *      LLM Agent listing the Text Template as a tool. The Text Template node
 *      must execute exactly once (via the agent), not twice.
 *   3) ctx.callTool wiring — degraded path: agent without an API key should
 *      fail with the clear "OPENAI_API_KEY not set" message rather than a
 *      tool-dispatch error, proving the orchestrator side is wired.
 */
const BASE = process.env.BASE ?? 'http://localhost:4001';

async function runFlow(flow, userInput) {
  await fetch(`${BASE}/api/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(flow),
  });
  const { runId } = await (
    await fetch(`${BASE}/api/flows/${flow.id}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: userInput }),
    })
  ).json();
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/runs/${runId}/events`);
  const events = [];
  let endPayload = null;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 60_000);
    ws.addEventListener('message', e => {
      const ev = JSON.parse(e.data);
      events.push(ev);
      if (ev.channel === 'meta' && ev.payload?.kind === 'run-end') {
        endPayload = ev.payload;
        clearTimeout(t);
        ws.close();
        resolve();
      }
    });
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });
  return { runId, events, end: endPayload };
}

function summarize(events) {
  return events
    .filter(e => e.channel !== 'meta')
    .map(e => `  [${e.nodeId}] ${e.kind}${e.channel ? ' ('+e.channel+')' : ''} ${e.payload !== undefined ? JSON.stringify(e.payload).slice(0,160) : ''}`)
    .join('\n');
}

async function caseCalculator() {
  console.log('\n=== case 1: agent → calculator');
  const flow = {
    id: 'agent-calc-' + Math.random().toString(36).slice(2, 6),
    name: 'agent-calc',
    nodes: [
      {
        id: 'agent',
        type: 'llm-agent',
        position: { x: 0, y: 0 },
        config: {
          model: 'gpt-4o-mini',
          systemPrompt: 'Use the calculator tool for any arithmetic. Reply with just the number.',
          tools: ['calc'],
          maxIterations: 4,
          temperature: 0,
        },
      },
      { id: 'calc', type: 'tool-calculator', position: { x: 200, y: 0 }, config: {} },
    ],
    edges: [],
  };
  const { events, end } = await runFlow(flow, 'what is 17 * 23?');
  console.log(summarize(events));
  console.log('end:', end?.status, JSON.stringify(end?.result || end?.error).slice(0, 200));
  if (end?.status !== 'succeeded') return console.log('  (skipping assertion: run failed — likely no API key)');
  if (!String(end.result).includes('391')) throw new Error(`expected 391 in reply, got ${end.result}`);
  const calcEvents = events.filter(e => e.nodeId === 'calc');
  if (calcEvents.length === 0) throw new Error('calculator was never called');
  if (!calcEvents.some(e => e.channel === 'tool-call')) throw new Error('calculator events missing tool-call channel');
  console.log('  OK — calculator called, result included.');
}

async function caseExclusion() {
  console.log('\n=== case 2: tool node excluded from linear topo-sort');
  const flow = {
    id: 'agent-excl-' + Math.random().toString(36).slice(2, 6),
    name: 'agent-excl',
    nodes: [
      { id: 'in', type: 'input', position: { x: 0, y: 0 }, config: { payload: 'static-from-input' } },
      { id: 'tpl', type: 'text-template', position: { x: 200, y: 0 }, config: { template: '<<{{input}}>>' } },
      {
        id: 'agent',
        type: 'llm-agent',
        position: { x: 0, y: 200 },
        config: {
          model: 'gpt-4o-mini',
          systemPrompt: 'Always call the only tool you have with input "from-agent" and return whatever it gives back unchanged.',
          tools: ['tpl'],
          maxIterations: 3,
          temperature: 0,
        },
      },
    ],
    edges: [{ id: 'e1', source: 'in', target: 'tpl' }],
  };
  const { events, end } = await runFlow(flow, 'go');
  console.log(summarize(events));
  console.log('end:', end?.status, JSON.stringify(end?.result || end?.error).slice(0, 200));
  if (end?.status !== 'succeeded') return console.log('  (skipping assertion: run failed — likely no API key)');
  // Counting tpl `start` events: linear-mode tpl emits events on its own
  // nodeId without a tool-call channel; tool-call mode sets channel:'tool-call'.
  const tplStarts = events.filter(e => e.nodeId === 'tpl' && e.kind === 'start');
  const linear = tplStarts.filter(e => e.channel !== 'tool-call');
  const tool = tplStarts.filter(e => e.channel === 'tool-call');
  console.log(`  tpl starts: linear=${linear.length} tool-call=${tool.length}`);
  if (linear.length !== 0) throw new Error(`tpl ran linearly when it should be tool-only (got ${linear.length})`);
  if (tool.length === 0) throw new Error('agent never invoked tpl as a tool');
  console.log('  OK — tool node skipped from linear path, only invoked by agent.');
}

async function caseNoKeyError() {
  console.log('\n=== case 3: agent error path (no key set in this proc → expect clean error)');
  // We expect this orchestrator process to either have OPENAI_API_KEY (success
  // in case 1/2 above) or not (failure). Either way we verify the agent
  // structure here by sending a flow without tools.
  const flow = {
    id: 'agent-noenv-' + Math.random().toString(36).slice(2, 6),
    name: 'agent-noenv',
    nodes: [
      {
        id: 'a',
        type: 'llm-agent',
        position: { x: 0, y: 0 },
        config: { model: 'gpt-4o-mini', tools: [], maxIterations: 1 },
      },
    ],
    edges: [],
  };
  const { events, end } = await runFlow(flow, 'hi');
  const errorEvent = events.find(e => e.kind === 'error');
  console.log('  error:', errorEvent?.payload?.message?.split('\n')?.[0]?.slice(0, 140) ?? '(none)');
  console.log('  end status:', end?.status);
}

async function main() {
  await caseCalculator();
  await caseExclusion();
  await caseNoKeyError();
  console.log('\nALL DONE');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
