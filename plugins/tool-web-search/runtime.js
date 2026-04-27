/**
 * Web search tool — wraps Tavily's /search endpoint.
 * Env: TAVILY_API_KEY (required).
 */
const TAVILY_URL = 'https://api.tavily.com/search';

export async function run(ctx, config, msg) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is not set. Get one at tavily.com and export it in the orchestrator env.');
  }

  const query = (typeof msg === 'string' && msg.trim()) || String(config.query || '').trim();
  if (!query) throw new Error('web search tool needs a query (input or config.query)');

  const maxResults = Math.max(1, Math.min(10, Number(config.maxResults ?? 5)));
  const searchDepth = ['basic', 'advanced'].includes(config.searchDepth)
    ? config.searchDepth
    : 'basic';

  ctx.emit({ kind: 'start', payload: { query, maxResults, searchDepth } });

  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: searchDepth,
      include_answer: false,
      include_raw_content: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Tavily ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  const body = await res.json();
  const results = Array.isArray(body?.results) ? body.results : [];

  const formatted = results.length === 0
    ? `(no results for "${query}")`
    : results
        .map(r => `- ${r.title}\n  ${r.url}\n  ${(r.content || '').slice(0, 240).replace(/\s+/g, ' ').trim()}`)
        .join('\n\n');

  ctx.emit({
    kind: 'output',
    payload: { query, count: results.length, preview: formatted.slice(0, 240) },
  });
  ctx.emit({ kind: 'end' });
  return formatted;
}
