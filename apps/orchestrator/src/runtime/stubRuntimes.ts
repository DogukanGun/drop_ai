import type { RunCtx } from '@dropai/runtime-core';

/**
 * Editor-v0 stubs. Each "executes" a node in-process without doing real work
 * so we can verify the topo-sort, event stream, and viz wiring end-to-end
 * before the python-runner lands (step 7).
 */
export type StubRunner = (ctx: RunCtx, config: Record<string, unknown>, msg: unknown) => Promise<unknown>;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const STUB_RUNTIMES: Record<string, StubRunner> = {
  input: async (ctx, config) => {
    ctx.emit({ kind: 'start' });
    await sleep(120);
    const payload = config.payload ?? null;
    ctx.emit({ kind: 'output', payload });
    ctx.emit({ kind: 'end' });
    return payload;
  },

  'browser-use': async (ctx, config) => {
    const task = String(config.task ?? '');
    ctx.emit({ kind: 'start', payload: { task } });
    for (let step = 1; step <= 4; step++) {
      if (ctx.signal.aborted) throw new Error('aborted');
      await sleep(300);
      ctx.emit({
        kind: 'progress',
        payload: { step, action: 'click', screenshotUrl: null },
      });
    }
    const result = { finalText: `(stub) result for: ${task}` };
    ctx.emit({ kind: 'output', payload: result });
    ctx.emit({ kind: 'end' });
    return result;
  },

  maestro: async (ctx, config) => {
    const task = String(config.task ?? '');
    ctx.emit({ kind: 'start', payload: { task, model: config.model } });
    for (const phase of ['planning', 'research', 'reflection', 'writing']) {
      if (ctx.signal.aborted) throw new Error('aborted');
      ctx.emit({ kind: 'progress', payload: { phase } });
      await sleep(400);
    }
    const reportMd = `# (stub) report\n\nTask: ${task}\n`;
    ctx.emit({ kind: 'output', payload: { reportMd, sources: [] } });
    ctx.emit({ kind: 'end' });
    return { reportMd, sources: [] };
  },

  'browser-harness': async (ctx, config) => {
    ctx.emit({ kind: 'start' });
    await sleep(200);
    const stdout = `(stub) ran code:\n${String(config.code ?? '')}`;
    ctx.emit({ kind: 'output', payload: { stdout, stderr: '' } });
    ctx.emit({ kind: 'end' });
    return { stdout, stderr: '' };
  },

  'knowledge-graph': async (ctx, config) => {
    ctx.emit({ kind: 'start' });
    await sleep(300);
    const text = String(config.text ?? '');
    const triples = text
      .split('.')
      .filter(s => s.trim().length > 0)
      .slice(0, 3)
      .map((s, i) => ({ subject: `node${i}`, predicate: 'mentions', object: s.trim() }));
    ctx.emit({ kind: 'output', payload: { triples, htmlPath: null } });
    ctx.emit({ kind: 'end' });
    return { triples, htmlPath: null };
  },
};
