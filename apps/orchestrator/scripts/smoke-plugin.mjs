/**
 * Verifies the plugin loader: builds a flow that uses the third-party
 * `text-template` plugin and confirms its output flows downstream.
 */
const BASE = process.env.BASE ?? 'http://localhost:4001';

async function main() {
  const flow = {
    id: 'smoke-plugin-' + Math.random().toString(36).slice(2, 8),
    name: 'Plugin smoke',
    nodes: [
      { id: 'in1', type: 'input', position: { x: 0, y: 0 }, config: { payload: 'world' } },
      { id: 'tpl', type: 'text-template', position: { x: 200, y: 0 }, config: { template: 'Hello {{input}}!' } },
    ],
    edges: [{ id: 'e1', source: 'in1', target: 'tpl' }],
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
    const timer = setTimeout(() => reject(new Error('timeout')), 8000);
    let lastTplOutput = null;
    ws.addEventListener('message', e => {
      const ev = JSON.parse(e.data);
      console.log(`  [${ev.nodeId}] ${ev.kind}`, ev.payload !== undefined ? JSON.stringify(ev.payload) : '');
      if (ev.nodeId === 'tpl' && ev.kind === 'output') lastTplOutput = ev.payload;
      if (ev.channel === 'meta' && ev.payload?.kind === 'run-end') {
        clearTimeout(timer);
        ws.close();
        if (lastTplOutput === 'Hello world!') resolve();
        else reject(new Error('unexpected output: ' + JSON.stringify(lastTplOutput)));
      }
    });
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });

  console.log('OK');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
