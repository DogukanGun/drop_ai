/**
 * Trivial node: substitutes {{input}} in `config.template` with the upstream
 * payload (or {{input.field}} for object payloads). Exists to verify the
 * plugin loader picks up third-party packages from /plugins/* without code
 * changes elsewhere.
 */
export async function run(ctx, config, msg) {
  ctx.emit({ kind: 'start' });
  const tpl = String(config.template ?? '{{input}}');
  const out = tpl.replace(/\{\{\s*input(?:\.([\w.]+))?\s*\}\}/g, (_m, path) => {
    if (!path) return stringify(msg);
    const parts = path.split('.');
    let v = msg;
    for (const p of parts) {
      if (v == null) return '';
      v = v[p];
    }
    return stringify(v);
  });
  ctx.emit({ kind: 'output', payload: out });
  ctx.emit({ kind: 'end' });
  return out;
}

function stringify(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
