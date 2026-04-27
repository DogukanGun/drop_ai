import type { AgentEvent, FlowDef, NodeManifest } from '@dropai/runtime-core';

export async function fetchNodeManifests(): Promise<NodeManifest[]> {
  const res = await fetch('/api/nodes');
  if (!res.ok) throw new Error(`fetchNodeManifests: ${res.status}`);
  return res.json();
}

export async function saveFlow(flow: FlowDef): Promise<{ id: string }> {
  const res = await fetch('/api/flows', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(flow),
  });
  if (!res.ok) throw new Error(`saveFlow: ${res.status}`);
  return res.json();
}

export async function startRun(
  flowId: string,
  body?: { input?: unknown },
): Promise<{ runId: string }> {
  const res = await fetch(`/api/flows/${flowId}/runs`, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`startRun: ${res.status}`);
  return res.json();
}

export async function fetchMemory(flowId: string): Promise<{ triples: { subject: string; predicate: string; object: string; ts: number }[] }> {
  const res = await fetch(`/api/flows/${flowId}/memory`);
  if (!res.ok) throw new Error(`fetchMemory: ${res.status}`);
  return res.json();
}

export function subscribeToRun(runId: string, onEvent: (e: AgentEvent) => void): () => void {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws/runs/${runId}/events`;
  const ws = new WebSocket(url);
  ws.addEventListener('message', e => {
    try {
      onEvent(JSON.parse(e.data) as AgentEvent);
    } catch {
      // ignore malformed
    }
  });
  return () => ws.close();
}
