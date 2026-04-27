import type { AgentEvent, FlowDef, FlowNode, NodeId, RunCtx, RunId } from '@dropai/runtime-core';
import { eventBus } from './eventBus.js';
import { topoSort, predecessors } from './topoSort.js';
import { callNodeRuntime, nodeRegistry } from '../nodes/loader.js';
import { setRunStatus } from '../db/flows.js';
import { buildPromptWithMemory, ingestTurn } from './memory.js';

export interface RunHandle {
  runId: RunId;
  abort(): void;
  done: Promise<void>;
}

export interface RunOptions {
  /** Runtime input passed to every source node (no-incoming-edge node). */
  input?: unknown;
}

export function startRun(flow: FlowDef, runId: RunId, options: RunOptions = {}): RunHandle {
  const controller = new AbortController();
  const outputs = new Map<string, unknown>();
  const sinkIds = sinks(flow);
  const toolNodeIds = computeToolNodes(flow);

  const memoryEnabled = Boolean(flow.settings?.memoryEnabled);
  const userText = typeof options.input === 'string' ? options.input : '';
  const runtimeInput =
    memoryEnabled && userText
      ? buildPromptWithMemory(flow.id, userText)
      : options.input;

  const done = (async () => {
    publishMeta(runId, 'meta', {
      kind: 'run-start',
      flowId: flow.id,
      memoryEnabled,
    });
    await setRunStatus(runId, 'running');
    try {
      // Tool nodes are excluded from linear execution; they only run when an
      // agent calls them via ctx.callTool.
      const order = topoSort(flow).filter(id => !toolNodeIds.has(id));
      for (const nodeId of order) {
        if (controller.signal.aborted) throw new Error('aborted');
        const node = flow.nodes.find(n => n.id === nodeId);
        if (!node) continue;
        const inputMsg = collectInput(flow, nodeId, outputs, runtimeInput);
        const ctx: RunCtx = makeCtx(runId, nodeId, controller.signal, flow);
        try {
          const config = injectAgentTools(node, flow);
          const result = await callNodeRuntime(node.type, ctx, config, inputMsg);
          outputs.set(nodeId, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.emit({ kind: 'error', payload: { message } });
          throw err;
        }
      }
      await setRunStatus(runId, 'succeeded');
      const result = finalResult(sinkIds, outputs);
      publishMeta(runId, 'meta', { kind: 'run-end', status: 'succeeded', result });

      if (memoryEnabled && userText) {
        const reply = stringifyResult(result);
        if (reply) {
          // Don't block run-end on extraction; let it run in the background.
          void ingestTurn(flow.id, userText, reply).then(({ added }) => {
            if (added > 0) {
              publishMeta(runId, 'meta', { kind: 'memory-updated', added });
            }
          });
        }
      }
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

function stringifyResult(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>;
    for (const key of ['finalText', 'reportMd', 'text', 'output']) {
      const v = r[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }
  return String(result);
}

function collectInput(
  flow: FlowDef,
  nodeId: string,
  outputs: Map<string, unknown>,
  runtimeInput: unknown,
): unknown {
  const preds = predecessors(flow, nodeId);
  if (preds.length === 0) return runtimeInput ?? null;
  if (preds.length === 1) return outputs.get(preds[0]!) ?? null;
  return preds.map(p => outputs.get(p) ?? null);
}

function sinks(flow: FlowDef): string[] {
  const hasOutgoing = new Set(flow.edges.map(e => e.source));
  return flow.nodes.map(n => n.id).filter(id => !hasOutgoing.has(id));
}

function finalResult(sinkIds: string[], outputs: Map<string, unknown>): unknown {
  if (sinkIds.length === 0) return null;
  if (sinkIds.length === 1) return outputs.get(sinkIds[0]!) ?? null;
  return Object.fromEntries(sinkIds.map(id => [id, outputs.get(id) ?? null]));
}

/** Union of every llm-agent node's `config.tools` list. */
function computeToolNodes(flow: FlowDef): Set<NodeId> {
  const ids = new Set<NodeId>();
  for (const n of flow.nodes) {
    if (n.type !== 'llm-agent') continue;
    const tools = n.config?.tools;
    if (!Array.isArray(tools)) continue;
    for (const t of tools) {
      if (typeof t === 'string') ids.add(t);
    }
  }
  return ids;
}

/**
 * For llm-agent nodes, resolve their tool list into manifest summaries
 * (name, description) and inject into config so the plugin can build OpenAI
 * tool specs without needing access to the registry.
 */
function injectAgentTools(node: FlowNode, flow: FlowDef): Record<string, unknown> {
  if (node.type !== 'llm-agent') return node.config;
  const toolIds = Array.isArray(node.config?.tools) ? (node.config.tools as string[]) : [];
  const manifests = nodeRegistry.list();
  const byType = new Map(manifests.map(m => [m.type, m]));
  const resolved = toolIds
    .map(id => {
      const target = flow.nodes.find(n => n.id === id);
      if (!target) return null;
      const manifest = byType.get(target.type);
      return {
        nodeId: target.id,
        type: target.type,
        label: manifest?.label ?? target.type,
        description: manifest?.description ?? '',
      };
    })
    .filter(Boolean);
  return { ...node.config, _tools: resolved };
}

function makeCtx(runId: RunId, nodeId: string, signal: AbortSignal, flow: FlowDef): RunCtx {
  const ctx: RunCtx = {
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
      console.log(`[${runId}] [${nodeId}] [${level}] ${message}`, meta ?? '');
    },
    async callTool(targetNodeId, input) {
      return invokeToolNode(flow, runId, signal, targetNodeId, input);
    },
  };
  return ctx;
}

/**
 * Run a single node as a tool call: child context tags every event on the
 * target's own nodeId with channel:'tool-call' so the visualizer animates
 * the right tile.
 */
async function invokeToolNode(
  flow: FlowDef,
  runId: RunId,
  signal: AbortSignal,
  targetNodeId: NodeId,
  input: unknown,
): Promise<unknown> {
  const target = flow.nodes.find(n => n.id === targetNodeId);
  if (!target) throw new Error(`callTool: no node with id "${targetNodeId}" in flow`);

  const childCtx: RunCtx = {
    runId,
    nodeId: target.id,
    signal,
    emit(event) {
      eventBus.publish({
        flowRunId: runId,
        nodeId: target.id,
        ts: Date.now(),
        kind: event.kind,
        channel: event.channel ?? 'tool-call',
        payload: event.payload,
      });
    },
    log(level, message, meta) {
      console.log(`[${runId}] [tool:${target.id}] [${level}] ${message}`, meta ?? '');
    },
    async callTool(nestedId, nestedInput) {
      return invokeToolNode(flow, runId, signal, nestedId, nestedInput);
    },
  };

  return callNodeRuntime(target.type, childCtx, target.config, input);
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
