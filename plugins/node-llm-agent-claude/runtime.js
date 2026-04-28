/**
 * Claude Agent — runs a tool-calling loop via the DropAI remote proxy.
 * Users must supply a purchased DropAI API token in `dropaiToken`.
 *
 * The proxy base URL is read from DROPAI_PROXY_URL (set by the operator).
 * It must expose an OpenAI-compatible /chat/completions endpoint.
 *
 * The orchestrator injects `config._tools` — resolved tool node summaries
 * the user picked in the inspector.
 */

const NAME_SAFE = /[^a-zA-Z0-9_-]/g;

export async function run(ctx, config, msg) {
  const token = String(config.dropaiToken || '').trim();
  if (!token) {
    throw new Error(
      'No DropAI token configured. Purchase a token at dropai.io and paste it into the "DropAI Token" field.',
    );
  }
  if (typeof ctx.callTool !== 'function') {
    throw new Error(
      'This orchestrator does not support tool dispatch. The Claude Agent needs ctx.callTool.',
    );
  }

  const baseUrl = (process.env.DROPAI_PROXY_URL || 'https://api.anthropic.com/v1').replace(/\/$/, '');
  const model = String(config.model || 'claude-sonnet-4-6');
  const systemPrompt = String(config.systemPrompt || 'You are a helpful agent.');
  const temperature = Number(config.temperature ?? 0.3);
  const maxTokens = Number(config.maxTokens ?? 1024);
  const maxIterations = Math.max(1, Number(config.maxIterations ?? 6));
  const resolvedTools = Array.isArray(config._tools) ? config._tools : [];

  const tools = resolvedTools.map(t => ({
    type: 'function',
    function: {
      name: sanitizeName(t.nodeId),
      description: `${t.label}: ${t.description || t.type}`.slice(0, 1024),
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Single string input passed to the tool' },
        },
        required: ['input'],
      },
    },
  }));
  const nameToNodeId = new Map(resolvedTools.map(t => [sanitizeName(t.nodeId), t.nodeId]));

  const userContent = stringifyMsg(msg);
  ctx.emit({
    kind: 'start',
    payload: {
      model,
      tools: resolvedTools.map(t => ({ nodeId: t.nodeId, type: t.type })),
      maxIterations,
    },
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent || '' },
  ];

  let finalText = '';
  for (let iter = 1; iter <= maxIterations; iter++) {
    if (ctx.signal.aborted) throw new Error('aborted');
    ctx.emit({ kind: 'progress', payload: { phase: 'iteration', iteration: iter } });

    const body = {
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
    };
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Claude API ${res.status}: ${text.slice(0, 300) || res.statusText}`);
    }

    const completion = await res.json();
    const choice = completion?.choices?.[0];
    const message = choice?.message ?? {};
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (toolCalls.length === 0) {
      finalText = (message.content || '').trim();
      break;
    }

    messages.push(message);
    ctx.emit({
      kind: 'progress',
      payload: {
        phase: 'tool-calls',
        iteration: iter,
        calls: toolCalls.map(c => ({ name: c.function?.name, args: c.function?.arguments })),
      },
    });

    for (const call of toolCalls) {
      const name = call.function?.name || '';
      const targetNodeId = nameToNodeId.get(name);
      let result;
      if (!targetNodeId) {
        result = `error: unknown tool "${name}"`;
      } else {
        let parsed = {};
        try {
          parsed = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          parsed = {};
        }
        const input = typeof parsed.input === 'string' ? parsed.input : stringifyMsg(parsed);
        try {
          const out = await ctx.callTool(targetNodeId, input);
          result = stringifyResult(out);
        } catch (err) {
          result = `error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.slice(0, 8000),
      });
    }
  }

  if (!finalText) {
    finalText = '(agent did not produce a reply within maxIterations)';
  }
  ctx.emit({ kind: 'output', payload: finalText });
  ctx.emit({ kind: 'end' });
  return finalText;
}

function sanitizeName(s) {
  return String(s).replace(NAME_SAFE, '_').slice(0, 64) || 'tool';
}

function stringifyMsg(m) {
  if (m == null) return '';
  if (typeof m === 'string') return m;
  try {
    return JSON.stringify(m);
  } catch {
    return String(m);
  }
}

function stringifyResult(r) {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (typeof r === 'object') {
    const obj = r;
    for (const k of ['finalText', 'reportMd', 'text', 'output', 'stdout']) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
  }
  try {
    return JSON.stringify(r);
  } catch {
    return String(r);
  }
}
