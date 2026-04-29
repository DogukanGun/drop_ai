import type { AgentEvent, FlowDef, NodeManifest } from '@dropai/runtime-core';

const TOKEN_KEY = 'dropai.auth.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function guardedFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    clearToken();
    window.location.reload();
  }
  return res;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
}

export async function apiRegister(
  email: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `register: ${res.status}`);
  }
  return res.json();
}

export async function apiLogin(
  email: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `login: ${res.status}`);
  }
  return res.json();
}

// ── Flows & runs ──────────────────────────────────────────────────────────────

export async function fetchNodeManifests(): Promise<NodeManifest[]> {
  const res = await guardedFetch('/api/nodes');
  if (!res.ok) throw new Error(`fetchNodeManifests: ${res.status}`);
  return res.json();
}

export async function saveFlow(flow: FlowDef): Promise<{ id: string }> {
  const res = await guardedFetch('/api/flows', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(flow),
  });
  if (!res.ok) throw new Error(`saveFlow: ${res.status}`);
  return res.json();
}

export async function downloadFlow(flowId: string, fallbackName: string): Promise<void> {
  const res = await guardedFetch(`/api/flows/${flowId}/download`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `download: ${res.status}`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `${fallbackName || 'dropai-flow'}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function startRun(
  flowId: string,
  body?: { input?: unknown },
): Promise<{ runId: string }> {
  const res = await guardedFetch(`/api/flows/${flowId}/runs`, {
    method: 'POST',
    headers: { ...authHeaders(), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`startRun: ${res.status}`);
  return res.json();
}

export async function fetchMemory(flowId: string): Promise<{ triples: { subject: string; predicate: string; object: string; ts: number }[] }> {
  const res = await guardedFetch(`/api/flows/${flowId}/memory`, {
    headers: authHeaders(),
  });
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
