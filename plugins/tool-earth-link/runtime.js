export async function run(ctx, config, msg) {
  const token = String(config.dropaiToken || '').trim();
  if (!token) throw new Error('No DropAI token. Purchase one at dropai.io and paste it into the node config.');
  const baseUrl = (process.env.DROPAI_PROXY_URL || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('DROPAI_PROXY_URL is not configured on the orchestrator.');

  ctx.emit({ kind: 'start', payload: { tool: 'tool-earth-link', dataType: config.dataType } });

  const res = await fetch(`${baseUrl}/tools/earth-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      input: stringifyMsg(msg),
      dataType: config.dataType || 'climate',
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`EarthLink ${res.status}: ${t.slice(0, 300) || res.statusText}`);
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
