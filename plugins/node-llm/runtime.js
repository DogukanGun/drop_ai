/**
 * LLM node — single-shot chat completion against any OpenAI-compatible API.
 *
 * Source-capable: if no upstream node feeds it, the chat-message runtime input
 * (or static config) becomes the user content. Used in a chain it transforms
 * the upstream output through the configured prompt.
 *
 * Required env: OPENAI_API_KEY (or whatever the configured baseUrl accepts).
 */

const TEMPLATE_INPUT = /\{\{\s*input\s*\}\}/g;

export async function run(ctx, config, msg) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set. Export it in the orchestrator environment.',
    );
  }

  const model = String(config.model || 'gpt-4o-mini');
  const systemPrompt = String(config.systemPrompt || 'You are a helpful assistant.');
  const userPromptTemplate = String(config.userPromptTemplate || '{{input}}');
  const temperature = Number(config.temperature ?? 0.7);
  const maxTokens = Number(config.maxTokens ?? 1024);
  const baseUrl = String(config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');

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
      authorization: `Bearer ${apiKey}`,
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
    throw new Error(`LLM API ${res.status}: ${text.slice(0, 300) || res.statusText}`);
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
