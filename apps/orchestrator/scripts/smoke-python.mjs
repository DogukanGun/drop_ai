/**
 * Smokes the python-runner bridge: input → echo (Python plugin) → text-template.
 * Confirms a Python plugin's events stream live and its return value flows
 * downstream into a Node plugin without changes anywhere in the orchestrator.
 */
const BASE = process.env.BASE ?? 'http://localhost:4001';

async function main() {
  const flow = {
    id: 'smoke-py-' + Math.random().toString(36).slice(2, 8),
    name: 'Python bridge smoke',
    nodes: [
      { id: 'in1', type: 'input', position: { x: 0, y: 0 }, config: { payload: 'world' } },
      { id: 'py1', type: 'echo', position: { x: 200, y: 0 }, config: { prefix: 'hello, ' } },
      { id: 'tpl', type: 'text-template', position: { x: 400, y: 0 }, config: { template: '[{{input}}]' } },
    ],
    edges: [
      { id: 'e1', source: 'in1', target: 'py1' },
      { id: 'e2', source: 'py1', target: 'tpl' },
    ],
  };

  await fetch(`${BASE}/api/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(flow),
  });

  const { runId } = await (await fetch(`${BASE}/api/flows/${flow.id}/runs`, { method: 'POST' })).json();
  console.log('run:', runId);

  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/runs/${runId}/events`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 15000);
    let lastTplOutput = null;
    ws.addEventListener('message', e => {
      const ev = JSON.parse(e.data);
      console.log(`  [${ev.nodeId}] ${ev.kind}`, ev.payload !== undefined ? JSON.stringify(ev.payload) : '');
      if (ev.nodeId === 'tpl' && ev.kind === 'output') lastTplOutput = ev.payload;
      if (ev.channel === 'meta' && ev.payload?.kind === 'run-end') {
        clearTimeout(timer);
        ws.close();
        if (ev.payload.status === 'succeeded' && lastTplOutput === '[hello, world]') resolve();
        else reject(new Error(`unexpected: status=${ev.payload.status} output=${JSON.stringify(lastTplOutput)}`));
      }
    });
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });

  console.log('OK');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
