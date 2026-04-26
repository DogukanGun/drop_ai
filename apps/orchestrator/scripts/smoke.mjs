/**
 * End-to-end smoke test for orchestrator v0.
 *
 * Creates a flow (input → browser-use), runs it, and prints every WS event
 * until the run ends. Exits non-zero if anything fails.
 */
// Uses the global WebSocket built into Node 21+.
const BASE = process.env.BASE ?? 'http://localhost:4001';

async function main() {
  const flow = {
    id: 'smoke-' + Math.random().toString(36).slice(2, 8),
    name: 'Smoke flow',
    nodes: [
      {
        id: 'in1',
        type: 'input',
        position: { x: 0, y: 0 },
        config: { payload: 'find the top story on hacker news' },
      },
      {
        id: 'bu1',
        type: 'browser-use',
        position: { x: 200, y: 0 },
        config: { task: 'find the top story on hacker news', maxSteps: 4 },
      },
    ],
    edges: [{ id: 'e1', source: 'in1', target: 'bu1' }],
  };

  const createRes = await fetch(`${BASE}/api/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(flow),
  });
  if (!createRes.ok) throw new Error('create flow failed: ' + createRes.status);
  const { id } = await createRes.json();
  console.log('flow created:', id);

  const runRes = await fetch(`${BASE}/api/flows/${id}/runs`, { method: 'POST' });
  if (!runRes.ok) throw new Error('start run failed: ' + runRes.status);
  const { runId } = await runRes.json();
  console.log('run started:', runId);

  const wsUrl = BASE.replace(/^http/, 'ws') + `/ws/runs/${runId}/events`;
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 15000);
    let endSeen = false;
    ws.addEventListener('open', () => console.log('ws open'));
    ws.addEventListener('message', e => {
      const ev = JSON.parse(e.data);
      console.log(`  [${ev.nodeId}] ${ev.kind}${ev.channel ? ' ('+ev.channel+')' : ''}`,
        ev.payload !== undefined ? JSON.stringify(ev.payload) : '');
      if (ev.channel === 'meta' && ev.payload?.kind === 'run-end') {
        endSeen = true;
        ws.close();
      }
    });
    ws.addEventListener('close', () => {
      clearTimeout(timer);
      if (endSeen) resolve();
      else reject(new Error('ws closed before run-end'));
    });
    ws.addEventListener('error', e => {
      clearTimeout(timer);
      reject(new Error('ws error'));
    });
  });

  console.log('OK');
}

main().catch(err => {
  console.error('SMOKE FAILED:', err);
  process.exit(1);
});
