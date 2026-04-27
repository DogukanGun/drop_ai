/**
 * Fetch tool — GETs a URL and returns the body text capped to maxChars.
 * Mostly used as an LLM Agent tool ("go read this URL"), but works as a
 * regular linear node too.
 */
export async function run(ctx, config, msg) {
  const url = (typeof msg === 'string' && msg.trim()) || String(config.url || '').trim();
  if (!url) throw new Error('fetch tool needs a URL (input or config.url)');

  const maxChars = Math.max(100, Number(config.maxChars ?? 5000));

  ctx.emit({ kind: 'start', payload: { url, maxChars } });

  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'DropAI-Fetch/0.0.1' },
  });
  if (!res.ok) {
    throw new Error(`fetch ${res.status}: ${res.statusText}`);
  }
  const raw = await res.text();
  const text = raw.length > maxChars ? raw.slice(0, maxChars) + '\n…(truncated)' : raw;

  ctx.emit({
    kind: 'output',
    payload: { url, status: res.status, bytes: raw.length, preview: text.slice(0, 200) },
  });
  ctx.emit({ kind: 'end' });
  return text;
}
