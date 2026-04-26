import type { AgentEvent, FlowDef, RunCtx, RunId } from '@dropai/runtime-core';
import { eventBus } from './eventBus.js';
import { topoSort, predecessors } from './topoSort.js';
import { callNodeRuntime, nodeRegistry } from '../nodes/loader.js';
import { setRunStatus } from '../db/flows.js';

export interface RunHandle {
  runId: RunId;
  abort(): void;
  done: Promise<void>;
}

export function startRun(flow: FlowDef, runId: RunId): RunHandle {
  const controller = new AbortController();
  const outputs = new Map<string, unknown>();

  const done = (async () => {
    publishMeta(runId, 'meta', { kind: 'run-start', flowId: flow.id });
    await setRunStatus(runId, 'running');
    try {
      const order = topoSort(flow);
      for (const nodeId of order) {
        if (controller.signal.aborted) throw new Error('aborted');
        const node = flow.nodes.find(n => n.id === nodeId);
        if (!node) continue;
        const inputMsg = collectInput(flow, nodeId, outputs);
        const ctx: RunCtx = makeCtx(runId, nodeId, controller.signal);
        try {
          const result = await callNodeRuntime(node.type, ctx, node.config, inputMsg);
          outputs.set(nodeId, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.emit({ kind: 'error', payload: { message } });
          // surface upstream so the run is marked failed
          throw err;
        }
      }
      await setRunStatus(runId, 'succeeded');
      publishMeta(runId, 'meta', { kind: 'run-end', status: 'succeeded' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setRunStatus(runId, 'failed', message);
      publishMeta(runId, 'meta', { kind: 'run-end', status: 'failed', error: message });
    }
  })();

  return {
    runId,
    abort: () => controller.abort(),
    done,
  };
}

function collectInput(flow: FlowDef, nodeId: string, outputs: Map<string, unknown>): unknown {
  const preds = predecessors(flow, nodeId);
  if (preds.length === 0) return null;
  if (preds.length === 1) return outputs.get(preds[0]!) ?? null;
  return preds.map(p => outputs.get(p) ?? null);
}

function makeCtx(runId: RunId, nodeId: string, signal: AbortSignal): RunCtx {
  return {
    runId,
    nodeId,
    signal,
    emit(event) {
      const full: AgentEvent = {
        flowRunId: runId,
        nodeId,
        ts: Date.now(),
        kind: event.kind,
        channel: event.channel,
        payload: event.payload,
      };
      eventBus.publish(full);
    },
    log(level, message, meta) {
      // stdout for now; structured logging is a later concern
      console.log(`[${runId}] [${nodeId}] [${level}] ${message}`, meta ?? '');
    },
  };
}

function publishMeta(runId: RunId, nodeId: string, payload: { kind: string; [k: string]: unknown }) {
  eventBus.publish({
    flowRunId: runId,
    nodeId,
    ts: Date.now(),
    kind: 'progress',
    channel: 'meta',
    payload,
  });
}
