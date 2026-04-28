/**
 * Qwen LLM node — single-shot chat completion routed through the DropAI
 * remote proxy. Users must supply a purchased DropAI API token in `dropaiToken`.
 *
 * The proxy base URL is read from DROPAI_PROXY_URL (set by the operator).
 * It must expose an OpenAI-compatible /chat/completions endpoint.
 */

const TEMPLATE_INPUT = /\{\{\s*input\s*\}\}/g;

export async function run(ctx, config, msg) {
  const token = String(config.dropaiToken || '').trim();
  if (!token) {
    throw new Error(
      'No DropAI token configured. Purchase a token at dropai.io and paste it into the "DropAI Token" field.',
    );
  }

  const baseUrl = (process.env.DROPAI_PROXY_URL || '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error(
      'DROPAI_PROXY_URL is not set. The operator must configure the proxy endpoint.',
    );
  }

  const model = String(config.model || 'qwen2.5-72b-instruct');
  const systemPrompt = String(config.systemPrompt || 'You are a helpful assistant.');
  const userPromptTemplate = String(config.userPromptTemplate || '{{input}}');
  const temperature = Number(config.temperature ?? 0.7);
  const maxTokens = Number(config.maxTokens ?? 1024);

  const upstream = stringifyMsg(msg);
  const userContent = userPromptTemplate.replace(TEMPLATE_INPUT, upstream);

  ctx.emit({
    kind: 'start',
    payload: {
      model,
      temperature,
      systemPreview: systemPrompt.slice(0, 80),
      userPreview: userContent.slice(0, 200),
    },
  });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Qwen API ${res.status}: ${text.slice(0, 300) || res.statusText}`);
  }

  const body = await res.json();
  const reply = body?.choices?.[0]?.message?.content?.trim?.() || '';
  const usage = body?.usage || null;

  ctx.emit({ kind: 'output', payload: reply });
  if (usage) ctx.emit({ kind: 'progress', payload: { usage } });
  ctx.emit({ kind: 'end' });
  return reply;
}

function stringifyMsg(msg) {
  if (msg == null) return '';
  if (typeof msg === 'string') return msg;
  try {
    return JSON.stringify(msg);
  } catch {
    return String(msg);
  }
}
