/**
 * Verifies each real Python plugin is reachable through the bridge and surfaces
 * a clean, actionable error when its setup is missing (no API keys, no Chrome,
 * no hosted maestro). Each node should emit `start` then `error` then trigger
 * `run-end` with status "failed" — that's the contract the viz panel relies on.
 */
const BASE = process.env.BASE ?? 'http://localhost:4001';

const cases = [
  { type: 'browser-use', config: { task: 'noop', model: 'gpt-4o-mini' } },
  { type: 'knowledge-graph', config: { text: 'Alice met Bob at the cafe.', model: 'gpt-4o-mini' } },
  { type: 'browser-harness', config: { code: 'print(page_info())' } },
  { type: 'maestro', config: { task: 'noop', baseUrl: 'http://127.0.0.1:9' } },
];

async function runCase(c) {
  const flow = {
    id: 'err-' + c.type + '-' + Math.random().toString(36).slice(2, 6),
    name: c.type + ' error path',
    nodes: [{ id: 'n', type: c.type, position: { x: 0, y: 0 }, config: c.config }],
    edges: [],
  };
  await fetch(`${BASE}/api/flows`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(flow),
  });
  const { runId } = await (await fetch(`${BASE}/api/flows/${flow.id}/runs`, { method: 'POST' })).json();
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/runs/${runId}/events`);
  const events = [];
  await new Promise(res => {
    const t = setTimeout(res, 12000);
    ws.addEventListener('message', e => {
      const ev = JSON.parse(e.data);
      events.push(ev);
      if (ev.channel === 'meta' && ev.payload?.kind === 'run-end') { clearTimeout(t); ws.close(); res(); }
    });
  });
  return events;
}

async function main() {
  for (const c of cases) {
    const events = await runCase(c);
    const start = events.find(e => e.kind === 'start');
    const error = events.find(e => e.kind === 'error');
    const end = events.find(e => e.channel === 'meta' && e.payload?.kind === 'run-end');
    const status = end?.payload?.status ?? 'no-end';
    const msg = (error?.payload?.message ?? end?.payload?.error ?? '').toString().split('\n')[0].slice(0, 120);
    console.log(`${c.type.padEnd(18)} start=${start ? 'yes' : 'no '} error=${error ? 'yes' : 'no '} status=${status}`);
    console.log(`   first line: ${msg}`);
  }
}

main().catch(err => { console.error('failed:', err); process.exit(1); });
