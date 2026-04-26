import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginPackage, RunCtx } from '@dropai/runtime-core';
import { config as appConfig } from '../config.js';

/**
 * Resolves a Python interpreter to use for a plugin, preferring per-plugin and
 * shared venvs over system Python so plugin deps stay isolated.
 */
function resolvePython(plugin: PluginPackage): string {
  const candidates = [
    join(plugin.packageRoot, '.venv/bin/python'),
    join(workerRoot(), '.venv/bin/python'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return process.env.PYTHON ?? 'python3';
}

function workerRoot(): string {
  // apps/orchestrator/src/runtime/pythonBridge.ts → workers/python-runner
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../../workers/python-runner');
}

interface BridgeMessage {
  kind: 'event' | 'log' | 'result' | 'error';
  event?: { kind: string; channel?: string; payload?: unknown };
  level?: string;
  message?: string;
  meta?: unknown;
  result?: unknown;
  traceback?: string;
}

/**
 * Spawns the python-runner with a job spec on stdin and forwards bridge messages
 * onto the run context. Resolves with the plugin's `result` value, or rejects
 * with the structured error the plugin reported.
 *
 * Aborts the subprocess if `ctx.signal` fires.
 */
export function callPythonPlugin(
  plugin: PluginPackage,
  ctx: RunCtx,
  config: Record<string, unknown>,
  msg: unknown,
): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const python = resolvePython(plugin);
    const runnerEntry = join(workerRoot(), 'dropai_python_runner', '__main__.py');
    if (!existsSync(runnerEntry)) {
      reject(new Error(`python-runner missing at ${runnerEntry}`));
      return;
    }

    const proc = spawn(python, ['-u', runnerEntry], {
      cwd: plugin.packageRoot,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        // Per-run artifact dir; plugins can write files there and emit a URL like
        // /api/artifacts/<runId>/<file>.
        DROPAI_ARTIFACTS_DIR: resolve(appConfig.artifactsDir, ctx.runId),
        DROPAI_RUN_ID: ctx.runId,
        DROPAI_NODE_ID: ctx.nodeId,
      },
    });

    const spec = {
      entry: plugin.manifest.runtime,
      pluginRoot: plugin.packageRoot,
      runId: ctx.runId,
      nodeId: ctx.nodeId,
      config,
      msg,
    };
    proc.stdin.write(JSON.stringify(spec) + '\n');
    proc.stdin.end();

    let resultValue: unknown = undefined;
    let errorMessage: string | null = null;
    let errorTraceback: string | null = null;

    let stdoutBuffer = '';
    proc.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, nl);
        stdoutBuffer = stdoutBuffer.slice(nl + 1);
        if (!line.trim()) continue;
        let m: BridgeMessage;
        try {
          m = JSON.parse(line);
        } catch {
          ctx.log('warn', `[python] non-json on stdout: ${line.slice(0, 200)}`);
          continue;
        }
        if (m.kind === 'event' && m.event) {
          ctx.emit({
            kind: m.event.kind as never,
            channel: m.event.channel,
            payload: m.event.payload,
          });
        } else if (m.kind === 'log') {
          const level = (m.level ?? 'info') as 'debug' | 'info' | 'warn' | 'error';
          ctx.log(level, `[python] ${m.message ?? ''}`, m.meta);
        } else if (m.kind === 'result') {
          resultValue = m.result;
        } else if (m.kind === 'error') {
          errorMessage = m.message ?? 'python plugin error';
          errorTraceback = m.traceback ?? null;
        }
      }
    });

    let stderrBuffer = '';
    proc.stderr.on('data', chunk => {
      stderrBuffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = stderrBuffer.indexOf('\n')) !== -1) {
        const line = stderrBuffer.slice(0, nl);
        stderrBuffer = stderrBuffer.slice(nl + 1);
        if (line.trim()) ctx.log('warn', `[python:stderr] ${line.trim()}`);
      }
    });

    proc.on('error', err => reject(err));

    proc.on('close', code => {
      if (code === 0 && errorMessage === null) {
        resolvePromise(resultValue);
      } else {
        const detail = errorTraceback ? `\n${errorTraceback}` : '';
        reject(new Error(`${errorMessage ?? `python exited ${code}`}${detail}`));
      }
    });

    const onAbort = () => {
      try {
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 2_000).unref();
      } catch {
        // process may have already exited
      }
    };
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener('abort', onAbort, { once: true });
  });
}
