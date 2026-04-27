/**
 * Smoke for the chatbot path: send a runtime input through a flow, capture the
 * sink output from the run-end meta event, and verify it matches what we'd
 * expect the agent to "reply".
 *
 * Flow: input → echo (Python plugin, prefix="reply: ") → text-template ("[ {{input}} ]")
 * User input: "hello world"
 * Expected reply: "[ reply: hello world ]"
 */
const BASE = process.env.BASE ?? 'http://localhost:4001';

async function main() {
  const flow = {
    id: 'smoke-chat-' + Math.random().toString(36).slice(2, 6),
    name: 'Chat smoke',
    nodes: [
      { id: 'in1', type: 'input', position: { x: 0, y: 0 }, config: {} },
      { id: 'py', type: 'echo', position: { x: 200, y: 0 }, config: { prefix: 'reply: ' } },
      { id: 'tpl', type: 'text-template', position: { x: 400, y: 0 }, config: { template: '[ {{input}} ]' } },
    ],
    edges: [
      { id: 'e1', source: 'in1', target: 'py' },
      { id: 'e2', source: 'py', target: 'tpl' },
    ],
  };

  await fetch(`${BASE}/api/flows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(flow),
  });

  const userInput = 'hello world';
  const { runId } = await (
    await fetch(`${BASE}/api/flows/${flow.id}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: userInput }),
    })
  ).json();
  console.log('run:', runId, 'input:', userInput);

  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/runs/${runId}/events`);
  const result = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 15000);
    ws.addEventListener('message', e => {
      const ev = JSON.parse(e.data);
      console.log(`  [${ev.nodeId}] ${ev.kind}`,
        ev.payload !== undefined ? JSON.stringify(ev.payload).slice(0, 140) : '');
      if (ev.channel === 'meta' && ev.payload?.kind === 'run-end') {
        clearTimeout(t);
        ws.close();
        if (ev.payload.status === 'succeeded') resolve(ev.payload.result);
        else reject(new Error(ev.payload.error || 'failed'));
      }
    });
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });

  console.log('reply:', JSON.stringify(result));
  if (result !== '[ reply: hello world ]') {
    throw new Error(`expected "[ reply: hello world ]", got ${JSON.stringify(result)}`);
  }
  console.log('OK');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
