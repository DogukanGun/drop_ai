export async function run(ctx, config, msg) {
  const token = String(config.dropaiToken || '').trim();
  if (!token) throw new Error('No DropAI token. Purchase one at dropai.io and paste it into the node config.');
  const baseUrl = (process.env.DROPAI_PROXY_URL || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('DROPAI_PROXY_URL is not configured on the orchestrator.');

  const scope = String(config.scope || '').trim();
  if (!scope) throw new Error('Pentagi requires a defined scope. Only run against authorized targets.');

  ctx.emit({ kind: 'start', payload: { tool: 'tool-pentagi', targetUrl: config.targetUrl } });

  const res = await fetch(`${baseUrl}/tools/pentagi`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      input: stringifyMsg(msg),
      scope: config.scope,
      targetUrl: config.targetUrl || '',
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Pentagi ${res.status}: ${t.slice(0, 300) || res.statusText}`);
  }

  const body = await res.json();
  const result = body.result ?? body.output ?? body;
  ctx.emit({ kind: 'output', payload: result });
  ctx.emit({ kind: 'end' });
  return result;
}

function stringifyMsg(msg) {
  if (msg == null) return '';
  if (typeof msg === 'string') return msg;
  try { return JSON.stringify(msg); } catch { return String(msg); }
}
